/**
 * Turns the page's virtual audio timeline into one stereo mix and muxes it with the rendered
 * video. Sources are decoded once with ffmpeg; the mix itself happens in Node so that loops,
 * seeks, playback-rate changes and per-frame volume automation are reproduced exactly as the
 * page requested them, without building fragile filter graphs.
 */
import { once } from "node:events";
import type { AudioEvent } from "./virtual-clock";
import { probeMedia, run, spawnTracked, terminate } from "./processes";

export const SAMPLE_RATE = 48000;
const CHANNELS = 2;

export interface MediaSource {
  path: string;
  duration: number;
  hasAudio: boolean;
}

export interface AudioSegment {
  key: string;
  /** Mix time in seconds. */
  start: number;
  end: number;
  /** Source position (seconds) at `start`. */
  position: number;
  rate: number;
  loop: boolean;
  /** Stepwise volume automation; the first point is at `start`. */
  volume: { t: number; v: number }[];
}

interface ElementState {
  key: string;
  volume: number;
  rate: number;
  loop: boolean;
  position: number;
  open: AudioSegment | null;
}

/**
 * Volume points closer together than this are a fade the page drew frame by frame; the mix
 * interpolates between them instead of stepping once per video frame (no zipper noise).
 */
const FADE_GAP = 0.1;

/** The volume at `t`, given the index of the last point at or before it. Exported for tests. */
export function volumeAt(points: { t: number; v: number }[], index: number, t: number): number {
  const current = points[index];
  const next = points[index + 1];
  if (!next || next.t - current.t > FADE_GAP || next.t <= current.t) return current.v;
  const progress = Math.min(1, Math.max(0, (t - current.t) / (next.t - current.t)));
  return current.v + (next.v - current.v) * progress;
}

/** Reconstructs play runs from the event log. Exported for tests. */
export function buildSegments(
  events: AudioEvent[],
  totalSeconds: number,
): AudioSegment[] {
  const elements = new Map<number, ElementState>();
  const segments: AudioSegment[] = [];
  const sorted = events.slice().sort((a, b) => a.t - b.t);
  const close = (state: ElementState, at: number) => {
    if (!state.open) return;
    state.open.end = Math.min(at, totalSeconds);
    if (state.open.end - state.open.start > 0.0005) segments.push(state.open);
    state.open = null;
  };
  const open = (state: ElementState, at: number) => {
    if (!state.key) return;
    state.open = {
      key: state.key,
      start: at,
      end: at,
      position: state.position,
      rate: state.rate,
      loop: state.loop,
      volume: [{ t: at, v: state.volume }],
    };
  };
  for (const event of sorted) {
    const at = event.t / 1000;
    let state = elements.get(event.id);
    if (!state) {
      state = {
        key: event.key ?? "",
        volume: 1,
        rate: 1,
        loop: false,
        position: 0,
        open: null,
      };
      elements.set(event.id, state);
    }
    switch (event.type) {
      case "src":
        close(state, at);
        state.key = event.key ?? "";
        state.position = 0;
        state.rate = 1;
        break;
      case "play":
        if (state.open) break;
        state.key = event.key ?? state.key;
        state.position = event.position ?? state.position;
        if (typeof event.value === "number") state.volume = event.value;
        if (typeof event.rate === "number") state.rate = event.rate;
        if (typeof event.loop === "boolean") state.loop = event.loop;
        open(state, at);
        break;
      case "pause":
      case "ended":
      case "error":
        close(state, at);
        if (typeof event.position === "number") state.position = event.position;
        break;
      case "seek": {
        const wasOpen = !!state.open;
        close(state, at);
        state.position = event.position ?? 0;
        if (wasOpen) open(state, at);
        break;
      }
      case "rate": {
        const wasOpen = !!state.open;
        close(state, at);
        if (typeof event.position === "number") state.position = event.position;
        state.rate = event.rate ?? 1;
        if (wasOpen) open(state, at);
        break;
      }
      case "loop":
        state.loop = !!event.loop;
        if (state.open) state.open.loop = state.loop;
        break;
      case "volume":
        state.volume = Math.max(0, Math.min(1, event.value ?? 1));
        if (state.open) {
          const points = state.open.volume;
          const last = points[points.length - 1];
          if (last && Math.abs(last.t - at) < 1e-6) last.v = state.volume;
          else points.push({ t: at, v: state.volume });
        }
        break;
    }
  }
  for (const state of elements.values()) close(state, totalSeconds);
  return segments.sort((a, b) => a.start - b.start);
}

async function decode(
  ffmpeg: string,
  path: string,
  signal?: AbortSignal,
): Promise<Int16Array> {
  const result = await run(
    ffmpeg,
    [
      "-v",
      "error",
      "-nostdin",
      "-i",
      path,
      "-vn",
      "-f",
      "s16le",
      "-ac",
      String(CHANNELS),
      "-ar",
      String(SAMPLE_RATE),
      "pipe:1",
    ],
    { signal, maxStdout: 1024 * 1024 * 1024 },
  );
  if (result.code !== 0)
    throw new Error(
      `Audio could not be decoded: ${result.stderr.trim().split("\n").pop() ?? "ffmpeg failed"}`,
    );
  const bytes = result.stdout;
  const usable = bytes.length - (bytes.length % (2 * CHANNELS));
  return new Int16Array(bytes.buffer, bytes.byteOffset, usable / 2);
}

