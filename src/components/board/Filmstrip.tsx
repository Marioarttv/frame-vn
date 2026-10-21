import { useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  CornerDownRight,
  Flag,
  GitBranch,
  GitFork,
  Mic,
  MicOff,
  Plus,
  Square,
} from "lucide-react";
import {
  TRANSITION_LABELS,
  plainText,
  shotLink,
  type Project,
  type Transition,
} from "../../engine";
import { ShotThumb } from "./ShotThumb";
import { TransitionPicker } from "./pickers";

const SHOT_TYPE = "application/x-frame-shot";
const TRANSITION_SHORT: Partial<Record<Transition, string>> = {
  dissolve: "Dissolve",
  fade: "Fade",
  flash: "Flash",
  "wipe-left": "Wipe ←",
  "wipe-right": "Wipe →",
  "wipe-up": "Wipe ↑",
  "wipe-down": "Wipe ↓",
  iris: "Iris",
  blinds: "Blinds",
  "slide-left": "Push ←",
  "slide-right": "Push →",
  zoom: "Zoom",
  blur: "Focus",
  glitch: "Glitch",
  burn: "Burn",
  seam: "Seam",
};

interface Props {
  project: Project;
  selectedId?: string;
  /** Scene IDs with validation errors. */
  problems: Set<string>;
  onSelect: (id: string) => void;
  onInsertAfter: (id: string | undefined) => void;
  onMove: (id: string, toIndex: number) => void;
  onTransition: (id: string, transition: Transition | undefined) => void;
}

