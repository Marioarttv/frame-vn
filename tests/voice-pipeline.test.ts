import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  mkdir,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import {
  VoiceService,
  ApiError,
  requestHash,
  validateVoiceRequest,
  type VoiceServiceOptions,
} from "../server/voice-service";
import { createStudioApi } from "../server/api";
import { gateSilence, validateCues, type CueSheet } from "../server/alignment";

const input = {
  text: "[quietly] Welcome to the studio.",
  voiceId: "testVoice123",
  languageCode: "en",
};
const cues: CueSheet = {
  metadata: {
    duration: 2,
    soundFile: "",
    generator: "test",
    recognizer: "pocketSphinx",
    extendedShapes: "X",
    sourceSha256: "test",
    transcriptSha256: "test",
    silenceGate: { thresholdDb: -45, minimumSeconds: 0.2 },
  },
  mouthCues: [
    { start: 0, end: 0.2, value: "X" },
    { start: 0.2, end: 1.7, value: "C" },
    { start: 1.7, end: 2, value: "X" },
  ],
};
async function fixture(options: Partial<VoiceServiceOptions> = {}) {
  const root = await mkdtemp(join(tmpdir(), "frame-voice-test-"));
  const service = new VoiceService({
    root,
    apiKey: "test-only-secret",
    executables: {
      ffmpeg: process.execPath,
      ffprobe: process.execPath,
      rhubarb: process.execPath,
    },
    align: async () => structuredClone(cues),
    probeRhubarb: async () => ({ ready: true }),
    fetch: async () =>
      new Response(new Uint8Array(1024), {
        headers: { "request-id": "req_test", "character-cost": "31" },
      }),
    ...options,
  });
  return {
    root,
    service,
    close: () => rm(root, { recursive: true, force: true }),
  };
}

test("generation explicitly requests v4, deduplicates concurrent work, and reuses persisted audio", async () => {
  let calls = 0,
    upstreamBody: Record<string, unknown> | undefined;
  const f = await fixture({
    fetch: async (url, init) => {
      calls++;
      assert.match(
        String(url),
        /\/v1\/text-to-dialogue\?output_format=mp3_44100_128$/,
      );
      upstreamBody = JSON.parse(init!.body as string);
      await new Promise((resolve) => setTimeout(resolve, 15));
      return new Response(new Uint8Array(1024), {
        headers: { "request-id": "req_one", "character-cost": "31" },
      });
    },
  });
  try {
    const [first, duplicate] = await Promise.all([
      f.service.generate(input),
      f.service.generate(input),
    ]);
    assert.equal(calls, 1);
    assert.equal(first.id, duplicate.id);
    assert.equal(first.cached, false);
    assert.equal(duplicate.cached, true);
    assert.equal(upstreamBody!.model_id, "eleven_v4");
    assert.deepEqual(upstreamBody!.settings, {
      stability: 0.5,
      similarity: 0.75,
    });
    assert.deepEqual(upstreamBody!.inputs, [
      { text: input.text, voice_id: input.voiceId },
    ]);
    assert.equal(upstreamBody!.language_code, "en");
    const restarted = new VoiceService({
      root: f.root,
      fetch: async () => {
        throw new Error("Cache must not contact provider.");
      },
    });
    assert.equal((await restarted.generate(input)).cached, true);
    const ledger = JSON.parse(
      await readFile(
        join(f.root, ".studio", "voice", "attempts", `${first.id}.json`),
        "utf8",
      ),
    );
    assert.equal(ledger.status, "complete");
    assert.equal(ledger.characterCost, "31");
    assert.equal(ledger.requestId, "req_one");
    assert.ok(!JSON.stringify(ledger).includes("test-only-secret"));
  } finally {
    await f.close();
  }
});

test("an interrupted paid request is recorded and cannot be automatically submitted again", async () => {
  let calls = 0;
  const f = await fixture({
    fetch: async () => {
      calls++;
      throw new Error("network timeout");
    },
  });
  try {
    await assert.rejects(
      f.service.generate(input),
      (error) =>
        error instanceof ApiError && error.code === "generation_interrupted",
    );
    await assert.rejects(
      f.service.generate(input),
      (error) =>
        error instanceof ApiError && error.code === "attempt_needs_review",
    );
    assert.equal(calls, 1);
    const path = join(
      f.root,
      ".studio",
      "voice",
      "attempts",
      `${requestHash(validateVoiceRequest(input))}.json`,
    );
    const ledger = JSON.parse(await readFile(path, "utf8"));
    assert.equal(ledger.status, "failed");
    assert.equal(ledger.audioDownloaded, false);
  } finally {
    await f.close();
  }
});

test("upstream rejection keeps response request and character-cost metadata without exposing credentials", async () => {
  const f = await fixture({
    fetch: async () =>
      new Response("private upstream detail", {
        status: 422,
        headers: { "request-id": "req_invalid", "character-cost": "unknown" },
      }),
  });
  try {
    await assert.rejects(
      f.service.generate(input),
      (error) =>
        error instanceof ApiError &&
        error.code === "provider_rejected" &&
        error.details?.requestId === "req_invalid" &&
        !error.message.includes("private"),
    );
    await assert.rejects(
      f.service.generate(input),
      (error) =>
        error instanceof ApiError && error.code === "attempt_needs_review",
    );
  } finally {
    await f.close();
  }
});

