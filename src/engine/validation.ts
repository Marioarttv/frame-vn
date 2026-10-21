import type {
  ActorEmote,
  ActorMotion,
  ActorStaging,
  Background,
  BackgroundMotion,
  ActorLight,
  Camera,
  ColorGrade,
  Branch,
  Character,
  Choice,
  Condition,
  ConditionOperator,
  Effect,
  NodeBase,
  Pose,
  Project,
  Sound,
  StageActor,
  StoryNode,
  TextEffect,
  TextboxStyle,
  Theme,
  Transition,
  ValidationIssue,
  ValidationResult,
  Variable,
  VariableValue,
  Weather,
} from "./types";
import { ASSET_REF_PATTERN } from "./asset-refs";
import {
  ACTOR_MOTIONS,
  BACKGROUND_MOTIONS,
  DEFAULT_THEME,
  EMOTES,
  FONT_LABELS,
  GRADES,
  MAX_ACTOR_SCALE,
  MAX_CAMERA_ZOOM,
  MIN_ACTOR_SCALE,
  TEXTBOX_STYLES,
  TEXT_EFFECTS,
  TRANSITIONS,
  WEATHERS,
} from "./staging";
import { parseMarkup, parseScreenFx, SCREEN_FX, spokenWords } from "./markup";

// JSON backups embed media as base64, including background videos of up to 40 MB.
const MAX_JSON_LENGTH = 256 * 1024 * 1024;
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/;
export const CONDITION_OPERATORS: ConditionOperator[] = [
  "==",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
];
/** The stage stays readable with the speaker plus this many other characters. */
export const MAX_STAGE_ACTORS = 5;

/** Only URLs suitable for image/audio/fetch consumers are accepted, never executable URLs. */
export function isSafeAssetUrl(
  value: string,
  kind: "image" | "audio" | "video" | "json" | "directory" = "image",
): boolean {
  if (!value || value !== value.trim() || /[\u0000-\u0020\u007f\\]/.test(value))
    return false;
  // Local asset-store references; their bytes are type-checked when imported and exported.
  if (value.startsWith("asset:"))
    return (
      (kind === "image" || kind === "audio" || kind === "video") &&
      ASSET_REF_PATTERN.test(value)
    );
  if (value.startsWith("data:")) {
    const media =
      kind === "image"
        ? "image\/(?:png|jpeg|webp|gif|svg\\+xml|avif)"
        : kind === "audio"
          ? "audio\/(?:mpeg|mp3|ogg|wav|wave|x-wav|webm|mp4|aac|flac)"
          : kind === "video"
            ? "video\/(?:mp4|webm)"
            : "application\/json";
    return new RegExp(
      `^data:${media}(?:;charset=[a-zA-Z0-9-]+)?(?:;base64)?,`,
      "i",
    ).test(value);
  }
  if (value.startsWith("//")) return false;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }
  return !value.startsWith("#") && !value.startsWith("?");
}

export interface ValidationOptions {
  /** Preserve incomplete authoring text and links while retaining all structural and URL checks. */
  draft?: boolean;
}

