/**
 * Expression morphing. Instead of cross-dissolving two portraits (which shows two pairs of
 * brows and two mouths for a moment), both faces are warped on a shared triangle mesh toward
 * the same moving geometry while their colors blend. Features stay aligned, so brows lower,
 * eyelids narrow and lips reshape as one face. Facial regions are staggered the way real
 * expressions change: brows lead, eyes follow, the mouth settles last.
 *
 * Landmarks come from each pose's animation manifest: its `morph` block when present
 * (lips, eyelids, irises, brows), otherwise the mouth and eyelid meshes every rigged pose has.
 * Portraits without rig data get a cascading dissolve that sweeps down the face.
 */
import type { Pose } from "../engine/types";

type Point = [number, number];
type Group = "brows" | "eyes" | "irises" | "mouth" | "lips";
export interface FaceLandmarks {
  width: number;
  height: number;
  groups: Partial<Record<Group, Point[]>>;
}

/** When each region starts and finishes changing, as fractions of the morph. */
const TIMING: Record<Group, [number, number]> = {
  brows: [0, 0.55],
  eyes: [0.08, 0.66],
  irises: [0.08, 0.66],
  mouth: [0.3, 1],
  lips: [0.3, 1],
};
export const MORPH_MS = 640;
/** The face as a whole moves (when two portraits frame it differently) over most of the morph. */
const HEAD: [number, number] = [0, 0.85];

const manifests = new Map<string, Promise<Record<string, unknown> | null>>();
const smoother = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const progress = ([start, end]: [number, number], t: number) =>
  smoother((t - start) / (end - start));

/** Reads corresponding facial landmarks of a rigged pose, in its source pixels. */
export function loadLandmarks(
  pose: Pose,
  resolveAsset: (src: string) => string,
): Promise<FaceLandmarks | null> {
  const animation = pose.animation;
  if (!animation) return Promise.resolve(null);
  let manifest = manifests.get(animation.manifestUrl);
  if (!manifest) {
    manifest = fetch(resolveAsset(animation.manifestUrl))
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
    manifests.set(animation.manifestUrl, manifest);
  }
  return manifest.then((data) => {
    const sprites = (data as { sprites?: Record<string, SpriteData> } | null)?.sprites;
    const sprite = sprites?.[animation.poseKey];
    return sprite ? landmarksOf(sprite) : null;
  });
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface SpriteData {
  sourceWidth: number;
  sourceHeight: number;
  mouth?: Rect;
  frames?: Record<string, { landmarks?: Point[] }>;
  blink?: {
    eyes?: {
      rect: Rect;
      apertureIndices?: number[];
      frames?: { closure: number; landmarks?: Point[] }[];
    }[];
  };
  morph?: {
    mouth?: { outer: Point[]; inner: Point[]; center: Point };
    eyes?: { aperture: Point[]; iris: Point }[];
    brows?: Point[][];
  };
}

export function landmarksOf(sprite: SpriteData): FaceLandmarks | null {
  const groups: FaceLandmarks["groups"] = {};
  const morph = sprite.morph;
  // The outer lips and mouth center; the inner lip line is separate because a closed mouth
  // draws it so thin that it is the first thing a mesh cannot follow.
  if (morph?.mouth) {
    groups.mouth = [...morph.mouth.outer, morph.mouth.center];
    groups.lips = morph.mouth.inner;
  } else if (sprite.mouth && sprite.frames?.X?.landmarks?.length === 25) {
    const { x, y, width, height } = sprite.mouth;
    const points = sprite.frames.X.landmarks
      .slice(8)
      .map(([u, v]) => [x + u * width, y + v * height] as Point);
    groups.mouth = [...points.slice(0, 8), points[16]];
    groups.lips = points.slice(8, 16);
  }
  if (morph?.eyes && [1, 2].includes(morph.eyes.length)) {
    groups.eyes = morph.eyes.flatMap((eye) => eye.aperture);
    groups.irises = morph.eyes.map((eye) => eye.iris);
  } else if (sprite.blink?.eyes && [1, 2].includes(sprite.blink.eyes.length)) {
    const eyes = sprite.blink.eyes.map((eye) => {
      const open = eye.frames?.find((frame) => frame.closure === 0)?.landmarks;
      const indices = eye.apertureIndices;
      if (!open || indices?.length !== 8) return null;
      return indices.map(
        (i) => [eye.rect.x + open[i][0] * eye.rect.width, eye.rect.y + open[i][1] * eye.rect.height] as Point,
      );
    });
    if (eyes.every(Boolean)) groups.eyes = eyes.flat() as Point[];
  }
  if (
    morph?.brows && [1, 2].includes(morph.brows.length) &&
    morph.brows.every((brow) => brow.length >= 3 && brow.length === morph.brows![0].length)
  )
    groups.brows = morph.brows.flat();
  return Object.keys(groups).length
    ? { width: sprite.sourceWidth, height: sprite.sourceHeight, groups }
    : null;
}

/* ---------- geometry ---------- */

/** Bowyer–Watson Delaunay triangulation; the point counts here are tiny. */
function triangulate(points: Point[]): [number, number, number][] {
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const size = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) * 10 + 10;
  const all: Point[] = [
    ...points,
    [minX - size, minY - size],
    [minX + size * 2, minY - size],
    [minX - size, minY + size * 2],
  ];
  const n = points.length;
  type Tri = { v: [number, number, number]; cx: number; cy: number; r2: number };
  const circle = (v: [number, number, number]): Tri => {
    const [ax, ay] = all[v[0]], [bx, by] = all[v[1]], [cx, cy] = all[v[2]];
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)) || 1e-9;
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    return { v, cx: ux, cy: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 };
  };
  let triangles: Tri[] = [circle([n, n + 1, n + 2])];
  for (let i = 0; i < n; i++) {
    const [px, py] = all[i];
    const bad = triangles.filter((t) => (px - t.cx) ** 2 + (py - t.cy) ** 2 < t.r2 - 1e-7);
    const edges = new Map<string, [number, number]>();
    for (const t of bad)
      for (const [a, b] of [[t.v[0], t.v[1]], [t.v[1], t.v[2]], [t.v[2], t.v[0]]] as [number, number][]) {
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        if (edges.has(key)) edges.delete(key);
        else edges.set(key, [a, b]);
      }
    triangles = triangles.filter((t) => !bad.includes(t));
    for (const [a, b] of edges.values()) triangles.push(circle([a, b, i]));
  }
  return triangles.filter((t) => t.v.every((i) => i < n)).map((t) => t.v);
}

