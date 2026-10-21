import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import {
  alignAudio,
  probeRhubarb,
  type AlignmentInput,
  type CueSheet,
  type Executables,
  type RhubarbReadiness,
} from "./alignment";

export const MODEL = "eleven_v4" as const;
const API = "https://api.elevenlabs.io";
const OUTPUT_FORMAT = "mp3_44100_128";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
export interface VoiceRequest {
  text: string;
  voiceId: string;
  languageCode?: string;
  stability: number;
  similarity: number;
}
export interface VoiceResult {
  id: string;
  audioSrc: string;
  cueUrl: string;
  duration: number;
  model: typeof MODEL;
  voiceId: string;
  cached: boolean;
  cueSource: "rhubarb";
  requestId: string | null;
  characterCost: string | null;
}
/** A finished generation, as listed by the studio's voice history. Reading it is free. */
export interface VoiceHistoryItem {
  id: string;
  text: string;
  voiceId: string;
  stability: number;
  similarity: number;
  languageCode?: string;
  duration: number;
  audioSrc: string;
  cueUrl: string;
  createdAt: string;
  characterCost: string | null;
}
export interface VoiceInfo {
  id: string;
  name: string;
  category: string;
  previewUrl: string | null;
  labels: Record<string, string>;
  fineTuning: unknown;
}
interface Attempt {
  id: string;
  attemptId: string;
  createdAt: string;
  updatedAt: string;
  request: VoiceRequest;
  model: typeof MODEL;
  status:
    | "submitting"
    | "downloading"
    | "downloaded"
    | "aligning"
    | "complete"
    | "failed";
  audioDownloaded: boolean;
  requestId: string | null;
  characterCost: string | null;
  httpStatus?: number;
  result?: VoiceResult;
  error?: { code: string; message: string };
}
export interface VoiceServiceOptions {
  root?: string;
  dataDirectory?: string;
  apiKey?: string;
  envFile?: string;
  fetch?: typeof fetch;
  executables?: Partial<Executables>;
  /** Dependency injection for deterministic, non-billable server tests. */
  align?: (
    input: AlignmentInput,
    executables: Executables,
  ) => Promise<CueSheet>;
  probeRhubarb?: (executable: string) => Promise<RhubarbReadiness>;
}

