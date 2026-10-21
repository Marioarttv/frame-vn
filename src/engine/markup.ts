/**
 * Inline direction inside dialogue text. Writers keep one line of text and add beats to it:
 *
 *   Wait.{wait=0.6} You *knew*?{expression=Angry}{shake} {color=#7fe3ff}Holographic{/color}, again.
 *
 * Tags: {wait=seconds} (or {w}), {speed=factor}, {expression=name or id} (or {e=…}),
 * {shake} / {shake=heavy}, {flash}, {sfx=name or id}, {color=#hex}…{/color}.
 * Screen effects: {fx=crack}, {fx=glint,48,30} (name, then optional x and y in stage percent);
 * names are crack, glint, sparkle, ink, heartbeat, comet, hair, tumble, stomp, lightning, frost,
 * radiance, wandlight, wandfail, thread, dome, transform, warmth, splat, wail, binding and
 * fracture. `thread` runs between two points instead of one: {fx=thread,34,30,66,30}
 * (x1,y1,x2,y2); `dome` may add a radius in stage-width percent: {fx=dome,40,55,25}. With
 * word timings, events fire when the word they sit before is spoken.
 * *emphasis* and **strong** style text. A backslash escapes { } * and \.
 *
 * Text animation, in the spirit of Febucci's Text Animator:
 * - looping behaviours while the words are on screen: {wave}…{/wave}, {bounce}, {jitter},
 *   {wiggle}, {swing}, {dangle}, {float}, {pulse}, {grow}, {rainbow}, {glow}, {glitch}.
 *   An optional strength scales the motion: {wave=2}.
 * - a different entrance for some words: {in=fly}…{/in} (any text effect name).
 * - size: {size=1.6}…{/size}.
 * Unknown tags are dropped from the text so they never reach players or voice generation.
 */
export interface MarkupRun {
  text: string;
  em?: boolean;
  strong?: boolean;
  color?: string;
  /** Looping behaviours, outermost first. */
  fx?: TextBehavior[];
  /** Entrance for these words instead of the line's text effect. */
  entry?: TextEntry;
  /** Relative font size. */
  size?: number;
}

export const TEXT_BEHAVIORS = [
  "wave",
  "bounce",
  "jitter",
  "wiggle",
  "swing",
  "dangle",
  "float",
  "pulse",
  "grow",
  "rainbow",
  "glow",
  "glitch",
] as const;
export type TextBehaviorName = (typeof TEXT_BEHAVIORS)[number];
export interface TextBehavior {
  name: TextBehaviorName;
  /** 1 is the default strength. */
  strength: number;
}
/** Entrances that can be given to part of a line; the same names as the text effects. */
export const TEXT_ENTRIES = [
  "typewriter",
  "fade",
  "rise",
  "blur",
  "pop",
  "scramble",
  "bounce",
  "fly",
  "spin",
  "stretch",
  "unfold",
  "glitch",
  "quill",
] as const;
export type TextEntry = (typeof TEXT_ENTRIES)[number];
const BEHAVIOR_SET = new Set<string>(TEXT_BEHAVIORS);
const ENTRY_SET = new Set<string>(TEXT_ENTRIES);
export type MarkupEvent =
  | { type: "wait"; seconds: number }
  | { type: "speed"; factor: number }
  | { type: "expression"; value: string }
  | { type: "shake"; strength: "light" | "heavy" }
  | { type: "flash" }
  | { type: "sfx"; value: string }
  | ({ type: "fx" } & ScreenFx);

