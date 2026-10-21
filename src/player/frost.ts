/**
 * Ice that grows in from the edges of the frame: a frosted haze along the border and
 * branching crystals (main stems with side shoots at sixty degrees, as frost on glass grows).
 * Painted once per size from a seed, so the `frost` weather and the `{fx=frost}` screen effect
 * look identical in the browser and in video renders. Both only animate how much is revealed.
 */

function seeded(seed: number) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Paints the frost into `context` over a `width` × `height` area (transparent elsewhere). */
export function paintFrost(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed = 1,
) {
  const random = seeded(seed * 7_919 + 104_729);
  const unit = height / 1000;
  context.save();
  context.clearRect(0, 0, width, height);

  // Frosted glass: a pale haze that thickens towards the border and most in the corners.
  context.save();
  context.translate(width / 2, height / 2);
  context.scale(width / height, 1);
  const haze = context.createRadialGradient(0, 0, height * 0.28, 0, 0, height * 0.78);
  haze.addColorStop(0, "rgba(210,232,255,0)");
  haze.addColorStop(0.5, "rgba(214,234,255,0.14)");
  haze.addColorStop(0.8, "rgba(226,240,255,0.5)");
  haze.addColorStop(1, "rgba(242,249,255,0.78)");
  context.fillStyle = haze;
  context.fillRect(-height, -height, height * 2, height * 2);
  context.restore();

  // How far ice may reach in from the nearest edge: further in the corners.
  const reach = (x: number, y: number) => {
    const fx = Math.min(x, width - x) / width;
    const fy = Math.min(y, height - y) / height;
    const corner = 1 - Math.min(1, Math.hypot(Math.min(fx, 0.5) * 2.2, Math.min(fy, 0.5) * 2.2));
    return height * (0.13 + 0.17 * corner);
  };
  const segments: { x0: number; y0: number; x1: number; y1: number; w: number; a: number }[] = [];
  const grow = (x: number, y: number, angle: number, length: number, depth: number, w: number) => {
    let px = x;
    let py = y;
    const steps = Math.max(2, Math.round(length / (7 * unit)));
    const limit = reach(x, y);
    for (let step = 0; step < steps; step++) {
      angle += (random() - 0.5) * 0.07;
      const stepLength = (length / steps) * (0.8 + random() * 0.4);
      const nx = px + Math.cos(angle) * stepLength;
      const ny = py + Math.sin(angle) * stepLength;
      const depthIn = Math.min(nx, width - nx, ny, height - ny);
      if (depthIn > limit || nx < -20 || ny < -20 || nx > width + 20 || ny > height + 20) break;
      const fade = 1 - Math.max(0, depthIn) / limit;
      segments.push({ x0: px, y0: py, x1: nx, y1: ny, w: w * (0.55 + 0.45 * fade), a: 0.35 + 0.6 * fade });
      // Feathery side shoots at sixty degrees, alternating sides, smaller each generation.
      if (depth > 0 && random() < 0.62) {
        const side = step % 2 ? -1 : 1;
        grow(nx, ny, angle + side * (Math.PI / 3 + (random() - 0.5) * 0.12), length * (0.16 + random() * 0.2), depth - 1, w * 0.58);
      }
      px = nx;
      py = ny;
    }
  };

  // Stems start along every edge, denser near the corners, pointing inwards.
  const stems = 64;
  for (let index = 0; index < stems; index++) {
    const edge = index % 4;
    const bias = random();
    // Push positions towards the ends of each edge (the corners).
    const t = bias < 0.5 ? Math.pow(bias * 2, 1.7) / 2 : 1 - Math.pow((1 - bias) * 2, 1.7) / 2;
    let x = 0;
    let y = 0;
    let angle = 0;
    if (edge === 0) [x, y, angle] = [t * width, -4, Math.PI / 2];
    else if (edge === 1) [x, y, angle] = [width + 4, t * height, Math.PI];
    else if (edge === 2) [x, y, angle] = [t * width, height + 4, -Math.PI / 2];
    else [x, y, angle] = [-4, t * height, 0];
    // Lean towards the centre so corner stems grow diagonally.
    const toCentre = Math.atan2(height / 2 - y, width / 2 - x);
    angle = angle * 0.55 + toCentre * 0.45 + (random() - 0.5) * 0.7;
    grow(x, y, angle, (100 + random() * 190) * unit, 3, (1.5 + random() * 1.1) * unit);
  }

  context.lineCap = "round";
  context.lineJoin = "round";
  // Segments are batched into a few paths by brightness and thickness: one stroke (and one
  // blur) per batch instead of tens of thousands, which software GPUs rasterise far faster.
  const batches = new Map<string, { path: Path2D; a: number; w: number }>();
  for (const s of segments) {
    const a = Math.round(s.a * 4) / 4;
    const w = Math.max(0.25, Math.round((s.w / unit) * 2) / 2) * unit;
    const key = `${a}:${w}`;
    let batch = batches.get(key);
    if (!batch) batches.set(key, (batch = { path: new Path2D(), a, w }));
    batch.path.moveTo(s.x0, s.y0);
    batch.path.lineTo(s.x1, s.y1);
  }
  // A cool glow under the crystals, then the bright crystal lines.
  context.shadowColor = "rgba(185,222,255,1)";
  context.shadowBlur = 9 * unit;
  for (const batch of batches.values()) {
    context.strokeStyle = `rgba(215,236,255,${(batch.a * 0.45).toFixed(3)})`;
    context.lineWidth = batch.w * 1.8;
    context.stroke(batch.path);
  }
  context.shadowBlur = 0;
  for (const batch of batches.values()) {
    context.strokeStyle = `rgba(252,254,255,${Math.min(1, batch.a * 1.1).toFixed(3)})`;
    context.lineWidth = Math.max(0.5, batch.w * 0.55);
    context.stroke(batch.path);
  }

  // A scatter of small six-pointed crystals in the haze.
  for (let index = 0; index < 90; index++) {
    const along = random();
    const edge = Math.floor(random() * 4);
    const depth = Math.pow(random(), 1.8) * height * 0.16;
    const x = edge === 0 || edge === 2 ? along * width : edge === 1 ? width - depth : depth;
    const y = edge === 1 || edge === 3 ? along * height : edge === 2 ? height - depth : depth;
    const arm = (2.5 + random() * 6) * unit;
    context.strokeStyle = `rgba(250,253,255,${(0.35 + random() * 0.5).toFixed(3)})`;
    context.lineWidth = Math.max(0.5, 0.9 * unit);
    context.beginPath();
    const turn = random() * Math.PI;
    for (let k = 0; k < 3; k++) {
      const a = turn + (k * Math.PI) / 3;
      context.moveTo(x - Math.cos(a) * arm, y - Math.sin(a) * arm);
      context.lineTo(x + Math.cos(a) * arm, y + Math.sin(a) * arm);
    }
    context.stroke();
  }
  context.restore();
}

/** Smooth 0–1 ease used for growing and melting. */
export const smooth = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
