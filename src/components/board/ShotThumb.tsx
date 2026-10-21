import { memo } from "react";
import { shotActors, type Project, type StoryNode } from "../../engine";
import { resolveAssetUrl } from "../../engine/asset-urls";
import { poseOf } from "./faces";

/**
 * A still of one shot composed from the same numbers the player uses: background, then
 * everyone on stage at their position, height and depth. Cheap enough for a whole filmstrip.
 */
export const ShotThumb = memo(function ShotThumb({
  project,
  node,
}: {
  project: Project;
  node: StoryNode;
}) {
  const background = project.backgrounds.find((item) => item.id === node.backgroundId);
  const src = resolveAssetUrl(background?.src);
  const actors = shotActors(node);
  const someoneSpeaks = actors.some((actor) => actor.speaking);
  const zoom = node.camera?.zoom ?? 1;
  // Same framing maths as the player's camera (stage.ts).
  const clamp = (value: number) => Math.min(0, Math.max(100 - 100 * zoom, value));
  const camera =
    zoom > 1.001
      ? `translate(${clamp(50 - (node.camera!.x ?? 50) * zoom)}%, ${clamp(50 - (node.camera!.y ?? 50) * zoom)}%) scale(${zoom})`
      : undefined;
  return (
    <span className={`shot-thumb ${node.grade ? `grade-${node.grade}` : ""}`} aria-hidden="true">
      <span className="shot-camera" style={camera ? { transform: camera } : undefined}>
      {src &&
        (background?.kind === "video" ? (
          <video src={src} muted preload="metadata" className="shot-bg" />
        ) : (
          <img src={src} alt="" className="shot-bg" loading="lazy" decoding="async" draggable={false} />
        ))}
      {actors.map((actor) => {
        const character = project.characters.find((item) => item.id === actor.characterId);
        const pose = poseOf(character, actor.poseId);
        const scale = actor.scale ?? 1;
        return (
          <span
            key={actor.characterId}
            className={`shot-actor ${someoneSpeaks && !actor.speaking ? "is-listening" : ""}`}
            style={{
              left: `${actor.position}%`,
              transform: `translate(-50%, ${actor.y ?? 0}%) scale(${scale})`,
              zIndex: Math.round(scale * 100) * 2 + (actor.speaking ? 1 : 0),
            }}
          >
            {pose && (
              <img
                src={resolveAssetUrl(pose.src)}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
                style={actor.flip ? { transform: "scaleX(-1)" } : undefined}
              />
            )}
          </span>
        );
      })}
      </span>
      {node.weather && <span className={`shot-weather weather-${node.weather}`} />}
    </span>
  );
});
