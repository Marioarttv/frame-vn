import { useEffect, useRef, useState } from "react";
import {
  ImagePlus,
  Music,
  Pause,
  Play,
  Plus,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import {
  backgroundUsage,
  createId,
  soundUsage,
  variableUsage,
  type Project,
  type Sound,
  type Variable,
} from "../engine";
import { resolveAssetUrl } from "../engine/asset-urls";
import {
  BACKGROUND_ACCEPT,
  importAudio,
  importBackgroundMedia,
  nameFromFile,
} from "../studio/media";
import { ThemeEditor } from "../components/scene/ThemeEditor";

interface Props {
  project: Project;
  onChange: (project: Project, discrete?: boolean) => void;
  onNotice: (message: string) => void;
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/** Project-wide resources that scenes refer to: story variables, backgrounds and audio. */
export function StoryData({ project, onChange, onNotice }: Props) {
  const backgroundInput = useRef<HTMLInputElement>(null);
  const soundInput = useRef<HTMLInputElement>(null);
  const soundKind = useRef<Sound["kind"]>("music");
  const [playing, setPlaying] = useState<string>();
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);

  const updateVariable = (id: string, patch: Partial<Variable>) =>
    onChange({
      ...project,
      variables: project.variables.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    });
  const removeWhenUnused = (
    kind: "variables" | "backgrounds" | "sounds",
    id: string,
    name: string,
    uses: number,
  ) => {
    if (uses)
      return onNotice(
        `“${name}” is used in ${plural(uses, "scene")}. Change those scenes first.`,
      );
    onChange(
      {
        ...project,
        [kind]: (project[kind] as { id: string }[]).filter(
          (item) => item.id !== id,
        ),
      },
      true,
    );
    onNotice(`“${name}” was removed. Use Undo to restore it.`);
  };

  async function importBackgrounds(files: FileList | null) {
    if (!files?.length) return;
    try {
      const added = [];
      for (const file of Array.from(files))
        added.push({
          id: createId("background"),
          name: nameFromFile(file, "Background"),
          ...(await importBackgroundMedia(file)),
        });
      onChange(
        { ...project, backgrounds: [...project.backgrounds, ...added] },
        true,
      );
      onNotice(`${plural(added.length, "background")} added.`);
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "The image could not be imported.",
      );
    }
  }
  async function importSounds(files: FileList | null) {
    if (!files?.length) return;
    try {
      const added: Sound[] = [];
      for (const file of Array.from(files))
        added.push({
          id: createId(soundKind.current),
          name: nameFromFile(file, "Sound"),
          src: await importAudio(file),
          kind: soundKind.current,
        });
      onChange({ ...project, sounds: [...project.sounds, ...added] }, true);
      onNotice(
        `${plural(added.length, soundKind.current === "music" ? "music track" : "sound effect")} added.`,
      );
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "The audio could not be imported.",
      );
    }
  }
  function toggle(sound: Sound) {
    audio.current?.pause();
    if (playing === sound.id) {
      setPlaying(undefined);
      return;
    }
    const element = new Audio(resolveAssetUrl(sound.src));
    element.onended = () => setPlaying(undefined);
    audio.current = element;
    setPlaying(sound.id);
    void element.play().catch(() => {
      setPlaying(undefined);
      onNotice("This audio could not be played.");
    });
  }

  return (
    <div className="story-data-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">WHAT YOUR SCENES SHARE</div>
          <h1>
            Story data<span>.</span>
          </h1>
          <p>Variables remember choices. Backgrounds and sound set the mood.</p>
        </div>
      </div>

      <ThemeEditor project={project} onChange={onChange} />

      <section className="panel data-section" aria-labelledby="variables-title">
        <div className="data-heading">
          <div>
            <h2 id="variables-title">
              <SlidersHorizontal size={16} /> Variables
            </h2>
            <p>
              Choices and scenes change variables; choice conditions and branch
              scenes read them.
            </p>
          </div>
          <button
            className="button small"
            disabled={project.variables.length >= 200}
            onClick={() =>
              onChange(
                {
                  ...project,
                  variables: [
                    ...project.variables,
                    {
                      id: createId("variable"),
                      name: `Variable ${project.variables.length + 1}`,
                      type: "number",
                      initial: 0,
                    },
                  ],
                },
                true,
              )
            }
          >
            <Plus size={14} /> Add variable
          </button>
        </div>
        {project.variables.length ? (
          <div className="data-table" role="table" aria-label="Variables">
            {project.variables.map((variable, index) => {
              const uses = variableUsage(project, variable.id);
              return (
                <div className="data-row" role="row" key={variable.id}>
                  <input
                    aria-label={`Variable ${index + 1} name`}
                    value={variable.name}
                    maxLength={80}
                    onChange={(event) =>
                      updateVariable(variable.id, { name: event.target.value })
                    }
                  />
                  <select
                    aria-label={`Variable ${index + 1} type`}
                    value={variable.type}
                    onChange={(event) =>
                      updateVariable(
                        variable.id,
                        event.target.value === "boolean"
                          ? { type: "boolean", initial: false }
                          : { type: "number", initial: 0 },
                      )
                    }
                  >
                    <option value="number">Number</option>
                    <option value="boolean">True / false</option>
                  </select>
                  {variable.type === "boolean" ? (
                    <select
                      aria-label={`Variable ${index + 1} starting value`}
                      value={String(variable.initial)}
                      onChange={(event) =>
                        updateVariable(variable.id, {
                          initial: event.target.value === "true",
                        })
                      }
                    >
                      <option value="false">Starts false</option>
                      <option value="true">Starts true</option>
                    </select>
                  ) : (
                    <input
                      type="number"
                      step="any"
                      aria-label={`Variable ${index + 1} starting value`}
                      value={Number(variable.initial)}
                      onChange={(event) =>
                        updateVariable(variable.id, {
                          initial: Number.isFinite(event.target.valueAsNumber)
                            ? event.target.valueAsNumber
                            : 0,
                        })
                      }
                    />
                  )}
                  <span className="usage">{plural(uses, "scene")}</span>
                  <button
                    className="icon-button danger"
                    aria-label={`Remove variable ${variable.name}`}
                    onClick={() =>
                      removeWhenUnused(
                        "variables",
                        variable.id,
                        variable.name,
                        uses,
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="empty-hint">
            No variables yet. Add one such as “Trust” or “Has the key” to make
            choices matter later.
          </p>
        )}
      </section>

      <section
        className="panel data-section"
        aria-labelledby="backgrounds-title"
      >
        <div className="data-heading">
          <div>
            <h2 id="backgrounds-title">
              <ImagePlus size={16} /> Backgrounds
            </h2>
            <p>
              Images or looping videos (MP4/WebM), stored once on this device
              and embedded on export.
            </p>
          </div>
          <button
            className="button small"
            onClick={() => backgroundInput.current?.click()}
          >
            <Upload size={14} /> Import backgrounds
          </button>
          <input
            ref={backgroundInput}
            hidden
            type="file"
            multiple
            accept={BACKGROUND_ACCEPT}
            aria-label="Import background images"
            onChange={(event) => {
              void importBackgrounds(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
        <div className="background-grid">
          {project.backgrounds.map((background, index) => {
            const uses = backgroundUsage(project, background.id);
            return (
              <div className="background-card" key={background.id}>
                {background.kind === "video" ? (
                  <video
                    src={resolveAssetUrl(background.src)}
                    muted
                    loop
                    autoPlay
                    playsInline
                  />
                ) : (
                  <img
                    src={resolveAssetUrl(background.src)}
                    alt=""
                    loading="lazy"
                  />
                )}
                <div>
                  <input
                    aria-label={`Background ${index + 1} name`}
                    value={background.name}
                    maxLength={140}
                    onChange={(event) =>
                      onChange({
                        ...project,
                        backgrounds: project.backgrounds.map((item) =>
                          item.id === background.id
                            ? { ...item, name: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                  <span className="usage">{plural(uses, "scene")}</span>
                  <button
                    className="icon-button danger"
                    aria-label={`Remove background ${background.name}`}
                    onClick={() =>
                      removeWhenUnused(
                        "backgrounds",
                        background.id,
                        background.name,
                        uses,
                      )
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel data-section" aria-labelledby="sounds-title">
        <div className="data-heading">
          <div>
            <h2 id="sounds-title">
              <Music size={16} /> Music & sound effects
            </h2>
            <p>
              Music loops and continues until a scene changes it. Ambience (rain,
              wind, a crowd) loops on its own channel beside the music; set a
              track's type to Ambience. Effects play once when their scene begins.
            </p>
          </div>
          <div className="data-actions">
            <button
              className="button small"
              onClick={() => {
                soundKind.current = "music";
                soundInput.current?.click();
              }}
            >
              <Upload size={14} /> Import music
            </button>
            <button
              className="button small"
              onClick={() => {
                soundKind.current = "sfx";
                soundInput.current?.click();
              }}
            >
              <Upload size={14} /> Import sound effects
            </button>
          </div>
          <input
            ref={soundInput}
            hidden
            type="file"
            multiple
            accept="audio/*"
            aria-label="Import audio files"
            onChange={(event) => {
              void importSounds(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
        {project.sounds.length ? (
          <div
            className="data-table"
            role="table"
            aria-label="Music and sound effects"
          >
            {project.sounds.map((sound, index) => {
              const uses = soundUsage(project, sound.id);
              return (
                <div className="data-row" role="row" key={sound.id}>
                  <button
                    className="icon-button"
                    aria-label={`${playing === sound.id ? "Stop" : "Play"} ${sound.name}`}
                    onClick={() => toggle(sound)}
                  >
                    {playing === sound.id ? (
                      <Pause size={14} />
                    ) : (
                      <Play size={14} />
                    )}
                  </button>
                  <input
                    aria-label={`Sound ${index + 1} name`}
                    value={sound.name}
                    maxLength={140}
                    onChange={(event) =>
                      onChange({
                        ...project,
                        sounds: project.sounds.map((item) =>
                          item.id === sound.id
                            ? { ...item, name: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                  <select
                    aria-label={`Sound ${index + 1} kind`}
                    value={sound.kind}
                    onChange={(event) =>
                      onChange({
                        ...project,
                        sounds: project.sounds.map((item) =>
                          item.id === sound.id
                            ? {
                                ...item,
                                kind: event.target.value as Sound["kind"],
                              }
                            : item,
                        ),
                      })
                    }
                  >
                    <option value="music">Music</option>
                    <option value="ambience">Ambience</option>
                    <option value="sfx">Sound effect</option>
                  </select>
                  <span className="usage">{plural(uses, "scene")}</span>
                  <button
                    className="icon-button danger"
                    aria-label={`Remove sound ${sound.name}`}
                    onClick={() =>
                      removeWhenUnused("sounds", sound.id, sound.name, uses)
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="empty-hint">
            No audio yet. Import a music loop or a sound effect, or add them
            from a scene’s Atmosphere settings.
          </p>
        )}
      </section>
    </div>
  );
}
