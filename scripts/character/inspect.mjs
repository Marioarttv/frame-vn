#!/usr/bin/env node
/**
 * Calibration inspection CLI. Produces labelled zoom grids, recipe overlays, face
 * reference crops, region diffs and registered expression composites. It never
 * invents pixels: composites copy the supplied variant into the supplied base.
 *
 *   inspect.mjs grid      --image p.png --rect x,y,w,h [--scale 3] [--step 20] --out grid.png
 *   inspect.mjs crop      --image p.png --rect x,y,w,h [--size 720] --out face.png
 *   inspect.mjs overlay   --image p.png --recipe r.json [--rect x,y,w,h] [--scale 2] --out overlay.png
 *   inspect.mjs diff      --a a.png --b b.png [--rect x,y,w,h] [--exclude x,y,w,h] [--out heat.png]
 *   inspect.mjs align     --base n.png --variant v.png --region x,y,w,h [--search 40]
 *   inspect.mjs composite --base n.png --variant v.png --rect x,y,w,h [--feather 24]
 *                         [--region x,y,w,h | --transform scale,dx,dy] --out aligned.png
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { withCanvas } from "./image.mjs";

const args = process.argv.slice(3),
  command = process.argv[2];
const option = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const numbers = (value, count, label) => {
  if (value === undefined) return undefined;
  const list = String(value).split(",").map(Number);
  if (list.length !== count || list.some((n) => !Number.isFinite(n)))
    throw new Error(`${label} must be ${count} comma-separated numbers.`);
  return list;
};
const savePng = async (file, base64) => {
  await writeFile(path.resolve(file), Buffer.from(base64, "base64"));
  return path.resolve(file);
};

const GRID = `({ images, args, helpers }) => {
  const [x, y, w, h] = args.rect, s = args.scale, step = args.step;
  const c = helpers.make(w * s + 60, h * s + 30), g = helpers.ctx(c);
  g.fillStyle = "#1c1f24"; g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingEnabled = false;
  g.drawImage(images.image, x, y, w, h, 60, 30, w * s, h * s);
  g.font = "11px monospace"; g.textBaseline = "top";
  for (let px = Math.ceil(x / step) * step; px <= x + w; px += step) {
    const xx = 60 + (px - x) * s;
    g.strokeStyle = px % (step * 5) === 0 ? "#ffd84dbb" : "#ffffff55";
    g.beginPath(); g.moveTo(xx, 30); g.lineTo(xx, c.height); g.stroke();
    g.fillStyle = "#fff"; g.fillText(String(px), xx + 2, 4 + (px / step % 2) * 12);
  }
  for (let py = Math.ceil(y / step) * step; py <= y + h; py += step) {
    const yy = 30 + (py - y) * s;
    g.strokeStyle = py % (step * 5) === 0 ? "#ffd84dbb" : "#ffffff55";
    g.beginPath(); g.moveTo(60, yy); g.lineTo(c.width, yy); g.stroke();
    g.fillStyle = "#fff"; g.fillText(String(py), 4, yy + 2);
  }
  return helpers.png(c);
}`;

const CROP = `({ images, args, helpers }) => {
  const [x, y, w, h] = args.rect, size = args.size;
  const c = helpers.make(size, size * h / w), g = helpers.ctx(c);
  g.imageSmoothingQuality = "high";
  g.drawImage(images.image, x, y, w, h, 0, 0, c.width, c.height);
  return helpers.png(c);
}`;

const OVERLAY = `({ images, args, helpers }) => {
  const r = args.recipe, s = args.scale, [x, y, w, h] = args.rect;
  const c = helpers.make(w * s, h * s), g = helpers.ctx(c);
  g.fillStyle = "#1c1f24"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(images.image, x, y, w, h, 0, 0, w * s, h * s);
  const P = ([px, py]) => [(px - x) * s, (py - y) * s];
  const poly = (points, color, close = true) => {
    if (!points?.length) return;
    g.strokeStyle = color; g.lineWidth = 1.5; g.beginPath();
    points.forEach((p, i) => { const [a, b] = P(p); i ? g.lineTo(a, b) : g.moveTo(a, b); });
    if (close) g.closePath(); g.stroke();
    g.fillStyle = color;
    for (const p of points) { const [a, b] = P(p); g.fillRect(a - 1.5, b - 1.5, 3, 3); }
  };
  const rect = ([rx, ry, rw, rh], color) => {
    const [a, b] = P([rx, ry]); g.strokeStyle = color; g.lineWidth = 1; g.strokeRect(a, b, rw * s, rh * s);
  };
  const dot = (p, color, radius = 3) => { const [a, b] = P(p); g.fillStyle = color; g.beginPath(); g.arc(a, b, radius, 0, Math.PI * 2); g.fill(); };
  const line = (py, color, label) => { const [, b] = P([0, py]); g.strokeStyle = color; g.beginPath(); g.moveTo(0, b); g.lineTo(c.width, b); g.stroke(); g.fillStyle = color; g.font = "11px monospace"; g.fillText(label + " " + py, 4, b - 3); };
  if (r.registrationRegion) rect(r.registrationRegion, "#00e5ff");
  rect(r.mouth.rect, "#ff4d6d");
  poly(r.mouth.maskPolygon, "#ff9f1c"); poly(r.mouth.repairMaskPolygon, "#ffe066");
  if (r.mouth.rest) { poly(r.mouth.rest.outer, "#ff4d6d"); poly(r.mouth.rest.inner, "#ff8fa3"); dot(r.mouth.rest.center, "#ff4d6d"); }
  for (const eye of r.eyes) {
    rect(eye.rect, "#4dff88"); poly(eye.maskPolygon, "#b5ff4d"); poly(eye.aperture, "#4dff88");
    const [cx, cy] = eye.iris.center, [rx, ry] = eye.iris.radius; const [a, b] = P([cx, cy]);
    g.strokeStyle = "#4dd2ff"; g.beginPath(); g.ellipse(a, b, rx * s, ry * s, 0, 0, Math.PI * 2); g.stroke(); dot([cx, cy], "#4dd2ff", 2);
  }
  rect(r.brows.rect, "#c77dff"); r.brows.maskPolygons.forEach((p) => poly(p, "#e0aaff"));
  for (const frame of r.brows.frames || []) for (const control of frame.controls || []) { dot(control.from, frame.value < 0 ? "#ff7b00" : "#80ffdb", 2); const [a, b] = P(control.from), [d, e] = P(control.to); g.strokeStyle = frame.value < 0 ? "#ff7b00" : "#80ffdb"; g.beginPath(); g.moveTo(a, b); g.lineTo(d, e); g.stroke(); }
  if (args.body && r.body) {
    dot(r.body.head.pivot, "#ffffff", 4); line(r.body.chin, "#ffffffaa", "chin"); line(r.body.neck, "#ffffffaa", "neck");
    line(r.body.head.rigidUntil, "#ffd84daa", "rigidUntil"); line(r.body.head.anchoredFrom, "#ffd84daa", "anchoredFrom");
    if (r.body.breathing) line(r.body.breathing.fixedTop, "#4dd2ffaa", "fixedTop");
    for (const zone of r.body.hair || []) poly([[zone.x[0], zone.y[0]], [zone.x[1], zone.y[1]], [zone.x[2], zone.y[2]], [zone.x[3], zone.y[3]]], "#ff4dff", false);
    if (r.body.clothing) { const cl = r.body.clothing; rect([cl.left[0], cl.y[0], cl.left[1] - cl.left[0], cl.y[3] - cl.y[0]], "#ffb703"); rect([cl.right[0], cl.y[0], cl.right[1] - cl.right[0], cl.y[3] - cl.y[0]], "#ffb703"); }
  }
  return helpers.png(c);
}`;

const DIFF = `({ images, args, helpers }) => {
  const a = images.a, b = images.b;
  if (a.width !== b.width || a.height !== b.height) return { error: "Images differ in size: " + a.width + "x" + a.height + " vs " + b.width + "x" + b.height };
  const [x, y, w, h] = args.rect || [0, 0, a.width, a.height];
  const da = helpers.ctx(helpers.crop(a, [x, y, w, h])).getImageData(0, 0, w, h).data;
  const db = helpers.ctx(helpers.crop(b, [x, y, w, h])).getImageData(0, 0, w, h).data;
  const heat = helpers.make(w, h), hg = helpers.ctx(heat), out = hg.createImageData(w, h);
  const ex = args.exclude; let sum = 0, changed = 0, count = 0, max = 0, bbox = null;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = (j * w + i) * 4;
    if (ex && i + x >= ex[0] && i + x < ex[0] + ex[2] && j + y >= ex[1] && j + y < ex[1] + ex[3]) { out.data[k + 3] = 0; continue; }
    const d = Math.max(Math.abs(da[k] - db[k]), Math.abs(da[k + 1] - db[k + 1]), Math.abs(da[k + 2] - db[k + 2]), Math.abs(da[k + 3] - db[k + 3]));
    sum += d; count++; if (d > max) max = d;
    if (d > args.threshold) { changed++; bbox = bbox ? [Math.min(bbox[0], i + x), Math.min(bbox[1], j + y), Math.max(bbox[2], i + x), Math.max(bbox[3], j + y)] : [i + x, j + y, i + x, j + y]; }
    const v = Math.min(255, d * 3); out.data[k] = v; out.data[k + 1] = d > args.threshold ? 0 : v * 0.3; out.data[k + 2] = 255 - v; out.data[k + 3] = 255;
  }
  hg.putImageData(out, 0, 0);
  const sheet = helpers.make(w * 3, h), sg = helpers.ctx(sheet);
  sg.fillStyle = "#1c1f24"; sg.fillRect(0, 0, sheet.width, sheet.height);
  sg.drawImage(a, x, y, w, h, 0, 0, w, h); sg.drawImage(b, x, y, w, h, w, 0, w, h); sg.drawImage(heat, w * 2, 0);
  return { rect: [x, y, w, h], meanDelta: sum / Math.max(1, count), changedFraction: changed / Math.max(1, count), maxDelta: max, changedBox: bbox ? [bbox[0], bbox[1], bbox[2] - bbox[0] + 1, bbox[3] - bbox[1] + 1] : null, png: args.out ? helpers.png(sheet) : undefined };
}`;

/** Translation + uniform scale fit of the variant onto the base over a stable region (NCC on luminance). */
const ALIGN = `({ images, args, helpers }) => {
  const base = images.base, variant = images.variant, [rx, ry, rw, rh] = args.region;
  const W = base.width, H = base.height;
  const pb = helpers.ctx(helpers.crop(base, [0, 0, W, H])).getImageData(0, 0, W, H).data;
  const pv = helpers.ctx(helpers.crop(variant, [0, 0, variant.width, variant.height])).getImageData(0, 0, variant.width, variant.height).data;
  const stride = Math.max(2, Math.sqrt((rw * rh) / 2500));
  const points = [];
  for (let y = ry; y < ry + rh; y += stride) for (let x = rx; x < rx + rw; x += stride) {
    const k = (Math.round(y) * W + Math.round(x)) * 4;
    if (pb[k + 3] < 200) continue;
    points.push([x, y, helpers.luminance(pb, k)]);
  }
  const mean = points.reduce((a, p) => a + p[2], 0) / points.length;
  points.forEach((p) => (p[2] -= mean));
  const norm = Math.sqrt(points.reduce((a, p) => a + p[2] ** 2, 0));
  const vw = variant.width, vh = variant.height;
  const sample = (x, y) => {
    if (x < 0 || y < 0 || x >= vw - 1 || y >= vh - 1) return null;
    const a = Math.floor(x), b = Math.floor(y), fx = x - a, fy = y - b;
    const at = (px, py) => { const k = (py * vw + px) * 4; return pv[k + 3] < 200 ? null : helpers.luminance(pv, k); };
    const v00 = at(a, b), v10 = at(a + 1, b), v01 = at(a, b + 1), v11 = at(a + 1, b + 1);
    if (v00 === null || v10 === null || v01 === null || v11 === null) return null;
    return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
  };
  const cx = args.center ? args.center[0] : W / 2, cy = args.center ? args.center[1] : H / 2;
  const score = (scale, dx, dy) => {
    let sum = 0, sq = 0, dot = 0, n = 0;
    for (const [x, y, ref] of points) {
      const v = sample(cx + (x - cx) * scale + dx, cy + (y - cy) * scale + dy);
      if (v === null) continue;
      sum += v; sq += v * v; dot += v * ref; n++;
    }
    if (n < points.length * 0.9) return -1;
    return dot / (norm * Math.sqrt(Math.max(1, sq - (sum * sum) / n)));
  };
  let best = { score: -1, scale: 1, dx: 0, dy: 0 };
  const S = args.search;
  for (let si = -6; si <= 6; si++) for (let dx = -S; dx <= S; dx += 2) for (let dy = -S; dy <= S; dy += 2) {
    const v = score(1 + si * 0.01, dx, dy); if (v > best.score) best = { score: v, scale: 1 + si * 0.01, dx, dy };
  }
  const coarse = { ...best };
  for (let si = -10; si <= 10; si++) for (let xi = -4; xi <= 4; xi++) for (let yi = -4; yi <= 4; yi++) {
    const scale = coarse.scale + si * 0.002, dx = coarse.dx + xi * 0.5, dy = coarse.dy + yi * 0.5;
    const v = score(scale, dx, dy); if (v > best.score) best = { score: v, scale, dx, dy };
  }
  const identity = score(1, 0, 0);
  // Mapping from base coordinates to variant coordinates: v = c + (b - c) * scale + d.
  return { region: args.region, center: [cx, cy], correlationIdentity: identity, best, samples: points.length };
}`;

