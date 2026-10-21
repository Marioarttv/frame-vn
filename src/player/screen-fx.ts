/**
 * Full-screen effects for {fx=…} tags and a scene's `fx` list, layered over the stage (above
 * the characters, below the text box). Every effect is built from seeded geometry and plain
 * CSS animations or Web Animations, so the video renderer's virtual clock seeks them frame by
 * frame and two renders of the same route are identical. Each effect removes itself.
 */
import type { ScreenFx } from "../engine/markup";
import { paintFrost } from "./frost";

export interface ScreenFxLayer {
  play(fx: ScreenFx): void;
  /** Removes every running effect at once (e.g. when the reader jumps elsewhere). */
  clear(): void;
}

/** Total length of each effect in milliseconds. */
export const SCREEN_FX_MS = {
  crack: 2900,
  glint: 750,
  sparkle: 1300,
  ink: 3100,
  heartbeat: 1250,
  comet: 1700,
  hair: 1750,
  tumble: 1350,
  stomp: 700,
  lightning: 1150,
  frost: 4600,
  radiance: 3400,
  wandlight: 3200,
  wandfail: 1700,
  /** Snaps at 1.8 s (the peak a sound lands on). */
  thread: 2400,
  /** Swells to full size by 0.9 s, ripples once, holds faintly and fades. */
  dome: 3200,
  /**
   * Peak at 1.3 s (TRANSFORM_PEAK_MS): the smoke column hides a figure-sized region, so the
   * production cuts or swaps the sprite under it there; a soft dark pulse follows.
   */
  transform: 2800,
  /** The ember blooms by 0.4 s; the warmth reaches the edges by about 1.9 s. */
  warmth: 3600,
  /** Clods land between about 0.35 s and 1.2 s; the splashes are gone by 2 s. */
  splat: 2000,
  /** The first ripple and the edge flicker peak at about 0.1 s. */
  wail: 1600,
  /**
   * Peak at 1.2 s (BINDING_PEAK_MS): the ring of runes is at its tightest and flares once; it
   * then sinks in and fades, leaving a faint glow.
   */
  binding: 2600,
  /**
   * Peak at 0.9 s (FRACTURE_PEAK_MS): a shard tears away from the wisp with a sharp ripple; the
   * fragments then drift apart into a dark green vignette that recedes.
   */
  fracture: 2800,
} as const;

/** When `transform` fully hides the figure, in milliseconds from its start. */
export const TRANSFORM_PEAK_MS = 1300;
/** When the `binding` ring is tightest and flares, in milliseconds from its start. */
export const BINDING_PEAK_MS = 1200;
/** When the `fracture` shard tears away, in milliseconds from its start. */
export const FRACTURE_PEAK_MS = 900;

/**
 * Abstract rune marks for `binding`, drawn in a 20 × 20 box centred on 0: circles, crescents,
 * dots, curls and ticks, chosen so that none reads as a letter of a real alphabet.
 */
const RUNES = [
  "M-4 -3A4 4 0 1 0 4 -3A4 4 0 1 0 -4 -3M-3.4 3L-5 7.5M0 4V8.5M3.4 3L5 7.5",
  "M-7 -2A7 7 0 0 0 7 -2M0 -6.5V-6.4M-3.5 7.5H3.5",
  "M0 -8.5L5.2 0L0 8.5L-5.2 0ZM0 -3V3",
  "M-6.5 -5Q0 -9.5 6.5 -5M-6.5 0Q0 -4.5 6.5 0M-6.5 5Q0 .5 6.5 5",
  "M-8 1Q-4 -7 0 1T8 1M0 -7V-6.9M0 7.5V7.6",
  "M0 -7Q6.5 0 6 6.5Q0 3.5 -6 6.5Q-6.5 0 0 -7M0 2.3V2.4",
  "M-7 0Q0 -6.5 7 0Q0 6.5 -7 0M0 -.1V.1M-9.5 0H-8M8 0H9.5",
  "M-7.5 3A7.5 7.5 0 0 1 7.5 3M-4 3A4 4 0 0 1 4 3M0 7V7.1",
  "M-6.5 -6.5A9 9 0 0 0 6.5 -6.5M-6.5 6.5A9 9 0 0 1 6.5 6.5M-2.5 0H2.5",
];

/** Pale blonde strand colours for the hair curtain, from shadow to highlight. */
const HAIR = ["#d6bf78", "#e6d491", "#f1e4a9", "#f7eec0", "#fbf5d8", "#fffcee"];

const SVG = "http://www.w3.org/2000/svg";
const W = 1600;
const H = 900;
/** Four-point star used by the glint and the sparkles (viewBox 0 0 100 100). */
const STAR =
  "M50 0C53 38 62 47 100 50C62 53 53 62 50 100C47 62 38 53 0 50C38 47 47 38 50 0Z";

function seeded(seed: number) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes))
    element.setAttribute(key, String(value));
  return element;
}

const point = (x: number, y: number) => `${x.toFixed(1)} ${y.toFixed(1)}`;

/** The shattered-glass web: radial cracks, rings between them, and the shards they bound. */
function crackGeometry(cx: number, cy: number, random: () => number) {
  const count = 11 + Math.floor(random() * 3);
  const base = random() * Math.PI * 2;
  const step = (Math.PI * 2) / count;
  const angles = Array.from(
    { length: count },
    (_, index) => base + index * step + (random() - 0.5) * step * 0.7,
  );
  const radii = [0, 60 + random() * 40, 180 + random() * 80, 400 + random() * 140, 2100];
  // points[i][k]: where radial i meets ring k (k = 0 is the impact point).
  const points = angles.map((angle) =>
    radii.map((radius, k) => {
      if (k === 0) return [cx, cy];
      const wobble = angle + (random() - 0.5) * 0.12;
      const r = radius * (0.85 + random() * 0.3);
      return [cx + Math.cos(wobble) * r, cy + Math.sin(wobble) * r];
    }),
  );
  // Jagged in-between points for every edge, shared by the crack line and the shard outline.
  const bend = (a: number[], b: number[], amount: number, sag = 0): number[][] => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const steps = length > 260 ? 3 : 2;
    const result: number[][] = [];
    for (let step = 1; step <= steps; step++) {
      const f = step / (steps + 1);
      const mx = a[0] + dx * f;
      const my = a[1] + dy * f;
      const offset = (random() - 0.5) * amount * length;
      // Rings sag slightly toward the impact, like a spider's web.
      const toward = sag * length * Math.sin(Math.PI * f);
      const cxDir = cx - mx;
      const cyDir = cy - my;
      const cLength = Math.hypot(cxDir, cyDir) || 1;
      result.push([
        mx + nx * offset + (cxDir / cLength) * toward,
        my + ny * offset + (cyDir / cLength) * toward,
      ]);
    }
    return result;
  };
  const radialMid = points.map((radial) =>
    radial.slice(0, -1).map((start, k) => bend(start, radial[k + 1], 0.16)),
  );
  const ringMid = points.map((radial, index) =>
    radial.map((at, k) =>
      k === 0 ? [] : bend(at, points[(index + 1) % count][k], 0.14, 0.07),
    ),
  );
  return { count, rings: radii.length, points, radialMid, ringMid };
}