test("only a person can archive an uncertain attempt; archiving never generates and keeps the record", async () => {
  let calls = 0;
  const f = await fixture({
    fetch: async () => {
      calls++;
      if (calls === 1) throw new Error("network timeout");
      return new Response(new Uint8Array(1024), {
        headers: { "request-id": "req_second" },
      });
    },
  });
  try {
    await assert.rejects(f.service.generate(input));
    let id = "";
    await assert.rejects(f.service.generate(input), (error) => {
      if (!(error instanceof ApiError)) return false;
      id = String(error.details?.id);
      return error.code === "attempt_needs_review";
    });
    assert.equal(id, requestHash(validateVoiceRequest(input)));
    await assert.rejects(
      f.service.archiveAttempt({ id: "../../etc/passwd" }),
      (error) => error instanceof ApiError && error.code === "invalid_attempt",
    );
    const archived = await f.service.archiveAttempt({ id });
    assert.equal(calls, 1);
    const record = JSON.parse(
      await readFile(
        join(
          f.root,
          ".studio",
          "voice",
          "attempts",
          "archive",
          `${id}.${archived.attemptId}.json`,
        ),
        "utf8",
      ),
    );
    assert.equal(record.status, "failed");
    const result = await f.service.generate(input);
    assert.equal(calls, 2);
    assert.equal(result.requestId, "req_second");
    await assert.rejects(
      f.service.archiveAttempt({ id }),
      (error) =>
        error instanceof ApiError && error.code === "attempt_not_uncertain",
    );
  } finally {
    await f.close();
  }
});

test("local alignment failure can be repaired from saved audio with no second paid request", async () => {
  let calls = 0,
    alignments = 0;
  const f = await fixture({
    fetch: async () => {
      calls++;
      return new Response(new Uint8Array(1024));
    },
    align: async () => {
      if (++alignments === 1)
        throw new Error("local tool temporarily unavailable");
      return structuredClone(cues);
    },
  });
  try {
    await assert.rejects(
      f.service.generate(input),
      (error) => error instanceof ApiError && error.code === "alignment_failed",
    );
    const result = await f.service.generate(input);
    assert.equal(result.cueSource, "rhubarb");
    assert.equal(result.cached, true);
    assert.equal(calls, 1);
    assert.equal(alignments, 2);
  } finally {
    await f.close();
  }
});

test("missing alignment tools block generation before any billable request", async () => {
  let calls = 0;
  const f = await fixture({
    executables: {
      ffmpeg: "/does-not-exist/ffmpeg",
      ffprobe: process.execPath,
      rhubarb: process.execPath,
    },
    fetch: async () => {
      calls++;
      return new Response();
    },
  });
  try {
    await assert.rejects(
      f.service.generate(input),
      (error) =>
        error instanceof ApiError && error.code === "alignment_unavailable",
    );
    assert.equal(calls, 0);
    assert.equal((await f.service.health()).ready, false);
  } finally {
    await f.close();
  }
});

test("an executable without working recognition resources is not ready and cannot incur billing", async () => {
  let calls = 0,
    probes = 0;
  const f = await fixture({
    probeRhubarb: async () => {
      probes++;
      return { ready: false, message: "Missing PocketSphinx resources." };
    },
    fetch: async () => {
      calls++;
      return new Response();
    },
  });
  try {
    const health = await f.service.health();
    assert.equal(health.rhubarbExecutable, true);
    assert.equal(health.rhubarb, false);
    assert.equal(health.ready, false);
    assert.match(health.alignmentError ?? "", /PocketSphinx/);
    await assert.rejects(
      f.service.generate(input),
      (error) =>
        error instanceof ApiError &&
        error.code === "alignment_unavailable" &&
        error.message.includes("PocketSphinx"),
    );
    assert.equal(calls, 0);
    assert.equal(probes, 1);
  } finally {
    await f.close();
  }
});

test("input validation rejects oversized dialogue, invalid settings and implicit model replacement", () => {
  for (const bad of [
    { ...input, text: "a".repeat(2001) },
    { ...input, stability: -1 },
    { ...input, similarity: "1" },
    { ...input, languageCode: "../en" },
    { ...input, voiceId: "../token" },
    { ...input, model: "eleven_v3" },
  ]) {
    assert.throws(() => validateVoiceRequest(bad), ApiError);
  }
  const a = validateVoiceRequest(input),
    b = validateVoiceRequest({
      voiceId: input.voiceId,
      languageCode: "en",
      text: ` ${input.text} `,
    });
  assert.equal(requestHash(a), requestHash(b));
  assert.notEqual(requestHash(a), requestHash({ ...a, similarity: 0.8 }));
});