/** Copy the variant's face rectangle into the base with a feathered edge, after an optional similarity transform. */
const COMPOSITE = `({ images, args, helpers }) => {
  const base = images.base, variant = images.variant, W = base.width, H = base.height;
  const [x, y, w, h] = args.rect, feather = args.feather;
  const [scale, dx, dy] = args.transform || [1, 0, 0], [cx, cy] = args.center || [W / 2, H / 2];
  const out = helpers.make(W, H), g = helpers.ctx(out);
  g.drawImage(base, 0, 0);
  // Resample the variant into base space so that base point b maps to variant point c + (b - c) * scale + d.
  const aligned = helpers.make(W, H), ag = helpers.ctx(aligned);
  ag.imageSmoothingQuality = "high";
  ag.setTransform(1 / scale, 0, 0, 1 / scale, cx - (cx + dx) / scale, cy - (cy + dy) / scale);
  ag.drawImage(variant, 0, 0);
  ag.resetTransform();
  const pb = g.getImageData(0, 0, W, H), pa = ag.getImageData(0, 0, W, H);
  let replaced = 0;
  for (let j = Math.max(0, y); j < Math.min(H, y + h); j++) for (let i = Math.max(0, x); i < Math.min(W, x + w); i++) {
    const edge = Math.min(i - x, x + w - 1 - i, j - y, y + h - 1 - j);
    const t = Math.max(0, Math.min(1, (edge + 0.5) / Math.max(0.5, feather)));
    const amount = t * t * (3 - 2 * t);
    if (amount <= 0) continue;
    const k = (j * W + i) * 4;
    if (pa[k + 3] === 0 && pb[k + 3] === 0) continue;
    for (let c = 0; c < 4; c++) pb.data[k + c] = Math.round(pb.data[k + c] * (1 - amount) + pa.data[k + c] * amount);
    replaced++;
  }
  g.putImageData(pb, 0, 0);
  return { replaced, png: helpers.png(out) };
}`;