const area = (p: Point[], [a, b, c]: [number, number, number]) =>
  (p[b][0] - p[a][0]) * (p[c][1] - p[a][1]) - (p[c][0] - p[a][0]) * (p[b][1] - p[a][1]);

/** The affine transform mapping triangle s onto triangle d, as canvas setTransform arguments. */
function affine(s: Point[], d: Point[]): [number, number, number, number, number, number] | null {
  const [[x0, y0], [x1, y1], [x2, y2]] = s;
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(det) < 1e-6) return null;
  const [[u0, v0], [u1, v1], [u2, v2]] = d;
  const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det;
  const c = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / det;
  const b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / det;
  const dd = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / det;
  return [a, b, c, dd, u0 - a * x0 - c * y0, v0 - b * x0 - dd * y0];
}

/* ---------- capture ---------- */

/** Where a contain-fitted portrait of the given size sits inside a box. */
function containBox(width: number, height: number, boxWidth: number, boxHeight: number) {
  const scale = Math.min(boxWidth / width, boxHeight / height);
  return { scale, x: (boxWidth - width * scale) / 2, y: (boxHeight - height * scale) / 2 };
}

/** What a face element shows right now (its live rig canvas, or its portrait image). */
export function captureFace(
  face: HTMLElement,
  width: number,
  height: number,
  ratio: number,
  into = document.createElement("canvas"),
): HTMLCanvasElement {
  const out = into;
  const w = Math.max(1, Math.round(width * ratio)), h = Math.max(1, Math.round(height * ratio));
  if (out.width !== w || out.height !== h) {
    out.width = w;
    out.height = h;
  }
  const context = out.getContext("2d")!;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const canvas = face.querySelector<HTMLCanvasElement>(".vne-portrait-canvas");
  const image = face.querySelector<HTMLImageElement>(".vne-portrait-image");
  if (canvas && canvas.style.visibility === "visible" && canvas.width > 0)
    context.drawImage(canvas, canvas.offsetLeft, canvas.offsetTop, canvas.offsetWidth, canvas.offsetHeight);
  else if (image?.naturalWidth) {
    const box = containBox(image.naturalWidth, image.naturalHeight, width, height);
    context.drawImage(image, box.x, box.y, image.naturalWidth * box.scale, image.naturalHeight * box.scale);
  }
  return out;
}

/* ---------- playback ---------- */

export interface MorphRun {
  /** Resolves when the morph has finished or been cut short. */
  done: Promise<void>;
  /** Jumps to the final frame immediately. */
  finish(): void;
}

/**
 * The mesh for a morph between two faces drawn contain-fitted into a width × height box at
 * `ratio` device pixels: matching landmark groups, a fixed ring and the frame edges.
 */
