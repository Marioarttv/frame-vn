import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  Check,
  ChevronRight,
  Copy,
  FileText,
  Flag,
  GitBranch,
  GitFork,
  Map as MapIcon,
  MessageSquare,
  Palette,
  PenLine,
  Play,
  Plus,
  Trash2,
  Upload,
  Users,
  Video,
} from "lucide-react";
import type {
  Branch,
  NodeBase,
  Project,
  Sound,
  StoryNode,
} from "../engine/types";
import {
  createId,
  duplicateNode as duplicateScene,
  plainText,
  removeNode,
  validateProject,
} from "../engine";
import { VoiceWorkbench } from "./VoiceWorkbench";
import {
  importAudio,
  importBackgroundMedia,
  importRecording as importRecordingFile,
  nameFromFile,
} from "../studio/media";
import { resolveAssetUrl } from "../engine/asset-urls";
import { LiveStage, type ActorPatch } from "./scene/LiveStage";
import { StagePanel } from "./scene/StagePanel";
import { LookPanel } from "./scene/LookPanel";
import { DialogueField } from "./scene/DialogueField";
import {
  ConditionsEditor,
  EffectsEditor,
  optionalList,
} from "./scene/LogicEditors";
import { StoryMap } from "./scene/StoryMap";
import { ScriptImport } from "./scene/ScriptImport";
import { VoiceBatch } from "./scene/VoiceBatch";

export interface SceneEditorProps {
  project: Project;
  onChange: (project: Project, discrete?: boolean) => void;
  onPlay: (startNodeId?: string) => void;
  onRender?: (startNodeId?: string) => void;
  onNotice: (message: string) => void;
  initialNodeId?: string;
}

const makeId = () => createId("scene");
const nodeName = (node: StoryNode, index: number) =>
  node.label.trim() || `Scene ${index + 1}`;
const STOP_MUSIC = "__stop__";
type InspectorTab = "write" | "stage" | "look" | "sound";
const TABS: { id: InspectorTab; label: string; icon: typeof PenLine }[] = [
  { id: "write", label: "Write", icon: PenLine },
  { id: "stage", label: "Stage", icon: Users },
  { id: "look", label: "Look", icon: Palette },
  { id: "sound", label: "Sound & voice", icon: AudioLines },
];
const TYPE_ICONS = {
  dialogue: MessageSquare,
  choice: GitBranch,
  branch: GitFork,
  end: Flag,
};
const TYPE_LABELS = {
  dialogue: "dialogue",
  choice: "choice",
  branch: "branch",
  end: "end",
};

function baseOf(node: StoryNode): NodeBase {
  // Everything except the type and its connections carries over to the new scene type.
  const rest: Record<string, unknown> = { ...node };
  for (const key of ["type", "nextId", "choices", "branches", "elseId"])
    delete rest[key];
  return Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined),
  ) as unknown as NodeBase;
}

/** The first visible destination, used when a scene changes type. */
function primaryTarget(node: StoryNode): string {
  if (node.type === "dialogue") return node.nextId ?? "";
  if (node.type === "choice") return node.choices[0]?.nextId ?? "";
  if (node.type === "branch") return node.elseId;
  return "";
}

