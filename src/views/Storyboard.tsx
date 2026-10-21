import { useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  ChevronLeft,
  ChevronRight,
  Copy,
  Play,
  Trash2,
  Video,
} from "lucide-react";
import {
  addToShot,
  createId,
  duplicateNode,
  insertShot,
  moveShot,
  placeActor,
  plainText,
  removeFromShot,
  removeNode,
  setSpeaker,
  shotActors,
  validateProject,
  type Character,
  type NodeBase,
  type Project,
  type StoryNode,
} from "../engine";
import { importBackgroundMedia, nameFromFile } from "../studio/media";
import { LiveStage, type ActorPatch } from "../components/scene/LiveStage";
import { VoiceBatch } from "../components/scene/VoiceBatch";
import { CastDock } from "../components/board/CastDock";
import { Filmstrip } from "../components/board/Filmstrip";
import { ActorInspector } from "../components/board/ActorInspector";
import { ShotInspector } from "../components/board/ShotInspector";
import { LineEditor } from "../components/board/LineEditor";
import type { VoiceResult } from "../components/VoiceWorkbench";
import "../components/board/board.css";

interface Props {
  project: Project;
  onChange: (project: Project, discrete?: boolean) => void;
  onPlay: (startNodeId?: string) => void;
  onRender: (startNodeId?: string) => void;
  onNotice: (message: string) => void;
  onNewCharacter: () => void;
  onOpenScene: (nodeId: string) => void;
  initialNodeId?: string;
}