/** Deterministic full-screen effects layered over the stage. */
export const SCREEN_FX = [
  "crack",
  "glint",
  "sparkle",
  "ink",
  "heartbeat",
  "comet",
  "hair",
  "tumble",
  "stomp",
  "lightning",
  "frost",
  "radiance",
  "wandlight",
  "wandfail",
  "thread",
  "dome",
  "transform",
  "warmth",
  "splat",
  "wail",
  "binding",
  "fracture",
] as const;
export type ScreenFxName = (typeof SCREEN_FX)[number];
export interface ScreenFx {
  name: ScreenFxName;
  /** Stage percent; the effect's own default when absent. */
  x?: number;
  y?: number;
  /** Second point, for effects that run between two points (`thread`). */
  x2?: number;
  y2?: number;
  /** Radius in percent of the stage width, for effects with a size (`dome`). */
  r?: number;
}
const SCREEN_FX_SET = new Set<string>(SCREEN_FX);
/** Effects placed by two points (x1,y1,x2,y2) rather than one. */
const TWO_POINT_FX = new Set<string>(["thread"]);
/** Effects placed by one point that may add a radius (x,y,r). */
const SIZED_FX = new Set<string>(["dome"]);
/** Smallest and largest radius, in percent of the stage width. */
const FX_RADIUS = { min: 2, max: 80 } as const;

/**
 * Reads "crack", "glint,48,30", "thread,34,30,66,30" or "dome,40,55,25". Returns null for
 * unknown names or malformed positions: one-point effects take 0 or 2 numbers, `thread` takes
 * 0 or 4, and `dome` takes 0, 2 or 3 (x, y and a radius in stage-width percent).
 */
export function parseScreenFx(value: string): ScreenFx | null {
  const parts = value.split(",").map((part) => part.trim());
  const name = parts[0]?.toLowerCase() ?? "";
  if (!SCREEN_FX_SET.has(name)) return null;
  const counts = TWO_POINT_FX.has(name) ? [1, 5] : SIZED_FX.has(name) ? [1, 3, 4] : [1, 3];
  if (!counts.includes(parts.length)) return null;
  const numbers = parts.slice(1).map((part) => (part ? Number(part) : Number.NaN));
  if (numbers.some((number) => !Number.isFinite(number))) return null;
  const [x, y, x2, y2] = numbers.map((number) => clamp(number, 0, 100));
  const fx: ScreenFx = { name: name as ScreenFxName };
  if (numbers.length >= 2) {
    fx.x = x;
    fx.y = y;
  }
  if (numbers.length === 3) fx.r = clamp(numbers[2], FX_RADIUS.min, FX_RADIUS.max);
  if (numbers.length === 4) {
    fx.x2 = x2;
    fx.y2 = y2;
  }
  return fx;
}
export type MarkupItem =
  | { kind: "text"; run: MarkupRun }
  | { kind: "event"; event: MarkupEvent };
export interface ParsedMarkup {
  /** The words as players read and voices speak them. */
  plain: string;
  items: MarkupItem[];
  unknownTags: string[];
}