async function main() {
  const out = option("out");
  switch (command) {
    case "grid": {
      const png = await withCanvas(
        { image: option("image") },
        {
          rect: numbers(option("rect"), 4, "--rect"),
          scale: Number(option("scale", 3)),
          step: Number(option("step", 20)),
        },
        GRID,
      );
      console.log(await savePng(out, png));
      break;
    }
    case "crop": {
      const png = await withCanvas(
        { image: option("image") },
        { rect: numbers(option("rect"), 4, "--rect"), size: Number(option("size", 720)) },
        CROP,
      );
      console.log(await savePng(out, png));
      break;
    }
    case "overlay": {
      const recipe = JSON.parse(await readFile(option("recipe"), "utf8"));
      const rect =
        numbers(option("rect"), 4, "--rect") ||
        recipe.sheets?.mouth?.referenceRect;
      const png = await withCanvas(
        { image: option("image") },
        { recipe, rect, scale: Number(option("scale", 2)), body: args.includes("--body") },
        OVERLAY,
      );
      console.log(await savePng(out, png));
      break;
    }
    case "diff": {
      const result = await withCanvas(
        { a: option("a"), b: option("b") },
        {
          rect: numbers(option("rect"), 4, "--rect"),
          exclude: numbers(option("exclude"), 4, "--exclude"),
          threshold: Number(option("threshold", 12)),
          out: Boolean(out),
        },
        DIFF,
      );
      if (result.error) throw new Error(result.error);
      if (out) result.heatmap = await savePng(out, result.png);
      delete result.png;
      console.log(JSON.stringify(result));
      break;
    }
    case "align": {
      const result = await withCanvas(
        { base: option("base"), variant: option("variant") },
        {
          region: numbers(option("region"), 4, "--region"),
          center: numbers(option("center"), 2, "--center"),
          search: Number(option("search", 40)),
        },
        ALIGN,
      );
      console.log(JSON.stringify(result));
      break;
    }
    case "composite": {
      let transform = numbers(option("transform"), 3, "--transform");
      const center = numbers(option("center"), 2, "--center");
      if (!transform && option("region")) {
        const fit = await withCanvas(
          { base: option("base"), variant: option("variant") },
          { region: numbers(option("region"), 4, "--region"), center, search: Number(option("search", 40)) },
          ALIGN,
        );
        transform = [fit.best.scale, fit.best.dx, fit.best.dy];
        console.error(JSON.stringify(fit));
      }
      const result = await withCanvas(
        { base: option("base"), variant: option("variant") },
        {
          rect: numbers(option("rect"), 4, "--rect"),
          feather: Number(option("feather", 24)),
          transform,
          center,
        },
        COMPOSITE,
      );
      result.output = await savePng(out, result.png);
      result.transform = transform || [1, 0, 0];
      delete result.png;
      console.log(JSON.stringify(result));
      break;
    }
    default:
      throw new Error(
        "Usage: inspect.mjs <grid|crop|overlay|diff|align|composite> --help in the file header.",
      );
  }
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