export function SceneEditor({
  project,
  onChange,
  onPlay,
  onRender,
  onNotice,
  initialNodeId,
}: SceneEditorProps) {
  const [tab, setTab] = useState<InspectorTab>("write");
  const [selectedActor, setSelectedActor] = useState<string>();
  const [selectedId, setSelectedId] = useState(() =>
    project.nodes.some((node) => node.id === initialNodeId)
      ? initialNodeId!
      : project.startNodeId,
  );
  const [mode, setMode] = useState<"edit" | "map">("edit");
  const [importingScript, setImportingScript] = useState(false);
  const [voicing, setVoicing] = useState(false);
  // Batch voicing attaches results over time; always patch the newest project.
  const latestProject = useRef(project);
  latestProject.current = project;
  const appliedInitialId = useRef<string | undefined>(undefined);
  const [previewAudio, setPreviewAudioState] = useState(false);
  const previewElement = useRef<HTMLAudioElement | null>(null);
  // Any edit or scene change ends a running preview.
  const setPreviewAudio = (playing: boolean) => {
    if (!playing) {
      previewElement.current?.pause();
      previewElement.current = null;
    }
    setPreviewAudioState(playing);
  };
  /** Plays straight from the click, so the browser treats it as user-started audio. */
  const togglePreview = (src: string) => {
    if (previewElement.current) return setPreviewAudio(false);
    const audio = new Audio(resolveAssetUrl(src));
    previewElement.current = audio;
    audio.onended = () => {
      if (previewElement.current === audio) setPreviewAudio(false);
    };
    setPreviewAudioState(true);
    audio.play().catch(() => {
      if (previewElement.current !== audio) return;
      setPreviewAudio(false);
      onNotice("This recording could not be played.");
    });
  };
  useEffect(() => () => previewElement.current?.pause(), []);
  const soundImport = useRef<{
    kind: Sound["kind"];
    input: HTMLInputElement | null;
  }>({
    kind: "music",
    input: null,
  });
  const recordingImport = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!initialNodeId) {
      appliedInitialId.current = undefined;
      return;
    }
    if (
      appliedInitialId.current === initialNodeId ||
      !project.nodes.some((node) => node.id === initialNodeId)
    )
      return;
    appliedInitialId.current = initialNodeId;
    setSelectedId(initialNodeId);
    setPreviewAudio(false);
  }, [initialNodeId, project.nodes]);
  const selected =
    project.nodes.find((node) => node.id === selectedId) ??
    project.nodes.find((node) => node.id === project.startNodeId) ??
    project.nodes[0];
  const selectedIndex = selected ? project.nodes.indexOf(selected) : -1;
  const character = project.characters.find(
    (item) => item.id === selected?.characterId,
  );
  const pose =
    character?.poses.find((item) => item.id === selected?.poseId) ??
    character?.poses[0];
  const currentTargets = useMemo(
    () => new Set(project.nodes.map((node) => node.id)),
    [project.nodes],
  );
  const validation = useMemo(() => validateProject(project), [project]);
  const sceneIssues = validation.errors.filter(
    (issue) =>
      issue.path === `nodes[${selectedIndex}]` ||
      issue.path.startsWith(`nodes[${selectedIndex}].`),
  );
  const unresolved =
    selected?.type === "dialogue"
      ? Boolean(selected.nextId && !currentTargets.has(selected.nextId))
      : selected?.type === "choice"
        ? selected.choices.some((choice) => !currentTargets.has(choice.nextId))
        : selected?.type === "branch" &&
          (!currentTargets.has(selected.elseId) ||
            selected.branches.some(
              (branch) => !currentTargets.has(branch.nextId),
            ));
  const musicTracks = project.sounds.filter((sound) => sound.kind === "music");
  const ambienceBeds = project.sounds.filter((sound) => sound.kind === "ambience");
  const effectSounds = project.sounds.filter((sound) => sound.kind === "sfx");
  const isBranch = selected?.type === "branch";

  const replaceNode = (replacement: StoryNode, discrete = false) => {
    setPreviewAudio(false);
    onChange(
      {
        ...project,
        nodes: project.nodes.map((node) =>
          node.id === replacement.id ? replacement : node,
        ),
      },
      discrete,
    );
  };
  const patchNode = (patch: Partial<NodeBase>, discrete = false) =>
    selected && replaceNode({ ...selected, ...patch } as StoryNode, discrete);
  const select = (id: string) => {
    setSelectedId(id);
    setPreviewAudio(false);
  };

  const addNode = () => {
    const id = makeId();
    // A new line usually continues the same stage: keep its cast and backdrop.
    const created: StoryNode = {
      id,
      type: "dialogue",
      label: `Scene ${project.nodes.length + 1}`,
      text: "",
      characterId: selected?.characterId ?? project.characters[0]?.id,
      poseId: selected?.poseId,
      backgroundId: selected?.backgroundId ?? project.backgrounds[0]?.id,
      position: selected?.position ?? 50,
      ...(selected?.flip ? { flip: true } : {}),
      ...(selected?.cast?.length
        ? { cast: structuredClone(selected.cast) }
        : {}),
      nextId: selected?.type === "dialogue" ? selected.nextId : null,
    };
    const nodes = [...project.nodes];
    if (selected?.type === "dialogue")
      nodes[selectedIndex] = { ...selected, nextId: id };
    nodes.splice(selectedIndex + 1, 0, created);
    onChange(
      { ...project, nodes, startNodeId: project.startNodeId || id },
      true,
    );
    select(id);
    onNotice("Scene added. Write the next part of your story.");
  };

  const duplicateNode = () => {
    if (!selected) return;
    const duplicated = duplicateScene(project, selected.id);
    onChange(duplicated.project, true);
    select(duplicated.nodeId);
    onNotice("Scene duplicated. Connect it using a next scene or choice.");
  };

  const deleteNode = () => {
    if (!selected || project.nodes.length < 2) return;
    const updated = removeNode(project, selected.id);
    const broken = updated.nodes.some(
      (node) =>
        (node.type === "choice" &&
          node.choices.some((choice) => !choice.nextId)) ||
        (node.type === "branch" &&
          (!node.elseId || node.branches.some((branch) => !branch.nextId))),
    );
    onChange(updated, true);
    select(updated.nodes[Math.min(selectedIndex, updated.nodes.length - 1)].id);
    onNotice(
      broken
        ? "Scene removed. Some choices or branches now need a new destination."
        : "Scene removed. Incoming connections have been updated.",
    );
  };

  const importBackground = async (file?: File) => {
    if (!file || !selected) return;
    try {
      const media = await importBackgroundMedia(file);
      const background = {
        id: createId("background"),
        name: nameFromFile(file, "Background"),
        ...media,
      };
      onChange(
        {
          ...project,
          backgrounds: [...project.backgrounds, background],
          nodes: project.nodes.map((node) =>
            node.id === selected.id
              ? { ...node, backgroundId: background.id }
              : node,
          ),
        },
        true,
      );
      onNotice(`${background.name} added as a background for this scene.`);
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "The background could not be imported.",
      );
    }
  };

  const importSound = async (file?: File) => {
    if (!file || !selected) return;
    const kind = soundImport.current.kind;
    try {
      const sound: Sound = {
        id: createId(kind),
        name: nameFromFile(file, kind === "music" ? "Music" : "Sound"),
        src: await importAudio(file),
        kind,
      };
      onChange(
        {
          ...project,
          sounds: [...project.sounds, sound],
          nodes: project.nodes.map((node) =>
            node.id === selected.id
              ? kind === "music"
                ? { ...node, musicId: sound.id }
                : { ...node, sfxId: sound.id }
              : node,
          ),
        },
        true,
      );
      onNotice(
        kind === "music"
          ? `${sound.name} now starts in this scene and continues until changed.`
          : `${sound.name} plays when this scene begins.`,
      );
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "The audio could not be imported.",
      );
    }
  };

  const importRecording = async (file?: File) => {
    if (!file || !selected) return;
    try {
      const { src, duration } = await importRecordingFile(file);
      patchNode(
        { audioSrc: src, cueUrl: undefined, audioDuration: duration, textTimings: undefined },
        true,
      );
      onNotice(
        "Recording attached. Generated voice lines also include mouth timing.",
      );
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "The recording could not be imported.",
      );
    }
  };

  const moveNode = (direction: -1 | 1) => {
    if (!selected) return;
    const index = selectedIndex + direction;
    if (index < 0 || index >= project.nodes.length) return;
    const nodes = [...project.nodes];
    [nodes[selectedIndex], nodes[index]] = [nodes[index], nodes[selectedIndex]];
    onChange({ ...project, nodes }, true);
  };

  const changeType = (type: StoryNode["type"]) => {
    if (!selected || selected.type === type) return;
    const base = baseOf(selected);
    const target = primaryTarget(selected);
    const fallback = target || project.nodes[selectedIndex + 1]?.id || "";
    if (type === "dialogue")
      replaceNode({ ...base, type, nextId: target || null }, true);
    else if (type === "choice")
      replaceNode(
        {
          ...base,
          type,
          choices: [
            { id: makeId(), text: "Continue the story", nextId: fallback },
          ],
        },
        true,
      );
    else if (type === "branch")
      replaceNode(
        {
          ...base,
          type,
          branches: [
            { id: createId("branch"), conditions: [], nextId: fallback },
          ],
          elseId: fallback,
        },
        true,
      );
    else replaceNode({ ...base, type }, true);
  };

  const onActorChange = (patch: ActorPatch) => {
    if (!selected) return;
    const { characterId, ...placement } = patch;
    if (placement.position !== undefined)
      placement.position = Math.round(placement.position);
    if (placement.scale !== undefined && Math.abs(placement.scale - 1) < 0.001)
      placement.scale = undefined;
    if (placement.y === 0) placement.y = undefined;
    if (characterId === selected.characterId) patchNode(placement);
    else if (selected.cast?.some((actor) => actor.characterId === characterId))
      patchNode({
        cast: selected.cast.map((actor) =>
          actor.characterId === characterId ? { ...actor, ...placement } : actor,
        ),
      });
  };
  const changeText = (text: string) => {
    if (!selected) return;
    // Direction tags change timing, not the spoken words, so the recording stays.
    const spokenChanged = plainText(text) !== plainText(selected.text);
    patchNode(
      spokenChanged
        ? { text, audioSrc: undefined, cueUrl: undefined, audioDuration: undefined, textTimings: undefined }
        : { text },
    );
  };

  const targetOptions = project.nodes.map((node, index) => (
    <option key={node.id} value={node.id}>
      {String(index + 1).padStart(2, "0")} · {nodeName(node, index)}
    </option>
  ));
  return (
    <section className="scene-editor-shell" aria-label="Scene editor">
      <div className="scene-modes">
        <div className="segmented" role="group" aria-label="Scene builder view">
          <button
            aria-pressed={mode === "edit"}
            onClick={() => setMode("edit")}
          >
            <MessageSquare size={14} /> Scenes
          </button>
          <button aria-pressed={mode === "map"} onClick={() => setMode("map")}>
            <MapIcon size={14} /> Story map
          </button>
        </div>
        <div className="scene-mode-actions">
          <button className="button small" onClick={() => setVoicing(true)}>
            <AudioLines size={14} /> Voice missing lines
          </button>
          <button
            className="button small"
            onClick={() => setImportingScript(true)}
          >
            <FileText size={14} /> Import script
          </button>
        </div>
      </div>
      {mode === "map" ? (
        <StoryMap
          project={project}
          selectedId={selected?.id}
          issues={validation.errors}
          onSelect={(id) => {
            select(id);
            setMode("edit");
          }}
        />
      ) : (
        <div className="scene-editor">
          <aside className="node-list" aria-label="Story scenes">
            <div className="node-list-header">
              <div>
                <span className="eyebrow">YOUR STORY</span>
                <h2>
                  Scenes{" "}
                  <span className="count-badge">{project.nodes.length}</span>
                </h2>
              </div>
              <button
                className="icon-button"
                onClick={addNode}
                aria-label="Add scene"
                title="Add scene"
              >
                <Plus size={18} />
              </button>
            </div>
            <p className="section-hint">
              Every conversation starts with a scene.
            </p>
            <div className="node-list-items">
              {project.nodes.map((node, index) => {
                const Icon = TYPE_ICONS[node.type];
                return (
                  <button
                    key={node.id}
                    className={`node-card ${selected?.id === node.id ? "is-selected" : ""}`}
                    onClick={() => select(node.id)}
                    aria-current={selected?.id === node.id ? "true" : undefined}
                  >
                    <span className="node-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="node-copy">
                      <span className="node-title">
                        {nodeName(node, index)}
                      </span>
                      <span className="node-excerpt">
                        {node.type === "branch"
                          ? `${node.branches.length} condition${node.branches.length === 1 ? "" : "s"} · invisible to players`
                          : plainText(node.text).trim() ||
                            "A new scene, waiting for words."}
                      </span>
                      <span className="node-meta">
                        <Icon size={11} />
                        {TYPE_LABELS[node.type]}
                        {project.startNodeId === node.id && (
                          <span className="start-label">START</span>
                        )}
                      </span>
                    </span>
                    <ChevronRight size={14} className="node-chevron" />
                  </button>
                );
              })}
            </div>
            <button className="button add-scene-button" onClick={addNode}>
              <Plus size={16} /> Add scene
            </button>
            <div className="node-list-footer">
              <GitBranch size={14} />
              <span>Connections control the story order.</span>
            </div>
          </aside>

          {selected ? (
            <div className="scene-workspace">
              <div className="editor-toolbar">
                <div>
                  <span className="eyebrow">
                    SCENE {String(selectedIndex + 1).padStart(2, "0")}
                  </span>
                  <h2>{selected.label || "Untitled scene"}</h2>
                </div>
                <div className="toolbar-actions">
                  <button
                    className="icon-button"
                    onClick={() => moveNode(-1)}
                    disabled={selectedIndex === 0}
                    aria-label="Move scene up"
                    title="Move scene up"
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => moveNode(1)}
                    disabled={selectedIndex === project.nodes.length - 1}
                    aria-label="Move scene down"
                    title="Move scene down"
                  >
                    <ArrowDown size={16} />
                  </button>
                  <button
                    className="icon-button"
                    onClick={duplicateNode}
                    aria-label="Duplicate scene"
                    title="Duplicate scene"
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    className="icon-button danger"
                    onClick={deleteNode}
                    disabled={project.nodes.length < 2}
                    aria-label="Delete scene"
                    title="Delete scene"
                  >
                    <Trash2 size={16} />
                  </button>
                  <button
                    className="button"
                    disabled={!validation.valid}
                    onClick={() => onPlay(selected.id)}
                    title="Preview from this scene with a fresh story state"
                  >
                    <Play size={14} /> Play from here
                  </button>
                  <button
                    className="button primary"
                    disabled={!validation.valid}
                    onClick={() => onPlay()}
                  >
                    <Play size={15} fill="currentColor" /> Play story
                  </button>
                  {onRender && (
                    <button
                      className="button"
                      disabled={!validation.valid}
                      onClick={() => onRender(selected.id)}
                      title="Render a playthrough from this scene as an MP4 video"
                    >
                      <Video size={15} /> Export video
                    </button>
                  )}
                </div>
              </div>

              <LiveStage
                project={project}
                nodeId={selected.id}
                selectedActor={selectedActor}
                onActorChange={onActorChange}
                onSelectActor={(id) => {
                  setSelectedActor(id || undefined);
                  if (id) setTab("stage");
                }}
                overlay={
                  isBranch ? (
                    <div className="stage-branch-note">
                      <GitFork size={26} />
                      <strong>INVISIBLE BRANCH</strong>
                      <span>Players never see this scene. It routes the story.</span>
                    </div>
                  ) : undefined
                }
              />

              <div className="scene-inspector">
                <div
                  className="inspector-tabs"
                  role="tablist"
                  aria-label="Scene settings"
                >
                  {TABS.filter((item) => !isBranch || item.id === "write").map(
                    (item) => {
                      const Icon = item.icon;
                      const active = isBranch || tab === item.id;
                      return (
                        <button
                          key={item.id}
                          role="tab"
                          aria-selected={active}
                          className={active ? "is-active" : ""}
                          onClick={() => setTab(item.id)}
                        >
                          <Icon size={14} /> {item.label}
                        </button>
                      );
                    },
                  )}
                  <span className="muted">Changes save automatically</span>
                </div>
                <div className="scene-fields">
                  {(tab === "write" || isBranch) && (
                  <>
                  <div className="field-grid">
                    <label className="form-field">
                      <span>Scene name</span>
                      <input
                        value={selected.label}
                        maxLength={120}
                        onChange={(event) =>
                          patchNode({ label: event.target.value })
                        }
                        placeholder="A chance encounter"
                      />
                    </label>
                    <label className="form-field">
                      <span>Scene type</span>
                      <select
                        value={selected.type}
                        onChange={(event) =>
                          changeType(event.target.value as StoryNode["type"])
                        }
                      >
                        <option value="dialogue">Dialogue</option>
                        <option value="choice">Player choice</option>
                        <option value="branch">Condition branch</option>
                        <option value="end">Story ending</option>
                      </select>
                    </label>
                  </div>
                  {!isBranch && (
                    <>
                      <div className="field-grid">
                        <label className="form-field">
                          <span>Character</span>
                          <select
                            value={selected.characterId || ""}
                            onChange={(event) => {
                              const next = project.characters.find(
                                (item) => item.id === event.target.value,
                              );
                              patchNode(
                                {
                                  characterId: next?.id,
                                  poseId: next?.poses[0]?.id,
                                  audioSrc: undefined,
                                  cueUrl: undefined,
                                  audioDuration: undefined, textTimings: undefined,
                                  // A speaker cannot also stand on stage as a listener.
                                  cast: optionalList(
                                    (selected.cast ?? []).filter(
                                      (actor) => actor.characterId !== next?.id,
                                    ),
                                  ),
                                },
                                true,
                              );
                            }}
                          >
                            <option value="">Narrator · no character</option>
                            {project.characters.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="form-field">
                          <span>Expression</span>
                          <select
                            value={pose?.id || ""}
                            disabled={!character?.poses.length}
                            onChange={(event) =>
                              patchNode({ poseId: event.target.value })
                            }
                          >
                            {character?.poses.length ? (
                              character.poses.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))
                            ) : (
                              <option value="">No expression</option>
                            )}
                          </select>
                        </label>
                      </div>
                      <DialogueField
                        value={selected.text}
                        speaker={character}
                        effects={effectSounds}
                        onChange={changeText}
                      />
                      <div className="field-grid">
                        <label className="form-field">
                          <span>
                            Speaker label{" "}
                            <span className="field-caption">
                              Optional override
                            </span>
                          </span>
                          <input
                            value={selected.speaker || ""}
                            onChange={(event) =>
                              patchNode({
                                speaker: event.target.value || undefined,
                              })
                            }
                            placeholder={character?.name || "Narrator"}
                            maxLength={100}
                          />
                        </label>
                        <div className="form-field">
                          <span>On stage</span>
                          <button
                            className="button small stage-summary"
                            onClick={() => setTab("stage")}
                          >
                            <Users size={14} />
                            {character ? `${character.name} (${pose?.name ?? "default"})` : "Narration"}
                            {selected.cast?.length
                              ? ` + ${selected.cast.length} more`
                              : ""}
                          </button>
                        </div>
                      </div>
                    </>
                  )}

                  {selected.type === "dialogue" && (
                    <label className="form-field">
                      <span>Next scene</span>
                      <select
                        value={selected.nextId || ""}
                        onChange={(event) =>
                          replaceNode({
                            ...selected,
                            nextId: event.target.value || null,
                          })
                        }
                      >
                        <option value="">End after this scene</option>
                        {targetOptions}
                      </select>
                    </label>
                  )}
                  {selected.type === "choice" && (
                    <div className="choice-editor">
                      <div className="field-heading">
                        <span>Player choices</span>
                        <button
                          className="button small"
                          disabled={selected.choices.length >= 8}
                          onClick={() =>
                            replaceNode(
                              {
                                ...selected,
                                choices: [
                                  ...selected.choices,
                                  { id: makeId(), text: "", nextId: "" },
                                ],
                              },
                              true,
                            )
                          }
                        >
                          <Plus size={14} /> Add choice
                        </button>
                      </div>
                      {selected.choices.map((choice, index) => {
                        const updateChoice = (patch: Partial<typeof choice>) =>
                          replaceNode({
                            ...selected,
                            choices: selected.choices.map((item) =>
                              item.id === choice.id
                                ? { ...item, ...patch }
                                : item,
                            ),
                          });
                        return (
                          <div className="choice-block" key={choice.id}>
                            <div className="choice-row">
                              <span className="choice-number">{index + 1}</span>
                              <label className="form-field">
                                <span className="sr-only">
                                  Choice {index + 1} text
                                </span>
                                <input
                                  value={choice.text}
                                  maxLength={240}
                                  placeholder="A choice for your player"
                                  onChange={(event) =>
                                    updateChoice({ text: event.target.value })
                                  }
                                />
                              </label>
                              <ChevronRight size={14} />
                              <label className="form-field">
                                <span className="sr-only">
                                  Choice {index + 1} target scene
                                </span>
                                <select
                                  value={choice.nextId}
                                  onChange={(event) =>
                                    updateChoice({ nextId: event.target.value })
                                  }
                                >
                                  <option value="">Choose next scene…</option>
                                  {targetOptions}
                                </select>
                              </label>
                              <button
                                className="icon-button danger"
                                aria-label={`Remove choice ${index + 1}`}
                                disabled={selected.choices.length < 2}
                                onClick={() =>
                                  replaceNode(
                                    {
                                      ...selected,
                                      choices: selected.choices.filter(
                                        (item) => item.id !== choice.id,
                                      ),
                                    },
                                    true,
                                  )
                                }
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                            <details
                              className="choice-logic"
                              open={
                                !!choice.conditions?.length ||
                                !!choice.effects?.length
                              }
                            >
                              <summary>
                                Conditions & effects
                                {choice.conditions?.length
                                  ? ` · shown when ${choice.conditions.length} condition${choice.conditions.length === 1 ? "" : "s"} hold`
                                  : ""}
                              </summary>
                              <ConditionsEditor
                                label={`Choice ${index + 1} condition`}
                                variables={project.variables}
                                conditions={choice.conditions ?? []}
                                onChange={(conditions) =>
                                  updateChoice({
                                    conditions: optionalList(conditions),
                                  })
                                }
                              />
                              <EffectsEditor
                                label={`Choice ${index + 1} effect`}
                                variables={project.variables}
                                effects={choice.effects ?? []}
                                onChange={(effects) =>
                                  updateChoice({
                                    effects: optionalList(effects),
                                  })
                                }
                              />
                            </details>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {selected.type === "branch" && (
                    <div className="choice-editor">
                      <div className="field-heading">
                        <span>Branches · the first match wins</span>
                        <button
                          className="button small"
                          disabled={selected.branches.length >= 8}
                          onClick={() =>
                            replaceNode(
                              {
                                ...selected,
                                branches: [
                                  ...selected.branches,
                                  {
                                    id: createId("branch"),
                                    conditions: [],
                                    nextId: "",
                                  },
                                ],
                              },
                              true,
                            )
                          }
                        >
                          <Plus size={14} /> Add branch
                        </button>
                      </div>
                      {!project.variables.length && (
                        <p className="field-hint">
                          Branches compare variables. Create one in Story data,
                          then change it with choice or scene effects.
                        </p>
                      )}
                      {selected.branches.map((branch, index) => {
                        const updateBranch = (patch: Partial<Branch>) =>
                          replaceNode({
                            ...selected,
                            branches: selected.branches.map((item) =>
                              item.id === branch.id
                                ? { ...item, ...patch }
                                : item,
                            ),
                          });
                        return (
                          <div className="choice-block" key={branch.id}>
                            <ConditionsEditor
                              label={`Branch ${index + 1} condition`}
                              variables={project.variables}
                              conditions={branch.conditions}
                              onChange={(conditions) =>
                                updateBranch({ conditions })
                              }
                            />
                            <div className="choice-row">
                              <span className="logic-word">go to</span>
                              <label className="form-field">
                                <span className="sr-only">
                                  Branch {index + 1} target scene
                                </span>
                                <select
                                  value={branch.nextId}
                                  onChange={(event) =>
                                    updateBranch({ nextId: event.target.value })
                                  }
                                >
                                  <option value="">Choose next scene…</option>
                                  {targetOptions}
                                </select>
                              </label>
                              <button
                                className="icon-button danger"
                                aria-label={`Remove branch ${index + 1}`}
                                disabled={selected.branches.length < 2}
                                onClick={() =>
                                  replaceNode(
                                    {
                                      ...selected,
                                      branches: selected.branches.filter(
                                        (item) => item.id !== branch.id,
                                      ),
                                    },
                                    true,
                                  )
                                }
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      <label className="form-field">
                        <span>Otherwise go to</span>
                        <select
                          value={selected.elseId}
                          onChange={(event) =>
                            replaceNode({
                              ...selected,
                              elseId: event.target.value,
                            })
                          }
                        >
                          <option value="">Choose next scene…</option>
                          {targetOptions}
                        </select>
                      </label>
                    </div>
                  )}

                  <details
                    className="scene-section scene-effects"
                    open={!!selected.effects?.length}
                  >
                    <summary>
                      When this scene begins
                      {selected.effects?.length
                        ? ` · ${selected.effects.length} change${selected.effects.length === 1 ? "" : "s"}`
                        : ""}
                    </summary>
                    <EffectsEditor
                      label="Scene effect"
                      variables={project.variables}
                      effects={selected.effects ?? []}
                      onChange={(effects) =>
                        patchNode({ effects: optionalList(effects) })
                      }
                    />
                  </details>

                  {(unresolved || sceneIssues.length > 0) && (
                    <div className="validation-note" role="status">
                      {unresolved && (
                        <p>
                          Choose a valid next scene for every connection before
                          playing this part of the story.
                        </p>
                      )}
                      {[
                        ...new Set(
                          sceneIssues
                            .filter(
                              (issue) =>
                                !issue.path.endsWith(".nextId") &&
                                !issue.path.endsWith(".elseId"),
                            )
                            .map((issue) => issue.message),
                        ),
                      ].map((message) => (
                        <p key={message}>{message}</p>
                      ))}
                    </div>
                  )}
                  </>
                  )}
                  {tab === "stage" && !isBranch && (
                    <StagePanel
                      project={project}
                      node={selected}
                      selectedActor={selectedActor}
                      onSelectActor={setSelectedActor}
                      onPatch={patchNode}
                      onNotice={onNotice}
                    />
                  )}
                  {tab === "look" && !isBranch && (
                    <LookPanel
                      project={project}
                      node={selected}
                      onPatch={patchNode}
                      onImportBackground={(file) => void importBackground(file)}
                    />
                  )}
                  {tab === "sound" && !isBranch && (
                    <>
                      <div className="field-grid">
                        <div className="form-field">
                          <span className="field-label-row">
                            <label htmlFor="scene-music">Music</label>
                            <button
                              type="button"
                              className="text-button"
                              aria-label="Import music"
                              onClick={() => {
                                soundImport.current.kind = "music";
                                soundImport.current.input?.click();
                              }}
                            >
                              <Upload size={12} /> Import
                            </button>
                          </span>
                          <select
                            id="scene-music"
                            value={
                              selected.musicId === null
                                ? STOP_MUSIC
                                : (selected.musicId ?? "")
                            }
                            onChange={(event) =>
                              patchNode({
                                musicId:
                                  event.target.value === STOP_MUSIC
                                    ? null
                                    : event.target.value || undefined,
                              })
                            }
                          >
                            <option value="">Keep current music</option>
                            <option value={STOP_MUSIC}>Stop music</option>
                            {musicTracks.map((item) => (
                              <option key={item.id} value={item.id}>
                                ♪ {item.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        {ambienceBeds.length > 0 && (
                          <div className="form-field">
                            <label htmlFor="scene-ambience">Ambience</label>
                            <select
                              id="scene-ambience"
                              value={
                                selected.ambienceId === null
                                  ? STOP_MUSIC
                                  : (selected.ambienceId ?? "")
                              }
                              onChange={(event) =>
                                patchNode({
                                  ambienceId:
                                    event.target.value === STOP_MUSIC
                                      ? null
                                      : event.target.value || undefined,
                                })
                              }
                            >
                              <option value="">Keep current ambience</option>
                              <option value={STOP_MUSIC}>Fade ambience out</option>
                              {ambienceBeds.map((item) => (
                                <option key={item.id} value={item.id}>
                                  ≈ {item.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div className="form-field">
                          <span className="field-label-row">
                            <label htmlFor="scene-sfx">Sound effect</label>
                            <button
                              type="button"
                              className="text-button"
                              aria-label="Import sound effect"
                              onClick={() => {
                                soundImport.current.kind = "sfx";
                                soundImport.current.input?.click();
                              }}
                            >
                              <Upload size={12} /> Import
                            </button>
                          </span>
                          <select
                            id="scene-sfx"
                            value={selected.sfxId ?? ""}
                            onChange={(event) =>
                              patchNode({
                                sfxId: event.target.value || undefined,
                              })
                            }
                          >
                            <option value="">None</option>
                            {effectSounds.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <input
                        ref={(input) => {
                          soundImport.current.input = input;
                        }}
                        type="file"
                        hidden
                        aria-label="Import music or sound effect"
                        accept="audio/*"
                        onChange={(event) => {
                          void importSound(event.target.files?.[0]);
                          event.target.value = "";
                        }}
                      />
                      <p className="field-hint">
                        Time a sound to an exact word with “Sound at cursor” in
                        the Write tab.
                      </p>
                      <VoiceWorkbench
                        key={`${selected.id}:${character?.id || "narrator"}`}
                        character={character}
                        text={plainText(selected.text)}
                        onGenerated={(result) => {
                          patchNode(
                            {
                              audioSrc: result.audioSrc,
                              cueUrl: result.cueUrl,
                              audioDuration: result.duration, textTimings: undefined,
                            },
                            true,
                          );
                          onNotice(
                            "Voice and mouth movements are ready. Preview the performance.",
                          );
                        }}
                        onVoiceChange={(voiceId) => {
                          if (character)
                            onChange({
                              ...project,
                              characters: project.characters.map((item) =>
                                item.id === character.id
                                  ? { ...item, voiceId }
                                  : item,
                              ),
                            });
                        }}
                      />
                      <div className="scene-audio-slot">
                        <label className="form-field">
                          <span>
                            Voice audio{" "}
                            <span className="field-caption">
                              URL, generated line or uploaded recording
                            </span>
                          </span>
                          <input
                            value={
                              selected.audioSrc?.startsWith("asset:")
                                ? "Uploaded recording"
                                : selected.audioSrc || ""
                            }
                            readOnly={selected.audioSrc?.startsWith("asset:")}
                            type="text"
                            placeholder="https://… or a generated voice line"
                            onChange={(event) =>
                              patchNode({
                                audioSrc: event.target.value || undefined,
                                cueUrl: undefined,
                              })
                            }
                          />
                        </label>
                        <button
                          className="button small"
                          onClick={() => recordingImport.current?.click()}
                        >
                          <Upload size={14} /> Upload recording
                        </button>
                        {selected.audioSrc && (
                          <>
                            <button
                              className="button small"
                              onClick={() => togglePreview(selected.audioSrc!)}
                            >
                              <Play size={14} />
                              {previewAudio
                                ? "Stop voice preview"
                                : "Preview voice"}
                            </button>
                            <button
                              className="icon-button danger"
                              aria-label="Remove voice audio"
                              onClick={() =>
                                patchNode(
                                  { audioSrc: undefined, cueUrl: undefined },
                                  true,
                                )
                              }
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                        <input
                          ref={recordingImport}
                          type="file"
                          hidden
                          aria-label="Upload a voice recording"
                          accept="audio/*"
                          onChange={(event) => {
                            void importRecording(event.target.files?.[0]);
                            event.target.value = "";
                          }}
                        />
                      </div>
                    </>
                  )}
                  <div className="scene-settings-footer">
                    <button
                      className="button small"
                      disabled={project.startNodeId === selected.id}
                      onClick={() => {
                        onChange(
                          { ...project, startNodeId: selected.id },
                          true,
                        );
                        onNotice("The story will begin with this scene.");
                      }}
                    >
                      {project.startNodeId === selected.id ? (
                        <Check size={14} />
                      ) : (
                        <Flag size={14} />
                      )}
                      {project.startNodeId === selected.id
                        ? "This is the opening scene"
                        : "Set as opening scene"}
                    </button>
                    <span className="muted">
                      {selected.type === "end"
                        ? "The story ends here."
                        : selected.type === "choice"
                          ? "The player decides where the story goes."
                          : selected.type === "branch"
                            ? "The story state decides where the story goes."
                            : "One line. One moment. Your story."}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <MessageSquare size={36} />
              <h2>Your story starts here</h2>
              <p>
                Add the first scene and give your characters something to say.
              </p>
              <button className="button primary" onClick={addNode}>
                <Plus size={16} /> Create first scene
              </button>
            </div>
          )}
        </div>
      )}
      {voicing && (
        <VoiceBatch
          project={project}
          onClose={() => setVoicing(false)}
          onAttach={(nodeId, result, text) => {
            const current = latestProject.current;
            // A line edited meanwhile keeps its new text; its cached audio stays reusable.
            if (
              !current.nodes.some(
                (node) => node.id === nodeId && plainText(node.text).trim() === text,
              )
            )
              return;
            const next = {
              ...current,
              nodes: current.nodes.map((node) =>
                node.id === nodeId
                  ? {
                      ...node,
                      audioSrc: result.audioSrc,
                      cueUrl: result.cueUrl,
                      audioDuration: result.duration, textTimings: undefined,
                    }
                  : node,
              ),
            };
            // Results can arrive before React re-renders; never patch a stale project.
            latestProject.current = next;
            onChange(next, true);
          }}
        />
      )}
      {importingScript && (
        <ScriptImport
          project={project}
          afterNodeId={selected?.id}
          onClose={() => setImportingScript(false)}
          onImport={(next, firstId, count) => {
            onChange(next, true);
            setImportingScript(false);
            setMode("edit");
            if (firstId) select(firstId);
            onNotice(
              `${count} scene${count === 1 ? "" : "s"} imported from your script.`,
            );
          }}
        />
      )}
    </section>
  );
}
