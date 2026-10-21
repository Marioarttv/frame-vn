import { execFile } from "node:child_process";
import {
  access,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { createHash } from "node:crypto";

const run = promisify(execFile);
export type MouthShape = "A" | "B" | "C" | "D" | "E" | "F" | "X";
export interface MouthCue {
  start: number;
  end: number;
  value: MouthShape;
}
export interface CueSheet {
  metadata: {
    duration: number;
    soundFile: string;
    generator: string;
    recognizer: string;
    extendedShapes: "X";
    sourceSha256: string;
    transcriptSha256: string;
    silenceGate: { thresholdDb: number; minimumSeconds: number };
  };
  mouthCues: MouthCue[];
}
export interface AlignmentInput {
  audioPath: string;
  audioSrc: string;
  text: string;
  languageCode?: string;
}
export interface Executables {
  ffmpeg: string;
  ffprobe: string;
  rhubarb: string;
}
export interface RhubarbReadiness {
  ready: boolean;
  message?: string;
}

/** A version banner does not exercise recognition resources; this tiny local probe does. */
export async function probeRhubarb(
  executable: string,
): Promise<RhubarbReadiness> {
  const directory = await mkdtemp(join(tmpdir(), "frame-rhubarb-probe-"));
  try {
    let binary: string | undefined;
    const candidates = executable.includes("/")
      ? [resolve(executable)]
      : (process.env.PATH ?? "")
          .split(delimiter)
          .map((part) => join(part, executable));
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.X_OK);
        binary = await realpath(candidate);
        break;
      } catch {
        /* Continue searching PATH. */
      }
    }
    if (!binary)
      return {
        ready: false,
        message: "Rhubarb Lip Sync is not executable. Check RHUBARB_PATH.",
      };
    for (const resource of [
      "res/sphinx/cmudict-en-us.dict",
      "res/sphinx/acoustic-model/mdef",
      "res/sphinx/acoustic-model/means",
      "res/sphinx/acoustic-model/variances",
    ]) {
      const available = await stat(join(dirname(binary), resource)).then(
        (info) => info.isFile() && info.size > 0,
        () => false,
      );
      if (!available)
        return {
          ready: false,
          message: `Rhubarb is missing ${resource}. Keep the complete res/ folder beside its executable.`,
        };
    }
    const samples = 16000,
      bytes = Buffer.alloc(44 + samples * 2);
    bytes.write("RIFF", 0);
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write("WAVEfmt ", 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(16000, 24);
    bytes.writeUInt32LE(32000, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write("data", 36);
    bytes.writeUInt32LE(samples * 2, 40);
    // Pure silence bypasses recognition in Rhubarb. Voiced harmonics force the acoustic model to initialize.
    for (let i = 0; i < samples; i++) {
      const t = i / 16000,
        envelope = Math.sin(Math.PI * t) ** 2;
      const signal =
        6000 * Math.sin(2 * Math.PI * 180 * t) +
        3500 * Math.sin(2 * Math.PI * 540 * t) +
        1500 * Math.sin(2 * Math.PI * 900 * t);
      bytes.writeInt16LE(Math.round(envelope * signal), 44 + i * 2);
    }
    const wav = join(directory, "voiced-probe.wav"),
      transcript = join(directory, "hint.txt");
    await writeFile(wav, bytes, { mode: 0o600 });
    await writeFile(transcript, "test", { mode: 0o600 });
    const output = await run(
      executable,
      [
        "-q",
        "--threads",
        "1",
        "-r",
        "pocketSphinx",
        "-f",
        "json",
        "--extendedShapes",
        "X",
        "-d",
        transcript,
        wav,
      ],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    const sheet = JSON.parse(output.stdout);
    validateCues(sheet.mouthCues, Number(sheet.metadata?.duration));
    return { ready: true };
  } catch {
    return {
      ready: false,
      message:
        "Rhubarb could not run PocketSphinx recognition. Keep its complete res/ folder beside the executable, or point RHUBARB_PATH at a complete distribution.",
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Preserve the recognizer's phoneme boundaries; close only measured silent intervals. */
export function gateSilence(
  cues: MouthCue[],
  duration: number,
  log: string,
): MouthCue[] {
  const silences = [
    ...log.matchAll(/silence_start: ([-\d.]+)[\s\S]*?silence_end: ([\d.]+)/g),
  ].map((match) => [
    Math.max(0, Number(match[1])),
    Math.min(duration, Number(match[2])),
  ]);
  const boundaries = [
    ...new Set([
      0,
      duration,
      ...cues.flatMap((cue) => [cue.start, cue.end]),
      ...silences.flat(),
    ]),
  ]
    .filter((time) => time >= 0 && time <= duration)
    .sort((a, b) => a - b);
  const output: MouthCue[] = [];
  for (let i = 1; i < boundaries.length; i++) {
    const start = boundaries[i - 1],
      end = boundaries[i],
      middle = (start + end) / 2;
    const value = silences.some(([a, b]) => a <= middle && middle < b)
      ? "X"
      : (cues.find((cue) => cue.start <= middle && middle < cue.end)?.value ??
        "X");
    const previous = output.at(-1);
    if (previous?.value === value) previous.end = end;
    else output.push({ start, end, value });
  }
  return output;
}

export function validateCues(
  cues: unknown,
  duration: number,
): asserts cues is MouthCue[] {
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Array.isArray(cues) ||
    !cues.length
  )
    throw new Error("Alignment returned an empty timeline.");
  let previous = 0;
  for (const cue of cues) {
    if (
      !cue ||
      !Number.isFinite(cue.start) ||
      !Number.isFinite(cue.end) ||
      cue.start < 0 ||
      cue.end <= cue.start ||
      Math.abs(cue.start - previous) > 0.011 ||
      cue.end > duration + 0.011 ||
      !/^[ABCDEFX]$/.test(cue.value)
    ) {
      throw new Error("Alignment returned an invalid phoneme timeline.");
    }
    previous = cue.end;
  }
  if (Math.abs(previous - duration) > 0.011)
    throw new Error("Alignment does not cover the complete audio.");
}

export async function alignAudio(
  input: AlignmentInput,
  executables: Executables,
): Promise<CueSheet> {
  const directory = await mkdtemp(join(tmpdir(), "frame-alignment-"));
  try {
    const wav = join(directory, "audio.wav"),
      transcriptPath = join(directory, "dialogue.txt"),
      cuePath = join(directory, "cues.json");
    // Direction tags guide performance and are not spoken words for the recognizer.
    const transcript = input.text
      .replace(/\[[^\]\r\n]*\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    await writeFile(transcriptPath, transcript, { mode: 0o600 });
    const decoded = await run(
      executables.ffmpeg,
      [
        "-nostdin",
        "-hide_banner",
        "-y",
        "-i",
        input.audioPath,
        "-af",
        "silencedetect=noise=-45dB:d=0.20",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        wav,
      ],
      { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const measured = await run(
      executables.ffprobe,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        wav,
      ],
      { timeout: 15_000 },
    );
    // PocketSphinx uses an English language model. Phonetic recognition supports other languages without pretending they are English.
    const recognizer =
      input.languageCode && input.languageCode !== "en"
        ? "phonetic"
        : "pocketSphinx";
    await run(
      executables.rhubarb,
      [
        "-q",
        "--threads",
        "2",
        "-r",
        recognizer,
        "-f",
        "json",
        "--extendedShapes",
        "X",
        "-d",
        transcriptPath,
        "-o",
        cuePath,
        wav,
      ],
      { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const raw = JSON.parse(await readFile(cuePath, "utf8"));
    const duration = Number(raw.metadata?.duration);
    validateCues(raw.mouthCues, duration);
    if (Math.abs(duration - Number(measured.stdout.trim())) > 0.04)
      throw new Error("Alignment duration does not match decoded audio.");
    const mouthCues = gateSilence(raw.mouthCues, duration, decoded.stderr);
    validateCues(mouthCues, duration);
    const hash = (data: string | Buffer) =>
      createHash("sha256").update(data).digest("hex");
    return {
      metadata: {
        duration,
        soundFile: input.audioSrc,
        generator: "Rhubarb Lip Sync",
        recognizer,
        extendedShapes: "X",
        sourceSha256: hash(await readFile(input.audioPath)),
        transcriptSha256: hash(transcript),
        silenceGate: { thresholdDb: -45, minimumSeconds: 0.2 },
      },
      mouthCues,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
