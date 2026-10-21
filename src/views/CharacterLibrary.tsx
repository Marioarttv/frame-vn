import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ImagePlus,
  Layers3,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { Character } from "../engine";
import { resolveAssetUrl } from "../engine/asset-urls";
import { importImage, nameFromFile } from "../studio/media";

export function CharacterLibrary({
  characters,
  onSelect,
  onAdd,
  onUpdate,
  onRemove,
  onNotice,
}: {
  characters: Character[];
  onSelect: (id: string) => void;
  onAdd: () => void;
  onUpdate: (c: Character) => void;
  onRemove: (id: string) => void;
  onNotice: (s: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const poseImport = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<Character>();
  const filtered = characters.filter(
    (c) =>
      c.name.toLowerCase().includes(query.toLowerCase()) &&
      (filter !== "rigged" || c.poses.some((p) => p.animation)),
  );
  async function addPose(file?: File) {
    if (!file || !target) return;
    try {
      const src = await importImage(file);
      onUpdate({
        ...target,
        poses: [
          ...target.poses,
          {
            id: crypto.randomUUID(),
            name: nameFromFile(file, "Expression"),
            src,
          },
        ],
      });
      onNotice(`Expression added to ${target.name}.`);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Could not add expression.");
    }
  }
  return (
    <div className="library-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">MEET YOUR CAST</div>
          <h1>
            Character library<span>.</span>
          </h1>
          <p>
            Familiar faces. New possibilities. One home for every character.
          </p>
        </div>
        <button className="button primary" onClick={onAdd}>
          <Plus size={16} /> Add character
        </button>
      </div>
      <div className="library-toolbar">
        <div className="filter-tabs">
          <button
            aria-pressed={filter === "all"}
            className={filter === "all" ? "selected" : ""}
            onClick={() => setFilter("all")}
          >
            All characters <b>{characters.length}</b>
          </button>
          <button
            aria-pressed={filter === "rigged"}
            className={filter === "rigged" ? "selected" : ""}
            onClick={() => setFilter("rigged")}
          >
            With animation rigs
          </button>
        </div>
        <label className="search-input">
          <Search size={16} />
          <input
            aria-label="Search characters"
            placeholder="Find a character…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button aria-label="Clear search" onClick={() => setQuery("")}>
              <X size={13} />
            </button>
          )}
        </label>
      </div>
      <div className="character-grid">
        {filtered.map((c, i) => (
          <article className="character-card" key={c.id}>
            <button
              className="character-preview"
              style={
                {
                  "--character-color": c.color,
                  "--tile-tone": `${i % 4}`,
                } as React.CSSProperties
              }
              onClick={() => onSelect(c.id)}
            >
              <span className="character-card-index">
                {String(i + 1).padStart(2, "0")}
              </span>
              <img
                src={resolveAssetUrl(c.poses[0].src)}
                alt={c.name}
                loading="lazy"
              />
              <span className="open-lab">
                <ArrowRight size={18} />
              </span>
              {c.poses.some((p) => p.animation) && (
                <span className="rigged-badge">
                  <span /> RIGGED
                </span>
              )}
            </button>
            <div className="character-card-info">
              <button onClick={() => onSelect(c.id)}>
                <h2>{c.name}</h2>
                <p>
                  {c.poses.length} expression{c.poses.length === 1 ? "" : "s"}{" "}
                  <span>·</span>{" "}
                  {c.poses.some((p) => p.animation)
                    ? "Animation rig"
                    : "Portrait"}
                </p>
              </button>
              <button
                className="icon-button"
                title={`Add expression to ${c.name}`}
                aria-label={`Add expression to ${c.name}`}
                onClick={() => {
                  setTarget(c);
                  poseImport.current?.click();
                }}
              >
                <Plus size={17} />
              </button>
              <button
                className="icon-button danger"
                title={`Remove ${c.name}`}
                aria-label={`Remove ${c.name}`}
                onClick={() => onRemove(c.id)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </article>
        ))}
        <button className="add-character-card" onClick={onAdd}>
          <span>
            <Plus size={26} />
          </span>
          <strong>Someone new?</strong>
          <p>Bring a character into your story.</p>
          <small>PNG, WebP, or JPEG</small>
        </button>
      </div>
      {!filtered.length && (
        <p className="empty-result">
          No characters match “{query}”. Try a different name.
        </p>
      )}
      <input
        hidden
        type="file"
        ref={poseImport}
        accept="image/png,image/webp,image/jpeg"
        onChange={(e) => {
          void addPose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <div className="library-footer">
        <Layers3 size={15} />
        <span>
          {characters.reduce((n, c) => n + c.poses.length, 0)} expressions
          across {characters.length} characters. Artwork stays local to your
          workspace.
        </span>
      </div>
    </div>
  );
}

export function AddCharacter({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (c: Character) => void;
}) {
  const [name, setName] = useState("");
  const [src, setSrc] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const modal = useRef<HTMLDivElement>(null);
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    nameInput.current?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeHandler.current();
      if (e.key === "Tab") {
        const items = Array.from(
          modal.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not([hidden]),textarea",
          ) || [],
        );
        if (e.shiftKey && document.activeElement === items[0]) {
          e.preventDefault();
          items.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
          e.preventDefault();
          items[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
      previous?.focus();
    };
  }, []);
  async function handleImage(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      setSrc(await importImage(file));
      setError("");
      if (!name) setName(nameFromFile(file, "").slice(0, 60));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Image could not be imported.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modal}
        className="modal add-character-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-character-title"
      >
        <button
          className="modal-close icon-button"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <div className="eyebrow">A NEW FACE</div>
        <h2 id="add-character-title">Meet your next character.</h2>
        <p>
          Start with a portrait. Add expressions and a voice as your story
          grows.
        </p>
        <button
          className={`image-upload ${src ? "has-image" : ""}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void handleImage(e.dataTransfer.files[0]);
          }}
        >
          {src ? (
            <img src={resolveAssetUrl(src)} alt="New character preview" />
          ) : (
            <>
              <ImagePlus size={30} />
              <strong>Drop your character here</strong>
              <span>or click to choose a file</span>
              <small>PNG, WebP, JPEG · up to 12 MB</small>
            </>
          )}
        </button>
        <input
          hidden
          ref={input}
          type="file"
          accept="image/png,image/webp,image/jpeg"
          onChange={(e) => void handleImage(e.target.files?.[0])}
        />
        <label className="form-field">
          <span>Character name</span>
          <input
            ref={nameInput}
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="What should we call them?"
          />
        </label>
        <label className="form-field">
          <span>
            A little about them <small>optional</small>
          </span>
          <textarea
            value={description}
            maxLength={500}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Personality, role, or a detail worth remembering…"
            rows={2}
          />
        </label>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={!name.trim() || !src || busy}
            onClick={() =>
              onAdd({
                id: crypto.randomUUID(),
                name: name.trim(),
                description,
                color: "#c6d7b8",
                poses: [{ id: "default", name: "Default", src }],
              })
            }
          >
            <Plus size={15} /> Add to library
          </button>
        </div>
        <p className="field-hint">
          New portraits start with breathing. Facial animation requires a
          calibrated rig pack; importing a picture does not invent mouth
          artwork.
        </p>
      </div>
    </div>
  );
}
