#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { assertTransitions, triangleArea } from "./geometry.mjs";

const load = async (dir, file) =>
  JSON.parse(await readFile(path.join(dir, file), "utf8"));
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const rectValid = (r) =>
  r &&
  ["x", "y", "width", "height"].every((key) => finite(r[key])) &&
  r.x >= 0 &&
  r.y >= 0 &&
  r.width > 0 &&
  r.height > 0;
const pointValid = (p) => Array.isArray(p) && p.length === 2 && p.every(finite);
const polygonValid = (p) =>
  Array.isArray(p) && p.length >= 3 && p.every(pointValid);

export async function validatePackedCharacter(directory) {
  const errors = [],
    warnings = [],
    checks = {};
  try {
    const catalog = await load(directory, "catalog.json"),
      manifest = await load(directory, "manifest.json"),
      brows = await load(directory, "brows.json"),
      gaze = await load(directory, "gaze.json"),
      rig = await load(directory, "rig.json"),
      provenance = await load(directory, "provenance.json");
    const character = catalog.characters?.[0],
      pose = character?.poses?.[0],
      sprite = manifest.sprites?.[pose?.id];
    if (!pose || !sprite)
      throw new Error("Catalog pose is missing from its manifest.");
    const root = pose.animation.assetRoot;
    const localFile = (url) => {
      if (typeof url !== "string" || !url.startsWith(root + "/"))
        throw new Error("Runtime reference escapes this pack: " + String(url));
      const name = url.slice(root.length + 1);
      if (name.split("/").includes("..") || name.includes("\\"))
        throw new Error("Unsafe pack reference.");
      return name;
    };
    const visited = new Set();
    async function walk(value) {
      if (Array.isArray(value)) {
        for (const item of value) await walk(item);
        return;
      }
      if (value && typeof value === "object") {
        for (const item of Object.values(value)) await walk(item);
        return;
      }
      if (typeof value === "string" && value.startsWith(root + "/")) {
        const name = localFile(value);
        if (visited.has(name)) return;
        visited.add(name);
        await stat(path.join(directory, name));
        if (name.endsWith(".json")) await walk(await load(directory, name));
      }
    }
    await walk(catalog);
    checks.assetClosure = visited.size;
    for (const [file, expected] of Object.entries(provenance.files || {})) {
      if (file.split("/").includes("..") || path.isAbsolute(file))
        throw new Error("Unsafe provenance file.");
      const actual = createHash("sha256")
        .update(await readFile(path.join(directory, file)))
        .digest("hex");
      if (actual !== expected) throw new Error("Asset hash changed: " + file);
    }
    checks.assetHashesVerified = Object.keys(provenance.files || {}).length;
    const inside = (r) =>
      rectValid(r) &&
      r.x + r.width <= sprite.sourceWidth &&
      r.y + r.height <= sprite.sourceHeight;
    // A silent character (an animal, say) ships without a mouth rig: its pose declares
    // `capabilities.mouth: false` and the manifest carries no mouth crop. Everything else,
    // blinks included, is validated as usual.
    const silent = pose.capabilities?.mouth === false;
    if (silent) {
      if (sprite.mouth)
        throw new Error("A pose without mouth capability must not ship a mouth crop.");
      checks.mouth = "none (silent pose)";
    } else {
      if (!inside(sprite.mouth))
        throw new Error("Mouth crop is outside the source portrait.");
      const frames = [..."ABCDEFX"].map((key) => sprite.frames?.[key]?.landmarks);
      if (
        frames.some(
          (points) =>
            !Array.isArray(points) ||
            points.length !== 25 ||
            points.some((p) => !pointValid(p) || p.some((n) => n < 0 || n > 1)),
        )
      )
        throw new Error(
          "Mouth geometry must contain 25 normalized points for A–F/X.",
        );
      if (sprite.meshTriangles?.length !== 40)
        throw new Error("Mouth mesh must contain 40 triangles.");
      assertTransitions(frames, sprite.meshTriangles, "Mouth", true);
      checks.mouthTransitionPairs = 49;
    }
    if (sprite.originalRest !== true)
      throw new Error("Source-portrait rest reconstruction must be enabled.");
    if (![1, 2].includes(sprite.blink?.eyes?.length))
      throw new Error("Every visible eye needs independent blink metadata.");
    for (const eye of sprite.blink.eyes) {
      if (!inside(eye.rect))
        throw new Error("Eye rectangle is outside the source portrait.");
      if (
        !polygonValid(eye.maskPolygon) ||
        eye.maskPolygon.some((p) => p.some((n) => n < 0 || n > 1))
      )
        throw new Error(
          "Eye support mask must be normalized inside its rectangle.",
        );
      if (
        eye.frames?.length !== 5 ||
        eye.frames.some((frame, i) => frame.closure !== i / 4)
      )
        throw new Error(
          "Blink keyframes must cover exact open and four closure levels.",
        );
      assertTransitions(
        eye.frames.map((f) => f.landmarks),
        eye.triangles,
        "Eye " + eye.id,
      );
      checks[eye.id + "Blink"] = true;
    }
    if (!inside(brows.rect) || !rectValid(brows.maskRect))
      throw new Error("Brow crop or mask is invalid.");
    if (
      brows.frames?.length !== 3 ||
      brows.frames.some((frame, i) => frame.value !== i - 1)
    )
      throw new Error("Brows need furrow, exact original, and raise states.");
    assertTransitions(
      brows.frames.map((f) => f.landmarks),
      brows.triangles,
      "Brows",
      true,
    );
    checks.brows = true;
    if (
      gaze.eyes?.length !== sprite.blink.eyes.length ||
      gaze.eyes.some(
        (eye) =>
          !inside(eye.rect) ||
          !rectValid(eye.sourceRect) ||
          ![
            eye.iris?.x,
            eye.iris?.y,
            eye.iris?.radiusX,
            eye.iris?.radiusY,
            eye.maxShiftX,
            eye.maxShiftY,
          ].every(finite),
      )
    )
      throw new Error(
        "Gaze requires one registered sclera patch and original iris mask per visible eye.",
      );
    checks.gaze = true;
    if (
      rig.sourceWidth !== sprite.sourceWidth ||
      rig.sourceHeight !== sprite.sourceHeight
    )
      throw new Error("Body rig dimensions differ from the source portrait.");
    if (
      !pointValid(rig.head?.pivot) ||
      !(
        rig.head.rigidUntil < rig.head.anchoredFrom &&
        rig.head.anchoredFrom <= 1024
      )
    )
      throw new Error("Head/body anchors are out of order.");
    if (!(
      rig.breathing?.fixedTop >= 0 &&
      rig.breathing.fixedTop <= 1000 &&
      rig.breathing.vertical >= 0 &&
      rig.breathing.vertical <= 8 &&
      rig.breathing.horizontal >= 0 &&
      rig.breathing.horizontal <= 4
    ))
      throw new Error(
        "Breathing exceeds the supported safe deformation range.",
      );
    if (!Array.isArray(rig.hair) || rig.hair.length > 3)
      throw new Error(
        "Body rig supports at most three calibrated hair regions.",
      );
    if (!(
      rig.jaw?.top < rig.jaw.full &&
      rig.jaw.full <= rig.jaw.chin &&
      rig.jaw.chin < rig.jaw.neck &&
      rig.jaw.neck <= 1024 &&
      rig.jaw.drop > 0 &&
      rig.jaw.drop <= (rig.jaw.neck - rig.jaw.chin) / 1.6
    ))
      throw new Error("Jaw motion would fold the neck region.");
    if (!rig.cheeks?.radius?.every((n) => finite(n) && n > 4 && n <= 400))
      throw new Error("Cheek radii are invalid.");
    checks.body = {
      head: true,
      jaw: true,
      cheeks: true,
      hairRegions: rig.hair.length,
      clothing: true,
    };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return { valid: errors.length === 0, errors, warnings, checks };
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const directory = process.argv[2];
  if (!directory) {
    console.error(
      "Usage: node scripts/character/validate.mjs <pack-directory>",
    );
    process.exitCode = 1;
  } else {
    const result = await validatePackedCharacter(path.resolve(directory));
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) process.exitCode = 1;
  }
}