/** The shot that usually plays right before `id`: what leads into it on the way through. */
function previousOf(project: Project, id: string): StoryNode | undefined {
  return (
    project.nodes.find((node) => node.id !== id && node.type === "dialogue" && node.nextId === id) ??
    project.nodes.find(
      (node) =>
        node.id !== id &&
        ((node.type === "choice" && node.choices.some((choice) => choice.nextId === id)) ||
        (node.type === "branch" &&
          (node.elseId === id || node.branches.some((branch) => branch.nextId === id)))),
    )
  );
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * The director's view of a story: a live stage to block each shot on, the line with its face
 * and voice beneath it, every option for the shot or the selected person on the right, and
 * the whole story as a filmstrip of shots with their transitions.
 */
export function Storyboard({
  project,
  onChange,
  onPlay,
  onRender,
  onNotice,
  onNewCharacter,
  onOpenScene,
  initialNodeId,
}: Props) {
  const [selectedId, setSelectedId] = useState(() =>
    project.nodes.some((node) => node.id === initialNodeId) ? initialNodeId! : project.startNodeId,
  );
  const [selectedActor, setSelectedActor] = useState<string>();
  const [voicing, setVoicing] = useState(false);
  const latest = useRef(project);
  latest.current = project;

  const index = Math.max(0, project.nodes.findIndex((node) => node.id === selectedId));
  const node = project.nodes[index];
  const previous = node ? previousOf(project, node.id) : undefined;
  const validation = useMemo(() => validateProject(project), [project]);
  const problems = useMemo(() => {
    const ids = new Set<string>();
    for (const issue of validation.errors) {
      const match = /^nodes\[(\d+)\]/.exec(issue.path);
      if (match) ids.add(project.nodes[Number(match[1])]?.id);
    }
    return ids;
  }, [validation, project.nodes]);
  const actors = node ? shotActors(node) : [];
  const actor = actors.find((item) => item.characterId === selectedActor);
  const actorCharacter = actor && project.characters.find((item) => item.id === actor.characterId);
  const missingVoices = project.nodes.filter(
    (item) => item.characterId && !item.audioSrc && plainText(item.text).trim(),
  ).length;

  useEffect(() => {
    if (!project.nodes.some((item) => item.id === selectedId) && project.nodes[0])
      setSelectedId(project.nodes[0].id);
  }, [project.nodes, selectedId]);
  useEffect(() => {
    if (selectedActor && !actors.some((item) => item.characterId === selectedActor))
      setSelectedActor(undefined);
  });

  const select = (id: string) => {
    setSelectedId(id);
    setSelectedActor((current) =>
      current && shotActors(project.nodes.find((item) => item.id === id) ?? node).some((item) => item.characterId === current)
        ? current
        : undefined,
    );
  };
  const patchShot = (id: string, patch: Partial<NodeBase>, discrete = false) => {
    const current = latest.current;
    const next = {
      ...current,
      nodes: current.nodes.map((item) => (item.id === id ? ({ ...item, ...patch } as StoryNode) : item)),
    };
    latest.current = next;
    onChange(next, discrete);
  };
  // Empty patches would only add undo steps that seem to do nothing.
  const patch = (value: Partial<NodeBase>, discrete = false) =>
    node && Object.keys(value).length > 0 && patchShot(node.id, value, discrete);
  /**
   * A finished voice take belongs to the shot it was made for, even if another shot is open by
   * now. It attaches only while that shot still has the same speaker and words.
   */
  const attachTake = (nodeId: string, characterId: string, spoken: string, result: VoiceResult) => {
    const target = latest.current.nodes.find((item) => item.id === nodeId);
    if (!target || target.characterId !== characterId || plainText(target.text).trim() !== spoken) {
      onNotice("The line changed while its voice was being made. The take is kept in Voice studio history.");
      return;
    }
    patchShot(nodeId, { audioSrc: result.audioSrc, cueUrl: result.cueUrl, audioDuration: result.duration, textTimings: undefined }, true);
  };
  const updateCharacter = (character: Character) =>
    onChange({
      ...project,
      characters: project.characters.map((item) => (item.id === character.id ? character : item)),
    });

  const bringOn = (characterId: string, position?: number) => {
    const character = project.characters.find((item) => item.id === characterId);
    if (!character || !node) return;
    const result = addToShot(node, character, position);
    if ("error" in result) return onNotice(result.error);
    patch(result, true);
    setSelectedActor(characterId);
  };
  const giveLine = (characterId: string | undefined) => {
    if (!node) return;
    const character = project.characters.find((item) => item.id === characterId);
    const result = setSpeaker(node, character);
    if ("error" in result) return onNotice(result.error);
    patch(result, true);
    if (node.audioSrc && characterId !== node.characterId)
      onNotice("The line has a new speaker, so its old recording was removed.");
  };
  const addShot = (afterId: string | undefined) => {
    const result = insertShot(project, afterId);
    onChange(result.project, true);
    setSelectedId(result.id);
    setSelectedActor(undefined);
    const source = project.nodes.find((item) => item.id === afterId);
    if (source && source.type !== "dialogue")
      onNotice(
        source.type === "end"
          ? "New shot added after the ending. Nothing leads to it yet; connect it in the scene builder."
          : "New shot added. Choices and branches pick their own paths: point one at it in the scene builder.",
      );
  };
  const deleteShot = () => {
    if (!node || project.nodes.length < 2) return;
    const next = removeNode(project, node.id);
    onChange(next, true);
    setSelectedId(next.nodes[Math.min(index, next.nodes.length - 1)].id);
    onNotice("Shot removed. Use Undo to bring it back.");
  };
  const duplicateShot = () => {
    if (!node) return;
    const result = duplicateNode(project, node.id);
    // A copy right after the original continues from it.
    const copy = result.project.nodes.find((item) => item.id === result.nodeId)!;
    const nodes = result.project.nodes.map((item) =>
      item.id === node.id && item.type === "dialogue"
        ? { ...item, nextId: copy.id }
        : item.id === copy.id && copy.type === "dialogue" && node.type === "dialogue"
          ? { ...copy, nextId: node.nextId }
          : item,
    );
    onChange({ ...result.project, nodes }, true);
    setSelectedId(copy.id);
  };
  const importBackground = async (file: File) => {
    if (!node) return;
    try {
      const media = await importBackgroundMedia(file);
      const background = { id: createId("background"), name: nameFromFile(file, "Background"), ...media };
      const current = latest.current;
      onChange(
        {
          ...current,
          backgrounds: [...current.backgrounds, background],
          nodes: current.nodes.map((item) =>
            item.id === node.id ? { ...item, backgroundId: background.id } : item,
          ),
        },
        true,
      );
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "The background could not be imported.");
    }
  };
  const onActorChange = ({ characterId, ...placement }: ActorPatch) => {
    if (node) patch(placeActor(node, characterId, placement));
  };

  // Arrow keys walk the filmstrip; Escape returns from a person to the shot.
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (typing(event.target) || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented)
        return;
      // Pickers and popovers keep their own arrow keys and Escape.
      if (
        event.target instanceof Element &&
        event.target.closest('[role="radiogroup"],[role="dialog"]')
      )
        return;
      if (document.querySelector(".board .joint-popover, .fx-menu")) return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        const next = project.nodes[index + (event.key === "ArrowRight" ? 1 : -1)];
        if (next) {
          event.preventDefault();
          select(next.id);
        }
      } else if (event.key === "Escape") setSelectedActor(undefined);
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });

  if (!node) return null;
  return (
    <section className="board" aria-label="Storyboard">
      <header className="board-head">
        <div className="board-title">
          <span className="board-kicker">Storyboard</span>
          <strong>{project.title || "Untitled story"}</strong>
        </div>
        <div className="board-shot-nav">
          <button className="board-icon" disabled={index === 0} onClick={() => select(project.nodes[index - 1].id)} aria-label="Previous shot">
            <ChevronLeft size={16} />
          </button>
          <span>
            Shot <b>{String(index + 1).padStart(2, "0")}</b> of {project.nodes.length}
          </span>
          <button
            className="board-icon"
            disabled={index === project.nodes.length - 1}
            onClick={() => select(project.nodes[index + 1].id)}
            aria-label="Next shot"
          >
            <ChevronRight size={16} />
          </button>
          <span className="board-divider" />
          <button className="board-icon" onClick={duplicateShot} aria-label="Duplicate shot" title="Duplicate shot">
            <Copy size={14} />
          </button>
          <button
            className="board-icon is-danger"
            onClick={deleteShot}
            disabled={project.nodes.length < 2}
            aria-label="Delete shot"
            title="Delete shot"
          >
            <Trash2 size={14} />
          </button>
        </div>
        <div className="board-actions">
          <button className="board-button" onClick={() => setVoicing(true)} disabled={!missingVoices}>
            <AudioLines size={14} /> Voice {missingVoices ? `${missingVoices} missing` : "all done"}
          </button>
          <button className="board-button" disabled={!validation.valid} onClick={() => onPlay(node.id)}>
            <Play size={13} /> Play from here
          </button>
          <button className="board-button" disabled={!validation.valid} onClick={() => onRender(node.id)}>
            <Video size={14} /> Export video
          </button>
          <button className="board-button is-primary" disabled={!validation.valid} onClick={() => onPlay()}>
            <Play size={13} fill="currentColor" /> Play story
          </button>
        </div>
      </header>

      <CastDock
        project={project}
        node={node}
        selectedActor={selectedActor}
        onNewCharacter={onNewCharacter}
        onPick={(id) =>
          actors.some((item) => item.characterId === id) ? setSelectedActor(id) : bringOn(id)
        }
      />

      <div className="board-center">
        <div className="board-stage">
          <LiveStage
            project={project}
            nodeId={node.id}
            selectedActor={selectedActor}
            previousNodeId={previous?.id}
            hint="Drag to place · scroll for depth · double-click to give someone the line"
            onActorChange={onActorChange}
            onSelectActor={(id) => setSelectedActor(id || undefined)}
            onDropCharacter={(id, position) => bringOn(id, position)}
            onSpeak={(id) => giveLine(id)}
          />
        </div>
        <LineEditor
          project={project}
          node={node}
          previous={previous}
          onPatch={patch}
          onTake={attachTake}
          onSpeaker={giveLine}
          onCharacter={updateCharacter}
          onSelectActor={setSelectedActor}
        />
      </div>

      <aside className="board-inspector" aria-label={actor ? "Person on stage" : "Shot settings"}>
        {actor && actorCharacter ? (
          <ActorInspector
            key={actor.characterId}
            character={actorCharacter}
            actor={actor}
            previousPoseId={
              previous ? shotActors(previous).find((item) => item.characterId === actor.characterId)?.poseId : undefined
            }
            onPlace={(placement) => patch(placeActor(node, actor.characterId, placement))}
            onSpeak={() => giveLine(actor.characterId)}
            onRemove={() => {
              patch(removeFromShot(node, actor.characterId), true);
              setSelectedActor(undefined);
            }}
            onClose={() => setSelectedActor(undefined)}
          />
        ) : (
          <ShotInspector
            key={node.id}
            project={project}
            node={node}
            isFirst={project.startNodeId === node.id}
            onPatch={patch}
            onImportBackground={(file) => void importBackground(file)}
            onOpenInSceneBuilder={() => onOpenScene(node.id)}
          />
        )}
      </aside>

      <Filmstrip
        project={project}
        selectedId={node.id}
        problems={problems}
        onSelect={select}
        onInsertAfter={addShot}
        onMove={(id, to) => {
          const moved = moveShot(project, id, to);
          if (moved !== project) onChange(moved, true);
        }}
        onTransition={(id, transition) => patchShot(id, { transition }, true)}
      />

      {voicing && (
        <VoiceBatch
          project={project}
          onClose={() => setVoicing(false)}
          onAttach={(nodeId, result, text) => {
            const current = latest.current;
            if (!current.nodes.some((item) => item.id === nodeId && plainText(item.text).trim() === text)) return;
            patchShot(nodeId, { audioSrc: result.audioSrc, cueUrl: result.cueUrl, audioDuration: result.duration, textTimings: undefined }, true);
          }}
        />
      )}
    </section>
  );
}
