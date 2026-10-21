/**
 * The story player shared by exported games, the studio preview, the studio's live stage and
 * the video renderer. It is bundled into a plain script (scripts/build-player-runtime.mjs) and
 * reads its data from JSON script elements. Story rules come from the engine; this file renders
 * and handles input.
 */
import {
  advancePlayer,
  availableChoices,
  chooseOption,
  createPlayerState,
  getCurrentNode,
  isEnding,
  previousNode,
} from "../engine/player";
import { parseScreenFx, plainText, type MarkupEvent, type ScreenFx } from "../engine/markup";
import { ambienceDuck, DEFAULT_MUSIC_DUCK, DEFAULT_THEME } from "../engine/staging";
import type {
  Character,
  PlayerSnapshot,
  PlayerState,
  Project,
  StoryNode,
  TextboxStyle,
  Theme,
  VariableValue,
} from "../engine/types";
import { createActorStage, type ActorSpec, type PortraitFactory } from "./actors";
import { createScreenFx } from "./screen-fx";
import { createStage } from "./stage";
import { renderStaticText, revealText, type TextReveal } from "./text";
import { createWeather } from "./weather";
import { createActorLighting } from "./light";

export interface RecordConfig {
  startNodeId?: string;
  /** Choice scene ID → choice ID. Missing or unavailable choices use the first available one. */
  route?: Record<string, string>;
  /** Milliseconds of title card before the story; 0 shows none. */
  titleCard?: number;
  /** Pause after each line has finished, in milliseconds. */
  linePause?: number;
  /** How long choices stay visible before the route's choice is taken, in milliseconds. */
  choicePause?: number;
  /** Safety limit on scenes played. */
  maxScenes?: number;
}

export interface PlayerConfig {
  /**
   * export: a game with a title screen. preview: the studio's play-test overlay.
   * record: plays one route by itself for the video renderer.
   * stage: the studio's live, editable view of a single scene.
   */
  mode: "export" | "preview" | "record" | "stage";
  /** Begin from this scene instead of the opening scene. */
  startNodeId?: string;
  record?: RecordConfig;
}

export interface RecordingStatus {
  status: "playing" | "done" | "error";
  scenes: number;
  nodeId: string;
  message?: string;
}

interface SaveSlot extends PlayerSnapshot {
  history: PlayerSnapshot[];
  savedAt: string;
  label: string;
}

interface Settings {
  textSpeed: "slow" | "normal" | "fast" | "instant";
  musicVolume: number;
  voiceVolume: number;
  effectsVolume: number;
}

/** Messages the studio sends to a stage-mode player. */
interface StageMessage {
  type: "frame-stage:show";
  project: Project;
  assets: Record<string, string>;
  nodeId: string;
  /** Replay entrances, typing and voice instead of showing the finished scene. */
  animate?: boolean;
  /** With animate: show this scene first, then play the change into nodeId. */
  fromNodeId?: string;
  selected?: string;
}

const DEFAULT_SETTINGS: Settings = {
  textSpeed: "normal",
  musicVolume: 0.6,
  voiceVolume: 0.9,
  effectsVolume: 0.8,
};
const SPEED_FACTOR = { slow: 0.55, normal: 1, fast: 2, instant: 0 };
const SLOT_COUNT = 3;
const NOVEL_PAGE = 6;
/** Title cards hold each glyph's entrance and gold shimmer this long (see style.ts). */
const TITLE_ENTRY_MS = 1950;
/** Music ducks under a voice line and comes back up between lines (milliseconds). */
const DUCK_DOWN_MS = 300;
const DUCK_UP_MS = 400;
// Long enough that the music stays down between back-to-back lines instead of pumping.
const DUCK_RELEASE_DELAY_MS = 1200;
/** The ambience bed fades in gently and out a little faster, so a sudden silence still reads. */
const AMBIENCE_FADE_IN_MS = 1500;
const AMBIENCE_FADE_OUT_MS = 1200;
type Direction = "forward" | "back" | "jump" | "begin" | "edit";

function readJson<T>(id: string): T {
  const element = document.getElementById(id);
  if (!element?.textContent) throw new Error(`Missing ${id}.`);
  return JSON.parse(element.textContent) as T;
}

/** How long a recording holds its end card before the curtain closes (ms). */
const END_CARD_MS = 2200;
/** The end card's hold after a closing track has played out (ms). */
const AFTER_TRACK_MS = 1000;
/** Longest wait for a closing track that never reports its end (ms). */
const END_TRACK_CEILING_MS = 60000;
/** Text-panel height (px) a narrow screen absorbs before portraits are lifted above it. */
const PANEL_LIFT_FROM_PX = 210;

