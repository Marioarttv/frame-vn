/**
 * Builds the animated dialogue text. Every glyph gets its own reveal delay; CSS (or, for the
 * decode effect, a frame loop) animates it. Inline events fire at their position in the text.
 */
import {
  parseMarkup,
  type MarkupEvent,
  type MarkupRun,
  type ParsedMarkup,
  type TextEntry,
} from "../engine/markup";
import type { TextEffect } from "../engine/types";

export interface TextReveal {
  /** Milliseconds until the last glyph has fully appeared. */
  duration: number;
  /** How long after the text starts the voice should start (ms), so the first word is ready. */
  voiceDelay: number;
  /** Shows everything immediately; pending expression changes still apply. */
  finish(): void;
  dispose(): void;
}

export interface PlanOptions {
  effect: TextEffect;
  /** Characters per second. 0 means instant. */
  cps: number;
  /** When set, pacing stretches so the text finishes with the recording (milliseconds). */
  syncTo?: number;
  /**
   * Start of each spoken word in seconds from the start of the recording. Glyphs then follow
   * the voice instead of an even pace; words after the last timing are paced normally.
   */
  timings?: number[];
  /** Every glyph's entrance lasts at least this long (title cards hold their shimmer). */
  minEntryMs?: number;
}

export interface RevealOptions extends PlanOptions {
  onEvent(event: MarkupEvent, skipped: boolean): void;
  onDone(): void;
}

export interface PlannedGlyph {
  char: string;
  /** Reveal delay in milliseconds. */
  at: number;
  /** Milliseconds until the next glyph appears (how long the caret or quill rests here). */
  rest: number;
  entry?: TextEntry;
  /** Index of the spoken word this glyph belongs to. */
  word: number;
}

export interface RevealPlan {
  parsed: ParsedMarkup;
  effect: TextEffect;
  glyphs: PlannedGlyph[];
  events: { at: number; event: MarkupEvent }[];
  /** Milliseconds until the last glyph and event are done. */
  duration: number;
  /** With word timings: how long after the text starts the voice should start (ms). */
  voiceDelay: number;
}

const EFFECT_MS: Record<TextEffect, number> = {
  typewriter: 0,
  fade: 340,
  rise: 460,
  blur: 500,
  pop: 420,
  scramble: 150,
  word: 420,
  bounce: 640,
  fly: 560,
  spin: 580,
  stretch: 520,
  unfold: 500,
  glitch: 420,
  quill: 440,
  instant: 0,
};
/**
 * With word timings each word is written in one go and is complete this long before the voice
 * starts saying it (ms), so it can be read as it is heard. The margin covers the glyph entrance
 * and the remaining error of measured word starts (see scripts/chapter/retime.py).
 */
export const VOICE_MARGIN_MS = 300;
/** Milliseconds per glyph while a word is written ahead of the voice... */
const WORD_STEP_MS = 40;
/** ...down to this where the voice leaves less room. */
const MIN_STEP_MS = 12;
/** The voice may start up to this long after the text, so the first word is ready too. */
const MAX_VOICE_DELAY_MS = 600;
const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*+=?@$<>/";
const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined;
const graphemes = (text: string) =>
  segmenter
    ? Array.from(segmenter.segment(text), (part) => part.segment)
    : Array.from(text);
const isSpace = (glyph: string) => /\s/.test(glyph);

/** Extra beats after punctuation make speech-less lines read naturally. */
function punctuationPause(glyph: string): number {
  if (/[.!?。！？]/.test(glyph)) return 7;
  if (/[…—–]/.test(glyph)) return 5;
  if (/[,;:，、]/.test(glyph)) return 3;
  return 0;
}

/**
 * When every glyph and inline event happens, without touching the DOM. Timing is counted in
 * "character units" (one glyph at the base speed) and converted to milliseconds, or taken
 * from the recording's word timings when they are given.
 */
