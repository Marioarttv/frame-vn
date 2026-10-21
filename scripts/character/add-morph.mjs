#!/usr/bin/env node
/**
 * Adds expression-morph landmarks to installed packs built before they were part of the
 * manifest. Reads each pack's own authoring-recipe.json; touches nothing else.
 *
 *   node scripts/character/add-morph.mjs public/local-packs/my-character [more pack folders…]
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { morphLandmarks } from "./geometry.mjs";

for (const folder of process.argv.slice(2)) {
  const recipe = JSON.parse(await readFile(path.join(folder, "authoring-recipe.json"), "utf8"));
  const manifestPath = path.join(folder, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const sprite = manifest.sprites?.[recipe.pose.id];
  if (!sprite) throw new Error(`${folder}: the manifest has no sprite for ${recipe.pose.id}.`);
  sprite.morph = morphLandmarks(recipe);
  await writeFile(manifestPath, JSON.stringify(manifest));
  console.log(`${folder}: morph landmarks for ${recipe.pose.id}`);
}
