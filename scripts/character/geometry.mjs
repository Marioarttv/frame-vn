/** Geometry shared by the packer and its offline validator. No image or browser dependencies. */
export const FIXED_RING = [
  [0, 0.5],
  [0, 0],
  [0.5, 0],
  [1, 0],
  [1, 0.5],
  [1, 1],
  [0.5, 1],
  [0, 1],
];
export const rectObject = (rect) => ({
  x: Math.round(rect[0]),
  y: Math.round(rect[1]),
  width: Math.round(rect[2]),
  height: Math.round(rect[3]),
});
export const normalizePoints = (points, rect) =>
  points.map(([x, y]) => [(x - rect[0]) / rect[2], (y - rect[1]) / rect[3]]);
export const denormalizePoints = (points, rect) =>
  points.map(([x, y]) => [rect[0] + x * rect[2], rect[1] + y * rect[3]]);
export const triangleArea = (points, [a, b, c]) =>
  ((points[b][0] - points[a][0]) * (points[c][1] - points[a][1]) -
    (points[b][1] - points[a][1]) * (points[c][0] - points[a][0])) /
  2;

/** The signed area is quadratic during linear interpolation; inspect its exact minimum. */
export function minimumTransitionArea(from, to, triangle) {
  const c = triangleArea(from, triangle),
    end = triangleArea(to, triangle);
  const middle = triangleArea(
    from.map((p, i) => [(p[0] + to[i][0]) / 2, (p[1] + to[i][1]) / 2]),
    triangle,
  );
  const a = 2 * (end + c - 2 * middle),
    b = end - c - a;
  const at = a > 0 ? -b / (2 * a) : -1;
  return Math.min(
    c,
    end,
    at > 0 && at < 1 ? a * at * at + b * at + c : Infinity,
  );
}

export function assertTransitions(frames, triangles, label, allPairs = false) {
  for (const [index, points] of frames.entries()) {
    if (!points.every((p) => p.length === 2 && p.every(Number.isFinite)))
      throw new Error(`${label}: non-finite landmark in frame ${index}.`);
    for (const triangle of triangles)
      if (triangleArea(points, triangle) <= 1e-8)
        throw new Error(
          `${label}: folded or degenerate triangle ${triangle.join("/")} in frame ${index}. Recalibrate the feature contours.`,
        );
  }
  for (let a = 0; a < frames.length; a++)
    for (
      let b = a + 1;
      b < (allPairs ? frames.length : Math.min(frames.length, a + 2));
      b++
    ) {
      for (const triangle of triangles)
        if (minimumTransitionArea(frames[a], frames[b], triangle) <= 1e-8)
          throw new Error(
            `${label}: triangle ${triangle.join("/")} folds during transition ${a}→${b}.`,
          );
    }
}

/** Choose each quad diagonal against every calibrated keyframe. */
export function ringMesh(frames, rings, center = false) {
  const triangles = [];
  for (let ring = 0; ring < rings - 1; ring++)
    for (let i = 0; i < 8; i++) {
      const a = ring * 8 + i,
        b = ring * 8 + ((i + 1) % 8),
        c = a + 8,
        d = b + 8;
      const candidates = [
        [
          [a, b, d],
          [a, d, c],
        ],
        [
          [a, b, c],
          [b, d, c],
        ],
      ];
      const score = (ts) =>
        Math.min(
          ...frames.flatMap((points) => ts.map((t) => triangleArea(points, t))),
        );
      candidates.sort((x, y) => score(y) - score(x));
      triangles.push(...candidates[0]);
    }
  const start = (rings - 1) * 8;
  if (center)
    for (let i = 0; i < 8; i++)
      triangles.push([start + i, start + ((i + 1) % 8), rings * 8]);
  else
    triangles.push(
      ...[
        [0, 1, 7],
        [1, 2, 7],
        [2, 6, 7],
        [2, 3, 6],
        [3, 5, 6],
        [3, 4, 5],
      ].map((t) => t.map((i) => start + i)),
    );
  return triangles;
}

/** Helpful draft contours, always reported as estimates by recipe validation. */
export function estimatedMouth(rect, shape) {
  const [x, y, w, h] = rect,
    cx = x + w * 0.5,
    cy = y + h * 0.49;
  const dimensions = {
    X: [0.34, 0.14, 0.28, 0.008],
    A: [0.34, 0.135, 0.275, 0.006],
    B: [0.36, 0.21, 0.285, 0.052],
    C: [0.33, 0.29, 0.255, 0.135],
    D: [0.31, 0.385, 0.245, 0.235],
    E: [0.25, 0.305, 0.165, 0.155],
    F: [0.225, 0.225, 0.1, 0.09],
  };
  const [rx, ry, innerRx, innerRy] = dimensions[shape];
  const ellipse = (a, b) =>
    Array.from({ length: 8 }, (_, i) => [
      cx - Math.cos((i * Math.PI) / 4) * w * a,
      cy - Math.sin((i * Math.PI) / 4) * h * b,
    ]);
  return {
    outer: ellipse(rx, ry),
    inner: ellipse(innerRx, innerRy),
    center: [cx, cy],
  };
}

