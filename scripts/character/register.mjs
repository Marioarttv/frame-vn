#!/usr/bin/env node
/** Fit equal-cell edit sheets using unchanged portrait detail. No pixels are changed or generated. */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { launchAuthoringBrowser } from "./browser.mjs";
import { invertAffine, transformPoint } from "./geometry.mjs";

const data = async (file) =>
  "data:image/" +
  path.extname(file).slice(1).replace("jpg", "jpeg") +
  ";base64," +
  (await readFile(file)).toString("base64");

export async function registerSheets(
  recipe,
  { assetFiles, region, minimumCorrelation = 0.82, onBrowser },
) {
  const inputs = {};
  for (const id of new Set([
    recipe.source,
    ...Object.values(recipe.sheets).map((s) => s.asset),
  ]))
    inputs[id] = await data(assetFiles[id]);
  const browser = await launchAuthoringBrowser();
  let measurements;
  onBrowser?.(browser);
  try {
    const page = await browser.newPage();
    measurements = await page.evaluate(
      async ({ recipe, inputs, region }) => {
        const load = async (src) => {
          const i = new Image();
          i.src = src;
          await i.decode();
          return i;
        };
        const original = await load(inputs[recipe.source]);
        if (
          !Array.isArray(region) ||
          region.length !== 4 ||
          region.some((n) => !Number.isFinite(n)) ||
          region[0] < 0 ||
          region[1] < 0 ||
          region[2] <= 0 ||
          region[3] <= 0 ||
          region[0] + region[2] > original.width ||
          region[1] + region[3] > original.height
        )
          throw new Error(
            "Registration region must lie within the immutable source portrait.",
          );
        const pixels = (image, width, height, source) => {
          const c = document.createElement("canvas");
          c.width = width;
          c.height = height;
          const x = c.getContext("2d", { willReadFrequently: true });
          if (source) x.drawImage(image, ...source, 0, 0, width, height);
          else x.drawImage(image, 0, 0);
          return x.getImageData(0, 0, width, height).data;
        };
        const base = pixels(original, original.width, original.height),
          gray = (p, i) =>
            p[i] * 0.2126 + p[i + 1] * 0.7152 + p[i + 2] * 0.0722;
        const stride = Math.max(3, Math.sqrt((region[2] * region[3]) / 768));
        const points = [];
        for (let y = region[1] + 1; y < region[1] + region[3] - 1; y += stride)
          for (
            let x = region[0] + 1;
            x < region[0] + region[2] - 1;
            x += stride
          )
            points.push([
              x + 0.5,
              y + 0.5,
              gray(base, (Math.round(y) * original.width + Math.round(x)) * 4),
            ]);
        if (points.length < 16)
          throw new Error(
            "Registration region is too small; include at least a 16×16 pixel area of unchanged detail.",
          );
        const mean = points.reduce((a, p) => a + p[2], 0) / points.length;
        points.forEach((p) => (p[2] -= mean));
        const norm = Math.sqrt(points.reduce((a, p) => a + p[2] ** 2, 0));
        if (norm < 10)
          throw new Error(
            "Registration template lacks stable visual detail. Use the unchanged nose and surrounding skin.",
          );
        const result = [];
        for (const [name, sheet] of Object.entries(recipe.sheets)) {
          const image = await load(inputs[sheet.asset]),
            cw = image.width / sheet.columns,
            ch = image.height / sheet.rows,
            [rx, ry, rw, rh] = sheet.referenceRect,
            cx = rx + rw / 2,
            cy = ry + rh / 2;
          if (
            region[0] < rx ||
            region[1] < ry ||
            region[0] + region[2] > rx + rw ||
            region[1] + region[3] > ry + rh
          )
            throw new Error(
              `${name}: registration region must lie inside this sheet's reference rectangle.`,
            );
          const needed =
            name === "mouth"
              ? new Set([
                  ...Array.from(
                    "ABCDEF",
                    (shape, i) => recipe.mouth.frames?.[shape]?.cell ?? i,
                  ),
                  recipe.mouth.repairCell ?? 6,
                ])
              : name === "blink"
                ? new Set(
                    recipe.eyes.flatMap((eye) =>
                      (
                        eye.frames || [0, 1, 2, 3].map((cell) => ({ cell }))
                      ).map((f) => f.cell),
                    ),
                  )
                : name === "brows"
                  ? new Set(
                      (recipe.brows.frames || [{ cell: 0 }, { cell: 1 }]).map(
                        (f) => f.cell,
                      ),
                    )
                  : new Set([0]);
          for (let cell = 0; cell < sheet.columns * sheet.rows; cell++) {
            if (!needed.has(cell)) continue;
            if (sheet.registrations?.[String(cell)]) continue;
            const crop = pixels(image, Math.round(rw), Math.round(rh), [
              (cell % sheet.columns) * cw,
              Math.floor(cell / sheet.columns) * ch,
              cw,
              ch,
            ]);
            const lum = new Float32Array(Math.round(rw) * Math.round(rh));
            for (let i = 0; i < lum.length; i++) lum[i] = gray(crop, i * 4);
            const sample = (x, y) => {
              x = Math.max(0, Math.min(rw - 1, x));
              y = Math.max(0, Math.min(rh - 1, y));
              const a = Math.floor(x),
                b = Math.floor(y),
                fx = x - a,
                fy = y - b,
                at = (px, py) =>
                  lum[
                    Math.min(rh - 1, py) * Math.round(rw) + Math.min(rw - 1, px)
                  ];
              return (
                (at(a, b) * (1 - fx) + at(a + 1, b) * fx) * (1 - fy) +
                (at(a, b + 1) * (1 - fx) + at(a + 1, b + 1) * fx) * fy
              );
            };
            const score = (scale, dx, dy) => {
              const left = cx + (region[0] - cx - dx) / scale - rx,
                right = cx + (region[0] + region[2] - cx - dx) / scale - rx,
                top = cy + (region[1] - cy - dy) / scale - ry,
                bottom = cy + (region[1] + region[3] - cy - dy) / scale - ry;
              if (left < 0 || top < 0 || right >= rw || bottom >= rh) return -1;
              let sum = 0,
                square = 0,
                dot = 0;
              for (const [x, y, reference] of points) {
                const value = sample(
                  cx + (x - cx - dx) / scale - rx,
                  cy + (y - cy - dy) / scale - ry,
                );
                sum += value;
                square += value * value;
                dot += value * reference;
              }
              return (
                dot /
                (norm *
                  Math.sqrt(Math.max(1, square - (sum * sum) / points.length)))
              );
            };
            let best = { score: -1, scale: 1, dx: 0, dy: 0 };
            for (let si = -4; si <= 4; si++)
              for (let dx = -80; dx <= 80; dx += 4)
                for (let dy = -80; dy <= 80; dy += 4) {
                  const scale = 1 + si * 0.01,
                    value = score(scale, dx, dy);
                  if (value > best.score)
                    best = { score: value, scale, dx, dy };
                }
            const coarse = { ...best };
            // Translation quantization can make a neighboring coarse scale win.
            // Refine the whole supported scale range so the true fit stays reachable.
            for (let si = -25; si <= 25; si++)
              for (let xi = -8; xi <= 8; xi++)
                for (let yi = -8; yi <= 8; yi++) {
                  const scale = 1 + si * 0.002,
                    dx = coarse.dx + xi * 0.5,
                    dy = coarse.dy + yi * 0.5,
                    value = score(scale, dx, dy);
                  if (value > best.score)
                    best = { score: value, scale, dx, dy };
                }
            const s = best.scale,
              ox = (cell % sheet.columns) * cw,
              oy = Math.floor(cell / sheet.columns) * ch;
            result.push({
              sheet: name,
              cell,
              correlation: best.score,
              affine: [
                (rw / cw) * s,
                0,
                0,
                (rh / ch) * s,
                (rx - (ox * rw) / cw) * s + cx * (1 - s) + best.dx,
                (ry - (oy * rh) / ch) * s + cy * (1 - s) + best.dy,
              ],
              scale: s,
              translation: [best.dx, best.dy],
            });
          }
        }
        return result;
      },
      { recipe, inputs, region },
    );
  } finally {
    await browser.close();
    onBrowser?.(null);
  }
  const output = structuredClone(recipe);
  const [x, y, w, h] = region,
    portraitAnchors = [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
    ];
  for (const item of measurements) {
    if (item.correlation < minimumCorrelation)
      throw new Error(
        `${item.sheet} cell ${item.cell}: stable-region correlation ${item.correlation.toFixed(3)} is below ${minimumCorrelation}. Use manual anchors or a better edit.`,
      );
    output.sheets[item.sheet].registrations ||= {};
    output.sheets[item.sheet].registrations[item.cell] = {
      sourceAnchors: portraitAnchors.map((p) =>
        transformPoint(invertAffine(item.affine), p),
      ),
      portraitAnchors,
      maxErrorPixels: 1,
      method: "stable-template-ncc",
      correlation: item.correlation,
    };
  }
  return { recipe: output, measurements };
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const args = process.argv.slice(2),
    get = (k) => args[args.indexOf("--" + k) + 1];
  try {
    if (
      !args.includes("--recipe") ||
      !args.includes("--assets") ||
      !args.includes("--region") ||
      !args.includes("--output")
    )
      throw new Error(
        "Usage: register.mjs --recipe recipe.json --assets asset-map.json --region x,y,width,height --output registered-recipe.json",
      );
    const recipe = JSON.parse(await readFile(get("recipe"), "utf8")),
      assetFiles = JSON.parse(await readFile(get("assets"), "utf8")),
      region = get("region").split(",").map(Number);
    if (region.length !== 4 || region.some((n) => !Number.isFinite(n)))
      throw new Error("Registration region must be x,y,width,height.");
    const result = await registerSheets(recipe, { assetFiles, region });
    await writeFile(
      get("output"),
      JSON.stringify(result.recipe, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({ registered: true, measurements: result.measurements }),
    );
  } catch (error) {
    console.error(JSON.stringify({ valid: false, errors: [error.message] }));
    process.exitCode = 1;
  }
}
