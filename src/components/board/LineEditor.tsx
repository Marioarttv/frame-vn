import { BookOpen, GitBranch } from "lucide-react";
import {
  plainText,
  shotActors,
  type Character,
  type NodeBase,
  type Project,
  type StoryNode,
} from "../../engine";
import { DialogueField } from "../scene/DialogueField";
import type { VoiceResult } from "../VoiceWorkbench";
import { FaceThumb, poseOf } from "./faces";
import { VoiceTake } from "./VoiceTake";

interface Props {
  project: Project;
  node: StoryNode;
  /** The shot before this one in the story, for expression changes. */
  previous?: StoryNode;
  onPatch: (patch: Partial<NodeBase>, discrete?: boolean) => void;
  /** Attaches a finished take to the shot it was made for. */
  onTake: (nodeId: string, characterId: string, spoken: string, result: VoiceResult) => void;
  onSpeaker: (characterId: string | undefined) => void;
  onCharacter: (character: Character) => void;
  onSelectActor: (characterId: string) => void;
}

/** Who says what, with which face, in which voice. */
export function LineEditor({ project, node, previous, onPatch, onTake, onSpeaker, onCharacter, onSelectActor }: Props) {
  const actors = shotActors(node);
  const speaker = project.characters.find((item) => item.id === node.characterId);
  const pose = poseOf(speaker, node.poseId);
  const before = previous && speaker ? shotActors(previous).find((actor) => actor.characterId === speaker.id) : undefined;
  const beforePose = before ? poseOf(speaker, before.poseId) : undefined;
  const changeText = (text: string) => {
    // Direction tags change timing, not the spoken words, so the recording stays.
    const spokenChanged = plainText(text) !== plainText(node.text);
    onPatch(
      spokenChanged ? { text, audioSrc: undefined, cueUrl: undefined, audioDuration: undefined, textTimings: undefined } : { text },
    );
  };
  if (node.type === "branch")
    return (
      <div className="line-editor is-branch">
        <GitBranch size={18} />
        <p>Players never see this shot. It routes the story by its conditions.</p>
      </div>
    );
  return (
    <div className="line-editor" style={{ ["--tint" as string]: speaker?.color ?? "#9aa598" }}>
      <div className="line-cast">
      <div className="line-who" role="radiogroup" aria-label="Who speaks">
        <span className="line-label">Speaks</span>
        {actors.map((actor) => {
          const character = project.characters.find((item) => item.id === actor.characterId);
          if (!character) return null;
          return (
            <button
              key={actor.characterId}
              role="radio"
              aria-checked={actor.speaking}
              className={`who-chip ${actor.speaking ? "is-active" : ""}`}
              style={{ ["--tint" as string]: character.color }}
              onClick={() => (actor.speaking ? onSelectActor(character.id) : onSpeaker(character.id))}
              title={actor.speaking ? `${character.name} has this line` : `Give the line to ${character.name}`}
            >
              <FaceThumb character={character} pose={poseOf(character, actor.poseId)} />
              {character.name}
            </button>
          );
        })}
        <button
          role="radio"
          aria-checked={!node.characterId}
          className={`who-chip is-narrator ${!node.characterId ? "is-active" : ""}`}
          onClick={() => onSpeaker(undefined)}
          title="Narration: nobody on stage speaks"
        >
          <span className="face-thumb">
            <BookOpen size={13} />
          </span>
          Narrator
        </button>
      </div>

      {speaker && (
        <div className="line-faces" role="radiogroup" aria-label={`${speaker.name}'s expression`}>
          <span className="line-label">
            Feels
            {beforePose && beforePose.id !== pose?.id && <small>from {beforePose.name}</small>}
          </span>
          {speaker.poses.map((item) => (
            <button
              key={item.id}
              role="radio"
              aria-checked={item.id === pose?.id}
              className={`face-chip ${item.id === pose?.id ? "is-active" : ""}`}
              onClick={() => onPatch({ poseId: item.id }, true)}
              title={item.name}
            >
              <FaceThumb character={speaker} pose={item} />
              <span>{item.name}</span>
            </button>
          ))}
        </div>
      )}
      </div>

      <DialogueField
        value={node.text}
        rows={2}
        speaker={speaker}
        effects={project.sounds.filter((sound) => sound.kind === "sfx")}
        onChange={changeText}
        placeholder={
          speaker ? `What does ${speaker.name} say?` : "Narration: describe the moment, or set the scene…"
        }
      />

      {node.type === "choice" && (
        <ol className="line-choices">
          {node.choices.map((choice, index) => (
            <li key={choice.id}>
              <span>{index + 1}</span>
              {choice.text || "An empty choice"}
            </li>
          ))}
        </ol>
      )}

      <VoiceTake
        key={`${node.id}:${speaker?.id ?? "narrator"}`}
        character={speaker}
        text={node.text}
        audio={node.audioSrc ? { src: node.audioSrc, duration: node.audioDuration } : undefined}
        onGenerated={(result: VoiceResult, spoken: string) =>
          speaker && onTake(node.id, speaker.id, spoken, result)
        }
        onRemove={() => onPatch({ audioSrc: undefined, cueUrl: undefined, audioDuration: undefined, textTimings: undefined }, true)}
        onVoiceChange={(voiceId) => speaker && onCharacter({ ...speaker, voiceId })}
      />
    </div>
  );
}
