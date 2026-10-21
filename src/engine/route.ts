/**
 * Plans one route through a story for the video renderer: simulates the engine from a start
 * scene, takes the requested choice at every choice scene (or the first available one) and
 * stops at an ending, a loop or the scene limit. Durations are estimates from text length and,
 * when a line records its voice duration, from that.
 */
import {
  advancePlayer,
  availableChoices,
  chooseOption,
  createPlayerState,
  getCurrentNode,
  isEnding,
} from "./player";
import type { Choice, Project, StoryNode } from "./types";

export interface RoutePlanOptions {
  /** Pause after each line, in milliseconds (the record player's `linePause`). */
  linePause?: number;
  /** How long choices stay visible before one is taken, in milliseconds. */
  choicePause?: number;
  /** Title card duration in milliseconds; 0 shows none. */
  titleCard?: number;
  /** Stop after this many scenes. */
  maxScenes?: number;
}

export interface RouteStep {
  nodeId: string;
  node: StoryNode;
  kind: "dialogue" | "choice" | "end";
  /** The choice taken at a choice scene. */
  choiceId?: string;
  /** Estimated time spent on this scene, in milliseconds. */
  estimatedMs: number;
}

export interface RouteChoicePoint {
  nodeId: string;
  label: string;
  /** Choices whose conditions hold when the scene is reached. */
  options: Choice[];
  selectedId: string;
  /** True when the requested choice was missing or unavailable and the first option was used. */
  defaulted: boolean;
}

export type RouteStopReason =
  | "ending"
  | "loop"
  | "maxScenes"
  | "deadEnd"
  | "error";

export interface RoutePlan {
  steps: RouteStep[];
  choices: RouteChoicePoint[];
  stoppedBy: RouteStopReason;
  /** Estimated total length, including the title card and the closing fade. */
  estimatedMs: number;
  message?: string;
}

export const DEFAULT_ROUTE_OPTIONS: Required<RoutePlanOptions> = {
  linePause: 900,
  choicePause: 2200,
  maxScenes: 400,
  titleCard: 0,
};

/* Pacing constants mirror src/player/runtime.ts record mode. */
const OPENING_FADE_MS = 900;
const TITLE_CARD_FADE_MS = 600;
const FADE_TRANSITION_MS = 740;
const CHOICE_PICK_MS = 750;
const ENDING_HOLD_MS = 2900;
const UNVOICED_READ_CAP_MS = 9000;
const UNVOICED_MS_PER_GLYPH = 32;
const SPEECH_GLYPHS_PER_SECOND = 15;
const DEFAULT_CPS = 45;

function glyphCount(text: string): number {
  return Array.from(text.replace(/\[[^\]]*\]|<[^>]*>/g, "")).length;
}

function textSpeed(project: Project): number {
  const theme = (project as { theme?: { textSpeed?: number } }).theme;
  const speed = theme?.textSpeed;
  return typeof speed === "number" && speed > 0 ? speed : DEFAULT_CPS;
}

/** Estimated milliseconds the record player spends on one scene. */
export function estimateSceneMs(
  project: Project,
  node: StoryNode,
  options: Required<RoutePlanOptions>,
): number {
  const glyphs = glyphCount(node.text);
  const reveal = (glyphs / textSpeed(project)) * 1000;
  const transition = node.transition === "fade" ? FADE_TRANSITION_MS : 0;
  let body: number;
  if (node.audioSrc) {
    const recorded = (node as { audioDuration?: number }).audioDuration;
    const speech =
      typeof recorded === "number" && recorded > 0
        ? recorded * 1000
        : Math.max(reveal, (glyphs / SPEECH_GLYPHS_PER_SECOND) * 1000);
    body = speech + options.linePause;
  } else
    body =
      reveal +
      Math.min(
        UNVOICED_READ_CAP_MS,
        options.linePause + glyphs * UNVOICED_MS_PER_GLYPH,
      );
  if (node.type === "choice")
    return transition + reveal + options.choicePause + CHOICE_PICK_MS;
  if (isEnding(node)) return transition + reveal + ENDING_HOLD_MS;
  return transition + body;
}

export function planRoute(
  project: Project,
  startNodeId: string = project.startNodeId,
  choices: Record<string, string> = {},
  options: RoutePlanOptions = {},
): RoutePlan {
  const settings: Required<RoutePlanOptions> = {
    ...DEFAULT_ROUTE_OPTIONS,
    ...Object.fromEntries(
      Object.entries(options).filter(([, value]) => value !== undefined),
    ),
  };
  const steps: RouteStep[] = [];
  const choicePoints: RouteChoicePoint[] = [];
  let estimatedMs =
    OPENING_FADE_MS +
    (settings.titleCard > 0 ? settings.titleCard + TITLE_CARD_FADE_MS : 0);
  const finish = (stoppedBy: RouteStopReason, message?: string): RoutePlan => ({
    steps,
    choices: choicePoints,
    stoppedBy,
    estimatedMs: Math.round(estimatedMs),
    message,
  });
  let state;
  try {
    state = createPlayerState(project, startNodeId);
  } catch (error) {
    return finish(
      "error",
      error instanceof Error ? error.message : "The route could not start.",
    );
  }
  const visited = new Set<string>();
  for (;;) {
    if (steps.length >= settings.maxScenes)
      return finish(
        "maxScenes",
        `Stopped after ${settings.maxScenes} scenes.`,
      );
    let node: StoryNode;
    try {
      node = getCurrentNode(project, state);
    } catch (error) {
      return finish(
        "error",
        error instanceof Error ? error.message : "A scene is missing.",
      );
    }
    const signature = `${node.id}|${JSON.stringify(state.variables)}`;
    if (visited.has(signature))
      return finish(
        "loop",
        `The story returns to “${node.label || node.id}” with the same state; the recording stops there.`,
      );
    visited.add(signature);
    const kind: RouteStep["kind"] =
      node.type === "choice" ? "choice" : isEnding(node) ? "end" : "dialogue";
    const step: RouteStep = {
      nodeId: node.id,
      node,
      kind,
      estimatedMs: Math.round(estimateSceneMs(project, node, settings)),
    };
    steps.push(step);
    estimatedMs += step.estimatedMs;
    if (kind === "end") return finish("ending");
    if (node.type === "choice") {
      const options = availableChoices(project, state);
      if (!options.length)
        return finish(
          "deadEnd",
          `No choice is available at “${node.label || node.id}”.`,
        );
      const wanted = choices[node.id];
      const selected =
        options.find((choice) => choice.id === wanted) ?? options[0];
      step.choiceId = selected.id;
      choicePoints.push({
        nodeId: node.id,
        label: node.label || node.text.slice(0, 60) || node.id,
        options,
        selectedId: selected.id,
        defaulted: selected.id !== wanted,
      });
      try {
        state = chooseOption(project, state, selected.id);
      } catch (error) {
        return finish(
          "error",
          error instanceof Error ? error.message : "The choice failed.",
        );
      }
      continue;
    }
    try {
      const next = advancePlayer(project, state);
      if (next === state) return finish("deadEnd", "The scene has no continuation.");
      state = next;
    } catch (error) {
      return finish(
        "error",
        error instanceof Error ? error.message : "The next scene is missing.",
      );
    }
  }
}

/** The `route` map for RecordConfig: every choice point's selected option. */
export function routeChoices(plan: RoutePlan): Record<string, string> {
  return Object.fromEntries(
    plan.choices.map((point) => [point.nodeId, point.selectedId]),
  );
}