export interface MixOptions {
  ffmpeg: string;
  ffprobe: string;
  events: AudioEvent[];
  sources: Map<string, MediaSource>;
  /** Length of the video in seconds; the mix is trimmed or padded to it. */
  durationSeconds: number;
  videoPath: string;
  outputPath: string;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

export interface MixResult {
  segments: number;
  warnings: string[];
}

/** Mixes the timeline and writes the final MP4 (H.264 copied from `videoPath`, AAC 192k audio). */
export async function mixAndMux(options: MixOptions): Promise<MixResult> {
  const warnings: string[] = [];
  const total = Math.max(0.04, options.durationSeconds);
  const segments = buildSegments(options.events, total).filter((segment) => {
    const source = options.sources.get(segment.key);
    if (!source) {
      warnings.push(
        `An audio source could not be identified and was left out of the mix (${segment.key.slice(0, 80)}).`,
      );
      return false;
    }
    if (!source.hasAudio) return false;
    return true;
  });
  // Sources are decoded when first heard and released after their last use, so a long
  // chapter with hundreds of voice clips never holds them all in memory at once.
  const decoded = new Map<string, Int16Array>();
  const lastUse = new Map<string, number>();
  for (const segment of segments)
    lastUse.set(segment.key, Math.max(lastUse.get(segment.key) ?? 0, segment.end));
  const samplesFor = async (key: string) => {
    let samples = decoded.get(key);
    if (!samples) {
      if (options.signal?.aborted) throw new Error("Cancelled.");
      samples = await decode(options.ffmpeg, options.sources.get(key)!.path, options.signal);
      decoded.set(key, samples);
    }
    return samples;
  };
  const args = [
    "-y",
    "-v",
    "error",
    "-nostdin",
    "-i",
    options.videoPath,
    ...(segments.length
      ? [
          "-f",
          "f32le",
          "-ar",
          String(SAMPLE_RATE),
          "-ac",
          String(CHANNELS),
          "-i",
          "pipe:0",
        ]
      : [
          "-f",
          "lavfi",
          "-i",
          `anullsrc=r=${SAMPLE_RATE}:cl=stereo`,
        ]),
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    String(SAMPLE_RATE),
    "-t",
    total.toFixed(3),
    "-movflags",
    "+faststart",
    options.outputPath,
  ];
  const child = spawnTracked(options.ffmpeg, args, {
    stdio: [segments.length ? "pipe" : "ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr!.on("data", (chunk: Buffer) => {
    if (stderr.length < 64 * 1024) stderr += chunk.toString("utf8");
  });
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  });
  const onAbort = () => void terminate(child, 300);
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (segments.length) {
      const stdin = child.stdin!;
      stdin.on("error", () => undefined);
      const chunkSeconds = 2;
      const chunkFrames = chunkSeconds * SAMPLE_RATE;
      const buffer = new Float32Array(chunkFrames * CHANNELS);
      const totalFrames = Math.ceil(total * SAMPLE_RATE);
      const cursors = segments.map(() => 0);
      for (let frame0 = 0; frame0 < totalFrames; frame0 += chunkFrames) {
        if (options.signal?.aborted) throw new Error("Cancelled.");
        const frames = Math.min(chunkFrames, totalFrames - frame0);
        buffer.fill(0, 0, frames * CHANNELS);
        const chunkStart = frame0 / SAMPLE_RATE;
        const chunkEnd = (frame0 + frames) / SAMPLE_RATE;
        for (let index = 0; index < segments.length; index++) {
          const segment = segments[index];
          if (segment.start >= chunkEnd) break;
          if (segment.end <= chunkStart) continue;
          const samples = await samplesFor(segment.key);
          const sourceFrames = samples.length / CHANNELS;
          if (!sourceFrames) continue;
          const first = Math.max(frame0, Math.ceil(segment.start * SAMPLE_RATE));
          const last = Math.min(
            frame0 + frames,
            Math.ceil(segment.end * SAMPLE_RATE),
          );
          let cursor = cursors[index];
          const points = segment.volume;
          for (let frame = first; frame < last; frame++) {
            const t = frame / SAMPLE_RATE;
            while (cursor + 1 < points.length && points[cursor + 1].t <= t)
              cursor++;
            const volume = volumeAt(points, cursor, t);
            if (volume <= 0) continue;
            let sourceFrame = Math.floor(
              (segment.position + (t - segment.start) * segment.rate) *
                SAMPLE_RATE,
            );
            if (sourceFrame >= sourceFrames) {
              if (!segment.loop) break;
              sourceFrame %= sourceFrames;
            }
            if (sourceFrame < 0) continue;
            const out = (frame - frame0) * CHANNELS;
            const input = sourceFrame * CHANNELS;
            buffer[out] += (samples[input] / 32768) * volume;
            buffer[out + 1] += (samples[input + 1] / 32768) * volume;
          }
          cursors[index] = cursor;
        }
        for (const [key, end] of lastUse)
          if (end <= chunkEnd && decoded.has(key)) {
            decoded.delete(key);
            lastUse.delete(key);
          }
        for (let i = 0; i < frames * CHANNELS; i++) {
          const value = buffer[i];
          if (value > 1) buffer[i] = 1;
          else if (value < -1) buffer[i] = -1;
        }
        const bytes = Buffer.from(
          buffer.buffer,
          buffer.byteOffset,
          frames * CHANNELS * 4,
        );
        if (!stdin.write(Buffer.from(bytes))) await once(stdin, "drain");
        options.onProgress?.(Math.min(1, (frame0 + frames) / totalFrames));
      }
      stdin.end();
    }
    const code = await exit;
    if (code !== 0)
      throw new Error(
        options.signal?.aborted
          ? "Cancelled."
          : `The final MP4 could not be written: ${stderr.trim().split("\n").pop() ?? "ffmpeg failed"}`,
      );
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    if (child.exitCode === null && child.signalCode === null)
      await terminate(child, 300);
  }
  return { segments: segments.length, warnings };
}

export { probeMedia };