export function validateVoiceRequest(value: unknown): VoiceRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(400, "invalid_request", "Send a JSON object.");
  const input = value as Record<string, unknown>;
  if (
    typeof input.text !== "string" ||
    !input.text.trim() ||
    input.text.trim().length > 2000
  )
    throw new ApiError(
      400,
      "invalid_text",
      "Dialogue must contain 1–2,000 characters.",
    );
  if (
    typeof input.voiceId !== "string" ||
    !/^[a-zA-Z0-9_-]{8,128}$/.test(input.voiceId)
  )
    throw new ApiError(
      400,
      "invalid_voice",
      "Select a valid ElevenLabs voice.",
    );
  if (input.model !== undefined && input.model !== MODEL)
    throw new ApiError(
      400,
      "invalid_model",
      "This studio generates speech with Eleven v4 only.",
    );
  const number = (key: string, fallback: number) => {
    const value = input[key] ?? fallback;
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1
    )
      throw new ApiError(
        400,
        "invalid_settings",
        `${key} must be between 0 and 1.`,
      );
    return value;
  };
  if (
    input.languageCode !== undefined &&
    (typeof input.languageCode !== "string" ||
      !/^[a-z]{2}$/.test(input.languageCode))
  )
    throw new ApiError(
      400,
      "invalid_language",
      "Use a two-letter language code, such as en or de.",
    );
  const request: VoiceRequest = {
    text: input.text.trim(),
    voiceId: input.voiceId,
    stability: number("stability", 0.5),
    similarity: number("similarity", 0.75),
  };
  if (input.languageCode) request.languageCode = input.languageCode as string;
  return request;
}
export function requestHash(request: VoiceRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        pipeline: 1,
        model: MODEL,
        output: OUTPUT_FORMAT,
        ...request,
      }),
    )
    .digest("hex");
}
async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}
async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
}
async function executable(name: string): Promise<boolean> {
  const candidates =
    isAbsolute(name) || name.includes("/")
      ? [name]
      : (process.env.PATH ?? "")
          .split(delimiter)
          .map((part) => join(part, name));
  for (const path of candidates) {
    try {
      await access(path, constants.X_OK);
      return true;
    } catch {
      /* Continue searching PATH. */
    }
  }
  return false;
}
async function readKey(
  root: string,
  options: VoiceServiceOptions,
): Promise<string | undefined> {
  const direct = options.apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (direct?.trim()) return direct.trim();
  const envFile =
    options.envFile ??
    process.env.ELEVENLABS_ENV_FILE ??
    join(root, ".env.local");
  try {
    const source = await readFile(envFile, "utf8");
    const raw = source.match(
      /^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*(.*?)\s*$/m,
    )?.[1];
    if (!raw) return undefined;
    return (
      (raw.startsWith('"') || raw.startsWith("'")
        ? raw.slice(1, raw.lastIndexOf(raw[0]))
        : raw.replace(/\s+#.*$/, "")
      ).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

export class VoiceService {
  readonly root: string;
  readonly dataDirectory: string;
  readonly assetsDirectory: string;
  readonly executables: Executables;
  private readonly options: VoiceServiceOptions;
  private readonly request: typeof fetch;
  private readonly inflight = new Map<string, Promise<VoiceResult>>();
  private readiness?: { expiresAt: number; result: Promise<RhubarbReadiness> };
  constructor(options: VoiceServiceOptions = {}) {
    this.options = options;
    this.root = resolve(options.root ?? process.cwd());
    this.dataDirectory = resolve(
      options.dataDirectory ?? join(this.root, ".studio", "voice"),
    );
    this.assetsDirectory = join(this.dataDirectory, "assets");
    this.executables = {
      ffmpeg:
        options.executables?.ffmpeg ?? process.env.FFMPEG_PATH ?? "ffmpeg",
      ffprobe:
        options.executables?.ffprobe ?? process.env.FFPROBE_PATH ?? "ffprobe",
      rhubarb:
        options.executables?.rhubarb ??
        process.env.RHUBARB_PATH ??
        (existsSync(join(this.root, ".studio", "tools", "rhubarb"))
          ? join(this.root, ".studio", "tools", "rhubarb")
          : "rhubarb"),
    };
    this.request = options.fetch ?? fetch;
  }
  async health() {
    const [key, ffmpeg, ffprobe, rhubarbExecutable] = await Promise.all([
      readKey(this.root, this.options),
      executable(this.executables.ffmpeg),
      executable(this.executables.ffprobe),
      executable(this.executables.rhubarb),
    ]);
    let check: RhubarbReadiness = {
      ready: false,
      message: "Rhubarb Lip Sync is not available on PATH or RHUBARB_PATH.",
    };
    if (rhubarbExecutable) {
      if (!this.readiness || this.readiness.expiresAt <= Date.now()) {
        const result = Promise.resolve()
          .then(() =>
            (this.options.probeRhubarb ?? probeRhubarb)(
              this.executables.rhubarb,
            ),
          )
          .catch((): RhubarbReadiness => ({
            ready: false,
            message:
              "The local Rhubarb readiness check could not complete. Check its installation and temporary-directory access.",
          }));
        this.readiness = { expiresAt: Date.now() + 30_000, result };
        void result.then((value) => {
          if (this.readiness?.result === result)
            this.readiness.expiresAt =
              Date.now() + (value.ready ? 30_000 : 5_000);
        });
      }
      check = await this.readiness.result;
    }
    const rhubarb = check.ready;
    return {
      ok: true,
      configured: Boolean(key),
      model: MODEL,
      ffmpeg,
      ffprobe,
      rhubarb,
      rhubarbExecutable,
      ready: Boolean(key && ffmpeg && ffprobe && rhubarb),
      alignment: rhubarb && ffmpeg && ffprobe ? "rhubarb" : "unavailable",
      ...(!rhubarb ? { alignmentError: check.message } : {}),
      maxCharacters: 2000,
    };
  }
  private async key(): Promise<string> {
    const key = await readKey(this.root, this.options);
    if (!key)
      throw new ApiError(
        503,
        "missing_credentials",
        "Set ELEVENLABS_API_KEY in the server environment or .env.local, then restart the studio.",
      );
    return key;
  }
  async voices(): Promise<{ voices: VoiceInfo[]; model: typeof MODEL }> {
    const key = await this.key(),
      voices: VoiceInfo[] = [];
    let cursor: string | undefined;
    const cursors = new Set<string>();
    do {
      const url = new URL("/v2/voices", API);
      url.searchParams.set("page_size", "100");
      if (cursor) url.searchParams.set("next_page_token", cursor);
      let response: Response;
      try {
        response = await this.request(url, {
          headers: { "xi-api-key": key },
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new ApiError(
          502,
          "voices_unavailable",
          "Could not reach ElevenLabs to read your voice library.",
        );
      }
      if (!response.ok)
        throw new ApiError(
          response.status === 401 || response.status === 403 ? 503 : 502,
          "voices_unavailable",
          `ElevenLabs voice inventory returned HTTP ${response.status}.`,
        );
      const page = (await response.json()) as {
        voices?: Array<Record<string, unknown>>;
        has_more?: boolean;
        next_page_token?: string;
      };
      for (const voice of page.voices ?? []) {
        if (
          typeof voice.voice_id !== "string" ||
          typeof voice.name !== "string"
        )
          continue;
        voices.push({
          id: voice.voice_id,
          name: voice.name,
          category: String(voice.category ?? "unknown"),
          previewUrl:
            typeof voice.preview_url === "string" ? voice.preview_url : null,
          labels:
            typeof voice.labels === "object" && voice.labels
              ? (voice.labels as Record<string, string>)
              : {},
          fineTuning: voice.fine_tuning ?? null,
        });
      }
      cursor = page.has_more ? page.next_page_token : undefined;
      if (cursor && cursors.has(cursor))
        throw new ApiError(
          502,
          "voices_pagination",
          "ElevenLabs returned a repeated voice inventory page.",
        );
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return { voices, model: MODEL };
  }
  async generate(value: unknown): Promise<VoiceResult> {
    const input = validateVoiceRequest(value),
      id = requestHash(input);
    const existing = this.inflight.get(id);
    if (existing) return { ...(await existing), cached: true };
    const task = this.generateOnce(input, id);
    this.inflight.set(id, task);
    try {
      return await task;
    } finally {
      this.inflight.delete(id);
    }
  }
  private async generateOnce(
    input: VoiceRequest,
    id: string,
  ): Promise<VoiceResult> {
    const attempts = join(this.dataDirectory, "attempts");
    await Promise.all([
      mkdir(attempts, { recursive: true, mode: 0o700 }),
      mkdir(this.assetsDirectory, { recursive: true, mode: 0o700 }),
    ]);
    const attemptPath = join(attempts, `${id}.json`),
      audioPath = join(this.assetsDirectory, `${id}.mp3`),
      cuePath = join(this.assetsDirectory, `${id}.cues.json`);
    let attempt: Attempt | undefined;
    try {
      attempt = JSON.parse(await readFile(attemptPath, "utf8")) as Attempt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new ApiError(
          409,
          "attempt_unreadable",
          "The local generation ledger cannot be read. Resolve it before generating this line again.",
        );
    }
    if (
      attempt?.status === "complete" &&
      attempt.result &&
      (await exists(audioPath)) &&
      (await exists(cuePath))
    )
      return { ...attempt.result, cached: true };
    if (attempt && (!attempt.audioDownloaded || !(await exists(audioPath)))) {
      throw new ApiError(
        409,
        "attempt_needs_review",
        "A previous attempt may have been billed. Review its request in ElevenLabs history before deliberately generating it again.",
        {
          id,
          requestId: attempt.requestId,
          attemptId: attempt.attemptId,
          previousStatus: attempt.status,
        },
      );
    }
    const reusedAudio = Boolean(attempt?.audioDownloaded);
    const capability = await this.health();
    if (!capability.ffmpeg || !capability.ffprobe || !capability.rhubarb)
      throw new ApiError(
        503,
        "alignment_unavailable",
        `${capability.alignmentError ?? "Install FFmpeg (including ffprobe) and the complete Rhubarb Lip Sync distribution."} No speech request was submitted.`,
      );
    if (!attempt) {
      const key = await this.key();
      const now = new Date().toISOString();
      attempt = {
        id,
        attemptId: randomUUID(),
        createdAt: now,
        updatedAt: now,
        request: input,
        model: MODEL,
        status: "submitting",
        audioDownloaded: false,
        requestId: null,
        characterCost: null,
      };
      // An exclusive durable claim also prevents duplicate billing across separate server processes.
      try {
        await writeFile(attemptPath, `${JSON.stringify(attempt, null, 2)}\n`, {
          flag: "wx",
          mode: 0o600,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new ApiError(
            409,
            "attempt_in_progress",
            "This line already has a generation attempt. Wait for it to finish.",
          );
        throw error;
      }
      try {
        const body = {
          model_id: MODEL,
          inputs: [{ text: input.text, voice_id: input.voiceId }],
          settings: {
            stability: input.stability,
            similarity: input.similarity,
          },
          ...(input.languageCode ? { language_code: input.languageCode } : {}),
        };
        const response = await this.request(
          `${API}/v1/text-to-dialogue?output_format=${OUTPUT_FORMAT}`,
          {
            method: "POST",
            headers: { "xi-api-key": key, "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(180_000),
          },
        );
        attempt.requestId =
          response.headers.get("request-id") ??
          response.headers.get("x-request-id");
        attempt.characterCost = response.headers.get("character-cost");
        attempt.httpStatus = response.status;
        attempt.status = "downloading";
        await this.saveAttempt(attemptPath, attempt);
        if (!response.ok)
          throw new ApiError(
            502,
            "provider_rejected",
            `ElevenLabs returned HTTP ${response.status}. Inspect the saved attempt and your account; the studio will not retry automatically.`,
          );
        if (!response.body)
          throw new ApiError(
            502,
            "empty_audio",
            "ElevenLabs returned no audio body.",
          );
        const reader = response.body.getReader(),
          chunks: Uint8Array[] = [];
        let bytes = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 32 * 1024 * 1024) {
            await reader.cancel();
            throw new ApiError(
              502,
              "audio_too_large",
              "The generated audio exceeded the local 32 MB limit.",
            );
          }
          chunks.push(value);
        }
        if (bytes < 100)
          throw new ApiError(
            502,
            "empty_audio",
            "ElevenLabs returned an unexpectedly short audio body.",
          );
        const temporary = `${audioPath}.${attempt.attemptId}.tmp`;
        await writeFile(temporary, Buffer.concat(chunks), { mode: 0o600 });
        await rename(temporary, audioPath);
        attempt.audioDownloaded = true;
        attempt.status = "downloaded";
        await this.saveAttempt(attemptPath, attempt);
      } catch (error) {
        const known =
          error instanceof ApiError
            ? error
            : new ApiError(
                502,
                "generation_interrupted",
                "The ElevenLabs request was interrupted and may have been billed. Review its history before another attempt.",
              );
        attempt.status = "failed";
        attempt.error = { code: known.code, message: known.message };
        await this.saveAttempt(attemptPath, attempt);
        throw new ApiError(known.status, known.code, known.message, {
          requestId: attempt.requestId,
          attemptId: attempt.attemptId,
        });
      }
    }
    attempt.status = "aligning";
    await this.saveAttempt(attemptPath, attempt);
    try {
      const audioSrc = `/generated/${id}.mp3`,
        cueUrl = `/generated/${id}.cues.json`;
      const sheet = await (this.options.align ?? alignAudio)(
        {
          audioPath,
          audioSrc,
          text: input.text,
          languageCode: input.languageCode,
        },
        this.executables,
      );
      await atomicJson(cuePath, sheet);
      const result: VoiceResult = {
        id,
        audioSrc,
        cueUrl,
        duration: sheet.metadata.duration,
        model: MODEL,
        voiceId: input.voiceId,
        cached: reusedAudio,
        cueSource: "rhubarb",
        requestId: attempt.requestId,
        characterCost: attempt.characterCost,
      };
      attempt.status = "complete";
      attempt.result = result;
      delete attempt.error;
      await this.saveAttempt(attemptPath, attempt);
      return result;
    } catch {
      attempt.status = "failed";
      attempt.error = {
        code: "alignment_failed",
        message:
          "Audio was saved, but local mouth alignment failed. The same request retries alignment only, without generating or paying for speech again.",
      };
      await this.saveAttempt(attemptPath, attempt);
      throw new ApiError(500, attempt.error.code, attempt.error.message, {
        requestId: attempt.requestId,
        attemptId: attempt.attemptId,
      });
    }
  }
  /** Completed generations whose audio is still saved locally, newest first. */
  async history(limit = 300): Promise<{ items: VoiceHistoryItem[] }> {
    const attempts = join(this.dataDirectory, "attempts");
    let names: string[];
    try {
      names = await readdir(attempts);
    } catch {
      return { items: [] };
    }
    const items: VoiceHistoryItem[] = [];
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      try {
        const attempt = JSON.parse(
          await readFile(join(attempts, name), "utf8"),
        ) as Attempt;
        if (attempt.status !== "complete" || !attempt.result) continue;
        if (!(await exists(join(this.assetsDirectory, `${attempt.id}.mp3`))))
          continue;
        items.push({
          id: attempt.id,
          text: attempt.request.text,
          voiceId: attempt.request.voiceId,
          stability: attempt.request.stability,
          similarity: attempt.request.similarity,
          ...(attempt.request.languageCode
            ? { languageCode: attempt.request.languageCode }
            : {}),
          duration: attempt.result.duration,
          audioSrc: attempt.result.audioSrc,
          cueUrl: attempt.result.cueUrl,
          createdAt: attempt.createdAt,
          characterCost: attempt.characterCost,
        });
      } catch {
        /* Skip unreadable ledger entries; generation reports them. */
      }
    }
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { items: items.slice(0, limit) };
  }
  /**
   * A person has reconciled an uncertain attempt against provider history. Its record moves
   * to attempts/archive/ for cost reconciliation; nothing is generated until they ask again.
   */
  async archiveAttempt(value: unknown): Promise<{
    archived: true;
    id: string;
    attemptId: string;
    requestId: string | null;
  }> {
    const id =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>).id
        : undefined;
    if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id))
      throw new ApiError(400, "invalid_attempt", "Choose a recorded attempt.");
    if (this.inflight.has(id))
      throw new ApiError(
        409,
        "attempt_in_progress",
        "This line is still generating. Wait for it to finish.",
      );
    const attempts = join(this.dataDirectory, "attempts"),
      attemptPath = join(attempts, `${id}.json`);
    let attempt: Attempt;
    try {
      attempt = JSON.parse(await readFile(attemptPath, "utf8")) as Attempt;
    } catch {
      throw new ApiError(404, "attempt_not_found", "No attempt is recorded.");
    }
    if (
      attempt.status === "complete" ||
      (attempt.audioDownloaded &&
        (await exists(join(this.assetsDirectory, `${id}.mp3`))))
    )
      throw new ApiError(
        409,
        "attempt_not_uncertain",
        "This line's audio is saved. Generating it again reuses that audio without a new request.",
      );
    const archive = join(attempts, "archive");
    await mkdir(archive, { recursive: true, mode: 0o700 });
    const attemptId = /^[a-zA-Z0-9-]{1,64}$/.test(attempt.attemptId)
      ? attempt.attemptId
      : randomUUID();
    await rename(attemptPath, join(archive, `${id}.${attemptId}.json`));
    return {
      archived: true,
      id,
      attemptId,
      requestId: attempt.requestId ?? null,
    };
  }
  private async saveAttempt(path: string, attempt: Attempt): Promise<void> {
    attempt.updatedAt = new Date().toISOString();
    await atomicJson(path, attempt);
  }
}
