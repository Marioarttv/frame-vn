/**
 * Storyboard editing: each shot is one scene, and the people on stage are its speaker plus
 * its cast. These helpers keep the two in step (a listener who starts talking takes the
 * speaker's slot and the speaker stays on stage) and keep the story connected when shots are
 * added or reordered. All of them are pure and return patches or new projects.
 */
import { createId } from "./editing";
import { STAGE_MARKS } from "./staging";
import type {
  ActorStaging,
  Character,
  NodeBase,
  Project,
  StageActor,
  StoryNode,
} from "./types";
import { MAX_STAGE_ACTORS } from "./validation";

/** Everyone on stage in one shot, speaker first. */
export interface ShotActor extends StageActor {
  speaking: boolean;
}

const STAGING_KEYS = ["y", "scale", "enter", "exit", "emote"] as const;
const NO_AUDIO = { audioSrc: undefined, cueUrl: undefined, audioDuration: undefined, textTimings: undefined };

export function shotActors(node: NodeBase): ShotActor[] {
  const actors: ShotActor[] = [];
  if (node.characterId)
    actors.push({ ...speakerAsActor(node), speaking: true });
  for (const actor of node.cast ?? [])
    if (!actors.some((item) => item.characterId === actor.characterId))
      actors.push({ ...actor, speaking: false });
  return actors;
}

function speakerAsActor(node: NodeBase): StageActor {
  const actor: StageActor = {
    characterId: node.characterId!,
    position: node.position,
  };
  if (node.poseId) actor.poseId = node.poseId;
  if (node.flip) actor.flip = true;
  for (const key of STAGING_KEYS)
    if (node[key] !== undefined) (actor as unknown as Record<string, unknown>)[key] = node[key];
  return actor;
}

/** The speaker fields of a node, filled from an actor (or cleared for narration). */
function speakerFields(actor?: StageActor): Partial<NodeBase> {
  const fields: Partial<NodeBase> = {
    characterId: actor?.characterId,
    poseId: actor?.poseId,
    flip: actor?.flip ? true : undefined,
  };
  if (actor) fields.position = actor.position;
  for (const key of STAGING_KEYS)
    (fields as Record<string, unknown>)[key] = actor?.[key];
  return fields;
}

const listOrUndefined = (cast: StageActor[]) => (cast.length ? cast : undefined);

/** The free stage mark nearest to where a newcomer would naturally stand. */
export function freeMark(node: NodeBase, prefer?: number): number {
  const taken = shotActors(node).map((actor) => actor.position);
  const target = prefer ?? (node.characterId ? 100 - node.position : 50);
  const marks = STAGE_MARKS.map((mark) => mark.position);
  const free = marks.filter((mark) => !taken.some((used) => Math.abs(used - mark) < 12));
  return [...(free.length ? free : marks)].sort(
    (a, b) => Math.abs(a - target) - Math.abs(b - target),
  )[0];
}

/**
 * Makes someone the speaker. A listener steps up from the cast; anyone else walks on at a free
 * mark. The previous speaker stays on stage as a listener. A new voice needs a new recording.
 */
export function setSpeaker(
  node: NodeBase,
  character: Pick<Character, "id" | "poses"> | undefined,
): Partial<NodeBase> | { error: string } {
  if ((character?.id ?? undefined) === node.characterId) return {};
  const cast = (node.cast ?? []).filter((actor) => actor.characterId !== character?.id);
  if (node.characterId) cast.unshift(speakerAsActor(node));
  // The former speaker stays as a listener, so a full stage has no room for them.
  if (cast.length > MAX_STAGE_ACTORS)
    return {
      error: `The stage is full. Take someone off stage first; at most ${MAX_STAGE_ACTORS + 1} people fit.`,
    };
  const listener = node.cast?.find((actor) => actor.characterId === character?.id);
  const incoming: StageActor | undefined = character
    ? (listener ?? {
        characterId: character.id,
        poseId: character.poses[0]?.id,
        position: freeMark(node),
      })
    : undefined;
  return {
    ...speakerFields(incoming),
    cast: listOrUndefined(cast),
    ...NO_AUDIO,
  };
}

/** Brings a character on stage. An empty shot gets them as its speaker. */
export function addToShot(
  node: NodeBase,
  character: Pick<Character, "id" | "poses">,
  position?: number,
): Partial<NodeBase> | { error: string } {
  if (shotActors(node).some((actor) => actor.characterId === character.id))
    return position === undefined ? {} : placeActor(node, character.id, { position });
  const actor: StageActor = {
    characterId: character.id,
    poseId: character.poses[0]?.id,
    position: Math.round(position ?? freeMark(node)),
  };
  if (!node.characterId && !node.cast?.length)
    return { ...speakerFields(actor), ...NO_AUDIO };
  if ((node.cast?.length ?? 0) >= MAX_STAGE_ACTORS)
    return { error: `At most ${MAX_STAGE_ACTORS + 1} characters fit on stage.` };
  return { cast: [...(node.cast ?? []), actor] };
}

/** Takes a character off stage. Without its speaker a shot becomes narration. */
export function removeFromShot(node: NodeBase, characterId: string): Partial<NodeBase> {
  if (node.characterId === characterId)
    return { ...speakerFields(undefined), ...NO_AUDIO };
  return {
    cast: listOrUndefined((node.cast ?? []).filter((actor) => actor.characterId !== characterId)),
  };
}

