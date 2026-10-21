import { useState } from "react";
import { Plus, Search, UserPlus } from "lucide-react";
import { shotActors, type NodeBase, type Project } from "../../engine";
import { FaceThumb } from "./faces";

export const CHARACTER_TYPE = "application/x-frame-character";

interface Props {
  project: Project;
  node?: NodeBase;
  selectedActor?: string;
  onPick: (characterId: string) => void;
  onNewCharacter: () => void;
}

/** Everyone in the project. Drag a character onto the stage, or click to bring them on. */
export function CastDock({ project, node, selectedActor, onPick, onNewCharacter }: Props) {
  const [filter, setFilter] = useState("");
  const onStage = new Map((node ? shotActors(node) : []).map((actor) => [actor.characterId, actor]));
  const visible = project.characters.filter((character) =>
    character.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  return (
    <aside className="board-cast" aria-label="Cast">
      <div className="board-section-head">
        <span>Cast</span>
        <span className="board-count">{project.characters.length}</span>
        <button className="board-icon" onClick={onNewCharacter} title="New character" aria-label="New character">
          <UserPlus size={14} />
        </button>
      </div>
      {project.characters.length > 6 && (
        <label className="cast-search">
          <Search size={13} />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Find someone"
            aria-label="Find a character"
          />
        </label>
      )}
      <ul className="cast-list">
        {visible.map((character) => {
          const actor = onStage.get(character.id);
          return (
            <li key={character.id}>
              <button
                className={`cast-card ${actor ? "is-on-stage" : ""} ${selectedActor === character.id ? "is-selected" : ""}`}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(CHARACTER_TYPE, character.id);
                  event.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onPick(character.id)}
                style={{ ["--tint" as string]: character.color }}
                title={actor ? `Select ${character.name}` : `Bring ${character.name} on stage`}
              >
                <FaceThumb character={character} pose={character.poses.find((pose) => pose.id === actor?.poseId) ?? character.poses[0]} />
                <span className="cast-copy">
                  <strong>{character.name}</strong>
                  <small>
                    {actor
                      ? actor.speaking
                        ? "Speaking"
                        : "On stage"
                      : `${character.poses.length} expression${character.poses.length === 1 ? "" : "s"}`}
                  </small>
                </span>
                {actor ? <i className={`cast-dot ${actor.speaking ? "is-speaking" : ""}`} /> : <Plus size={14} className="cast-add" />}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="board-hint">
        Drag someone onto the stage or click to bring them on. On stage: drag to move, scroll for
        depth, double-click to give them the line.
      </p>
    </aside>
  );
}
