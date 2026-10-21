#!/usr/bin/env node
/**
 * Reproducible pose workspace CLI. A pose file keeps calibration next to the private
 * artwork it describes; this tool turns it into a schema-v1 recipe, stores the images
 * in the content-addressed asset store that the studio also uses, compiles the pack
 * and installs it under public/local-packs/<packId>.
 *
 *   workspace.mjs recipe   <pose.json> [--out recipe.json]
 *   workspace.mjs build    <pose.json> [--replace] [--dry-run]
 *   workspace.mjs variant  <pose.json> --pose <id> --name <Name> --pack <packId> --source <file>
 *                          [--sheets <prefix>] [--out <variant-pose.json>] [--align-region x,y,w,h]
 *   workspace.mjs sheet-grid <pose.json> --sheet mouth|blink|brows|gaze [--rect x,y,w,h] [--scale 3] --out grid.png
 *
 * Pose file (paths are relative to the pose file's character directory):
 *   { pack, character, pose, source, sheets:{mouth:{file,columns,rows},...}, referenceRect,
 *     registrationRegion, provenance?, calibrationStatus?, mouth, eyes, brows, body }
 */
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { validateRecipe } from "./recipe.mjs";
import { buildCharacterPack } from "./pack.mjs";
import { registerSheets } from "./register.mjs";
import { fitAffine } from "./geometry.mjs";
import { withCanvas } from "./image.mjs";

const SHEETS = ["mouth", "blink", "brows", "gaze"];
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Minimal PNG/JPEG header read so stored asset metadata matches the studio's upload records. */
function dimensions(bytes, mime) {
  if (mime === "image/png" && bytes.toString("ascii", 12, 16) === "IHDR")
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (mime === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1],
        length = bytes.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2].includes(marker))
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      offset += 2 + length;
    }
  }
  return { width: 0, height: 0 };
}

export async function loadPose(file) {
  const poseFile = path.resolve(file),
    directory = path.dirname(poseFile.includes(`${path.sep}poses${path.sep}`) ? path.dirname(poseFile) : poseFile);
  const pose = JSON.parse(await readFile(poseFile, "utf8"));
  const resolveFile = (relative) => path.resolve(directory, relative);
  return { pose, poseFile, directory, resolveFile };
}

/** Store a file in the studio's immutable asset store and return its content ID. */
export async function storeAsset(file, root, name) {
  const bytes = await readFile(file),
    mime = MIME[path.extname(file).toLowerCase()];
  if (!mime) throw new Error(`${file}: only PNG, JPEG and WebP images can be stored.`);
  const id = sha(bytes),
    store = path.join(root, ".studio", "characters", "assets"),
    extension = mime === "image/jpeg" ? "jpg" : mime.split("/")[1],
    target = path.join(store, `${id}.${extension}`);
  await mkdir(store, { recursive: true, mode: 0o700 });
  try {
    await stat(target);
  } catch {
    await copyFile(file, target);
  }
  const metadata = path.join(store, `${id}.json`);
  try {
    await stat(metadata);
  } catch {
    await writeFile(
      metadata,
      JSON.stringify({ assetId: id, src: `/character-assets/${id}.${extension}`, ...dimensions(bytes, mime), mime, bytes: bytes.length, name }),
      { mode: 0o600 },
    );
  }
  return { id, file: target, bytes: bytes.length };
}

export async function poseToRecipe(file, { root = process.cwd(), store = true } = {}) {
  const { pose, directory, resolveFile } = await loadPose(file);
  for (const key of ["pack", "character", "pose", "source", "sheets", "referenceRect", "mouth", "eyes", "brows", "body"])
    if (pose[key] === undefined) throw new Error(`Pose file is missing "${key}".`);
  const assetFiles = {},
    ids = {};
  const register = async (relative, name) => {
    const file = resolveFile(relative);
    const stored = store ? await storeAsset(file, root, name) : { id: sha(await readFile(file)), file };
    assetFiles[stored.id] = stored.file;
    return stored.id;
  };
  ids.source = await register(pose.source, `${pose.character.name} ${pose.pose.name} source`);
  const sheets = {};
  for (const name of SHEETS) {
    const sheet = pose.sheets[name];
    if (!sheet?.file) throw new Error(`sheets.${name}.file is required.`);
    sheets[name] = {
      asset: await register(sheet.file, `${pose.character.name} ${pose.pose.name} ${name}`),
      columns: sheet.columns,
      rows: sheet.rows,
      referenceRect: sheet.referenceRect || pose.referenceRect,
      ...(sheet.registrations ? { registrations: sheet.registrations } : {}),
    };
  }
  const recipe = {
    schemaVersion: 1,
    pack: pose.pack,
    character: pose.character,
    pose: pose.pose,
    source: ids.source,
    sourceSha256: ids.source,
    calibrationStatus: pose.calibrationStatus || "draft",
    ...(pose.provenance ? { provenance: pose.provenance } : {}),
    ...(pose.registrationRegion ? { registrationRegion: pose.registrationRegion, autoRegister: pose.autoRegister ?? true } : {}),
    sheets,
    mouth: pose.mouth,
    eyes: pose.eyes,
    brows: pose.brows,
    body: pose.body,
  };
  return { recipe, assetFiles, pose, directory };
}

