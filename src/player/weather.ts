/**
 * Procedural weather and atmosphere drawn on one canvas. Nothing is stored or downloaded;
 * a seeded generator keeps every playback (and every video render) identical.
 */
import type { Weather } from "../engine/types";
import { paintFrost, smooth } from "./frost";
import { createRaindrops, RAINDROPS_FADE_MS } from "./raindrops";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  phase: number;
  alpha: number;
  /** Second colour or variant, chosen when the particle is created. */
  tint: number;
  /** Leaves: current rotation and spin speed in radians (per second). */
  rot?: number;
  spin?: number;
}

/** Autumn leaf colours, from gold to deep rust. */
const LEAF_COLORS = ["#e9b44c", "#d98a2b", "#c9622a", "#a8442a", "#b5862f", "#8c5a24"];

const COUNTS: Record<Weather, number> = {
  rain: 260,
  storm: 420,
  snow: 170,
  embers: 80,
  dust: 110,
  fog: 9,
  fireflies: 38,
  sparks: 90,
  motes: 75,
  candles: 15,
  magic: 64,
  smoke: 16,
  wind: 96,
  leaves: 42,
  airstream: 130,
  downpour: 420,
  frost: 80,
  // Drawn by ./raindrops from the time since the weather started, not as particles.
  raindrops: 0,
};
/** Frost creeps in over this long when the weather starts, and melts in this long on a thaw. */
export const FROST_GROW_MS = 4200;
export const FROST_THAW_MS = 1600;
const ADDITIVE = new Set<Weather>(["embers", "fireflies", "sparks", "motes", "magic"]);

export interface WeatherLayer {
  set(kind: Weather | undefined): void;
  /** Melts the frost (the Radiance clears it); it stays gone until the weather changes. */
  thaw(): void;
  dispose(): void;
}

