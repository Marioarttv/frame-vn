/** Portable project data. All asset URLs may also be self-contained data URLs. */
export interface Pose {
  id: string;
  name: string;
  src: string;
  rig?: string;
  capabilities?: {
    mouth: boolean;
    blink: boolean;
    body: boolean;
    gaze: boolean;
    brows: boolean;
  };
  animation?: {
    manifestUrl: string;
    speechIndexUrl: string;
    browsIndexUrl?: string;
    lightingUrl?: string;
    assetRoot: string;
    poseKey: string;
  };
}

export interface Character {
  id: string;
  name: string;
  color: string;
  description?: string;
  poses: Pose[];
  voiceId?: string;
  /** ElevenLabs delivery for this character's lines (0–1 each). */
  voiceSettings?: VoiceSettings;
  voice?: { src: string; cueUrl?: string };
  /**
   * How this character changes expression, overriding the theme: "cut" suits separately
   * drawn poses without a face rig (an animal, say), which cannot morph.
   */
  expressionChange?: "morph" | "cut";
}

export interface VoiceSettings {
  stability: number;
  similarity: number;
  /** Two-letter language code; automatic when absent. */
  languageCode?: string;
}

/** A still image, or a looping silent video for animated backgrounds. */
export interface Background {
  id: string;
  name: string;
  src: string;
  kind?: "image" | "video";
}

/** Story state the player can test and change. Values are numbers or true/false flags. */
export type VariableValue = number | boolean;
export interface Variable {
  id: string;
  name: string;
  type: "number" | "boolean";
  initial: VariableValue;
}
export type ConditionOperator = "==" | "!=" | ">" | ">=" | "<" | "<=";
export interface Condition {
  variableId: string;
  operator: ConditionOperator;
  value: VariableValue;
}
/** "add" applies to numbers only. */
export interface Effect {
  variableId: string;
  operation: "set" | "add";
  value: VariableValue;
}

/**
 * Music loops until another scene changes it; sound effects play once. Ambience is a looping
 * bed (rain, wind, a crowd) on its own channel beside the music: it continues between scenes
 * like music, ducks only lightly under voices and follows the effects volume.
 */
export interface Sound {
  id: string;
  name: string;
  src: string;
  kind: "music" | "sfx" | "ambience";
  /** Music only: false plays the track once instead of looping it (absent: loops). */
  loop?: boolean;
  /** Level of this sound, 0–1, multiplied with the player's volume (absent: 1). */
  volume?: number;
}

/** How a character appears on, or leaves, the stage. */
export type ActorMotion =
  | "fade"
  | "slide-left"
  | "slide-right"
  | "rise"
  | "pop"
  | "zoom"
  | "blur"
  /** An Veil reveal comes off: the figure appears from the top down under a silvery sheen. */
  | "uncloak"
  | "none";
/** A one-off gesture played when the scene begins. */
export type ActorEmote =
  | "nod"
  | "shake"
  | "bounce"
  | "jump"
  | "tremble"
  | "lean"
  | "recoil";

/** Placement shared by the speaker and everyone else on stage. */
export interface ActorStaging {
  /** Vertical offset as a percentage of stage height; negative values move up. */
  y?: number;
  /** Depth: 1 is the default size. */
  scale?: number;
  /** Entrance used when the character was not on stage in the previous scene. */
  enter?: ActorMotion;
  /** Exit used when the next scene no longer shows the character. */
  exit?: ActorMotion;
  emote?: ActorEmote;
}

/** A character shown on stage without speaking in this scene. */
export interface StageActor extends ActorStaging {
  characterId: string;
  poseId?: string;
  /** Horizontal position, expressed as a percentage of the stage width. */
  position: number;
  flip?: boolean;
}

/**
 * Scene transitions. Most reveal the new background; fade, flash and glitch cover the screen.
 * burn: the old background burns away from its edges inward with an ember rim. seam: a glowing
 * line opens across the old background and its halves part to reveal the new one.
 */
export type Transition =
  | "cut"
  | "dissolve"
  | "fade"
  | "flash"
  | "wipe-left"
  | "wipe-right"
  | "wipe-up"
  | "wipe-down"
  | "iris"
  | "blinds"
  | "slide-left"
  | "slide-right"
  | "zoom"
  | "blur"
  | "glitch"
  | "burn"
  | "seam";

export type TextboxStyle =
  | "classic"
  | "cinematic"
  | "bubble"
  | "novel"
  | "minimal"
  | "gilded"
  | "chem"
  | "terminal"
  | "parchment"
  | "glass"
  | "hologram"
  | "grimoire"
  | "title";
export type TextEffect =
  | "typewriter"
  | "fade"
  | "rise"
  | "blur"
  | "pop"
  | "scramble"
  | "word"
  | "bounce"
  | "fly"
  | "spin"
  | "stretch"
  | "unfold"
  | "glitch"
  | "quill"
  | "instant";
export type Weather =
  | "rain"
  | "storm"
  | "snow"
  | "embers"
  | "dust"
  | "fog"
  | "fireflies"
  | "sparks"
  | "motes"
  | "candles"
  | "magic"
  | "smoke"
  | "wind"
  | "leaves"
  | "airstream"
  | "downpour"
  | "frost"
  /** Rain on the camera's glass: sparse beads, now and then one sliding down. */
  | "raindrops";
export type ColorGrade =
  | "warm"
  | "cold"
  | "night"
  | "dusk"
  | "noir"
  | "sepia"
  | "toxic"
  | "dream"
  | "vivid"
  | "drained";
/** Slow camera motion over a still background, which makes it feel alive. */
export type BackgroundMotion =
  | "zoom-in"
  | "zoom-out"
  | "pan-left"
  | "pan-right"
  | "drift"
  | "sway";

