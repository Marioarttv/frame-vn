import type { Project, StoryNode } from "./types";

export function createId(prefix = "scene"): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
}

export function replaceNode(project: Project, node: StoryNode): Project {
  if (!project.nodes.some((candidate) => candidate.id === node.id))
    throw new Error("The scene to update does not exist.");
  return {
    ...project,
    nodes: project.nodes.map((candidate) =>
      candidate.id === node.id ? node : candidate,
    ),
  };
}

export function duplicateNode(
  project: Project,
  nodeId: string,
): { project: Project; nodeId: string } {
  const source = project.nodes.find((node) => node.id === nodeId);
  if (!source) throw new Error("The scene to duplicate does not exist.");
  const copy = structuredClone(source);
  copy.id = createId("scene");
  copy.label = `${copy.label.slice(0, 133)} (copy)`;
  if (copy.type === "choice")
    copy.choices = copy.choices.map((choice) => ({
      ...choice,
      id: createId("choice"),
    }));
  if (copy.type === "branch")
    copy.branches = copy.branches.map((branch) => ({
      ...branch,
      id: createId("branch"),
    }));
  const nodes = [...project.nodes];
  nodes.splice(nodes.findIndex((node) => node.id === nodeId) + 1, 0, copy);
  return { project: { ...project, nodes }, nodeId: copy.id };
}

/**
 * Removing a scene repairs incoming links and the opening scene in one atomic edit.
 * Links bridge to the removed dialogue's successor. Without a single successor, dialogue
 * ends where it was and choices become incomplete drafts; they never jump to an unrelated scene.
 */
export function removeNode(project: Project, nodeId: string): Project {
  const source = project.nodes.find((node) => node.id === nodeId);
  if (!source) throw new Error("The scene to remove does not exist.");
  if (project.nodes.length === 1)
    throw new Error("A project must keep at least one scene.");
  const remaining = project.nodes.filter((node) => node.id !== nodeId);
  const successor =
    source.type === "dialogue" &&
    source.nextId &&
    remaining.some((node) => node.id === source.nextId)
      ? source.nextId
      : undefined;
  return {
    ...project,
    startNodeId:
      project.startNodeId === nodeId
        ? (successor ?? remaining[0].id)
        : project.startNodeId,
    nodes: remaining.map((node) => {
      if (node.type === "dialogue" && node.nextId === nodeId)
        return {
          ...node,
          nextId: successor && successor !== node.id ? successor : null,
        };
      if (node.type === "choice")
        return {
          ...node,
          choices: node.choices.map((choice) =>
            choice.nextId === nodeId
              ? { ...choice, nextId: successor ?? "" }
              : choice,
          ),
        };
      if (node.type === "branch")
        return {
          ...node,
          branches: node.branches.map((branch) =>
            branch.nextId === nodeId
              ? { ...branch, nextId: successor ?? "" }
              : branch,
          ),
          elseId: node.elseId === nodeId ? (successor ?? "") : node.elseId,
        };
      return node;
    }),
  };
}

/** Scenes that show this character (speaking or on stage), optionally in this pose. */
export function characterUsage(
  project: Project,
  characterId: string,
  poseId?: string,
): number {
  const character = project.characters.find((item) => item.id === characterId);
  // Scenes without an explicit pose use the character's first one.
  const matches = (pose: string | undefined) =>
    poseId === undefined ||
    pose === poseId ||
    (!pose && character?.poses[0]?.id === poseId);
  return project.nodes.filter(
    (node) =>
      (node.characterId === characterId && matches(node.poseId)) ||
      node.cast?.some(
        (actor) => actor.characterId === characterId && matches(actor.poseId),
      ),
  ).length;
}

export function backgroundUsage(project: Project, backgroundId: string) {
  return project.nodes.filter((node) => node.backgroundId === backgroundId)
    .length;
}

export function soundUsage(project: Project, soundId: string) {
  return project.nodes.filter(
    (node) =>
      node.musicId === soundId || node.ambienceId === soundId || node.sfxId === soundId,
  ).length;
}

/** Scenes whose effects, choices or branches read or change this variable. */
export function variableUsage(project: Project, variableId: string) {
  const uses = (list?: { variableId: string }[]) =>
    !!list?.some((item) => item.variableId === variableId);
  return project.nodes.filter(
    (node) =>
      uses(node.effects) ||
      (node.type === "choice" &&
        node.choices.some(
          (choice) => uses(choice.conditions) || uses(choice.effects),
        )) ||
      (node.type === "branch" &&
        node.branches.some((branch) => uses(branch.conditions))),
  ).length;
}

/** Destinations a scene can lead to, in display order. */
export function nodeTargets(node: StoryNode): string[] {
  if (node.type === "dialogue") return node.nextId ? [node.nextId] : [];
  if (node.type === "choice")
    return node.choices.map((choice) => choice.nextId);
  if (node.type === "branch")
    return [...node.branches.map((branch) => branch.nextId), node.elseId];
  return [];
}
