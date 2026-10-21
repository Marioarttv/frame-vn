/**
 * Deterministic frame-by-frame video renderer. It loads a self-contained recording document in
 * headless Chromium under the virtual clock (virtual-clock.ts), advances exactly 1/fps per
 * frame, screenshots every frame into ffmpeg (H.264), then mixes the page's audio timeline and
 * muxes it into the final MP4 (audio-mix.ts).
 */
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type CDPSession, type Page } from "playwright-core";
import { mixAndMux, probeMedia, type MediaSource } from "./audio-mix";
import { findExecutable, spawnTracked, terminate } from "./processes";
import {
  mediaKey,
  virtualClockScript,
  type AudioEvent,
  type StepResult,
} from "./virtual-clock";

export type RenderPhase =
  | "launching"
  | "rendering"
  | "encoding"
  | "mixing"
  | "done";

export interface RenderProgress {
  phase: RenderPhase;
  /** Frames captured so far. */
  frame: number;
  /** Virtual seconds rendered so far. */
  seconds: number;
  scene: number;
  nodeId?: string;
  /** Frames rendered per real second (rolling). */
  speed: number;
  message?: string;
}

export interface RenderOptions {
  htmlPath: string;
  outputPath: string;
  /** Scratch directory for decoded media and the intermediate video; created and removed here. */
  workDir: string;
  width: number;
  height: number;
  fps: number;
  /** Screenshot format piped to ffmpeg. JPEG is faster; PNG is lossless. */
  format?: "jpeg" | "png";
  jpegQuality?: number;
  /** libx264 preset; "medium" balances speed and quality. */
  preset?: string;
  crf?: number;
  /** Stop after this much virtual time even if the recording never reports completion. */
  maxSeconds?: number;
  /** Real-time cap per frame for pending loads before the frame is captured anyway. */
  settleCapMs?: number;
  signal?: AbortSignal;
  ffmpeg?: string;
  ffprobe?: string;
  chromiumPath?: string;
  onProgress?: (progress: RenderProgress) => void;
}

export interface RenderResult {
  frames: number;
  seconds: number;
  bytes: number;
  audioSegments: number;
  /** Frames rendered per real second over the whole frame loop. */
  speed: number;
  recording: StepResult["recording"];
  /** When each scene first appeared, in video seconds (useful for chapter markers and music cues). */
  scenes: { nodeId: string; seconds: number }[];
  warnings: string[];
}

export class RenderError extends Error {}

const MEDIA_DATA_URL = /data:(audio|video)\/([a-z0-9.+-]+);base64,([A-Za-z0-9+/]+=*)/gi;
const EXTENSIONS: Record<string, string> = {
  mpeg: "mp3",
  mp3: "mp3",
  wav: "wav",
  "x-wav": "wav",
  ogg: "ogg",
  opus: "ogg",
  mp4: "mp4",
  aac: "aac",
  webm: "webm",
  flac: "flac",
  quicktime: "mov",
};

/** Finds the Playwright Chromium, falling back to any installed revision or FRAME_CHROMIUM_PATH. */
export async function resolveChromium(explicit?: string): Promise<string> {
  const candidates = [explicit, process.env.FRAME_CHROMIUM_PATH].filter(
    (value): value is string => !!value,
  );
  try {
    candidates.push(chromium.executablePath());
  } catch {
    /* no registry entry */
  }
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  const cache =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    (process.platform === "darwin"
      ? join(homedir(), "Library", "Caches", "ms-playwright")
      : process.platform === "win32"
        ? join(process.env.LOCALAPPDATA ?? homedir(), "ms-playwright")
        : join(homedir(), ".cache", "ms-playwright"));
  try {
    const entries = (await readdir(cache))
      .filter((name) => /^chromium(?:_headless_shell)?-\d+$/.test(name))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const entry of entries) {
      const root = join(cache, entry);
      for (const platform of await readdir(root)) {
        const base = join(root, platform);
        for (const relative of [
          "chrome-headless-shell",
          "chrome-headless-shell.exe",
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
          "chrome",
          "chrome.exe",
          "Chromium.app/Contents/MacOS/Chromium",
        ]) {
          const candidate = join(base, relative);
          if (existsSync(candidate)) return candidate;
        }
      }
    }
  } catch {
    /* no cache directory */
  }
  throw new RenderError(
    "Chromium for Playwright is not installed. Run `npm run setup:browser` once.",
  );
}

