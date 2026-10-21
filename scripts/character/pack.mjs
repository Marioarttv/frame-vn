#!/usr/bin/env node
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  mkdtemp,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { launchAuthoringBrowser } from "./browser.mjs";
import { validateRecipe } from "./recipe.mjs";
import { validatePackedCharacter } from "./validate.mjs";
import { registerSheets } from "./register.mjs";
import { attachVoice } from "./attach-voice.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const mime = (file) =>
  ({
    ".png": "image/png",
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
  })[path.extname(file).toLowerCase()];
const saveJson = (dir, name, value) =>
  writeFile(path.join(dir, name), JSON.stringify(value, null, 2) + "\n");
let activeBrowser = null;

/** Files are resolved by the trusted caller. Recipes themselves contain opaque asset IDs, never file paths. */
async function compileCharacterPack(
  recipe,
  { assetFiles, outputDirectory, urlRoot },
) {
  const check = validateRecipe(recipe);
  if (!check.valid) throw new Error(check.errors.join("\n"));
  if (
    typeof urlRoot !== "string" ||
    !/^\/(?:local-packs|assets\/characters)\/[a-z][a-z0-9_-]{1,63}$/.test(
      urlRoot,
    )
  )
    throw new Error(
      "urlRoot must be /local-packs/<pack-id> or /assets/characters/<pack-id>.",
    );
  const ids = [
    ...new Set([
      recipe.source,
      ...Object.values(recipe.sheets).map((sheet) => sheet.asset),
    ]),
  ];
  const assets = {},
    sourceHashes = {};
  let sourceBytes;
  for (const id of ids) {
    const file = assetFiles[id];
    if (typeof file !== "string" || !path.isAbsolute(file))
      throw new Error(`No resolved local file for asset ${id}.`);
    const contentType = mime(file);
    if (!contentType) throw new Error(`Asset ${id} must be PNG, WebP or JPEG.`);
    const bytes = await readFile(file);
    if (bytes.byteLength > 32 * 1024 * 1024)
      throw new Error(`Asset ${id} exceeds 32 MiB.`);
    sourceHashes[id] = sha(bytes);
    assets[id] = `data:${contentType};base64,${bytes.toString("base64")}`;
    if (id === recipe.source) sourceBytes = bytes;
  }
  if (
    recipe.sourceSha256 &&
    recipe.sourceSha256 !== sourceHashes[recipe.source]
  )
    throw new Error(
      "Source portrait hash changed; the calibration must be reviewed against the new image.",
    );
  if (recipe.autoRegister) {
    const registered = await registerSheets(recipe, {
      assetFiles,
      region: recipe.registrationRegion,
      onBrowser: (browser) => {
        activeBrowser = browser;
      },
    });
    recipe = registered.recipe;
    for (const result of registered.measurements)
      if (result.correlation < 0.9)
        check.warnings.push(
          `${result.sheet} cell ${result.cell}: alignment correlation ${result.correlation.toFixed(3)} needs careful visual review.`,
        );
  }
  const sourceExtension = path
    .extname(assetFiles[recipe.source])
    .slice(1)
    .toLowerCase();
  const bundle = await build({
    entryPoints: [path.join(here, "render-pack.mjs")],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "CharacterPacker",
    platform: "browser",
    target: ["es2022"],
  });
  const browser = await launchAuthoringBrowser();
  activeBrowser = browser;
  let result;
  try {
    const page = await browser.newPage();
    // The authoring worker has no network. Only caller-resolved image data enters the page.
    await page.route("**/*", (route) => route.abort());
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    result = await page.evaluate(
      (payload) => window.CharacterPacker.renderPack(payload),
      { recipe, assets, urlRoot, sourceExtension },
    );
  } finally {
    await browser.close();
    if (activeBrowser === browser) activeBrowser = null;
  }
  const dimensionCheck = validateRecipe(recipe, {
    width: result.width,
    height: result.height,
  });
  if (!dimensionCheck.valid) throw new Error(dimensionCheck.errors.join("\n"));
  await mkdir(outputDirectory, { recursive: true });
  const files = [],
    fileHashes = {};
  const sourceName = "portrait." + sourceExtension;
  try {
    const existing = await readFile(path.join(outputDirectory, sourceName));
    if (sha(existing) !== sourceHashes[recipe.source])
      throw new Error(
        "This output directory belongs to a different immutable portrait. Choose a new pack/output directory.",
      );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await copyFile(
      assetFiles[recipe.source],
      path.join(outputDirectory, sourceName),
    );
  }
  files.push(sourceName);
  fileHashes[sourceName] = sourceHashes[recipe.source];
  if (
    sha(await readFile(path.join(outputDirectory, sourceName))) !==
    sha(sourceBytes)
  )
    throw new Error("The source portrait copy was not byte-identical.");
  for (const [name, data] of Object.entries(result.images)) {
    const filename = name + ".png",
      bytes = Buffer.from(data, "base64");
    await writeFile(path.join(outputDirectory, filename), bytes);
    files.push(filename);
    fileHashes[filename] = sha(bytes);
  }
  Object.assign(result.sprite, {
    referencePortraitSha256: sourceHashes[recipe.source],
    sourceAtlasSha256: fileHashes["mouth.png"],
    baseSha256: fileHashes["repair.png"],
  });
  Object.assign(result.sprite.blink, {
    referencePortraitSha256: sourceHashes[recipe.source],
    sourceAtlasSha256: fileHashes["blink.png"],
  });
  const pose = {
    id: recipe.pose.id,
    name: recipe.pose.name,
    src: urlRoot + "/" + sourceName,
    rig: urlRoot + "/rig.json",
    capabilities: {
      mouth: true,
      blink: true,
      body: true,
      gaze: true,
      brows: true,
    },
    animation: {
      poseKey: recipe.pose.id,
      assetRoot: urlRoot,
      manifestUrl: urlRoot + "/manifest.json",
      speechIndexUrl: urlRoot + "/speech.json",
      browsIndexUrl: urlRoot + "/brows-index.json",
    },
  };
  const character = {
    ...recipe.character,
    description:
      recipe.character.description ||
      "A calibrated character pack built from your source portrait and localized image edits.",
    poses: [pose],
  };
  const catalog = {
    version: 1,
    id: recipe.pack.id,
    name: recipe.pack.name,
    localOnly: urlRoot.startsWith("/local-packs/"),
    characters: [character],
    authoring: {
      schemaVersion: 1,
      calibrationStatus: recipe.calibrationStatus || "draft",
      sourceSha256: sourceHashes[recipe.source],
      ...(recipe.provenance ? { provenance: recipe.provenance } : {}),
    },
  };
  const documents = {
    "manifest.json": {
      version: 1,
      sprites: { [recipe.pose.id]: result.sprite },
    },
    "rig.json": result.rig,
    "brows.json": result.brows,
    "gaze.json": result.gaze,
    "brows-index.json": {
      schemaVersion: 1,
      poses: { [recipe.pose.id]: urlRoot + "/brows.json" },
    },
    "speech.json": { lines: {} },
    "performance.json": { lines: {} },
    "catalog.json": catalog,
    "authoring-recipe.json": recipe,
    "provenance.json": {
      version: 1,
      sourceSha256: sourceHashes[recipe.source],
      sourceAssets: sourceHashes,
      files: fileHashes,
      recipeSha256: sha(Buffer.from(JSON.stringify(recipe))),
      ...(recipe.provenance ? { artwork: recipe.provenance } : {}),
      pixelPolicy:
        "Immutable source; deterministic registration, local color matching, masking and atlas packing of supplied edits only.",
    },
  };
  for (const [filename, data] of Object.entries(documents)) {
    await saveJson(outputDirectory, filename, data);
    files.push(filename);
  }
  const validation = await validatePackedCharacter(outputDirectory);
  validation.warnings = [
    ...new Set([
      ...check.warnings,
      ...dimensionCheck.warnings,
      ...validation.warnings,
    ]),
  ];
  validation.checks = {
    ...validation.checks,
    sourceCopiedByteIdentical: true,
    localizedEditsOutsideMaskUnchanged: true,
    ...result.stats,
  };
  await saveJson(outputDirectory, "validation.json", validation);
  files.push("validation.json");
  if (!validation.valid) throw new Error(validation.errors.join("\n"));
  return {
    character,
    catalog,
    validation,
    files,
    sourceSha256: sourceHashes[recipe.source],
  };
}

