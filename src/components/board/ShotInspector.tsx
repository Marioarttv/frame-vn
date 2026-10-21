import { useRef, useState } from "react";
import { ChevronDown, Crosshair, ExternalLink, ImagePlus, Maximize, Play } from "lucide-react";
import {
  BACKGROUND_MOTIONS,
  BACKGROUND_MOTION_LABELS,
  GRADES,
  GRADE_LABELS,
  MAX_CAMERA_ZOOM,
  WEATHERS,
  WEATHER_LABELS,
  projectTheme,
  type NodeBase,
  type Project,
  type StoryNode,
} from "../../engine";
import { resolveAssetUrl } from "../../engine/asset-urls";
import { BACKGROUND_ACCEPT } from "../../studio/media";
import { TextEffectPicker, TextboxPicker, TransitionPicker } from "./pickers";

interface Props {
  project: Project;
  node: StoryNode;
  isFirst: boolean;
  onPatch: (patch: Partial<NodeBase>, discrete?: boolean) => void;
  onImportBackground: (file: File) => void;
  onOpenInSceneBuilder: () => void;
}

function Section({
  title,
  note,
  open = true,
  children,
}: {
  title: string;
  note?: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(open);
  return (
    <section className={`inspector-section ${expanded ? "" : "is-collapsed"}`}>
      <button className="section-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <h4>
          {title}
          {note && <span className="inspector-note">{note}</span>}
        </h4>
        <ChevronDown size={14} />
      </button>
      {expanded && children}
    </section>
  );
}

/** Everything about a shot except the people in it. */
export function ShotInspector({ project, node, isFirst, onPatch, onImportBackground, onOpenInSceneBuilder }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const theme = projectTheme(project);
  const camera = node.camera ?? { zoom: 1, x: 50, y: 45 };
  const setCamera = (patch: Partial<typeof camera>) => {
    const next = { ...camera, ...patch };
    onPatch({ camera: next.zoom <= 1.001 ? undefined : next });
  };
  const musicTracks = project.sounds.filter((sound) => sound.kind === "music");
  const ambienceBeds = project.sounds.filter((sound) => sound.kind === "ambience");
  const effects = project.sounds.filter((sound) => sound.kind === "sfx");
  return (
    <div className="inspector">
      <div className="inspector-shot-head">
        <label>
          <span className="inspector-kicker">Shot name</span>
          <input
            value={node.label}
            maxLength={120}
            onChange={(event) => onPatch({ label: event.target.value })}
            placeholder="A chance encounter"
          />
        </label>
        {node.type !== "dialogue" && (
          <p className="inspector-callout">
            {node.type === "choice"
              ? `The player chooses between ${node.choices.length} path${node.choices.length === 1 ? "" : "s"} here.`
              : node.type === "branch"
                ? "An invisible branch: the story state decides where it goes."
                : "The story ends with this shot."}
            {node.type !== "end" && (
              <button onClick={onOpenInSceneBuilder}>
                <ExternalLink size={12} /> Edit paths in the scene builder
              </button>
            )}
          </p>
        )}
      </div>

      <Section title="Background">
        <div className="background-grid">
          <button
            className={!node.backgroundId ? "is-active" : ""}
            onClick={() => onPatch({ backgroundId: undefined }, true)}
            aria-label="Studio backdrop"
          >
            <span className="bg-swatch is-empty" />
            <span>Backdrop</span>
          </button>
          {project.backgrounds.map((background) => (
            <button
              key={background.id}
              className={node.backgroundId === background.id ? "is-active" : ""}
              onClick={() => onPatch({ backgroundId: background.id }, true)}
              aria-label={background.name}
              title={background.name}
            >
              {background.kind === "video" ? (
                <span className="bg-swatch">
                  <video src={resolveAssetUrl(background.src)} muted preload="metadata" />
                  <Play size={12} className="bg-video" fill="currentColor" />
                </span>
              ) : (
                <span className="bg-swatch">
                  <img src={resolveAssetUrl(background.src)} alt="" loading="lazy" decoding="async" />
                </span>
              )}
              <span>{background.name}</span>
            </button>
          ))}
          <button onClick={() => input.current?.click()} aria-label="Import background">
            <span className="bg-swatch is-import">
              <ImagePlus size={16} />
            </span>
            <span>Import</span>
          </button>
        </div>
        <input
          ref={input}
          type="file"
          hidden
          accept={BACKGROUND_ACCEPT}
          aria-label="Import a background image or video"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImportBackground(file);
            event.target.value = "";
          }}
        />
        <div className="board-chips" role="radiogroup" aria-label="Background motion">
          <button
            role="radio"
            aria-checked={!node.backgroundMotion}
            className={!node.backgroundMotion ? "is-active" : ""}
            onClick={() => onPatch({ backgroundMotion: undefined })}
          >
            Still
          </button>
          {BACKGROUND_MOTIONS.map((motion) => (
            <button
              key={motion}
              role="radio"
              aria-checked={node.backgroundMotion === motion}
              className={node.backgroundMotion === motion ? "is-active" : ""}
              onClick={() => onPatch({ backgroundMotion: motion })}
            >
              {BACKGROUND_MOTION_LABELS[motion]}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Transition in" note={isFirst ? "the story opens with it" : "from the shot before"}>
        <TransitionPicker
          value={node.transition ?? "cut"}
          onChange={(transition) => onPatch({ transition: transition === "cut" ? undefined : transition })}
        />
      </Section>

      <Section title="Atmosphere">
        <span className="inspector-label">Weather</span>
        <div className="board-chips" role="radiogroup" aria-label="Weather">
          <button role="radio" aria-checked={!node.weather} className={!node.weather ? "is-active" : ""} onClick={() => onPatch({ weather: undefined })}>
            Clear
          </button>
          {WEATHERS.map((weather) => (
            <button
              key={weather}
              role="radio"
              aria-checked={node.weather === weather}
              className={node.weather === weather ? "is-active" : ""}
              onClick={() => onPatch({ weather })}
            >
              {WEATHER_LABELS[weather]}
            </button>
          ))}
        </div>
        <span className="inspector-label">Colour grade</span>
        <div className="grade-grid" role="radiogroup" aria-label="Colour grade">
          <button role="radio" aria-checked={!node.grade} className={!node.grade ? "is-active" : ""} onClick={() => onPatch({ grade: undefined })}>
            <i className="grade-chip" />
            Natural
          </button>
          {GRADES.map((grade) => (
            <button
              key={grade}
              role="radio"
              aria-checked={node.grade === grade}
              className={node.grade === grade ? "is-active" : ""}
              onClick={() => onPatch({ grade })}
            >
              <i className={`grade-chip grade-${grade}`} />
              {GRADE_LABELS[grade]}
            </button>
          ))}
        </div>
        <span className="inspector-label">Impact</span>
        <div className="board-chips" role="radiogroup" aria-label="Impact">
          {(
            [
              [undefined, "Calm"],
              ["light", "Light shake"],
              ["heavy", "Heavy shake"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={label}
              role="radio"
              aria-checked={node.shake === value}
              className={node.shake === value ? "is-active" : ""}
              onClick={() => onPatch({ shake: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Camera" note={camera.zoom > 1.001 ? `${camera.zoom.toFixed(2)}×` : "wide"}>
        <div className="board-chips">
          <button className={!node.camera ? "is-active" : ""} onClick={() => onPatch({ camera: undefined })}>
            <Maximize size={12} /> Wide
          </button>
          <button
            disabled={!node.characterId}
            onClick={() => onPatch({ camera: { zoom: 1.4, x: node.position, y: 40 } })}
          >
            <Crosshair size={12} /> Close-up on speaker
          </button>
          <button
            disabled={!node.characterId}
            onClick={() => onPatch({ camera: { zoom: 2, x: node.position, y: 34 } })}
          >
            <Crosshair size={12} /> Extreme close-up
          </button>
        </div>
        <div className="board-sliders">
          <label>
            <span>Zoom</span>
            <input
              type="range"
              min="1"
              max={MAX_CAMERA_ZOOM}
              step="0.05"
              value={camera.zoom}
              aria-label="Camera zoom"
              onChange={(event) => setCamera({ zoom: Number(event.target.value) })}
            />
            <output>{camera.zoom.toFixed(2)}×</output>
          </label>
          <label>
            <span>Across</span>
            <input
              type="range"
              min="0"
              max="100"
              value={camera.x}
              disabled={camera.zoom <= 1.001}
              aria-label="Camera focus across"
              onChange={(event) => setCamera({ x: Number(event.target.value) })}
            />
            <output>{camera.x}%</output>
          </label>
          <label>
            <span>Height</span>
            <input
              type="range"
              min="0"
              max="100"
              value={camera.y}
              disabled={camera.zoom <= 1.001}
              aria-label="Camera focus height"
              onChange={(event) => setCamera({ y: Number(event.target.value) })}
            />
            <output>{camera.y}%</output>
          </label>
        </div>
      </Section>

      <Section title="Text box" note={node.textbox ? "this shot only" : "story default"}>
        <TextboxPicker value={node.textbox} inherited={theme.textbox} onChange={(textbox) => onPatch({ textbox })} />
        {node.textbox && (
          <button className="board-link" onClick={() => onPatch({ textbox: undefined })}>
            Use the story default
          </button>
        )}
      </Section>

      <Section title="Text effect" note={node.textEffect ? "this shot only" : "story default"}>
        <TextEffectPicker value={node.textEffect} inherited={theme.textEffect} onChange={(textEffect) => onPatch({ textEffect })} />
        {node.textEffect && (
          <button className="board-link" onClick={() => onPatch({ textEffect: undefined })}>
            Use the story default
          </button>
        )}
      </Section>

      <Section title="Sound" open={false}>
        <label className="board-field">
          <span>Music</span>
          <select
            value={node.musicId === null ? "__stop__" : (node.musicId ?? "")}
            onChange={(event) =>
              onPatch({
                musicId:
                  event.target.value === "__stop__" ? null : event.target.value || undefined,
              })
            }
          >
            <option value="">Keep the current music</option>
            <option value="__stop__">Stop the music</option>
            {musicTracks.map((track) => (
              <option key={track.id} value={track.id}>
                ♪ {track.name}
              </option>
            ))}
          </select>
        </label>
        {ambienceBeds.length > 0 && (
          <label className="board-field">
            <span>Ambience</span>
            <select
              value={node.ambienceId === null ? "__stop__" : (node.ambienceId ?? "")}
              onChange={(event) =>
                onPatch({
                  ambienceId:
                    event.target.value === "__stop__" ? null : event.target.value || undefined,
                })
              }
            >
              <option value="">Keep the current ambience</option>
              <option value="__stop__">Fade the ambience out</option>
              {ambienceBeds.map((bed) => (
                <option key={bed.id} value={bed.id}>
                  ≈ {bed.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="board-field">
          <span>Sound as the shot begins</span>
          <select value={node.sfxId ?? ""} onChange={(event) => onPatch({ sfxId: event.target.value || undefined })}>
            <option value="">None</option>
            {effects.map((sound) => (
              <option key={sound.id} value={sound.id}>
                {sound.name}
              </option>
            ))}
          </select>
        </label>
        <p className="board-hint">Import music and sounds in the scene builder's Sound tab.</p>
      </Section>
    </div>
  );
}
