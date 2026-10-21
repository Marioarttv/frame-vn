import type {
  ActorEmote,
  BackgroundMotion,
  Camera,
  ColorGrade,
  Choice,
  Project,
  StageActor,
  StoryNode,
  TextEffect,
  TextboxStyle,
  Transition,
  Weather,
} from "./types";
import { createId } from "./editing";
import { MAX_STAGE_ACTORS } from "./validation";
import {
  BACKGROUND_MOTIONS,
  BACKGROUND_MOTION_LABELS,
  EMOTES,
  EMOTE_LABELS,
  GRADES,
  GRADE_LABELS,
  STAGE_MARKS,
  TEXTBOX_LABELS,
  TEXTBOX_STYLES,
  TEXT_EFFECTS,
  TEXT_EFFECT_LABELS,
  TRANSITIONS,
  TRANSITION_LABELS,
  WEATHERS,
  WEATHER_LABELS,
} from "./staging";

/**
 * A plain-text screenplay format for writers. One line becomes one scene:
 *
 *   # Label              names the next scene; jumps can target it
 *   @bg Night street      background (by name) for the following lines
 *   @music Theme          starts a music track (by name) on the next line; "@music stop" stops it
 *   @sfx Door             plays a sound effect (by name) on the next line
 *   Mira: Hello.          dialogue spoken by a character (matched by name)
 *   Mira (smiling): Hi.   …in a named expression
 *   The rain stops.       narration
 *   * Go outside -> Label a choice attached to the line above
 *   -> Label              continue at that scene instead of the next line
 *   @end The end.         an ending scene
 *   // comment            ignored
 *
 * Staging. Once a script uses @stage or @enter, characters stay on stage between lines and
 * every speaker joins automatically:
 *
 *   @stage Noah left, Mira right    who is on stage and where (far left … far right or 35%)
 *   @enter Rowan center             adds one character; @exit Rowan removes them
 *   @gesture Mira jump                a one-off gesture on the next line
 *
 * Look. These last until changed ("none" or "default" resets them):
 *   @weather rain   @grade night   @textbox cinematic   @effect rise   @motion zoom in
 *   @camera 1.4 Mira   or   @camera 1.5 30 40   or   @camera wide
 * One-offs for the next line: @transition iris   @shake heavy
 */
export interface ScriptImportResult {
  nodes: StoryNode[];
  errors: string[];
  warnings: string[];
}

interface Pending {
  node: StoryNode;
  line: number;
  /** Explicit jump target label and its line, resolved after parsing. */
  jump?: { label: string; line: number };
  choiceTargets: { choice: Choice; label: string; line: number }[];
}

const normalize = (value: string) => value.trim().toLowerCase();
const compact = (value: string) => normalize(value).replace(/[\s_-]+/g, "");

/** Matches a key ("wipe-left") or its label ("Wipe left"), ignoring case and spacing. */
function vocabulary<T extends string>(
  keys: readonly T[],
  labels: Record<T, string>,
  value: string,
): T | undefined {
  const wanted = compact(value);
  return keys.find(
    (key) => compact(key) === wanted || compact(labels[key]) === wanted,
  );
}

function stageMark(value: string): number | undefined {
  const percent = /^(\d{1,3})\s*%?$/.exec(value.trim());
  if (percent) return Math.min(95, Math.max(5, Number(percent[1])));
  const wanted = compact(value);
  return STAGE_MARKS.find((mark) => compact(mark.label) === wanted)?.position;
}