export function mouthMeshPoints(rect, shape, calibrated) {
  const points = { ...estimatedMouth(rect, shape), ...calibrated };
  return [
    ...FIXED_RING,
    ...normalizePoints(
      [...points.outer, ...points.inner, [...points.center]],
      rect,
    ),
  ];
}

export function closedAperture(open, closure) {
  const result = open.map((p) => [...p]);
  for (const [upper, lower] of [
    [1, 7],
    [2, 6],
    [3, 5],
  ]) {
    const progress =
      closure + (upper === 2 ? 0.35 * closure * (1 - closure) : 0);
    result[upper][0] =
      open[upper][0] + (open[lower][0] - open[upper][0]) * progress;
    result[upper][1] =
      open[upper][1] + (open[lower][1] - 0.65 - open[upper][1]) * progress;
  }
  return result;
}

export function invertAffine([a, b, c, d, e, f]) {
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-10)
    throw new Error("Registration anchors are collinear or degenerate.");
  return [
    d / det,
    -b / det,
    -c / det,
    a / det,
    (c * f - d * e) / det,
    (b * e - a * f) / det,
  ];
}
export const transformPoint = (m, [x, y]) => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

function solve3(matrix, vector) {
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let c = 0; c < 3; c++) {
    let pivot = c;
    for (let r = c + 1; r < 3; r++)
      if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    if (Math.abs(a[pivot][c]) < 1e-9)
      throw new Error("Registration needs three non-collinear anchors.");
    [a[c], a[pivot]] = [a[pivot], a[c]];
    const d = a[c][c];
    for (let k = c; k < 4; k++) a[c][k] /= d;
    for (let r = 0; r < 3; r++)
      if (r !== c) {
        const f = a[r][c];
        for (let k = c; k < 4; k++) a[r][k] -= f * a[c][k];
      }
  }
  return a.map((row) => row[3]);
}

export function fitAffine(source, target) {
  if (source.length !== target.length || source.length < 3)
    throw new Error("Registration needs matching source and portrait anchors.");
  const matrix = Array.from({ length: 3 }, () => [0, 0, 0]),
    u = [0, 0, 0],
    v = [0, 0, 0];
  for (let i = 0; i < source.length; i++) {
    const row = [...source[i], 1];
    for (let a = 0; a < 3; a++) {
      u[a] += row[a] * target[i][0];
      v[a] += row[a] * target[i][1];
      for (let b = 0; b < 3; b++) matrix[a][b] += row[a] * row[b];
    }
  }
  const x = solve3(matrix, u),
    y = solve3(matrix, v),
    affine = [x[0], y[0], x[1], y[1], x[2], y[2]];
  const error = Math.sqrt(
    source.reduce((sum, p, i) => {
      const q = transformPoint(affine, p);
      return sum + (q[0] - target[i][0]) ** 2 + (q[1] - target[i][1]) ** 2;
    }, 0) / source.length,
  );
  return { affine, error };
}

export function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[j],
      [bx, by] = points[i];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax)
      inside = !inside;
  }
  return inside;
}

export function polygonDistance(x, y, points) {
  let distance = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[j],
      [bx, by] = points[i],
      dx = bx - ax,
      dy = by - ay;
    const t = Math.max(
      0,
      Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)),
    );
    distance = Math.min(distance, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return distance;
}

/**
 * Speech-shape landmarks derived from a pose's calibrated rest mouth. Every shape keeps the
 * rest contour's own topology (including an asymmetric smirk) and only opens the lips and
 * narrows rounded vowels, so interpolating between any two shapes cannot fold the mesh.
 * Openings are fractions of the mouth width; the jaw opens mostly downward.
 */
const DERIVED_SHAPES = {
  // The outer lips always open at least as far as the inner opening, so the inner contour
  // can never cross the outer one; upper lips move half as far as the inner opening.
  A: { sx: 0.98, isx: 0.98, up: 0, down: 0, iup: 0, idown: 0 },
  B: { sx: 1, isx: 1, up: 0.01, down: 0.06, iup: 0.02, idown: 0.05 },
  C: { sx: 0.97, isx: 0.95, up: 0.02, down: 0.13, iup: 0.04, idown: 0.12 },
  D: { sx: 0.95, isx: 0.93, up: 0.025, down: 0.22, iup: 0.05, idown: 0.2 },
  E: { sx: 0.78, isx: 0.7, up: 0.025, down: 0.16, iup: 0.05, idown: 0.14 },
  F: { sx: 0.62, isx: 0.55, up: 0.01, down: 0.06, iup: 0.02, idown: 0.05 },
};
/** Vertical influence of each of the eight contour points: corners stay, the middle opens most. */
const OPENING_WEIGHT = [0, 0.7, 1, 0.7, 0, 0.7, 1, 0.7];

