import { useEffect, useState } from "react";
import type { Character, Pose } from "../../engine";
import { resolveAssetUrl } from "../../engine/asset-urls";

/** Where a portrait's face sits, as fractions of the image, and how far to zoom in on it. */
interface Focus {
  x: number;
  y: number;
  zoom: number;
}
const DEFAULT_FOCUS: Focus = { x: 0.5, y: 0.3, zoom: 1.7 };
const focusCache = new Map<string, Promise<Focus>>();

/** Rigged portraits know where their mouth is; the face sits just above it. */
function rigFocus(pose: Pose): Promise<Focus> {
  const animation = pose.animation;
  if (!animation) return Promise.resolve(DEFAULT_FOCUS);
  const key = `${animation.manifestUrl}#${animation.poseKey}`;
  let request = focusCache.get(key);
  if (!request) {
    request = fetch(resolveAssetUrl(animation.manifestUrl))
      .then((response) => (response.ok ? response.json() : null))
      .then((manifest) => {
        const sprite = manifest?.sprites?.[animation.poseKey];
        const mouth = sprite?.mouth;
        if (!mouth || !sprite.sourceWidth || !sprite.sourceHeight) return DEFAULT_FOCUS;
        return {
          x: (mouth.x + mouth.width / 2) / sprite.sourceWidth,
          y: Math.max(0.1, (mouth.y + mouth.height / 2) / sprite.sourceHeight - 0.08),
          zoom: 2.6,
        };
      })
      .catch(() => DEFAULT_FOCUS);
    focusCache.set(key, request);
  }
  return request;
}

function useFocus(pose?: Pose): Focus {
  const [focus, setFocus] = useState(DEFAULT_FOCUS);
  useEffect(() => {
    let active = true;
    if (pose) void rigFocus(pose).then((value) => active && setFocus(value));
    return () => {
      active = false;
    };
  }, [pose]);
  return focus;
}

export const poseOf = (character: Character | undefined, poseId?: string) =>
  character?.poses.find((pose) => pose.id === poseId) ?? character?.poses[0];

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** A close crop of one expression's face, for avatars and expression pickers. */
export function FaceThumb({
  character,
  pose,
  className = "",
}: {
  character?: Character;
  pose?: Pose;
  className?: string;
}) {
  const focus = useFocus(pose);
  const src = resolveAssetUrl(pose?.src);
  return (
    <span
      className={`face-thumb ${className}`}
      style={{ ["--tint" as string]: character?.color ?? "#6b7a72" }}
      aria-hidden="true"
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          style={{
            transformOrigin: `${focus.x * 100}% ${focus.y * 100}%`,
            transform: `translate(${(0.5 - focus.x) * 100}%, ${(0.5 - focus.y) * 100}%) scale(${focus.zoom})`,
          }}
        />
      ) : (
        <b>{character ? initials(character.name) : "N"}</b>
      )}
    </span>
  );
}
