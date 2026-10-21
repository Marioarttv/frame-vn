import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRightLeft, LoaderCircle, Play } from "lucide-react";
import { projectAssetRefs, type Project } from "../../engine";
import { resolveAssetUrl } from "../../engine/asset-urls";

export interface ActorPatch {
  characterId: string;
  position?: number;
  y?: number;
  scale?: number;
}

interface Props {
  project: Project;
  nodeId: string;
  selectedActor?: string;
  onActorChange: (patch: ActorPatch) => void;
  /** An empty ID means the empty stage was clicked. */
  onSelectActor: (characterId: string) => void;
  /** A character dragged from the studio was dropped at a stage position. */
  onDropCharacter?: (characterId: string, position: number) => void;
  /** Someone on stage was double-clicked. */
  onSpeak?: (characterId: string) => void;
  /** When set, the stage can play the change from this scene into the current one. */
  previousNodeId?: string;
  hint?: string;
  /** Shown over the stage, e.g. for scenes players never see. */
  overlay?: ReactNode;
}

/**
 * The scene as players will see it: the real story player in its editable stage mode.
 * Characters can be dragged into place (the wheel changes depth); Play performs the scene.
 */
export function LiveStage({
  project,
  nodeId,
  selectedActor,
  onActorChange,
  onSelectActor,
  onDropCharacter,
  onSpeak,
  previousNodeId,
  hint = "Drag characters to place them · scroll over one to change depth",
  overlay,
}: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [html, setHtml] = useState<string>();
  const [ready, setReady] = useState(false);
  const handlers = useRef({ onActorChange, onSelectActor, onDropCharacter, onSpeak });
  handlers.current = { onActorChange, onSelectActor, onDropCharacter, onSpeak };
  const latest = useRef({ project, nodeId, selectedActor });
  latest.current = { project, nodeId, selectedActor };

  // The player runtime is large, so it loads with the first stage rather than the studio.
  useEffect(() => {
    let active = true;
    void import("../../player/document").then(({ createPlayerDocument }) => {
      if (!active) return;
      const { project: current, nodeId: start } = latest.current;
      setHtml(
        createPlayerDocument(current, {}, { mode: "stage", startNodeId: start }),
      );
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const message = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as Record<string, unknown> | null;
      if (data?.type === "frame-stage:ready") setReady(true);
      else if (
        data?.type === "frame-stage:actor" &&
        typeof data.characterId === "string"
      ) {
        const patch: ActorPatch = { characterId: data.characterId };
        for (const key of ["position", "y", "scale"] as const)
          if (typeof data[key] === "number" && Number.isFinite(data[key]))
            patch[key] = data[key] as number;
        handlers.current.onActorChange(patch);
      } else if (
        data?.type === "frame-stage:select" &&
        typeof data.characterId === "string"
      )
        handlers.current.onSelectActor(data.characterId);
      else if (
        data?.type === "frame-stage:drop" &&
        typeof data.characterId === "string" &&
        typeof data.position === "number" &&
        Number.isFinite(data.position)
      )
        handlers.current.onDropCharacter?.(data.characterId, data.position);
      else if (data?.type === "frame-stage:speak" && typeof data.characterId === "string")
        handlers.current.onSpeak?.(data.characterId);
    };
    window.addEventListener("message", message);
    return () => window.removeEventListener("message", message);
  }, []);

  const send = (animate: boolean, fromNodeId?: string) => {
    const target = frame.current?.contentWindow;
    if (!target || !ready) return;
    const { project: current, nodeId: id, selectedActor: selected } =
      latest.current;
    const assets = Object.fromEntries(
      [...projectAssetRefs(current)].map((ref) => [ref, resolveAssetUrl(ref)]),
    );
    target.postMessage(
      {
        type: "frame-stage:show",
        project: current,
        assets,
        nodeId: id,
        animate,
        fromNodeId,
        selected,
      },
      "*",
    );
  };

  useEffect(() => {
    send(false);
    // send reads the latest values through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, nodeId, selectedActor, ready]);

  return (
    <div className="live-stage">
      {html ? (
        <iframe
          ref={frame}
          title="Live scene"
          srcDoc={html}
          allow="autoplay"
        />
      ) : (
        <div className="live-stage-loading">
          <LoaderCircle size={18} className="spin" /> Preparing the stage…
        </div>
      )}
      {overlay}
      <div className="live-stage-actions">
        <button
          className="button small live-stage-play"
          disabled={!ready}
          onClick={() => send(true)}
          title="Perform this scene: entrances, transition, typing and voice"
        >
          <Play size={13} fill="currentColor" /> Perform scene
        </button>
        {previousNodeId && (
          <button
            className="button small live-stage-play"
            disabled={!ready}
            onClick={() => send(true, previousNodeId)}
            title="Play the change from the previous shot into this one"
          >
            <ArrowRightLeft size={13} /> From previous shot
          </button>
        )}
      </div>
      <span className="live-stage-hint">{hint}</span>
    </div>
  );
}