export function createWeather(
  canvas: HTMLCanvasElement,
  options: { reducedMotion?: boolean } = {},
): WeatherLayer {
  const context = canvas.getContext("2d");
  const still = !!options.reducedMotion;
  let kind: Weather | undefined;
  let particles: Particle[] = [];
  let frame = 0;
  let last = 0;
  let width = 0;
  let height = 0;
  let flash = 0;
  let nextBolt = 0;
  let seed = 1;
  let spawned = 0;
  /** Frost: the painted ice, the size it was painted at, and when it started and thawed. */
  let frost: HTMLCanvasElement | null = null;
  let frostStart = 0;
  let thawStart = 0;
  /**
   * Raindrops: when they started and, once another weather replaces them, when they began
   * fading out (0 until the next frame). They keep running while they fade.
   */
  const raindrops = createRaindrops(5);
  let dropsStart = 0;
  let dropsLeaving = false;
  let dropsEnd = 0;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  function resize() {
    const scale = Math.min(window.devicePixelRatio || 1, 1.5);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * scale));
    const h = Math.max(1, Math.round(rect.height * scale));
    if (w === canvas.width && h === canvas.height) return;
    canvas.width = width = w;
    canvas.height = height = h;
  }

  function spawn(fresh: boolean): Particle {
    const p: Particle = {
      x: random() * width,
      y: fresh ? random() * height : -20,
      vx: 0,
      vy: 0,
      size: 1,
      life: random(),
      phase: random() * Math.PI * 2,
      alpha: 1,
      tint: random(),
    };
    const unit = height / 1000;
    switch (kind) {
      case "rain":
      case "storm":
      case "downpour": {
        const heavy = kind !== "rain";
        p.vy = (heavy ? 1900 : 1400) * unit * (0.75 + random() * 0.5);
        p.vx = p.vy * (heavy ? -0.28 : -0.12);
        p.size = (heavy ? 34 : 24) * unit * (0.6 + random() * 0.8);
        p.alpha = 0.18 + random() * 0.3;
        break;
      }
      case "frost":
        // Fine ice motes drifting down and sideways; about one in eight is a low breath of fog.
        if (p.tint < 0.88) {
          p.y = fresh ? random() * height : -10;
          p.vx = (random() - 0.6) * 22 * unit;
          p.vy = (10 + random() * 26) * unit;
          p.size = (0.6 + Math.pow(random(), 2) * 2.2) * unit * 1.5;
          p.alpha = 0.3 + random() * 0.55;
        } else {
          p.y = height * (0.62 + random() * 0.4);
          p.vx = (8 + random() * 14) * unit * (random() < 0.5 ? -1 : 1);
          p.size = height * (0.22 + random() * 0.22);
          p.alpha = 0.05 + random() * 0.06;
        }
        break;
      case "snow":
        p.vy = 60 * unit * (0.5 + random());
        p.size = (1.2 + random() * 3.2) * unit * 1.4;
        p.alpha = 0.5 + random() * 0.5;
        break;
      case "embers":
        p.y = fresh ? random() * height : height + 20;
        p.vy = -90 * unit * (0.5 + random());
        p.vx = 20 * unit * (random() - 0.5);
        p.size = (1 + random() * 2.6) * unit * 1.6;
        break;
      case "dust":
        p.vy = 8 * unit * (random() - 0.3);
        p.vx = 14 * unit * (0.3 + random());
        p.size = (0.6 + random() * 1.6) * unit * 1.5;
        p.alpha = 0.15 + random() * 0.45;
        break;
      case "fog":
        p.y = height * (0.35 + random() * 0.7);
        p.vx = 18 * unit * (0.4 + random()) * (random() < 0.5 ? -1 : 1);
        p.size = height * (0.35 + random() * 0.35);
        p.alpha = 0.08 + random() * 0.08;
        break;
      case "fireflies":
        p.y = height * (0.25 + random() * 0.75);
        p.vx = 20 * unit * (random() - 0.5);
        p.vy = 20 * unit * (random() - 0.5);
        p.size = (1.6 + random() * 1.8) * unit * 1.6;
        break;
      case "sparks":
        p.x = width * (0.1 + random() * 0.8);
        p.y = fresh ? random() * height : height * (0.55 + random() * 0.5);
        p.vx = 260 * unit * (random() - 0.5);
        p.vy = -420 * unit * (0.4 + random());
        p.size = (0.8 + random() * 1.6) * unit * 1.6;
        p.life = random() * 0.4;
        break;
      case "motes":
        // Warm dust caught in a shaft of light: denser in the upper middle of the frame.
        p.y = fresh ? height * (0.05 + 0.85 * Math.pow(random(), 1.3)) : -10;
        p.x = fresh ? random() * width : random() * width * 0.8;
        p.vx = 9 * unit * (0.3 + random());
        p.vy = 7 * unit * (random() - 0.35);
        p.size = (0.7 + Math.pow(random(), 2) * 2.4) * unit * 1.5;
        p.alpha = 0.25 + random() * 0.55;
        break;
      case "candles": {
        // Stratified across the width so candles never bunch up; small ones are further away.
        const slot = (spawned++ % COUNTS.candles) + random() * 0.8;
        p.x = width * (0.03 + (0.94 * slot) / COUNTS.candles);
        p.y = height * (0.05 + random() * 0.17);
        p.size = (20 + random() * 22) * unit;
        p.alpha = 0.6 + (p.size / (42 * unit)) * 0.4;
        p.vx = 0;
        p.vy = 0;
        break;
      }
      case "magic":
        p.y = fresh ? random() * height : height + 10;
        p.vy = -(16 + random() * 26) * unit;
        p.vx = 6 * unit * (random() - 0.5);
        p.size = (0.9 + random() * 1.9) * unit * 1.5;
        p.alpha = 0.5 + random() * 0.5;
        break;
      case "wind":
        // Most particles are air streaks; about a third are leaves blown across the frame.
        p.x = fresh ? random() * width : -width * (0.05 + random() * 0.25);
        p.y = height * (0.02 + random() * 0.9);
        if (p.tint < 0.64) {
          p.vx = (900 + random() * 700) * unit;
          p.vy = (random() - 0.5) * 60 * unit;
          p.size = (110 + random() * 260) * unit;
          p.alpha = 0.16 + random() * 0.22;
        } else {
          p.vx = (320 + random() * 360) * unit;
          p.vy = (30 + random() * 90) * unit;
          p.size = (9 + random() * 13) * unit;
          p.alpha = 0.8 + random() * 0.2;
          p.rot = random() * Math.PI * 2;
          p.spin = (random() < 0.5 ? -1 : 1) * (3 + random() * 6);
        }
        break;
      case "leaves":
        p.y = fresh ? random() * height : -30 * unit;
        p.vx = (20 + random() * 50) * unit;
        p.vy = (45 + random() * 60) * unit;
        p.size = (9 + random() * 12) * unit;
        p.alpha = 0.75 + random() * 0.25;
        p.rot = random() * Math.PI * 2;
        p.spin = (random() < 0.5 ? -1 : 1) * (0.8 + random() * 2.2);
        break;
      case "airstream": {
        // Speed lines rushing out from a point just above the centre, as if flying forward.
        // A few are big soft cloud wisps.
        const angle = random() * Math.PI * 2;
        const start = (fresh ? random() * 0.9 : 0.04 + random() * 0.1) * height;
        p.phase = angle;
        p.x = width / 2 + Math.cos(angle) * start * 1.6;
        p.y = height * 0.42 + Math.sin(angle) * start;
        const speed = (p.tint < 0.9 ? 520 + random() * 620 : 260 + random() * 200) * unit;
        p.vx = Math.cos(angle) * speed * 1.6;
        p.vy = Math.sin(angle) * speed;
        p.size = p.tint < 0.9 ? (40 + random() * 120) * unit : (90 + random() * 120) * unit;
        p.alpha = p.tint < 0.9 ? 0.28 + random() * 0.32 : 0.1 + random() * 0.1;
        p.life = 0;
        break;
      }
      case "smoke":
        p.y = height * (0.62 + random() * 0.36);
        p.x = fresh ? random() * width : random() < 0.5 ? -height * 0.3 : width + height * 0.3;
        p.vx = (7 + random() * 12) * unit * (random() < 0.55 ? 1 : -1);
        p.size = height * (0.16 + random() * 0.2);
        p.alpha = 0.3 + random() * 0.25;
        break;
    }
    return p;
  }

  function step(dt: number, now: number) {
    if (!context || (!kind && !dropsLeaving)) return;
    resize();
    context.clearRect(0, 0, width, height);
    const unit = height / 1000;
    drawRaindrops(now);
    if (!kind) return;
    if (kind === "frost") drawFrost(now);
    context.globalCompositeOperation = ADDITIVE.has(kind) ? "lighter" : "source-over";
    for (let index = 0; index < particles.length; index++) {
      const p = particles[index];
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      let reset = p.y > height + 40 || p.x < -p.size * 2 || p.x > width + p.size * 2;
      switch (kind) {
        case "rain":
        case "storm":
        case "downpour": {
          context.strokeStyle = `rgba(190,210,235,${p.alpha})`;
          context.lineWidth = Math.max(1, 1.2 * unit);
          context.beginPath();
          context.moveTo(p.x, p.y);
          const length = p.size / Math.hypot(p.vx, p.vy);
          context.lineTo(p.x - p.vx * length, p.y - p.vy * length);
          context.stroke();
          break;
        }
        case "frost": {
          if (p.tint < 0.88) {
            p.x += Math.sin(p.life * 0.8 + p.phase) * 9 * unit * dt;
            const twinkle = 0.55 + 0.45 * Math.sin(p.life * (1.4 + p.tint * 2) + p.phase);
            const glow = context.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2.4);
            glow.addColorStop(0, `rgba(245,250,255,${(p.alpha * twinkle).toFixed(3)})`);
            glow.addColorStop(1, "rgba(200,225,255,0)");
            context.fillStyle = glow;
            context.fillRect(p.x - p.size * 2.4, p.y - p.size * 2.4, p.size * 4.8, p.size * 4.8);
          } else {
            context.save();
            context.translate(p.x, p.y);
            context.scale(2.4, 0.55);
            const fog = context.createRadialGradient(0, 0, 0, 0, 0, p.size);
            fog.addColorStop(0, `rgba(205,222,240,${p.alpha})`);
            fog.addColorStop(1, "rgba(205,222,240,0)");
            context.fillStyle = fog;
            context.fillRect(-p.size, -p.size, p.size * 2, p.size * 2);
            context.restore();
            const edge = p.size * 2.4;
            if (p.vx > 0 && p.x > width + edge) p.x = -edge;
            if (p.vx < 0 && p.x < -edge) p.x = width + edge;
            reset = false;
          }
          break;
        }
        case "snow": {
          p.x += Math.sin(p.life * 1.3 + p.phase) * 18 * unit * dt;
          context.fillStyle = `rgba(255,255,255,${p.alpha})`;
          context.beginPath();
          context.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          context.fill();
          break;
        }
        case "embers": {
          p.x += Math.sin(p.life * 2 + p.phase) * 30 * unit * dt;
          const flicker = 0.55 + 0.45 * Math.sin(p.life * 9 + p.phase);
          const glow = context.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 4);
          glow.addColorStop(0, `rgba(255,190,90,${0.9 * flicker})`);
          glow.addColorStop(0.35, `rgba(255,110,30,${0.45 * flicker})`);
          glow.addColorStop(1, "rgba(255,60,0,0)");
          context.fillStyle = glow;
          context.fillRect(p.x - p.size * 4, p.y - p.size * 4, p.size * 8, p.size * 8);
          reset = p.y < -40;
          break;
        }
        case "dust": {
          p.y += Math.sin(p.life * 0.7 + p.phase) * 6 * unit * dt;
          const shimmer = 0.6 + 0.4 * Math.sin(p.life * 1.7 + p.phase);
          context.fillStyle = `rgba(255,244,220,${p.alpha * shimmer})`;
          context.beginPath();
          context.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          context.fill();
          if (p.x > width + 10) p.x = -10;
          reset = false;
          break;
        }
        case "fog": {
          const fog = context.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
          fog.addColorStop(0, `rgba(210,220,225,${p.alpha})`);
          fog.addColorStop(1, "rgba(210,220,225,0)");
          context.fillStyle = fog;
          context.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
          if (p.x > width + p.size) p.x = -p.size;
          if (p.x < -p.size) p.x = width + p.size;
          reset = false;
          break;
        }
        case "fireflies": {
          p.vx += (random() - 0.5) * 40 * unit * dt;
          p.vy += (random() - 0.5) * 40 * unit * dt;
          p.vx *= 0.99;
          p.vy *= 0.99;
          const blink = Math.max(0, Math.sin(p.life * 1.6 + p.phase));
          const light = context.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 5);
          light.addColorStop(0, `rgba(230,255,150,${0.95 * blink})`);
          light.addColorStop(1, "rgba(160,255,90,0)");
          context.fillStyle = light;
          context.fillRect(p.x - p.size * 5, p.y - p.size * 5, p.size * 10, p.size * 10);
          reset = p.y < -20 || p.y > height + 20 || p.x < -20 || p.x > width + 20;
          break;
        }
        case "sparks": {
          p.vy += 520 * unit * dt;
          const fade = Math.max(0, 1 - p.life / 1.1);
          context.strokeStyle = `rgba(140,230,255,${fade})`;
          context.lineWidth = p.size;
          context.beginPath();
          context.moveTo(p.x, p.y);
          context.lineTo(p.x - p.vx * 0.018, p.y - p.vy * 0.018);
          context.stroke();
          reset = fade <= 0 || p.y > height + 20;
          break;
        }
        case "motes": {
          p.x += Math.sin(p.life * 0.5 + p.phase) * 5 * unit * dt;
          p.y += Math.cos(p.life * 0.4 + p.phase) * 4 * unit * dt;
          const twinkle = 0.5 + 0.5 * Math.sin(p.life * (0.9 + p.tint * 1.4) + p.phase);
          const light = p.alpha * (0.3 + 0.7 * twinkle * twinkle);
          const radius = p.size * 3.2;
          const glow = context.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
          glow.addColorStop(0, `rgba(255,236,190,${light})`);
          glow.addColorStop(0.25, `rgba(255,205,120,${light * 0.55})`);
          glow.addColorStop(1, "rgba(255,180,80,0)");
          context.fillStyle = glow;
          context.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
          if (p.x > width + 12) p.x = -12;
          if (p.y < -12) p.y = height + 12;
          if (p.y > height + 12) p.y = -12;
          reset = false;
          break;
        }
        case "candles":
          drawCandle(context, p, unit);
          reset = false;
          break;
        case "magic": {
          p.x += Math.sin(p.life * 1.1 + p.phase) * 10 * unit * dt;
          const twinkle = Math.pow(0.5 + 0.5 * Math.sin(p.life * (2.2 + p.tint * 2) + p.phase), 3);
          const gold = p.tint < 0.6;
          const rgb = gold ? "255,214,120" : "160,245,228";
          const light = p.alpha * (0.25 + 0.75 * twinkle);
          const radius = p.size * 2.6;
          const glow = context.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
          glow.addColorStop(0, `rgba(255,255,240,${light})`);
          glow.addColorStop(0.3, `rgba(${rgb},${light * 0.6})`);
          glow.addColorStop(1, `rgba(${rgb},0)`);
          context.fillStyle = glow;
          context.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
          if (twinkle > 0.45) {
            // A brief four-point glint at the brightest moment.
            const arm = p.size * (2 + 4 * twinkle);
            context.strokeStyle = `rgba(${rgb},${light * 0.8})`;
            context.lineWidth = Math.max(0.6, p.size * 0.35);
            context.beginPath();
            context.moveTo(p.x - arm, p.y);
            context.lineTo(p.x + arm, p.y);
            context.moveTo(p.x, p.y - arm);
            context.lineTo(p.x, p.y + arm);
            context.stroke();
          }
          reset = p.y < -20;
          break;
        }
        case "wind": {
          // Gusts swell and ease off together, speeding everything up for a moment.
          const g = gust(now);
          p.x += p.vx * (g - 1) * dt;
          if (p.tint < 0.64) {
            const across = Math.min(1, Math.max(0, p.x / width));
            const a = p.alpha * Math.sin(Math.PI * across) * (0.55 + 0.45 * g);
            const wave = Math.sin(p.life * 2.4 + p.phase) * 14 * unit;
            const line = Math.max(1.2, (1.6 + p.tint * 2.6) * unit);
            context.lineCap = "round";
            // A faint cool shadow under each white streak keeps it readable on a bright sky.
            for (const [color, alpha, grow] of [
              ["90,120,160", a * 0.35, 2.2],
              ["250,252,255", a, 1],
            ] as const) {
              context.strokeStyle = `rgba(${color},${alpha.toFixed(3)})`;
              context.lineWidth = line * grow;
              context.beginPath();
              context.moveTo(p.x - p.size, p.y + wave * 0.4);
              context.quadraticCurveTo(p.x - p.size * 0.5, p.y + wave, p.x, p.y);
              context.stroke();
            }
          } else {
            p.y += Math.sin(p.life * 3.1 + p.phase) * 70 * unit * dt;
            p.rot = (p.rot ?? 0) + (p.spin ?? 0) * dt * g;
            drawLeaf(context, p);
          }
          reset = p.x > width + p.size * 2 + 40 * unit || p.y > height + 40 * unit;
          break;
        }
        case "leaves": {
          p.x += Math.sin(p.life * 0.9 + p.phase) * 46 * unit * dt;
          p.rot = (p.rot ?? 0) + (p.spin ?? 0) * dt;
          drawLeaf(context, p);
          reset = p.y > height + 40 * unit || p.x > width + 40 * unit;
          break;
        }
        case "airstream": {
          // Lines speed up and brighten as they pass the viewer.
          const cx = width / 2;
          const cy = height * 0.42;
          const reach = Math.hypot((p.x - cx) / 1.6, p.y - cy) / height;
          const boost = 1 + reach * 2.4;
          p.x += p.vx * (boost - 1) * dt;
          p.y += p.vy * (boost - 1) * dt;
          const fade = Math.min(1, reach * 3.2) * p.alpha;
          const tail = p.size * (0.4 + reach * 1.6);
          const dx = Math.cos(p.phase) * 1.6;
          const dy = Math.sin(p.phase);
          const norm = Math.hypot(dx, dy) || 1;
          if (p.tint < 0.9) {
            const line = Math.max(1.2, (1.4 + reach * 5) * unit);
            context.lineCap = "round";
            for (const [color, alpha, grow] of [
              ["90,120,160", fade * 0.3, 2.2],
              ["250,252,255", fade, 1],
            ] as const) {
              context.strokeStyle = `rgba(${color},${alpha.toFixed(3)})`;
              context.lineWidth = line * grow;
              context.beginPath();
              context.moveTo(p.x, p.y);
              context.lineTo(p.x - (dx / norm) * tail, p.y - (dy / norm) * tail);
              context.stroke();
            }
          } else {
            const radius = p.size * (0.6 + reach * 2.2);
            context.save();
            context.translate(p.x, p.y);
            context.rotate(Math.atan2(dy, dx));
            context.scale(2.6, 0.7);
            const wisp = context.createRadialGradient(0, 0, 0, 0, 0, radius);
            wisp.addColorStop(0, `rgba(255,255,255,${fade.toFixed(3)})`);
            wisp.addColorStop(1, "rgba(255,255,255,0)");
            context.fillStyle = wisp;
            context.fillRect(-radius, -radius, radius * 2, radius * 2);
            context.restore();
          }
          reset = p.x < -tail * 2 || p.x > width + tail * 2 || p.y < -tail * 2 || p.y > height + tail * 2;
          break;
        }
        case "smoke": {
          const swell = 1 + 0.12 * Math.sin(p.life * 0.25 + p.phase);
          const radius = p.size * swell;
          const lift = Math.sin(p.life * 0.18 + p.phase) * 14 * unit;
          context.save();
          context.translate(p.x, p.y + lift);
          context.rotate(Math.sin(p.life * 0.1 + p.phase) * 0.25);
          context.scale(2.3, 0.62);
          const smoke = context.createRadialGradient(0, 0, 0, 0, 0, radius);
          const a = p.alpha * (0.8 + 0.2 * Math.sin(p.life * 0.4 + p.phase * 2));
          smoke.addColorStop(0, `rgba(34,28,40,${a})`);
          smoke.addColorStop(0.5, `rgba(74,64,86,${a * 0.6})`);
          smoke.addColorStop(1, "rgba(84,74,96,0)");
          context.fillStyle = smoke;
          context.fillRect(-radius, -radius, radius * 2, radius * 2);
          context.restore();
          const reach = p.size * 2.4;
          if (p.vx > 0 && p.x > width + reach) p.x = -reach;
          if (p.vx < 0 && p.x < -reach) p.x = width + reach;
          reset = false;
          break;
        }
      }
      if (reset) particles[index] = spawn(false);
    }
    if (kind === "smoke") {
      // A low, dark floor the tendrils rise from.
      const floor = context.createLinearGradient(0, height * 0.55, 0, height);
      floor.addColorStop(0, "rgba(10,8,14,0)");
      floor.addColorStop(1, "rgba(10,8,14,0.5)");
      context.fillStyle = floor;
      context.fillRect(0, height * 0.55, width, height * 0.45);
    }
    if (kind === "storm") {
      if (now >= nextBolt) {
        flash = 0.55 + random() * 0.35;
        nextBolt = now + 4500 + random() * 7000;
      }
      if (flash > 0.01) {
        context.globalCompositeOperation = "source-over";
        context.fillStyle = `rgba(225,235,255,${flash})`;
        context.fillRect(0, 0, width, height);
        flash *= Math.pow(0.02, dt);
      }
    }
  }

  /**
   * The painted ice, revealed from the edges inwards by a soft elliptical mask that closes in
   * over FROST_GROW_MS and opens out again on a thaw.
   */
  function drawFrost(now: number) {
    if (!context) return;
    if (!frost || frost.width !== width || frost.height !== height) {
      frost = document.createElement("canvas");
      frost.width = width;
      frost.height = height;
      const paint = frost.getContext("2d");
      if (paint) paintFrost(paint, width, height, 3);
    }
    if (!frostStart) frostStart = now;
    const grown = smooth((now - frostStart) / FROST_GROW_MS);
    const melted = thawStart ? smooth((now - thawStart) / FROST_THAW_MS) : 0;
    const amount = grown * (1 - melted);
    if (amount <= 0.002) return;
    // Draw the ice into the cleared canvas, then keep only the outer ring that is revealed.
    context.globalCompositeOperation = "source-over";
    context.drawImage(frost, 0, 0);
    context.save();
    context.globalCompositeOperation = "destination-in";
    context.translate(width / 2, height / 2);
    context.scale(width / height, 1);
    const radius = height * 0.75;
    const clear = 1.08 - 0.62 * amount; // where the ice ends, as a share of the radius
    const mask = context.createRadialGradient(0, 0, 0, 0, 0, radius);
    mask.addColorStop(0, "rgba(0,0,0,0)");
    mask.addColorStop(Math.min(0.999, clear), "rgba(0,0,0,0)");
    mask.addColorStop(Math.min(1, clear + 0.22), `rgba(0,0,0,${Math.min(1, amount * 1.4).toFixed(3)})`);
    context.fillStyle = mask;
    context.fillRect(-radius * 2, -radius * 2, radius * 4, radius * 4);
    context.restore();
  }

  /** Rain on the glass: fades in over RAINDROPS_FADE_MS, and out the same way when replaced. */
  function drawRaindrops(now: number) {
    if (!context || (kind !== "raindrops" && !dropsLeaving)) return;
    if (!dropsStart) dropsStart = now;
    let alpha = still ? 1 : smooth((now - dropsStart) / RAINDROPS_FADE_MS);
    if (dropsLeaving) {
      if (!dropsEnd) dropsEnd = now;
      const out = 1 - smooth((now - dropsEnd) / RAINDROPS_FADE_MS);
      if (out <= 0) {
        dropsLeaving = false;
        dropsStart = 0;
        return;
      }
      alpha *= out;
    }
    raindrops.draw(context, width, height, (now - dropsStart) / 1000, alpha, still);
  }

  function loop(now: number) {
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    step(dt, now);
    // With reduced motion the raindrops are drawn once and stay as they are.
    const moving = (kind && !(still && kind === "raindrops")) || dropsLeaving;
    frame = moving ? requestAnimationFrame(loop) : 0;
  }

  const visibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else if ((kind || dropsLeaving) && !frame) {
      last = 0;
      frame = requestAnimationFrame(loop);
    }
  };
  document.addEventListener("visibilitychange", visibility);

  return {
    set(next) {
      if (next === kind) return;
      if (kind === "raindrops" && !still) {
        dropsLeaving = true;
        dropsEnd = 0;
      } else if (next === "raindrops") {
        dropsLeaving = false;
        dropsStart = 0;
      }
      kind = next;
      canvas.classList.toggle("on", !!kind);
      if (!kind && dropsLeaving) {
        // Keep the drops running while the canvas fades out; the loop stops once they are gone.
        if (!frame) {
          last = 0;
          frame = requestAnimationFrame(loop);
        }
        return;
      }
      if (!kind) {
        cancelAnimationFrame(frame);
        frame = 0;
        // Let the canvas fade out before clearing it.
        window.setTimeout(() => {
          if (!kind) context?.clearRect(0, 0, width, height);
        }, 1500);
        return;
      }
      seed = Array.from(kind).reduce((sum, char) => sum * 31 + char.charCodeAt(0), 7);
      frostStart = 0;
      thawStart = 0;
      spawned = 0;
      resize();
      particles = Array.from({ length: COUNTS[kind] }, () => spawn(true));
      flash = 0;
      nextBolt = performance.now() + 1800;
      if (!frame) {
        last = 0;
        frame = requestAnimationFrame(loop);
      }
    },
    thaw() {
      if (kind === "frost" && !thawStart) thawStart = performance.now();
    },
    dispose() {
      kind = undefined;
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}

/** Shared gust strength for the wind: about 0.6–1.4, changing smoothly over a few seconds. */
function gust(now: number) {
  const t = now / 1000;
  return 1 + 0.28 * Math.sin(t * 0.77) + 0.12 * Math.sin(t * 2.3 + 1.3);
}

/** An autumn leaf tumbling in 3D: a pointed oval with a midrib, flattened as it turns. */
function drawLeaf(context: CanvasRenderingContext2D, p: Particle) {
  const turn = Math.cos((p.rot ?? 0) * 0.7 + p.phase);
  const length = p.size;
  const breadth = p.size * 0.48 * (0.25 + 0.75 * Math.abs(turn));
  context.save();
  context.translate(p.x, p.y);
  context.rotate(p.rot ?? 0);
  context.globalAlpha = p.alpha;
  context.fillStyle = LEAF_COLORS[Math.floor(p.tint * 97) % LEAF_COLORS.length];
  context.beginPath();
  context.moveTo(-length, 0);
  context.quadraticCurveTo(-length * 0.2, -breadth * 1.6, length, 0);
  context.quadraticCurveTo(-length * 0.2, breadth * 1.6, -length, 0);
  context.fill();
  // The back of the leaf is darker, so it reads as a flat thing turning over.
  if (turn < 0) {
    context.fillStyle = "rgba(60,25,10,0.28)";
    context.fill();
  }
  context.strokeStyle = "rgba(70,32,12,0.45)";
  context.lineWidth = Math.max(0.6, length * 0.06);
  context.beginPath();
  context.moveTo(-length * 1.15, 0);
  context.lineTo(length * 0.85, 0);
  context.stroke();
  context.restore();
}

/** A small floating candle: ivory wax, a flickering flame and a soft halo, bobbing slowly. */
function drawCandle(context: CanvasRenderingContext2D, p: Particle, unit: number) {
  const t = p.life;
  const x = p.x + Math.sin(t * 0.21 + p.phase) * 3 * unit;
  const y = p.y + Math.sin(t * 0.55 + p.phase) * 5.5 * unit;
  const h = p.size;
  const w = h * 0.17;
  const flicker =
    0.82 +
    0.1 * Math.sin(t * 11.3 + p.phase) +
    0.06 * Math.sin(t * 17.9 + p.phase * 3) +
    0.04 * Math.sin(t * 5.1 + p.tint * 9);
  const sway = Math.sin(t * 3.7 + p.phase) * 0.08;
  const top = y - h / 2;
  context.globalAlpha = p.alpha;
  // Halo.
  context.globalCompositeOperation = "lighter";
  const halo = h * 1.9 * flicker;
  const glow = context.createRadialGradient(x, top - h * 0.14, 0, x, top - h * 0.14, halo);
  glow.addColorStop(0, `rgba(255,220,140,${0.7 * flicker})`);
  glow.addColorStop(0.25, `rgba(255,170,70,${0.26 * flicker})`);
  glow.addColorStop(1, "rgba(255,140,40,0)");
  context.fillStyle = glow;
  context.fillRect(x - halo, top - h * 0.14 - halo, halo * 2, halo * 2);
  // Wax.
  context.globalCompositeOperation = "source-over";
  const wax = context.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  wax.addColorStop(0, "#d6bf94");
  wax.addColorStop(0.35, "#fff6e2");
  wax.addColorStop(1, "#c4a874");
  context.fillStyle = wax;
  context.beginPath();
  context.moveTo(x - w / 2, top + w * 0.15);
  context.quadraticCurveTo(x, top - w * 0.15, x + w / 2, top + w * 0.15);
  context.lineTo(x + w / 2, y + h / 2);
  context.lineTo(x - w / 2, y + h / 2);
  context.closePath();
  context.fill();
  // A drip of melted wax.
  context.fillStyle = "#fffaf0";
  context.beginPath();
  context.ellipse(x - w * 0.22, top + h * 0.12, w * 0.12, h * 0.1, 0, 0, Math.PI * 2);
  context.fill();
  // Wick and flame.
  context.strokeStyle = "#3a2a1a";
  context.lineWidth = Math.max(0.8, w * 0.1);
  context.beginPath();
  context.moveTo(x, top + w * 0.05);
  context.lineTo(x, top - h * 0.05);
  context.stroke();
  const fh = h * 0.42 * flicker;
  const fw = w * 0.55;
  const base = top - h * 0.03;
  context.save();
  context.translate(x, base);
  context.rotate(sway);
  context.globalCompositeOperation = "lighter";
  const flame = context.createRadialGradient(0, -fh * 0.3, 0, 0, -fh * 0.35, fh * 0.9);
  flame.addColorStop(0, "rgba(255,255,235,0.95)");
  flame.addColorStop(0.35, "rgba(255,214,120,0.85)");
  flame.addColorStop(0.75, "rgba(255,140,40,0.35)");
  flame.addColorStop(1, "rgba(255,110,20,0)");
  context.fillStyle = flame;
  context.beginPath();
  context.moveTo(0, -fh);
  context.bezierCurveTo(fw, -fh * 0.45, fw * 0.9, 0, 0, 0);
  context.bezierCurveTo(-fw * 0.9, 0, -fw, -fh * 0.45, 0, -fh);
  context.fill();
  context.restore();
  context.globalAlpha = 1;
}