const transformGeometry = (value, map) => {
  if (Array.isArray(value)) {
    if (value.length === 2 && value.every((n) => typeof n === "number")) return map(value);
    if (value.length === 4 && value.every((n) => typeof n === "number")) {
      const [a, b] = map([value[0], value[1]]),
        [c, d] = map([value[0] + value[2], value[1] + value[3]]);
      return [Math.round(a), Math.round(b), Math.round(c - a), Math.round(d - b)];
    }
    return value.map((item) => transformGeometry(item, map));
  }
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, transformGeometry(v, map)]));
  return value;
};

/** Derive a sibling pose from a calibrated one. Geometry is reused, optionally re-fitted to the new portrait. */
export async function deriveVariant(file, options) {
  const { pose, directory, resolveFile } = await loadPose(file);
  const variant = structuredClone(pose);
  variant.pack = { id: options.pack, name: options.packName || `${pose.character.name} • ${options.name}` };
  variant.pose = { id: options.pose, name: options.name };
  variant.source = options.source;
  variant.calibrationStatus = "draft";
  variant.derivedFrom = { pose: pose.pose.id, source: pose.source };
  for (const name of SHEETS) {
    variant.sheets[name] = { ...pose.sheets[name], file: `${options.sheets || "edits/" + options.pose + "-"}${name}-v1.png` };
    delete variant.sheets[name].registrations;
  }
  // Variants add expressions to the same character; only the first pack carries the description.
  variant.character = { id: pose.character.id, name: pose.character.name, color: pose.character.color };
  if (options.alignRegion) {
    const fit = await withCanvas(
      { base: resolveFile(pose.source), variant: resolveFile(options.source) },
      { region: options.alignRegion, search: 16 },
      ALIGN_SCRIPT,
    );
    const { scale, dx, dy } = fit.best,
      [cx, cy] = fit.center;
    variant.alignment = fit;
    if (scale !== 1 || dx || dy) {
      const map = ([x, y]) => [cx + (x - cx) * scale + dx, cy + (y - cy) * scale + dy];
      for (const key of ["registrationRegion", "referenceRect", "mouth", "eyes", "brows", "body"])
        if (variant[key] !== undefined) variant[key] = transformGeometry(variant[key], map);
      // Body rows are scalar y values; map them explicitly.
      const row = (y) => map([cx, y])[1];
      const body = variant.body;
      body.head.rigidUntil = row(pose.body.head.rigidUntil);
      body.head.anchoredFrom = row(pose.body.head.anchoredFrom);
      body.chin = row(pose.body.chin);
      body.neck = row(pose.body.neck);
      if (body.breathing) body.breathing.fixedTop = row(pose.body.breathing.fixedTop);
    }
  }
  return { variant, directory };
}

