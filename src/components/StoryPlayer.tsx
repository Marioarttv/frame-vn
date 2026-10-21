import { useEffect, useRef, useState } from "react";
import { projectAssetRefs, requireValidProject } from "../engine";
import type { Project } from "../engine/types";
import { resolveAssetUrl } from "../engine/asset-urls";
import { createPlayerDocument } from "../player/document";

export interface StoryPlayerProps {
  project: Project;
  /** Begin from this scene instead of the opening scene. */
  startNodeId?: string;
  onClose: () => void;
}

/**
 * The preview runs the exact player that exported games use, in a same-origin frame.
 * Stored media is passed as this page's object URLs; studio URLs load directly.
 */
export function StoryPlayer({
  project,
  startNodeId,
  onClose,
}: StoryPlayerProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
  // The preview shows the story as it was when opened.
  const [document] = useState(() => {
    try {
      const valid = requireValidProject(project);
      const assets = Object.fromEntries(
        [...projectAssetRefs(valid)].map((ref) => [ref, resolveAssetUrl(ref)]),
      );
      return {
        html: createPlayerDocument(valid, assets, {
          mode: "preview",
          startNodeId,
        }),
      };
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "This story cannot play yet.",
      };
    }
  });

  useEffect(() => {
    const focused = globalThis.document.activeElement;
    const previousOverflow = globalThis.document.body.style.overflow;
    globalThis.document.body.style.overflow = "hidden";
    const message = (event: MessageEvent) => {
      if (
        event.source === frame.current?.contentWindow &&
        event.data?.type === "frame-player:close"
      )
        closeHandler.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeHandler.current();
    };
    window.addEventListener("message", message);
    globalThis.document.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("message", message);
      globalThis.document.removeEventListener("keydown", key);
      globalThis.document.body.style.overflow = previousOverflow;
      if (focused instanceof HTMLElement && focused.isConnected)
        focused.focus();
    };
  }, []);

  return (
    <div
      className="story-preview"
      role="dialog"
      aria-modal="true"
      aria-label={project.title || "Story preview"}
    >
      {"html" in document ? (
        <iframe
          ref={frame}
          title="Story preview"
          srcDoc={document.html}
          allow="autoplay; fullscreen"
          onLoad={() => frame.current?.contentWindow?.focus()}
        />
      ) : (
        <div className="story-preview-error" role="alert">
          <p>{document.error}</p>
          <button className="button" onClick={onClose}>
            Close preview
          </button>
        </div>
      )}
    </div>
  );
}