function start(): void {
  let project = readJson<Project>("project-data");
  let assets = readJson<Record<string, string>>("asset-data");
  const config = readJson<PlayerConfig>("player-config");
  const mode = config.mode;
  const preview = mode === "preview";
  const recording = mode === "record";
  const staging = mode === "stage";
  const studio = preview || staging;
  const record = {
    linePause: 900,
    choicePause: 2200,
    maxScenes: 400,
    titleCard: 0,
    ...config.record,
  };
  const factory = (window as unknown as { FrameAnimation: PortraitFactory })
    .FrameAnimation;
  const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  const player = byId("player");
  player.dataset.mode = mode;
  let nodes = new Map<string, StoryNode>();
  let characters = new Map<string, Character>();
  let theme: Theme = DEFAULT_THEME;
  const loadProject = (next: Project) => {
    project = next;
    nodes = new Map(project.nodes.map((node) => [node.id, node]));
    characters = new Map(project.characters.map((item) => [item.id, item]));
    theme = { ...DEFAULT_THEME, ...project.theme };
    player.dataset.font = theme.font;
    player.dataset.focus = theme.focus;
    player.style.setProperty("--accent", theme.accent);
    player.style.setProperty("--text-scale", String(theme.textScale ?? 1));
  };
  loadProject(project);
  const reducedMotion =
    !recording && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Exported games resolve only embedded data; the studio may load its own URLs directly.
  const resolveAsset = (src: string): string => {
    if (src.startsWith("data:")) return src;
    if (Object.hasOwn(assets, src)) return assets[src];
    if (studio) return src;
    throw new Error("An embedded story asset is missing.");
  };

  /* ---------- persistence: saves and settings ---------- */
  const memory = new Map<string, string>();
  const storageKey = `frame-vn:${project.id}`;
  const ephemeral = studio || recording;
  const storage = {
    get(key: string): string | null {
      if (ephemeral) return memory.get(key) ?? null;
      try {
        return localStorage.getItem(`${storageKey}:${key}`);
      } catch {
        return memory.get(key) ?? null;
      }
    },
    set(key: string, value: string) {
      memory.set(key, value);
      if (ephemeral) return;
      try {
        localStorage.setItem(`${storageKey}:${key}`, value);
      } catch {
        /* Private browsing or file:// restrictions: saves last for this visit. */
      }
    },
  };
  let settings: Settings = { ...DEFAULT_SETTINGS };
  if (!recording)
    try {
      settings = {
        ...DEFAULT_SETTINGS,
        ...JSON.parse(storage.get("settings") ?? "{}"),
      };
    } catch {
      /* Use defaults. */
    }

  /* ---------- stage ---------- */
  const notice = (message: string) => {
    byId("notice").textContent = message;
    byId("notice").hidden = !message;
  };
  const stage = createStage({
    viewport: byId("viewport"),
    camera: byId("camera"),
    layers: [byId("bg-a"), byId("bg-b")],
    curtain: byId("curtain"),
    reducedMotion,
  });
  const actors = createActorStage({
    container: byId("actors"),
    characters: () => characters,
    factory,
    resolveAsset,
    settings: () => ({ volume: settings.voiceVolume }),
    reducedMotion,
    onProblem: (message) => {
      if (!recording) notice(message);
    },
  });
  const weather = createWeather(byId<HTMLCanvasElement>("weather"), { reducedMotion });
  const lighting = createActorLighting(player, byId("viewport"));
  const screenFx = createScreenFx({
    layer: byId("screen-fx"),
    viewport: byId("viewport"),
    reducedMotion,
  });
  // Embedded storybook fonts load before the first frame that needs them (the video renderer
  // waits for document.fonts.ready before it starts capturing).
  try {
    for (const face of ['500 1em "Cormorant Garamond"', 'italic 500 1em "Cormorant Garamond"', '600 1em "Cinzel"'])
      void document.fonts?.load(face).catch(() => undefined);
  } catch {
    /* Font loading is an optimisation only. */
  }

  /* ---------- story state ---------- */
  const firstNode =
    (studio || recording) && config.startNodeId ? config.startNodeId : undefined;
  // The live stage shows any scene as written, without entering it through the story.
  const sceneState = (nodeId: string): PlayerState => ({
    nodeId,
    variables: {},
    musicId: null,
    history: [],
  });
  let state: PlayerState = staging
    ? sceneState(config.startNodeId ?? project.startNodeId)
    : createPlayerState(project, firstNode);
  let started = false;
  let sound = true;
  let auto = recording;
  let autoTimer: number | null = null;
  let textTimer: number | null = null;
  /** Pending start of the line's voice, a moment after its text (see `voiceDelay`). */
  let voiceTimer: number | null = null;
  let choiceTimer: number | null = null;
  // Record mode: the route's choice, taken once the question's text and voice have finished.
  let pendingChoice: (() => void) | null = null;
  /**
   * Expressions change between speech, never during it: a tag inside a voiced line waits until
   * the recording ends, so the face is never mid-morph while the mouth should be talking.
   */
  let deferredExpression: string | null = null;
  let reveal: TextReveal | null = null;
  let revealed = false;
  let renderGeneration = 0;
  let voice: HTMLAudioElement | null = null;
  let voiceDone = true;
  let music: HTMLAudioElement | null = null;
  let musicId: string | null = null;
  let speakerId: string | null = null;
  let lastRendered: StoryNode | null = null;
  let novelLog: { speaker: string; color?: string; text: string }[] = [];
  let scenes = 0;
  let recordStatus: RecordingStatus = {
    status: "playing",
    scenes: 0,
    nodeId: state.nodeId,
  };
  let selectedActor: string | undefined;
  let performTimer: number | null = null;

  /* ---------- small helpers ---------- */
  const speakerFor = (node: StoryNode) =>
    node.speaker ||
    (node.characterId && characters.get(node.characterId)?.name) ||
    "";
  const clearTimers = () => {
    if (autoTimer !== null) clearTimeout(autoTimer);
    if (textTimer !== null) clearTimeout(textTimer);
    if (voiceTimer !== null) clearTimeout(voiceTimer);
    if (choiceTimer !== null) clearTimeout(choiceTimer);
    autoTimer = textTimer = voiceTimer = choiceTimer = null;
    deferredExpression = null;
    pendingChoice = null;
    reveal?.dispose();
    reveal = null;
  };
  const soundByRef = (ref: string) =>
    project.sounds.find((item) => item.id === ref) ??
    project.sounds.find((item) => item.name.toLowerCase() === ref.toLowerCase());
  const playEffect = (id: string | undefined) => {
    const effect = id ? soundByRef(id) : undefined;
    if (!effect || !sound || !started || staging) return;
    const audio = new Audio(resolveAsset(effect.src));
    audio.volume = settings.effectsVolume * (effect.volume ?? 1);
    void audio.play().catch(() => undefined);
  };
  const finishRecording = (status: "done" | "error", message?: string) => {
    if (recordStatus.status !== "playing") return;
    recordStatus = {
      status,
      scenes,
      nodeId: state.nodeId,
      ...(message ? { message } : {}),
    };
    document.documentElement.dataset.recording = status;
  };

  /* ---------- music: one looping track that continues between scenes ---------- */
  // A newer ramp on the same element takes over from an older one.
  const rampTokens = new WeakMap<HTMLAudioElement, number>();
  let rampSerial = 0;
  function ramp(audio: HTMLAudioElement, to: number, ms: number, done?: () => void) {
    const token = ++rampSerial;
    rampTokens.set(audio, token);
    const from = audio.volume;
    const began = performance.now();
    const step = () => {
      if (rampTokens.get(audio) !== token) return;
      const t = ms > 0 ? Math.min(1, (performance.now() - began) / ms) : 1;
      // Smoothstep: no audible corner at either end of the fade.
      const eased = t * t * (3 - 2 * t);
      audio.volume = Math.min(1, Math.max(0, from + (to - from) * eased));
      if (t < 1) requestAnimationFrame(step);
      else done?.();
    };
    if (reducedMotion || ms <= 0) {
      audio.volume = to;
      done?.();
    } else step();
  }
  // While a voice line plays, the music ducks; it comes back up shortly after the line ends.
  let ducked = false;
  let duckTimer: number | null = null;
  const duckLevel = () =>
    Math.min(1, Math.max(0, theme.musicDuck ?? DEFAULT_MUSIC_DUCK));
  let musicGain = 1;
  const musicLevel = () => settings.musicVolume * musicGain * (ducked ? duckLevel() : 1);
  function setDucked(on: boolean) {
    if (duckTimer !== null) clearTimeout(duckTimer);
    duckTimer = null;
    const apply = () => {
      if (ducked === on) return;
      ducked = on;
      if (music && !music.paused) ramp(music, musicLevel(), on ? DUCK_DOWN_MS : DUCK_UP_MS);
      if (ambience && !ambience.paused)
        ramp(ambience, ambienceLevel(), on ? DUCK_DOWN_MS : DUCK_UP_MS);
    };
    if (on || !ducked) apply();
    else duckTimer = window.setTimeout(apply, DUCK_RELEASE_DELAY_MS);
  }
  function syncMusic(force = false) {
    const wanted = sound && started && !staging ? state.musicId : null;
    // A track that played once to its end counts as playing, so it does not start over.
    const playing = !!music && (!music.paused || music.ended);
    // A track blocked by autoplay rules is retried on the next scene.
    if (!force && wanted === musicId && playing === !!wanted) return;
    const previous = music;
    if (previous)
      ramp(previous, 0, 700, () => {
        previous.pause();
        previous.removeAttribute("src");
        previous.load();
      });
    music = null;
    musicId = wanted;
    const track = wanted ? project.sounds.find((item) => item.id === wanted) : undefined;
    if (!track) return;
    const audio = new Audio(resolveAsset(track.src));
    audio.loop = track.loop !== false;
    audio.volume = 0;
    music = audio;
    musicGain = track.volume ?? 1;
    void audio
      .play()
      .then(() => ramp(audio, musicLevel(), previous ? 900 : 600))
      .catch(() => {
        if (music === audio && !recording)
          notice("Music could not start. Use Sound to try again.");
      });
  }

  /** Plays a screen effect; the Radiance and the warmth also melt any frost weather on screen. */
  function playFx(fx: ScreenFx) {
    screenFx.play(fx);
    if (fx.name === "radiance" || fx.name === "warmth") weather.thaw();
  }

  /* ---------- ambience: a looping bed on its own channel, beside the music ---------- */
  let ambience: HTMLAudioElement | null = null;
  let ambienceId: string | null = null;
  let ambienceGain = 1;
  function ambienceLevel() {
    const duck = ducked ? ambienceDuck(duckLevel()) : 1;
    return settings.effectsVolume * ambienceGain * duck;
  }
  function syncAmbience(force = false) {
    const wanted = sound && started && !staging ? (state.ambienceId ?? null) : null;
    const playing = !!ambience && !ambience.paused;
    if (!force && wanted === ambienceId && playing === !!wanted) return;
    const previous = ambience;
    if (previous)
      ramp(previous, 0, AMBIENCE_FADE_OUT_MS, () => {
        previous.pause();
        previous.removeAttribute("src");
        previous.load();
      });
    ambience = null;
    ambienceId = wanted;
    const bed = wanted ? project.sounds.find((item) => item.id === wanted) : undefined;
    if (!bed) return;
    const audio = new Audio(resolveAsset(bed.src));
    audio.loop = bed.loop !== false;
    audio.volume = 0;
    ambience = audio;
    ambienceGain = bed.volume ?? 1;
    void audio
      .play()
      .then(() => ramp(audio, ambienceLevel(), AMBIENCE_FADE_IN_MS))
      .catch(() => undefined);
  }

  /* ---------- presentation ---------- */
  function textboxFor(node: StoryNode): TextboxStyle {
    return node.textbox ?? theme.textbox;
  }
  function specsFor(node: StoryNode): ActorSpec[] {
    const specs: ActorSpec[] = [];
    if (node.characterId)
      specs.push({
        characterId: node.characterId,
        poseId: node.poseId,
        position: node.position,
        y: node.y,
        scale: node.scale,
        flip: node.flip,
        enter: node.enter,
        exit: node.exit,
        emote: node.emote,
        speaking: true,
      });
    for (const actor of node.cast ?? [])
      if (!specs.some((item) => item.characterId === actor.characterId))
        specs.push({ ...actor, speaking: false });
    return specs;
  }
  function placeTextbox(node: StoryNode, style: TextboxStyle) {
    const conversation = byId("conversation");
    conversation.classList.toggle("is-hidden", node.type === "branch");
    const speaker = node.characterId ? specsFor(node)[0] : undefined;
    conversation.classList.toggle("is-narration", !speaker);
    if (style === "bubble" && speaker) {
      const x = Math.min(76, Math.max(24, speaker.position));
      conversation.style.setProperty("--bubble-x", `${x}%`);
      conversation.style.transform = "translateX(-50%)";
      const tail = Math.min(86, Math.max(14, 50 + ((speaker.position - x) / 40) * 100));
      conversation.style.setProperty("--tail-x", `${tail}%`);
      conversation.style.setProperty(
        "--tail-skew",
        `${speaker.position > x + 2 ? 18 : speaker.position < x - 2 ? -18 : 0}deg`,
      );
    } else {
      conversation.style.removeProperty("--bubble-x");
      conversation.style.transform = "";
    }
  }
  function updateNovel(node: StoryNode, style: TextboxStyle, direction: Direction) {
    const log = byId("novel-log");
    const previous = lastRendered;
    if (
      style === "novel" &&
      direction === "forward" &&
      previous &&
      previous.id !== node.id &&
      textboxFor(previous) === "novel" &&
      previous.backgroundId === node.backgroundId &&
      previous.type !== "branch"
    ) {
      novelLog.push({
        speaker: speakerFor(previous),
        color: previous.characterId
          ? characters.get(previous.characterId)?.color
          : undefined,
        text: previous.text,
      });
      if (novelLog.length >= NOVEL_PAGE) novelLog = [];
    } else if (style !== "novel" || direction !== "edit") novelLog = [];
    log.replaceChildren(
      ...novelLog.map((entry) => {
        const paragraph = document.createElement("p");
        paragraph.className = "novel-entry";
        if (entry.color) paragraph.style.setProperty("--entry-color", entry.color);
        const body = document.createElement("span");
        renderStaticText(body, entry.text);
        if (entry.speaker) {
          const name = document.createElement("b");
          name.textContent = entry.speaker;
          paragraph.append(name);
        }
        paragraph.append(body);
        return paragraph;
      }),
    );
  }
  /** Restarts a one-shot CSS animation. */
  const replay = (element: HTMLElement, className: string) => {
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
  };
  const morphing = () => theme.expressionChange === "morph";
  function applyDeferredExpression(): boolean {
    const value = deferredExpression;
    deferredExpression = null;
    return !!value && !!speakerId && actors.setExpression(speakerId, value, morphing());
  }
  function handleEvent(event: MarkupEvent, skipped: boolean) {
    if (event.type === "expression") {
      if (!speakerId) return;
      if ((voice && !voiceDone) || voiceTimer !== null) deferredExpression = event.value;
      else actors.setExpression(speakerId, event.value, morphing() && !skipped);
    } else if (skipped || staging) return;
    else if (event.type === "shake") stage.shake(event.strength);
    else if (event.type === "flash") stage.flash();
    else if (event.type === "sfx") playEffect(event.value);
    else if (event.type === "fx") playFx(event);
  }

  /* ---------- voice ---------- */
  function stopVoice() {
    setDucked(false);
    actors.stopVoices();
    if (voice) {
      voice.onended = null;
      voice.pause();
      voice.removeAttribute("src");
      voice.load();
      voice = null;
    }
    voiceDone = true;
  }
  function playVoice(node: StoryNode, generation: number) {
    stopVoice();
    if (!sound || !node.audioSrc) return;
    const audio = new Audio(resolveAsset(node.audioSrc));
    audio.volume = settings.voiceVolume;
    voice = audio;
    voiceDone = false;
    if (speakerId) actors.follow(speakerId, audio, node.audioSrc, node.cueUrl);
    // After the line, play any expression change it asked for, then move on.
    const finished = () => {
      voiceDone = true;
      setDucked(false);
      actors.stopVoices();
      if (!applyDeferredExpression() || !speakerId) return scheduleAuto();
      void actors.settled(speakerId).then(() => {
        if (generation === renderGeneration) scheduleAuto();
      });
    };
    audio.onended = () => {
      if (generation === renderGeneration) finished();
    };
    setDucked(true);
    audio.play().catch(() => {
      if (voice !== audio) return;
      if (!recording) notice("Audio could not play. You can continue reading.");
      finished();
    });
  }

  /* ---------- auto mode and recording ---------- */
  function scheduleAuto() {
    if (autoTimer !== null) clearTimeout(autoTimer);
    autoTimer = null;
    if (!auto || !revealed || !voiceDone || staging) return;
    const node = getCurrentNode(project, state);
    if (recording) {
      if (node.type === "choice") {
        const take = pendingChoice;
        pendingChoice = null;
        take?.();
        return;
      }
      if (isEnding(node)) {
        const close = () => {
          const curtain = byId("curtain");
          curtain.classList.remove("white");
          curtain
            .animate([{ opacity: 0 }, { opacity: 1 }], {
              duration: 1100,
              fill: "forwards",
            })
            .finished.catch(() => undefined)
            .then(() => {
              stopVoice();
              if (music) ramp(music, 0, 300);
              if (ambience) ramp(ambience, 0, 300);
              window.setTimeout(() => finishRecording("done"), 400);
            });
        };
        // The end card holds END_CARD_MS, and longer while a closing track that does not loop
        // (an outro jingle) plays out, then AFTER_TRACK_MS: the curtain never cuts it off.
        const track = music && !music.loop && !music.ended ? music : null;
        if (!track) autoTimer = window.setTimeout(close, END_CARD_MS);
        else {
          const generation = renderGeneration;
          const shown = performance.now();
          let closing = false;
          const afterTrack = () => {
            if (closing || generation !== renderGeneration) return;
            closing = true;
            const waited = performance.now() - shown;
            autoTimer = window.setTimeout(close, Math.max(AFTER_TRACK_MS, END_CARD_MS - waited));
          };
          track.addEventListener("ended", afterTrack, { once: true });
          // A track that never reports its end still closes, after its length or a ceiling.
          const left = Number.isFinite(track.duration)
            ? (track.duration - track.currentTime) * 1000
            : END_TRACK_CEILING_MS;
          autoTimer = window.setTimeout(afterTrack, Math.min(END_TRACK_CEILING_MS, left + 1000));
        }
        return;
      }
    } else if (node.type !== "dialogue" || !node.nextId) return;
    const delay = node.audioSrc
      ? recording
        ? record.linePause
        : 700
      : node.audioDuration
        ? node.audioDuration * 1000
        : Math.min(9000, (recording ? record.linePause : 1200) + Array.from(plainText(node.text)).length * 32);
    autoTimer = window.setTimeout(() => {
      autoTimer = null;
      if (auto) next();
    }, delay);
  }

  /* ---------- rendering ---------- */
  function revealDone() {
    revealed = true;
    const node = getCurrentNode(project, state);
    byId("dialogue-box").classList.toggle(
      "is-waiting",
      node.type !== "choice" && !staging,
    );
    byId("continue").textContent = isEnding(node)
      ? "Read again ↺"
      : "Continue →";
    renderChoices(node);
    scheduleAuto();
  }
  function revealAll() {
    if (reveal) reveal.finish();
    else revealDone();
  }
  function renderChoices(node: StoryNode) {
    const list = byId("choices");
    list.replaceChildren();
    if (node.type !== "choice" || !revealed) return;
    const options = availableChoices(project, state);
    if (!options.length) {
      const empty = document.createElement("p");
      empty.className = "no-choices";
      empty.textContent =
        "No path is open from here. Go back to choose differently.";
      list.append(empty);
      if (recording) finishRecording("done", "No choice is available here.");
      return;
    }
    const buttons = options.map((choice, index) => {
      const button = document.createElement("button");
      button.className = "choice";
      button.style.setProperty("--i", String(index));
      const key = document.createElement("span");
      key.className = "choice-key";
      key.textContent = String(index + 1);
      const label = document.createElement("span");
      label.textContent = choice.text || "Continue";
      button.append(key, label);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!recording && !staging) choose(choice.id);
      });
      list.append(button);
      return button;
    });
    if (recording) {
      const wanted = record.route?.[node.id];
      const index = Math.max(
        0,
        options.findIndex((choice) => choice.id === wanted),
      );
      const generation = renderGeneration;
      pendingChoice = () => (choiceTimer = window.setTimeout(() => {
        if (generation !== renderGeneration) return;
        buttons[index].classList.add("picked");
        choiceTimer = window.setTimeout(() => {
          if (generation === renderGeneration) choose(options[index].id);
        }, 750);
      }, record.choicePause));
    }
  }
  function render(direction: Direction = "forward") {
    const generation = ++renderGeneration;
    clearTimers();
    stopVoice();
    stage.clear();
    notice("");
    // One-off screen effects carry over into the next line, but not across jumps.
    if (direction !== "forward" && direction !== "begin") screenFx.clear();
    const node = getCurrentNode(project, state);
    if (recording) {
      scenes += 1;
      recordStatus = { ...recordStatus, scenes, nodeId: node.id };
      if (scenes > record.maxScenes) {
        finishRecording("done", "Stopped after the maximum number of scenes.");
        return;
      }
    }
    const animate =
      direction === "forward" || direction === "begin" || (staging && direction === "jump");
    const transition = animate && !reducedMotion ? (node.transition ?? "cut") : "cut";
    const apply = () => {
      if (generation !== renderGeneration) return;
      const style = textboxFor(node);
      player.dataset.textbox = style;
      if (node.grade) player.dataset.grade = node.grade;
      else delete player.dataset.grade;
      const background = node.backgroundId
        ? project.backgrounds.find((item) => item.id === node.backgroundId)
        : undefined;
      void stage.setBackground(
        background
          ? {
              key: `${background.id}:${background.src.slice(0, 80)}`,
              src: resolveAsset(background.src),
              video: background.kind === "video",
            }
          : null,
        node.backgroundMotion,
        transition,
        !animate,
      );
      stage.setCamera(node.camera, !animate);
      lighting.set(node.light, !animate);
      // With reduced motion only the raindrops stay, as still beads on the glass.
      weather.set(reducedMotion && node.weather !== "raindrops" ? undefined : node.weather);
      // A new background under a transition that does not cover the frame takes the
      // outgoing portraits with it; on a cut, newcomers are simply there.
      const sceneChange =
        animate &&
        !!lastRendered &&
        lastRendered.id !== node.id &&
        lastRendered.backgroundId !== node.backgroundId &&
        transition !== "fade";
      actors.place(specsFor(node), {
        instant: !animate,
        morph: theme.expressionChange === "morph",
        ...(sceneChange
          ? {
              sceneChange: {
                exits: "none" as const,
                ...(transition === "cut" ? { entrances: "none" as const } : {}),
              },
            }
          : {}),
      });
      speakerId =
        node.characterId && actors.ids().includes(node.characterId)
          ? node.characterId
          : null;
      if (animate && node.shake) stage.shake(node.shake);
      if (animate && !staging)
        for (const entry of node.fx ?? []) {
          const fx = parseScreenFx(entry);
          if (fx) playFx(fx);
        }
      const speaker = speakerFor(node);
      const name = byId("speaker");
      const newSpeaker = speaker !== name.textContent || name.hidden !== !speaker;
      name.textContent = speaker;
      name.hidden = !speaker;
      if (animate && (newSpeaker || style === "title")) {
        replay(name, "is-new");
        replay(byId("dialogue-box"), "is-new");
      }
      byId("conversation").classList.toggle("no-name", !speaker);
      const character = node.characterId
        ? characters.get(node.characterId)
        : undefined;
      player.style.setProperty("--name", character?.color ?? "var(--accent)");
      placeTextbox(node, style);
      updateNovel(node, style, direction);
      lastRendered = node;
      byId<HTMLButtonElement>("back").disabled = !state.history.length;
      byId("continue").hidden = node.type === "choice";
      byId("hint").textContent =
        node.type === "choice"
          ? "Choose a path to continue"
          : node.type === "end"
            ? "The end"
            : "Click or press Space to continue";
      byId("scene-label").textContent = node.label;
      const words = plainText(node.text);
      byId("accessible-dialogue").textContent = speaker
        ? `${speaker}: ${words}`
        : words;
      byId("choices").replaceChildren();
      byId("dialogue-box").classList.remove("is-waiting");
      revealed = false;
      byId("continue").textContent = "Show text";
      const cps =
        staging && !animate
          ? 0
          : theme.textSpeed * SPEED_FACTOR[recording ? "normal" : settings.textSpeed];
      const voiced = !!node.audioSrc && sound && !staging;
      const begin = () => {
        if (generation !== renderGeneration) return;
        reveal = revealText(byId("dialogue"), node.text, {
          effect: node.textEffect ?? theme.textEffect,
          cps: reducedMotion ? 0 : cps,
          syncTo:
            voiced && node.audioDuration ? node.audioDuration * 920 : undefined,
          timings: voiced ? node.textTimings : undefined,
          minEntryMs: style === "title" ? TITLE_ENTRY_MS : undefined,
          onEvent: handleEvent,
          onDone: () => {
            if (generation === renderGeneration) revealDone();
          },
        });
      };
      byId("dialogue").replaceChildren();
      // Words and voice start once a background transition has landed and the speaker has
      // finished changing expression: nobody talks mid-morph. With word timings the voice
      // follows the text by a moment, so even the first word is written before it is heard.
      const delay = animate && transition !== "cut" ? 420 : 0;
      const startLine = () => {
        if (generation !== renderGeneration) return;
        begin();
        if (staging && !animate) return;
        const voiceDelay = voiced ? (reveal?.voiceDelay ?? 0) : 0;
        if (!voiceDelay) return playVoice(node, generation);
        voiceDone = false;
        voiceTimer = window.setTimeout(() => {
          voiceTimer = null;
          if (generation === renderGeneration) playVoice(node, generation);
        }, voiceDelay);
      };
      const landed = speakerId
        ? Promise.race([
            actors.settled(speakerId),
            new Promise<void>((resolve) => window.setTimeout(resolve, 1600)),
          ])
        : Promise.resolve();
      const wait = new Promise<void>((resolve) =>
        delay ? (textTimer = window.setTimeout(resolve, delay)) : resolve(),
      );
      void Promise.all([landed, wait]).then(startLine);
      syncMusic();
      syncAmbience();
      if (animate) playEffect(node.sfxId);
      if (!studio && !recording)
        storage.set("autosave", JSON.stringify(slotFromState()));
    };
    // A recording opens behind its own black curtain, so the first scene needs no cover.
    const covered = recording && direction === "begin";
    if (!covered && (transition === "fade" || transition === "flash" || transition === "glitch"))
      void stage.cover(transition, apply);
    else apply();
  }

  /* ---------- navigation ---------- */
  function navigate(
    action: () => PlayerState,
    direction: Direction = "forward",
  ) {
    try {
      state = action();
      render(direction);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "This scene is not connected yet.";
      if (recording) finishRecording("error", message);
      else notice(message);
    }
  }
  function next() {
    if (staging) return;
    if (!revealed) return revealAll();
    const node = getCurrentNode(project, state);
    if (node.type === "dialogue" && node.nextId)
      navigate(() => advancePlayer(project, state));
    else if (isEnding(node) && !recording) restart();
  }
  function back() {
    if (state.history.length && !recording)
      navigate(() => previousNode(state), "back");
  }
  function choose(choiceId: string) {
    navigate(() => chooseOption(project, state, choiceId));
  }
  function restart() {
    novelLog = [];
    navigate(() => createPlayerState(project, firstNode), "jump");
  }

  /* ---------- saves ---------- */
  function slotFromState(): SaveSlot {
    const node = getCurrentNode(project, state);
    return {
      nodeId: state.nodeId,
      variables: state.variables,
      musicId: state.musicId,
      ...(state.ambienceId !== undefined ? { ambienceId: state.ambienceId } : {}),
      history: state.history.slice(-300),
      savedAt: new Date().toISOString(),
      label: node.label || speakerFor(node) || "Untitled scene",
    };
  }
  const validSnapshot = (value: unknown): value is PlayerSnapshot => {
    const item = value as PlayerSnapshot;
    return (
      !!item &&
      typeof item.nodeId === "string" &&
      nodes.has(item.nodeId) &&
      nodes.get(item.nodeId)!.type !== "branch" &&
      !!item.variables &&
      typeof item.variables === "object"
    );
  };
  // Saves from an older version of the story keep only variables it still defines.
  const cleanVariables = (values: Record<string, unknown>) => {
    const result: Record<string, VariableValue> = {};
    for (const variable of project.variables) {
      const value = values[variable.id];
      result[variable.id] =
        typeof value === typeof variable.initial
          ? (value as VariableValue)
          : variable.initial;
    }
    return result;
  };
  function readSlot(key: string): SaveSlot | null {
    try {
      const slot = JSON.parse(storage.get(key) ?? "null") as SaveSlot | null;
      if (!slot || !validSnapshot(slot) || !Array.isArray(slot.history))
        return null;
      return slot;
    } catch {
      return null;
    }
  }
  function loadSlot(slot: SaveSlot) {
    const clean = (snapshot: PlayerSnapshot): PlayerSnapshot => ({
      nodeId: snapshot.nodeId,
      variables: cleanVariables(snapshot.variables),
      musicId:
        snapshot.musicId && project.sounds.some((item) => item.id === snapshot.musicId)
          ? snapshot.musicId
          : null,
      ...(snapshot.ambienceId && project.sounds.some((item) => item.id === snapshot.ambienceId)
        ? { ambienceId: snapshot.ambienceId }
        : {}),
    });
    novelLog = [];
    navigate(
      () => ({
        ...clean(slot),
        history: slot.history.filter(validSnapshot).map(clean),
      }),
      "jump",
    );
  }
  function renderSaves() {
    const list = byId("save-slots");
    list.replaceChildren();
    for (let index = 1; index <= SLOT_COUNT; index++) {
      const key = `slot-${index}`;
      const slot = readSlot(key);
      const row = document.createElement("li");
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `Slot ${index}`;
      const detail = document.createElement("span");
      detail.textContent = slot
        ? `${slot.label} · ${new Date(slot.savedAt).toLocaleString()}`
        : "Empty";
      copy.append(title, detail);
      const save = document.createElement("button");
      save.textContent = "Save";
      save.setAttribute("aria-label", `Save to slot ${index}`);
      save.addEventListener("click", () => {
        storage.set(key, JSON.stringify(slotFromState()));
        renderSaves();
        notice(`Saved to slot ${index}.`);
      });
      const load = document.createElement("button");
      load.textContent = "Load";
      load.disabled = !slot;
      load.setAttribute("aria-label", `Load slot ${index}`);
      load.addEventListener("click", () => {
        const current = readSlot(key);
        if (!current) return;
        byId<HTMLDialogElement>("saves-dialog").close();
        loadSlot(current);
      });
      row.append(copy, save, load);
      list.append(row);
    }
  }

  /* ---------- controls ---------- */
  function begin(slot?: SaveSlot | null) {
    started = true;
    byId("intro").hidden = true;
    if (slot) loadSlot(slot);
    else render("begin");
    const focusTarget = byId("continue").hidden
      ? (byId("choices").querySelector("button") as HTMLElement | null)
      : byId("continue");
    focusTarget?.focus({ preventScroll: true });
  }
  function setSound(on: boolean) {
    sound = on;
    const button = byId("sound");
    button.textContent = sound ? "Sound on" : "Sound off";
    button.setAttribute("aria-pressed", String(sound));
    if (sound) playVoice(getCurrentNode(project, state), renderGeneration);
    else stopVoice();
    syncMusic(true);
    syncAmbience(true);
  }
  function setAuto(on: boolean) {
    auto = on;
    byId("auto").setAttribute("aria-pressed", String(auto));
    byId("auto").textContent = auto ? "Auto on" : "Auto";
    if (auto) scheduleAuto();
    else if (autoTimer !== null) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }
  }
  function applySettings() {
    storage.set("settings", JSON.stringify(settings));
    if (music) ramp(music, musicLevel(), 0);
    if (ambience) ramp(ambience, ambienceLevel(), 0);
    if (voice) voice.volume = settings.voiceVolume;
    actors.updateSettings({ volume: settings.voiceVolume });
  }

  byId("project-title").textContent = project.title;
  byId("intro-title").textContent = project.title;
  byId("intro-description").textContent = project.description;
  document.title = project.title;
  const hasAudio =
    project.sounds.length > 0 || project.nodes.some((node) => node.audioSrc);
  byId("sound").hidden = !hasAudio;
  byId("saves-open").hidden = false;
  const autosave = readSlot("autosave");
  byId("resume").hidden = !autosave || studio;
  player.dataset.textbox = theme.textbox;
  if (mode === "export") {
    const opening = getCurrentNode(project, state);
    const background = opening.backgroundId
      ? project.backgrounds.find((item) => item.id === opening.backgroundId)
      : undefined;
    if (background)
      void stage.setBackground(
        { key: "intro", src: resolveAsset(background.src), video: background.kind === "video" },
        opening.backgroundMotion,
        "cut",
        true,
      );
  }

  byId("begin").addEventListener("click", () => begin());
  byId("resume").addEventListener("click", () => begin(readSlot("autosave")));
  byId("continue").addEventListener("click", next);
  byId("back").addEventListener("click", back);
  byId("restart").addEventListener("click", restart);
  byId("sound").addEventListener("click", () => setSound(!sound));
  byId("auto").addEventListener("click", () => setAuto(!auto));
  // Clicking the scene or the text box advances, as in most visual novels.
  const advanceOnClick = (event: MouseEvent) => {
    if (!started || recording || staging) return;
    if ((event.target as HTMLElement).closest("button, a, input, select, dialog"))
      return;
    next();
  };
  byId("viewport").addEventListener("click", advanceOnClick);
  byId("conversation").addEventListener("click", advanceOnClick);
  // On a phone a long passage makes the text panel tall: lift the portraits by the panel's
  // extra height so faces stay above it (applied by the narrow-screen style only).
  const liftFaces = () =>
    byId("actors").style.setProperty(
      "--panel-lift",
      `${-Math.max(0, byId("conversation").getBoundingClientRect().height - PANEL_LIFT_FROM_PX)}px`,
    );
  if (typeof ResizeObserver !== "undefined")
    new ResizeObserver(liftFaces).observe(byId("conversation"));
  window.addEventListener("resize", liftFaces);
  liftFaces();
  byId("history-open").addEventListener("click", () => {
    const content = byId("history-content");
    content.replaceChildren();
    for (const id of [
      ...state.history.map((entry) => entry.nodeId),
      state.nodeId,
    ]) {
      const node = nodes.get(id);
      if (!node || node.type === "branch") continue;
      const entry = document.createElement("div");
      entry.className = "log-entry";
      const name = document.createElement("strong");
      name.textContent = speakerFor(node) || "Narration";
      const text = document.createElement("p");
      renderStaticText(text, node.text);
      entry.append(name, text);
      content.append(entry);
    }
    byId<HTMLDialogElement>("history-dialog").showModal();
    content.lastElementChild?.scrollIntoView({ block: "end" });
  });
  byId("history-close").addEventListener("click", () =>
    byId<HTMLDialogElement>("history-dialog").close(),
  );
  byId("saves-open").addEventListener("click", () => {
    renderSaves();
    byId<HTMLDialogElement>("saves-dialog").showModal();
  });
  byId("saves-close").addEventListener("click", () =>
    byId<HTMLDialogElement>("saves-dialog").close(),
  );
  const speed = byId<HTMLSelectElement>("setting-speed");
  const musicVolume = byId<HTMLInputElement>("setting-music");
  const voiceVolume = byId<HTMLInputElement>("setting-voice");
  const effectsVolume = byId<HTMLInputElement>("setting-effects");
  byId("settings-open").addEventListener("click", () => {
    speed.value = settings.textSpeed;
    musicVolume.value = String(settings.musicVolume);
    voiceVolume.value = String(settings.voiceVolume);
    effectsVolume.value = String(settings.effectsVolume);
    byId<HTMLDialogElement>("settings-dialog").showModal();
  });
  speed.addEventListener("change", () => {
    settings.textSpeed = speed.value as Settings["textSpeed"];
    applySettings();
  });
  for (const [input, key] of [
    [musicVolume, "musicVolume"],
    [voiceVolume, "voiceVolume"],
    [effectsVolume, "effectsVolume"],
  ] as const)
    input.addEventListener("input", () => {
      settings[key] = Number(input.value);
      applySettings();
    });
  byId("settings-close").addEventListener("click", () =>
    byId<HTMLDialogElement>("settings-dialog").close(),
  );
  byId("close-preview").hidden = !preview;
  const closePreview = () => {
    stopVoice();
    music?.pause();
    ambience?.pause();
    // The studio checks that the message comes from its own preview frame.
    parent.postMessage({ type: "frame-player:close" }, "*");
  };
  byId("close-preview").addEventListener("click", closePreview);

  document.addEventListener("keydown", (event) => {
    if (recording || staging) return;
    const dialogOpen = document.querySelector("dialog[open]");
    if (event.key === "Escape" && preview && !dialogOpen) {
      event.preventDefault();
      closePreview();
      return;
    }
    if (
      !started ||
      dialogOpen ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    const target = event.target as HTMLElement | null;
    if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      back();
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      next();
      return;
    }
    const node = getCurrentNode(project, state);
    if (node.type === "choice" && /^[1-8]$/.test(event.key)) {
      if (!revealed) return;
      const choice = availableChoices(project, state)[Number(event.key) - 1];
      if (choice) {
        event.preventDefault();
        choose(choice.id);
      }
      return;
    }
    if (event.key.toLowerCase() === "h") {
      byId("history-open").click();
      return;
    }
    if (event.key.toLowerCase() === "a") {
      setAuto(!auto);
      return;
    }
    if (
      (event.key === " " || event.key === "Enter") &&
      target?.tagName !== "BUTTON"
    ) {
      event.preventDefault();
      next();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (recording) return;
    if (document.hidden) {
      stopVoice();
      music?.pause();
      ambience?.pause();
    } else if (sound && started) {
      if (music) void music.play().catch(() => undefined);
      if (ambience) void ambience.play().catch(() => undefined);
    }
  });
  window.addEventListener("pagehide", () => {
    clearTimers();
    stopVoice();
    music?.pause();
    ambience?.pause();
    actors.dispose();
    weather.dispose();
  });

  /* ---------- live stage: the studio edits a scene in place ---------- */
  if (staging) {
    started = true;
    sound = true;
    byId("intro").hidden = true;
    const markSelected = () => {
      for (const id of actors.ids())
        actors.element(id)?.classList.toggle("is-selected", id === selectedActor);
    };
    window.addEventListener("message", (event) => {
      if (event.source !== parent) return;
      const message = event.data as StageMessage;
      if (message?.type !== "frame-stage:show") return;
      assets = message.assets ?? {};
      loadProject(message.project);
      if (!nodes.has(message.nodeId)) return;
      selectedActor = message.selected;
      if (performTimer !== null) clearTimeout(performTimer);
      performTimer = null;
      if (message.animate && message.fromNodeId && nodes.has(message.fromNodeId)) {
        // The previous shot as it ends, then the cut into this one: transition, glides,
        // entrances, exits and expression morphs exactly as players will see them.
        state = sceneState(message.fromNodeId);
        render("edit");
        const target = message.nodeId;
        performTimer = window.setTimeout(() => {
          performTimer = null;
          state = sceneState(target);
          render("jump");
          markSelected();
        }, 700);
      } else {
        state = sceneState(message.nodeId);
        render(message.animate ? "jump" : "edit");
      }
      markSelected();
    });
    // Stage marks appear while someone is dragged; positions snap to them.
    const guides = document.createElement("div");
    guides.className = "stage-guides";
    guides.setAttribute("aria-hidden", "true");
    const MARKS = [12, 30, 50, 70, 88];
    for (const mark of MARKS) {
      const line = document.createElement("i");
      line.style.left = `${mark}%`;
      line.dataset.mark = String(mark);
      guides.append(line);
    }
    const dropLine = document.createElement("b");
    guides.append(dropLine);
    byId("viewport").append(guides);
    const snap = (position: number) => {
      const near = MARKS.find((mark) => Math.abs(mark - position) <= 2.5);
      for (const line of guides.querySelectorAll<HTMLElement>("i"))
        line.classList.toggle("is-hit", Number(line.dataset.mark) === near);
      return near ?? position;
    };
    const stageX = (clientX: number) => {
      const rect = player.getBoundingClientRect();
      return Math.round(Math.min(95, Math.max(5, ((clientX - rect.left) / rect.width) * 100)));
    };
    // Characters dragged in from the studio's cast list land where they are dropped.
    const CHARACTER_TYPE = "application/x-frame-character";
    const viewportElement = byId("viewport");
    viewportElement.addEventListener("dragover", (event) => {
      if (!event.dataTransfer?.types.includes(CHARACTER_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      player.classList.add("is-dropping");
      dropLine.style.left = `${snap(stageX(event.clientX))}%`;
    });
    viewportElement.addEventListener("dragleave", (event) => {
      if (event.relatedTarget && viewportElement.contains(event.relatedTarget as Node)) return;
      player.classList.remove("is-dropping");
    });
    viewportElement.addEventListener("drop", (event) => {
      const id = event.dataTransfer?.getData(CHARACTER_TYPE);
      player.classList.remove("is-dropping");
      if (!id) return;
      event.preventDefault();
      parent.postMessage(
        { type: "frame-stage:drop", characterId: id, position: snap(stageX(event.clientX)) },
        "*",
      );
    });
    // Clicking the empty stage clears the selection; a double click hands someone the line.
    viewportElement.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest(".actor")) return;
      selectedActor = undefined;
      markSelected();
      parent.postMessage({ type: "frame-stage:select", characterId: "" }, "*");
    });
    byId("actors").addEventListener("dblclick", (event) => {
      const id = (event.target as HTMLElement).closest<HTMLElement>(".actor")?.dataset.character;
      if (id) parent.postMessage({ type: "frame-stage:speak", characterId: id }, "*");
    });
    // Drag characters to place them; the wheel changes their depth.
    let drag:
      | { id: string; startX: number; startY: number; position: number; y: number; moved: boolean }
      | undefined;
    const report = (id: string, patch: Record<string, number>) =>
      parent.postMessage({ type: "frame-stage:actor", characterId: id, ...patch }, "*");
    byId("actors").addEventListener("pointerdown", (event) => {
      const element = (event.target as HTMLElement).closest<HTMLElement>(".actor");
      const id = element?.dataset.character;
      if (!element || !id) return;
      const spec = actors.spec(id);
      if (!spec) return;
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      element.classList.add("dragging");
      drag = { id, startX: event.clientX, startY: event.clientY, position: spec.position, y: spec.y ?? 0, moved: false };
      selectedActor = id;
      markSelected();
      parent.postMessage({ type: "frame-stage:select", characterId: id }, "*");
    });
    byId("actors").addEventListener("pointermove", (event) => {
      if (!drag) return;
      const element = actors.element(drag.id);
      if (!element) return;
      const rect = player.getBoundingClientRect();
      const position = snap(
        Math.round(
          Math.min(95, Math.max(5, drag.position + ((event.clientX - drag.startX) / rect.width) * 100)),
        ),
      );
      player.classList.add("is-dragging");
      const y = Math.round(
        Math.min(40, Math.max(-40, drag.y + ((event.clientY - drag.startY) / rect.height) * 100)),
      );
      drag.moved = true;
      element.style.setProperty("--x", `${position}%`);
      element.style.setProperty("--y", `${y}%`);
      Object.assign(drag, { lastPosition: position, lastY: y });
    });
    const endDrag = () => {
      if (!drag) return;
      const element = actors.element(drag.id);
      element?.classList.remove("dragging");
      player.classList.remove("is-dragging");
      const result = drag as typeof drag & { lastPosition?: number; lastY?: number };
      if (drag.moved && result.lastPosition !== undefined)
        report(drag.id, { position: result.lastPosition, y: result.lastY ?? 0 });
      drag = undefined;
    };
    byId("actors").addEventListener("pointerup", endDrag);
    byId("actors").addEventListener("pointercancel", endDrag);
    byId("actors").addEventListener(
      "wheel",
      (event) => {
        const element = (event.target as HTMLElement).closest<HTMLElement>(".actor");
        const id = element?.dataset.character;
        const spec = id ? actors.spec(id) : undefined;
        if (!element || !id || !spec) return;
        event.preventDefault();
        const scale = Math.round(
          Math.min(1.8, Math.max(0.4, (spec.scale ?? 1) - Math.sign(event.deltaY) * 0.05)) * 100,
        ) / 100;
        element.style.setProperty("--s", String(scale));
        actors.spec(id)!.scale = scale;
        report(id, { scale });
      },
      { passive: false },
    );
    parent.postMessage({ type: "frame-stage:ready" }, "*");
  }

  const api = {
    getState: () => ({
      nodeId: state.nodeId,
      history: state.history.map((entry) => entry.nodeId),
      variables: { ...state.variables },
      musicId: state.musicId,
      ambienceId: state.ambienceId ?? null,
      actors: actors.ids(),
      portrait: (speakerId && actors.status(speakerId)) ?? null,
      textbox: player.dataset.textbox,
      revealed,
      expressions: Object.fromEntries(actors.ids().map((id) => [id, actors.spec(id)?.poseId ?? null])),
      speaking: !!voice && !voiceDone,
    }),
    getRecording: (): RecordingStatus => ({ ...recordStatus, scenes }),
    /** Read-only animation status of every portrait on stage, by character ID. */
    sampleActors: () =>
      Object.fromEntries(actors.ids().map((id) => [id, actors.status(id)])),
  };
  (window as unknown as { FramePlayer: unknown }).FramePlayer = Object.freeze(api);

  if (recording) {
    const curtain = byId("curtain");
    curtain.classList.remove("white");
    curtain.style.opacity = "1";
    byId("intro").hidden = true;
    const card = byId("title-card");
    const go = () => {
      begin();
      curtain.style.opacity = "";
      curtain.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 900,
        fill: "forwards",
      });
    };
    if (record.titleCard > 0) {
      byId("title-card-title").textContent = project.title;
      byId("title-card-subtitle").textContent = project.description.slice(0, 120);
      card.hidden = false;
      curtain.style.opacity = "0";
      window.setTimeout(() => {
        curtain
          .animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, fill: "forwards" })
          .finished.catch(() => undefined)
          .then(() => {
            card.hidden = true;
            go();
          });
      }, record.titleCard);
    } else go();
  } else if (preview) begin();
}

try {
  start();
} catch (error) {
  const message = document.getElementById("fatal");
  if (message) {
    message.hidden = false;
    message.textContent = `This story could not start: ${error instanceof Error ? error.message : "unknown error"}`;
  }
  document.documentElement.dataset.recording = "error";
  throw error;
}