const ALIGN_SCRIPT = `({ images, args, helpers }) => {
  const base = images.base, variant = images.variant, [rx, ry, rw, rh] = args.region, W = base.width, H = base.height;
  const pb = helpers.ctx(helpers.crop(base, [0, 0, W, H])).getImageData(0, 0, W, H).data;
  const pv = helpers.ctx(helpers.crop(variant, [0, 0, variant.width, variant.height])).getImageData(0, 0, variant.width, variant.height).data;
  const stride = Math.max(2, Math.sqrt((rw * rh) / 2500)), points = [];
  for (let y = ry; y < ry + rh; y += stride) for (let x = rx; x < rx + rw; x += stride) {
    const k = (Math.round(y) * W + Math.round(x)) * 4; if (pb[k + 3] < 200) continue; points.push([x, y, helpers.luminance(pb, k)]);
  }
  const mean = points.reduce((a, p) => a + p[2], 0) / points.length; points.forEach((p) => (p[2] -= mean));
  const norm = Math.sqrt(points.reduce((a, p) => a + p[2] ** 2, 0)), vw = variant.width, vh = variant.height;
  const sample = (x, y) => { if (x < 0 || y < 0 || x >= vw - 1 || y >= vh - 1) return null; const a = Math.floor(x), b = Math.floor(y), fx = x - a, fy = y - b;
    const at = (px, py) => { const k = (py * vw + px) * 4; return pv[k + 3] < 200 ? null : helpers.luminance(pv, k); };
    const v00 = at(a, b), v10 = at(a + 1, b), v01 = at(a, b + 1), v11 = at(a + 1, b + 1); if ([v00, v10, v01, v11].includes(null)) return null;
    return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy; };
  const cx = W / 2, cy = H / 2;
  const score = (scale, dx, dy) => { let sum = 0, sq = 0, dot = 0, n = 0; for (const [x, y, ref] of points) { const v = sample(cx + (x - cx) * scale + dx, cy + (y - cy) * scale + dy); if (v === null) continue; sum += v; sq += v * v; dot += v * ref; n++; }
    if (n < points.length * 0.9) return -1; return dot / (norm * Math.sqrt(Math.max(1, sq - (sum * sum) / n))); };
  let best = { score: -1, scale: 1, dx: 0, dy: 0 }; const S = args.search;
  for (let si = -6; si <= 6; si++) for (let dx = -S; dx <= S; dx += 2) for (let dy = -S; dy <= S; dy += 2) { const v = score(1 + si * 0.01, dx, dy); if (v > best.score) best = { score: v, scale: 1 + si * 0.01, dx, dy }; }
  const coarse = { ...best };
  for (let si = -10; si <= 10; si++) for (let xi = -4; xi <= 4; xi++) for (let yi = -4; yi <= 4; yi++) { const scale = coarse.scale + si * 0.002, dx = coarse.dx + xi * 0.5, dy = coarse.dy + yi * 0.5; const v = score(scale, dx, dy); if (v > best.score) best = { score: v, scale, dx, dy }; }
  return { region: args.region, center: [cx, cy], correlationIdentity: score(1, 0, 0), best, samples: points.length };
}`;

/** Render the registered cells of one sheet in portrait coordinates with a labelled grid. */
async function sheetGrid(file, { sheet, rect, scale = 3, step = 20, out, root }) {
  const { recipe, assetFiles, pose } = await poseToRecipe(file, { root, store: false });
  if (!recipe.registrationRegion) throw new Error("sheet-grid needs registrationRegion.");
  const registered = await registerSheets(recipe, { assetFiles, region: recipe.registrationRegion, minimumCorrelation: 0 });
  const entry = registered.recipe.sheets[sheet];
  const matrices = Object.fromEntries(
    Object.entries(entry.registrations || {}).map(([cell, value]) => [cell, fitAffine(value.sourceAnchors, value.portraitAnchors).affine]),
  );
  const defaultRect = sheet === "mouth" ? pose.mouth.rect : sheet === "brows" ? pose.brows.rect : [
    Math.min(...pose.eyes.map((e) => e.rect[0])) - 10,
    Math.min(...pose.eyes.map((e) => e.rect[1])) - 10,
    Math.max(...pose.eyes.map((e) => e.rect[0] + e.rect[2])) - Math.min(...pose.eyes.map((e) => e.rect[0])) + 20,
    Math.max(...pose.eyes.map((e) => e.rect[3])) + 20,
  ];
  const png = await withCanvas(
    { sheet: assetFiles[entry.asset] },
    { matrices, rect: rect || defaultRect, scale, step, columns: entry.columns, label: sheet, measurements: registered.measurements.filter((m) => m.sheet === sheet) },
    `({ images, args, helpers }) => {
      const cells = Object.keys(args.matrices).map(Number).sort((a, b) => a - b), [x, y, w, h] = args.rect, s = args.scale;
      const cols = Math.min(4, cells.length), rows = Math.ceil(cells.length / cols), tw = w * s + 50, th = h * s + 44;
      const c = helpers.make(tw * cols, th * rows), g = helpers.ctx(c); g.fillStyle = "#1c1f24"; g.fillRect(0, 0, c.width, c.height); g.font = "11px monospace"; g.textBaseline = "top";
      cells.forEach((cell, index) => {
        const m = args.matrices[cell], ox = (index % cols) * tw + 40, oy = Math.floor(index / cols) * th + 30;
        const crop = helpers.make(w, h), cg = helpers.ctx(crop); cg.setTransform(m[0], m[1], m[2], m[3], m[4] - x, m[5] - y); cg.drawImage(images.sheet, 0, 0); cg.resetTransform();
        g.imageSmoothingEnabled = false; g.drawImage(crop, ox, oy, w * s, h * s);
        const info = args.measurements.find((item) => item.cell === cell);
        g.fillStyle = "#fff"; g.fillText(args.label + " cell " + cell + (info ? "  r=" + info.correlation.toFixed(3) : ""), ox, oy - 26);
        for (let px = Math.ceil(x / args.step) * args.step; px <= x + w; px += args.step) { const xx = ox + (px - x) * s; g.strokeStyle = px % 100 === 0 ? "#ffd84dbb" : "#ffffff44"; g.beginPath(); g.moveTo(xx, oy); g.lineTo(xx, oy + h * s); g.stroke(); g.fillStyle = "#fff"; g.fillText(String(px), xx + 1, oy - 12 + (px / args.step % 2) * 0); }
        for (let py = Math.ceil(y / args.step) * args.step; py <= y + h; py += args.step) { const yy = oy + (py - y) * s; g.strokeStyle = py % 100 === 0 ? "#ffd84dbb" : "#ffffff44"; g.beginPath(); g.moveTo(ox, yy); g.lineTo(ox + w * s, yy); g.stroke(); g.fillStyle = "#fff"; g.fillText(String(py), ox - 38, yy + 1); }
      });
      return helpers.png(c);
    }`,
  );
  await writeFile(path.resolve(out), Buffer.from(png, "base64"));
  return { out: path.resolve(out), measurements: registered.measurements.filter((m) => m.sheet === sheet) };
}

