import { useRef } from "react";
import { Crosshair, ImagePlus } from "lucide-react";
import {
  BACKGROUND_MOTIONS,
  BACKGROUND_MOTION_LABELS,
  GRADES,
  GRADE_LABELS,
  MAX_CAMERA_ZOOM,
  TEXTBOX_LABELS,
  TEXTBOX_STYLES,
  TEXT_EFFECTS,
  TEXT_EFFECT_LABELS,
  TRANSITIONS,
  TRANSITION_LABELS,
  WEATHERS,
  WEATHER_LABELS,
  projectTheme,
  type BackgroundMotion,
  type ColorGrade,
  type NodeBase,
  type Project,
  type TextEffect,
  type TextboxStyle,
  type Transition,
  type Weather,
} from "../../engine";
import { BACKGROUND_ACCEPT } from "../../studio/media";

interface Props {
  project: Project;
  node: NodeBase;
  onPatch: (patch: Partial<NodeBase>, discrete?: boolean) => void;
  onImportBackground: (file: File) => void;
}

/** Everything about how a scene looks, apart from the characters themselves. */
export function LookPanel({ project, node, onPatch, onImportBackground }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const theme = projectTheme(project);
  const camera = node.camera ?? { zoom: 1, x: 50, y: 45 };
  const setCamera = (patch: Partial<typeof camera>) => {
    const next = { ...camera, ...patch };
    onPatch({ camera: next.zoom <= 1.001 ? undefined : next });
  };
  return (
    <div className="look-panel">
      <div className="field-grid">
        <div className="form-field">
          <span className="field-label-row">
            <label htmlFor="scene-background">Background</label>
            <button
              type="button"
              className="text-button"
              aria-label="Import background"
              onClick={() => input.current?.click()}
            >
              <ImagePlus size={13} /> Import image or video
            </button>
          </span>
          <select
            id="scene-background"
            value={node.backgroundId || ""}
            onChange={(event) =>
              onPatch({ backgroundId: event.target.value || undefined })
            }
          >
            <option value="">Studio backdrop</option>
            {project.backgrounds.map((item) => (
              <option key={item.id} value={item.id}>
                {item.kind === "video" ? "▶ " : ""}
                {item.name}
              </option>
            ))}
          </select>
          <input
            ref={input}
            type="file"
            hidden
            aria-label="Import background image"
            accept={BACKGROUND_ACCEPT}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImportBackground(file);
              event.target.value = "";
            }}
          />
        </div>
        <label className="form-field">
          <span>Background motion</span>
          <select
            value={node.backgroundMotion ?? ""}
            onChange={(event) =>
              onPatch({
                backgroundMotion: (event.target.value || undefined) as
                  | BackgroundMotion
                  | undefined,
              })
            }
          >
            <option value="">Still</option>
            {BACKGROUND_MOTIONS.map((motion) => (
              <option key={motion} value={motion}>
                {BACKGROUND_MOTION_LABELS[motion]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field-grid three-columns">
        <label className="form-field">
          <span>Transition</span>
          <select
            value={node.transition ?? "cut"}
            onChange={(event) =>
              onPatch({
                transition:
                  event.target.value === "cut"
                    ? undefined
                    : (event.target.value as Transition),
              })
            }
          >
            {TRANSITIONS.map((transition) => (
              <option key={transition} value={transition}>
                {TRANSITION_LABELS[transition]}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Weather & atmosphere</span>
          <select
            value={node.weather ?? ""}
            onChange={(event) =>
              onPatch({
                weather: (event.target.value || undefined) as Weather | undefined,
              })
            }
          >
            <option value="">Clear</option>
            {WEATHERS.map((weather) => (
              <option key={weather} value={weather}>
                {WEATHER_LABELS[weather]}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Color grade</span>
          <select
            value={node.grade ?? ""}
            onChange={(event) =>
              onPatch({
                grade: (event.target.value || undefined) as ColorGrade | undefined,
              })
            }
          >
            <option value="">Natural</option>
            {GRADES.map((grade) => (
              <option key={grade} value={grade}>
                {GRADE_LABELS[grade]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field-grid three-columns">
        <label className="form-field">
          <span>Text box</span>
          <select
            value={node.textbox ?? ""}
            onChange={(event) =>
              onPatch({
                textbox: (event.target.value || undefined) as TextboxStyle | undefined,
              })
            }
          >
            <option value="">Story default · {TEXTBOX_LABELS[theme.textbox]}</option>
            {TEXTBOX_STYLES.map((style) => (
              <option key={style} value={style}>
                {TEXTBOX_LABELS[style]}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Text effect</span>
          <select
            value={node.textEffect ?? ""}
            onChange={(event) =>
              onPatch({
                textEffect: (event.target.value || undefined) as TextEffect | undefined,
              })
            }
          >
            <option value="">Story default · {TEXT_EFFECT_LABELS[theme.textEffect]}</option>
            {TEXT_EFFECTS.map((effect) => (
              <option key={effect} value={effect}>
                {TEXT_EFFECT_LABELS[effect]}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Impact</span>
          <select
            value={node.shake ?? ""}
            onChange={(event) =>
              onPatch({
                shake: (event.target.value || undefined) as
                  | "light"
                  | "heavy"
                  | undefined,
              })
            }
          >
            <option value="">No shake</option>
            <option value="light">Light shake</option>
            <option value="heavy">Heavy shake</option>
          </select>
        </label>
      </div>
      <div className="camera-controls">
        <div className="field-heading">
          <span>Camera</span>
          <span className="heading-actions">
            <button
              className="button small"
              disabled={!node.characterId}
              onClick={() =>
                onPatch({
                  camera: { zoom: Math.max(camera.zoom, 1.35), x: node.position, y: 38 },
                })
              }
              title="Frame the speaking character"
            >
              <Crosshair size={14} /> Close-up on speaker
            </button>
            <button
              className="button small"
              disabled={!node.camera}
              onClick={() => onPatch({ camera: undefined })}
            >
              Wide shot
            </button>
          </span>
        </div>
        <div className="slider-grid">
          <label>
            <span>Zoom · {camera.zoom.toFixed(2)}×</span>
            <input
              type="range"
              min="1"
              max={MAX_CAMERA_ZOOM}
              step="0.05"
              aria-label="Camera zoom"
              value={camera.zoom}
              onChange={(event) => setCamera({ zoom: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>Focus across · {camera.x}%</span>
            <input
              type="range"
              min="0"
              max="100"
              aria-label="Camera focus across"
              disabled={camera.zoom <= 1.001}
              value={camera.x}
              onChange={(event) => setCamera({ x: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>Focus height · {camera.y}%</span>
            <input
              type="range"
              min="0"
              max="100"
              aria-label="Camera focus height"
              disabled={camera.zoom <= 1.001}
              value={camera.y}
              onChange={(event) => setCamera({ y: Number(event.target.value) })}
            />
          </label>
        </div>
        <p className="field-hint">
          Camera moves glide between scenes. Combine a slow background motion with
          weather for a living, storage-free animated background.
        </p>
      </div>
    </div>
  );
}