export function derivedMouthFrames(rest, rect) {
  const [rx, ry, rw, rh] = rect;
  const width = Math.abs(rest.outer[4][0] - rest.outer[0][0]);
  const [cx] = rest.center;
  const clamp = ([x, y]) => [
    Math.min(rx + rw - 0.5, Math.max(rx + 0.5, Math.round(x * 10) / 10)),
    Math.min(ry + rh - 0.5, Math.max(ry + 0.5, Math.round(y * 10) / 10)),
  ];
  const move = (points, sx, up, down) =>
    points.map(([x, y], index) => {
      const lower = index >= 5 && index <= 7;
      const offset = OPENING_WEIGHT[index] * width * (lower ? down : -up);
      return clamp([cx + (x - cx) * sx, y + offset]);
    });
  return Object.fromEntries(
    Object.entries(DERIVED_SHAPES).map(([shape, s], cell) => [
      shape,
      {
        cell,
        outer: move(rest.outer, s.sx, s.up, s.down),
        inner: move(rest.inner, s.isx, s.iup, s.idown),
        center: [...rest.center],
      },
    ]),
  );
}

/** Resamples a closed polygon to `count` points by arc length, clockwise from its leftmost point. */
export function resampleOutline(polygon, count = 8) {
  let points = polygon.map((p) => [...p]);
  const area = points.reduce(
    (sum, [x, y], i) => sum + x * points[(i + 1) % points.length][1] - points[(i + 1) % points.length][0] * y,
    0,
  );
  if (area < 0) points.reverse(); // Clockwise on screen (y down) has a positive shoelace sum.
  const start = points.reduce((best, p, i) => (p[0] < points[best][0] ? i : best), 0);
  points = [...points.slice(start), ...points.slice(0, start)];
  const lengths = points.map((p, i) => Math.hypot(points[(i + 1) % points.length][0] - p[0], points[(i + 1) % points.length][1] - p[1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  const result = [];
  for (let k = 0; k < count; k++) {
    let target = (k / count) * total;
    let i = 0;
    while (target > lengths[i] && i < lengths.length - 1) target -= lengths[i++];
    const a = points[i], b = points[(i + 1) % points.length], t = lengths[i] ? target / lengths[i] : 0;
    result.push([Math.round((a[0] + (b[0] - a[0]) * t) * 10) / 10, Math.round((a[1] + (b[1] - a[1]) * t) * 10) / 10]);
  }
  return result;
}

/**
 * Corresponding facial landmarks in source pixels, used by the player to morph between two
 * expressions of a character: lips, eyelid openings, irises and eyebrow outlines.
 */
export function morphLandmarks(recipe) {
  const rest = recipe.mouth.rest ?? estimatedMouth(recipe.mouth.rect, "X");
  return {
    version: 1,
    mouth: { outer: rest.outer, inner: rest.inner, center: rest.center },
    eyes: recipe.eyes.map((eye) => ({ aperture: eye.aperture, iris: eye.iris.center })),
    brows: (recipe.brows.maskPolygons ?? []).slice(0, 2).map((polygon) => browCenterline(polygon)),
  };
}

/** The middle line of a brow outline, from its left tip to its right tip, as `count` points. */
export function browCenterline(polygon, count = 5) {
  const points = polygon.map((p) => [...p]);
  const left = points.reduce((best, p, i) => (p[0] < points[best][0] ? i : best), 0);
  const right = points.reduce((best, p, i) => (p[0] > points[best][0] ? i : best), 0);
  const walk = (from, to) => {
    const path = [];
    for (let i = from; ; i = (i + 1) % points.length) {
      path.push(points[i]);
      if (i === to) break;
    }
    return path;
  };
  // The two halves of the outline between the tips, both ordered left to right.
  const one = walk(left, right);
  const other = walk(right, left).reverse();
  const at = (path, x) => {
    for (let i = 0; i < path.length - 1; i++) {
      const [x0, y0] = path[i], [x1, y1] = path[i + 1];
      if ((x >= Math.min(x0, x1) && x <= Math.max(x0, x1)) && x0 !== x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
    return path.reduce((best, p) => (Math.abs(p[0] - x) < Math.abs(best[0] - x) ? p : best))[1];
  };
  const [x0, x1] = [points[left][0], points[right][0]];
  return Array.from({ length: count }, (_, k) => {
    const x = x0 + ((x1 - x0) * k) / (count - 1);
    return [Math.round(x * 10) / 10, Math.round(((at(one, x) + at(other, x)) / 2) * 10) / 10];
  });
}
