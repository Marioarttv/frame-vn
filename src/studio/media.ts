import { blobToDataUrl, getAsset, isAssetRef, putAsset } from "../engine";
import type { ExportOptions } from "../engine/export";
import { registerAssetUrl } from "../engine/asset-urls";

const IMAGE_TYPES = ["image/png", "image/webp", "image/jpeg"];
const AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
];

/**
 * Checks a local image decodes, then stores it once in the browser asset store.
 * Returns an `asset:<hash>` reference that is already renderable through resolveAssetUrl.
 */
export async function importImage(file: File): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type))
    throw new Error("Choose a PNG, WebP, or JPEG image.");
  if (file.size > 12 * 1024 * 1024)
    throw new Error("Choose an image smaller than 12 MB.");
  const preview = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = preview;
    try {
      await image.decode();
    } catch {
      throw new Error(
        "This file could not be decoded as an image. Choose another file.",
      );
    }
    if (
      image.naturalWidth > 8192 ||
      image.naturalHeight > 8192 ||
      image.naturalWidth * image.naturalHeight > 32000000
    )
      throw new Error(
        "Use an image no larger than 8192 pixels per side and 32 megapixels.",
      );
  } finally {
    URL.revokeObjectURL(preview);
  }
  const ref = await putAsset(file, "image");
  registerAssetUrl(ref, file);
  return ref;
}

const VIDEO_TYPES = ["video/mp4", "video/webm"];

/** Reads a playable duration in seconds, or undefined when the browser cannot tell. */
function mediaDuration(
  blob: Blob,
  kind: "audio" | "video",
): Promise<number | undefined> {
  const preview = URL.createObjectURL(blob);
  return new Promise<number | undefined>((resolve, reject) => {
    const element = document.createElement(kind);
    const timer = setTimeout(() => resolve(undefined), 8000);
    element.preload = "metadata";
    element.muted = true;
    element.onloadedmetadata = () => {
      clearTimeout(timer);
      resolve(
        Number.isFinite(element.duration) ? element.duration : undefined,
      );
    };
    element.onerror = () => {
      clearTimeout(timer);
      reject(
        new Error(
          kind === "video"
            ? "This browser cannot play that video file."
            : "This browser cannot play that audio file.",
        ),
      );
    };
    element.src = preview;
  }).finally(() => URL.revokeObjectURL(preview));
}

/**
 * A looping, silent background video (MP4 or WebM). Short loops keep exports small;
 * the player mutes and loops them.
 */
export async function importVideo(file: File): Promise<string> {
  if (!VIDEO_TYPES.includes(file.type))
    throw new Error("Choose an MP4 or WebM video.");
  if (file.size > 40 * 1024 * 1024)
    throw new Error(
      "Choose a video smaller than 40 MB. Short, quiet loops of 10–20 seconds work best.",
    );
  await mediaDuration(file, "video");
  const ref = await putAsset(file, "video");
  registerAssetUrl(ref, file);
  return ref;
}

/** Imports an image or a video as a background, keeping the kind the player needs. */
export async function importBackgroundMedia(
  file: File,
): Promise<{ src: string; kind?: "video" }> {
  if (VIDEO_TYPES.includes(file.type))
    return { src: await importVideo(file), kind: "video" };
  return { src: await importImage(file) };
}

export const BACKGROUND_ACCEPT = [...IMAGE_TYPES, ...VIDEO_TYPES].join(",");

/** Imports recorded dialogue with its length, so text can reveal in step with it. */
export async function importRecording(
  file: File,
): Promise<{ src: string; duration?: number }> {
  const src = await importAudio(file);
  const duration = await mediaDuration(file, "audio").catch(() => undefined);
  return { src, duration };
}

/** Stores music, sound effects or recorded dialogue after checking the browser can decode it. */
export async function importAudio(file: File): Promise<string> {
  const type = file.type || (file.name.endsWith(".mp3") ? "audio/mpeg" : "");
  if (!AUDIO_TYPES.includes(type))
    throw new Error("Choose an MP3, OGG, WAV, M4A, AAC, WebM or FLAC file.");
  if (file.size > 40 * 1024 * 1024)
    throw new Error("Choose an audio file smaller than 40 MB.");
  const blob = type === file.type ? file : new Blob([file], { type });
  const preview = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      const audio = new Audio();
      const timer = setTimeout(() => resolve(), 8000);
      audio.preload = "metadata";
      audio.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve();
      };
      audio.onerror = () => {
        clearTimeout(timer);
        reject(new Error("This browser cannot play that audio file."));
      };
      audio.src = preview;
    });
  } finally {
    URL.revokeObjectURL(preview);
  }
  const ref = await putAsset(blob, "audio");
  registerAssetUrl(ref, blob);
  return ref;
}

/** A readable default name from a file name, e.g. "night_market.png" → "night market". */
export function nameFromFile(file: File, fallback: string): string {
  return (
    file.name
      .replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ")
      .trim()
      .slice(0, 120) || fallback
  );
}

/** Game export embeds asset-store media from this browser; other URLs use the default download. */
export const studioExportOptions: ExportOptions = {
  resolveAsset: async (src) => {
    if (!isAssetRef(src)) return undefined;
    const asset = await getAsset(src);
    if (!asset)
      throw new Error("A project file is missing from this browser's storage.");
    return blobToDataUrl(asset.blob);
  },
};

export function download(
  name: string,
  data: string,
  mime = "application/json",
) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function fileSlug(title: string, fallback = "story"): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || fallback
  );
}
