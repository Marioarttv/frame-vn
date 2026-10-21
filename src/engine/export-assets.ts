import type { Project } from "./types";
import { isSafeAssetUrl, requireValidProject } from "./validation";
import { parseMarkup } from "./markup";

export interface ExportOptions {
  /**
   * Host/test resolver. It must return a supported data URL, or undefined to use the default
   * same-origin download. Asset-store references (`asset:<hash>`) always need a resolver.
   */
  resolveAsset?: (src: string) => Promise<string | undefined>;
  /** Explicitly permit downloading assets hosted on other origins during export. */
  allowExternalAssets?: boolean;
  /**
   * Extra CSS appended to the player's style: a production's own look (glyph speed, a soft
   * edge on one character) without patching the runtime.
   */
  styles?: string;
}

type AssetKind = "image" | "audio" | "video" | "json";
type JsonObject = Record<string, unknown>;
const EXTENSIONS: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  aac: "audio/aac",
  webm: "audio/webm",
  flac: "audio/flac",
  json: "application/json",
};

function mimeFor(src: string): string {
  return (
    EXTENSIONS[src.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? ""] ??
    "application/octet-stream"
  );
}

function toDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return `data:${mime};base64,${btoa(binary)}`;
}

function jsonData(value: unknown): string {
  return toDataUrl(
    new TextEncoder().encode(JSON.stringify(value)),
    "application/json",
  );
}

