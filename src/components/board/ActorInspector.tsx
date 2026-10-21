import { FlipHorizontal2, Megaphone, UserMinus, X } from "lucide-react";
import {
  ACTOR_MOTIONS,
  ACTOR_MOTION_LABELS,
  EMOTES,
  EMOTE_LABELS,
  MAX_ACTOR_SCALE,
  MIN_ACTOR_SCALE,
  STAGE_MARKS,
  type ActorEmote,
  type ActorMotion,
  type Character,
  type Placement,
  type ShotActor,
} from "../../engine";
import { FaceThumb, poseOf } from "./faces";

interface Props {
  character: Character;
  actor: ShotActor;
  /** The expression this person had in the shot before, if they were on stage. */
  previousPoseId?: string;
  onPlace: (placement: Placement) => void;
  onSpeak: () => void;
  onRemove: () => void;
  onClose: () => void;
}

function Chips<T extends string>({
  label,
  options,
  labels,
  value,
  fallback,
  onChange,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  value?: T;
  fallback?: T;
  onChange: (value: T | undefined) => void;
}) {
  return (
    <div className="board-chips" role="radiogroup" aria-label={label}>
      {!fallback && (
        <button role="radio" aria-checked={!value} className={!value ? "is-active" : ""} onClick={() => onChange(undefined)}>
          None
        </button>
      )}
      {options.map((option) => {
        const active = (value ?? fallback) === option;
        return (
          <button
            key={option}
            role="radio"
            aria-checked={active}
            className={active ? "is-active" : ""}
            onClick={() => onChange(option === fallback ? undefined : option)}
          >
            {labels[option]}
          </button>
        );
      })}
    </div>
  );
}

/** One person on stage: their expression, where they stand, and how they come and go. */
export function ActorInspector({ character, actor, previousPoseId, onPlace, onSpeak, onRemove, onClose }: Props) {
  const pose = poseOf(character, actor.poseId);
  const previous = previousPoseId ? poseOf(character, previousPoseId) : undefined;
  const scale = actor.scale ?? 1;
  return (
    <div className="inspector" style={{ ["--tint" as string]: character.color }}>
      <div className="inspector-hero">
        <FaceThumb character={character} pose={pose} className="is-large" />
        <div>
          <span className="inspector-kicker">{actor.speaking ? "Speaking" : "Listening"}</span>
          <h3>{character.name}</h3>
          <div className="inspector-actions">
            {!actor.speaking && (
              <button onClick={onSpeak} title="Give this line to them">
                <Megaphone size={13} /> Give them the line
              </button>
            )}
            <button className="is-danger" onClick={onRemove} title="Take them off stage">
              <UserMinus size={13} /> Off stage
            </button>
          </div>
        </div>
        <button className="board-icon inspector-close" onClick={onClose} aria-label="Back to the shot">
          <X size={15} />
        </button>
      </div>

      <section className="inspector-section">
        <h4>
          Expression
          {previous && previous.id !== pose?.id && (
            <span className="inspector-note">
              morphs from {previous.name} {actor.speaking ? "before they speak" : "as the shot begins"}
            </span>
          )}
        </h4>
        <div className="expression-grid" role="radiogroup" aria-label={`${character.name}'s expression`}>
          {character.poses.map((item) => (
            <button
              key={item.id}
              role="radio"
              aria-checked={item.id === pose?.id}
              className={item.id === pose?.id ? "is-active" : ""}
              onClick={() => onPlace({ poseId: item.id })}
            >
              <FaceThumb character={character} pose={item} />
              <span>{item.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="inspector-section">
        <h4>Place on stage</h4>
        <div className="mark-track" role="group" aria-label="Stage mark">
          {STAGE_MARKS.map((mark) => (
            <button
              key={mark.label}
              className={Math.abs(actor.position - mark.position) < 3 ? "is-active" : ""}
              style={{ left: `${mark.position}%` }}
              onClick={() => onPlace({ position: mark.position })}
              title={mark.label}
              aria-label={mark.label}
            />
          ))}
          <i className="mark-you" style={{ left: `${actor.position}%` }} />
        </div>
        <div className="board-sliders">
          <label>
            <span>Across</span>
            <input
              type="range"
              min="5"
              max="95"
              value={actor.position}
              aria-label="Position across the stage"
              onChange={(event) => onPlace({ position: Number(event.target.value) })}
            />
            <output>{actor.position}%</output>
          </label>
          <label>
            <span>Depth</span>
            <input
              type="range"
              min={MIN_ACTOR_SCALE}
              max={MAX_ACTOR_SCALE}
              step="0.05"
              value={scale}
              aria-label="Depth"
              onChange={(event) => onPlace({ scale: Number(event.target.value) })}
            />
            <output>{Math.round(scale * 100)}%</output>
          </label>
          <label>
            <span>Height</span>
            <input
              type="range"
              min="-40"
              max="40"
              value={actor.y ?? 0}
              aria-label="Height"
              onChange={(event) => onPlace({ y: Number(event.target.value) })}
            />
            <output>{actor.y ?? 0}%</output>
          </label>
        </div>
        <button
          className={`board-toggle ${actor.flip ? "is-active" : ""}`}
          aria-pressed={!!actor.flip}
          onClick={() => onPlace({ flip: !actor.flip })}
        >
          <FlipHorizontal2 size={14} /> Face the other way
        </button>
      </section>

      <section className="inspector-section">
        <h4>
          Gesture <span className="inspector-note">plays as the shot begins</span>
        </h4>
        <Chips<ActorEmote>
          label="Gesture"
          options={EMOTES}
          labels={EMOTE_LABELS}
          value={actor.emote}
          onChange={(emote) => onPlace({ emote })}
        />
        <h4>
          Entrance <span className="inspector-note">when they were not on stage before</span>
        </h4>
        <Chips<ActorMotion>
          label="Entrance"
          options={ACTOR_MOTIONS}
          labels={ACTOR_MOTION_LABELS}
          value={actor.enter}
          fallback="fade"
          onChange={(enter) => onPlace({ enter })}
        />
        <h4>
          Exit <span className="inspector-note">when the next shot no longer shows them</span>
        </h4>
        <Chips<ActorMotion>
          label="Exit"
          options={ACTOR_MOTIONS}
          labels={ACTOR_MOTION_LABELS}
          value={actor.exit}
          fallback="fade"
          onChange={(exit) => onPlace({ exit })}
        />
      </section>
    </div>
  );
}
