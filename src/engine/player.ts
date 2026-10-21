import type {
  Choice,
  Condition,
  Effect,
  PlayerSnapshot,
  PlayerState,
  Project,
  StoryNode,
  VariableValue,
} from "./types";

/** Branch scenes resolve instantly; a longer chain than this is treated as a loop. */
const MAX_BRANCH_HOPS = 64;

export function initialVariables(
  project: Project,
): Record<string, VariableValue> {
  return Object.fromEntries(
    project.variables.map((variable) => [variable.id, variable.initial]),
  );
}

export function evaluateCondition(
  variables: Record<string, VariableValue>,
  condition: Condition,
): boolean {
  const current = variables[condition.variableId];
  if (current === undefined) return false;
  switch (condition.operator) {
    case "==":
      return current === condition.value;
    case "!=":
      return current !== condition.value;
    case ">":
      return Number(current) > Number(condition.value);
    case ">=":
      return Number(current) >= Number(condition.value);
    case "<":
      return Number(current) < Number(condition.value);
    case "<=":
      return Number(current) <= Number(condition.value);
  }
}

export function conditionsHold(
  variables: Record<string, VariableValue>,
  conditions: Condition[] | undefined,
): boolean {
  return (conditions ?? []).every((condition) =>
    evaluateCondition(variables, condition),
  );
}

export function applyEffects(
  variables: Record<string, VariableValue>,
  effects: Effect[] | undefined,
): Record<string, VariableValue> {
  if (!effects?.length) return variables;
  const next = { ...variables };
  for (const effect of effects) {
    if (!(effect.variableId in next)) continue;
    next[effect.variableId] =
      effect.operation === "add"
        ? Number(next[effect.variableId]) + Number(effect.value)
        : effect.value;
  }
  return next;
}

function nodeById(project: Project, nodeId: string): StoryNode {
  const node = project.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error("The destination scene does not exist.");
  return node;
}

/**
 * Enters a scene: applies its effects, music and ambience, then follows branch scenes until a visible
 * scene is reached. Branch scenes never appear in history.
 */
export function enterNode(
  project: Project,
  from: Omit<PlayerSnapshot, "nodeId">,
  nodeId: string,
): PlayerSnapshot {
  let variables = from.variables;
  let musicId = from.musicId;
  let ambienceId = from.ambienceId;
  let node = nodeById(project, nodeId);
  for (let hops = 0; ; hops++) {
    if (hops > MAX_BRANCH_HOPS)
      throw new Error("Branches loop without reaching a scene.");
    variables = applyEffects(variables, node.effects);
    if (node.musicId !== undefined) musicId = node.musicId;
    if (node.ambienceId !== undefined) ambienceId = node.ambienceId;
    if (node.type !== "branch") break;
    const matched = node.branches.find((branch) =>
      conditionsHold(variables, branch.conditions),
    );
    node = nodeById(project, matched ? matched.nextId : node.elseId);
  }
  return {
    nodeId: node.id,
    variables,
    musicId,
    ...(ambienceId !== undefined ? { ambienceId } : {}),
  };
}

export function createPlayerState(
  project: Project,
  startNodeId = project.startNodeId,
): PlayerState {
  if (!project.nodes.some((node) => node.id === startNodeId))
    throw new Error("The opening scene does not exist.");
  return {
    ...enterNode(
      project,
      { variables: initialVariables(project), musicId: null },
      startNodeId,
    ),
    history: [],
  };
}

export const restartPlayer = (project: Project) => createPlayerState(project);

export function getCurrentNode(
  project: Project,
  state: Pick<PlayerState, "nodeId">,
): StoryNode {
  const node = project.nodes.find((node) => node.id === state.nodeId);
  if (!node) throw new Error("This scene no longer exists.");
  return node;
}

function snapshot(state: PlayerState): PlayerSnapshot {
  return {
    nodeId: state.nodeId,
    variables: state.variables,
    musicId: state.musicId,
    ...(state.ambienceId !== undefined ? { ambienceId: state.ambienceId } : {}),
  };
}

export function jumpToNode(
  project: Project,
  state: PlayerState,
  nodeId: string,
  variables = state.variables,
): PlayerState {
  if (!project.nodes.some((node) => node.id === nodeId))
    throw new Error("The destination scene does not exist.");
  return {
    ...enterNode(
      project,
      { variables, musicId: state.musicId, ambienceId: state.ambienceId },
      nodeId,
    ),
    history: [...state.history, snapshot(state)],
  };
}

export function advancePlayer(
  project: Project,
  state: PlayerState,
): PlayerState {
  const node = getCurrentNode(project, state);
  if (node.type !== "dialogue" || !node.nextId) return state;
  return jumpToNode(project, state, node.nextId);
}

/** The choices whose conditions hold for the current story state. */
export function availableChoices(
  project: Project,
  state: Pick<PlayerState, "nodeId" | "variables">,
): Choice[] {
  const node = getCurrentNode(project, state);
  if (node.type !== "choice") return [];
  return node.choices.filter((choice) =>
    conditionsHold(state.variables, choice.conditions),
  );
}

export function chooseOption(
  project: Project,
  state: PlayerState,
  choiceId: string,
): PlayerState {
  const node = getCurrentNode(project, state);
  if (node.type !== "choice")
    throw new Error("This scene does not offer a choice.");
  const choice = node.choices.find((choice) => choice.id === choiceId);
  if (!choice) throw new Error("This choice does not exist.");
  if (!conditionsHold(state.variables, choice.conditions))
    throw new Error("This choice is not available.");
  return jumpToNode(
    project,
    state,
    choice.nextId,
    applyEffects(state.variables, choice.effects),
  );
}

export function previousNode(state: PlayerState): PlayerState {
  if (!state.history.length) return state;
  return {
    ...state.history[state.history.length - 1],
    history: state.history.slice(0, -1),
  };
}

export function isEnding(node: StoryNode): boolean {
  return node.type === "end" || (node.type === "dialogue" && !node.nextId);
}