export interface ExtractedMedia {
  sources: Map<string, MediaSource>;
  durations: Record<string, number>;
}

/** Decodes every audio/video data URL in the document once (deduplicated by content hash). */
export async function extractMedia(
  html: string,
  directory: string,
  ffprobe: string,
  signal?: AbortSignal,
): Promise<ExtractedMedia> {
  await mkdir(directory, { recursive: true });
  const sources = new Map<string, MediaSource>();
  const durations: Record<string, number> = {};
  const byHash = new Map<string, MediaSource>();
  for (const match of html.matchAll(MEDIA_DATA_URL)) {
    if (signal?.aborted) throw new RenderError("Cancelled.");
    const url = match[0];
    const key = mediaKey(url);
    if (sources.has(key)) continue;
    const bytes = Buffer.from(match[3], "base64");
    const hash = createHash("sha256").update(bytes).digest("hex");
    let source = byHash.get(hash);
    if (!source) {
      const extension = EXTENSIONS[match[2].toLowerCase()] ?? "bin";
      const path = join(directory, `${hash}.${extension}`);
      await writeFile(path, bytes);
      try {
        const info = await probeMedia(ffprobe, path, signal);
        source = {
          path,
          duration: Number.isFinite(info.duration) ? info.duration : 0,
          hasAudio: info.hasAudio,
        };
      } catch {
        source = { path, duration: 0, hasAudio: false };
      }
      byHash.set(hash, source);
    }
    sources.set(key, source);
    if (source.duration > 0) durations[key] = source.duration;
  }
  return { sources, durations };
}

function nowSeconds() {
  return Number(process.hrtime.bigint()) / 1e9;
}

