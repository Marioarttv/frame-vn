import { FlipHorizontal2, LayoutGrid, Plus, Trash2, Users } from "lucide-react";
import {
  ACTOR_MOTIONS,
  ACTOR_MOTION_LABELS,
  EMOTES,
  EMOTE_LABELS,
  MAX_ACTOR_SCALE,
  MAX_STAGE_ACTORS,
  MIN_ACTOR_SCALE,
  STAGE_MARKS,
  type ActorEmote,
  type ActorMotion,
  type ActorStaging,
  type Character,
  type NodeBase,
  type Project,
  type StageActor,
} from "../../engine";
import { optionalList } from "./LogicEditors";

/** The shared placement controls for the speaker and everyone else on stage. */
type Placement = ActorStaging & { position: number; flip?: boolean };

interface Props {
  project: Project;
  node: NodeBase;
  selectedActor?: string;
  onSelectActor: (characterId: string) => void;
  onPatch: (patch: Partial<NodeBase>, discrete?: boolean) => void;
  onNotice: (message: string) => void;
}

function PlacementControls({
  label,
  positionLabel,
  mirrorLabel,
  value,
  onChange,
}: {
  label: string;
  positionLabel: string;
  mirrorLabel: string;
  value: Placement;
  onChange: (patch: Partial<Placement>) => void;
}) {
  const scale = value.scale ?? 1;
  return (
    <div className="placement">
      <div className="mark-row" role="group" aria-label={`${label} stage mark`}>
        {STAGE_MARKS.map((mark) => (
          <button
            key={mark.label}
            type="button"
            className={Math.abs(value.position - mark.position) < 3 ? "is-active" : ""}
            onClick={() => onChange({ position: mark.position })}
          >
            {mark.label}
          </button>
        ))}
        <button
          type="button"
          className={`icon-button ${value.flip ? "is-active" : ""}`}
          aria-label={mirrorLabel}
          aria-pressed={!!value.flip}
          title="Mirror horizontally"
          onClick={() => onChange({ flip: value.flip ? undefined : true })}
        >
          <FlipHorizontal2 size={14} />
        </button>
      </div>
      <div className="slider-grid">
        <label>
          <span>Position · {value.position}%</span>
          <input
            type="range"
            min="5"
            max="95"
            aria-label={positionLabel}
            value={value.position}
            onChange={(event) => onChange({ position: Number(event.target.value) })}
          />
        </label>
        <label>
          <span>Depth · {Math.round(scale * 100)}%</span>
          <input
            type="range"
            min={MIN_ACTOR_SCALE}
            max={MAX_ACTOR_SCALE}
            step="0.05"
            aria-label={`${label} depth`}
            value={scale}
            onChange={(event) => {
              const next = Number(event.target.value);
              onChange({ scale: Math.abs(next - 1) < 0.001 ? undefined : next });
            }}
          />
        </label>
        <label>
          <span>Height · {value.y ?? 0}%</span>
          <input
            type="range"
            min="-40"
            max="40"
            aria-label={`${label} height`}
            value={value.y ?? 0}
            onChange={(event) => {
              const next = Number(event.target.value);
              onChange({ y: next === 0 ? undefined : next });
            }}
          />
        </label>
      </div>
      <div className="field-grid three-columns compact">
        <label className="form-field">
          <span>Entrance</span>
          <select
            aria-label={`${label} entrance`}
            value={value.enter ?? "fade"}
            onChange={(event) =>
              onChange({
                enter:
                  event.target.value === "fade"
                    ? undefined
                    : (event.target.value as ActorMotion),
              })
            }
          >
            {ACTOR_MOTIONS.map((motion) => (
              <option key={motion} value={motion}>
                {ACTOR_MOTION_LABELS[motion]}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Exit</span>
          <select
            aria-label={`${label} exit`}
            value={value.exit ?? "fade"}
            onChange={(event) =>
              onChange({
                exit:
                  event.target.value === "fade"
                    ? undefined
                    : (event.target.value as ActorMotion),
              })
            }
          >
            {ACTOR_MOTIONS.map((motion) => (
              <option key={motion} value={motion}>
                {ACTOR_MOTION_LABELS[motion]}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Gesture</span>
          <select
            aria-label={`${label} gesture`}
            value={value.emote ?? ""}
            onChange={(event) =>
              onChange({
                emote: (event.target.value || undefined) as ActorEmote | undefined,
              })
            }
          >
            <option value="">None</option>
            {EMOTES.map((emote) => (
              <option key={emote} value={emote}>
                {EMOTE_LABELS[emote]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

function ExpressionSelect({
  character,
  value,
  label,
  onChange,
}: {
  character?: Character;
  value?: string;
  label: string;
  onChange: (poseId: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value ?? character?.poses[0]?.id ?? ""}
      disabled={!character?.poses.length}
      onChange={(event) => onChange(event.target.value)}
    >
      {character?.poses.length ? (
        character.poses.map((pose) => (
          <option key={pose.id} value={pose.id}>
            {pose.name}
          </option>
        ))
      ) : (
        <option value="">No expression</option>
      )}
    </select>
  );
}

/** Speaker and cast placement: marks, depth, height, entrances, exits and gestures. */
export function StagePanel({
  project,
  node,
  selectedActor,
  onSelectActor,
  onPatch,
  onNotice,
}: Props) {
  const character = project.characters.find((item) => item.id === node.characterId);
  const cast = node.cast ?? [];
  const updateCast = (next: StageActor[], discrete = false) =>
    onPatch({ cast: optionalList(next) }, discrete);
  const addActor = () => {
    const present = new Set([node.characterId, ...cast.map((actor) => actor.characterId)]);
    const next = project.characters.find((item) => !present.has(item.id));
    if (!next) return onNotice("Every character is already on stage in this scene.");
    const taken = [
      ...(node.characterId ? [node.position] : []),
      ...cast.map((actor) => actor.position),
    ];
    // Listeners face the speaker from the other side of the stage, then fill the gaps.
    const target = 100 - (node.characterId ? node.position : 50);
    const mark =
      STAGE_MARKS.map((item) => item.position)
        .filter((position) => !taken.some((used) => Math.abs(used - position) < 12))
        .sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0] ?? 50;
    updateCast([...cast, { characterId: next.id, poseId: next.poses[0]?.id, position: mark }], true);
    onSelectActor(next.id);
  };
  /** Spreads everyone on stage evenly, speaker first from the left. */
  const arrange = () => {
    const count = (node.characterId ? 1 : 0) + cast.length;
    if (count < 2) return;
    const slots = Array.from({ length: count }, (_, index) =>
      Math.round(((index + 1) / (count + 1)) * 100),
    );
    let index = 0;
    const patch: Partial<NodeBase> = {};
    if (node.characterId) patch.position = slots[index++];
    patch.cast = cast.map((actor) => ({ ...actor, position: slots[index++] }));
    onPatch(patch, true);
  };

  return (
    <div className="stage-panel">
      <section
        className={`actor-card ${selectedActor && selectedActor === node.characterId ? "is-selected" : ""}`}
        aria-label="Speaker"
      >
        <div className="actor-card-heading">
          <span className="actor-swatch" style={{ background: character?.color ?? "#6b7a72" }} />
          <strong>{character ? character.name : "Narration"}</strong>
          <span className="muted">
            {character
              ? "Speaking · choose who speaks in the Write tab"
              : "No speaker. Choose one in the Write tab, or add listeners below."}
          </span>
        </div>
        {character && (
          <PlacementControls
            label="speaker"
            positionLabel={`Stage position ${node.position}%`}
            mirrorLabel="Mirror speaking character"
            value={node}
            onChange={(patch) => onPatch(patch)}
          />
        )}
      </section>

      <div className="field-heading">
        <span>
          <Users size={13} /> Also on stage
        </span>
        <span className="heading-actions">
          <button
            className="button small"
            disabled={(node.characterId ? 1 : 0) + cast.length < 2}
            onClick={arrange}
            title="Spread everyone evenly across the stage"
          >
            <LayoutGrid size={14} /> Arrange evenly
          </button>
          <button
            className="button small"
            disabled={cast.length >= MAX_STAGE_ACTORS || !project.characters.length}
            onClick={addActor}
          >
            <Plus size={14} /> Add character to stage
          </button>
        </span>
      </div>
      {!cast.length && (
        <p className="field-hint">
          Listeners stay visible while the speaker talks. Add up to {MAX_STAGE_ACTORS}.
        </p>
      )}
      {cast.map((actor, index) => {
        const actorCharacter = project.characters.find((item) => item.id === actor.characterId);
        const update = (patch: Partial<StageActor>) =>
          updateCast(cast.map((item, i) => (i === index ? { ...item, ...patch } : item)));
        return (
          <section
            className={`actor-card ${selectedActor === actor.characterId ? "is-selected" : ""}`}
            key={index}
            aria-label={`Stage card ${index + 1}`}
            onFocusCapture={() => onSelectActor(actor.characterId)}
          >
            <div className="actor-card-heading">
              <span className="actor-swatch" style={{ background: actorCharacter?.color ?? "#6b7a72" }} />
              <select
                aria-label={`On-stage character ${index + 1}`}
                value={actor.characterId}
                onChange={(event) => {
                  const next = project.characters.find((item) => item.id === event.target.value);
                  if (next) update({ characterId: next.id, poseId: next.poses[0]?.id });
                }}
              >
                {!actorCharacter && <option value={actor.characterId}>Missing character</option>}
                {project.characters.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <ExpressionSelect
                character={actorCharacter}
                value={actor.poseId}
                label={`On-stage expression ${index + 1}`}
                onChange={(poseId) => update({ poseId })}
              />
              <button
                className="icon-button danger"
                aria-label={`Remove on-stage character ${index + 1}`}
                onClick={() => updateCast(cast.filter((_, i) => i !== index), true)}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <PlacementControls
              label={`on-stage character ${index + 1}`}
              positionLabel={`On-stage position ${index + 1}`}
              mirrorLabel={`Mirror on-stage character ${index + 1}`}
              value={actor}
              onChange={(patch) => update(patch)}
            />
          </section>
        );
      })}
    </div>
  );
}