const TAG = /^\{\s*(\/?)([a-zA-Z]+)\s*(?:[=:]\s*([^{}]*?))?\s*\}/;
const COLOR = /^#(?:[\da-fA-F]{3}|[\da-fA-F]{6})$/;
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function parseMarkup(source: string): ParsedMarkup {
  const items: MarkupItem[] = [];
  const unknownTags: string[] = [];
  let em = false;
  let strong = false;
  let color: string | undefined;
  let fx: TextBehavior[] = [];
  let entry: TextEntry | undefined;
  let size: number | undefined;
  let buffer = "";
  let plain = "";
  const flush = () => {
    if (!buffer) return;
    const run: MarkupRun = { text: buffer };
    if (em) run.em = true;
    if (strong) run.strong = true;
    if (color) run.color = color;
    if (fx.length) run.fx = fx.map((item) => ({ ...item }));
    if (entry) run.entry = entry;
    if (size) run.size = size;
    items.push({ kind: "text", run });
    plain += buffer;
    buffer = "";
  };
  const event = (value: MarkupEvent) => {
    flush();
    items.push({ kind: "event", event: value });
  };
  // Emphasis markers only count when they have a partner, so "5 * 3" stays literal.
  const pairs = matchingAsterisks(source);
  for (let index = 0; index < source.length; ) {
    const char = source[index];
    if (char === "\\" && /[{}*\\]/.test(source[index + 1] ?? "")) {
      buffer += source[index + 1];
      index += 2;
      continue;
    }
    if (char === "*" && pairs.has(index)) {
      const double = pairs.get(index) === 2;
      flush();
      if (double) strong = !strong;
      else em = !em;
      index += double ? 2 : 1;
      continue;
    }
    if (char === "{") {
      const match = TAG.exec(source.slice(index));
      if (match) {
        const [whole, closing, rawName, rawValue = ""] = match;
        const name = rawName.toLowerCase();
        const value = rawValue.trim();
        index += whole.length;
        if (closing) {
          if (name === "color" || name === "c") {
            flush();
            color = undefined;
          } else if (BEHAVIOR_SET.has(name)) {
            flush();
            fx = fx.filter((item) => item.name !== name);
          } else if (name === "in") {
            flush();
            entry = undefined;
          } else if (name === "size") {
            flush();
            size = undefined;
          } else if (name === "fx") {
            // {/fx} ends every running animation at once.
            flush();
            fx = [];
            entry = undefined;
          } else unknownTags.push(whole);
          continue;
        }
        const number = Number(value);
        if (BEHAVIOR_SET.has(name)) {
          flush();
          const strength =
            value && Number.isFinite(number) && number > 0 ? clamp(number, 0.25, 3) : 1;
          fx = [
            ...fx.filter((item) => item.name !== name),
            { name: name as TextBehaviorName, strength },
          ];
          continue;
        }
        if (name === "in" && ENTRY_SET.has(value.toLowerCase())) {
          flush();
          entry = value.toLowerCase() as TextEntry;
          continue;
        }
        if (name === "size" && Number.isFinite(number) && number > 0) {
          flush();
          size = clamp(number, 0.5, 2.5);
          if (Math.abs(size - 1) < 0.001) size = undefined;
          continue;
        }
        if (name === "wait" || name === "w")
          event({
            type: "wait",
            seconds: value && Number.isFinite(number) ? clamp(number, 0, 10) : 0.5,
          });
        else if (name === "speed" || name === "s")
          event({
            type: "speed",
            factor: Number.isFinite(number) && number > 0 ? clamp(number, 0.1, 10) : 1,
          });
        else if ((name === "expression" || name === "e" || name === "pose") && value)
          event({ type: "expression", value });
        else if (name === "shake")
          event({ type: "shake", strength: value === "heavy" ? "heavy" : "light" });
        else if (name === "flash") event({ type: "flash" });
        else if (name === "sfx" && value) event({ type: "sfx", value });
        else if (name === "fx" && value && parseScreenFx(value))
          event({ type: "fx", ...parseScreenFx(value)! });
        else if ((name === "color" || name === "c") && COLOR.test(value)) {
          flush();
          color = value;
        } else unknownTags.push(whole);
        continue;
      }
    }
    buffer += char;
    index += 1;
  }
  flush();
  return { plain, items, unknownTags };
}

/** Indexes of asterisk markers that open or close a matched pair, with their width. */
function matchingAsterisks(source: string): Map<number, 1 | 2> {
  const markers: { index: number; width: 1 | 2 }[] = [];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\\") {
      index++;
      continue;
    }
    if (source[index] !== "*") continue;
    const width = source[index + 1] === "*" ? 2 : 1;
    markers.push({ index, width });
    index += width - 1;
  }
  const result = new Map<number, 1 | 2>();
  for (const width of [2, 1] as const) {
    const open: number[] = [];
    for (const marker of markers) {
      if (marker.width !== width) continue;
      const before = source[marker.index - 1] ?? " ";
      const after = source[marker.index + width] ?? " ";
      if (open.length && !/\s/.test(before)) {
        result.set(open.pop()!, width);
        result.set(marker.index, width);
      } else if (!/\s/.test(after)) open.push(marker.index);
    }
  }
  return result;
}

/** Text without inline direction: what history, search and voice generation use. */
export function plainText(source: string): string {
  return source.includes("{") || source.includes("*") || source.includes("\\")
    ? parseMarkup(source).plain
    : source;
}

/** The spoken words, as counted by `textTimings`: whitespace-separated, punctuation attached. */
export function spokenWords(source: string): string[] {
  return plainText(source).split(/\s+/).filter(Boolean);
}

/** Whether the text contains direction tags or styling at all. */
export function hasMarkup(source: string): boolean {
  return plainText(source) !== source;
}