export type Placement = Partial<ActorStaging> & {
  position?: number;
  flip?: boolean;
  poseId?: string;
};

/** Changes where and how one person stands, whether they speak or listen. */
export function placeActor(
  node: NodeBase,
  characterId: string,
  placement: Placement,
): Partial<NodeBase> {
  const clean = { ...placement };
  if (clean.position !== undefined) clean.position = Math.round(clean.position);
  if (clean.scale !== undefined && Math.abs(clean.scale - 1) < 0.001) clean.scale = undefined;
  if (clean.y === 0) clean.y = undefined;
  if ("flip" in clean && !clean.flip) clean.flip = undefined;
  if (node.characterId === characterId) return clean as Partial<NodeBase>;
  return {
    cast: (node.cast ?? []).map((actor) =>
      actor.characterId === characterId ? { ...actor, ...clean } : actor,
    ),
  };
}

/**
 * A new shot after `afterId` that continues the same stage. In a conversation the next line
 * usually belongs to someone who is listening, so the most recent listener becomes the
 * speaker and everyone keeps their place.
 */
export function insertShot(
  project: Project,
  afterId: string | undefined,
): { project: Project; id: string } {
  const index = project.nodes.findIndex((node) => node.id === afterId);
  const source = index >= 0 ? project.nodes[index] : undefined;
  const id = createId("scene");
  let shot: StoryNode = {
    id,
    type: "dialogue",
    label: `Shot ${project.nodes.length + 1}`,
    text: "",
    position: 50,
    // A shot on the studio backdrop continues on the backdrop.
    backgroundId: source ? source.backgroundId : project.backgrounds[0]?.id,
    nextId: source?.type === "dialogue" ? source.nextId : null,
  };
  if (source) {
    for (const key of ["textbox", "textEffect", "weather", "grade", "backgroundMotion", "camera"] as const)
      if (source[key] !== undefined) (shot as unknown as Record<string, unknown>)[key] = structuredClone(source[key]);
    // Gestures and entrances belong to the moment they were written for.
    const strip = (actor: StageActor): StageActor => {
      const { emote: _emote, enter: _enter, ...rest } = actor;
      return rest;
    };
    const actors = shotActors(source).map(({ speaking: _speaking, ...actor }) => strip(actor));
    const nextSpeaker = actors.find((actor) => actor.characterId !== source.characterId);
    const speaker = source.characterId && nextSpeaker ? nextSpeaker : actors[0];
    shot = {
      ...shot,
      ...speakerFields(speaker),
      cast: listOrUndefined(actors.filter((actor) => actor !== speaker)),
    } as StoryNode;
  } else if (project.characters[0]) {
    const first = project.characters[0];
    shot = { ...shot, characterId: first.id, poseId: first.poses[0]?.id };
  }
  shot = Object.fromEntries(
    Object.entries(shot).filter(([, value]) => value !== undefined),
  ) as unknown as StoryNode;
  const nodes = [...project.nodes];
  if (source?.type === "dialogue") nodes[index] = { ...source, nextId: id };
  nodes.splice(index + 1, 0, shot);
  return {
    project: { ...project, nodes, startNodeId: project.startNodeId || id },
    id,
  };
}

/**
 * Moves a shot to a new place in the reading order. Dialogue that led into it now continues
 * to the shot after it, and the shot is linked in between its new neighbours. Choices and
 * branches keep pointing at it wherever it goes.
 */
export function moveShot(project: Project, id: string, toIndex: number): Project {
  const from = project.nodes.findIndex((node) => node.id === id);
  if (from < 0) return project;
  const target = Math.max(0, Math.min(project.nodes.length - 1, toIndex));
  if (target === from) return project;
  const moving = project.nodes[from];
  // A shot with a single follow-on can be lifted out cleanly; others only change position.
  const linear = moving.type === "dialogue";
  let nodes = project.nodes.filter((node) => node.id !== id);
  let startNodeId = project.startNodeId;
  let moved: StoryNode = moving;
  if (linear) {
    const successor = moving.nextId;
    nodes = nodes.map((node) =>
      node.type === "dialogue" && node.nextId === id
        ? { ...node, nextId: successor && successor !== node.id ? successor : null }
        : node,
    );
    if (startNodeId === id && successor) startNodeId = successor;
    const before = nodes[target - 1];
    const after = nodes[target];
    if (before?.type === "dialogue") {
      moved = { ...moving, nextId: before.nextId };
      nodes = nodes.map((node) => (node.id === before.id ? { ...before, nextId: id } : node));
    } else if (!before && after) {
      moved = { ...moving, nextId: after.id };
      if (startNodeId === after.id) startNodeId = id;
    } else moved = { ...moving, nextId: after?.id ?? null };
  }
  nodes.splice(target, 0, moved);
  return { ...project, nodes, startNodeId };
}

/** How one shot leads into the next card on the strip. */
export type ShotLink = "continues" | "jumps" | "choice" | "ends";
export function shotLink(node: StoryNode, next: StoryNode | undefined): ShotLink {
  if (node.type === "end") return "ends";
  if (node.type === "choice" || node.type === "branch") return "choice";
  if (!node.nextId) return "ends";
  return node.nextId === next?.id ? "continues" : "jumps";
}