export function planReveal(source: string, options: PlanOptions): RevealPlan {
  const parsed = parseMarkup(source);
  const instant = options.effect === "instant" || options.cps <= 0;
  const effect: TextEffect = instant ? "instant" : options.effect;
  const timings = !instant && options.timings?.length ? options.timings : undefined;

  interface Unit {
    char: string;
    units: number;
    entry?: TextEntry;
    word: number;
  }
  const units: Unit[] = [];
  const events: { units: number; glyph: number; event: MarkupEvent }[] = [];
  const waits: { units: number; ms: number }[] = [];
  let position = 0;
  let speed = 1;
  let waitMs = 0;
  let word = -1;
  let inWord = false;
  for (const item of parsed.items) {
    if (item.kind === "event") {
      const event = item.event;
      if (event.type === "speed") {
        speed = event.factor;
        continue;
      }
      if (event.type === "wait") {
        waits.push({ units: position, ms: event.seconds * 1000 });
        waitMs += event.seconds * 1000;
      }
      events.push({ units: position, glyph: units.length, event });
      continue;
    }
    for (const glyph of graphemes(item.run.text)) {
      if (isSpace(glyph)) {
        inWord = false;
        position += 0.6 / speed;
        continue;
      }
      if (!inWord) {
        inWord = true;
        word += 1;
      }
      units.push({ char: glyph, units: position, entry: item.run.entry, word });
      position += (1 + punctuationPause(glyph)) / speed;
    }
  }

  // Even pacing: units to milliseconds, including explicit waits at their positions.
  let msPerUnit = instant ? 0 : 1000 / options.cps;
  if (!instant && !timings && options.syncTo && position * msPerUnit + waitMs > 0) {
    // Stretch or tighten (within reason) so speech and text finish together.
    const target = Math.max(0, options.syncTo - waitMs);
    const factor = Math.min(3, Math.max(0.45, target / (position * msPerUnit || 1)));
    msPerUnit *= factor;
  }
  const paced = (at: number) => {
    if (instant) return 0;
    let extra = 0;
    for (const wait of waits) if (wait.units <= at) extra += wait.ms;
    return at * msPerUnit + extra;
  };

  const times: number[] = new Array(units.length);
  // Voice clock offset (ms): the text starts this long before the recording.
  let voiceDelay = 0;
  const timed = timings ? Math.min(timings.length, word + 1) : 0;
  const onsetOf = (index: number) => voiceDelay + Math.max(0, timings![index] * 1000);
  if (!timings) units.forEach((unit, index) => (times[index] = paced(unit.units)));
  else {
    // Word timings: each word is written in one go and is complete VOICE_MARGIN_MS before the
    // voice reaches it; then the text waits for the voice. Waits and speed changes are already
    // part of the recording.
    // Glyph ranges of the timed words.
    const spans: { start: number; end: number }[] = [];
    let tailStart = -1;
    for (let start = 0; start < units.length; ) {
      const current = units[start].word;
      if (current >= timed) {
        tailStart = start;
        break;
      }
      let end = start;
      while (end < units.length && units[end].word === current) end++;
      spans.push({ start, end });
      start = end;
    }
    // Backward pass: the latest moment each word's last glyph may appear so that it, and every
    // word after it, is still complete VOICE_MARGIN_MS before being spoken. Recognizers often
    // give several quick words (nearly) the same start; those are then written earlier instead
    // of being pushed behind the voice.
    const latest: number[] = new Array(spans.length);
    for (let k = spans.length - 1; k >= 0; k--) {
      const due = onsetOf(k) - VOICE_MARGIN_MS;
      latest[k] =
        k + 1 < spans.length
          ? Math.min(due, latest[k + 1] - (spans[k + 1].end - spans[k + 1].start) * MIN_STEP_MS)
          : due;
    }
    // The voice starts late enough (within reason) for the first word to be written at full pace.
    if (spans.length) {
      const needed = (spans[0].end - spans[0].start - 1) * WORD_STEP_MS - latest[0];
      voiceDelay = Math.round(Math.min(MAX_VOICE_DELAY_MS, Math.max(0, needed)));
      for (let k = 0; k < latest.length; k++) latest[k] += voiceDelay;
    }
    let previous = -MIN_STEP_MS;
    spans.forEach(({ start, end }, k) => {
      const count = end - start;
      const step = Math.max(MIN_STEP_MS, Math.min(WORD_STEP_MS, (latest[k] - previous) / count));
      previous = Math.max(latest[k], previous + count * MIN_STEP_MS);
      for (let index = start; index < end; index++)
        times[index] = previous - (end - 1 - index) * step;
    });
    if (tailStart >= 0) {
      // Words the timings do not cover continue at the line's pace after the last timed word.
      const base = previous + 0.6 * msPerUnit;
      const from = units[tailStart].units;
      const span = (position - from) * msPerUnit;
      const end = options.syncTo ? options.syncTo + voiceDelay : 0;
      let tail = msPerUnit;
      if (end > base && span > 0) tail *= Math.min(3, Math.max(0.45, (end - base) / span));
      for (let index = tailStart; index < units.length; index++)
        times[index] = base + (units[index].units - from) * tail;
    }
  }

  const glyphs: PlannedGlyph[] = units.map((unit, index) => ({
    char: unit.char,
    at: Math.round(times[index]),
    rest: Math.round(index + 1 < units.length ? times[index + 1] - times[index] : 260),
    ...(unit.entry ? { entry: unit.entry } : {}),
    word: unit.word,
  }));
  // An event fires with the glyph it sits before; with timings, when that word is spoken.
  const lastTime = glyphs.length ? glyphs[glyphs.length - 1].at : 0;
  const spokenAt = (glyph: number) => {
    const at = units[glyph];
    if (!at) return lastTime;
    return at.word < timed ? Math.round(onsetOf(at.word)) : glyphs[glyph].at;
  };
  const plannedEvents = events.map((pending) => ({
    event: pending.event,
    at: instant ? 0 : timings ? spokenAt(pending.glyph) : Math.round(paced(pending.units)),
  }));
  let lastGlyph = 0;
  if (!instant)
    for (const glyph of glyphs)
      lastGlyph = Math.max(
        lastGlyph,
        glyph.at + Math.max(EFFECT_MS[glyph.entry ?? effect], options.minEntryMs ?? 0),
      );
  const lastEvent = plannedEvents.length ? plannedEvents[plannedEvents.length - 1].at : 0;
  return {
    parsed,
    effect,
    glyphs,
    events: plannedEvents,
    duration: instant ? 0 : Math.max(lastGlyph, lastEvent),
    voiceDelay,
  };
}

