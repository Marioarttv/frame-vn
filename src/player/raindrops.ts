/**
 * Rain on the camera's glass for the `raindrops` weather: sparse round beads with a soft
 * lens look (a dark rim, a pale caustic at the bottom and a small highlight), now and then
 * one growing heavy and sliding down in an irregular path with a short fading trail.
 *
 * Every drop is a pure function of the seconds since the weather started, so the browser and
 * the video renderer's virtual clock draw identical frames, however the frames are stepped.
 */

/** The weather fades in over this long when set, and out over this long when replaced. */
export const RAINDROPS_FADE_MS = 2000;

/** Bead slots on the glass at once (most are small), and drops that slide. */
const BEADS = 56;
const MIST = 70;
const SLIDERS = 5;

/** A seeded generator for one drop's cycle, so each appearance has its own place and size. */
function seeded(seed: number) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (value: number) => {
  const c = clamp01(value);
  return c * c * (3 - 2 * c);
};

/** Size of the pre-rendered drop, in canvas pixels. */
const SPRITE = 96;

/** One water bead seen through: rim, body, caustic and highlight, drawn once and scaled. */
function paintDrop(): HTMLCanvasElement {
  const sprite = document.createElement("canvas");
  sprite.width = SPRITE;
  sprite.height = SPRITE;
  const context = sprite.getContext("2d");
  if (!context) return sprite;
  const r = SPRITE * 0.42;
  context.translate(SPRITE / 2, SPRITE / 2);
  // The body: the glass behind seen through a lens, a little paler and cooler.
  const body = context.createRadialGradient(0, -r * 0.25, 0, 0, 0, r);
  body.addColorStop(0, "rgba(214,228,242,0.12)");
  body.addColorStop(0.68, "rgba(190,206,224,0.14)");
  body.addColorStop(0.88, "rgba(14,20,30,0.42)");
  body.addColorStop(1, "rgba(14,20,30,0)");
  context.fillStyle = body;
  context.beginPath();
  context.arc(0, 0, r, 0, Math.PI * 2);
  context.fill();
  // A heavier rim at the bottom, where the water is thickest.
  context.save();
  context.beginPath();
  context.arc(0, 0, r * 0.96, 0, Math.PI * 2);
  context.clip();
  const rim = context.createLinearGradient(0, -r, 0, r);
  rim.addColorStop(0, "rgba(8,12,20,0)");
  rim.addColorStop(0.7, "rgba(8,12,20,0)");
  rim.addColorStop(1, "rgba(8,12,20,0.32)");
  context.fillStyle = rim;
  context.fillRect(-r, -r, r * 2, r * 2);
  // The caustic: light gathered by the lens into a soft crescent at the bottom.
  context.filter = `blur(${(r * 0.08).toFixed(1)}px)`;
  context.fillStyle = "rgba(255,255,255,0.36)";
  context.beginPath();
  context.ellipse(0, r * 0.52, r * 0.52, r * 0.2, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
  // The highlight: a small window reflection, upper left.
  context.filter = `blur(${(r * 0.03).toFixed(1)}px)`;
  context.fillStyle = "rgba(255,255,255,0.85)";
  context.beginPath();
  context.ellipse(-r * 0.36, -r * 0.42, r * 0.17, r * 0.1, -0.7, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(255,255,255,0.35)";
  context.beginPath();
  context.ellipse(r * 0.3, r * 0.2, r * 0.06, r * 0.04, -0.7, 0, Math.PI * 2);
  context.fill();
  return sprite;
}

export interface Raindrops {
  /**
   * Draws the glass at `seconds` since the weather started into a `width` × `height`
   * canvas, at `alpha`. `still` (reduced motion) leaves the beads in place and slides none.
   */
  draw(context: CanvasRenderingContext2D, width: number, height: number, seconds: number, alpha: number, still: boolean): void;
}

export function createRaindrops(seed = 1): Raindrops {
  let sprite: HTMLCanvasElement | null = null;
  /** Fixed per-slot rhythm: how often a slot's bead is replaced, and its phase. */
  const slots = (count: number, salt: number, min: number, spread: number) => {
    const random = seeded(seed * 7_727 + salt);
    return Array.from({ length: count }, () => {
      const period = min + random() * spread;
      return { period, offset: -random() * period };
    });
  };
  const beadSlots = slots(BEADS, 11, 7, 9);
  const mistSlots = slots(MIST, 23, 9, 12);
  const sliderSlots = slots(SLIDERS, 37, 6.5, 3);
  /** The cycle a slot is in at `seconds`, and how far into it. */
  const cycle = (slot: { period: number; offset: number }, seconds: number) => {
    const n = Math.floor((seconds - slot.offset) / slot.period);
    return { n, age: seconds - slot.offset - n * slot.period };
  };
  /** A spot on the glass, thinned out where faces usually are. */
  const place = (random: () => number) => {
    let x = random();
    let y = random();
    for (let tries = 0; tries < 1 && x > 0.3 && x < 0.7 && y > 0.12 && y < 0.62; tries++) {
      x = random();
      y = random();
    }
    return { x, y };
  };

  /** Draws the drop sprite as a bead of radii `rx` × `ry` pixels, turned by `angle`. */
  function stamp(context: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, angle: number, alpha: number) {
    if (!sprite || alpha <= 0.004 || rx < 0.3) return;
    // The bead fills 0.42 of the sprite's width on each side of its centre.
    const w = rx / 0.42;
    const h = ry / 0.42;
    context.globalAlpha = Math.min(1, alpha);
    if (!angle) {
      context.drawImage(sprite, x - w / 2, y - h / 2, w, h);
      return;
    }
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.drawImage(sprite, -w / 2, -h / 2, w, h);
    context.restore();
  }

  return {
    draw(context, width, height, seconds, alpha, still) {
      if (alpha <= 0.002) return;
      sprite ??= paintDrop();
      const unit = height / 1000;
      context.save();
      context.globalCompositeOperation = "source-over";
      // Fine mist and beads: each lands with a small settle, sits, and evaporates.
      for (const [list, salt, small] of [
        [mistSlots, 101, true],
        [beadSlots, 202, false],
      ] as const)
        list.forEach((slot, index) => {
          const { n, age } = still ? { n: 0, age: slot.period * 0.4 } : cycle(slot, seconds);
          const random = seeded(seed * 92_821 + salt * 7_919 + index * 104_729 + n * 1_299_709);
          const { x, y } = place(random);
          const size = small ? 1.4 + random() * 1.8 : 4 + Math.pow(random(), 1.35) * 12;
          const life = slot.period * (0.7 + random() * 0.25);
          const opacity = small ? 0.6 + random() * 0.3 : 0.8 + random() * 0.2;
          const landed = still ? 1 : smooth(age / 0.12);
          const settle = still ? 1 : 0.78 + 0.22 * landed;
          const gone = 1 - smooth((age - life + 1.4) / 1.4);
          const r = size * unit * settle;
          stamp(context, x * width, y * height, r, r * 1.05, 0, alpha * opacity * landed * gone);
        });
      if (!still)
        sliderSlots.forEach((slot, index) => {
          const { n, age } = cycle(slot, seconds);
          const random = seeded(seed * 15_485_863 + index * 104_729 + n * 1_299_709);
          // Sliders keep to the outer thirds, so none runs down a face in the middle of the frame.
          const side = random();
          const x0 = (side < 0.5 ? 0.04 + side * 0.58 : 0.67 + (side - 0.5) * 0.58) * width;
          const y0 = (0.02 + random() * 0.5) * height;
          const r0 = (13 + random() * 3) * unit;
          const speed = (80 + random() * 70) * unit;
          const stick = random() * Math.PI * 2;
          const waves = [
            { a: (4 + random() * 7) * unit, l: (30 + random() * 40) * unit, p: random() * Math.PI * 2 },
            { a: (2 + random() * 3) * unit, l: (9 + random() * 10) * unit, p: random() * Math.PI * 2 },
          ];
          const gather = 0.9 + random() * 0.6;
          const slide = 1.6 + random() * 1.2;
          // Where the drop is after `s` seconds of sliding: stop-and-go down, wandering sideways.
          const path = (s: number) => {
            const fall = speed * (s + 0.16 * (Math.sin(5 * s + stick) - Math.sin(stick))) * (1 + 0.2 * s);
            let dx = 0;
            for (const wave of waves) dx += wave.a * (Math.sin(fall / wave.l + wave.p) - Math.sin(wave.p));
            return [x0 + dx, y0 + fall];
          };
          // It slides for `slide` seconds, then stops, sits a moment and dries away.
          const run = Math.max(0, age - gather);
          const s = Math.min(run, slide);
          const life = smooth(age / 0.3) * (1 - smooth((run - slide - 0.5) / 1.2));
          if (life <= 0.004) return;
          const heavy = smooth(age / gather);
          // The wet trail: a thin streak that fades behind the drop, with a few beads left on it.
          if (s > 0) {
            const reach = Math.min(s, 0.9);
            context.lineCap = "round";
            let [ax, ay] = path(s - reach);
            for (let back = reach - 0.03; back > -0.001; back -= 0.03) {
              const [bx, by] = path(Math.max(0, s - Math.max(0, back)));
              const fade = (1 - back / 0.9) ** 1.5 * alpha * life * (1 - smooth((run - slide) / 0.8));
              // A slightly darker band of wet glass with a thin light edge on one side.
              context.globalAlpha = 1;
              context.strokeStyle = `rgba(12,18,28,${(0.2 * fade).toFixed(3)})`;
              context.lineWidth = r0 * 0.55;
              context.beginPath();
              context.moveTo(ax, ay);
              context.lineTo(bx, by);
              context.stroke();
              context.strokeStyle = `rgba(228,238,250,${(0.32 * fade).toFixed(3)})`;
              context.lineWidth = Math.max(1, r0 * 0.12);
              context.beginPath();
              context.moveTo(ax - r0 * 0.16, ay);
              context.lineTo(bx - r0 * 0.16, by);
              context.stroke();
              [ax, ay] = [bx, by];
            }
            for (let k = 1; k * 0.32 < s; k++) {
              const left = run - k * 0.32;
              const fade = 1 - smooth(left / 1.3);
              if (fade <= 0) continue;
              const [bx, by] = path(k * 0.32);
              const br = r0 * (0.32 + 0.12 * Math.sin(k * 2.3 + stick));
              stamp(context, bx, by, br, br * 1.05, 0, alpha * life * 0.8 * fade);
            }
          }
          const [px, py] = path(s);
          const [qx, qy] = path(s + 0.05);
          const sliding = run > 0 && run < slide;
          const moving = sliding ? clamp01(Math.hypot(qx - px, qy - py) / (speed * 0.06)) : 0;
          // Heavy as it gathers; a little smaller once it has left water along its trail.
          const r = r0 * (0.75 + 0.45 * heavy) * (1 - 0.18 * smooth(run / slide));
          const angle = sliding ? -Math.atan2(qx - px, qy - py) * moving : 0;
          stamp(context, px, py, r * (1 - 0.12 * moving), r * (1.05 + 0.3 * moving), angle, alpha * life);
        });
      context.restore();
    },
  };
}