export function validateProject(
  input: unknown,
  options: ValidationOptions = {},
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const issue = (path: string, message: string) =>
    errors.push({ path, message });
  const semanticIssue = (path: string, message: string) =>
    (options.draft ? warnings : errors).push({ path, message });
  const record = (value: unknown, path: string): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      issue(path, "Expected an object.");
      return {};
    }
    return value as Record<string, unknown>;
  };
  const string = (
    value: unknown,
    path: string,
    max = 10_000,
    allowEmpty = false,
  ): string => {
    if (typeof value !== "string") {
      issue(path, "Expected text.");
      return "";
    }
    if ((!allowEmpty && !value.trim()) || value.length > max)
      issue(
        path,
        `Text must contain ${allowEmpty ? "0" : "1"}–${max} characters.`,
      );
    return value;
  };
  const optionalString = (
    value: unknown,
    path: string,
    max = 10_000,
  ): string | undefined =>
    value === undefined ? undefined : string(value, path, max, true);
  const editableString = (
    value: unknown,
    path: string,
    max: number,
  ): string => {
    const result = string(value, path, max, true);
    if (typeof value === "string" && !value.trim())
      semanticIssue(path, "This text is incomplete.");
    return result;
  };
  const id = (value: unknown, path: string): string => {
    const result = string(value, path, 96);
    if (result && !ID_PATTERN.test(result))
      issue(
        path,
        "Use letters, numbers, dashes, or underscores, starting with a letter or number.",
      );
    return result;
  };
  const referenceId = (value: unknown, path: string): string => {
    if (
      options.draft &&
      typeof value === "string" &&
      !value.trim() &&
      value.length <= 96
    ) {
      semanticIssue(path, "This reference is incomplete.");
      return value;
    }
    return id(value, path);
  };
  const optionalId = (value: unknown, path: string): string | undefined =>
    value === undefined ? undefined : referenceId(value, path);
  const url = (
    value: unknown,
    path: string,
    kind: "image" | "audio" | "video" | "json" | "directory",
  ): string => {
    const result = string(value, path, MAX_JSON_LENGTH);
    if (result && !isSafeAssetUrl(result, kind))
      issue(
        path,
        `Use a relative asset URL, HTTP(S) URL, or a supported ${kind} data URL.`,
      );
    return result;
  };
  const optionalUrl = (
    value: unknown,
    path: string,
    kind: "image" | "audio" | "video" | "json" | "directory",
  ): string | undefined =>
    value === undefined ? undefined : url(value, path, kind);
  const array = (
    value: unknown,
    path: string,
    min: number,
    max: number,
  ): unknown[] => {
    if (!Array.isArray(value)) {
      issue(path, "Expected an array.");
      return [];
    }
    if (value.length < min || value.length > max)
      issue(path, `Expected ${min}–${max} entries.`);
    return value.slice(0, max);
  };
  const unique = (items: { id: string }[], path: string) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.id))
        issue(`${path}[${index}].id`, `Duplicate ID “${item.id}”.`);
      seen.add(item.id);
    });
  };
  const boolean = (value: unknown, path: string): boolean => {
    if (typeof value !== "boolean") issue(path, "Expected true or false.");
    return value === true;
  };
  const optionalBoolean = (value: unknown, path: string) =>
    value === undefined ? undefined : boolean(value, path);
  const stagePosition = (value: unknown, path: string): number => {
    const result =
      typeof value === "number" && Number.isFinite(value) ? value : NaN;
    if (!Number.isFinite(result) || result < 0 || result > 100)
      issue(path, "Position must be a number from 0 to 100.");
    return result;
  };
  const number = (
    value: unknown,
    path: string,
    min: number,
    max: number,
  ): number => {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < min ||
      value > max
    ) {
      issue(path, `Use a number from ${min} to ${max}.`);
      return min;
    }
    return value;
  };
  function choice<T extends string>(
    value: unknown,
    path: string,
    allowed: readonly T[],
  ): T {
    if (!allowed.includes(value as T))
      issue(path, `Use one of: ${allowed.join(", ")}.`);
    return value as T;
  }
  function optionalChoice<T extends string>(
    value: unknown,
    path: string,
    allowed: readonly T[],
  ): T | undefined {
    return value === undefined ? undefined : choice(value, path, allowed);
  }
  /** Copies optional staging fields that are present, so older projects roundtrip unchanged. */
  const staging = (
    item: Record<string, unknown>,
    path: string,
    target: ActorStaging,
  ) => {
    if (item.y !== undefined) target.y = number(item.y, `${path}.y`, -60, 60);
    if (item.scale !== undefined)
      target.scale = number(
        item.scale,
        `${path}.scale`,
        MIN_ACTOR_SCALE,
        MAX_ACTOR_SCALE,
      );
    const enter = optionalChoice<ActorMotion>(
      item.enter,
      `${path}.enter`,
      ACTOR_MOTIONS,
    );
    if (enter !== undefined) target.enter = enter;
    const exit = optionalChoice<ActorMotion>(
      item.exit,
      `${path}.exit`,
      ACTOR_MOTIONS,
    );
    if (exit !== undefined) target.exit = exit;
    const emote = optionalChoice<ActorEmote>(
      item.emote,
      `${path}.emote`,
      EMOTES,
    );
    if (emote !== undefined) target.emote = emote;
  };
  const variableValue = (value: unknown, path: string): VariableValue => {
    if (typeof value === "boolean") return value;
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      Math.abs(value) <= 1e9
    )
      return value;
    issue(path, "Use a number or true/false.");
    return 0;
  };
  const conditions = (value: unknown, path: string): Condition[] =>
    array(value, path, 0, 8).map((entry, k) => {
      const cp = `${path}[${k}]`;
      const item = record(entry, cp);
      if (!CONDITION_OPERATORS.includes(item.operator as ConditionOperator))
        issue(`${cp}.operator`, "Use ==, !=, >, >=, < or <=.");
      return {
        variableId: referenceId(item.variableId, `${cp}.variableId`),
        operator: item.operator as ConditionOperator,
        value: variableValue(item.value, `${cp}.value`),
      };
    });
  const effects = (value: unknown, path: string): Effect[] =>
    array(value, path, 0, 8).map((entry, k) => {
      const ep = `${path}[${k}]`;
      const item = record(entry, ep);
      if (item.operation !== "set" && item.operation !== "add")
        issue(`${ep}.operation`, "Use set or add.");
      return {
        variableId: referenceId(item.variableId, `${ep}.variableId`),
        operation: item.operation === "add" ? "add" : "set",
        value: variableValue(item.value, `${ep}.value`),
      };
    });
  const source = record(input, "project");
  // Older projects are read as version 3: every newer field is optional.
  if (
    source.schemaVersion !== 1 &&
    source.schemaVersion !== 2 &&
    source.schemaVersion !== 3
  )
    issue(
      "schemaVersion",
      "This editor supports project schema versions 1 to 3.",
    );
  const characters: Character[] = array(
    source.characters,
    "characters",
    0,
    100,
  ).map((value, i) => {
    const path = `characters[${i}]`;
    const item = record(value, path);
    const poses: Pose[] = array(item.poses, `${path}.poses`, 1, 100).map(
      (poseValue, j) => {
        const p = `${path}.poses[${j}]`;
        const pose = record(poseValue, p);
        const result: Pose = {
          id: id(pose.id, `${p}.id`),
          name: editableString(pose.name, `${p}.name`, 140),
          src: url(pose.src, `${p}.src`, "image"),
        };
        if (pose.rig !== undefined)
          result.rig = url(pose.rig, `${p}.rig`, "json");
        if (pose.capabilities !== undefined) {
          const capabilities = record(pose.capabilities, `${p}.capabilities`);
          const boolean = (key: string) => {
            if (typeof capabilities[key] !== "boolean")
              issue(`${p}.capabilities.${key}`, "Expected true or false.");
            return capabilities[key] === true;
          };
          result.capabilities = {
            mouth: boolean("mouth"),
            blink: boolean("blink"),
            body: boolean("body"),
            gaze: boolean("gaze"),
            brows: boolean("brows"),
          };
        }
        if (pose.animation !== undefined) {
          const animation = record(pose.animation, `${p}.animation`);
          result.animation = {
            manifestUrl: url(
              animation.manifestUrl,
              `${p}.animation.manifestUrl`,
              "json",
            ),
            speechIndexUrl: url(
              animation.speechIndexUrl,
              `${p}.animation.speechIndexUrl`,
              "json",
            ),
            browsIndexUrl: optionalUrl(
              animation.browsIndexUrl,
              `${p}.animation.browsIndexUrl`,
              "json",
            ),
            lightingUrl: optionalUrl(
              animation.lightingUrl,
              `${p}.animation.lightingUrl`,
              "json",
            ),
            assetRoot: url(
              animation.assetRoot,
              `${p}.animation.assetRoot`,
              "directory",
            ),
            poseKey: string(animation.poseKey, `${p}.animation.poseKey`, 140),
          };
        }
        return result;
      },
    );
    unique(poses, `${path}.poses`);
    const color = string(item.color, `${path}.color`, 7);
    if (!/^#[\da-fA-F]{3}(?:[\da-fA-F]{3})?$/.test(color))
      issue(`${path}.color`, "Use a three- or six-digit hex color.");
    const result: Character = {
      id: id(item.id, `${path}.id`),
      name: editableString(item.name, `${path}.name`, 140),
      color,
      description: optionalString(
        item.description,
        `${path}.description`,
        2000,
      ),
      poses,
      voiceId: optionalString(item.voiceId, `${path}.voiceId`, 140),
    };
    const expressionChange = optionalChoice(
      item.expressionChange,
      `${path}.expressionChange`,
      ["morph", "cut"] as const,
    );
    if (expressionChange) result.expressionChange = expressionChange;
    if (item.voiceSettings !== undefined) {
      const settings = record(item.voiceSettings, `${path}.voiceSettings`);
      result.voiceSettings = {
        stability: number(settings.stability, `${path}.voiceSettings.stability`, 0, 1),
        similarity: number(
          settings.similarity,
          `${path}.voiceSettings.similarity`,
          0,
          1,
        ),
      };
      if (settings.languageCode !== undefined) {
        const code = string(settings.languageCode, `${path}.voiceSettings.languageCode`, 2);
        if (!/^[a-z]{2}$/.test(code))
          issue(`${path}.voiceSettings.languageCode`, "Use a two-letter language code.");
        result.voiceSettings.languageCode = code;
      }
    }
    if (item.voice !== undefined) {
      const voice = record(item.voice, `${path}.voice`);
      result.voice = {
        src: url(voice.src, `${path}.voice.src`, "audio"),
        cueUrl: optionalUrl(voice.cueUrl, `${path}.voice.cueUrl`, "json"),
      };
    }
    return result;
  });
  const backgrounds: Background[] = array(
    source.backgrounds,
    "backgrounds",
    0,
    100,
  ).map((value, i) => {
    const path = `backgrounds[${i}]`;
    const item = record(value, path);
    const kind = optionalChoice(item.kind, `${path}.kind`, [
      "image",
      "video",
    ] as const);
    const result: Background = {
      id: id(item.id, `${path}.id`),
      name: editableString(item.name, `${path}.name`, 140),
      src: url(item.src, `${path}.src`, kind === "video" ? "video" : "image"),
    };
    if (kind) result.kind = kind;
    return result;
  });
  const variables: Variable[] = (
    source.variables === undefined
      ? []
      : array(source.variables, "variables", 0, 200)
  ).map((value, i) => {
    const path = `variables[${i}]`;
    const item = record(value, path);
    if (item.type !== "number" && item.type !== "boolean")
      issue(`${path}.type`, "Expected number or boolean.");
    const type = item.type === "boolean" ? "boolean" : "number";
    const initial = variableValue(item.initial, `${path}.initial`);
    if (typeof initial !== type)
      issue(
        `${path}.initial`,
        type === "boolean"
          ? "The starting value must be true or false."
          : "The starting value must be a number.",
      );
    return {
      id: id(item.id, `${path}.id`),
      name: editableString(item.name, `${path}.name`, 80),
      type,
      initial,
    };
  });
  const sounds: Sound[] = (
    source.sounds === undefined ? [] : array(source.sounds, "sounds", 0, 200)
  ).map((value, i) => {
    const path = `sounds[${i}]`;
    const item = record(value, path);
    if (item.kind !== "music" && item.kind !== "sfx" && item.kind !== "ambience")
      issue(`${path}.kind`, "Expected music, sfx or ambience.");
    return {
      id: id(item.id, `${path}.id`),
      name: editableString(item.name, `${path}.name`, 140),
      src: url(item.src, `${path}.src`, "audio"),
      kind: item.kind === "sfx" || item.kind === "ambience" ? item.kind : "music",
      ...(item.loop !== undefined
        ? { loop: boolean(item.loop, `${path}.loop`) }
        : {}),
      ...(item.volume !== undefined
        ? { volume: number(item.volume, `${path}.volume`, 0, 1) }
        : {}),
    };
  });
  const nodes: StoryNode[] = array(source.nodes, "nodes", 1, 1000).map(
    (value, i) => {
      const path = `nodes[${i}]`;
      const item = record(value, path);
      const base: NodeBase = {
        id: id(item.id, `${path}.id`),
        label: editableString(item.label, `${path}.label`, 140),
        text: string(item.text, `${path}.text`, 20_000, true),
        speaker: optionalString(item.speaker, `${path}.speaker`, 140),
        backgroundId: optionalId(item.backgroundId, `${path}.backgroundId`),
        characterId: optionalId(item.characterId, `${path}.characterId`),
        poseId: optionalId(item.poseId, `${path}.poseId`),
        position: stagePosition(item.position, `${path}.position`),
        audioSrc: optionalUrl(item.audioSrc, `${path}.audioSrc`, "audio"),
        cueUrl: optionalUrl(item.cueUrl, `${path}.cueUrl`, "json"),
      };
      // Optional v2 fields are only written when present so older projects roundtrip unchanged.
      const flip = optionalBoolean(item.flip, `${path}.flip`);
      if (flip !== undefined) base.flip = flip;
      if (item.cast !== undefined)
        base.cast = array(item.cast, `${path}.cast`, 0, MAX_STAGE_ACTORS).map(
          (actorValue, k): StageActor => {
            const ap = `${path}.cast[${k}]`;
            const actor = record(actorValue, ap);
            const result: StageActor = {
              characterId: referenceId(actor.characterId, `${ap}.characterId`),
              position: stagePosition(actor.position, `${ap}.position`),
            };
            const pose = optionalId(actor.poseId, `${ap}.poseId`);
            if (pose !== undefined) result.poseId = pose;
            const mirrored = optionalBoolean(actor.flip, `${ap}.flip`);
            if (mirrored !== undefined) result.flip = mirrored;
            staging(actor, ap, result);
            return result;
          },
        );
      staging(item, path, base);
      const transition = optionalChoice<Transition>(
        item.transition,
        `${path}.transition`,
        TRANSITIONS,
      );
      if (transition !== undefined) base.transition = transition;
      if (item.audioDuration !== undefined)
        base.audioDuration = number(
          item.audioDuration,
          `${path}.audioDuration`,
          0,
          3600,
        );
      if (item.textTimings !== undefined) {
        const timings = array(item.textTimings, `${path}.textTimings`, 0, 5000).map(
          (time, k) => number(time, `${path}.textTimings[${k}]`, 0, 3600),
        );
        const back = timings.findIndex((time, k) => k > 0 && time < timings[k - 1]);
        if (back > 0)
          issue(
            `${path}.textTimings[${back}]`,
            "Word timings must not go backwards.",
          );
        base.textTimings = timings;
      }
      if (item.fx !== undefined)
        base.fx = array(item.fx, `${path}.fx`, 0, 8).map((entry, k) => {
          const value = string(entry, `${path}.fx[${k}]`, 40);
          if (value && !parseScreenFx(value))
            issue(
              `${path}.fx[${k}]`,
              `Use a screen effect name (${SCREEN_FX.join(", ")}), optionally followed by x,y in stage percent (thread takes x1,y1,x2,y2; dome may add a radius, x,y,r).`,
            );
          return value;
        });
      const textbox = optionalChoice<TextboxStyle>(
        item.textbox,
        `${path}.textbox`,
        TEXTBOX_STYLES,
      );
      if (textbox !== undefined) base.textbox = textbox;
      const textEffect = optionalChoice<TextEffect>(
        item.textEffect,
        `${path}.textEffect`,
        TEXT_EFFECTS,
      );
      if (textEffect !== undefined) base.textEffect = textEffect;
      const weather = optionalChoice<Weather>(
        item.weather,
        `${path}.weather`,
        WEATHERS,
      );
      if (weather !== undefined) base.weather = weather;
      const grade = optionalChoice<ColorGrade>(
        item.grade,
        `${path}.grade`,
        GRADES,
      );
      if (grade !== undefined) base.grade = grade;
      const motion = optionalChoice<BackgroundMotion>(
        item.backgroundMotion,
        `${path}.backgroundMotion`,
        BACKGROUND_MOTIONS,
      );
      if (motion !== undefined) base.backgroundMotion = motion;
      if (item.camera !== undefined) {
        const camera = record(item.camera, `${path}.camera`);
        base.camera = {
          zoom: number(camera.zoom, `${path}.camera.zoom`, 1, MAX_CAMERA_ZOOM),
          x: number(camera.x, `${path}.camera.x`, 0, 100),
          y: number(camera.y, `${path}.camera.y`, 0, 100),
        } satisfies Camera;
      }
      if (item.light !== undefined) {
        const light = record(item.light, `${path}.light`);
        const color = (value: unknown, at: string) => {
          if (typeof value !== "string" || !/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value)) {
            issue(at, "Use a hex colour such as #9fc4ff.");
            return "#ffffff";
          }
          return value;
        };
        base.light = {
          color: color(light.color, `${path}.light.color`),
          amount: number(light.amount, `${path}.light.amount`, 0, 1),
          brightness: number(light.brightness, `${path}.light.brightness`, 0.1, 2),
          ...(light.saturation !== undefined
            ? { saturation: number(light.saturation, `${path}.light.saturation`, 0, 2) }
            : {}),
          ...(light.rim !== undefined ? { rim: color(light.rim, `${path}.light.rim`) } : {}),
          ...(light.rimFrom !== undefined
            ? {
                rimFrom: optionalChoice(light.rimFrom, `${path}.light.rimFrom`, [
                  "left",
                  "right",
                  "top",
                ] as const),
              }
            : {}),
          ...(light.rimStrength !== undefined
            ? { rimStrength: number(light.rimStrength, `${path}.light.rimStrength`, 0, 1) }
            : {}),
        } satisfies ActorLight;
      }
      const shake = optionalChoice(item.shake, `${path}.shake`, [
        "light",
        "heavy",
      ] as const);
      if (shake !== undefined) base.shake = shake;
      if (item.musicId !== undefined)
        base.musicId =
          item.musicId === null
            ? null
            : referenceId(item.musicId, `${path}.musicId`);
      if (item.ambienceId !== undefined)
        base.ambienceId =
          item.ambienceId === null
            ? null
            : referenceId(item.ambienceId, `${path}.ambienceId`);
      const sfx = optionalId(item.sfxId, `${path}.sfxId`);
      if (sfx !== undefined) base.sfxId = sfx;
      if (item.effects !== undefined)
        base.effects = effects(item.effects, `${path}.effects`);
      if (item.type === "branch") {
        const branches: Branch[] = array(
          item.branches,
          `${path}.branches`,
          1,
          8,
        ).map((branchValue, j) => {
          const bp = `${path}.branches[${j}]`;
          const branch = record(branchValue, bp);
          return {
            id: id(branch.id, `${bp}.id`),
            conditions: conditions(branch.conditions, `${bp}.conditions`),
            nextId: referenceId(branch.nextId, `${bp}.nextId`),
          };
        });
        unique(branches, `${path}.branches`);
        return {
          ...base,
          type: "branch",
          branches,
          elseId: referenceId(item.elseId, `${path}.elseId`),
        };
      }
      if (item.type === "choice") {
        const choices: Choice[] = array(
          item.choices,
          `${path}.choices`,
          1,
          8,
        ).map((choiceValue, j) => {
          const cp = `${path}.choices[${j}]`;
          const choice = record(choiceValue, cp);
          const result: Choice = {
            id: id(choice.id, `${cp}.id`),
            text: editableString(choice.text, `${cp}.text`, 500),
            nextId: referenceId(choice.nextId, `${cp}.nextId`),
          };
          if (choice.conditions !== undefined)
            result.conditions = conditions(
              choice.conditions,
              `${cp}.conditions`,
            );
          if (choice.effects !== undefined)
            result.effects = effects(choice.effects, `${cp}.effects`);
          return result;
        });
        unique(choices, `${path}.choices`);
        return { ...base, type: "choice", choices };
      }
      if (item.type === "end") return { ...base, type: "end" };
      if (item.type !== "dialogue")
        issue(`${path}.type`, "Expected dialogue, choice, branch, or end.");
      return {
        ...base,
        type: "dialogue",
        nextId:
          item.nextId === null
            ? null
            : referenceId(item.nextId, `${path}.nextId`),
      };
    },
  );
  unique(characters, "characters");
  unique(backgrounds, "backgrounds");
  unique(variables, "variables");
  unique(sounds, "sounds");
  unique(nodes, "nodes");
  let theme: Theme | undefined;
  if (source.theme !== undefined) {
    const item = record(source.theme, "theme");
    const accent = string(item.accent, "theme.accent", 7);
    if (!/^#[\da-fA-F]{3}(?:[\da-fA-F]{3})?$/.test(accent))
      issue("theme.accent", "Use a three- or six-digit hex color.");
    theme = {
      textbox: choice(item.textbox, "theme.textbox", TEXTBOX_STYLES),
      textEffect: choice(item.textEffect, "theme.textEffect", TEXT_EFFECTS),
      textSpeed: number(item.textSpeed, "theme.textSpeed", 5, 200),
      font: choice(
        item.font,
        "theme.font",
        Object.keys(FONT_LABELS) as Theme["font"][],
      ),
      accent,
      focus: choice(item.focus, "theme.focus", [
        "dim",
        "spotlight",
        "none",
      ] as const),
      expressionChange: choice(
        item.expressionChange ?? DEFAULT_THEME.expressionChange,
        "theme.expressionChange",
        ["morph", "cut"] as const,
      ),
    };
    if (item.musicDuck !== undefined)
      theme.musicDuck = number(item.musicDuck, "theme.musicDuck", 0, 1);
    if (item.textScale !== undefined)
      theme.textScale = number(item.textScale, "theme.textScale", 0.6, 2);
  }
  const project: Project = {
    schemaVersion: 3,
    id: id(source.id, "id"),
    title: editableString(source.title, "title", 140),
    description: string(source.description, "description", 2000, true),
    startNodeId: referenceId(source.startNodeId, "startNodeId"),
    nodes,
    characters,
    backgrounds,
    variables,
    sounds,
    ...(theme ? { theme } : {}),
  };
  const nodeIds = new Set(nodes.map((node) => node.id));
  const backgroundIds = new Set(backgrounds.map((background) => background.id));
  const characterMap = new Map(
    characters.map((character) => [character.id, character]),
  );
  const variableMap = new Map(variables.map((item) => [item.id, item]));
  const soundIds = new Set(sounds.map((sound) => sound.id));
  const checkConditions = (list: Condition[], path: string) =>
    list.forEach((condition, k) => {
      const variable = variableMap.get(condition.variableId);
      if (!variable)
        return semanticIssue(
          `${path}[${k}].variableId`,
          "This variable does not exist.",
        );
      if (typeof condition.value !== variable.type)
        semanticIssue(
          `${path}[${k}].value`,
          `“${variable.name}” holds ${variable.type === "boolean" ? "true or false" : "a number"}.`,
        );
      else if (
        variable.type === "boolean" &&
        condition.operator !== "==" &&
        condition.operator !== "!="
      )
        semanticIssue(
          `${path}[${k}].operator`,
          "True/false variables can only be compared with == or !=.",
        );
    });
  const checkEffects = (list: Effect[], path: string) =>
    list.forEach((effect, k) => {
      const variable = variableMap.get(effect.variableId);
      if (!variable)
        return semanticIssue(
          `${path}[${k}].variableId`,
          "This variable does not exist.",
        );
      if (typeof effect.value !== variable.type)
        semanticIssue(
          `${path}[${k}].value`,
          `“${variable.name}” holds ${variable.type === "boolean" ? "true or false" : "a number"}.`,
        );
      else if (variable.type === "boolean" && effect.operation === "add")
        semanticIssue(
          `${path}[${k}].operation`,
          "Only numbers can be added to.",
        );
    });
  const checkActor = (
    characterId: string | undefined,
    poseId: string | undefined,
    path: string,
  ) => {
    if (!characterId) return;
    const character = characterMap.get(characterId);
    if (!character)
      semanticIssue(`${path}.characterId`, "This character does not exist.");
    if (
      poseId &&
      (!character || !character.poses.some((pose) => pose.id === poseId))
    )
      semanticIssue(
        `${path}.poseId`,
        "This pose does not belong to the selected character.",
      );
  };
  if (!nodeIds.has(project.startNodeId))
    semanticIssue("startNodeId", "The opening scene does not exist.");
  nodes.forEach((node, i) => {
    const path = `nodes[${i}]`;
    if (node.backgroundId && !backgroundIds.has(node.backgroundId))
      semanticIssue(`${path}.backgroundId`, "This background does not exist.");
    checkActor(node.characterId, node.poseId, path);
    const onStage = new Set(node.characterId ? [node.characterId] : []);
    node.cast?.forEach((actor, k) => {
      checkActor(actor.characterId, actor.poseId, `${path}.cast[${k}]`);
      if (actor.characterId && onStage.has(actor.characterId))
        semanticIssue(
          `${path}.cast[${k}].characterId`,
          "This character is already on stage in this scene.",
        );
      onStage.add(actor.characterId);
    });
    if (node.type !== "branch" && /[{*\\]/.test(node.text)) {
      const markup = parseMarkup(node.text);
      for (const tag of new Set(markup.unknownTags))
        warnings.push({
          path: `${path}.text`,
          message: `“${tag}” is not a known direction tag and is ignored.`,
        });
      const speaker = node.characterId
        ? characterMap.get(node.characterId)
        : undefined;
      for (const item of markup.items) {
        if (item.kind !== "event") continue;
        const { event } = item;
        if (
          event.type === "expression" &&
          !speaker?.poses.some(
            (pose) =>
              pose.id === event.value ||
              pose.name.toLowerCase() === event.value.toLowerCase(),
          )
        )
          warnings.push({
            path: `${path}.text`,
            message: `{expression=${event.value}} does not match an expression of the speaking character.`,
          });
        if (
          event.type === "sfx" &&
          !sounds.some(
            (sound) =>
              sound.id === event.value ||
              sound.name.toLowerCase() === event.value.toLowerCase(),
          )
        )
          warnings.push({
            path: `${path}.text`,
            message: `{sfx=${event.value}} does not match a sound in Story data.`,
          });
      }
    }
    if (node.textTimings?.length) {
      const words = spokenWords(node.text).length;
      if (node.textTimings.length > words)
        warnings.push({
          path: `${path}.textTimings`,
          message: `${node.textTimings.length} word timings for ${words} spoken words; the extra timings are ignored.`,
        });
      if (!node.audioSrc)
        warnings.push({
          path: `${path}.textTimings`,
          message: "Word timings only apply to a scene with a voice recording.",
        });
    }
    if (node.musicId && !soundIds.has(node.musicId))
      semanticIssue(`${path}.musicId`, "This music track does not exist.");
    if (node.ambienceId && !soundIds.has(node.ambienceId))
      semanticIssue(`${path}.ambienceId`, "This ambience track does not exist.");
    if (node.sfxId && !soundIds.has(node.sfxId))
      semanticIssue(`${path}.sfxId`, "This sound effect does not exist.");
    if (node.effects) checkEffects(node.effects, `${path}.effects`);
    if (node.type === "branch") {
      node.branches.forEach((branch, j) => {
        checkConditions(branch.conditions, `${path}.branches[${j}].conditions`);
        if (!nodeIds.has(branch.nextId))
          semanticIssue(
            `${path}.branches[${j}].nextId`,
            "The branch destination does not exist.",
          );
      });
      if (!nodeIds.has(node.elseId))
        semanticIssue(
          `${path}.elseId`,
          "Choose where the story goes when no branch matches.",
        );
    }
    if (
      node.type === "dialogue" &&
      node.nextId !== null &&
      !nodeIds.has(node.nextId)
    )
      semanticIssue(`${path}.nextId`, "The next scene does not exist.");
    if (node.type === "choice")
      node.choices.forEach((choice, j) => {
        if (!nodeIds.has(choice.nextId))
          semanticIssue(
            `${path}.choices[${j}].nextId`,
            "The choice destination does not exist.",
          );
        if (choice.conditions)
          checkConditions(
            choice.conditions,
            `${path}.choices[${j}].conditions`,
          );
        if (choice.effects)
          checkEffects(choice.effects, `${path}.choices[${j}].effects`);
      });
  });
  // Branches are resolved instantly, so a cycle made only of branches would never show a scene.
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const branchTargets = (node: StoryNode) =>
    node.type === "branch"
      ? [...node.branches.map((branch) => branch.nextId), node.elseId]
      : [];
  const settled = new Set<string>();
  const visiting = new Set<string>();
  const reportedCycle = { value: false };
  const visit = (key: string) => {
    if (settled.has(key) || reportedCycle.value) return;
    const node = nodeMap.get(key);
    if (!node || node.type !== "branch") return;
    if (visiting.has(key)) {
      reportedCycle.value = true;
      semanticIssue(
        `nodes[${nodes.indexOf(node)}]`,
        `“${node.label}” is part of a loop of branches that never reaches a scene.`,
      );
      return;
    }
    visiting.add(key);
    branchTargets(node).forEach(visit);
    visiting.delete(key);
    settled.add(key);
  };
  nodes.forEach((node) => visit(node.id));
  if (!errors.length) {
    const reachable = new Set<string>();
    const queue = [project.startNodeId];
    const map = new Map(nodes.map((node) => [node.id, node]));
    while (queue.length) {
      const key = queue.pop()!;
      if (reachable.has(key)) continue;
      const node = map.get(key);
      if (!node) continue;
      reachable.add(key);
      if (node.type === "dialogue" && node.nextId) queue.push(node.nextId);
      if (node.type === "choice")
        queue.push(...node.choices.map((choice) => choice.nextId));
      queue.push(...branchTargets(node));
    }
    nodes.forEach((node, i) => {
      if (!reachable.has(node.id))
        warnings.push({
          path: `nodes[${i}]`,
          message: `“${node.label}” cannot be reached from the opening scene.`,
        });
      if (node.type === "dialogue" && node.nextId === null)
        warnings.push({
          path: `nodes[${i}].nextId`,
          message: `“${node.label}” ends playback. Add a destination or use an ending scene.`,
        });
      if (
        node.type === "choice" &&
        node.choices.every((choice) => choice.conditions?.length)
      )
        warnings.push({
          path: `nodes[${i}].choices`,
          message: `Every choice in “${node.label}” has a condition. If none hold, the player cannot continue.`,
        });
    });
    if (
      !nodes.some(
        (node) =>
          reachable.has(node.id) &&
          (node.type === "end" ||
            (node.type === "dialogue" && node.nextId === null)),
      )
    )
      warnings.push({
        path: "nodes",
        message:
          "The story has no reachable ending. Finish its connections or add an ending scene.",
      });
  }
  return errors.length
    ? { valid: false, errors, warnings }
    : { valid: true, project, errors, warnings };
}

export function validateDraftProject(input: unknown): ValidationResult {
  return validateProject(input, { draft: true });
}

export function parseProjectJSON(
  text: string,
  options: ValidationOptions = {},
): ValidationResult {
  if (text.length > MAX_JSON_LENGTH)
    return {
      valid: false,
      errors: [
        {
          path: "project",
          message: "Project files must be smaller than 256 MB.",
        },
      ],
      warnings: [],
    };
  try {
    return validateProject(JSON.parse(text), options);
  } catch {
    return {
      valid: false,
      errors: [{ path: "project", message: "This file is not valid JSON." }],
      warnings: [],
    };
  }
}

export function requireValidProject(
  input: unknown,
  options: ValidationOptions = {},
): Project {
  const result = validateProject(input, options);
  if (!result.valid)
    throw new Error(
      result.errors
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("\n"),
    );
  return result.project;
}

export function serializeProject(
  project: Project,
  options: ValidationOptions = {},
): string {
  return JSON.stringify(requireValidProject(project, options), null, 2);
}
