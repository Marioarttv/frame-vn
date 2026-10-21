/**
 * Characters on stage: placement, entrances and exits, gestures, and expression changes.
 * Each expression is its own portrait layer; changing emotion morphs the face (see morph.ts)
 * while the voice keeps playing and lip sync carries over to the new face.
 */
import type {
  PortraitController,
  PortraitSettings,
} from "../animation/controller";
import { captureFace, loadLandmarks, playMorph, type MorphRun } from "./morph";
import { playUncloak, type CloakRun } from "./uncloak";
import type {
  ActorEmote,
  ActorMotion,
  Character,
  Pose,
} from "../engine/types";

export interface PortraitFactory {
  createPortraitController(
    element: HTMLElement,
    options: {
      character: Character;
      pose: Pose;
      settings?: Partial<PortraitSettings>;
      resolveAsset?: (url: string) => string;
    },
  ): PortraitController;
}

export interface ActorSpec {
  characterId: string;
  poseId?: string;
  position: number;
  y?: number;
  scale?: number;
  flip?: boolean;
  enter?: ActorMotion;
  exit?: ActorMotion;
  emote?: ActorEmote;
  speaking: boolean;
}

interface Face {
  element: HTMLDivElement;
  controller: PortraitController;
  poseId: string;
}

interface Actor {
  character: Character;
  spec: ActorSpec;
  wrapper: HTMLDivElement;
  motion: HTMLDivElement;
  body: HTMLDivElement;
  face: Face;
  /** Faces fading out after an expression change. */
  leaving: Face[];
  /** The expression morph in progress, if any. */
  morph?: MorphRun;
  /** An `uncloak` entrance in progress, if any. */
  cloak?: CloakRun;
  /** Resolves when the latest expression change has fully landed. */
  settled?: Promise<void>;
  change: number;
  voice?: { audio: HTMLAudioElement; src: string; cueUrl?: string };
}

const ENTER_MS = 560;
/** Spread of the settling blink after a morph, so two characters never blink in step (ms). */
const BLINK_STAGGER_MS = 170;