test("voice inventory follows pagination and preserves current account metadata", async () => {
  const urls: string[] = [];
  const f = await fixture({
    fetch: async (url) => {
      urls.push(String(url));
      return Response.json(
        urls.length === 1
          ? {
              voices: [
                {
                  voice_id: "voiceA",
                  name: "A",
                  labels: { accent: "British" },
                  fine_tuning: { state: { eleven_v4: "fine_tuned" } },
                },
              ],
              has_more: true,
              next_page_token: "page2",
            }
          : {
              voices: [
                { voice_id: "voiceB", name: "B", category: "professional" },
              ],
              has_more: false,
            },
      );
    },
  });
  try {
    const result = await f.service.voices();
    assert.equal(result.voices.length, 2);
    assert.match(urls[1], /next_page_token=page2/);
    assert.equal(result.voices[0].labels.accent, "British");
    assert.equal(result.voices[1].category, "professional");
  } finally {
    await f.close();
  }
});

test("silence gate closes only measured quiet pauses and rejects malformed timelines", () => {
  const output = gateSilence(
    [{ start: 0, end: 2, value: "C" }],
    2,
    "[silencedetect] silence_start: 0.5\n[silencedetect] silence_end: 1 | silence_duration: 0.5",
  );
  assert.deepEqual(output, [
    { start: 0, end: 0.5, value: "C" },
    { start: 0.5, end: 1, value: "X" },
    { start: 1, end: 2, value: "C" },
  ]);
  validateCues(output, 2);
  assert.throws(() => validateCues([{ start: 0, end: 1, value: "Q" }], 1));
  assert.throws(() =>
    validateCues(
      [
        { start: 0, end: 1, value: "C" },
        { start: 0.8, end: 2, value: "X" },
      ],
      2,
    ),
  );
});

test("HTTP boundary blocks cross-origin billing and host rebinding, and serves exact range bytes", async () => {
  const f = await fixture();
  const api = createStudioApi({ service: f.service });
  const server = createServer((request, response) => {
    void api.handler(request, response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number },
    base = `http://127.0.0.1:${address.port}`;
  try {
    const health = (await (await fetch(`${base}/api/health`)).json()) as {
      sessionToken: string;
    };
    assert.equal(health.sessionToken.length, 64);
    const post = (headers: Record<string, string>) =>
      fetch(`${base}/api/voice`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(input),
      });
    assert.equal(
      (
        await post({
          origin: "https://unrelated.example",
          "x-studio-token": health.sessionToken,
        })
      ).status,
      403,
    );
    assert.equal((await post({ origin: base })).status, 403);
    assert.equal(
      (await post({ "x-studio-token": health.sessionToken })).status,
      403,
    );
    const reboundStatus = await new Promise<number | undefined>(
      (resolve, reject) => {
        const request = httpRequest(
          `${base}/api/health`,
          { headers: { host: `attacker.example:${address.port}` } },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        );
        request.on("error", reject);
        request.end();
      },
    );
    assert.equal(reboundStatus, 403);
    const generated = await post({
      origin: base,
      "x-studio-token": health.sessionToken,
    });
    assert.equal(generated.status, 200);
    const result = (await generated.json()) as { audioSrc: string };
    const audio = await fetch(`${base}${result.audioSrc}`, {
      headers: { range: "bytes=10-19" },
    });
    assert.equal(audio.status, 206);
    assert.equal(audio.headers.get("content-range"), "bytes 10-19/1024");
    assert.equal((await audio.arrayBuffer()).byteLength, 10);
    assert.equal(
      (
        await fetch(`${base}${result.audioSrc}`, {
          headers: { range: "bytes=2000-" },
        })
      ).status,
      416,
    );
    assert.equal((await fetch(`${base}/generated/not-a-hash.mp3`)).status, 404);
    assert.deepEqual(await (await fetch(`${base}/api/library`)).json(), {
      characters: [],
      backgrounds: [],
      packs: [],
      warnings: [],
    });
    await mkdir(join(f.root, "public", "local-packs", "sample-pack"), {
      recursive: true,
    });
    await writeFile(
      join(f.root, "public", "local-packs", "sample-pack", "catalog.json"),
      JSON.stringify({
        characters: [
          {
            id: "local",
            name: "Local",
            color: "#778899",
            poses: [
              {
                id: "default",
                name: "Default",
                src: "/local-packs/sample-pack/default.png",
              },
            ],
          },
        ],
      }),
    );
    assert.equal(
      (await (await fetch(`${base}/api/library`)).json()).characters[0].id,
      "local",
    );
    const localCatalog = await fetch(`${base}/local-packs/sample-pack/catalog.json`);
    assert.equal(localCatalog.status, 200);
    assert.equal((await localCatalog.json()).characters[0].id, "local");
    await writeFile(join(f.root, "outside.json"), '{"private":true}');
    await symlink(
      join(f.root, "outside.json"),
      join(f.root, "public", "local-packs", "sample-pack", "escape.json"),
    );
    assert.equal(
      (await fetch(`${base}/local-packs/sample-pack/escape.json`)).status,
      404,
    );
    assert.equal(
      (await fetch(`${base}/local-packs/sample-pack/%2e%2e%2f%2e%2e%2foutside.json`))
        .status,
      404,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.close();
  }
});