function decodeJson(data: string): unknown {
  const separator = data.indexOf(",");
  const payload = data.slice(separator + 1);
  const text = data.slice(0, separator).includes(";base64")
    ? new TextDecoder().decode(
        Uint8Array.from(atob(payload), (character) => character.charCodeAt(0)),
      )
    : decodeURIComponent(payload);
  return JSON.parse(text);
}

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function audioKey(src: string): string {
  let value = src.split(/[?#]/)[0];
  try {
    value = decodeURIComponent(value);
  } catch {
    /* Keep malformed escapes comparable without throwing. */
  }
  const position = value.indexOf("/audio/");
  return position >= 0 ? value.slice(position) : value;
}

async function fetchAsset(
  src: string,
  allowExternalAssets: boolean,
): Promise<string> {
  if (src.startsWith("data:")) return src;
  const currentOrigin = globalThis.location?.origin;
  if (
    /^https?:/i.test(src) &&
    !allowExternalAssets &&
    (!currentOrigin || new URL(src).origin !== currentOrigin)
  )
    throw new Error(
      "A remote asset needs permission to be included. Import the asset into your project or enable external asset export.",
    );
  const response = await fetch(src, {
    credentials: "same-origin",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`Asset request failed (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 150 * 1024 * 1024)
    throw new Error("An individual asset exceeds the 150 MB export limit.");
  const mime =
    response.headers.get("content-type")?.split(";")[0].trim() || mimeFor(src);
  return toDataUrl(bytes, mime);
}

/** Select only the current story's artwork and animation dependency closure. */
export async function prepareExportAssets(
  input: Project,
  options: ExportOptions = {},
): Promise<{ project: Project; assets: Record<string, string> }> {
  const source = requireValidProject(input);
  // Speakers and non-speaking cast both appear on stage.
  const appearances = source.nodes.flatMap((node) => [
    ...(node.characterId
      ? [{ characterId: node.characterId, poseId: node.poseId }]
      : []),
    ...(node.cast ?? []),
  ]);
  // A speaker's {expression=…} tags name more poses that must travel with the export.
  for (const node of source.nodes) {
    if (!node.characterId || !node.text.includes("{")) continue;
    const speaker = source.characters.find((item) => item.id === node.characterId);
    for (const item of parseMarkup(node.text).items) {
      if (item.kind !== "event" || item.event.type !== "expression") continue;
      const ref = item.event.value;
      const pose = speaker?.poses.find(
        (candidate) =>
          candidate.id === ref || candidate.name.toLowerCase() === ref.toLowerCase(),
      );
      if (pose) appearances.push({ characterId: node.characterId, poseId: pose.id });
    }
  }
  const usedCharacters = new Set(appearances.map((item) => item.characterId));
  // Inline {sfx=…} direction can name a sound by ID or name.
  const inlineSounds = source.nodes.flatMap((node) =>
    node.text.includes("{")
      ? parseMarkup(node.text).items.flatMap((item) =>
          item.kind === "event" && item.event.type === "sfx"
            ? [item.event.value.toLowerCase()]
            : [],
        )
      : [],
  );
  const usedSounds = new Set([
    ...source.nodes
      .flatMap((node) => [node.musicId, node.ambienceId, node.sfxId])
      .filter((id): id is string => !!id),
    ...source.sounds
      .filter(
        (sound) =>
          inlineSounds.includes(sound.id.toLowerCase()) ||
          inlineSounds.includes(sound.name.toLowerCase()),
      )
      .map((sound) => sound.id),
  ]);
  const usedBackgrounds = new Set(
    source.nodes.map((node) => node.backgroundId).filter(Boolean),
  );
  const project: Project = {
    ...source,
    characters: source.characters
      .filter((character) => usedCharacters.has(character.id))
      .map((character) => {
        const usedPoses = new Set(
          appearances
            .filter((item) => item.characterId === character.id)
            .map((item) => item.poseId ?? character.poses[0].id),
        );
        return {
          id: character.id,
          name: character.name,
          color: character.color,
          description: character.description,
          voiceId: character.voiceId,
          ...(character.expressionChange ? { expressionChange: character.expressionChange } : {}),
          poses: character.poses
            .filter((pose) => usedPoses.has(pose.id))
            .map((pose) => structuredClone(pose)),
        };
      }),
    backgrounds: source.backgrounds
      .filter((background) => usedBackgrounds.has(background.id))
      .map((background) => ({ ...background })),
    sounds: source.sounds
      .filter((sound) => usedSounds.has(sound.id))
      .map((sound) => ({ ...sound })),
    nodes: source.nodes.map((node) => structuredClone(node)),
  };
  const selectedByManifest = new Map<string, Set<string>>();
  const selectedByBrows = new Map<string, Set<string>>();
  const roots = new Set<string>();
  for (const character of project.characters)
    for (const pose of character.poses)
      if (pose.animation) {
        const animation = pose.animation;
        roots.add(animation.assetRoot.replace(/\/$/, "") + "/");
        if (!selectedByManifest.has(animation.manifestUrl))
          selectedByManifest.set(animation.manifestUrl, new Set());
        selectedByManifest.get(animation.manifestUrl)!.add(animation.poseKey);
        if (animation.browsIndexUrl) {
          if (!selectedByBrows.has(animation.browsIndexUrl))
            selectedByBrows.set(animation.browsIndexUrl, new Set());
          selectedByBrows.get(animation.browsIndexUrl)!.add(animation.poseKey);
        }
      }
  const usedAudioKeys = new Set(
    project.nodes
      .filter((node) => node.audioSrc)
      .map((node) => audioKey(node.audioSrc!)),
  );
  const assets: Record<string, string> = Object.create(null);
  const cache = new Map<string, Promise<string>>();
  const visited = new Set<string>();
  let totalLength = 0;
  const raw = async (src: string, kind: AssetKind): Promise<string> => {
    if (!isSafeAssetUrl(src, kind))
      throw new Error(`Unsafe ${kind} asset URL.`);
    if (!cache.has(src))
      cache.set(
        src,
        src.startsWith("data:")
          ? Promise.resolve(src)
          : Promise.resolve(options.resolveAsset?.(src)).then((resolved) => {
              if (resolved !== undefined) return resolved;
              if (src.startsWith("asset:"))
                throw new Error(
                  "This media is stored in the studio and is not available.",
                );
              return fetchAsset(src, !!options.allowExternalAssets);
            }),
      );
    const embedded = await cache.get(src)!;
    if (!embedded.startsWith("data:") || !isSafeAssetUrl(embedded, kind))
      throw new Error(`The asset is not a supported ${kind} data URL.`);
    return embedded;
  };
  const selectJson = (src: string, data: unknown): unknown => {
    const object = asObject(data);
    if (!object) throw new Error("Animation data must contain a JSON object.");
    const selectedPoses = selectedByManifest.get(src);
    if (selectedPoses) {
      const sprites = asObject(object.sprites);
      if (
        !sprites ||
        [...selectedPoses].some((key) => !Object.hasOwn(sprites, key))
      )
        throw new Error("Animation manifest is missing a selected pose.");
      object.sprites = Object.fromEntries(
        Object.entries(sprites).filter(([key]) => selectedPoses.has(key)),
      );
    }
    const browPoses = selectedByBrows.get(src);
    if (browPoses) {
      const poses = asObject(object.poses);
      if (!poses) throw new Error("The brow index is invalid.");
      object.poses = Object.fromEntries(
        Object.entries(poses).filter(([key]) => browPoses.has(key)),
      );
    }
    const lines = asObject(object.lines);
    if (lines)
      object.lines = Object.fromEntries(
        Object.entries(lines).filter(([key]) =>
          usedAudioKeys.has(audioKey(key)),
        ),
      );
    return object;
  };
  const embeddedReferences = (
    data: unknown,
  ): { src: string; kind: AssetKind }[] => {
    const found = new Map<string, AssetKind>();
    const walk = (value: unknown, depth = 0) => {
      if (depth > 100) throw new Error("Animation data is nested too deeply.");
      if (
        typeof value === "string" &&
        [...roots].some((root) => value.startsWith(root))
      ) {
        const mime = mimeFor(value);
        const kind = mime.startsWith("image/")
          ? "image"
          : mime.startsWith("audio/")
            ? "audio"
            : mime === "application/json"
              ? "json"
              : undefined;
        if (kind) found.set(value, kind);
      } else if (value && typeof value === "object")
        for (const child of Object.values(value)) walk(child, depth + 1);
    };
    walk(data);
    return [...found].map(([src, kind]) => ({ src, kind }));
  };
  const embed = async (src: string, kind: AssetKind): Promise<void> => {
    if (visited.has(src)) return;
    visited.add(src);
    if (visited.size > 2500)
      throw new Error(
        "This export references more than 2,500 assets. Split the story into smaller projects.",
      );
    try {
      let embedded = await raw(src, kind);
      let references: { src: string; kind: AssetKind }[] = [];
      if (kind === "json") {
        const selected = selectJson(src, decodeJson(embedded));
        embedded = jsonData(selected);
        references = embeddedReferences(selected);
      }
      totalLength += embedded.length;
      if (totalLength > 400 * 1024 * 1024)
        throw new Error(
          "The embedded export exceeds 400 MB. Use fewer or smaller assets.",
        );
      if (!src.startsWith("data:")) assets[src] = embedded;
      for (const reference of references)
        await embed(reference.src, reference.kind);
    } catch (error) {
      const name = src.startsWith("data:")
        ? "embedded asset"
        : src.split(/[?#]/)[0].slice(-120);
      throw new Error(
        `Could not embed ${name}: ${error instanceof Error ? error.message : "asset unavailable"}`,
      );
    }
  };
  for (const character of project.characters)
    for (const pose of character.poses) {
      await embed(pose.src, "image");
      if (pose.animation) {
        await embed(pose.animation.manifestUrl, "json");
        await embed(pose.animation.speechIndexUrl, "json");
        if (pose.animation.browsIndexUrl)
          await embed(pose.animation.browsIndexUrl, "json");
        if (pose.animation.lightingUrl)
          await embed(pose.animation.lightingUrl, "json");
      }
      if (pose.rig) await embed(pose.rig, "json");
    }
  for (const background of project.backgrounds)
    await embed(background.src, background.kind === "video" ? "video" : "image");
  for (const sound of project.sounds) await embed(sound.src, "audio");
  for (const node of project.nodes) {
    if (node.audioSrc) await embed(node.audioSrc, "audio");
    if (node.cueUrl) await embed(node.cueUrl, "json");
  }
  return { project, assets };
}
