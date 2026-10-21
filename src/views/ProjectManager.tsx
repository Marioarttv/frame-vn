import { useEffect, useRef, useState } from "react";
import {
  BookOpenText,
  Clapperboard,
  Copy,
  FilePlus2,
  FolderOpen,
  HardDrive,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { ProjectTemplate } from "../studio/useWorkspace";
import { storageEstimate, type ProjectSummary } from "../engine";

interface Props {
  currentId: string;
  projects: ProjectSummary[];
  busy: boolean;
  onOpen: (id: string) => void;
  onCreate: (kind: ProjectTemplate) => void;
  onCreateFromTemplate: (src: string) => void;
  onDuplicate: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

export function ProjectManager({
  currentId,
  projects,
  busy,
  onOpen,
  onCreate,
  onCreateFromTemplate,
  onDuplicate,
  onDelete,
  onClose,
}: Props) {
  const [confirming, setConfirming] = useState<string>();
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(
    null,
  );
  const modal = useRef<HTMLDivElement>(null);
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
  useEffect(() => {
    void storageEstimate().then(setUsage);
  }, [projects]);
  const [templates, setTemplates] = useState<
    { id: string; title: string; description: string; scenes: number; src: string }[]
  >([]);
  useEffect(() => {
    let active = true;
    fetch("/api/stories")
      .then((response) => (response.ok ? response.json() : { templates: [] }))
      .then((data) => {
        if (active && Array.isArray(data.templates)) setTemplates(data.templates);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    modal.current?.querySelector<HTMLElement>("button")?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeHandler.current();
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={modal}
        className="modal project-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-manager-title"
      >
        <button
          className="modal-close icon-button"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <div className="eyebrow">YOUR STORIES</div>
        <h2 id="project-manager-title">Projects</h2>
        <p>
          Every project is saved separately in this browser. Shared images and
          recordings are stored once.
        </p>
        <div className="project-create-row">
          <button
            className="button primary small"
            disabled={busy}
            onClick={() => onCreate("blank")}
          >
            <FilePlus2 size={15} /> New blank project
          </button>
          <button
            className="button small"
            disabled={busy}
            onClick={() => onCreate("starter")}
          >
            <Sparkles size={15} /> New from example
          </button>
          <button
            className="button small"
            disabled={busy}
            onClick={() => onCreate("showcase")}
            title="A short tour of every stage effect, text box and transition"
          >
            <Clapperboard size={15} /> New stage tour
          </button>
          <button
            className="button small"
            disabled={busy}
            onClick={onDuplicate}
          >
            <Copy size={15} /> Duplicate current
          </button>
        </div>
        {templates.length > 0 && (
          <div className="template-list" aria-label="Example stories from local packs">
            <span className="eyebrow">EXAMPLE STORIES FROM YOUR LOCAL PACKS</span>
            {templates.map((template) => (
              <button
                key={template.id}
                className="template-card"
                disabled={busy}
                onClick={() => onCreateFromTemplate(template.src)}
              >
                <BookOpenText size={16} />
                <span>
                  <strong>{template.title}</strong>
                  <small>
                    {template.scenes} scenes · {template.description}
                  </small>
                </span>
              </button>
            ))}
          </div>
        )}
        <ul className="project-list" aria-label="Stored projects">
          {projects.map((item) => {
            const current = item.id === currentId;
            return (
              <li key={item.id} className={current ? "is-current" : ""}>
                <div className="project-list-copy">
                  <strong>{item.title || "Untitled project"}</strong>
                  <span>
                    {item.sceneCount} scene{item.sceneCount === 1 ? "" : "s"} ·{" "}
                    {item.characterCount} character
                    {item.characterCount === 1 ? "" : "s"} · Saved{" "}
                    {formatDate(item.savedAt)}
                  </span>
                </div>
                {current ? (
                  <span className="current-label">OPEN</span>
                ) : (
                  <button
                    className="button small"
                    disabled={busy}
                    aria-label={`Open ${item.title || "Untitled project"}`}
                    onClick={() => onOpen(item.id)}
                  >
                    <FolderOpen size={14} /> Open
                  </button>
                )}
                {confirming === item.id ? (
                  <button
                    className="button small danger"
                    disabled={busy}
                    onClick={() => {
                      setConfirming(undefined);
                      onDelete(item.id);
                    }}
                  >
                    Confirm delete
                  </button>
                ) : (
                  <button
                    className="icon-button danger"
                    disabled={busy}
                    aria-label={`Delete ${item.title || "Untitled project"}`}
                    title="Delete project"
                    onClick={() => setConfirming(item.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {!projects.length && (
          <p className="field-hint">Your first project saves automatically.</p>
        )}
        <p className="storage-line">
          <HardDrive size={13} />
          {usage
            ? `${formatBytes(usage.usage)} used on this device${usage.quota ? ` of about ${formatBytes(usage.quota)} available` : ""}.`
            : "Storage usage is unavailable in this browser."}{" "}
          Export project JSON to keep a portable backup.
        </p>
      </div>
    </div>
  );
}
