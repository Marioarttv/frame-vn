import type {
  ActorEmote,
  ActorMotion,
  BackgroundMotion,
  ColorGrade,
  Project,
  TextEffect,
  TextboxStyle,
  Theme,
  Transition,
  Weather,
} from "./types";
import type { ScreenFxName } from "./markup";

/** Presentation vocabulary with the labels the studio shows. Order is display order. */
export const TRANSITION_LABELS: Record<Transition, string> = {
  cut: "Cut",
  dissolve: "Dissolve",
  fade: "Fade through black",
  flash: "Flash through white",
  "wipe-left": "Wipe left",
  "wipe-right": "Wipe right",
  "wipe-up": "Wipe up",
  "wipe-down": "Wipe down",
  iris: "Iris open",
  blinds: "Blinds",
  "slide-left": "Push left",
  "slide-right": "Push right",
  zoom: "Zoom through",
  blur: "Focus pull",
  glitch: "Glitch",
  burn: "Burn away",
  seam: "Seam split",
};
export const TRANSITIONS = Object.keys(TRANSITION_LABELS) as Transition[];

export const TEXTBOX_LABELS: Record<TextboxStyle, string> = {
  classic: "Classic panel",
  cinematic: "Cinematic subtitles",
  bubble: "Speech bubble",
  novel: "Full-screen novel",
  minimal: "Minimal",
  gilded: "Gilded art deco",
  chem: "Neon chem-punk",
  terminal: "Terminal",
  parchment: "Parchment",
  glass: "Frosted glass",
  hologram: "Holographic panel",
  grimoire: "Grimoire parchment",
  title: "Title card",
};
export const TEXTBOX_STYLES = Object.keys(TEXTBOX_LABELS) as TextboxStyle[];

export const TEXT_EFFECT_LABELS: Record<TextEffect, string> = {
  typewriter: "Typewriter",
  fade: "Soft fade",
  rise: "Rise",
  blur: "Blur in",
  pop: "Pop",
  scramble: "Decode",
  word: "Word by word",
  bounce: "Bouncy drop",
  fly: "Fly in",
  spin: "Spin in",
  stretch: "Stretch up",
  unfold: "Unfold",
  glitch: "Glitch in",
  quill: "Enchanted quill",
  instant: "Instant",
};
export const TEXT_EFFECTS = Object.keys(TEXT_EFFECT_LABELS) as TextEffect[];

export const WEATHER_LABELS: Record<Weather, string> = {
  rain: "Rain",
  storm: "Storm with lightning",
  snow: "Snow",
  embers: "Embers",
  dust: "Drifting dust",
  fog: "Fog",
  fireflies: "Fireflies",
  sparks: "Holographic sparks",
  motes: "Golden motes",
  candles: "Floating candles",
  magic: "Magic glitter",
  smoke: "Low smoke",
  wind: "Wind and blowing leaves",
  leaves: "Falling leaves",
  airstream: "Flying airstream",
  downpour: "Storm rain, no lightning",
  frost: "Creeping frost",
  raindrops: "Raindrops on the glass",
};
export const WEATHERS = Object.keys(WEATHER_LABELS) as Weather[];

export const GRADE_LABELS: Record<ColorGrade, string> = {
  warm: "Warm",
  cold: "Cold",
  night: "Night",
  dusk: "Dusk",
  noir: "Noir",
  sepia: "Sepia memory",
  toxic: "Toxic glow",
  dream: "Dream",
  vivid: "Vivid",
  drained: "Drained",
};
export const GRADES = Object.keys(GRADE_LABELS) as ColorGrade[];

export const BACKGROUND_MOTION_LABELS: Record<BackgroundMotion, string> = {
  "zoom-in": "Slow push in",
  "zoom-out": "Slow pull out",
  "pan-left": "Pan left",
  "pan-right": "Pan right",
  drift: "Drift",
  sway: "Sway",
};
export const BACKGROUND_MOTIONS = Object.keys(
  BACKGROUND_MOTION_LABELS,
) as BackgroundMotion[];

export const ACTOR_MOTION_LABELS: Record<ActorMotion, string> = {
  fade: "Fade",
  "slide-left": "From the left",
  "slide-right": "From the right",
  rise: "Rise",
  pop: "Pop",
  zoom: "Zoom",
  blur: "Blur",
  uncloak: "Veil reveal",
  none: "Instant",
};
export const ACTOR_MOTIONS = Object.keys(ACTOR_MOTION_LABELS) as ActorMotion[];

export const EMOTE_LABELS: Record<ActorEmote, string> = {
  nod: "Nod",
  shake: "Shake head",
  bounce: "Bounce",
  jump: "Jump",
  tremble: "Tremble",
  lean: "Lean in",
  recoil: "Recoil",
};
export const EMOTES = Object.keys(EMOTE_LABELS) as ActorEmote[];

export const FONT_LABELS: Record<Theme["font"], string> = {
  sans: "Clean sans",
  serif: "Book serif",
  mono: "Monospace",
  rounded: "Rounded",
  condensed: "Condensed",
  storybook: "Storybook (Cormorant & Cinzel)",
};

/** Screen effects for {fx=…} tags and a scene's `fx` list. */
export const SCREEN_FX_LABELS: Record<ScreenFxName, string> = {
  crack: "Glass cracks",
  glint: "Lens glint",
  sparkle: "Gold sparkles",
  ink: "Ink bleed",
  heartbeat: "Heartbeat",
  comet: "Golden comet",
  hair: "Hair curtain",
  tumble: "Tumble and fall",
  stomp: "Double stomp",
  lightning: "Lightning strike",
  frost: "Frost creeps in",
  radiance: "Radiance burst",
  wandlight: "Wand light",
  wandfail: "Wand light gutters out",
  thread: "Thread pulled taut and snapping",
  dome: "Privacy dome",
  transform: "Smoke transformation",
  warmth: "Spreading warmth",
  splat: "Mud volley",
  wail: "Ghostly wail",
  binding: "Binding vow closing",
  fracture: "Soul torn apart",
};

/** Music level while a voice line plays, when the theme does not set `musicDuck`. */
export const DEFAULT_MUSIC_DUCK = 0.45;

/**
 * The ambience bed ducks half as deep as the music: with the default music duck of 0.45 it
 * sits at about 0.72 under a voice, so rain and wind never vanish between words.
 */
export const ambienceDuck = (musicDuck: number) => 1 - (1 - musicDuck) / 2;

export const DEFAULT_THEME: Theme = {
  textbox: "classic",
  textEffect: "typewriter",
  textSpeed: 45,
  font: "sans",
  accent: "#dbe7b1",
  focus: "dim",
  expressionChange: "morph",
};

/** The effective theme: stored values over defaults. */
export function projectTheme(project: Pick<Project, "theme">): Theme {
  return { ...DEFAULT_THEME, ...project.theme };
}

/** Named stage marks, in percent of the stage width. */
export const STAGE_MARKS = [
  { label: "Far left", position: 12 },
  { label: "Left", position: 30 },
  { label: "Center", position: 50 },
  { label: "Right", position: 70 },
  { label: "Far right", position: 88 },
] as const;

export const MIN_ACTOR_SCALE = 0.4;
export const MAX_ACTOR_SCALE = 1.8;
export const MAX_CAMERA_ZOOM = 2.5;
