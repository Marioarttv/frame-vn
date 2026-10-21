import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const engine = resolve(".");
/** The builder needs FFmpeg; machines without it skip these tests, as the render tests do. */
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

/** A two-line chapter with three illustrated roles, one of them silent, in a scratch engine root. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chapter-build-"));
  const out = join(root, ".studio/chapters/demo");
  await mkdir(out, { recursive: true });
  for (const [pack, character, svg] of [
    ["mira-pack", "mira", "mira"],
    ["noah-pack", "noah", "noah"],
    ["cat-pack", "cat", "noah"],
  ]) {
    const dir = join(root, "public/local-packs", pack);
    await mkdir(dir, { recursive: true });
    await copyFile(join(engine, `public/assets/characters/${svg}.svg`), join(dir, "portrait.svg"));
    await writeFile(join(dir, "catalog.json"), JSON.stringify({
      version: 1, id: pack, name: pack, localOnly: true,
      characters: [{ id: character, name: character, color: "#888888",
        poses: [{ id: `${pack}-front`, name: "front", src: `/local-packs/${pack}/portrait.svg` }] }],
    }));
  }
  const audio = join(out, "master.mp3");
  const made = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=2.5",
    "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", audio]);
  assert.equal(made.status, 0, String(made.stderr));
  const inputs = [{ speaker: "mira", text: "Hello there." }, { speaker: "noah", text: "Hi, Mira." }];
  await writeFile(join(out, "input.json"), JSON.stringify({ title: "Demo", masterAudio: audio,
    masterDuration: 2.5, musicOffset: 0, chunks: [{ key: "take", audio, offset: 0, duration: 2.5, inputs }] }));
  const lines = [
    { id: "line-001", speaker: "mira", text: "Hello there.", direction: "", start: 0, end: 1.234567,
      chunk: "take", chunkStart: 0, sourceLine: 1, words: [0.1, 0.5] },
    { id: "line-002", speaker: "noah", text: "Hi, Mira.", direction: "", start: 1.234567, end: 2.5,
      chunk: "take", chunkStart: 1.234567, sourceLine: 2, words: [1.3, 1.6] },
  ];
  await writeFile(join(out, "timeline.json"), JSON.stringify({ masterAudio: audio, masterDuration: 2.5,
    masterSha256: sha(await readFile(audio)), lines }));
  // A cached lip-sync sheet bound to the take and its text, so no local recognizer is needed.
  await mkdir(join(out, "work"), { recursive: true });
  await writeFile(join(out, "work/take.cues.json"), JSON.stringify({
    metadata: { sourceSha256: sha(await readFile(audio)), transcriptSha256: sha("Hello there. Hi, Mira."), duration: 2.5 },
    mouthCues: [{ start: 0, end: 0.6, value: "B" }, { start: 0.6, end: 2.5, value: "X" }],
  }));
  const config = {
    id: "demo", title: "Demo", engineRoot: root, timeline: join(out, "timeline.json"),
    input: join(out, "input.json"), output: out, rhubarb: "/nonexistent/rhubarb",
    credit: "Demo credit", creditLink: "https://example.com", fileStem: "chapter-7",
    roles: {
      mira: { name: "Mira", voiceId: "voice-a", packs: ["mira-pack"], pose: "front" },
      noah: { name: "Noah", voiceId: "voice-b", packs: ["noah-pack"], pose: "front" },
      cat: { name: "Cat", packs: ["cat-pack"], pose: "front", expressionChange: "cut" },
    },
  };
  await writeFile(join(out, "config.json"), JSON.stringify(config));
  return { root, out, config };
}

const build = (config: string) =>
  spawnSync(process.execPath, ["--import", "tsx", "scripts/chapter/build.ts", config], { cwd: engine, encoding: "utf8" });

test("the chapter builder takes any number of roles, a silent role and a file stem", async (context) => {
  if (!hasFfmpeg) return context.skip("FFmpeg is unavailable.");
  const { root, out } = await fixture();
  try {
    const result = build(join(out, "config.json"));
    assert.equal(result.status, 0, result.stderr);
    const project = JSON.parse(await readFile(join(out, "chapter-7.frame.json"), "utf8"));
    await access(join(out, "chapter-7.html"));
    await access(join(out, "chapter-7-engine.html"));
    assert.deepEqual(project.characters.map((c: { id: string }) => c.id), ["mira", "noah", "cat"]);
    const cat = project.characters.find((c: { id: string }) => c.id === "cat");
    assert.equal(cat.voiceId, undefined, "a silent role has no voice");
    assert.equal(cat.expressionChange, "cut");
    // The clip cut at a fractional time decodes and keeps its length.
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
      join(root, "public/local-packs/demo/audio/line-001.mp3")], { encoding: "utf8" });
    assert.ok(Math.abs(Number(probe.stdout) - 1.2346) < 0.06, probe.stdout);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a role's later expression pack joins its character only through an alias", async (context) => {
  if (!hasFfmpeg) return context.skip("FFmpeg is unavailable.");
  const { root, out, config } = await fixture();
  try {
    // Mira's smile was drawn later and installed under its own character ID.
    const dir = join(root, "public/local-packs/mira-smile-pack");
    await mkdir(dir, { recursive: true });
    await copyFile(join(engine, "public/assets/characters/mira.svg"), join(dir, "portrait.svg"));
    await writeFile(join(dir, "catalog.json"), JSON.stringify({
      version: 1, id: "mira-smile-pack", name: "mira-smile-pack", localOnly: true,
      characters: [{ id: "mira-smile-candidate", name: "mira", color: "#888888",
        poses: [{ id: "mira-smile", name: "smile", src: "/local-packs/mira-smile-pack/portrait.svg" }] }],
    }));
    const mira = { ...config.roles.mira, packs: ["mira-pack", "mira-smile-pack"] };
    await writeFile(join(out, "config.json"), JSON.stringify({ ...config, roles: { ...config.roles, mira } }));
    const refused = build(join(out, "config.json"));
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /must share a character ID \(mira: mira-smile-candidate is not mira/);

    const aliased = { ...mira, aliases: ["mira-smile-candidate"] };
    await writeFile(join(out, "config.json"), JSON.stringify({ ...config, roles: { ...config.roles, mira: aliased } }));
    const result = build(join(out, "config.json"));
    assert.equal(result.status, 0, result.stderr);
    const project = JSON.parse(await readFile(join(out, "chapter-7.frame.json"), "utf8"));
    assert.deepEqual(project.characters.map((c: { id: string }) => c.id), ["mira", "noah", "cat"]);
    const character = project.characters.find((c: { id: string }) => c.id === "mira");
    assert.deepEqual(character.poses.map((p: { id: string }) => p.id), ["mira-pack-front", "mira-smile"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a silent role cannot be given a line", async (context) => {
  if (!hasFfmpeg) return context.skip("FFmpeg is unavailable.");
  const { root, out } = await fixture();
  try {
    const timeline = JSON.parse(await readFile(join(out, "timeline.json"), "utf8"));
    timeline.lines[1].speaker = "cat";
    await writeFile(join(out, "timeline.json"), JSON.stringify(timeline));
    const result = build(join(out, "config.json"));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /silent role "cat" cannot speak/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the direction's ending gives the end card its outro music and stops the ambience", async (context) => {
  if (!hasFfmpeg) return context.skip("FFmpeg is unavailable.");
  const { root, out, config } = await fixture();
  try {
    const media = join(root, "public/local-packs/demo-media/music");
    await mkdir(media, { recursive: true });
    const made = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=1",
      "-c:a", "libmp3lame", join(media, "sting.mp3")]);
    assert.equal(made.status, 0, String(made.stderr));
    await writeFile(join(out, "direction.json"), JSON.stringify({
      media: "demo-media", backgrounds: {}, sfx: [], lines: {},
      music: { sting: { src: "music/sting.mp3", loop: false, volume: 0.4 } },
      ending: { music: "sting", ambience: null },
    }));
    await writeFile(join(out, "config.json"), JSON.stringify({ ...config, direction: join(out, "direction.json") }));
    const result = build(join(out, "config.json"));
    assert.equal(result.status, 0, result.stderr);
    const project = JSON.parse(await readFile(join(out, "chapter-7.frame.json"), "utf8"));
    const ending = project.nodes.at(-1);
    assert.equal(ending.type, "end");
    assert.equal(ending.musicId, "sting");
    assert.equal(ending.ambienceId, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