export async function renderRecording(options: RenderOptions): Promise<RenderResult> {
  const {
    width,
    height,
    fps,
    format = "jpeg",
    jpegQuality = 95,
    preset = "medium",
    crf = 18,
    maxSeconds = 30 * 60,
    settleCapMs = 10_000,
    signal,
  } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width % 2 || height % 2)
    throw new RenderError("Width and height must be even integers.");
  if (!(fps > 0 && fps <= 120)) throw new RenderError("Choose a frame rate between 1 and 120.");
  const warnings: string[] = [];
  const warn = (message: string) => {
    if (!warnings.includes(message) && warnings.length < 40) warnings.push(message);
  };
  const progress: RenderProgress = {
    phase: "launching",
    frame: 0,
    seconds: 0,
    scene: 0,
    speed: 0,
  };
  const report = (patch: Partial<RenderProgress>) => {
    Object.assign(progress, patch);
    options.onProgress?.({ ...progress });
  };
  const throwIfCancelled = () => {
    if (signal?.aborted) throw new RenderError("Cancelled.");
  };
  report({ phase: "launching" });
  const [ffmpeg, ffprobe, executablePath] = await Promise.all([
    findExecutable("ffmpeg", options.ffmpeg),
    findExecutable("ffprobe", options.ffprobe),
    resolveChromium(options.chromiumPath),
  ]);
  const info = await stat(options.htmlPath).catch(() => null);
  if (!info?.isFile()) throw new RenderError("The recording document is missing.");
  if (info.size > 480 * 1024 * 1024)
    throw new RenderError("The recording document is larger than 480 MB; reduce the embedded media.");
  await mkdir(options.workDir, { recursive: true });
  const html = await readFile(options.htmlPath, "utf8");
  const media = await extractMedia(html, join(options.workDir, "media"), ffprobe, signal);
  throwIfCancelled();

  const videoPath = join(options.workDir, "video.mp4");
  let browser: Browser | null = null;
  let encoder: ReturnType<typeof spawnTracked> | null = null;
  let encoderError = "";
  let encoderExit: Promise<number | null> | null = null;
  const onAbort = () => {
    void browser?.close().catch(() => undefined);
    if (encoder) void terminate(encoder, 300);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const frameLoopStart = nowSeconds();
  let frames = 0;
  let recording: StepResult["recording"] = { status: "unknown" };
  const scenes: RenderResult["scenes"] = [];
  const noteScene = (seconds: number) => {
    const nodeId = recording.nodeId;
    if (nodeId && scenes.at(-1)?.nodeId !== nodeId) scenes.push({ nodeId, seconds });
  };
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: [
        "--autoplay-policy=no-user-gesture-required",
        "--mute-audio",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--force-color-profile=srgb",
        "--hide-scrollbars",
        "--allow-file-access-from-files",
      ],
    });
    throwIfCancelled();
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      colorScheme: "dark",
      reducedMotion: "no-preference",
      serviceWorkers: "block",
    });
    await context.addInitScript({
      content: virtualClockScript({ durations: media.durations }),
    });
    const page: Page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      if (pageErrors.length < 20) pageErrors.push(error.message);
    });
    page.on("console", (message) => {
      if (message.type() === "error" && pageErrors.length < 20)
        pageErrors.push(message.text());
    });
    let crashed = false;
    page.on("crash", () => {
      crashed = true;
    });
    await page.goto(pathToFileURL(options.htmlPath).href, {
      waitUntil: "load",
      timeout: 120_000,
    });
    const cdp: CDPSession = await context.newCDPSession(page);
    const initial = await page.evaluate(
      async (cap) => {
        const clock = (window as unknown as { __frameClock: import("./virtual-clock").VirtualClockApi }).__frameClock;
        await document.fonts?.ready;
        const settled = await clock.settle(cap);
        return { ...settled, recording: clock.status() };
      },
      Math.max(settleCapMs, 60_000),
    );
    if (!initial.settled)
      warn(`The page was still loading after ${(initial.waited / 1000).toFixed(1)} s: ${initial.pending.join(", ")}.`);
    recording = initial.recording;
    noteScene(0);
    if (recording.status === "error")
      throw new RenderError(recording.message || "The story could not start.");

    encoder = spawnTracked(
      ffmpeg,
      [
        "-y",
        "-v",
        "error",
        "-nostdin",
        "-f",
        "image2pipe",
        "-framerate",
        String(fps),
        "-c:v",
        format === "png" ? "png" : "mjpeg",
        "-i",
        "pipe:0",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        preset,
        "-crf",
        String(crf),
        "-vf",
        "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
        "-color_primaries",
        "bt709",
        "-color_trc",
        "bt709",
        "-colorspace",
        "bt709",
        "-color_range",
        "tv",
        "-r",
        String(fps),
        "-video_track_timescale",
        String(fps * 1000),
        videoPath,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    const stdin = encoder.stdin!;
    stdin.on("error", () => undefined);
    encoder.stderr!.on("data", (chunk: Buffer) => {
      if (encoderError.length < 32 * 1024) encoderError += chunk.toString("utf8");
    });
    encoderExit = new Promise<number | null>((resolve) => {
      encoder!.once("close", (code) => resolve(code));
      encoder!.once("error", () => resolve(-1));
    });

    const deltaMs = 1000 / fps;
    const maxFrames = Math.ceil(maxSeconds * fps);
    const capture = async () => {
      const shot = await cdp.send("Page.captureScreenshot", {
        format,
        ...(format === "jpeg" ? { quality: jpegQuality } : {}),
        optimizeForSpeed: true,
      });
      const buffer = Buffer.from(shot.data, "base64");
      if (encoder!.exitCode !== null)
        throw new RenderError(
          `The video encoder stopped: ${encoderError.trim().split("\n").pop() ?? "ffmpeg failed"}`,
        );
      if (!stdin.write(buffer)) await once(stdin, "drain");
      frames++;
    };
    report({ phase: "rendering" });
    await capture();
    let lastReport = nowSeconds();
    let windowStart = lastReport;
    let windowFrames = 0;
    while (frames < maxFrames) {
      throwIfCancelled();
      if (crashed) throw new RenderError("The browser page crashed while rendering.");
      const result: StepResult = await page.evaluate(
        ([delta, cap]) =>
          (window as unknown as { __frameClock: import("./virtual-clock").VirtualClockApi }).__frameClock.step(delta, cap),
        [deltaMs, settleCapMs] as [number, number],
      );
      recording = result.recording;
      noteScene(frames / fps);
      for (const error of result.errors) warn(`Page callback error: ${error}`);
      if (!result.settled)
        warn(`Frame ${frames}: still loading after ${(result.waited / 1000).toFixed(1)} s (${result.pending.join(", ")}).`);
      await capture();
      windowFrames++;
      const now = nowSeconds();
      if (now - lastReport >= 0.25) {
        const speed = windowFrames / Math.max(1e-3, now - windowStart);
        if (now - windowStart > 3) {
          windowStart = now;
          windowFrames = 0;
        }
        lastReport = now;
        report({
          frame: frames,
          seconds: frames / fps,
          scene: recording.scenes ?? progress.scene,
          nodeId: recording.nodeId,
          speed,
        });
      }
      if (recording.status === "done") break;
      if (recording.status === "error")
        throw new RenderError(recording.message || "The story stopped with an error.");
    }
    if (frames >= maxFrames && recording.status !== "done")
      warn(`Stopped at the ${maxSeconds} s limit before the story finished.`);
    for (const error of pageErrors.slice(0, 5)) warn(`Page error: ${error}`);
    const loopSeconds = nowSeconds() - frameLoopStart;
    report({
      phase: "encoding",
      frame: frames,
      seconds: frames / fps,
      scene: recording.scenes ?? progress.scene,
      nodeId: recording.nodeId,
      speed: frames / Math.max(1e-3, loopSeconds),
    });
    const events: AudioEvent[] = await page.evaluate(() =>
      (window as unknown as { __frameClock: import("./virtual-clock").VirtualClockApi }).__frameClock.getAudioLog(),
    );
    // Audio created by the page itself (not embedded in the document) is fetched from the page.
    for (const key of new Set(
      events
        .filter((event) => event.type === "play" && event.key && !media.sources.has(event.key))
        .map((event) => event.key!),
    )) {
      if (!key.startsWith("d:")) continue;
      const source: string | null = await page.evaluate(
        (wanted) =>
          (window as unknown as { __frameClock: import("./virtual-clock").VirtualClockApi }).__frameClock.getSource(wanted),
        key,
      );
      if (!source) continue;
      const extra = await extractMedia(source, join(options.workDir, "media"), ffprobe, signal);
      for (const [extraKey, value] of extra.sources) media.sources.set(extraKey, value);
    }
    await browser.close();
    browser = null;
    stdin.end();
    const code = await encoderExit;
    encoder = null;
    throwIfCancelled();
    if (code !== 0)
      throw new RenderError(
        `The video could not be encoded: ${encoderError.trim().split("\n").pop() ?? "ffmpeg failed"}`,
      );
    report({ phase: "mixing" });
    const mix = await mixAndMux({
      ffmpeg,
      ffprobe,
      events,
      sources: media.sources,
      durationSeconds: frames / fps,
      videoPath,
      outputPath: options.outputPath,
      signal,
    });
    for (const warning of mix.warnings) warn(warning);
    const output = await stat(options.outputPath);
    report({ phase: "done", frame: frames, seconds: frames / fps });
    return {
      frames,
      seconds: frames / fps,
      bytes: output.size,
      audioSegments: mix.segments,
      speed: frames / Math.max(1e-3, loopSeconds),
      recording,
      scenes,
      warnings,
    };
  } catch (error) {
    if (signal?.aborted) throw new RenderError("Cancelled.");
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (browser) await browser.close().catch(() => undefined);
    if (encoder) await terminate(encoder, 300);
    await rm(options.workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