export function createScreenFx(elements: {
  layer: HTMLElement;
  viewport: HTMLElement;
  reducedMotion: boolean;
}): ScreenFxLayer {
  const { layer, viewport, reducedMotion } = elements;
  let serial = 0;
  const running = new Set<Animation>();
  /** Undoes changes an effect makes outside its own layer (the wail's warp on the view). */
  const cleanups = new Set<() => void>();

  function mount(element: Element, ms: number) {
    layer.append(element);
    window.setTimeout(() => element.remove(), ms + 60);
  }

  function crack(x: number, y: number) {
    const random = seeded(9_173 + Math.round(x * 131 + y * 977) + serial * 7_919);
    const cx = (x / 100) * W;
    const cy = (y / 100) * H;
    const geometry = crackGeometry(cx, cy, random);
    const { count, rings, points, radialMid, ringMid } = geometry;
    const svg = svgElement("svg", {
      class: "sfx sfx-crack",
      viewBox: `0 0 ${W} ${H}`,
      preserveAspectRatio: "xMidYMid slice",
    });
    const defs = svgElement("defs");
    const glass = svgElement("linearGradient", {
      id: `sfx-glass-${serial}`,
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 1,
    });
    glass.append(
      svgElement("stop", { offset: 0, "stop-color": "#e8f2ff", "stop-opacity": 0.13 }),
      svgElement("stop", { offset: 0.5, "stop-color": "#c4d6ee", "stop-opacity": 0.04 }),
      svgElement("stop", { offset: 1, "stop-color": "#ffffff", "stop-opacity": 0.1 }),
    );
    const flare = svgElement("radialGradient", { id: `sfx-impact-${serial}` });
    flare.append(
      svgElement("stop", { offset: 0, "stop-color": "#ffffff", "stop-opacity": 0.95 }),
      svgElement("stop", { offset: 0.3, "stop-color": "#dfeaff", "stop-opacity": 0.45 }),
      svgElement("stop", { offset: 1, "stop-color": "#dfeaff", "stop-opacity": 0 }),
    );
    defs.append(glass, flare);
    svg.append(defs);
    const glassFill = `url(#sfx-glass-${serial})`;

    // Each edge belongs to one shard: shard (i, k) owns radial i's segment k and ring k's
    // segment i, so every line is drawn once and falls with exactly one shard.
    const path = (list: number[][]) =>
      `M${list.map((p) => point(p[0], p[1])).join("L")}`;
    const radialPoints = (i: number, k: number) => [
      points[i][k],
      ...radialMid[i][k],
      points[i][k + 1],
    ];
    const ringPoints = (i: number, k: number) => [
      points[i][k],
      ...ringMid[i][k],
      points[(i + 1) % count][k],
    ];
    const radialEdge = (i: number, k: number) => path(radialPoints(i, k));
    const ringEdge = (i: number, k: number) => path(ringPoints(i, k));
    // Rings are broken in places, more so further out, as real cracks are.
    const ringChance = [0, 0.8, 0.68, 0.5, 0];
    const ringDrawn = Array.from({ length: count }, () =>
      Array.from({ length: rings }, (_, k) => random() < (ringChance[k] ?? 0)),
    );
    const edgeTiming = (k: number, ring: boolean) => {
      const arrive = 0.04 + k * 0.12 + random() * 0.05;
      return ring
        ? { at: arrive + 0.08 + random() * 0.12, t: 0.16 + random() * 0.1 }
        : { at: arrive, t: 0.13 + k * 0.05 };
    };
    const strokes = (d: string, k: number, timing?: { at: number; t: number }) => {
      const width = k < 2 ? 1.9 : 1.4;
      const paths = [
        svgElement("path", {
          d,
          class: "edge shadow",
          "stroke-width": width + 2.2,
          pathLength: 1,
        }),
        svgElement("path", { d, class: "edge", "stroke-width": width, pathLength: 1 }),
      ];
      for (const path of paths)
        if (timing) path.setAttribute("style", `--at:${timing.at.toFixed(3)}s;--t:${timing.t.toFixed(3)}s`);
        else path.classList.add("is-drawn");
      return paths;
    };

    // Phase one: the cracks race outward from the impact and hold.
    const drawing = svgElement("g", { class: "p1" });
    drawing.append(svgElement("rect", { x: -50, y: -50, width: W + 100, height: H + 100, fill: glassFill }));
    const timings = new Map<string, { at: number; t: number }>();
    for (let k = 0; k < rings - 1; k++)
      for (let i = 0; i < count; i++) {
        const radialTiming = edgeTiming(k, false);
        timings.set(`r${i}:${k}`, radialTiming);
        drawing.append(...strokes(radialEdge(i, k), k, radialTiming));
        if (ringDrawn[i][k]) {
          const ringTiming = edgeTiming(k, true);
          timings.set(`c${i}:${k}`, ringTiming);
          drawing.append(...strokes(ringEdge(i, k), k, ringTiming));
        }
      }
    const impact = svgElement("circle", {
      cx,
      cy,
      r: 150,
      fill: `url(#sfx-impact-${serial})`,
      class: "impact",
    });
    drawing.append(impact);

    // Phase two: the same lines, grouped into shards that drop away.
    const falling = svgElement("g", { class: "p2" });
    for (let i = 0; i < count; i++)
      for (let k = 0; k < rings - 1; k++) {
        const next = (i + 1) % count;
        const outline = [
          ...radialPoints(i, k),
          ...ringMid[i][k + 1],
          ...radialPoints(next, k).reverse(),
          ...ringMid[i][k].slice().reverse(),
        ];
        const shard = svgElement("g", { class: "shard" });
        const dx = (random() - 0.5) * 140;
        const dy = 260 + random() * 320;
        const rotate = (random() - 0.5) * 50;
        const delay = 1.72 + k * 0.07 + random() * 0.2;
        shard.setAttribute(
          "style",
          `--dx:${dx.toFixed(0)}px;--dy:${dy.toFixed(0)}px;--r:${rotate.toFixed(1)}deg;--at:${delay.toFixed(3)}s;--t:${(0.78 + random() * 0.25).toFixed(3)}s`,
        );
        shard.append(
          svgElement("path", {
            d: `M${outline.map((p) => point(p[0], p[1])).join("L")}Z`,
            fill: glassFill,
          }),
          ...strokes(radialEdge(i, k), k),
        );
        if (ringDrawn[i][k]) shard.append(...strokes(ringEdge(i, k), k));
        falling.append(shard);
      }
    svg.append(drawing, falling);
    mount(svg, SCREEN_FX_MS.crack);
  }

  function glint(x: number, y: number) {
    const root = document.createElement("div");
    root.className = "sfx sfx-glint";
    root.style.left = `${x}%`;
    root.style.top = `${y}%`;
    const star = svgElement("svg", { viewBox: "0 0 100 100", class: "star" });
    const defs = svgElement("defs");
    const gradient = svgElement("radialGradient", { id: `sfx-glint-${serial}` });
    gradient.append(
      svgElement("stop", { offset: 0, "stop-color": "#ffffff" }),
      svgElement("stop", { offset: 0.45, "stop-color": "#fff6dc" }),
      svgElement("stop", { offset: 1, "stop-color": "#ffe2a0", "stop-opacity": 0.6 }),
    );
    defs.append(gradient);
    star.append(defs, svgElement("path", { d: STAR, fill: `url(#sfx-glint-${serial})` }));
    for (const name of ["bloom", "streak-h", "streak-v"]) {
      const part = document.createElement("i");
      part.className = name;
      root.append(part);
    }
    root.append(star);
    mount(root, SCREEN_FX_MS.glint);
  }

  function sparkle(x: number, y: number) {
    const random = seeded(4_211 + Math.round(x * 53 + y * 389) + serial * 613);
    const root = document.createElement("div");
    root.className = "sfx sfx-sparkle";
    root.style.left = `${x}%`;
    root.style.top = `${y}%`;
    const flash = document.createElement("i");
    flash.className = "burst";
    root.append(flash);
    for (let index = 0; index < 20; index++) {
      const spark = document.createElement("b");
      const angle = (index / 20) * Math.PI * 2 + (random() - 0.5) * 0.5;
      const distance = 6 + random() * 16;
      const size = 0.9 + random() * 2.1;
      spark.style.cssText = `--dx:${(Math.cos(angle) * distance * 1.2).toFixed(2)}cqh;--dy:${(Math.sin(angle) * distance - 3 - random() * 4).toFixed(2)}cqh;--s:${size.toFixed(2)}cqh;--r:${((random() - 0.5) * 180).toFixed(0)}deg;--at:${(random() * 0.16).toFixed(3)}s;--t:${(0.75 + random() * 0.4).toFixed(3)}s`;
      if (random() < 0.3) spark.className = "pale";
      root.append(spark);
    }
    mount(root, SCREEN_FX_MS.sparkle);
  }

  function ink() {
    const random = seeded(77_003 + serial * 131);
    const svg = svgElement("svg", {
      class: "sfx sfx-ink",
      viewBox: `0 0 ${W} ${H}`,
      preserveAspectRatio: "xMidYMid slice",
    });
    const filter = svgElement("filter", {
      id: `sfx-ink-${serial}`,
      x: "-20%",
      y: "-20%",
      width: "140%",
      height: "140%",
    });
    filter.append(
      svgElement("feTurbulence", {
        type: "fractalNoise",
        baseFrequency: 0.011,
        numOctaves: 3,
        seed: 7,
        result: "noise",
      }),
      svgElement("feGaussianBlur", { in: "SourceGraphic", stdDeviation: 10, result: "soft" }),
      svgElement("feDisplacementMap", {
        in: "soft",
        in2: "noise",
        scale: 150,
        xChannelSelector: "R",
        yChannelSelector: "G",
      }),
    );
    const defs = svgElement("defs");
    defs.append(filter);
    const group = svgElement("g", { filter: `url(#sfx-ink-${serial})` });
    // Blots creep in from every corner and along the edges.
    const anchors: [number, number, number][] = [
      [0, 0, 430],
      [W, 0, 430],
      [0, H, 470],
      [W, H, 470],
      [W / 2, -40, 260],
      [W / 2, H + 40, 280],
      [-40, H / 2, 300],
      [W + 40, H / 2, 300],
    ];
    for (const [ax, ay, radius] of anchors) {
      const blot = svgElement("ellipse", {
        cx: ax + (random() - 0.5) * 80,
        cy: ay + (random() - 0.5) * 60,
        rx: radius * (0.9 + random() * 0.3),
        ry: radius * (0.7 + random() * 0.3),
        class: "blot",
      });
      blot.setAttribute("style", `--at:${(random() * 0.25).toFixed(3)}s`);
      group.append(blot);
      for (let drop = 0; drop < 2; drop++) {
        const angle = Math.atan2(H / 2 - ay, W / 2 - ax) + (random() - 0.5) * 1.2;
        const reach = radius * (0.85 + random() * 0.25);
        const splash = svgElement("circle", {
          cx: ax + Math.cos(angle) * reach,
          cy: ay + Math.sin(angle) * reach,
          r: 18 + random() * 34,
          class: "blot drop",
        });
        splash.setAttribute("style", `--at:${(0.25 + random() * 0.35).toFixed(3)}s`);
        group.append(splash);
      }
    }
    const shade = svgElement("rect", { x: 0, y: 0, width: W, height: H, class: "shade" });
    svg.append(defs, shade, group);
    mount(svg, SCREEN_FX_MS.ink);
  }

  function heartbeat() {
    const root = document.createElement("div");
    root.className = "sfx sfx-heartbeat";
    mount(root, SCREEN_FX_MS.heartbeat);
    if (reducedMotion) return;
    const pulse = viewport.animate(
      [
        { scale: 1, offset: 0 },
        { scale: 1.014, offset: 0.1, easing: "ease-in" },
        { scale: 1, offset: 0.26, easing: "ease-out" },
        { scale: 1.022, offset: 0.4, easing: "ease-in" },
        { scale: 1, offset: 0.72 },
        { scale: 1, offset: 1 },
      ],
      { duration: SCREEN_FX_MS.heartbeat, easing: "ease-out" },
    );
    running.add(pulse);
    pulse.finished.then(
      () => running.delete(pulse),
      () => running.delete(pulse),
    );
  }

  /** A small golden comet curves around (x, y) and shoots away, leaving a light trail. */
  function comet(x: number, y: number) {
    const random = seeded(31_337 + Math.round(x * 71 + y * 523) + serial * 977);
    const rect = layer.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const tx = (x / 100) * w;
    const ty = (y / 100) * h;
    const fromLeft = random() < 0.5;
    const start = [fromLeft ? -0.08 * w : 1.08 * w, h * (0.25 + random() * 0.45)];
    const end = [fromLeft ? 1.1 * w : -0.1 * w, h * (0.05 + random() * 0.3)];
    const loop = h * (0.07 + random() * 0.04);
    const side = fromLeft ? 1 : -1;
    const f = (n: number) => n.toFixed(1);
    // In along a curve, a full loop around the point, then out and away.
    const path =
      `M${f(start[0])} ${f(start[1])}` +
      ` Q${f((start[0] + tx) / 2)} ${f(Math.min(start[1], ty) - h * 0.18)} ${f(tx)} ${f(ty)}` +
      ` a${f(loop)} ${f(loop)} 0 1 ${fromLeft ? 1 : 0} ${f(side * 0.01)} 0.01` +
      ` Q${f((tx + end[0]) / 2)} ${f(ty + h * 0.12)} ${f(end[0])} ${f(end[1])}`;
    const root = document.createElement("div");
    root.className = "sfx sfx-comet";
    const travel: Keyframe[] = [
      { offsetDistance: "0%", easing: "cubic-bezier(.3,.1,.6,1)" },
      { offsetDistance: "40%", offset: 0.34, easing: "linear" },
      { offsetDistance: "62%", offset: 0.62, easing: "cubic-bezier(.5,0,.9,.6)" },
      { offsetDistance: "100%" },
    ];
    const timing = { duration: SCREEN_FX_MS.comet, fill: "both" as FillMode };
    // Trail first so the comet's bright core draws on top of it.
    for (let index = 10; index >= 1; index--) {
      const ghost = document.createElement("i");
      ghost.className = "trail";
      ghost.style.offsetPath = `path("${path}")`;
      ghost.style.setProperty("--k", (1 - index / 11).toFixed(3));
      root.append(ghost);
      track(ghost.animate(travel, { ...timing, delay: index * 22 }));
    }
    const ball = document.createElement("i");
    ball.className = "ball";
    ball.style.offsetPath = `path("${path}")`;
    for (const name of ["orb"]) {
      const part = document.createElement("b");
      part.className = name;
      ball.append(part);
    }
    root.append(ball);
    track(ball.animate(travel, timing));
    mount(root, SCREEN_FX_MS.comet + 220);
  }

  /**
   * Long pale blonde hair whips across the whole screen, hides everything for a moment, then
   * clears. Strands stream almost horizontally, as wind-blown hair does, in three depth layers
   * that move at slightly different speeds.
   */
  function hair() {
    const random = seeded(52_021 + serial * 389);
    const svg = svgElement("svg", {
      class: "sfx sfx-hair",
      viewBox: `0 0 ${W} ${H}`,
      preserveAspectRatio: "xMidYMid slice",
    });
    const defs = svgElement("defs");
    const fade = svgElement("linearGradient", { id: `sfx-hair-fade-${serial}`, x1: 0, x2: 1, y1: 0, y2: 0 });
    fade.append(
      svgElement("stop", { offset: 0, "stop-color": "#fff", "stop-opacity": 0 }),
      svgElement("stop", { offset: 0.2, "stop-color": "#fff", "stop-opacity": 1 }),
      svgElement("stop", { offset: 0.8, "stop-color": "#fff", "stop-opacity": 1 }),
      svgElement("stop", { offset: 1, "stop-color": "#fff", "stop-opacity": 0 }),
    );
    const span = { x: -1000, width: W + 2000 };
    const mask = svgElement("mask", {
      id: `sfx-hair-mask-${serial}`,
      maskUnits: "userSpaceOnUse",
      x: span.x - 400,
      y: -300,
      width: span.width + 800,
      height: H + 600,
    });
    mask.append(
      svgElement("rect", { x: span.x, y: -300, width: span.width, height: H + 600, fill: `url(#sfx-hair-fade-${serial})` }),
    );
    const base = svgElement("linearGradient", { id: `sfx-hair-base-${serial}`, x1: 0, x2: 0.25, y1: 0, y2: 1 });
    base.append(
      svgElement("stop", { offset: 0, "stop-color": "#d9c47f" }),
      svgElement("stop", { offset: 0.35, "stop-color": "#f1e2a8" }),
      svgElement("stop", { offset: 0.6, "stop-color": "#f9f0c8" }),
      svgElement("stop", { offset: 1, "stop-color": "#c9b067" }),
    );
    defs.append(fade, mask, base);

    const layers = [
      { count: 70, colors: [0, 1, 2], width: [22, 60], opacity: [0.75, 1], speed: 0.9 },
      { count: 80, colors: [1, 2, 3, 4], width: [8, 30], opacity: [0.65, 1], speed: 1 },
      { count: 46, colors: [4, 5], width: [1.6, 7], opacity: [0.55, 0.95], speed: 1.14 },
    ];
    const tilt = -0.16; // strands rise slightly towards the leading edge
    const groups: SVGGElement[] = [];
    layers.forEach((layer, depth) => {
      const group = svgElement("g", { mask: `url(#sfx-hair-mask-${serial})` });
      if (depth === 0)
        group.append(
          svgElement("rect", { x: span.x, y: -300, width: span.width, height: H + 600, fill: `url(#sfx-hair-base-${serial})` }),
        );
      for (let index = 0; index < layer.count; index++) {
        const y = -120 + ((index + random()) / layer.count) * (H + 240);
        const length = 900 + random() * 1100;
        const x0 = span.x + random() * (span.width - length * 0.6);
        const x1 = x0 + length;
        const wave = (40 + random() * 70) * (random() < 0.5 ? -1 : 1);
        const y1 = y + length * tilt;
        const d =
          `M${point(x0, y)} C${point(x0 + length * 0.33, y + wave + length * tilt * 0.33)} ` +
          `${point(x0 + length * 0.66, y - wave + length * tilt * 0.66)} ${point(x1, y1)}`;
        const shade = HAIR[layer.colors[Math.floor(random() * layer.colors.length)]];
        const width = layer.width[0] + Math.pow(random(), 1.4) * (layer.width[1] - layer.width[0]);
        group.append(
          svgElement("path", {
            d,
            fill: "none",
            stroke: shade,
            "stroke-width": width.toFixed(1),
            "stroke-linecap": "round",
            "stroke-opacity": (layer.opacity[0] + random() * (layer.opacity[1] - layer.opacity[0])).toFixed(2),
          }),
        );
      }
      groups.push(group);
      svg.append(group);
    });
    svg.prepend(defs);
    mount(svg, SCREEN_FX_MS.hair);
    groups.forEach((group, depth) => {
      const speed = layers[depth].speed;
      track(
        group.animate(
          [
            { transform: `translateX(${Math.round((W + 1700) * speed)}px)`, easing: "cubic-bezier(.25,.3,.45,1)" },
            { transform: `translateX(${Math.round(60 * speed)}px)`, offset: 0.4, easing: "linear" },
            { transform: `translateX(${Math.round(-110 * speed)}px)`, offset: 0.56, easing: "cubic-bezier(.55,0,.8,.55)" },
            { transform: `translateX(${Math.round((-W - 1800) * speed)}px)` },
          ],
          { duration: SCREEN_FX_MS.hair, fill: "both" },
        ),
      );
    });
  }

  /** The view lurches, rolls and drops, stops hard on impact, then settles back. */
  function tumble() {
    const root = document.createElement("div");
    root.className = "sfx sfx-tumble";
    mount(root, SCREEN_FX_MS.tumble);
    if (reducedMotion) return;
    const move = viewport.animate(
      [
        { transform: "none", offset: 0 },
        { transform: "translate(0,-1%) rotate(-1.5deg) scale(1.06)", offset: 0.14, easing: "ease-in" },
        { transform: "translate(1%,3.2%) rotate(5deg) scale(1.24)", offset: 0.5, easing: "cubic-bezier(.6,0,1,1)" },
        { transform: "translate(1%,3.8%) rotate(4.3deg) scale(1.24)", offset: 0.53 },
        { transform: "translate(1%,3.4%) rotate(4.6deg) scale(1.24)", offset: 0.58 },
        { transform: "translate(1%,3.6%) rotate(4.45deg) scale(1.24)", offset: 0.66, easing: "cubic-bezier(.4,0,.2,1)" },
        { transform: "none", offset: 1 },
      ],
      { duration: SCREEN_FX_MS.tumble },
    );
    track(move);
  }

  /** Two sharp downward bumps of the whole view, like two stamps of a foot. */
  function stomp() {
    const root = document.createElement("div");
    root.className = "sfx sfx-stomp";
    mount(root, SCREEN_FX_MS.stomp);
    if (reducedMotion) return;
    track(
      viewport.animate(
        [
          { translate: "0 0", offset: 0 },
          { translate: "0 0.9%", offset: 0.05, easing: "ease-out" },
          { translate: "0 0", offset: 0.24, easing: "ease-in-out" },
          { translate: "0 0", offset: 0.4 },
          { translate: "0 1.15%", offset: 0.45, easing: "ease-out" },
          { translate: "0 0", offset: 0.7 },
          { translate: "0 0", offset: 1 },
        ],
        { duration: SCREEN_FX_MS.stomp },
      ),
    );
  }

  /**
   * A jagged, branching bolt strikes from above the frame down to (x, y), with a blue-white
   * flash that flickers twice and decays, and a small jolt of the view.
   */
  function lightning(x: number, y: number) {
    const flash = document.createElement("div");
    flash.className = "sfx sfx-lightning-flash";
    flash.style.setProperty("--x", `${x}%`);
    flash.style.setProperty("--y", `${Math.max(0, y - 30)}%`);
    if (reducedMotion) {
      flash.classList.add("is-dim");
      mount(flash, SCREEN_FX_MS.lightning);
      return;
    }
    const random = seeded(60_607 + Math.round(x * 97 + y * 389) + serial * 1_013);
    const tx = (x / 100) * W;
    const ty = (y / 100) * H;
    // Midpoint displacement: each pass splits every segment and pushes the middle sideways.
    const bolt = (from: number[], to: number[], roughness: number, passes: number) => {
      let points = [from, to];
      for (let pass = 0; pass < passes; pass++) {
        const next: number[][] = [points[0]];
        for (let index = 1; index < points.length; index++) {
          const a = points[index - 1];
          const b = points[index];
          const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const nx = -(b[1] - a[1]) / (length || 1);
          const ny = (b[0] - a[0]) / (length || 1);
          const push = (random() - 0.5) * length * roughness;
          next.push([(a[0] + b[0]) / 2 + nx * push, (a[1] + b[1]) / 2 + ny * push], b);
        }
        points = next;
      }
      return points;
    };
    const main = bolt([tx + (random() - 0.5) * W * 0.18, -20], [tx, ty], 0.5, 7);
    const paths = [{ points: main, width: 1 }];
    for (let index = 0; index < 4; index++) {
      const at = main[Math.floor(main.length * (0.18 + random() * 0.5))];
      const angle = Math.PI / 2 + (random() < 0.5 ? -1 : 1) * (0.35 + random() * 0.6);
      const length = H * (0.12 + random() * 0.2);
      const end = [at[0] + Math.cos(angle) * length, at[1] + Math.sin(angle) * length];
      paths.push({ points: bolt(at, end, 0.55, 5), width: 0.45 + random() * 0.2 });
    }
    const svg = svgElement("svg", {
      class: "sfx sfx-lightning",
      viewBox: `0 0 ${W} ${H}`,
      preserveAspectRatio: "xMidYMid slice",
    });
    const defs = svgElement("defs");
    const blur = svgElement("filter", { id: `sfx-bolt-${serial}`, x: "-20%", y: "-20%", width: "140%", height: "140%" });
    blur.append(svgElement("feGaussianBlur", { stdDeviation: 7 }));
    defs.append(blur);
    svg.append(defs);
    for (const [layer, color, width, opacity] of [
      ["glow", "#8fb6ff", 16, 0.55],
      ["mid", "#d6e5ff", 5.5, 0.9],
      ["core", "#ffffff", 2.2, 1],
    ] as const) {
      const group = svgElement("g", {
        class: layer,
        fill: "none",
        stroke: color,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "stroke-opacity": opacity,
        ...(layer === "glow" ? { filter: `url(#sfx-bolt-${serial})` } : {}),
      });
      for (const path of paths)
        group.append(
          svgElement("path", {
            d: `M${path.points.map((p) => point(p[0], p[1])).join("L")}`,
            "stroke-width": (width * path.width).toFixed(2),
          }),
        );
      svg.append(group);
    }
    mount(flash, SCREEN_FX_MS.lightning);
    mount(svg, SCREEN_FX_MS.lightning);
    track(
      viewport.animate(
        [
          { translate: "0 0", offset: 0 },
          { translate: "0.35% 0.25%", offset: 0.04 },
          { translate: "-0.3% -0.1%", offset: 0.1 },
          { translate: "0.15% 0.1%", offset: 0.18 },
          { translate: "0 0", offset: 0.3 },
          { translate: "0 0", offset: 1 },
        ],
        { duration: SCREEN_FX_MS.lightning },
      ),
    );
  }

  /** Ice creeps in from the screen edges, holds, then melts away (see frost.ts). */
  function frost() {
    const canvas = document.createElement("canvas");
    canvas.className = "sfx sfx-frost";
    const rect = layer.getBoundingClientRect();
    const scale = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.max(1, Math.round(rect.width * scale));
    canvas.height = Math.max(1, Math.round(rect.height * scale));
    const context = canvas.getContext("2d");
    if (context) paintFrost(context, canvas.width, canvas.height, 3 + serial);
    if (reducedMotion) canvas.classList.add("is-still");
    mount(canvas, SCREEN_FX_MS.frost);
  }

  /**
   * The Radiance: silver-white light bursts from (x, y) with slowly turning rays and a ring
   * that sweeps out across the screen, then silver motes drift away from the light.
   */
  function radiance(x: number, y: number) {
    const wash = document.createElement("div");
    wash.className = "sfx sfx-radiance-wash";
    wash.style.setProperty("--x", `${x}%`);
    wash.style.setProperty("--y", `${y}%`);
    mount(wash, SCREEN_FX_MS.radiance);
    if (reducedMotion) return;
    const random = seeded(88_211 + Math.round(x * 61 + y * 433) + serial * 709);
    const root = document.createElement("div");
    root.className = "sfx sfx-radiance";
    root.style.left = `${x}%`;
    root.style.top = `${y}%`;
    const rays = document.createElement("div");
    rays.className = "rays";
    for (let index = 0; index < 12; index++) {
      const ray = document.createElement("i");
      const angle = (index / 12) * 360 + (random() - 0.5) * 18;
      ray.style.cssText = `--a:${angle.toFixed(1)}deg;--l:${(70 + random() * 60).toFixed(0)}cqh;--w:${(1 + random() * 1.6).toFixed(2)}cqh;--at:${(0.05 + random() * 0.2).toFixed(3)}s`;
      rays.append(ray);
    }
    root.append(rays);
    for (const name of ["ring", "ring late", "core"]) {
      const part = document.createElement("i");
      part.className = name;
      root.append(part);
    }
    for (let index = 0; index < 40; index++) {
      const mote = document.createElement("b");
      const angle = random() * Math.PI * 2;
      const distance = 10 + random() * 38;
      mote.style.cssText = `--dx:${(Math.cos(angle) * distance * 1.5).toFixed(2)}cqh;--dy:${(Math.sin(angle) * distance - 6 - random() * 10).toFixed(2)}cqh;--s:${(0.5 + random() * 1.3).toFixed(2)}cqh;--at:${(0.35 + random() * 0.9).toFixed(3)}s;--t:${(1.4 + random() * 1.1).toFixed(3)}s`;
      root.append(mote);
    }
    mount(root, SCREEN_FX_MS.radiance);
  }

  /**
   * A small light at a wand tip. `wandlight` flares, flickers and holds for about two and a
   * half seconds before it shrinks away; `wandfail` sputters and gutters out, dropping sparks.
   */
  function wand(x: number, y: number, fail: boolean) {
    const root = document.createElement("div");
    root.className = `sfx sfx-wand${fail ? " is-failing" : ""}`;
    root.style.left = `${x}%`;
    root.style.top = `${y}%`;
    for (const name of ["halo", "core"]) {
      const part = document.createElement("i");
      part.className = name;
      root.append(part);
    }
    if (fail && !reducedMotion) {
      const random = seeded(12_011 + Math.round(x * 41 + y * 211) + serial * 307);
      for (let index = 0; index < 7; index++) {
        const spark = document.createElement("b");
        spark.style.cssText = `--dx:${((random() - 0.5) * 6).toFixed(2)}cqh;--dy:${(5 + random() * 9).toFixed(2)}cqh;--at:${(0.55 + random() * 0.55).toFixed(3)}s;--t:${(0.45 + random() * 0.35).toFixed(3)}s`;
        root.append(spark);
      }
    }
    if (reducedMotion) root.classList.add("is-still");
    mount(root, fail ? SCREEN_FX_MS.wandfail : SCREEN_FX_MS.wandlight);
  }

  /**
   * A thread of light between two points (two characters' eye lines): the screen edges dim,
   * the thread trembles and pulls taut, brightening from silver-blue to white, then snaps at
   * the middle with a white flash; the halves recoil to their ends and fade. The trembling is
   * a few low sine modes along the thread with seeded phases, drawn each frame from elapsed
   * time, so the video renderer's virtual clock reproduces it exactly.
   */
  function thread(x1: number, y1: number, x2: number, y2: number) {
    const ms = SCREEN_FX_MS.thread;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const shade = document.createElement("div");
    shade.className = "sfx sfx-thread-shade";
    shade.style.setProperty("--x", `${mx}%`);
    shade.style.setProperty("--y", `${my}%`);
    mount(shade, ms);
    const ax = (x1 / 100) * W;
    const ay = (y1 / 100) * H;
    const bx = (x2 / 100) * W;
    const by = (y2 / 100) * H;
    const length = Math.hypot(bx - ax, by - ay) || 1;
    // The normal points down the screen, so the slack sags like a real thread.
    let nx = -(by - ay) / length;
    let ny = (bx - ax) / length;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const svg = svgElement("svg", {
      class: "sfx sfx-thread",
      viewBox: `0 0 ${W} ${H}`,
      preserveAspectRatio: "xMidYMid slice",
    });
    const at = (s: number, offset: number) =>
      point(ax + (bx - ax) * s + nx * offset, ay + (by - ay) * s + ny * offset);
    if (reducedMotion) {
      svg.classList.add("is-still");
      svg.append(svgElement("path", { class: "core", d: `M${at(0, 0)}L${at(1, 0)}`, "stroke-width": 1.8 }));
      mount(svg, ms);
      return;
    }
    const random = seeded(41_077 + Math.round(x1 * 53 + y1 * 211 + x2 * 97 + y2 * 389) + serial * 1_031);
    const id = `sfx-thread-${serial}`;
    const defs = svgElement("defs");
    // User-space region: a thin, nearly flat line has a bounding box too short to blur into.
    const blur = svgElement("filter", { id, filterUnits: "userSpaceOnUse", x: 0, y: 0, width: W, height: H });
    blur.append(svgElement("feGaussianBlur", { stdDeviation: 4 }));
    defs.append(blur);
    const glow = svgElement("path", { class: "glow", filter: `url(#${id})` });
    const core = svgElement("path", { class: "core" });
    const sparks = [0, 1].map(() => {
      const angle = (random() < 0.5 ? -1 : 1) * (Math.PI / 2 + (random() - 0.5) * 1.6);
      const speed = 260 + random() * 200;
      const tx = (bx - ax) / length;
      const ty = (by - ay) / length;
      // Sideways along the normal, with some drift along the thread.
      const vx = nx * Math.sin(angle) * speed + tx * Math.cos(angle) * speed;
      const vy = ny * Math.sin(angle) * speed + ty * Math.cos(angle) * speed;
      const spark = svgElement("circle", { class: "spark", r: 2.6 + random() * 1.4, opacity: 0 });
      return { spark, vx, vy };
    });
    svg.append(defs, glow, core, ...sparks.map((item) => item.spark));
    const modes = [1, 0.5, 0.28].map((weight) => ({
      weight,
      slow: 2.2 + random() * 1,
      fast: 4 + random() * 1,
      slowPhase: random() * Math.PI * 2,
      fastPhase: random() * Math.PI * 2,
    }));
    const slack = Math.min(length * 0.05, 36);
    const tremble = Math.min(length * 0.03, 20);
    const whipSign = random() < 0.5 ? -1 : 1;
    const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
    const smooth = (value: number) => value * value * (3 - 2 * value);
    const mix = (from: number, to: number, f: number) => from + (to - from) * f;
    const SNAP = 1.8;
    const SAMPLES = 40;
    const strokeAt = (f: number) =>
      `rgb(${Math.round(mix(176, 255, f))},${Math.round(mix(196, 255, f))},${Math.round(mix(232, 255, f))})`;
    const draw = (t: number) => {
      if (t < 0.2) {
        core.setAttribute("d", "");
        glow.setAttribute("d", "");
        return;
      }
      const bright = smooth(clamp01((t - 0.3) / 1.45));
      if (t < SNAP) {
        // Tension: the trembling quickens and dies away as the thread goes taut.
        const slackness = 1 - smooth(clamp01((t - 0.2) / 1.5));
        const time = t + 0.4 * t * t;
        const shape = modes.map(
          (mode) =>
            mode.weight *
            (0.72 * Math.sin(2 * Math.PI * mode.slow * time + mode.slowPhase) +
              0.28 * Math.sin(2 * Math.PI * mode.fast * time + mode.fastPhase)),
        );
        const offset = (s: number) =>
          slack * slackness ** 1.5 * Math.sin(Math.PI * s) +
          tremble * slackness * shape.reduce((sum, value, m) => sum + value * Math.sin((m + 1) * Math.PI * s), 0);
        const line = (from: number, to: number) => {
          const points: string[] = [];
          for (let index = 0; index <= SAMPLES; index++) {
            const s = from + ((to - from) * index) / SAMPLES;
            points.push(at(s, offset(s)));
          }
          return `M${points.join("L")}`;
        };
        // It draws in from both eyes and meets in the middle.
        const reach = 1 - (1 - clamp01((t - 0.2) / 0.28)) ** 2;
        const d = reach < 1 ? line(0, reach / 2) + line(1, 1 - reach / 2) : line(0, 1);
        core.setAttribute("d", d);
        glow.setAttribute("d", d);
        const color = strokeAt(bright);
        core.setAttribute("stroke", color);
        glow.setAttribute("stroke", color);
        core.setAttribute("stroke-width", mix(2.4, 1.7, bright).toFixed(2));
        glow.setAttribute("stroke-width", mix(9, 6.5, bright).toFixed(2));
        core.setAttribute("opacity", (0.92 * clamp01((t - 0.2) / 0.12)).toFixed(3));
        glow.setAttribute("opacity", mix(0.3, 0.6, bright).toFixed(3));
        return;
      }
      // The snap: each half whips back to its end and fades.
      const since = t - SNAP;
      const recoil = 1 - (1 - clamp01(since / 0.3)) ** 3;
      const end = 0.49 * (1 - recoil);
      const whip = length * 0.035 * Math.sin(since * 30) * Math.exp(-since * 9);
      const half = (from: number, sign: number) => {
        const points: string[] = [];
        for (let index = 0; index <= SAMPLES / 2; index++) {
          const along = (end * index) / (SAMPLES / 2);
          const s = from === 0 ? along : 1 - along;
          const curl = end > 0 ? (along / end) ** 2 : 0;
          points.push(at(s, sign * whip * curl));
        }
        return `M${points.join("L")}`;
      };
      const d = end > 0.004 ? half(0, whipSign) + half(1, -whipSign) : "";
      core.setAttribute("d", d);
      glow.setAttribute("d", d);
      core.setAttribute("stroke", "#fff");
      glow.setAttribute("stroke", "#fff");
      const fade = 1 - smooth(clamp01(since / 0.36));
      core.setAttribute("opacity", (0.95 * fade).toFixed(3));
      glow.setAttribute("opacity", (0.6 * fade).toFixed(3));
      const sparkFade = 1 - clamp01(since / 0.4);
      const travel = since - since * since * 0.9;
      for (const { spark, vx, vy } of sparks) {
        spark.setAttribute("cx", ((ax + bx) / 2 + vx * travel).toFixed(1));
        spark.setAttribute("cy", ((ay + by) / 2 + vy * travel + 160 * since * since).toFixed(1));
        spark.setAttribute("opacity", (sparkFade * (since < 0.03 ? since / 0.03 : 1)).toFixed(3));
      }
    };
    const flash = document.createElement("div");
    flash.className = "sfx sfx-thread-flash";
    flash.style.setProperty("--x", `${mx}%`);
    flash.style.setProperty("--y", `${my}%`);
    draw(0);
    mount(svg, ms);
    mount(flash, ms);
    const began = performance.now();
    const tick = () => {
      if (!svg.isConnected) return;
      const elapsed = performance.now() - began;
      draw(Math.min(elapsed, ms) / 1000);
      if (elapsed < ms) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** Draws an effect from elapsed seconds every frame until `ms`, as `thread` does. */
  function drive(element: Element, ms: number, draw: (t: number) => void) {
    draw(0);
    const began = performance.now();
    const tick = () => {
      if (!element.isConnected) return;
      const elapsed = performance.now() - began;
      draw(Math.min(elapsed, ms) / 1000);
      if (elapsed < ms) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /**
   * A canvas over the whole layer. `begin()` clears it and maps the 1600 × 900 design space
   * onto it the way the SVG effects do (centred, cropped to cover).
   */
  function stageCanvas(className: string) {
    const canvas = document.createElement("canvas");
    canvas.className = `sfx sfx-canvas ${className}`;
    const rect = layer.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const context = canvas.getContext("2d");
    const k = Math.max(canvas.width / W, canvas.height / H);
    const ox = (canvas.width - W * k) / 2;
    const oy = (canvas.height - H * k) / 2;
    const begin = () => {
      if (!context) return null;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(k, 0, 0, k, ox, oy);
      return context;
    };
    return { canvas, begin };
  }

  /**
   * Privacy: a soap-bubble dome swells from the wand tip to radius `r` (stage-width percent)
   * with an iridescent rim and a soft inner sheen, a ripple runs across it once, and it holds
   * faintly before fading. Outside the dome the scene dims slightly.
   */
  function dome(x: number, y: number, r: number) {
    const ms = SCREEN_FX_MS.dome;
    const cx = (x / 100) * W;
    const cy = (y / 100) * H;
    const R = (r / 100) * W;
    const id = `sfx-dome-${serial}`;
    const svg = svgElement("svg", {
      class: "sfx sfx-dome",
      viewBox: `0 0 ${W} ${H}`,
      preserveAspectRatio: "xMidYMid slice",
    });
    const defs = svgElement("defs");
    const film = svgElement("radialGradient", { id: `${id}-film` });
    for (const [offset, color, opacity] of [
      [0, "#dfe9ff", 0],
      [0.6, "#e4edff", 0.03],
      [0.84, "#e8f0ff", 0.08],
      [0.95, "#f3f7ff", 0.18],
      [1, "#ffffff", 0.06],
    ] as const)
      film.append(svgElement("stop", { offset, "stop-color": color, "stop-opacity": opacity }));
    // Thin-film colours, pale and shifting as the gradient turns.
    const iris = svgElement("linearGradient", { id: `${id}-iris`, gradientUnits: "userSpaceOnUse", x1: cx - R, y1: cy, x2: cx + R, y2: cy });
    for (const [offset, color] of [
      [0, "#ffd9f2"],
      [0.2, "#cdeeff"],
      [0.4, "#fff2c9"],
      [0.58, "#d3ffe9"],
      [0.78, "#e1d6ff"],
      [1, "#ffd9f2"],
    ] as const)
      iris.append(svgElement("stop", { offset, "stop-color": color }));
    const dim = svgElement("radialGradient", { id: `${id}-dim`, gradientUnits: "userSpaceOnUse", cx, cy, r: R * 1.3 });
    dim.append(
      svgElement("stop", { offset: 0, "stop-color": "#04060c", "stop-opacity": 0 }),
      svgElement("stop", { offset: 0.76, "stop-color": "#04060c", "stop-opacity": 0 }),
      svgElement("stop", { offset: 1, "stop-color": "#04060c", "stop-opacity": 0.85 }),
    );
    const glow = svgElement("filter", { id: `${id}-glow`, filterUnits: "userSpaceOnUse", x: 0, y: 0, width: W, height: H });
    glow.append(svgElement("feGaussianBlur", { stdDeviation: 5 }));
    const soft = svgElement("filter", { id: `${id}-soft`, filterUnits: "userSpaceOnUse", x: 0, y: 0, width: W, height: H });
    soft.append(svgElement("feGaussianBlur", { stdDeviation: 3.5 }));
    const flash = svgElement("radialGradient", { id: `${id}-flash` });
    flash.append(
      svgElement("stop", { offset: 0, "stop-color": "#ffffff", "stop-opacity": 0.9 }),
      svgElement("stop", { offset: 0.35, "stop-color": "#e6eeff", "stop-opacity": 0.35 }),
      svgElement("stop", { offset: 1, "stop-color": "#e6eeff", "stop-opacity": 0 }),
    );
    // Thin-film colour shows most towards the rim, as on a real bubble.
    const fresnel = svgElement("radialGradient", { id: `${id}-fresnel` });
    for (const [offset, color] of [
      [0, "#000"],
      [0.55, "#000"],
      [0.82, "#3a3a3a"],
      [0.96, "#ffffff"],
      [1, "#000"],
    ] as const)
      fresnel.append(svgElement("stop", { offset, "stop-color": color }));
    const filmMask = svgElement("mask", { id: `${id}-mask`, maskUnits: "userSpaceOnUse", x: 0, y: 0, width: W, height: H });
    const filmShape = svgElement("circle", { cx, cy, r: R, fill: `url(#${id}-fresnel)` });
    filmMask.append(filmShape);
    defs.append(film, iris, dim, glow, soft, flash, fresnel, filmMask);
    const shade = svgElement("rect", { x: -20, y: -20, width: W + 40, height: H + 40, fill: `url(#${id}-dim)`, opacity: 0.22 });
    const body = svgElement("circle", { cx, cy, r: R, fill: `url(#${id}-film)` });
    const colour = svgElement("circle", { cx, cy, r: R, fill: `url(#${id}-iris)`, mask: `url(#${id}-mask)`, opacity: 0.28 });
    const rimGlow = svgElement("path", { fill: "none", stroke: `url(#${id}-iris)`, "stroke-width": 9, filter: `url(#${id}-glow)`, opacity: 0.45 });
    const rim = svgElement("path", { fill: "none", stroke: `url(#${id}-iris)`, "stroke-width": 2.2, opacity: 0.8 });
    const inner = svgElement("path", { fill: "none", stroke: "#ffffff", "stroke-width": 0.9, opacity: 0.3 });
    const sheen = svgElement("path", { fill: "none", stroke: "#ffffff", "stroke-linecap": "round", filter: `url(#${id}-soft)` });
    const sheenSmall = svgElement("path", { fill: "none", stroke: "#ffffff", "stroke-linecap": "round", filter: `url(#${id}-soft)` });
    const ripple = svgElement("ellipse", { fill: "none", stroke: "#f4f8ff", filter: `url(#${id}-glow)`, opacity: 0 });
    const spark = svgElement("circle", { cx, cy, r: 90, fill: `url(#${id}-flash)`, opacity: 0 });
    const group = svgElement("g");
    group.append(body, colour, rimGlow, rim, inner, sheen, sheenSmall, ripple);
    svg.append(defs, shade, group, spark);
    const arc = (radius: number, from: number, to: number) => {
      const a = (from * Math.PI) / 180;
      const b = (to * Math.PI) / 180;
      return `M${point(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius)}A${radius.toFixed(1)} ${radius.toFixed(1)} 0 0 1 ${point(cx + Math.cos(b) * radius, cy + Math.sin(b) * radius)}`;
    };
    const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
    const smooth = (value: number) => {
      const c = clamp01(value);
      return c * c * (3 - 2 * c);
    };
    // The outline, with a soft bulge travelling across with the ripple.
    const outline = (radius: number, bulge: number, across: number) => {
      const steps = 72;
      const points: string[] = [];
      for (let index = 0; index <= steps; index++) {
        const angle = (index / steps) * Math.PI * 2;
        const along = Math.cos(angle);
        const swell = bulge * Math.exp(-((along - across) ** 2) / 0.04);
        const local = radius * (1 + swell);
        points.push(point(cx + Math.cos(angle) * local, cy + Math.sin(angle) * local));
      }
      return `M${points.join("L")}Z`;
    };
    const draw = (t: number) => {
      // Swell with a little overshoot, as a bubble does when it is blown.
      const grow = clamp01(t / 0.9);
      const swell = 1 - (1 - grow) ** 1.8 + 0.028 * Math.sin(Math.PI * clamp01((t - 0.55) / 0.6));
      const radius = reducedMotion ? R : R * Math.max(0.03, swell);
      const life = reducedMotion
        ? smooth(t / 0.3) * (1 - smooth((t - 2.4) / 0.8))
        : smooth(t / 0.22) * (1 - 0.55 * smooth((t - 1.7) / 0.5)) * (1 - smooth((t - 2.5) / 0.7));
      const ripplePhase = reducedMotion ? -1 : (t - 0.95) / 0.8;
      const across = -1.05 + 2.1 * smooth(ripplePhase);
      const rippleOn = ripplePhase > 0 && ripplePhase < 1 ? Math.sin(Math.PI * ripplePhase) : 0;
      const d = outline(radius, 0.018 * rippleOn, across);
      rim.setAttribute("d", d);
      rimGlow.setAttribute("d", d);
      inner.setAttribute("d", outline(radius * 0.982, 0.018 * rippleOn, across));
      body.setAttribute("r", radius.toFixed(1));
      colour.setAttribute("r", radius.toFixed(1));
      filmShape.setAttribute("r", radius.toFixed(1));
      group.setAttribute("opacity", life.toFixed(3));
      const turn = reducedMotion ? 40 : 40 + t * 38;
      iris.setAttribute("gradientTransform", `rotate(${turn.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})`);
      // The window reflection and a fainter one opposite, drifting slowly round.
      const drift = reducedMotion ? 0 : t * 6;
      sheen.setAttribute("d", arc(radius * 0.87, 204 + drift, 238 + drift));
      sheen.setAttribute("stroke-width", (radius * 0.04).toFixed(1));
      sheen.setAttribute("opacity", "0.4");
      sheenSmall.setAttribute("d", arc(radius * 0.88, 24 + drift, 40 + drift));
      sheenSmall.setAttribute("stroke-width", (radius * 0.022).toFixed(1));
      sheenSmall.setAttribute("opacity", "0.22");
      // The ripple: a band running round the bubble's surface from one side to the other.
      const rx = radius * Math.sqrt(Math.max(0, 1 - across * across));
      ripple.setAttribute("cx", (cx + across * radius).toFixed(1));
      ripple.setAttribute("cy", cy.toFixed(1));
      ripple.setAttribute("rx", (rx * 0.2).toFixed(1));
      ripple.setAttribute("ry", rx.toFixed(1));
      ripple.setAttribute("stroke-width", (radius * 0.045).toFixed(1));
      ripple.setAttribute("opacity", (0.32 * rippleOn).toFixed(3));
      dim.setAttribute("r", (radius * 1.3).toFixed(1));
      shade.setAttribute("opacity", (0.32 * smooth(t / 0.9) * (1 - smooth((t - 2.3) / 0.8))).toFixed(3));
      const sparkLife = reducedMotion ? 0 : clamp01(t / 0.08) * (1 - smooth(t / 0.45));
      spark.setAttribute("opacity", sparkLife.toFixed(3));
    };
    mount(svg, ms);
    drive(svg, ms, draw);
  }

  /**
   * An Smoke transformation: dark smoke and flecks of black fur swirl upward in a column
   * around (x, y), thickening until they hide a figure-sized region at TRANSFORM_PEAK_MS, then a
   * soft dark pulse and the column dissipates upward.
   */
  function transform(x: number, y: number) {
    const ms = SCREEN_FX_MS.transform;
    if (reducedMotion) {
      const still = document.createElement("div");
      still.className = "sfx sfx-transform-still";
      still.style.setProperty("--x", `${x}%`);
      still.style.setProperty("--y", `${y}%`);
      mount(still, ms);
      return;
    }
    const random = seeded(23_017 + Math.round(x * 89 + y * 401) + serial * 541);
    const cx = (x / 100) * W;
    const cy = (y / 100) * H;
    // A man-sized column: fully dark about a fifth of the stage wide, soft wisps beyond.
    const half = W * 0.12;
    const top = cy - H * 0.46;
    const bottom = cy + H * 0.46;
    const span = bottom - top;
    const PEAK = TRANSFORM_PEAK_MS / 1000;
    const TAU = Math.PI * 2;
    const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
    const smooth = (value: number) => {
      const c = clamp01(value);
      return c * c * (3 - 2 * c);
    };
    const after = (t: number) => Math.max(0, t - PEAK);
    // After the peak the column rises away (its top faster) and spreads as it thins.
    const lift = (t: number, h: number) => Math.pow(after(t), 1.35) * 300 * (0.5 + h * 0.8);
    const spread = (t: number) => 1 + 0.8 * smooth(after(t) / 1.3);
    const thin = (t: number) => 1 - smooth((t - PEAK - 0.1) / 0.9);
    const gather = (t: number) => smooth((t - 0.05) / 1.15);
    const widthAt = (h: number) => half * (0.8 + 0.35 * h);
    const swirlers = (count: number, fleck: boolean) =>
      Array.from({ length: count }, () => {
        const birth = 0.02 + Math.pow(random(), 0.85) * 1.45;
        return {
          birth,
          life: fleck ? 0.6 + random() * 0.6 : 1 + random() * 0.9,
          theta: random() * TAU,
          spin: (fleck ? 4.2 : 2.6) + random() * 2,
          orbit: (fleck ? 0.6 : 0.35) + random() * 0.75,
          // Early smoke starts low, where the dog stands, and climbs.
          from: random() * (0.35 + 0.55 * clamp01(birth / 0.9)),
          rise: (fleck ? 0.42 : 0.3) + random() * 0.3,
          size: 34 + random() * 40,
          shade: random(),
          curl: (random() - 0.5) * 8,
        };
      });
    const puffs = swirlers(120, false);
    const fur = swirlers(80, true);
    const wisps = Array.from({ length: 34 }, () => ({
      ...swirlers(1, false)[0],
      arc: 1.1 + random() * 1.4,
      width: 14 + random() * 22,
      pale: random() < 0.45,
    }));
    const core = Array.from({ length: 18 }, (_, index) => ({
      f: (index + 0.5) / 18 + (random() - 0.5) * 0.03,
      phase: random() * TAU,
      size: 0.95 + random() * 0.2,
    }));
    const place = (p: { theta: number; spin: number; orbit: number; from: number; rise: number }, age: number, t: number, turn = 0) => {
      const angle = p.theta + p.spin * age + turn;
      const h = clamp01(p.from + p.rise * age);
      const radius = widthAt(h) * p.orbit * spread(t);
      return {
        px: cx + Math.sin(angle) * radius,
        py: bottom - h * span - lift(t, h),
        depth: Math.cos(angle),
        heading: Math.atan2(-p.rise * span, Math.cos(angle) * p.spin * radius),
        h,
      };
    };
    const { canvas, begin } = stageCanvas("sfx-transform");
    const smoke = (
      context: CanvasRenderingContext2D,
      px: number,
      py: number,
      radius: number,
      rgb: string,
      alpha: number,
      heading = 0,
      stretch = 1,
    ) => {
      if (alpha <= 0.003 || radius <= 0.5) return;
      context.save();
      context.translate(px, py);
      context.rotate(heading);
      context.scale(stretch, 1 / Math.sqrt(stretch));
      const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radius);
      gradient.addColorStop(0, `rgba(${rgb},${alpha.toFixed(3)})`);
      gradient.addColorStop(0.5, `rgba(${rgb},${(alpha * 0.78).toFixed(3)})`);
      gradient.addColorStop(1, `rgba(${rgb},0)`);
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(0, 0, radius, 0, TAU);
      context.fill();
      context.restore();
    };
    const lifeFade = (age: number, life: number) => smooth(age / 0.2) * (1 - smooth((age - life * 0.55) / (life * 0.45)));
    const draw = (t: number) => {
      const context = begin();
      if (!context) return;
      const gone = 1 - smooth((t - 2.15) / 0.65);
      // The room darkens a little as the smoke gathers, most at the peak.
      const gloom = 0.14 * smooth((t - 0.5) / 0.8) * (1 - smooth((t - PEAK - 0.1) / 1.1));
      if (gloom > 0.002) {
        context.fillStyle = `rgba(6,5,9,${gloom.toFixed(3)})`;
        context.fillRect(-40, -40, W + 80, H + 80);
      }
      const items: { depth: number; paint: () => void }[] = [];
      for (const puff of puffs) {
        const age = t - puff.birth;
        if (age < 0 || age > puff.life) continue;
        const { px, py, depth, heading } = place(puff, age, t);
        const alpha = 0.4 * lifeFade(age, puff.life) * gone * (0.7 + 0.3 * depth);
        const radius = puff.size * (0.75 + (0.6 * age) / puff.life) * spread(t);
        const rgb = puff.shade > 0.5 ? "14,12,17" : "22,18,18";
        items.push({ depth, paint: () => smoke(context, px, py, radius, rgb, alpha, heading, 1.6) });
      }
      // Curling trails of smoke along the helix, pale and dark, tapering towards their tails.
      for (const wisp of wisps) {
        const age = t - wisp.birth;
        if (age < 0 || age > wisp.life) continue;
        const alpha = lifeFade(age, wisp.life) * gone;
        const head = place(wisp, age, t);
        items.push({
          depth: head.depth,
          paint: () => {
            const steps = 9;
            for (let step = steps; step >= 0; step--) {
              const back = (step / steps) * wisp.arc;
              const at = place(wisp, Math.max(0, age - back / wisp.spin), t);
              const taper = 1 - (0.7 * step) / steps;
              smoke(
                context,
                at.px,
                at.py,
                wisp.width * 0.9 * taper * spread(t),
                wisp.pale ? "92,86,98" : "13,11,15",
                (wisp.pale ? 0.24 : 0.3) * alpha * taper,
                at.heading,
                1.5,
              );
            }
          },
        });
      }
      // Behind the core first, then the core, then what swirls in front of it.
      items.sort((a, b) => a.depth - b.depth);
      let index = 0;
      for (; index < items.length && items[index].depth < 0; index++) items[index].paint();
      const body = 0.56 * gather(t) * thin(t);
      if (body > 0.003)
        for (const part of core) {
          // The core fills from the ground up as the smoke climbs.
          const filled = smooth((gather(t) * 1.35 - part.f * 0.45) / 0.55);
          smoke(
            context,
            cx + Math.sin(part.f * 9 + t * 1.7 + part.phase) * half * 0.26 * spread(t),
            bottom - part.f * span - lift(t, part.f),
            half * part.size * spread(t),
            "11,10,14",
            body * filled * gone,
          );
        }
      for (; index < items.length; index++) items[index].paint();
      // Flecks of black fur caught in the swirl.
      context.lineCap = "round";
      for (const fleck of fur) {
        const age = t - fleck.birth;
        if (age < 0 || age > fleck.life) continue;
        const { px, py, heading } = place(fleck, age, t);
        const alpha = smooth(age / 0.12) * (1 - smooth((age - fleck.life * 0.6) / (fleck.life * 0.4))) * gone;
        if (alpha < 0.01) continue;
        const length = 7 + fleck.size * 0.14;
        context.save();
        context.translate(px, py);
        context.rotate(heading + fleck.theta * 0.3 + age * fleck.curl);
        context.beginPath();
        context.moveTo(-length / 2, 0);
        context.quadraticCurveTo(0, fleck.curl * 0.7, length / 2, 0);
        context.strokeStyle = `rgba(20,16,15,${(0.9 * alpha).toFixed(3)})`;
        context.lineWidth = 2.1;
        context.stroke();
        context.beginPath();
        context.moveTo(-length / 2, -0.8);
        context.quadraticCurveTo(0, fleck.curl * 0.7 - 0.8, length / 2, -0.8);
        context.strokeStyle = `rgba(96,84,76,${(0.3 * alpha).toFixed(3)})`;
        context.lineWidth = 0.8;
        context.stroke();
        context.restore();
      }
      // The soft dark pulse right after the peak, spreading out from the column.
      const since = t - PEAK;
      if (since > 0 && since < 0.75) {
        const q = since / 0.75;
        const reach = H * (0.2 + 0.95 * q);
        const outer = reach + 180;
        const ring = context.createRadialGradient(cx, cy, 0, cx, cy, outer);
        const strength = 0.3 * Math.sin(Math.PI * Math.min(1, q * 1.6)) * (1 - q);
        ring.addColorStop(0, "rgba(5,4,8,0)");
        ring.addColorStop(Math.max(0, (reach - 160) / outer), "rgba(5,4,8,0)");
        ring.addColorStop(reach / outer, `rgba(5,4,8,${strength.toFixed(3)})`);
        ring.addColorStop(1, "rgba(5,4,8,0)");
        context.fillStyle = ring;
        context.fillRect(-40, -40, W + 80, H + 80);
      }
    };
    mount(canvas, ms);
    drive(canvas, ms, draw);
  }

  /**
   * A Button Warmer: a small ember-orange glow blooms at (x, y), then warm amber light spreads
   * out to the edges (the inverse of `frost`) with a faint rising heat shimmer and a warm grade
   * on the whole frame, holds and fades.
   */
  function warmth(x: number, y: number) {
    const random = seeded(70_001 + Math.round(x * 73 + y * 311) + serial * 829);
    const root = document.createElement("div");
    root.className = `sfx sfx-warmth${reducedMotion ? " is-still" : ""}`;
    root.style.setProperty("--x", `${x}%`);
    root.style.setProperty("--y", `${y}%`);
    for (const name of ["grade", "haze", "light", "glow", "ember"]) {
      const part = document.createElement("i");
      part.className = name;
      root.append(part);
    }
    if (!reducedMotion) {
      // Heat shimmer: faint wavering strands rising across the frame, thickest near the glow.
      const shimmer = svgElement("svg", { class: "shimmer", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMidYMid slice" });
      const blur = svgElement("filter", { id: `sfx-warmth-${serial}`, filterUnits: "userSpaceOnUse", x: -100, y: -400, width: W + 200, height: H + 800 });
      blur.append(svgElement("feGaussianBlur", { stdDeviation: 6 }));
      const defs = svgElement("defs");
      defs.append(blur);
      shimmer.append(defs);
      const group = svgElement("g", { filter: `url(#sfx-warmth-${serial})` });
      for (let index = 0; index < 11; index++) {
        const near = index < 5;
        const sx = near ? (x / 100) * W + (random() - 0.5) * 420 : random() * W;
        const sy = near ? (y / 100) * H + 40 + random() * 120 : H * (0.55 + random() * 0.45);
        const length = 220 + random() * 260;
        const sway = 14 + random() * 18;
        const d = `M${point(sx, sy)}C${point(sx + sway, sy - length * 0.33)} ${point(sx - sway, sy - length * 0.66)} ${point(sx + sway * 0.4, sy - length)}`;
        const path = svgElement("path", { d, class: "strand", "stroke-width": (6 + random() * 9).toFixed(1) });
        path.setAttribute("style", `--at:${(0.5 + random() * 1.1).toFixed(3)}s;--t:${(1.5 + random() * 0.8).toFixed(3)}s;--o:${(near ? 0.16 : 0.09).toFixed(2)}`);
        group.append(path);
      }
      shimmer.append(group);
      root.append(shimmer);
      for (let index = 0; index < 14; index++) {
        const mote = document.createElement("b");
        mote.style.cssText = `--dx:${((random() - 0.5) * 16).toFixed(2)}cqh;--dy:${(-16 - random() * 26).toFixed(2)}cqh;--ox:${((random() - 0.5) * 14).toFixed(2)}cqh;--s:${(0.35 + random() * 0.55).toFixed(2)}cqh;--at:${(0.35 + random() * 1.4).toFixed(3)}s;--t:${(1.4 + random() * 0.9).toFixed(3)}s`;
        root.append(mote);
      }
    }
    mount(root, SCREEN_FX_MS.warmth);
  }

  /**
   * A comic mud volley: four to six clods fly in quick arcs from off-screen right towards
   * (x, y) and burst into irregular splashes with a few droplets, then fade.
   */
  function splat(x: number, y: number) {
    const ms = SCREEN_FX_MS.splat;
    const random = seeded(19_391 + Math.round(x * 67 + y * 283) + serial * 463);
    const TAU = Math.PI * 2;
    const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
    const smooth = (value: number) => {
      const c = clamp01(value);
      return c * c * (3 - 2 * c);
    };
    const count = 4 + Math.floor(random() * 3);
    const tx0 = (x / 100) * W;
    const ty0 = (y / 100) * H;
    /** A closed, smoothed outline through radii sampled evenly round a centre. */
    const outline = (radii: number[]) => {
      const pts = radii.map((radius, index) => {
        const angle = (index / radii.length) * TAU;
        return [Math.cos(angle) * radius, Math.sin(angle) * radius];
      });
      const path = new Path2D();
      const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const start = mid(pts[pts.length - 1], pts[0]);
      path.moveTo(start[0], start[1]);
      for (let index = 0; index < pts.length; index++) {
        const next = mid(pts[index], pts[(index + 1) % pts.length]);
        path.quadraticCurveTo(pts[index][0], pts[index][1], next[0], next[1]);
      }
      path.closePath();
      return path;
    };
    const clods = Array.from({ length: count }, (_, index) => {
      const tx = index === 0 ? tx0 : tx0 + (random() - 0.5) * W * 0.2;
      const ty = index === 0 ? ty0 : ty0 + (random() - 0.5) * H * 0.26;
      const sx = W + 60 + random() * 80;
      const sy = ty - 60 + random() * 160;
      const apex = Math.min(sy, ty) - 140 - random() * 160;
      // Launches spread over 0.8 s whatever the count, so the last lands by about 1.25 s.
      const launch = index * (0.78 / Math.max(1, count - 1)) + random() * 0.03;
      const flight = 0.32 + random() * 0.1;
      const size = 15 + random() * 9;
      const lump = Array.from({ length: 9 }, () => size * (0.78 + random() * 0.36));
      const splash = 27 + random() * 16;
      // Splash outline: a lumpy body with a few flung fingers.
      const fingers = Array.from({ length: 4 + Math.floor(random() * 3) }, () => ({
        angle: random() * TAU,
        length: 0.5 + random() * 0.6,
        width: 0.045 + random() * 0.05,
      }));
      const steps = 56;
      const wobble = [random() * TAU, random() * TAU];
      const radii = Array.from({ length: steps }, (_, step) => {
        const angle = (step / steps) * TAU;
        let radius = 0.86 + 0.09 * Math.sin(3 * angle + wobble[0]) + 0.06 * Math.sin(5 * angle + wobble[1]) + (random() - 0.5) * 0.08;
        for (const finger of fingers) {
          let delta = Math.abs(angle - finger.angle) % TAU;
          if (delta > Math.PI) delta = TAU - delta;
          radius += finger.length * Math.exp(-((delta / finger.width) ** 2));
        }
        return splash * radius;
      });
      const drops = Array.from({ length: 6 + Math.floor(random() * 4) }, (_, k) => {
        const finger = fingers[k % fingers.length];
        const angle = k < fingers.length ? finger.angle + (random() - 0.5) * 0.15 : random() * TAU;
        const distance = splash * (k < fingers.length ? 1.25 + finger.length + random() * 0.3 : 1.2 + random() * 1.1);
        return { angle, distance, r: 2.4 + random() * 4.2, fall: k >= fingers.length && random() < 0.5 };
      });
      const shines = Array.from({ length: 2 + Math.floor(random() * 2) }, () => ({
        dx: -splash * (0.15 + random() * 0.3),
        dy: -splash * (0.15 + random() * 0.3),
        rx: splash * (0.08 + random() * 0.1),
        ry: splash * (0.04 + random() * 0.05),
      }));
      return {
        tx, ty, sx, sy, apex, launch, flight, size,
        spin: (random() < 0.5 ? -1 : 1) * (6 + random() * 8),
        rock: random() * TAU,
        body: outline(lump),
        splat: outline(radii),
        splash, drops, shines,
        tilt: random() * TAU,
        drip: { at: (random() - 0.5) * 0.6, length: splash * (0.4 + random() * 0.4) },
      };
    });
    const along = (clod: (typeof clods)[number], u: number) => {
      const mx = (clod.sx + clod.tx) / 2;
      const a = (1 - u) * (1 - u);
      const b = 2 * (1 - u) * u;
      const c = u * u;
      return [a * clod.sx + b * mx + c * clod.tx, a * clod.sy + b * clod.apex + c * clod.ty];
    };
    const { canvas, begin } = stageCanvas("sfx-splat");
    const paintClod = (context: CanvasRenderingContext2D, clod: (typeof clods)[number], px: number, py: number, angle: number, alpha: number, scale: number) => {
      context.save();
      context.translate(px, py);
      context.rotate(angle);
      context.scale(scale, scale);
      context.globalAlpha = alpha;
      const gradient = context.createRadialGradient(-clod.size * 0.35, -clod.size * 0.35, 0, 0, 0, clod.size * 1.1);
      gradient.addColorStop(0, "#8a6440");
      gradient.addColorStop(0.45, "#5c3c20");
      gradient.addColorStop(1, "#3a2412");
      context.fillStyle = gradient;
      context.fill(clod.body);
      context.restore();
    };
    const draw = (t: number) => {
      const context = begin();
      if (!context) return;
      const fade = 1 - smooth((t - 1.45) / 0.55);
      for (const clod of clods) {
        const landed = clod.launch + clod.flight;
        if (!reducedMotion && t < clod.launch) continue;
        if (!reducedMotion && t < landed) {
          const u = (t - clod.launch) / clod.flight;
          // A short smear of motion behind the clod.
          for (const [lag, alpha, scale] of [[0.12, 0.12, 0.7], [0.07, 0.22, 0.82], [0.03, 0.4, 0.92], [0, 1, 1]] as const) {
            const v = u - lag;
            if (v < 0) continue;
            const [px, py] = along(clod, v);
            paintClod(context, clod, px, py, clod.rock + clod.spin * (t - lag * clod.flight), alpha, scale);
          }
          continue;
        }
        const since = reducedMotion ? 1 : t - landed;
        const pop = reducedMotion ? 1 : since < 0.06 ? 0.35 + (since / 0.06) * 0.8 : 1.15 - 0.15 * smooth((since - 0.06) / 0.12);
        context.save();
        context.translate(clod.tx, clod.ty);
        context.globalAlpha = fade;
        context.save();
        context.rotate(clod.tilt);
        context.scale(pop, pop);
        context.shadowColor = "rgba(0,0,0,.28)";
        context.shadowBlur = 6;
        context.shadowOffsetY = 3;
        const gradient = context.createRadialGradient(-clod.splash * 0.2, -clod.splash * 0.25, 0, 0, 0, clod.splash * 1.6);
        gradient.addColorStop(0, "#7a5532");
        gradient.addColorStop(0.45, "#5a391c");
        gradient.addColorStop(1, "#3b2310");
        context.fillStyle = gradient;
        context.fill(clod.splat);
        context.shadowColor = "transparent";
        context.lineWidth = 1.6;
        context.strokeStyle = "rgba(40,22,9,.55)";
        context.stroke(clod.splat);
        context.restore();
        // A slow drip from the lower edge.
        const drip = reducedMotion ? 0.6 : smooth((since - 0.15) / 0.9);
        if (drip > 0) {
          const dx = clod.drip.at * clod.splash;
          const top = clod.splash * 0.7;
          const length = clod.drip.length * drip;
          context.fillStyle = "#4a2e16";
          context.beginPath();
          context.moveTo(dx - 5, top);
          context.quadraticCurveTo(dx - 4, top + length * 0.7, dx, top + length);
          context.quadraticCurveTo(dx + 4, top + length * 0.7, dx + 5, top);
          context.closePath();
          context.fill();
          context.beginPath();
          context.arc(dx, top + length, 4.6, 0, TAU);
          context.fill();
        }
        // Wet highlights.
        for (const shine of clod.shines) {
          context.fillStyle = "rgba(196,160,118,.5)";
          context.beginPath();
          context.ellipse(shine.dx * pop, shine.dy * pop, shine.rx, shine.ry, -0.6, 0, TAU);
          context.fill();
        }
        // Droplets flung out on impact; a few fall away.
        for (const drop of clod.drops) {
          const out = reducedMotion ? 1 : 1 - (1 - clamp01(since / 0.14)) ** 3;
          const fall = drop.fall && !reducedMotion ? 260 * Math.max(0, since - 0.1) ** 2 : 0;
          const dropAlpha = drop.fall && !reducedMotion ? 1 - smooth((since - 0.35) / 0.4) : 1;
          if (dropAlpha <= 0) continue;
          context.globalAlpha = fade * dropAlpha;
          context.fillStyle = "#4f3219";
          context.beginPath();
          context.arc(Math.cos(drop.angle) * drop.distance * out, Math.sin(drop.angle) * drop.distance * out + fall, drop.r, 0, TAU);
          context.fill();
        }
        context.restore();
      }
    };
    mount(canvas, ms);
    if (reducedMotion) {
      canvas.classList.add("is-still");
      // Every splash as it lands, at full strength; the canvas itself fades in and out.
      draw(1);
      return;
    }
    drive(canvas, ms, draw);
  }

  /**
   * A ghostly shriek: faint pale ripples spread from (x, y) across the screen while the frame
   * wavers (a displacement filter on the view) and the edges flicker pale and cold.
   */
  function wail(x: number, y: number) {
    const ms = SCREEN_FX_MS.wail;
    const edge = document.createElement("div");
    edge.className = `sfx sfx-wail-edge${reducedMotion ? " is-still" : ""}`;
    mount(edge, ms);
    if (reducedMotion) return;
    const random = seeded(51_413 + Math.round(x * 59 + y * 227) + serial * 743);
    const cx = (x / 100) * W;
    const cy = (y / 100) * H;
    const id = `sfx-wail-${serial}`;
    const svg = svgElement("svg", { class: "sfx sfx-wail", viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMidYMid slice" });
    const defs = svgElement("defs");
    const blur = svgElement("filter", { id: `${id}-blur`, filterUnits: "userSpaceOnUse", x: -W, y: -H, width: W * 3, height: H * 3 });
    blur.append(svgElement("feGaussianBlur", { stdDeviation: 10 }));
    // The waver: a displacement of the whole view, driven per frame.
    const rect = viewport.getBoundingClientRect();
    const vw = Math.max(1, rect.width);
    const vh = Math.max(1, rect.height);
    const warp = svgElement("filter", {
      id: `${id}-warp`,
      filterUnits: "userSpaceOnUse",
      primitiveUnits: "userSpaceOnUse",
      x: 0,
      y: 0,
      width: vw,
      height: vh,
      "color-interpolation-filters": "sRGB",
    });
    const turbulence = svgElement("feTurbulence", {
      type: "fractalNoise",
      baseFrequency: `${(2.2 / vw).toFixed(5)} ${(3.4 / vh).toFixed(5)}`,
      numOctaves: 1,
      seed: 3 + (serial % 7),
      result: "noise",
    });
    const displace = svgElement("feDisplacementMap", { in: "SourceGraphic", in2: "noise", scale: 0, xChannelSelector: "R", yChannelSelector: "G" });
    warp.append(turbulence, displace);
    defs.append(blur, warp);
    svg.append(defs);
    const rings = [0, 0.2, 0.43].map((delay, index) => {
      const glow = svgElement("path", { class: "glow", filter: `url(#${id}-blur)` });
      const line = svgElement("path", { class: "line" });
      svg.append(glow, line);
      return { delay, glow, line, phase: random() * Math.PI * 2, strength: 1 - index * 0.22 };
    });
    const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
    const reach = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) * 1.08;
    let warping = false;
    const release = () => {
      if (!warping) return;
      warping = false;
      viewport.style.removeProperty("filter");
      cleanups.delete(release);
    };
    const draw = (t: number) => {
      let pulse = 0;
      for (const ring of rings) {
        const p = (t - ring.delay) / 1.1;
        if (p <= 0 || p >= 1) {
          ring.line.setAttribute("d", "");
          ring.glow.setAttribute("d", "");
          continue;
        }
        const radius = reach * (1 - (1 - p) ** 1.7);
        const points: string[] = [];
        for (let index = 0; index <= 64; index++) {
          const angle = (index / 64) * Math.PI * 2;
          const waver = 1 + 0.012 * Math.sin(3 * angle + ring.phase + t * 5) + 0.006 * Math.sin(7 * angle - ring.phase - t * 4);
          points.push(point(cx + Math.cos(angle) * radius * waver, cy + Math.sin(angle) * radius * waver));
        }
        const d = `M${points.join("L")}Z`;
        const alpha = ring.strength * clamp01(p / 0.08) * (1 - p) ** 1.3;
        ring.line.setAttribute("d", d);
        ring.glow.setAttribute("d", d);
        ring.line.setAttribute("opacity", (0.2 * alpha).toFixed(3));
        ring.glow.setAttribute("opacity", (0.36 * alpha).toFixed(3));
        ring.line.setAttribute("stroke-width", (1.5 + 3 * p).toFixed(2));
        ring.glow.setAttribute("stroke-width", (24 + 50 * p).toFixed(2));
        pulse += alpha;
      }
      const amount = Math.min(1, pulse) * Math.sin(t * 19) * (1 - clamp01((t - 1.25) / 0.3));
      const scale = vh * 0.009 * amount;
      if (Math.abs(scale) > 0.05) {
        displace.setAttribute("scale", scale.toFixed(2));
        if (!warping) {
          warping = true;
          cleanups.add(release);
          viewport.style.filter = `url(#${id}-warp)`;
        }
      } else release();
      if (t * 1000 >= ms) release();
    };
    mount(svg, ms);
    drive(svg, ms, draw);
    window.setTimeout(release, ms + 80);
  }

  /**
   * A binding vow closing on a person: a ring of small pale-gold rune marks fades in around
   * (x, y) (a throat-sized collar, seen slightly from above), turns slowly and tightens like a
   * chain drawing shut, flares once at its tightest (BINDING_PEAK_MS), then sinks into the point
   * and fades, leaving a faint glow.
   */
  function binding(x: number, y: number) {
    const ms = SCREEN_FX_MS.binding;
    const random = seeded(31_337 + Math.round(x * 97 + y * 389) + serial * 613);
    const cx = (x / 100) * W;
    const cy = (y / 100) * H;
    const PEAK = BINDING_PEAK_MS / 1000;
    const TAU = Math.PI * 2;
    const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
    const smooth = (value: number) => {
      const c = clamp01(value);
      return c * c * (3 - 2 * c);
    };
    // The collar at its tightest: wide and flat, as a ring round a neck seen from the front.
    const RX = 62;
    const RY = 21;
    const tilt = (random() - 0.5) * 0.08;
    const count = 11;
    const start = random() * TAU;
    const order = Array.from({ length: RUNES.length }, (_, index) => index);
    for (let index = order.length - 1; index > 0; index--) {
      const swap = Math.floor(random() * (index + 1));
      [order[index], order[swap]] = [order[swap], order[index]];
    }
    const runes = Array.from({ length: count }, (_, index) => ({
      path: new Path2D(RUNES[order[index % order.length]]),
      angle: start + (index / count) * TAU + (random() - 0.5) * 0.12,
      // They light one after another round the ring.
      at: 0.04 + index * 0.028 + random() * 0.02,
      flicker: random() * TAU,
    }));
    const { canvas, begin } = stageCanvas("sfx-binding");
    const glow = (context: CanvasRenderingContext2D, px: number, py: number, radius: number, alpha: number, rx = 1) => {
      if (alpha <= 0.003 || radius <= 0.5) return;
      context.save();
      context.translate(px, py);
      context.scale(rx, 1);
      const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radius);
      gradient.addColorStop(0, `rgba(255,236,178,${alpha.toFixed(3)})`);
      gradient.addColorStop(0.35, `rgba(255,206,110,${(alpha * 0.45).toFixed(3)})`);
      gradient.addColorStop(1, "rgba(255,190,90,0)");
      context.fillStyle = gradient;
      context.fillRect(-radius, -radius, radius * 2, radius * 2);
      context.restore();
    };
    const draw = (t: number) => {
      const context = begin();
      if (!context) return;
      const since = t - PEAK;
      // Tightening: slow at first, drawing shut faster towards the peak, with a small snap.
      const closing = reducedMotion ? 1 : Math.pow(clamp01(t / PEAK), 2.2);
      const snap = reducedMotion || since < 0 ? 0 : 0.07 * Math.sin(Math.PI * clamp01(since / 0.22));
      const sink = reducedMotion ? 0 : 0.6 * smooth((since - 0.12) / 0.75);
      const scale = (1 + 0.85 * (1 - closing)) * (1 - snap) * (1 - sink);
      const turn = reducedMotion ? 0 : 0.42 * t + 0.55 * closing + 0.25 * smooth(since / 0.8);
      const flare = Math.exp(-((since / 0.16) ** 2));
      const fade = 1 - smooth((since - (reducedMotion ? 0.6 : 0.35)) / 0.65);
      context.globalCompositeOperation = "lighter";
      // The faint glow that stays a moment after the ring has sunk in.
      const linger = 0.5 * smooth((since - 0.2) / 0.45) * (1 - smooth((t - 2) / 0.6));
      glow(context, cx, cy, RX * 0.7, linger, 1.6);
      glow(context, cx, cy, RX * 1.15, 0.42 * flare, 1.6);
      const rx = RX * scale;
      const ry = RY * scale;
      const at = (angle: number) => {
        const ex = Math.cos(angle) * rx;
        const ey = Math.sin(angle) * ry;
        return [cx + ex * Math.cos(tilt) - ey * Math.sin(tilt), cy + ex * Math.sin(tilt) + ey * Math.cos(tilt)];
      };
      // The chain: a hair-thin ellipse between the runes, brighter as it pulls taut.
      const lit = runes.map((rune) => (reducedMotion ? smooth(t / 0.3) : smooth((t - rune.at) / 0.28)) * fade);
      const chain = (0.16 + 0.22 * closing + 0.5 * flare) * (reducedMotion ? smooth(t / 0.3) : smooth(t / 0.45)) * fade;
      if (chain > 0.003) {
        context.save();
        context.lineCap = "round";
        for (const [width, color, alpha] of [
          [4.2, "255,200,110", chain * 0.25],
          [1.1, "255,240,200", chain],
        ] as const) {
          context.strokeStyle = `rgba(${color},${alpha.toFixed(3)})`;
          context.lineWidth = width * Math.max(0.5, scale);
          context.setLineDash([7 * scale, 5 * scale]);
          context.lineDashOffset = -turn * 40;
          context.beginPath();
          context.ellipse(cx, cy, rx, ry, tilt, 0, TAU);
          context.stroke();
        }
        context.restore();
      }
      // The flare's ring, opening a little beyond the collar and fading.
      if (!reducedMotion && since > 0 && since < 0.45) {
        const q = since / 0.45;
        context.strokeStyle = `rgba(255,232,170,${(0.55 * (1 - q) ** 2).toFixed(3)})`;
        context.lineWidth = 2.4 * (1 - q) + 0.6;
        context.beginPath();
        context.ellipse(cx, cy, rx * (1 + 0.45 * q), ry * (1 + 0.45 * q), tilt, 0, TAU);
        context.stroke();
      }
      // The runes, the far side of the ring dimmer and smaller than the near side.
      const placed = runes
        .map((rune, index) => {
          const angle = rune.angle + turn;
          const [px, py] = at(angle);
          return { rune, px, py, depth: Math.sin(angle), alpha: lit[index] };
        })
        .sort((a, b) => a.depth - b.depth);
      context.lineCap = "round";
      context.lineJoin = "round";
      for (const { rune, px, py, depth, alpha } of placed) {
        if (alpha <= 0.003) continue;
        const near = 0.5 + 0.5 * depth;
        const size = (0.62 + 0.22 * near) * Math.max(0.55, Math.min(1.15, scale * 1.05)) * (1 + 0.2 * flare);
        const shimmer = reducedMotion ? 1 : 0.88 + 0.12 * Math.sin(t * 9 + rune.flicker);
        const light = alpha * (0.5 + 0.5 * near) * shimmer;
        glow(context, px, py, 14 * size + 4 * flare, light * (0.3 + 0.25 * flare));
        context.save();
        context.translate(px, py);
        context.scale(size, size);
        for (const [width, color, strength] of [
          [4.4, "255,196,96", 0.22 + 0.15 * flare],
          [1.7, "255,226,150", 0.75],
          [0.8 + 0.5 * flare, "255,250,232", 0.7 + 0.3 * flare],
        ] as const) {
          context.strokeStyle = `rgba(${color},${Math.min(1, light * strength).toFixed(3)})`;
          context.lineWidth = width;
          context.stroke(rune.path);
        }
        context.restore();
      }
    };
    mount(canvas, ms);
    drive(canvas, ms, draw);
  }

  /**
   * A soul torn apart: a pale white-green wisp pulses at (x, y), a jagged crack runs through it,
   * and at FRACTURE_PEAK_MS a dark-edged shard tears away with a sharp ripple; four to six
   * fragments drift outward trailing faint sickly-green smoke and fade into a dark green
   * vignette that recedes.
   */
  function fracture(x: number, y: number) {
    const ms = SCREEN_FX_MS.fracture;
    const random = seeded(66_601 + Math.round(x * 113 + y * 431) + serial * 977);
    const cx = (x / 100) * W;
    const cy = (y / 100) * H;
    const PEAK = FRACTURE_PEAK_MS / 1000;
    const TAU = Math.PI * 2;
    const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
    const smooth = (value: number) => {
      const c = clamp01(value);
      return c * c * (3 - 2 * c);
    };
    const CORE = 56;
    // Tongues of pale light that make up the wisp, turning slowly round its heart.
    const tongues = Array.from({ length: 9 }, (_, index) => ({
      angle: (index / 9) * TAU + random() * 0.5,
      spin: 0.7 + random() * 0.8,
      reach: 0.35 + random() * 0.35,
      size: 0.45 + random() * 0.3,
      phase: random() * TAU,
    }));
    // The crack: a jagged line across the wisp, drawn out from the middle both ways.
    const crackAngle = -1.05 + (random() - 0.5) * 0.4;
    const crackHalf = (side: number) => {
      const points: number[][] = [[0, 0]];
      const steps = 5;
      for (let step = 1; step <= steps; step++) {
        const along = (step / steps) * CORE * 1.15;
        const jag = step === steps ? 0 : (random() - 0.5) * 13 * (step % 2 ? 1 : -0.7);
        points.push([side * along, jag]);
      }
      return points;
    };
    const crack = [crackHalf(1), crackHalf(-1)];
    // The fragments: one larger shard torn off across the crack, the rest flung round it.
    const count = 4 + Math.floor(random() * 3);
    const normal = crackAngle + Math.PI / 2;
    const fragments = Array.from({ length: count }, (_, index) => {
      const main = index === 0;
      const heading = main
        ? normal + (random() - 0.5) * 0.3
        : normal + Math.PI * (0.45 + (1.1 * (index - 1)) / Math.max(1, count - 2)) + (random() - 0.5) * 0.35;
      const size = main ? 26 + random() * 6 : 12 + random() * 8;
      // A splinter: long and pointed, its edge broken into sharp facets.
      const sides = 5 + Math.floor(random() * 2);
      const stretch = 1.35 + random() * 0.4;
      const outline = Array.from({ length: sides }, (_, k) => {
        const angle = (k / sides) * TAU + (random() - 0.5) * 0.45;
        const radius = size * (k === 0 ? 1.15 : k % 2 ? 0.8 + random() * 0.2 : 0.62 + random() * 0.15);
        return [Math.cos(angle) * radius * stretch, Math.sin(angle) * radius * 0.6];
      });
      return {
        main,
        heading,
        size,
        outline,
        distance: (main ? 330 : 190) + random() * 140,
        curl: (random() - 0.5) * 0.8,
        spin: (random() - 0.5) * (main ? 1.6 : 3.2),
        rock: random() * TAU,
        delay: main ? 0 : 0.03 + random() * 0.09,
      };
    });
    const { canvas, begin } = stageCanvas("sfx-fracture");
    /**
     * A soft round light. Each stop fades to its own colour at zero alpha, never to black, so
     * the glow's edge does not darken the scene under it.
     */
    const blob = (
      context: CanvasRenderingContext2D,
      px: number,
      py: number,
      radius: number,
      stops: [number, string, number][],
      alpha: number,
      sx = 1,
      sy = 1,
      turn = 0,
    ) => {
      if (alpha <= 0.003 || radius <= 0.5) return;
      context.save();
      context.translate(px, py);
      context.rotate(turn);
      context.scale(sx, sy);
      const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radius);
      for (const [offset, rgb, strength] of stops)
        gradient.addColorStop(offset, `rgba(${rgb},${Math.min(1, alpha * strength).toFixed(3)})`);
      gradient.addColorStop(1, `rgba(${stops[stops.length - 1][1]},0)`);
      context.fillStyle = gradient;
      context.fillRect(-radius, -radius, radius * 2, radius * 2);
      context.restore();
    };
    const fragmentAt = (fragment: (typeof fragments)[number], since: number) => {
      const travel = 1 - Math.exp(-Math.max(0, since - fragment.delay) / 0.45);
      const angle = fragment.heading + fragment.curl * travel;
      const reach = fragment.distance * travel + (fragment.main ? CORE * 0.3 : CORE * 0.2);
      return {
        px: cx + Math.cos(angle) * reach,
        py: cy + Math.sin(angle) * reach * 0.85 - 24 * travel * travel,
        rot: fragment.rock + fragment.spin * Math.max(0, since - fragment.delay),
      };
    };
    const draw = (t: number) => {
      const context = begin();
      if (!context) return;
      const since = t - PEAK;
      context.globalCompositeOperation = "source-over";
      // The dark green vignette: a little gloom as the wisp strains, deepest just after the tear.
      const vignette =
        0.25 * smooth((t - 0.1) / 0.6) * (1 - smooth(since / 0.15)) +
        0.85 * smooth(since / 0.25) * (1 - smooth((since - 0.5) / 1.3));
      if (vignette > 0.003) {
        const gradient = context.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, W * 0.6);
        gradient.addColorStop(0, "rgba(4,26,14,0)");
        gradient.addColorStop(0.5, `rgba(4,26,14,${(vignette * 0.4).toFixed(3)})`);
        gradient.addColorStop(1, `rgba(2,16,9,${(vignette * 0.9).toFixed(3)})`);
        context.fillStyle = gradient;
        context.fillRect(-40, -40, W + 80, H + 80);
      }
      // The wisp: two heartbeats, swelling and quivering as the crack runs, then a dim wound.
      const appear = smooth(t / 0.2);
      const beat = reducedMotion ? 0 : 0.16 * Math.exp(-(((t - 0.2) / 0.07) ** 2)) + 0.22 * Math.exp(-(((t - 0.52) / 0.08) ** 2));
      const strain = reducedMotion || since > 0 ? 0 : 0.2 * smooth((t - 0.3) / 0.6) + 0.04 * Math.sin(t * 43) * smooth((t - 0.4) / 0.4);
      const remnant = reducedMotion
        ? 1 - smooth((t - 1.7) / 0.9)
        : (1 - 0.65 * smooth(since / 0.2)) * (1 - smooth((t - 1.5) / 0.8));
      const core = appear * remnant;
      const radius = CORE * (1 + beat + strain) * (since > 0 && !reducedMotion ? 1 - 0.4 * smooth(since / 0.5) : 1);
      blob(context, cx, cy, radius * 2.1, [[0, "170,238,196", 0.24], [0.45, "160,230,186", 0.07]], core);
      if (!reducedMotion)
        for (const tongue of tongues) {
          const angle = tongue.angle + t * tongue.spin;
          const wave = 0.8 + 0.2 * Math.sin(t * 6 + tongue.phase);
          blob(
            context,
            cx + Math.cos(angle) * radius * tongue.reach,
            cy + Math.sin(angle) * radius * tongue.reach * 0.8 - radius * 0.12,
            radius * tongue.size * wave,
            [[0, "225,255,232", 0.55], [0.5, "160,235,185", 0.25]],
            core,
            1.7,
            0.75,
            angle + Math.PI / 2,
          );
        }
      blob(context, cx, cy, radius, [[0, "250,255,250", 1], [0.3, "214,252,225", 0.8], [0.65, "150,232,180", 0.25]], core);
      // The crack, growing out from the middle and flickering before it gives.
      const grow = reducedMotion ? 0 : smooth((t - 0.3) / 0.5) * (1 - smooth(since / 0.1));
      if (grow > 0.003) {
        context.save();
        context.translate(cx, cy);
        context.rotate(crackAngle);
        const flicker = 0.8 + 0.2 * Math.sin(t * 57);
        context.lineJoin = "miter";
        context.lineCap = "round";
        for (const half of crack) {
          const shown = Math.max(1, grow * (half.length - 1));
          const path = new Path2D();
          path.moveTo(0, 0);
          for (let index = 1; index <= Math.ceil(shown); index++) {
            const [ax, ay] = half[index - 1];
            const [bx, by] = half[index];
            const f = Math.min(1, shown - index + 1);
            path.lineTo(ax + (bx - ax) * f, ay + (by - ay) * f);
          }
          context.strokeStyle = `rgba(235,255,240,${(0.6 * flicker * grow).toFixed(3)})`;
          context.lineWidth = 4.5;
          context.stroke(path);
          context.strokeStyle = `rgba(8,30,18,${(0.85 * grow).toFixed(3)})`;
          context.lineWidth = 1.7;
          context.stroke(path);
        }
        context.restore();
      }
      if (reducedMotion || since <= 0) return;
      // The tear: a sharp flash and one fast ripple running out across the frame.
      blob(context, cx, cy, CORE * 1.9, [[0, "245,255,248", 0.95], [0.35, "180,244,206", 0.35]], Math.exp(-since / 0.08));
      if (since < 0.5) {
        const q = since / 0.5;
        const reach = 40 + (1 - (1 - q) ** 2.4) * H * 0.62;
        context.strokeStyle = `rgba(4,22,12,${(0.35 * (1 - q)).toFixed(3)})`;
        context.lineWidth = 12 * (1 - q) + 2;
        context.beginPath();
        context.arc(cx, cy, Math.max(1, reach - 7), 0, TAU);
        context.stroke();
        context.strokeStyle = `rgba(214,255,228,${(0.55 * (1 - q) ** 1.5).toFixed(3)})`;
        context.lineWidth = 2.4 * (1 - q) + 0.8;
        context.beginPath();
        context.arc(cx, cy, reach, 0, TAU);
        context.stroke();
      }
      // The fragments, each trailing faint sickly-green smoke.
      for (const fragment of fragments) {
        const life = 1 - smooth((since - (fragment.main ? 0.7 : 0.5)) / 0.95);
        if (life <= 0.003) continue;
        for (let k = 16; k >= 1; k--) {
          const back = since - k * 0.04;
          if (back < fragment.delay) continue;
          const at = fragmentAt(fragment, back);
          const age = k * 0.04;
          const puff = (fragment.size * 0.5 + 34 * age) * (fragment.main ? 1.15 : 1);
          const wobble = Math.sin(k * 1.9 + fragment.rock) * 22 * age;
          blob(
            context,
            at.px + wobble,
            at.py - 18 * age,
            puff,
            [[0, "150,178,92", 0.32], [0.5, "120,150,72", 0.14]],
            life * (1 - k / 17),
          );
        }
        const { px, py, rot } = fragmentAt(fragment, since);
        blob(context, px, py, fragment.size * 2.4, [[0, "190,250,210", 0.45], [0.4, "140,225,170", 0.15]], life);
        const shape = new Path2D();
        fragment.outline.forEach(([ox, oy], index) => (index ? shape.lineTo(ox, oy) : shape.moveTo(ox, oy)));
        shape.closePath();
        context.save();
        context.translate(px, py);
        context.rotate(rot);
        const fill = context.createRadialGradient(-fragment.size * 0.25, -fragment.size * 0.15, 0, 0, 0, fragment.size * 1.5);
        fill.addColorStop(0, `rgba(246,255,248,${(0.95 * life).toFixed(3)})`);
        fill.addColorStop(0.45, `rgba(196,244,212,${(0.85 * life).toFixed(3)})`);
        fill.addColorStop(1, `rgba(104,176,130,${(0.75 * life).toFixed(3)})`);
        context.fillStyle = fill;
        context.fill(shape);
        context.lineJoin = "miter";
        context.strokeStyle = `rgba(6,26,15,${(0.7 * life).toFixed(3)})`;
        context.lineWidth = fragment.main ? 1.7 : 1.3;
        context.stroke(shape);
        context.restore();
      }
    };
    mount(canvas, ms);
    drive(canvas, ms, draw);
  }

  function track(animation: Animation) {
    running.add(animation);
    animation.finished.then(
      () => running.delete(animation),
      () => running.delete(animation),
    );
    return animation;
  }

  return {
    play(fx) {
      serial += 1;
      switch (fx.name) {
        case "crack":
          if (!reducedMotion) crack(fx.x ?? 50, fx.y ?? 50);
          break;
        case "glint":
          if (!reducedMotion) glint(fx.x ?? 50, fx.y ?? 38);
          break;
        case "sparkle":
          if (!reducedMotion) sparkle(fx.x ?? 50, fx.y ?? 45);
          break;
        case "ink":
          ink();
          break;
        case "heartbeat":
          heartbeat();
          break;
        case "comet":
          if (!reducedMotion) comet(fx.x ?? 50, fx.y ?? 40);
          break;
        case "hair":
          if (!reducedMotion) hair();
          break;
        case "tumble":
          tumble();
          break;
        case "stomp":
          stomp();
          break;
        case "lightning":
          lightning(fx.x ?? 58, fx.y ?? 58);
          break;
        case "frost":
          frost();
          break;
        case "radiance":
          radiance(fx.x ?? 50, fx.y ?? 45);
          break;
        case "wandlight":
          wand(fx.x ?? 50, fx.y ?? 55, false);
          break;
        case "wandfail":
          wand(fx.x ?? 50, fx.y ?? 55, true);
          break;
        case "thread":
          thread(fx.x ?? 34, fx.y ?? 30, fx.x2 ?? 66, fx.y2 ?? 30);
          break;
        case "dome":
          dome(fx.x ?? 50, fx.y ?? 55, fx.r ?? 22);
          break;
        case "transform":
          transform(fx.x ?? 50, fx.y ?? 55);
          break;
        case "warmth":
          warmth(fx.x ?? 50, fx.y ?? 60);
          break;
        case "splat":
          splat(fx.x ?? 50, fx.y ?? 45);
          break;
        case "wail":
          wail(fx.x ?? 50, fx.y ?? 40);
          break;
        case "binding":
          binding(fx.x ?? 50, fx.y ?? 42);
          break;
        case "fracture":
          fracture(fx.x ?? 50, fx.y ?? 45);
          break;
      }
    },
    clear() {
      for (const cleanup of [...cleanups]) cleanup();
      cleanups.clear();
      layer.replaceChildren();
      for (const animation of running) animation.cancel();
      running.clear();
    },
  };
}

/** Styles for the effects above; part of the player stylesheet. */
export const SCREEN_FX_STYLE = String.raw`
.sfx-comet{inset:0}
.sfx-comet .ball,.sfx-comet .trail{position:absolute;left:0;top:0;offset-rotate:0deg;offset-distance:0%}
.sfx-comet .ball{width:3.2cqh;height:3.2cqh;filter:drop-shadow(0 0 .9cqh #ffd76a) drop-shadow(0 0 2.2cqh #ffb42e88)}
.sfx-comet .orb{position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle at 34% 30%,#fffbe2 0 12%,#ffe07a 30%,#e3a92c 66%,#9a6612 100%)}
.sfx-comet .trail{width:calc(2.8cqh*var(--k));height:calc(2.8cqh*var(--k));translate:calc(1.6cqh - 1.4cqh*var(--k)) calc(1.6cqh - 1.4cqh*var(--k));border-radius:50%;background:radial-gradient(circle,#fff6d0,#ffd46acc 40%,transparent 72%);opacity:var(--k);mix-blend-mode:screen}
.sfx-hair g{will-change:transform}
.screen-fx{position:absolute;inset:0;z-index:5;pointer-events:none;overflow:hidden}
.sfx{position:absolute;pointer-events:none}
svg.sfx{inset:0;width:100%;height:100%}
.sfx-crack .edge{fill:none;stroke:#f4f8ff;stroke-opacity:.92;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1;animation:sfx-draw var(--t,.2s) var(--at,0s) both cubic-bezier(.25,.6,.35,1)}
.sfx-crack .edge.shadow{stroke:#05070c;stroke-opacity:.5}
.sfx-crack .edge.is-drawn{stroke-dashoffset:0;animation:none}
.sfx-crack .p1{animation:sfx-hide 1ms 1.72s both}
.sfx-crack .p2{animation:sfx-show 1ms 1.72s both}
.sfx-crack .impact{transform-box:fill-box;transform-origin:50% 50%;animation:sfx-impact .5s both ease-out}
.sfx-crack .shard{transform-box:fill-box;transform-origin:50% 50%;animation:sfx-fall var(--t,.9s) var(--at,1.8s) both cubic-bezier(.55,0,.85,.55)}
@keyframes sfx-draw{to{stroke-dashoffset:0}}
@keyframes sfx-hide{from{opacity:1}to{opacity:0}}
@keyframes sfx-show{from{opacity:0}to{opacity:1}}
@keyframes sfx-impact{from{opacity:0;transform:scale(.3)}20%{opacity:1}to{opacity:0;transform:scale(1.4)}}
@keyframes sfx-fall{from{transform:none;opacity:1}25%{opacity:1}to{transform:translate(var(--dx),var(--dy)) rotate(var(--r));opacity:0}}
.sfx-glint{width:30cqh;height:30cqh;translate:-50% -50%;mix-blend-mode:screen}
.sfx-glint .star{position:absolute;inset:25%;width:50%;height:50%;filter:drop-shadow(0 0 1cqh #fff) drop-shadow(0 0 2.4cqh #ffe7a8);animation:sfx-star .7s both cubic-bezier(.2,.7,.3,1)}
.sfx-glint .bloom{position:absolute;inset:30%;border-radius:50%;background:radial-gradient(circle,#ffffffee,#fff2c855 40%,transparent 70%);animation:sfx-bloom .7s both ease-out}
.sfx-glint .streak-h,.sfx-glint .streak-v{position:absolute;left:50%;top:50%;border-radius:50%;background:linear-gradient(90deg,transparent,#fffdf4 50%,transparent)}
.sfx-glint .streak-h{width:170%;height:.5cqh;translate:-50% -50%;animation:sfx-streak .62s both cubic-bezier(.2,.8,.3,1)}
.sfx-glint .streak-v{width:90%;height:.4cqh;translate:-50% -50%;rotate:90deg;animation:sfx-streak .55s .04s both cubic-bezier(.2,.8,.3,1)}
@keyframes sfx-star{from{opacity:0;transform:scale(0) rotate(-30deg)}30%{opacity:1;transform:scale(1.15) rotate(10deg)}60%{opacity:.9;transform:scale(.7) rotate(30deg)}to{opacity:0;transform:scale(0) rotate(50deg)}}
@keyframes sfx-bloom{from{opacity:0;transform:scale(.2)}25%{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(1.3)}}
@keyframes sfx-streak{from{opacity:0;transform:scaleX(0)}30%{opacity:1;transform:scaleX(1)}to{opacity:0;transform:scaleX(.15)}}
.sfx-sparkle{width:0;height:0}
.sfx-sparkle .burst{position:absolute;left:0;top:0;width:16cqh;height:16cqh;translate:-50% -50%;border-radius:50%;background:radial-gradient(circle,#fff8dccc,#ffd36b55 35%,transparent 70%);mix-blend-mode:screen;animation:sfx-bloom .6s both ease-out}
.sfx-sparkle b{position:absolute;left:0;top:0;width:var(--s);height:var(--s);background:url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="${SVG}" viewBox="0 0 100 100"><defs><radialGradient id="g"><stop offset="0" stop-color="#fffdf0"/><stop offset=".5" stop-color="#ffd76e"/><stop offset="1" stop-color="#e9a530"/></radialGradient></defs><path d="${STAR}" fill="url(#g)"/></svg>`)}") center/contain no-repeat;filter:drop-shadow(0 0 .5cqh #ffcf5a);opacity:0;animation:sfx-spark var(--t) var(--at) both cubic-bezier(.15,.75,.35,1)}
.sfx-sparkle b.pale{filter:drop-shadow(0 0 .5cqh #fff3c0) brightness(1.25) saturate(.5)}
@keyframes sfx-spark{from{opacity:0;transform:translate(-50%,-50%) scale(0) rotate(0)}20%{opacity:1;transform:translate(calc(-50% + var(--dx)*.35),calc(-50% + var(--dy)*.35)) scale(1) rotate(calc(var(--r)*.3))}70%{opacity:.85}to{opacity:0;transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy) + 4cqh)) scale(.25) rotate(var(--r))}}
.sfx-ink .blot{fill:#07030b;fill-opacity:.94;transform-box:fill-box;transform-origin:50% 50%;animation:sfx-blot 3s var(--at,0s) both}
.sfx-ink .shade{fill:#050208;animation:sfx-ink-shade 3s both ease-in-out}
@keyframes sfx-blot{from{transform:scale(.15);opacity:0}12%{opacity:1}38%{transform:scale(1)}62%{transform:scale(1.04);opacity:1}to{transform:scale(.3);opacity:0}}
@keyframes sfx-ink-shade{from{opacity:0}35%,60%{opacity:.32}to{opacity:0}}
.sfx-heartbeat{inset:0;background:radial-gradient(ellipse at 50% 50%,transparent 34%,#3d000a99 70%,#110003f0 100%);opacity:0;animation:sfx-heart 1.2s both}
@keyframes sfx-heart{from{opacity:0}9%{opacity:.85}26%{opacity:.25}40%{opacity:1}72%{opacity:.3}to{opacity:0}}
.sfx-lightning-flash{inset:0;background:radial-gradient(ellipse 70% 90% at var(--x) var(--y),#f4f8ff 0,#c9dbff 35%,#9fbcff 100%);mix-blend-mode:screen;opacity:0;animation:sfx-lightning-flash 1.1s both}
.sfx-lightning-flash.is-dim{animation-name:sfx-lightning-dim}
@keyframes sfx-lightning-flash{from{opacity:0}3%{opacity:.82}9%{opacity:.12}15%{opacity:.62}24%{opacity:.18}55%{opacity:.05}to{opacity:0}}
@keyframes sfx-lightning-dim{from{opacity:0}6%{opacity:.28}to{opacity:0}}
.sfx-lightning{opacity:0;animation:sfx-bolt 1.1s both}
@keyframes sfx-bolt{from{opacity:0}2%{opacity:1}9%{opacity:.22}15%{opacity:1}30%{opacity:.85}55%{opacity:0}to{opacity:0}}
.sfx-frost{inset:0;width:100%;height:100%;-webkit-mask:radial-gradient(ellipse 50% 50% at 50% 50%,transparent 58%,#000 92%) center/260% 260% no-repeat;mask:radial-gradient(ellipse 50% 50% at 50% 50%,transparent 58%,#000 92%) center/260% 260% no-repeat;animation:sfx-frost 4.6s both}
@keyframes sfx-frost{from{-webkit-mask-size:260% 260%;mask-size:260% 260%;opacity:1}55%{-webkit-mask-size:100% 100%;mask-size:100% 100%;animation-timing-function:linear}80%{-webkit-mask-size:100% 100%;mask-size:100% 100%;opacity:1;animation-timing-function:ease-in}to{-webkit-mask-size:150% 150%;mask-size:150% 150%;opacity:0}}
.sfx-frost.is-still{animation-name:sfx-frost-still}
@keyframes sfx-frost-still{from,to{-webkit-mask-size:100% 100%;mask-size:100% 100%}from{opacity:0}20%,80%{opacity:1}to{opacity:0}}
.sfx-radiance-wash{inset:0;background:radial-gradient(ellipse 60% 75% at var(--x) var(--y),#ffffff 0,#e3eeff 30%,#a9c6ff80 62%,transparent 100%);mix-blend-mode:screen;opacity:0;animation:sfx-radiance-wash 3.4s both}
@keyframes sfx-radiance-wash{from{opacity:0}10%{opacity:.95}22%{opacity:.6}55%{opacity:.32}to{opacity:0}}
.sfx-radiance{width:0;height:0;mix-blend-mode:screen}
.sfx-radiance .core{position:absolute;left:0;top:0;width:38cqh;height:38cqh;translate:-50% -50%;border-radius:50%;background:radial-gradient(circle,#fff 0,#fff 12%,#e8f1ffdd 30%,#a8c8ff66 55%,transparent 72%);animation:sfx-radiance-core 3.4s both cubic-bezier(.2,.7,.3,1)}
@keyframes sfx-radiance-core{from{opacity:0;transform:scale(.05)}12%{opacity:1;transform:scale(1.35)}30%{transform:scale(1.05)}70%{opacity:.8;transform:scale(1.15)}to{opacity:0;transform:scale(1.6)}}
.sfx-radiance .rays{position:absolute;left:0;top:0;animation:sfx-radiance-turn 3.4s both linear}
.sfx-radiance .rays i{position:absolute;left:0;top:0;width:var(--l);height:var(--w);translate:0 -50%;transform-origin:0 50%;rotate:var(--a);border-radius:50%;background:linear-gradient(90deg,#ffffffcc,#e4eeff70 18%,#cfe0ff26 45%,transparent 75%);filter:blur(.45cqh);opacity:0;animation:sfx-radiance-ray 2.6s var(--at) both ease-out}
@keyframes sfx-radiance-turn{from{rotate:0deg}to{rotate:24deg}}
@keyframes sfx-radiance-ray{from{opacity:0;scale:.1 1}18%{opacity:.7;scale:1 1}60%{opacity:.3}to{opacity:0;scale:1.15 1}}
.sfx-radiance .ring{position:absolute;left:0;top:0;width:24cqh;height:24cqh;translate:-50% -50%;border-radius:50%;box-shadow:0 0 0 .18cqh #f2f7ffaa,0 0 2.4cqh .5cqh #b9d2ff66,inset 0 0 2.4cqh .5cqh #b9d2ff44;filter:blur(.15cqh);opacity:0;animation:sfx-radiance-ring 1.6s .12s both cubic-bezier(.15,.6,.3,1)}
.sfx-radiance .ring.late{animation-delay:.42s;animation-duration:1.9s}
@keyframes sfx-radiance-ring{from{opacity:0;transform:scale(.2)}12%{opacity:.85}to{opacity:0;transform:scale(9)}}
.sfx-radiance b{position:absolute;left:0;top:0;width:var(--s);height:var(--s);border-radius:50%;background:radial-gradient(circle,#fff,#dce9ffbb 45%,transparent 72%);box-shadow:0 0 1cqh #cfe0ff;opacity:0;animation:sfx-radiance-mote var(--t) var(--at) both cubic-bezier(.2,.6,.35,1)}
@keyframes sfx-radiance-mote{from{opacity:0;transform:translate(-50%,-50%)}18%{opacity:1}to{opacity:0;transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy)))}}
.sfx-wand{width:0;height:0;mix-blend-mode:screen;animation:sfx-wand-life 3.2s both}
.sfx-wand .halo{position:absolute;left:0;top:0;width:16cqh;height:16cqh;translate:-50% -50%;border-radius:50%;background:radial-gradient(circle,#ffffffcc 0,#e3eeff88 22%,#9fc0ff33 50%,transparent 70%);animation:sfx-wand-flicker 1.3s infinite steps(1)}
.sfx-wand .core{position:absolute;left:0;top:0;width:2.4cqh;height:2.4cqh;translate:-50% -50%;border-radius:50%;background:radial-gradient(circle,#fff 30%,#e9f2ff 60%,transparent 72%);box-shadow:0 0 1.2cqh .4cqh #ffffffcc,0 0 3cqh 1cqh #b4ceff88;animation:sfx-wand-core 1.3s infinite ease-in-out}
@keyframes sfx-wand-life{from{opacity:0;transform:scale(.3)}7%{opacity:1;transform:scale(1.25)}14%{transform:scale(1)}78%{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.2)}}
@keyframes sfx-wand-flicker{0%{opacity:1;scale:1}11%{opacity:.82;scale:.96}23%{opacity:.95;scale:1.03}37%{opacity:.7;scale:.93}49%{opacity:1;scale:1.05}61%{opacity:.86;scale:.98}74%{opacity:.76;scale:.95}88%{opacity:.97;scale:1.02}}
@keyframes sfx-wand-core{0%,100%{scale:1}50%{scale:.88}}
.sfx-wand.is-failing{animation:sfx-wand-fail 1.7s both}
.sfx-wand.is-failing .halo{animation:sfx-wand-sputter 1.7s both steps(1)}
@keyframes sfx-wand-fail{from{opacity:0;transform:scale(.3)}6%{opacity:1;transform:scale(1.3)}14%{transform:scale(1)}45%{opacity:.85;transform:scale(.8)}75%{opacity:.4;transform:scale(.45)}to{opacity:0;transform:scale(.05)}}
@keyframes sfx-wand-sputter{0%{opacity:1}18%{opacity:.55}24%{opacity:.95}33%{opacity:.25}38%{opacity:.8}47%{opacity:.15}52%{opacity:.6}61%{opacity:.1}66%{opacity:.4}74%{opacity:.05}80%{opacity:.25}88%,100%{opacity:0}}
.sfx-wand b{position:absolute;left:0;top:0;width:.5cqh;height:.5cqh;border-radius:50%;background:#f4f8ff;box-shadow:0 0 .8cqh #bcd3ff;opacity:0;animation:sfx-wand-spark var(--t) var(--at) both cubic-bezier(.4,0,.9,.6)}
@keyframes sfx-wand-spark{from{opacity:0;transform:translate(-50%,-50%)}15%{opacity:1}to{opacity:0;transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy)))}}
.sfx-wand.is-still .halo,.sfx-wand.is-still .core{animation:none}
.sfx-thread-shade{inset:0;background:radial-gradient(ellipse 70% 80% at var(--x) var(--y),transparent 28%,#03050c99 68%,#000000e6 100%);opacity:0;animation:sfx-thread-shade 2.4s both}
@keyframes sfx-thread-shade{from{opacity:0;animation-timing-function:ease-out}12.5%{opacity:1}75%{opacity:1;animation-timing-function:ease-in-out}to{opacity:0}}
.sfx-thread path{fill:none;stroke-linecap:round;stroke-linejoin:round}
.sfx-thread .spark{fill:#fff;filter:drop-shadow(0 0 3px #cfe0ff)}
.sfx-thread.is-still .core{stroke:#e6eeff;opacity:0;animation:sfx-thread-still 2.4s both}
@keyframes sfx-thread-still{from,8%{opacity:0}20%,70%{opacity:.85}to{opacity:0}}
.sfx-thread-flash{inset:0;background:radial-gradient(circle 15cqh at var(--x) var(--y),#fff 0,#f2f6ffcc 14%,#c9d9ff40 42%,transparent 100%);mix-blend-mode:screen;opacity:0;animation:sfx-thread-flash 2.4s both}
@keyframes sfx-thread-flash{from,74.2%{opacity:0}75.4%{opacity:1}79%{opacity:.45}86%,to{opacity:0}}
canvas.sfx-canvas{inset:0;width:100%;height:100%}
.sfx-transform-still{inset:0;background:radial-gradient(ellipse 14% 46% at var(--x) var(--y),#060509f2 0,#060509d9 45%,#06050966 75%,transparent 100%);opacity:0;animation:sfx-transform-still 2.8s both}
@keyframes sfx-transform-still{from{opacity:0;animation-timing-function:ease-in-out}46%,56%{opacity:1;animation-timing-function:ease-in-out}to{opacity:0}}
.sfx-warmth{inset:0}
.sfx-warmth i{position:absolute;pointer-events:none}
.sfx-warmth .grade{inset:0;-webkit-backdrop-filter:sepia(.3) saturate(1.12) brightness(1.03);backdrop-filter:sepia(.3) saturate(1.12) brightness(1.03);opacity:0;animation:sfx-warm-grade 3.6s both}
@keyframes sfx-warm-grade{from,9%{opacity:0;animation-timing-function:ease-in-out}50%,72%{opacity:1;animation-timing-function:ease-in-out}to{opacity:0}}
.sfx-warmth .haze{left:var(--x);top:var(--y);width:280cqw;height:280cqw;translate:-50% -50%;border-radius:50%;-webkit-backdrop-filter:sepia(.36) saturate(1.18) brightness(1.06);backdrop-filter:sepia(.36) saturate(1.18) brightness(1.06);-webkit-mask:radial-gradient(circle,#000 0,#000c 22%,#0006 42%,transparent 62%);mask:radial-gradient(circle,#000 0,#000c 22%,#0006 42%,transparent 62%);opacity:0;animation:sfx-warm-haze 3.6s both}
@keyframes sfx-warm-haze{from{opacity:0;transform:scale(.02)}8%{opacity:1;transform:scale(.05);animation-timing-function:cubic-bezier(.3,.45,.4,1)}53%{opacity:1;transform:scale(1)}72%{opacity:.9;transform:scale(1.03);animation-timing-function:ease-in}to{opacity:0;transform:scale(1.06)}}
.sfx-warmth .light{left:var(--x);top:var(--y);width:280cqw;height:280cqw;translate:-50% -50%;border-radius:50%;background:radial-gradient(circle,#ffbe7a1c 0,#ffae6010 12%,#ff9c4a06 26%,transparent 40%);opacity:0;animation:sfx-warm-haze 3.6s both}
.sfx-warmth .glow{left:var(--x);top:var(--y);width:56cqh;height:56cqh;translate:-50% -50%;border-radius:50%;background:radial-gradient(circle,#ffd08acc 0,#ffaa5a66 26%,#ff8a3a22 52%,transparent 70%);mix-blend-mode:screen;opacity:0;animation:sfx-warm-glow 3.6s both}
@keyframes sfx-warm-glow{from{opacity:0;transform:scale(.2)}11%{opacity:1;transform:scale(1.1)}18%{transform:scale(1)}74%{opacity:.85;transform:scale(1.05)}to{opacity:0;transform:scale(.9)}}
.sfx-warmth .ember{left:var(--x);top:var(--y);width:3cqh;height:3cqh;translate:-50% -50%;border-radius:50%;background:radial-gradient(circle,#fff5d8 0,#ffd07a 32%,#ff9433 62%,transparent 72%);box-shadow:0 0 1.6cqh .5cqh #ff9a3caa,0 0 5cqh 1.6cqh #ff7a2a55;opacity:0;animation:sfx-warm-ember 3.6s both}
@keyframes sfx-warm-ember{from{opacity:0;transform:scale(.1)}11%{opacity:1;transform:scale(1.2)}17%{transform:scale(1)}76%{opacity:.95;transform:scale(1)}to{opacity:0;transform:scale(.7)}}
.sfx-warmth .shimmer{position:absolute;inset:0;width:100%;height:100%;mix-blend-mode:screen}
.sfx-warmth .strand{fill:none;stroke:#ffe1b0;stroke-linecap:round;opacity:0;transform-box:fill-box;transform-origin:50% 100%;animation:sfx-warm-rise var(--t) var(--at) both ease-out}
@keyframes sfx-warm-rise{from{opacity:0;transform:translateY(40px) skewX(0)}30%{opacity:var(--o);transform:translateY(-20px) skewX(4deg)}65%{opacity:calc(var(--o)*.7);transform:translateY(-90px) skewX(-4deg)}to{opacity:0;transform:translateY(-170px) skewX(2deg)}}
.sfx-warmth b{position:absolute;left:var(--x);top:var(--y);width:var(--s);height:var(--s);border-radius:50%;background:radial-gradient(circle,#fff0c8,#ffb45acc 50%,transparent 72%);box-shadow:0 0 .8cqh #ff9a3c;opacity:0;animation:sfx-warm-mote var(--t) var(--at) both cubic-bezier(.3,.5,.5,1)}
@keyframes sfx-warm-mote{from{opacity:0;transform:translate(calc(-50% + var(--ox)),-50%)}25%{opacity:.85}to{opacity:0;transform:translate(calc(-50% + var(--ox) + var(--dx)),calc(-50% + var(--dy)))}}
.sfx-warmth.is-still .grade,.sfx-warmth.is-still .haze,.sfx-warmth.is-still .light,.sfx-warmth.is-still .glow,.sfx-warmth.is-still .ember{animation-name:sfx-warm-still}
.sfx-warmth.is-still .grade{--o:1}.sfx-warmth.is-still .haze,.sfx-warmth.is-still .light{--o:.9}.sfx-warmth.is-still .glow{--o:.85}.sfx-warmth.is-still .ember{--o:.95}
@keyframes sfx-warm-still{from{opacity:0}18%,74%{opacity:var(--o)}to{opacity:0}}
.sfx-splat.is-still{animation:sfx-splat-still 2s both}
@keyframes sfx-splat-still{from{opacity:0}10%,70%{opacity:1}to{opacity:0}}
.sfx-wail{mix-blend-mode:screen}
.sfx-wail path{fill:none;stroke:#e6eeff;stroke-linejoin:round}
.sfx-wail-edge{inset:0;background:radial-gradient(ellipse 72% 72% at 50% 50%,transparent 40%,#cfe2ff4d 68%,#eef5ffcc 100%);mix-blend-mode:screen;opacity:0;animation:sfx-wail-edge 1.6s both}
@keyframes sfx-wail-edge{from{opacity:0}5%{opacity:.75}10%{opacity:.25}16%{opacity:.6}26%{opacity:.15}40%{opacity:.35}to{opacity:0}}
.sfx-wail-edge.is-still{animation-name:sfx-wail-still}
@keyframes sfx-wail-still{from{opacity:0}15%{opacity:.7}to{opacity:0}}
@media(prefers-reduced-motion:reduce){.sfx-ink .blot{animation-name:sfx-ink-shade}}
`;
