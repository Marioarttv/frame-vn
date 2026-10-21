/**
 * Child-process helpers for the video renderer: executable discovery, tracked spawning so that
 * nothing outlives the studio server, and small ffprobe/ffmpeg wrappers.
 */
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";

const KNOWN_LOCATIONS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Honours FFMPEG_PATH/FFPROBE_PATH, then PATH, then the usual Homebrew and system locations. */
export async function findExecutable(
  name: "ffmpeg" | "ffprobe",
  explicit?: string,
): Promise<string> {
  const candidates: string[] = [];
  const env = process.env[name === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"];
  if (explicit) candidates.push(explicit);
  if (env) candidates.push(env);
  for (const directory of [
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean),
    ...KNOWN_LOCATIONS,
  ])
    candidates.push(join(directory, name));
  for (const candidate of candidates)
    if (await executable(candidate)) return candidate;
  throw new Error(
    `${name} was not found. Install FFmpeg (for example \`brew install ffmpeg\`) or set ${name === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"}.`,
  );
}

const children = new Set<ChildProcess>();
let exitHookInstalled = false;
function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const killAll = () => {
    for (const child of children) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  };
  process.once("exit", killAll);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.once(signal, () => {
      killAll();
      process.exit(0);
    });
}

/** Spawns a process that is killed if the server exits for any reason. */
export function spawnTracked(
  command: string,
  args: string[],
  options: SpawnOptions = {},
): ChildProcess {
  installExitHook();
  const child = spawn(command, args, options);
  children.add(child);
  child.once("exit", () => children.delete(child));
  child.once("error", () => children.delete(child));
  return child;
}

/** Kills a child (SIGTERM, then SIGKILL) and resolves when it has exited. */
export async function terminate(child: ChildProcess, graceMs = 1500): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, graceMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

export interface RunResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
}

/** Runs a command to completion, buffering stdout (binary) and stderr (text, capped). */
export function run(
  command: string,
  args: string[],
  options: { signal?: AbortSignal; stdin?: Buffer; maxStdout?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawnTracked(command, args, {
      stdio: [options.stdin ? "pipe" : "ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    let size = 0;
    let stderr = "";
    let failed: Error | undefined;
    const onAbort = () => {
      failed = new Error("Cancelled.");
      void terminate(child, 300);
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout!.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (options.maxStdout && size > options.maxStdout) {
        failed = new Error(`${command} produced more output than expected.`);
        void terminate(child, 300);
        return;
      }
      stdout.push(chunk);
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      options.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.once("close", (code) => {
      options.signal?.removeEventListener("abort", onAbort);
      if (failed) reject(failed);
      else resolve({ code, stdout: Buffer.concat(stdout), stderr });
    });
    if (options.stdin) child.stdin!.end(options.stdin);
  });
}

export interface MediaInfo {
  duration: number;
  hasAudio: boolean;
  hasVideo: boolean;
  width?: number;
  height?: number;
  frames?: number;
  audioDuration?: number;
  sampleRate?: number;
}

/** Duration and stream layout of a media file. */
export async function probeMedia(
  ffprobe: string,
  path: string,
  signal?: AbortSignal,
): Promise<MediaInfo> {
  const result = await run(
    ffprobe,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,width,height,nb_frames,duration,sample_rate",
      "-of",
      "json",
      path,
    ],
    { signal, maxStdout: 4 * 1024 * 1024 },
  );
  if (result.code !== 0)
    throw new Error(
      `ffprobe could not read the media: ${result.stderr.trim().split("\n").pop() ?? "unknown error"}`,
    );
  const data = JSON.parse(result.stdout.toString("utf8")) as {
    format?: { duration?: string };
    streams?: {
      codec_type?: string;
      width?: number;
      height?: number;
      nb_frames?: string;
      duration?: string;
      sample_rate?: string;
    }[];
  };
  const streams = data.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const formatDuration = Number(data.format?.duration);
  const duration = Number.isFinite(formatDuration)
    ? formatDuration
    : Number(audio?.duration ?? video?.duration ?? NaN);
  return {
    duration,
    hasAudio: !!audio,
    hasVideo: !!video,
    width: video?.width,
    height: video?.height,
    frames: video?.nb_frames ? Number(video.nb_frames) : undefined,
    audioDuration: audio?.duration ? Number(audio.duration) : undefined,
    sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : undefined,
  };
}