/** FNV-1a hash of a character ID: a stable per-character offset. */
function characterHash(id: string) {
  return Array.from(id).reduce(
    (hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0,
    2166136261,
  );
}
const EXIT_MS = 440;
const EASE = "cubic-bezier(.2,.8,.2,1)";

function motionFrames(kind: ActorMotion): Keyframe[] {
  switch (kind) {
    case "slide-left":
      return [
        { transform: "translateX(-85%)", opacity: 0 },
        { transform: "translateX(0)", opacity: 1 },
      ];
    case "slide-right":
      return [
        { transform: "translateX(85%)", opacity: 0 },
        { transform: "translateX(0)", opacity: 1 },
      ];
    case "rise":
      return [
        { transform: "translateY(9%)", opacity: 0 },
        { transform: "translateY(0)", opacity: 1 },
      ];
    case "pop":
      return [
        { transform: "scale(.72)", opacity: 0, offset: 0 },
        { transform: "scale(1.04)", opacity: 1, offset: 0.65 },
        { transform: "scale(1)", opacity: 1, offset: 1 },
      ];
    case "zoom":
      return [
        { transform: "scale(1.22)", opacity: 0, filter: "blur(6px)" },
        { transform: "scale(1)", opacity: 1, filter: "blur(0)" },
      ];
    case "blur":
      return [
        { opacity: 0, filter: "blur(14px)" },
        { opacity: 1, filter: "blur(0)" },
      ];
    case "none":
      return [];
    default:
      return [{ opacity: 0 }, { opacity: 1 }];
  }
}

function emoteFrames(kind: ActorEmote, flipped: boolean): {
  frames: Keyframe[];
  duration: number;
} {
  const away = flipped ? 1 : -1;
  switch (kind) {
    case "nod":
      return {
        duration: 650,
        frames: [
          { transform: "translateY(0)" },
          { transform: "translateY(1.6%)" },
          { transform: "translateY(0)" },
          { transform: "translateY(.9%)" },
          { transform: "translateY(0)" },
        ],
      };
    case "shake":
      return {
        duration: 620,
        frames: [0, -1.3, 1.3, -0.9, 0.6, 0].map((x) => ({
          transform: `translateX(${x}%) rotate(${x * 0.6}deg)`,
        })),
      };
    case "bounce":
      return {
        duration: 620,
        frames: [0, -3.2, 0, -1.4, 0].map((y) => ({
          transform: `translateY(${y}%)`,
        })),
      };
    case "jump":
      return {
        duration: 720,
        frames: [
          { transform: "translateY(0) scaleY(1)", offset: 0 },
          { transform: "translateY(0) scaleY(.96)", offset: 0.12 },
          { transform: "translateY(-10%) scaleY(1.02)", offset: 0.45 },
          { transform: "translateY(0) scaleY(.97)", offset: 0.8 },
          { transform: "translateY(0) scaleY(1)", offset: 1 },
        ],
      };
    case "tremble":
      return {
        duration: 900,
        frames: Array.from({ length: 16 }, (_, index) => ({
          transform:
            index === 15
              ? "translate(0,0)"
              : `translate(${(((index * 7) % 5) - 2) * 0.18}%, ${(((index * 3) % 5) - 2) * 0.12}%)`,
        })),
      };
    case "lean":
      return {
        duration: 1600,
        frames: [
          { transform: "translateY(0) scale(1)", offset: 0 },
          { transform: "translateY(-1%) scale(1.05)", offset: 0.3 },
          { transform: "translateY(-1%) scale(1.05)", offset: 0.75 },
          { transform: "translateY(0) scale(1)", offset: 1 },
        ],
      };
    case "recoil":
      return {
        duration: 760,
        frames: [
          { transform: "translateX(0) rotate(0)", offset: 0 },
          {
            transform: `translateX(${away * 3.5}%) rotate(${away * 2.2}deg)`,
            offset: 0.25,
          },
          { transform: "translateX(0) rotate(0)", offset: 1 },
        ],
      };
  }
}

export interface PlaceOptions {
  instant: boolean;
  morph: boolean;
  /**
   * The background changed under a transition that does not cover the frame: people
   * leaving go with the old picture instead of fading over the new one, and (on a cut)
   * people arriving are simply there, as in a film cut.
   */
  sceneChange?: { exits: "none"; entrances?: "none" };
}

export interface ActorStage {
  place(specs: ActorSpec[], options: PlaceOptions): void;
  /** Changes one character's expression mid-scene by pose ID or name. */
  setExpression(characterId: string, poseRef: string, morph: boolean): boolean;
  follow(
    characterId: string,
    audio: HTMLAudioElement,
    src: string,
    cueUrl?: string,
  ): boolean;
  stopVoices(): void;
  /** Resolves once the actor's (or every actor's) expression change has finished. */
  settled(characterId?: string): Promise<void>;
  updateSettings(settings: Partial<PortraitSettings>): void;
  element(characterId: string): HTMLElement | undefined;
  spec(characterId: string): ActorSpec | undefined;
  ids(): string[];
  status(characterId: string): ReturnType<PortraitController["getStatus"]> | null;
  dispose(): void;
}

export function createActorStage(options: {
  container: HTMLElement;
  characters: () => Map<string, Character>;
  factory: PortraitFactory;
  resolveAsset: (src: string) => string;
  settings: () => Partial<PortraitSettings>;
  reducedMotion: boolean;
  onProblem: (message: string) => void;
}): ActorStage {
  const actors = new Map<string, Actor>();

  function createFace(
    host: HTMLElement,
    character: Character,
    pose: Pose,
  ): Face {
    const element = document.createElement("div");
    element.className = "actor-face";
    host.append(element);
    const controller = options.factory.createPortraitController(element, {
      character,
      pose,
      resolveAsset: options.resolveAsset,
      settings: options.settings(),
    });
    controller.ready
      .then((ready) => {
        if (!ready)
          options.onProblem(
            "A portrait could not be fully prepared. You can continue reading.",
          );
      })
      .catch(() => options.onProblem("A portrait could not be fully prepared."));
    return { element, controller, poseId: pose.id };
  }
  function disposeFace(face: Face) {
    face.controller.dispose();
    face.element.remove();
  }
  const resolvePose = (character: Character, ref?: string) =>
    character.poses.find((pose) => pose.id === ref) ??
    (ref
      ? character.poses.find(
          (pose) => pose.name.toLowerCase() === ref.toLowerCase(),
        )
      : undefined);

  function applySpec(actor: Actor, spec: ActorSpec, someoneSpeaks: boolean) {
    const style = actor.wrapper.style;
    style.setProperty("--x", `${spec.position}%`);
    style.setProperty("--y", `${spec.y ?? 0}%`);
    style.setProperty("--s", String(spec.scale ?? 1));
    style.setProperty(
      "--z",
      String(Math.round((spec.scale ?? 1) * 100) * 2 + (spec.speaking ? 1 : 0)),
    );
    actor.wrapper.classList.toggle("flipped", !!spec.flip);
    actor.wrapper.classList.toggle("speaking", spec.speaking);
    actor.wrapper.classList.toggle("listening", !spec.speaking && someoneSpeaks);
    actor.wrapper.dataset.character = actor.character.id;
    actor.spec = spec;
  }

  function changePose(actor: Actor, pose: Pose, morph: boolean) {
    if (actor.face.poseId === pose.id) return;
    const change = ++actor.change;
    // A morph still running lands on its final frame first.
    actor.morph?.finish();
    for (const face of actor.leaving) disposeFace(face);
    actor.leaving = [];
    const previous = actor.face;
    const previousPose = actor.character.poses.find((item) => item.id === previous.poseId);
    let landed: () => void = () => undefined;
    actor.settled = new Promise<void>((resolve) => (landed = resolve));
    const next = createFace(actor.body, actor.character, pose);
    actor.face = next;
    if (actor.voice)
      next.controller.follow(actor.voice.audio, actor.voice.src, actor.voice.cueUrl);
    const width = actor.body.clientWidth;
    const height = actor.body.clientHeight;
    // A character may switch expressions with a cut (separately drawn poses, no face rig).
    const cut = actor.character.expressionChange === "cut";
    if (!morph || cut || options.reducedMotion || !width || !height) {
      disposeFace(previous);
      landed();
      return;
    }
    next.element.style.opacity = "0";
    actor.leaving.push(previous);
    const release = (face: Face) => {
      if (!actor.leaving.includes(face)) return;
      actor.leaving = actor.leaving.filter((item) => item !== face);
      disposeFace(face);
    };
    // The old face stays live while the new face prepares (hidden) and landmarks load.
    const prepared = Promise.all([
      previousPose ? loadLandmarks(previousPose, options.resolveAsset) : null,
      loadLandmarks(pose, options.resolveAsset),
      next.controller.ready.catch(() => false).then(() => true),
    ]);
    const timeout = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 700));
    void Promise.race([prepared, timeout]).then((result) => {
      if (change !== actor.change) return landed();
      if (!result?.[2]) {
        // Nothing to morph from in time: a short dissolve is still better than a cut.
        next.element.style.opacity = "";
        next.element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
        window.setTimeout(() => {
          release(previous);
          landed();
        }, 220);
        return;
      }
      const [fromMarks, toMarks] = result;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const canvas = document.createElement("canvas");
      canvas.className = "actor-face actor-morph";
      canvas.setAttribute("aria-hidden", "true");
      const buffers = [document.createElement("canvas"), document.createElement("canvas")];
      actor.body.append(canvas);
      previous.element.style.opacity = "0";
      // Both faces keep animating underneath; the morph reads them every frame.
      const run = playMorph({
        canvas,
        width,
        height,
        ratio,
        fromFrame: () => captureFace(previous.element, width, height, ratio, buffers[0]),
        toFrame: () => captureFace(next.element, width, height, ratio, buffers[1]),
        from: fromMarks,
        to: toMarks,
      });
      actor.morph = run;
      void run.done.then(() => {
        if (actor.morph === run) actor.morph = undefined;
        next.element.style.opacity = "";
        release(previous);
        // The last morph frame is the live new face itself, so the handover is seamless.
        // People often blink as an expression settles; it reads as natural.
        canvas.remove();
        landed();
        if (change === actor.change)
          window.setTimeout(
            () => next.controller.triggerBlink(),
            60 + (characterHash(actor.spec.characterId) % BLINK_STAGGER_MS),
          );
      });
    });
  }

  function create(spec: ActorSpec, character: Character, pose: Pose): Actor {
    const wrapper = document.createElement("div");
    wrapper.className = "actor";
    const motion = document.createElement("div");
    motion.className = "actor-motion";
    const body = document.createElement("div");
    body.className = "actor-body";
    motion.append(body);
    wrapper.append(motion);
    options.container.append(wrapper);
    const actor: Actor = {
      character,
      spec,
      wrapper,
      motion,
      body,
      face: createFace(body, character, pose),
      leaving: [],
      change: 0,
    };
    return actor;
  }

  function remove(actor: Actor, instant: boolean, exit?: ActorMotion) {
    actors.delete(actor.character.id);
    actor.morph?.finish();
    const done = () => {
      for (const face of [actor.face, ...actor.leaving]) disposeFace(face);
      actor.wrapper.remove();
    };
    const kind = exit ?? actor.spec.exit ?? "fade";
    actor.cloak?.cancel();
    if (kind === "uncloak" && !instant) {
      // Pulling the cloak back on: the figure vanishes from the feet up (a fade if reduced).
      actor.wrapper.classList.remove("speaking");
      actor.wrapper.style.pointerEvents = "none";
      void playUncloak(actor.motion, { reverse: true, reducedMotion: options.reducedMotion }).done.then(done);
      return;
    }
    if (instant || options.reducedMotion || kind === "none") return done();
    actor.wrapper.classList.remove("speaking");
    actor.wrapper.style.pointerEvents = "none";
    // Reversed keyframes need mirrored offsets; Web Animations rejects decreasing ones.
    const frames = motionFrames(kind)
      .reverse()
      .map((frame) =>
        frame.offset === undefined || frame.offset === null
          ? frame
          : { ...frame, offset: 1 - Number(frame.offset) },
      );
    actor.motion
      .animate(frames, { duration: EXIT_MS, easing: "ease-in", fill: "forwards" })
      .finished.catch(() => undefined)
      .then(done);
  }

  return {
    place(specs, { instant, morph, sceneChange }) {
      const characters = options.characters();
      const someoneSpeaks = specs.some((spec) => spec.speaking);
      const keep = new Set<string>();
      for (const spec of specs) {
        const character = characters.get(spec.characterId);
        const pose = character
          ? (resolvePose(character, spec.poseId) ?? character.poses[0])
          : undefined;
        if (!character || !pose || keep.has(character.id)) continue;
        keep.add(character.id);
        let actor = actors.get(character.id);
        const entering = !actor;
        if (actor) {
          actor.character = character;
          actor.wrapper.classList.toggle("is-instant", instant);
          changePose(actor, pose, morph && !instant);
        } else {
          actor = create(spec, character, pose);
          actors.set(character.id, actor);
          actor.wrapper.classList.add("is-instant");
        }
        applySpec(actor, spec, someoneSpeaks);
        if (entering) {
          const target = actor;
          // Position first, then allow later moves to animate.
          requestAnimationFrame(() => target.wrapper.classList.remove("is-instant"));
          const kind = sceneChange?.entrances ?? spec.enter ?? "fade";
          if (kind === "uncloak" && !instant) {
            const run = playUncloak(actor.motion, { reducedMotion: options.reducedMotion });
            actor.cloak = run;
            void run.done.then(() => {
              if (target.cloak === run) target.cloak = undefined;
            });
          } else if (!instant && !options.reducedMotion && kind !== "none")
            actor.motion.animate(motionFrames(kind), {
              duration: ENTER_MS,
              easing: EASE,
              fill: "backwards",
            });
        } else if (instant)
          requestAnimationFrame(() =>
            actor!.wrapper.classList.remove("is-instant"),
          );
        if (spec.emote && !instant && !options.reducedMotion) {
          const { frames, duration } = emoteFrames(spec.emote, !!spec.flip);
          actor.body.animate(frames, {
            duration,
            delay: entering ? ENTER_MS * 0.7 : 120,
            easing: "ease-in-out",
          });
        }
      }
      for (const actor of [...actors.values()])
        if (!keep.has(actor.character.id)) remove(actor, instant, sceneChange?.exits);
    },
    setExpression(characterId, poseRef, morph) {
      const actor = actors.get(characterId);
      const pose = actor ? resolvePose(actor.character, poseRef) : undefined;
      if (!actor || !pose) return false;
      changePose(actor, pose, morph);
      actor.spec = { ...actor.spec, poseId: pose.id };
      return true;
    },
    follow(characterId, audio, src, cueUrl) {
      const actor = actors.get(characterId);
      if (!actor) return false;
      actor.voice = { audio, src, cueUrl };
      actor.face.controller.follow(audio, src, cueUrl);
      return true;
    },
    settled(characterId) {
      const list = characterId
        ? [actors.get(characterId)]
        : [...actors.values()];
      return Promise.all(list.map((actor) => actor?.settled)).then(() => undefined);
    },
    stopVoices() {
      for (const actor of actors.values()) {
        actor.voice = undefined;
        actor.face.controller.stop();
      }
    },
    updateSettings(settings) {
      for (const actor of actors.values()) actor.face.controller.update(settings);
    },
    element: (characterId) => actors.get(characterId)?.wrapper,
    spec: (characterId) => actors.get(characterId)?.spec,
    ids: () => [...actors.keys()],
    status: (characterId) =>
      actors.get(characterId)?.face.controller.getStatus() ?? null,
    dispose() {
      for (const actor of actors.values()) {
        actor.morph?.finish();
        actor.cloak?.cancel();
        for (const face of [actor.face, ...actor.leaving]) disposeFace(face);
      }
      actors.clear();
      options.container.replaceChildren();
    },
  };
}