async function main() {
  const [command, file, ...rest] = process.argv.slice(2);
  const option = (name, fallback) => {
    const i = rest.indexOf("--" + name);
    return i >= 0 ? rest[i + 1] : fallback;
  };
  const flag = (name) => rest.includes("--" + name);
  const numbers = (value) => (value ? value.split(",").map(Number) : undefined);
  const root = process.cwd();
  if (!command || !file) throw new Error("Usage: workspace.mjs <recipe|build|variant|sheet-grid> <pose.json> [options]");
  if (command === "recipe") {
    const { recipe, directory } = await poseToRecipe(file, { root, store: false });
    const check = validateRecipe(recipe);
    const out = option("out", path.join(directory, "work", `recipe-${recipe.pose.id}.json`));
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify(recipe, null, 2) + "\n");
    console.log(JSON.stringify({ recipe: out, ...check }));
    if (!check.valid) process.exitCode = 1;
  } else if (command === "build") {
    const { recipe, assetFiles, directory } = await poseToRecipe(file, { root });
    const check = validateRecipe(recipe);
    if (!check.valid) throw new Error(check.errors.join("\n"));
    const outputDirectory = path.join(root, "public", "local-packs", recipe.pack.id),
      urlRoot = `/local-packs/${recipe.pack.id}`;
    let installed = false;
    try {
      await stat(path.join(outputDirectory, "catalog.json"));
      installed = true;
    } catch {}
    if (installed && !flag("replace"))
      throw new Error(`${urlRoot} is already installed. Pass --replace to rebuild this pack in place (previous build is kept as a hidden snapshot).`);
    await mkdir(path.join(directory, "work"), { recursive: true });
    await writeFile(path.join(directory, "work", `recipe-${recipe.pose.id}.json`), JSON.stringify(recipe, null, 2) + "\n");
    await writeFile(path.join(directory, "work", `assets-${recipe.pose.id}.json`), JSON.stringify(assetFiles, null, 2) + "\n");
    if (flag("dry-run")) {
      console.log(JSON.stringify({ dryRun: true, recipe: `work/recipe-${recipe.pose.id}.json`, warnings: check.warnings }));
      return;
    }
    const result = await buildCharacterPack(recipe, { assetFiles, outputDirectory, urlRoot });
    await writeFile(path.join(directory, "work", `build-${recipe.pose.id}.json`), JSON.stringify(result, null, 2) + "\n");
    const registration = result.validation.checks?.registration || [];
    console.log(
      JSON.stringify({
        installed: urlRoot,
        valid: result.validation.valid,
        warnings: result.validation.warnings,
        registration: registration.map((r) => `${r.sheet}#${r.cell} r=${(r.correlation ?? 0).toFixed(3)}`),
      }),
    );
  } else if (command === "variant") {
    for (const key of ["pose", "name", "pack", "source"]) if (!option(key)) throw new Error(`variant needs --${key}.`);
    const { variant, directory } = await deriveVariant(file, {
      pose: option("pose"),
      name: option("name"),
      pack: option("pack"),
      packName: option("pack-name"),
      source: option("source"),
      sheets: option("sheets"),
      alignRegion: numbers(option("align-region")),
    });
    const out = option("out", path.join(directory, "poses", `${option("pose")}.json`));
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify(variant, null, 2) + "\n");
    console.log(JSON.stringify({ pose: out, alignment: variant.alignment?.best, correlationIdentity: variant.alignment?.correlationIdentity }));
  } else if (command === "sheet-grid") {
    const result = await sheetGrid(file, {
      sheet: option("sheet", "mouth"),
      rect: numbers(option("rect")),
      scale: Number(option("scale", 3)),
      step: Number(option("step", 20)),
      out: option("out"),
      root,
    });
    console.log(JSON.stringify(result));
  } else throw new Error(`Unknown command ${command}.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