/** The story as a strip of shots. Drag cards to reorder; the joints between them are cuts. */
export function Filmstrip({
  project,
  selectedId,
  problems,
  onSelect,
  onInsertAfter,
  onMove,
  onTransition,
}: Props) {
  const strip = useRef<HTMLOListElement>(null);
  const [dropIndex, setDropIndex] = useState<number>();
  const [dragging, setDragging] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const [picking, setPicking] = useState<{ id: string; index: number; left: number }>();
  useEffect(() => {
    strip.current
      ?.querySelector<HTMLElement>(`[data-shot="${CSS.escape(selectedId ?? "")}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [selectedId]);
  useEffect(() => {
    if (!picking) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setPicking(undefined);
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [picking]);

  const indexAt = (event: React.DragEvent, index: number) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return event.clientX < rect.left + rect.width / 2 ? index : index + 1;
  };
  const characters = new Map(project.characters.map((item) => [item.id, item]));

  return (
    <div className="filmstrip" ref={root}>
      <ol
        ref={strip}
        className="filmstrip-track"
        aria-label="Shots"
        onDragLeave={(event) => {
          if (!strip.current?.contains(event.relatedTarget as Node)) setDropIndex(undefined);
        }}
      >
        {project.nodes.map((node, index) => {
          const character = node.characterId ? characters.get(node.characterId) : undefined;
          const next = project.nodes[index + 1];
          const link = shotLink(node, next);
          const target =
            node.type === "dialogue" && node.nextId
              ? project.nodes.findIndex((item) => item.id === node.nextId)
              : -1;
          const words = plainText(node.text).trim();
          const voiced = !!node.audioSrc;
          const selected = node.id === selectedId;
          return (
            <li
              key={node.id}
              className={`shot ${selected ? "is-selected" : ""} ${dragging === node.id ? "is-dragging" : ""}`}
              data-shot={node.id}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(SHOT_TYPE)) return;
                event.preventDefault();
                setDropIndex(indexAt(event, index));
              }}
              onDrop={(event) => {
                const id = event.dataTransfer.getData(SHOT_TYPE);
                const at = indexAt(event, index);
                setDropIndex(undefined);
                setDragging(undefined);
                if (!id) return;
                event.preventDefault();
                const from = project.nodes.findIndex((item) => item.id === id);
                onMove(id, at > from ? at - 1 : at);
              }}
            >
              {dropIndex === index && <span className="shot-drop before" />}
              {dropIndex === index + 1 && index === project.nodes.length - 1 && (
                <span className="shot-drop after" />
              )}
              <button
                className="shot-card"
                draggable
                aria-current={selected ? "true" : undefined}
                aria-label={`Shot ${index + 1}: ${node.label || "Untitled"}`}
                onClick={() => onSelect(node.id)}
                onDragStart={(event) => {
                  event.dataTransfer.setData(SHOT_TYPE, node.id);
                  event.dataTransfer.effectAllowed = "move";
                  setDragging(node.id);
                }}
                onDragEnd={() => {
                  setDragging(undefined);
                  setDropIndex(undefined);
                }}
                style={{ ["--tint" as string]: character?.color ?? "#8a948a" }}
              >
                <span className="shot-frame">
                  <ShotThumb project={project} node={node} />
                  <span className="shot-number">{String(index + 1).padStart(2, "0")}</span>
                  {project.startNodeId === node.id && (
                    <span className="shot-flag" title="The story starts here">
                      <Flag size={10} /> START
                    </span>
                  )}
                  <span className="shot-badges">
                    {problems.has(node.id) && (
                      <span className="badge-problem" title="This shot needs attention">
                        <CircleAlert size={11} />
                      </span>
                    )}
                    {node.type === "choice" && (
                      <span title="Player choice">
                        <GitBranch size={11} />
                      </span>
                    )}
                    {node.type === "branch" && (
                      <span title="Invisible branch">
                        <GitFork size={11} />
                      </span>
                    )}
                    {node.type === "end" && (
                      <span title="Story ending">
                        <Square size={10} />
                      </span>
                    )}
                    {node.characterId &&
                      words &&
                      (voiced ? (
                        <span className="badge-voiced" title="Voiced">
                          <Mic size={11} />
                        </span>
                      ) : (
                        <span className="badge-silent" title="No voice yet">
                          <MicOff size={11} />
                        </span>
                      ))}
                  </span>
                </span>
                <span className="shot-meta">
                  <span className="shot-speaker">
                    <i />
                    {node.type === "branch"
                      ? "Branch"
                      : node.speaker || character?.name || "Narration"}
                  </span>
                  <span className="shot-line">
                    {node.type === "branch"
                      ? `${node.branches.length} condition${node.branches.length === 1 ? "" : "s"}`
                      : words || "Empty line"}
                  </span>
                </span>
              </button>
              {index < project.nodes.length - 1 || link !== "ends" ? (
                <span className={`shot-joint joint-${link}`}>
                  {link === "continues" && next ? (
                    <button
                      className={`joint-transition ${next.transition ? "has-transition" : ""}`}
                      aria-label={`Transition into shot ${index + 2}: ${TRANSITION_LABELS[next.transition ?? "cut"]}`}
                      aria-expanded={picking?.id === next.id}
                      onClick={(event) => {
                        if (picking?.id === next.id) return setPicking(undefined);
                        const box = root.current!.getBoundingClientRect();
                        const joint = event.currentTarget.getBoundingClientRect();
                        setPicking({
                          id: next.id,
                          index: index + 1,
                          left: joint.left + joint.width / 2 - box.left,
                        });
                      }}
                    >
                      {next.transition ? TRANSITION_SHORT[next.transition] : "Cut"}
                    </button>
                  ) : link === "jumps" ? (
                    <span className="joint-note" title="Continues to a shot elsewhere on the strip">
                      <CornerDownRight size={11} />
                      {target >= 0 ? String(target + 1).padStart(2, "0") : "?"}
                    </span>
                  ) : link === "choice" ? (
                    <span className="joint-note" title="The story forks here">
                      <GitBranch size={11} />
                    </span>
                  ) : (
                    <span className="joint-note" title="The story ends here">
                      <Square size={9} />
                    </span>
                  )}
                  <button
                    className="joint-add"
                    aria-label={`Insert a shot after shot ${index + 1}`}
                    title="Insert a shot here"
                    onClick={() => onInsertAfter(node.id)}
                  >
                    <Plus size={11} />
                  </button>
                </span>
              ) : null}
            </li>
          );
        })}
        <li className="shot shot-new">
          <button
            className="shot-card"
            onClick={() => onInsertAfter(selectedId ?? project.nodes.at(-1)?.id)}
            aria-label="New shot"
          >
            <Plus size={20} />
            <span>New shot</span>
            <small>continues the stage</small>
          </button>
        </li>
      </ol>
      {picking && (
        <div
          className="joint-popover"
          role="dialog"
          aria-label="Choose a transition"
          style={{ left: `clamp(12px, ${picking.left}px - 260px, calc(100% - 532px))` }}
        >
          <div className="joint-popover-head">
            <strong>Into shot {String(picking.index + 1).padStart(2, "0")}</strong>
            <button onClick={() => setPicking(undefined)}>Done</button>
          </div>
          <TransitionPicker
            value={project.nodes.find((item) => item.id === picking.id)?.transition ?? "cut"}
            onChange={(transition) =>
              onTransition(picking.id, transition === "cut" ? undefined : transition)
            }
          />
        </div>
      )}
    </div>
  );
}