export function parseScript(
  source: string,
  project: Project,
  options: { backgroundId?: string } = {},
): ScriptImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 5000) {
    errors.push("Import at most 5,000 lines at a time.");
    return { nodes: [], errors, warnings };
  }
  const pending: Pending[] = [];
  const labels = new Map<string, string>();
  let label: { text: string; line: number } | undefined;
  let backgroundId = options.backgroundId;
  let musicId: string | null | undefined;
  let sfxId: string | undefined;
  // Persistent look, and one-offs for the next line.
  let weather: Weather | undefined;
  let grade: ColorGrade | undefined;
  let textbox: TextboxStyle | undefined;
  let textEffect: TextEffect | undefined;
  let backgroundMotion: BackgroundMotion | undefined;
  let camera: Camera | { follow: string; zoom: number } | undefined;
  let transition: Transition | undefined;
  let shake: "light" | "heavy" | undefined;
  const gestures = new Map<string, ActorEmote>();
  // Characters on stage, in order of arrival, with their marks.
  let staged = false;
  const onStage = new Map<string, number>();
  const freeMark = () =>
    STAGE_MARKS.map((mark) => mark.position).find(
      (position) =>
        ![...onStage.values()].some((used) => Math.abs(used - position) < 12),
    ) ?? 50;
  const byName = <T extends { id: string; name: string }>(
    items: T[],
    name: string,
  ) =>
    items.find(
      (item) =>
        normalize(item.name) === normalize(name) ||
        normalize(item.id) === normalize(name),
    );
  const last = () => pending[pending.length - 1];

  const push = (node: StoryNode, line: number) => {
    if (label) {
      if (labels.has(normalize(label.text)))
        errors.push(
          `Line ${label.line}: the label “${label.text}” is used twice.`,
        );
      labels.set(normalize(label.text), node.id);
      node.label = label.text.slice(0, 140);
      label = undefined;
    }
    if (musicId !== undefined) node.musicId = musicId;
    if (sfxId) node.sfxId = sfxId;
    if (weather) node.weather = weather;
    if (grade) node.grade = grade;
    if (textbox) node.textbox = textbox;
    if (textEffect) node.textEffect = textEffect;
    if (backgroundMotion) node.backgroundMotion = backgroundMotion;
    if (transition) node.transition = transition;
    if (shake) node.shake = shake;
    if (staged) {
      if (node.characterId && !onStage.has(node.characterId)) {
        if (onStage.size > MAX_STAGE_ACTORS)
          warnings.push(
            `Line ${line}: at most ${MAX_STAGE_ACTORS + 1} characters fit on stage.`,
          );
        else onStage.set(node.characterId, freeMark());
      }
      if (node.characterId && onStage.has(node.characterId))
        node.position = onStage.get(node.characterId)!;
      const cast: StageActor[] = [...onStage]
        .filter(([id]) => id !== node.characterId)
        .slice(0, MAX_STAGE_ACTORS)
        .map(([characterId, position]) => ({
          characterId,
          position,
          ...(gestures.has(characterId) ? { emote: gestures.get(characterId) } : {}),
        }));
      if (cast.length) node.cast = cast;
      if (node.characterId && gestures.has(node.characterId))
        node.emote = gestures.get(node.characterId);
    }
    if (camera) {
      if ("follow" in camera) {
        const target =
          camera.follow === node.characterId
            ? node.position
            : onStage.get(camera.follow);
        if (target !== undefined)
          node.camera = { zoom: camera.zoom, x: target, y: 38 };
      } else node.camera = camera;
    }
    musicId = undefined;
    sfxId = undefined;
    transition = undefined;
    shake = undefined;
    gestures.clear();
    pending.push({ node, line, choiceTargets: [] });
  };

  lines.forEach((raw, index) => {
    const line = index + 1;
    const text = raw.trim();
    if (!text || text.startsWith("//")) return;
    if (text.startsWith("#")) {
      const name = text.replace(/^#+/, "").trim();
      label = name ? { text: name, line } : undefined;
      return;
    }
    const command = /^@(\w+)\s*(.*)$/.exec(text);
    if (command) {
      const [, name, argument] = command;
      const keyword = name.toLowerCase();
      if (keyword === "bg" || keyword === "background") {
        const background = byName(project.backgrounds, argument);
        if (!argument || normalize(argument) === "none")
          backgroundId = undefined;
        else if (background) backgroundId = background.id;
        else warnings.push(`Line ${line}: no background named “${argument}”.`);
      } else if (keyword === "music") {
        if (normalize(argument) === "stop") musicId = null;
        else {
          const track = byName(project.sounds, argument);
          if (track) musicId = track.id;
          else warnings.push(`Line ${line}: no music named “${argument}”.`);
        }
      } else if (keyword === "sfx") {
        const effect = byName(project.sounds, argument);
        if (effect) sfxId = effect.id;
        else warnings.push(`Line ${line}: no sound named “${argument}”.`);
      } else if (
        keyword === "weather" ||
        keyword === "grade" ||
        keyword === "textbox" ||
        keyword === "effect" ||
        keyword === "motion" ||
        keyword === "transition"
      ) {
        const reset = ["none", "default", "off", "clear", "still", "natural"].includes(
          normalize(argument),
        );
        const value =
          keyword === "weather"
            ? vocabulary(WEATHERS, WEATHER_LABELS, argument)
            : keyword === "grade"
              ? vocabulary(GRADES, GRADE_LABELS, argument)
              : keyword === "textbox"
                ? vocabulary(TEXTBOX_STYLES, TEXTBOX_LABELS, argument)
                : keyword === "effect"
                  ? vocabulary(TEXT_EFFECTS, TEXT_EFFECT_LABELS, argument)
                  : keyword === "motion"
                    ? vocabulary(BACKGROUND_MOTIONS, BACKGROUND_MOTION_LABELS, argument)
                    : vocabulary(TRANSITIONS, TRANSITION_LABELS, argument);
        if (!value && !reset)
          warnings.push(`Line ${line}: @${keyword} does not know “${argument}”.`);
        else if (keyword === "weather") weather = value as Weather | undefined;
        else if (keyword === "grade") grade = value as ColorGrade | undefined;
        else if (keyword === "textbox") textbox = value as TextboxStyle | undefined;
        else if (keyword === "effect") textEffect = value as TextEffect | undefined;
        else if (keyword === "motion")
          backgroundMotion = value as BackgroundMotion | undefined;
        else transition = value === "cut" ? undefined : (value as Transition | undefined);
      } else if (keyword === "shake")
        shake = normalize(argument) === "heavy" ? "heavy" : "light";
      else if (keyword === "camera") {
        const parts = argument.trim().split(/\s+/);
        const zoom = Number(parts[0]);
        if (["wide", "none", "reset"].includes(normalize(argument)) || !argument)
          camera = undefined;
        else if (!Number.isFinite(zoom) || zoom < 1 || zoom > 2.5)
          warnings.push(`Line ${line}: @camera needs a zoom from 1 to 2.5, or “wide”.`);
        else if (parts.length >= 3 && parts.slice(1, 3).every((part) => Number.isFinite(Number(part))))
          camera = {
            zoom,
            x: Math.min(100, Math.max(0, Number(parts[1]))),
            y: Math.min(100, Math.max(0, Number(parts[2]))),
          };
        else if (parts.length > 1) {
          const character = byName(project.characters, parts.slice(1).join(" "));
          if (character) camera = { follow: character.id, zoom };
          else warnings.push(`Line ${line}: no character named “${parts.slice(1).join(" ")}”.`);
        } else camera = { zoom, x: 50, y: 45 };
      } else if (keyword === "stage" || keyword === "enter") {
        staged = true;
        if (keyword === "stage") onStage.clear();
        for (const entry of argument.split(",").map((part) => part.trim()).filter(Boolean)) {
          const placed = /^(.+?)(?:\s+(?:at\s+)?((?:far\s+)?(?:left|right)|center|centre|\d{1,3}\s*%?))?$/i.exec(entry);
          const character = placed ? byName(project.characters, placed[1]) : undefined;
          if (!character) {
            warnings.push(`Line ${line}: no character named “${placed?.[1] ?? entry}”.`);
            continue;
          }
          const mark = placed?.[2] ? stageMark(placed[2].replace(/centre/i, "center")) : undefined;
          onStage.delete(character.id);
          onStage.set(character.id, mark ?? freeMark());
        }
      } else if (keyword === "exit" || keyword === "leave") {
        const character = byName(project.characters, argument);
        if (character) onStage.delete(character.id);
        else warnings.push(`Line ${line}: no character named “${argument}”.`);
      } else if (keyword === "clear") onStage.clear();
      else if (keyword === "gesture" || keyword === "emote") {
        const parts = argument.trim().split(/\s+/);
        const emote = vocabulary(EMOTES, EMOTE_LABELS, parts[parts.length - 1] ?? "");
        const character = byName(project.characters, parts.slice(0, -1).join(" "));
        if (!character || !emote)
          warnings.push(`Line ${line}: write gestures as “@gesture Name nod”.`);
        else gestures.set(character.id, emote);
      } else if (keyword === "end")
        push(
          {
            id: createId("scene"),
            type: "end",
            label: "Ending",
            text: argument.slice(0, 20_000),
            backgroundId,
            position: 50,
          },
          line,
        );
      else errors.push(`Line ${line}: unknown command @${name}.`);
      return;
    }
    if (text.startsWith("*")) {
      const choice = /^\*\s*(.+?)\s*->\s*(.+)$/.exec(text);
      const previous = last();
      if (!choice) {
        errors.push(`Line ${line}: write choices as “* Choice text -> Label”.`);
        return;
      }
      if (!previous || previous.node.type === "end") {
        errors.push(`Line ${line}: a choice must follow a line of dialogue.`);
        return;
      }
      if (previous.node.type === "dialogue") {
        const { nextId, ...base } = previous.node;
        void nextId; // A choice replaces the line's single continuation.
        previous.node = { ...base, type: "choice", choices: [] };
      }
      if (previous.node.type !== "choice") return;
      if (previous.node.choices.length >= 8) {
        errors.push(`Line ${line}: a scene can offer at most 8 choices.`);
        return;
      }
      const created: Choice = {
        id: createId("choice"),
        text: choice[1].slice(0, 500),
        nextId: "",
      };
      previous.node.choices.push(created);
      previous.choiceTargets.push({ choice: created, label: choice[2], line });
      return;
    }
    if (text.startsWith("->")) {
      const previous = last();
      const target = text.slice(2).trim();
      if (!previous || previous.node.type !== "dialogue")
        errors.push(`Line ${line}: a jump must follow a line of dialogue.`);
      else previous.jump = { label: target, line };
      return;
    }
    const spoken = /^([^:]{1,60}?)\s*(?:\(([^)]{1,60})\))?\s*:\s*(.*)$/.exec(
      text,
    );
    let characterId: string | undefined;
    let poseId: string | undefined;
    let speaker: string | undefined;
    let dialogue = text;
    if (spoken && !/^https?$/i.test(spoken[1])) {
      const [, name, expression, words] = spoken;
      const character = byName(project.characters, name);
      dialogue = words;
      if (character) {
        characterId = character.id;
        if (expression) {
          const pose = byName(character.poses, expression);
          if (pose) poseId = pose.id;
          else
            warnings.push(
              `Line ${line}: ${character.name} has no expression named “${expression}”.`,
            );
        }
      } else {
        speaker = name.trim().slice(0, 140);
        warnings.push(
          `Line ${line}: “${speaker}” is not a character yet, so it is shown as a name only.`,
        );
      }
    }
    push(
      {
        id: createId("scene"),
        type: "dialogue",
        label: "",
        text: dialogue.slice(0, 20_000),
        ...(speaker ? { speaker } : {}),
        characterId,
        poseId,
        backgroundId,
        position: 50,
        nextId: null,
      },
      line,
    );
  });

  const existing = new Map(
    project.nodes
      .filter((node) => node.label.trim())
      .map((node) => [normalize(node.label), node.id]),
  );
  const resolve = (target: string, line: number) => {
    const id = labels.get(normalize(target)) ?? existing.get(normalize(target));
    if (!id) errors.push(`Line ${line}: no scene is labelled “${target}”.`);
    return id ?? "";
  };
  pending.forEach((entry, index) => {
    const { node } = entry;
    if (!node.label)
      node.label = (node.text || "Scene").replace(/\s+/g, " ").slice(0, 48);
    if (node.type === "dialogue") {
      if (entry.jump)
        node.nextId = resolve(entry.jump.label, entry.jump.line) || null;
      else {
        // Lines continue into the following line unless they jump elsewhere.
        const following = pending[index + 1];
        node.nextId = following ? following.node.id : null;
      }
    }
    if (node.type === "choice")
      for (const target of entry.choiceTargets)
        target.choice.nextId = resolve(target.label, target.line);
  });
  if (!pending.length && !errors.length)
    errors.push("The script does not contain any lines.");
  return {
    nodes: pending.map(
      (entry) =>
        Object.fromEntries(
          Object.entries(entry.node).filter(([, value]) => value !== undefined),
        ) as unknown as StoryNode,
    ),
    errors,
    warnings,
  };
}

/** Adds imported scenes after a scene, continuing from it when it had no next scene. */
export function insertScriptNodes(
  project: Project,
  nodes: StoryNode[],
  afterNodeId?: string,
): Project {
  if (!nodes.length) return project;
  const index = project.nodes.findIndex((node) => node.id === afterNodeId);
  const list = project.nodes.map((node) =>
    node.id === afterNodeId && node.type === "dialogue" && !node.nextId
      ? { ...node, nextId: nodes[0].id }
      : node,
  );
  list.splice(index < 0 ? list.length : index + 1, 0, ...nodes);
  return { ...project, nodes: list };
}