export function revealText(
  element: HTMLElement,
  source: string,
  options: RevealOptions,
): TextReveal {
  const plan = planReveal(source, options);
  const { parsed, effect } = plan;
  const instant = effect === "instant";
  element.dataset.effect = effect;
  element.classList.remove("is-done");
  element.replaceChildren();

  const glyphNodes: {
    node: HTMLElement;
    /** Holds the character itself; inside any behaviour wrappers. */
    inner: HTMLElement;
    char: string;
    entry?: TextEntry;
    at: number;
  }[] = [];
  let word: HTMLElement | null = null;
  for (const item of parsed.items) {
    if (item.kind === "event") continue;
    const parent = runHost(element, item.run);
    word = null;
    for (const glyph of graphemes(item.run.text)) {
      if (isSpace(glyph)) {
        parent.append(document.createTextNode(glyph));
        word = null;
        continue;
      }
      const index = glyphNodes.length;
      const planned = plan.glyphs[index];
      if (!word) {
        word = document.createElement("span");
        word.className = "w";
        // The word-by-word effect animates the word from its first glyph's time.
        if (effect === "word") word.style.setProperty("--d", `${planned.at}ms`);
        parent.append(word);
      }
      const span = document.createElement("span");
      span.className = "g";
      span.style.setProperty("--i", String(index));
      span.style.setProperty("--d", `${planned.at}ms`);
      // The typewriter caret (and the quill) rests on each glyph until the next one appears.
      span.style.setProperty("--n", `${planned.rest}ms`);
      if (item.run.entry && !instant) span.dataset.in = item.run.entry;
      let inner: HTMLElement = span;
      if (item.run.fx?.length) {
        span.dataset.v = String(index % 3);
        for (const behavior of item.run.fx) {
          const fx = document.createElement("span");
          fx.className = "fx";
          fx.dataset.fx = behavior.name;
          if (behavior.strength !== 1) fx.style.setProperty("--a", String(behavior.strength));
          inner.append(fx);
          inner = fx;
        }
      }
      inner.textContent = glyph;
      word.append(span);
      glyphNodes.push({
        node: span,
        inner,
        char: glyph,
        entry: item.run.entry,
        at: planned.at,
      });
    }
  }
  // The quill lifts off after the line's final glyph instead of resting on it.
  if (glyphNodes.length) glyphNodes[glyphNodes.length - 1].node.dataset.last = "";
  if (effect === "typewriter" || effect === "scramble") element.dataset.caret = "";
  else delete element.dataset.caret;
  const duration = plan.duration;

  const timers: number[] = [];
  let done = false;
  let frame = 0;
  const fired = new Set<(typeof plan.events)[number]>();
  const fire = (pending: (typeof plan.events)[number], skipped: boolean) => {
    if (fired.has(pending)) return;
    fired.add(pending);
    options.onEvent(pending.event, skipped);
  };
  const complete = () => {
    if (done) return;
    done = true;
    timers.forEach(clearTimeout);
    cancelAnimationFrame(frame);
    for (const glyph of glyphNodes) {
      glyph.inner.textContent = glyph.char;
      glyph.node.classList.remove("is-scrambling");
    }
    element.classList.add("is-done");
    options.onDone();
  };

  for (const pending of plan.events) {
    if (instant) fire(pending, false);
    else timers.push(window.setTimeout(() => fire(pending, false), pending.at));
  }
  const scrambling = glyphNodes.filter(
    (glyph) => glyph.entry === "scramble" || (effect === "scramble" && !glyph.entry),
  );
  if (scrambling.length && !instant) {
    const started = performance.now();
    const settle = EFFECT_MS.scramble;
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const tick = () => {
      if (done) return;
      const elapsed = performance.now() - started;
      let active = false;
      for (const glyph of scrambling) {
        const start = glyph.at;
        if (elapsed < start) {
          active = true;
          continue;
        }
        if (elapsed < start + settle && /\S/.test(glyph.char)) {
          active = true;
          glyph.node.classList.add("is-scrambling");
          glyph.inner.textContent = GLYPHS[Math.floor(random() * GLYPHS.length)];
        } else if (glyph.inner.textContent !== glyph.char) {
          glyph.inner.textContent = glyph.char;
          glyph.node.classList.remove("is-scrambling");
        }
      }
      if (active) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }
  if (instant) queueMicrotask(complete);
  else timers.push(window.setTimeout(complete, duration));

  return {
    duration,
    voiceDelay: plan.voiceDelay,
    finish() {
      if (done) return;
      // Skipping applies the line's final expression but not its one-off effects.
      for (const pending of plan.events) fire(pending, true);
      complete();
    },
    dispose() {
      done = true;
      timers.forEach(clearTimeout);
      cancelAnimationFrame(frame);
    },
  };
}

/** Wraps a run's text in its colour, weight, emphasis and size. */
function runHost(element: HTMLElement, run: MarkupRun): HTMLElement {
  let host: HTMLElement = element;
  if (run.color) {
    const span = document.createElement("span");
    span.style.color = run.color;
    host.append(span);
    host = span;
  }
  if (run.size) {
    const span = document.createElement("span");
    span.className = "sz";
    span.style.setProperty("--sz", String(run.size));
    host.append(span);
    host = span;
  }
  if (run.strong) {
    const strong = document.createElement("strong");
    host.append(strong);
    host = strong;
  }
  if (run.em) {
    const em = document.createElement("em");
    host.append(em);
    host = em;
  }
  return host;
}

/** Static, fully revealed markup (history entries, novel pages). Behaviours stay still. */
export function renderStaticText(element: HTMLElement, source: string): void {
  const parsed = parseMarkup(source);
  element.replaceChildren();
  for (const item of parsed.items)
    if (item.kind === "text")
      runHost(element, item.run).append(document.createTextNode(item.run.text));
}