export function planMorph(
  from: FaceLandmarks | null,
  to: FaceLandmarks | null,
  width: number,
  height: number,
  ratio: number,
) {
  // Landmarks in face-canvas pixels, for groups both poses define.
  const place = (marks: FaceLandmarks | null, group: Group) => {
    const points = marks?.groups[group];
    if (!marks || !points) return undefined;
    const box = containBox(marks.width, marks.height, width, height);
    return points.map(([x, y]) => [(box.x + x * box.scale) * ratio, (box.y + y * box.scale) * ratio] as Point);
  };
  const W = Math.round(width * ratio), H = Math.round(height * ratio);
  // A profile turn changes visible-eye topology; dissolve between incompatible views.
  const incompatibleViews = from?.groups.eyes && to?.groups.eyes && from.groups.eyes.length !== to.groups.eyes.length;
  const build = (groups: Group[], ringScale = 0.85) => {
    if (incompatibleViews) return null;
    const pointsA: Point[] = [], pointsB: Point[] = [], timing: ([number, number] | null)[] = [];
    for (const group of groups) {
      const a = place(from, group), b = place(to, group);
      if (!a || !b || a.length !== b.length) continue;
      pointsA.push(...a);
      pointsB.push(...b);
      a.forEach(() => timing.push(TIMING[group]));
    }
    // A ring around the face keeps the warp local. It follows the best scale-and-offset fit
    // between the two faces, so a head drawn in a different place glides there; the frame
    // edges stay put.
    if (!pointsA.length) return null;
    const centroid = (list: Point[]) =>
      list.reduce((sum, p) => [sum[0] + p[0] / list.length, sum[1] + p[1] / list.length] as Point, [0, 0] as Point);
    const spread = (list: Point[], c: Point) =>
      Math.sqrt(list.reduce((sum, p) => sum + (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2, 0) / list.length) || 1;
    // Fit the head on points expressions barely move: the eye corners when known.
    const eyesA = place(from, "eyes"), eyesB = place(to, "eyes");
    const corners = (list: Point[]) => list.filter((_, i) => i % 8 === 0 || i % 8 === 4);
    const sameEyes = eyesA && eyesB && eyesA.length === eyesB.length;
    const stableA = sameEyes ? corners(eyesA) : pointsA;
    const stableB = sameEyes ? corners(eyesB) : pointsB;
    const cA = centroid(stableA), cB = centroid(stableB);
    let scale = spread(stableB, cB) / spread(stableA, cA);
    // Same framing (only the expression differs): keep the head exactly where it is.
    const sameFraming =
      Math.abs(scale - 1) < 0.04 && Math.hypot(cB[0] - cA[0], cB[1] - cA[1]) < 0.02 * Math.max(W, H);
    if (sameFraming) scale = 1;
    const toB = (p: Point): Point =>
      sameFraming ? p : [cB[0] + (p[0] - cA[0]) * scale, cB[1] + (p[1] - cA[1]) * scale];
    const xs = pointsA.map((p) => p[0]), ys = pointsA.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const rx = (Math.max(...xs) - Math.min(...xs)) * ringScale + 20, ry = (Math.max(...ys) - Math.min(...ys)) * ringScale + 20;
    for (let k = 0; k < 16; k++) {
      const angle = (k / 16) * Math.PI * 2;
      const p: Point = [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry];
      pointsA.push(p);
      pointsB.push(toB(p));
      timing.push(HEAD);
    }
    for (const p of [[0, 0], [W / 2, 0], [W, 0], [W, H / 2], [W, H], [W / 2, H], [0, H], [0, H / 2]] as Point[]) {
      pointsA.push(p);
      pointsB.push(p);
      timing.push(null);
    }
    const middle = pointsA.map((p, i) => [(p[0] + pointsB[i][0]) / 2, (p[1] + pointsB[i][1]) / 2] as Point);
    const triangles = triangulate(middle);
    // A triangle that flips in either face would tear the image.
    const folds = triangles.some((t) => {
      const m = area(middle, t);
      return area(pointsA, t) * m <= 0 || area(pointsB, t) * m <= 0;
    });
    return folds ? null : { pointsA, pointsB, timing, triangles };
  };
  // Prefer every feature; if the faces are too different somewhere, give that region up first.
  const all = Object.keys(TIMING) as Group[];
  const without = (...drop: Group[]) => all.filter((group) => !drop.includes(group));
  const attempts: Group[][] = [
    all,
    without("lips"),
    without("brows"),
    without("brows", "lips"),
    without("irises", "lips"),
    ["eyes", "mouth"],
    ["mouth"],
    ["eyes"],
    ["brows"],
  ];
  let mesh: ReturnType<typeof build> = null;
  let used: Group[] = [];
  search: for (const groups of attempts)
    for (const ring of [0.85, 0.55, 1.2])
      if ((mesh = build(groups, ring))) {
        used = groups.filter((group) => place(from, group) && place(to, group));
        break search;
      }
  const warp = !!mesh;
  // Without a usable mesh, a fixed grid carries the downward sweep.
  const grid: Point[] = [];
  if (!warp)
    for (let gy = 0; gy <= 8; gy++)
      for (let gx = 0; gx <= 4; gx++) grid.push([(gx / 4) * W, (gy / 8) * H]);
  const triangles = mesh ? mesh.triangles : triangulate(grid);
  const timings = mesh ? mesh.timing : grid.map(() => null);
  const points = mesh ? { a: mesh.pointsA, b: mesh.pointsB } : { a: grid, b: grid };

  return { triangles, timings, points, warp, groups: used };
}

/**
 * Plays a morph on `canvas` (sized to the face box). Both faces are read every frame from their
 * live portraits, so idle motion, breathing and blinks continue through the change and areas
 * the expressions share never change at all. `from`/`to` landmarks are in source pixels.
 */
export function playMorph(options: {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  ratio: number;
  /** The face being left and the face being reached, as face-box canvases at `ratio`. */
  fromFrame: () => CanvasImageSource;
  toFrame: () => CanvasImageSource;
  from: FaceLandmarks | null;
  to: FaceLandmarks | null;
  duration?: number;
}): MorphRun {
  const { canvas, width, height, ratio } = options;
  const duration = options.duration ?? MORPH_MS;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d")!;
  const W = canvas.width, H = canvas.height;
  const plan = planMorph(options.from, options.to, width, height, ratio);
  const { triangles, timings, points, warp } = plan;
  // Visible to tests and debugging: whether the faces were warped or only dissolved.
  canvas.dataset.morph = warp ? "warp" : "dissolve";
  canvas.dataset.groups = plan.groups.join(" ");

  /** Unanchored areas change in a sweep down the face, finishing with the mouth. */
  const sweep = (p: Point) => {
    const start = 0.05 + 0.45 * Math.min(1, Math.max(0, p[1] / H));
    return [start, start + 0.5] as [number, number];
  };

  const drawTriangle = (image: CanvasImageSource, source: Point[], dest: Point[], alpha: number) => {
    const m = affine(source, dest);
    if (!m || alpha <= 0.002) return;
    const cx = (dest[0][0] + dest[1][0] + dest[2][0]) / 3, cy = (dest[0][1] + dest[1][1] + dest[2][1]) / 3;
    context.save();
    context.beginPath();
    // Grow the clip a little so neighboring triangles overlap instead of leaving hairline seams.
    dest.forEach(([x, y], i) => {
      const dx = x - cx, dy = y - cy, length = Math.hypot(dx, dy) || 1;
      const gx = x + (dx / length) * 0.8, gy = y + (dy / length) * 0.8;
      if (i) context.lineTo(gx, gy);
      else context.moveTo(gx, gy);
    });
    context.closePath();
    context.clip();
    context.globalAlpha = alpha;
    context.setTransform(...m);
    const xs = source.map((p) => p[0]), ys = source.map((p) => p[1]);
    const sx = Math.max(0, Math.floor(Math.min(...xs)) - 2), sy = Math.max(0, Math.floor(Math.min(...ys)) - 2);
    const sw = Math.min(W, Math.ceil(Math.max(...xs)) + 2) - sx, sh = Math.min(H, Math.ceil(Math.max(...ys)) + 2) - sy;
    if (sw > 0 && sh > 0) context.drawImage(image, sx, sy, sw, sh, sx, sy, sw, sh);
    context.restore();
  };

  const render = (t: number) => {
    const vertex = points.a.map((a, i) => {
      const window = timings[i] ?? sweep(a);
      const k = progress(window, t);
      const b = points.b[i];
      return { k, p: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k] as Point };
    });
    const current = vertex.map((v) => v.p);
    const fromImage = options.fromFrame();
    const target = options.toFrame();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.clearRect(0, 0, W, H);
    // The old face as it moves, then the new one fading in on the same geometry.
    context.drawImage(fromImage, 0, 0);
    for (const tri of triangles) {
      const dest = tri.map((i) => current[i]);
      drawTriangle(fromImage, tri.map((i) => points.a[i]), dest, 1);
    }
    for (const tri of triangles) {
      const dest = tri.map((i) => current[i]);
      const alpha = (vertex[tri[0]].k + vertex[tri[1]].k + vertex[tri[2]].k) / 3;
      drawTriangle(target, tri.map((i) => points.b[i]), dest, alpha);
    }
  };

  let frame = 0;
  let settle: () => void = () => undefined;
  const done = new Promise<void>((resolve) => (settle = resolve));
  let finished = false;
  const started = performance.now();
  const finish = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    render(1);
    settle();
  };
  const tick = () => {
    if (finished) return;
    const t = (performance.now() - started) / duration;
    if (t >= 1) return finish();
    render(t);
    frame = requestAnimationFrame(tick);
  };
  render(0);
  frame = requestAnimationFrame(tick);
  return { done, finish };
}