/** Rebuilding an installed local pack never invalidates the last working version on a failed edit. */
export async function buildCharacterPack(recipe, options) {
  const { outputDirectory, assetFiles, urlRoot } = options;
  let previous;
  try {
    previous = JSON.parse(
      await readFile(path.join(outputDirectory, "catalog.json"), "utf8"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return compileCharacterPack(recipe, options);
  }
  const sourceHash = sha(await readFile(assetFiles[recipe.source]));
  if (previous.authoring?.sourceSha256 !== sourceHash)
    throw new Error(
      "This output directory belongs to a different immutable portrait. Choose a new pack/output directory.",
    );
  const staging = await mkdtemp(
    path.join(
      path.dirname(outputDirectory),
      "." + path.basename(outputDirectory) + ".build-",
    ),
  );
  let movedPrevious = false,
    backup;
  try {
    const result = await compileCharacterPack(recipe, {
      ...options,
      outputDirectory: staging,
    });
    const oldCharacter = previous.characters?.[0],
      oldVoice = oldCharacter?.voice;
    if (
      oldVoice?.src?.startsWith(urlRoot + "/") &&
      oldVoice?.cueUrl?.startsWith(urlRoot + "/")
    ) {
      const local = (url) => {
        const value = url.slice(urlRoot.length + 1);
        if (value.split("/").includes("..") || value.includes("\\"))
          throw new Error("Existing sample voice escapes the pack.");
        return path.join(outputDirectory, value);
      };
      await attachVoice({
        packDirectory: staging,
        audioFile: local(oldVoice.src),
        cueFile: local(oldVoice.cueUrl),
        voiceId: recipe.character.voiceId || oldCharacter.voiceId,
      });
      result.catalog = JSON.parse(
        await readFile(path.join(staging, "catalog.json"), "utf8"),
      );
      result.character = result.catalog.characters[0];
      result.validation = JSON.parse(
        await readFile(path.join(staging, "validation.json"), "utf8"),
      );
      result.files.push(
        path.basename(oldVoice.src),
        path.basename(oldVoice.cueUrl),
      );
    }
    // Retain the previous generated pack as a hidden recovery snapshot. Library discovery ignores it.
    backup = path.join(
      path.dirname(outputDirectory),
      "." + path.basename(outputDirectory) + ".previous-" + Date.now(),
    );
    await rename(outputDirectory, backup);
    movedPrevious = true;
    await rename(staging, outputDirectory);
    return result;
  } catch (error) {
    if (movedPrevious) await rename(backup, outputDirectory);
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

const isEntry =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isEntry) {
  for (const [signal, exitCode] of [
    ["SIGTERM", 143],
    ["SIGINT", 130],
  ])
    process.once(signal, async () => {
      const fallback = setTimeout(() => process.exit(exitCode), 5000);
      fallback.unref();
      try {
        await activeBrowser?.close();
      } finally {
        process.exit(exitCode);
      }
    });
  const args = process.argv.slice(2),
    arg = (name) => {
      const i = args.indexOf("--" + name);
      return i >= 0 ? args[i + 1] : undefined;
    };
  const outputDirectory = arg("output") ? path.resolve(arg("output")) : null;
  try {
    if (
      !arg("recipe") ||
      !arg("assets") ||
      !outputDirectory ||
      !arg("url-root")
    )
      throw new Error(
        "Usage: node scripts/character/pack.mjs --recipe recipe.json --assets asset-map.json --output output-directory --url-root /local-packs/pack-id",
      );
    const recipe = JSON.parse(
        await readFile(path.resolve(arg("recipe")), "utf8"),
      ),
      assetFiles = JSON.parse(
        await readFile(path.resolve(arg("assets")), "utf8"),
      );
    console.log(
      JSON.stringify(
        await buildCharacterPack(recipe, {
          assetFiles,
          outputDirectory,
          urlRoot: arg("url-root"),
        }),
      ),
    );
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error))
      .replace(/^page\.evaluate:\s*/, "")
      .split(/\n\s+at /)[0];
    const diagnostic = { valid: false, errors: [message], warnings: [] };
    if (outputDirectory) {
      let installed = false;
      try {
        await readFile(path.join(outputDirectory, "catalog.json"));
        installed = true;
      } catch {}
      if (!installed) {
        await mkdir(outputDirectory, { recursive: true });
        await saveJson(outputDirectory, "validation.json", diagnostic);
      }
    }
    console.error(JSON.stringify(diagnostic));
    process.exitCode = 1;
  }
}