/** Framing of the whole stage. Zoom 1 shows everything; x/y are the focus in stage percent. */
/**
 * Scene lighting on the characters (backgrounds already carry their own light). The
 * portraits are tinted toward `color` by `amount`, scaled by `brightness`, optionally
 * desaturated, and given a soft rim light from one side.
 */
export interface ActorLight {
  color: string;
  /** 0 keeps the portrait's colours, 1 multiplies fully by `color`. */
  amount: number;
  /** 1 keeps the brightness; 0.6 is a dim night scene. */
  brightness: number;
  /** 1 keeps saturation; lower values mute colours for night or fog. */
  saturation?: number;
  rim?: string;
  rimFrom?: "left" | "right" | "top";
  /** 0–1, default 0.6. */
  rimStrength?: number;
}

export interface Camera {
  zoom: number;
  x: number;
  y: number;
}

/** Project-wide presentation defaults. Scenes may override textbox and text effect. */
export interface Theme {
  textbox: TextboxStyle;
  textEffect: TextEffect;
  /** Characters per second at the player's normal speed. */
  textSpeed: number;
  /** "storybook" embeds Cormorant Garamond and Cinzel (SIL OFL) in exported players. */
  font: "sans" | "serif" | "mono" | "rounded" | "condensed" | "storybook";
  accent: string;
  /** How listeners are shown while someone speaks. */
  focus: "dim" | "spotlight" | "none";
  /** How a character changes expression. */
  expressionChange: "morph" | "cut";
  /**
   * Music level while a voice line plays, as a fraction of the music volume (0–1).
   * 1 turns ducking off; absent uses DEFAULT_MUSIC_DUCK.
   */
  musicDuck?: number;
  /** Scales all story text (dialogue, names, choices); 1 is the default size. Useful for phone-first video. */
  textScale?: number;
}

/**
 * Every scene describes its complete stage, so any branch can be entered or replayed
 * without depending on the path that led there. Music is the exception: it continues.
 */
export interface NodeBase extends ActorStaging {
  id: string;
  label: string;
  /** May contain inline direction such as {wait=0.5} or {expression=Angry}; see markup.ts. */
  text: string;
  speaker?: string;
  backgroundId?: string;
  /** The speaking character. Narration has none. */
  characterId?: string;
  poseId?: string;
  /** Horizontal position, expressed as a percentage of the stage width. */
  position: number;
  /** Mirrors the speaking character horizontally. */
  flip?: boolean;
  /** Additional characters present on stage. */
  cast?: StageActor[];
  transition?: Transition;
  /** undefined keeps the current music, null stops it, an ID starts that track. */
  musicId?: string | null;
  /** Like `musicId`, for the ambience bed: undefined keeps it, null fades it out. */
  ambienceId?: string | null;
  sfxId?: string;
  /** Applied when the scene is entered. */
  effects?: Effect[];
  audioSrc?: string;
  cueUrl?: string;
  /** Seconds; lets text reveal in step with the recording. */
  audioDuration?: number;
  /**
   * Start time in seconds, relative to the start of `audioSrc`, of each spoken word of the
   * text (whitespace-separated words after direction tags are removed). Each word is written
   * just before it is spoken; words after the last timing are paced normally.
   */
  textTimings?: number[];
  /**
   * Screen effects played when the scene starts, e.g. "crack" or "glint,48,30" (name, then
   * optional x and y in stage percent). Inline {fx=…} tags time them to a word instead.
   */
  fx?: string[];
  textbox?: TextboxStyle;
  textEffect?: TextEffect;
  weather?: Weather;
  grade?: ColorGrade;
  backgroundMotion?: BackgroundMotion;
  camera?: Camera;
  /** Lighting applied to every character on stage in this scene. */
  light?: ActorLight;
  /** Shakes the stage when the scene begins. */
  shake?: "light" | "heavy";
}

export interface DialogueNode extends NodeBase {
  type: "dialogue";
  nextId: string | null;
}

export interface Choice {
  id: string;
  text: string;
  nextId: string;
  /** Shown only when every condition holds. */
  conditions?: Condition[];
  /** Applied when the player picks this choice. */
  effects?: Effect[];
}

export interface ChoiceNode extends NodeBase {
  type: "choice";
  choices: Choice[];
}

export interface EndNode extends NodeBase {
  type: "end";
}

export interface Branch {
  id: string;
  conditions: Condition[];
  nextId: string;
}

/** An invisible router: the first branch whose conditions hold wins, otherwise elseId. */
export interface BranchNode extends NodeBase {
  type: "branch";
  branches: Branch[];
  elseId: string;
}

export type StoryNode = DialogueNode | ChoiceNode | EndNode | BranchNode;

export interface Project {
  schemaVersion: 3;
  id: string;
  title: string;
  description: string;
  startNodeId: string;
  nodes: StoryNode[];
  characters: Character[];
  backgrounds: Background[];
  variables: Variable[];
  sounds: Sound[];
  theme?: Theme;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult =
  | {
      valid: true;
      project: Project;
      errors: ValidationIssue[];
      warnings: ValidationIssue[];
    }
  | {
      valid: false;
      project?: undefined;
      errors: ValidationIssue[];
      warnings: ValidationIssue[];
    };

export interface PlayerSnapshot {
  nodeId: string;
  variables: Record<string, VariableValue>;
  musicId: string | null;
  /** The ambience bed playing at this point; absent in saves made before ambience existed. */
  ambienceId?: string | null;
}

/** Immutable history permits branching, back navigation, and repeatable playback. */
export interface PlayerState extends PlayerSnapshot {
  history: PlayerSnapshot[];
}
