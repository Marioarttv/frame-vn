import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { ApiError } from "./voice-service";
import {
  discoverCharacterLibrary,
  type InstalledPack,
} from "./character-library";
import { validateProject } from "../src/engine/validation";
import type { Character } from "../src/engine/types";
import {
  validateRecipe,
  type CharacterRecipe,
} from "../scripts/character/schema";

const run = promisify(execFile);
export const MAX_ASSET_BYTES = 12 * 1024 * 1024;
export const MAX_ASSET_BODY_BYTES = 17 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9_-]{1,63}$/;
const TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;
type ImageMime = keyof typeof TYPES;
export interface CharacterAsset {
  assetId: string;
  src: string;
  width: number;
  height: number;
  mime: ImageMime;
  bytes: number;
  name: string;
}
export interface RegistrationDiagnostic {
  sheet: string;
  cell: number;
  correlation?: number;
  method?: string;
  rmsPixels?: number;
  translation?: [number, number];
  scale?: number;
}
export interface CharacterBuildResult {
  pack: InstalledPack;
  character: Character;
  recipe: CharacterRecipe;
  recipeUrl: string;
  validation: {
    valid: true;
    sourceAssetsPreserved: true;
    warnings: string[];
    registration: RegistrationDiagnostic[];
  };
}
export interface CharacterCompilerInput {
  recipe: Record<string, unknown>;
  assetFiles: Record<string, string>;
  outputDirectory: string;
  urlRoot: string;
  workDirectory: string;
}
export interface CharacterCompilerReport {
  validation: {
    valid: boolean;
    errors?: string[];
    warnings?: string[];
    checks?: Record<string, unknown>;
  };
}
export interface CharacterServiceOptions {
  root: string;
  compile?: (
    input: CharacterCompilerInput,
  ) => Promise<CharacterCompilerReport | void>;
}

/** Builds time out after three minutes; an older lock was left by an interrupted server. */
const STALE_LOCK_MS = 10 * 60 * 1000;

async function claimLock(path: string): Promise<boolean> {
  const claim = () =>
    writeFile(path, randomUUID(), { flag: "wx", mode: 0o600 }).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "EEXIST") return false;
        throw error;
      },
    );
  if (await claim()) return true;
  const info = await stat(path).catch(() => undefined);
  if (!info || Date.now() - info.mtimeMs < STALE_LOCK_MS) return false;
  await rm(path, { force: true });
  return claim();
}

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function object(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ApiError(
      400,
      "invalid_character_request",
      `${label} must be an object.`,
    );
  return input as Record<string, unknown>;
}
function safeId(input: unknown, label: string): string {
  if (typeof input !== "string" || !ID.test(input))
    throw new ApiError(
      400,
      "invalid_character_id",
      `${label} must contain 2–64 lowercase letters, numbers, dashes or underscores, starting with a letter.`,
    );
  return input;
}
function registrationDiagnostics(
  report: CharacterCompilerReport | void,
): RegistrationDiagnostic[] {
  const entries = report?.validation.checks?.registration;
  if (!Array.isArray(entries)) return [];
  return entries.slice(0, 256).flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const value = entry as Record<string, unknown>;
    if (
      typeof value.sheet !== "string" ||
      !["mouth", "blink", "brows", "gaze"].includes(value.sheet) ||
      !Number.isInteger(value.cell) ||
      (value.cell as number) < 0 ||
      (value.cell as number) > 63
    )
      return [];
    const item: RegistrationDiagnostic = {
      sheet: value.sheet,
      cell: value.cell as number,
    };
    if (
      typeof value.correlation === "number" &&
      Number.isFinite(value.correlation) &&
      value.correlation >= -1 &&
      value.correlation <= 1
    )
      item.correlation = value.correlation;
    if (typeof value.method === "string")
      item.method = value.method.slice(0, 100);
    if (
      typeof value.rmsPixels === "number" &&
      Number.isFinite(value.rmsPixels) &&
      value.rmsPixels >= 0
    )
      item.rmsPixels = value.rmsPixels;
    if (
      Array.isArray(value.translation) &&
      value.translation.length === 2 &&
      value.translation.every(
        (n) => typeof n === "number" && Number.isFinite(n),
      )
    )
      item.translation = value.translation as [number, number];
    if (
      typeof value.scale === "number" &&
      Number.isFinite(value.scale) &&
      value.scale > 0
    )
      item.scale = value.scale;
    return [item];
  });
}
/** Read only format headers; the compiler subsequently fully decodes each uploaded image. */
export function imageDimensions(
  bytes: Buffer,
  mime: ImageMime,
): { width: number; height: number } {
  let width = 0,
    height = 0;
  if (
    mime === "image/png" &&
    bytes.length >= 33 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  ) {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (
    mime === "image/webp" &&
    bytes.length >= 30 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    const format = bytes.toString("ascii", 12, 16);
    if (format === "VP8X") {
      width = bytes.readUIntLE(24, 3) + 1;
      height = bytes.readUIntLE(27, 3) + 1;
    } else if (
      format === "VP8 " &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    ) {
      width = bytes.readUInt16LE(26) & 0x3fff;
      height = bytes.readUInt16LE(28) & 0x3fff;
    } else if (format === "VP8L" && bytes[20] === 0x2f) {
      width = 1 + bytes[21] + ((bytes[22] & 0x3f) << 8);
      height =
        1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10);
    }
  } else if (
    mime === "image/jpeg" &&
    bytes.length > 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8
  ) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        length >= 7
      ) {
        height = bytes.readUInt16BE(offset + 3);
        width = bytes.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  }
  if (
    !width ||
    !height ||
    width > 8192 ||
    height > 8192 ||
    width * height > 32_000_000
  )
    throw new ApiError(
      400,
      "invalid_image",
      "Use a valid PNG, JPEG or WebP image up to 8,192 pixels per side and 32 megapixels.",
    );
  return { width, height };
}

function validateRecipeEnvelope(value: unknown): {
  recipe: Record<string, unknown>;
  packId: string;
  characterId: string;
  assetIds: string[];
} {
  const request = object(value, "Request"),
    recipe = object(request.recipe, "Recipe");
  if (recipe.schemaVersion !== 1)
    throw new ApiError(
      400,
      "invalid_recipe",
      "Use character recipe schema version 1.",
    );
  const pack = object(recipe.pack, "Pack"),
    character = object(recipe.character, "Character"),
    pose = object(recipe.pose, "Pose");
  const packId = safeId(pack.id, "Pack ID"),
    characterId = safeId(character.id, "Character ID");
  safeId(pose.id, "Pose ID");
  for (const [label, entry] of [
    ["Pack", pack],
    ["Character", character],
    ["Pose", pose],
  ] as const) {
    if (
      typeof entry.name !== "string" ||
      !entry.name.trim() ||
      entry.name.length > 140
    )
      throw new ApiError(
        400,
        "invalid_recipe",
        `${label} name must contain 1–140 characters.`,
      );
  }
  let nodes = 0;
  function bounded(input: unknown, depth = 0): void {
    if (++nodes > 20_000 || depth > 16)
      throw new ApiError(
        400,
        "invalid_recipe",
        "The character recipe is too complex.",
      );
    if (
      typeof input === "number" &&
      (!Number.isFinite(input) || Math.abs(input) > 1_000_000)
    )
      throw new ApiError(
        400,
        "invalid_recipe",
        "Recipe numbers must be finite, bounded coordinates.",
      );
    if (typeof input === "string" && input.length > 2000)
      throw new ApiError(
        400,
        "invalid_recipe",
        "A recipe text field exceeds its size limit.",
      );
    if (Array.isArray(input)) {
      if (input.length > 1000)
        throw new ApiError(
          400,
          "invalid_recipe",
          "A recipe array exceeds its size limit.",
        );
      input.forEach((item) => bounded(item, depth + 1));
    } else if (input && typeof input === "object") {
      const entries = Object.entries(input);
      if (
        entries.length > 100 ||
        entries.some(([key]) =>
          ["__proto__", "constructor", "prototype"].includes(key),
        )
      )
        throw new ApiError(
          400,
          "invalid_recipe",
          "The recipe contains unsupported object keys.",
        );
      entries.forEach(([, item]) => bounded(item, depth + 1));
    }
  }
  bounded(recipe);
  const sheets = object(recipe.sheets, "Sheets"),
    assets: unknown[] = [recipe.source];
  for (const sheet of Object.values(sheets))
    assets.push(object(sheet, "Sheet").asset);
  if (
    assets.length > 12 ||
    assets.some((asset) => typeof asset !== "string" || !HASH.test(asset))
  )
    throw new ApiError(
      400,
      "invalid_asset_id",
      "Recipe images must reference uploaded asset IDs, never file paths or URLs.",
    );
  return {
    recipe,
    packId,
    characterId,
    assetIds: [...new Set(assets as string[])],
  };
}

export class CharacterService {
  readonly root: string;
  readonly assetsDirectory: string;
  private readonly dataDirectory: string;
  private readonly compile: (
    input: CharacterCompilerInput,
  ) => Promise<CharacterCompilerReport | void>;
  constructor(options: CharacterServiceOptions) {
    this.root = resolve(options.root);
    this.dataDirectory = join(this.root, ".studio", "characters");
    this.assetsDirectory = join(this.dataDirectory, "assets");
    this.compile =
      options.compile ??
      (async (input) => {
        const recipePath = join(input.workDirectory, "recipe.json"),
          assetsPath = join(input.workDirectory, "assets.json");
        await writeFile(recipePath, JSON.stringify(input.recipe), {
          mode: 0o600,
        });
        await writeFile(assetsPath, JSON.stringify(input.assetFiles), {
          mode: 0o600,
        });
        const result = await run(
          process.execPath,
          [
            join(this.root, "scripts", "character", "pack.mjs"),
            "--recipe",
            recipePath,
            "--assets",
            assetsPath,
            "--output",
            input.outputDirectory,
            "--url-root",
            input.urlRoot,
          ],
          { cwd: this.root, timeout: 180_000, maxBuffer: 1024 * 1024 },
        );
        const report = JSON.parse(result.stdout) as CharacterCompilerReport;
        if (report.validation?.valid !== true)
          throw new Error(
            "The compiler did not confirm its validation checks.",
          );
        return report;
      });
  }
  async upload(value: unknown): Promise<CharacterAsset> {
    const input = object(value, "Upload");
    if (typeof input.dataUrl !== "string")
      throw new ApiError(
        400,
        "invalid_image",
        "Upload a PNG, JPEG or WebP data URL.",
      );
    const match =
      /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
        input.dataUrl,
      );
    if (!match || match[2].length % 4 !== 0)
      throw new ApiError(
        400,
        "invalid_image",
        "Upload a PNG, JPEG or WebP base64 data URL.",
      );
    if (match[2].length > Math.ceil(MAX_ASSET_BYTES / 3) * 4)
      throw new ApiError(
        413,
        "image_too_large",
        "Each source image must be at most 12 MB.",
      );
    const bytes = Buffer.from(match[2], "base64"),
      mime = match[1] as ImageMime;
    if (
      !bytes.length ||
      bytes.length > MAX_ASSET_BYTES ||
      bytes.toString("base64") !== match[2]
    )
      throw new ApiError(
        400,
        "invalid_image",
        "The image data is not valid canonical base64.",
      );
    const dimensions = imageDimensions(bytes, mime),
      assetId = hash(bytes),
      extension = TYPES[mime];
    const asset: CharacterAsset = {
      assetId,
      src: `/character-assets/${assetId}.${extension}`,
      ...dimensions,
      mime,
      bytes: bytes.length,
      name:
        typeof input.name === "string" && input.name.trim()
          ? input.name.trim().slice(0, 140)
          : `Source ${assetId.slice(0, 8)}`,
    };
    await mkdir(this.assetsDirectory, { recursive: true, mode: 0o700 });
    // Identical uploaded bytes share the immutable source; names never become filesystem paths.
    const sourcePath = join(this.assetsDirectory, `${assetId}.${extension}`);
    try {
      await writeFile(sourcePath, bytes, { flag: "wx", mode: 0o400 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const path = await realpath(sourcePath),
        root = await realpath(this.assetsDirectory);
      if (
        !path.startsWith(`${root}${sep}`) ||
        hash(await readFile(path)) !== assetId
      )
        throw new ApiError(
          409,
          "asset_integrity",
          "The stored source copy does not match its content ID. Repair the local asset store before reusing it.",
        );
    }
    await writeFile(
      join(this.assetsDirectory, `${assetId}.json`),
      JSON.stringify(asset),
      { mode: 0o600 },
    );
    return asset;
  }
  async asset(assetId: string): Promise<CharacterAsset> {
    if (!HASH.test(assetId))
      throw new ApiError(404, "asset_unavailable", "Source image not found.");
    try {
      const asset = JSON.parse(
        await readFile(join(this.assetsDirectory, `${assetId}.json`), "utf8"),
      ) as CharacterAsset;
      if (asset.assetId !== assetId || !Object.hasOwn(TYPES, asset.mime))
        throw new Error("invalid metadata");
      const path = await realpath(
          join(this.assetsDirectory, `${assetId}.${TYPES[asset.mime]}`),
        ),
        root = await realpath(this.assetsDirectory);
      if (!path.startsWith(`${root}${sep}`) || !(await stat(path)).isFile())
        throw new Error("source missing");
      return {
        ...asset,
        src: `/character-assets/${assetId}.${TYPES[asset.mime]}`,
      };
    } catch {
      throw new ApiError(
        404,
        "asset_unavailable",
        "Source image metadata is missing. Upload the original image again.",
      );
    }
  }
  async build(value: unknown): Promise<CharacterBuildResult> {
    const { recipe, packId, characterId, assetIds } =
      validateRecipeEnvelope(value);
    const packRoot = join(this.root, "public", "local-packs"),
      target = join(packRoot, packId),
      workRoot = join(this.dataDirectory, "builds");
    await Promise.all([
      mkdir(packRoot, { recursive: true }),
      mkdir(workRoot, { recursive: true, mode: 0o700 }),
    ]);
    const lockPath = join(workRoot, `${packId}.pack.lock`),
      characterLockPath = join(workRoot, `${characterId}.character.lock`);
    if (!(await claimLock(lockPath)))
      throw new ApiError(
        409,
        "character_build_in_progress",
        "This pack is already being built. Wait for that build to finish.",
      );
    let directory: string | undefined;
    let ownsCharacterLock = false;
    try {
      if (!(await claimLock(characterLockPath)))
        throw new ApiError(
          409,
          "character_build_in_progress",
          "This character is already being built in another pack.",
        );
      ownsCharacterLock = true;
      try {
        await stat(target);
        throw new ApiError(
          409,
          "pack_exists",
          "That pack ID already exists. Choose a new pack ID to preserve the installed character.",
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      // A new pack may add an expression to an installed character, never replace one.
      const library = await discoverCharacterLibrary(this.root);
      const poseId = String((recipe.pose as Record<string, unknown>).id);
      if (
        library.characters.some(
          (character) =>
            character.id === characterId &&
            character.poses.some((pose) => pose.id === poseId),
        )
      )
        throw new ApiError(
          409,
          "pose_exists",
          "That character already has an expression with this ID. Choose a new expression ID.",
        );
      const assetFiles: Record<string, string> = {},
        canonicalAssets = await realpath(this.assetsDirectory).catch(() => "");
      let sourceDimensions: { width: number; height: number } | undefined;
      for (const assetId of assetIds) {
        try {
          const info = JSON.parse(
            await readFile(
              join(this.assetsDirectory, `${assetId}.json`),
              "utf8",
            ),
          ) as CharacterAsset;
          if (!Object.hasOwn(TYPES, info.mime) || info.assetId !== assetId)
            throw new Error("bad metadata");
          const path = await realpath(
            join(this.assetsDirectory, `${assetId}.${TYPES[info.mime]}`),
          );
          if (
            !canonicalAssets ||
            !path.startsWith(`${canonicalAssets}${sep}`) ||
            hash(await readFile(path)) !== assetId
          )
            throw new Error("source changed");
          assetFiles[assetId] = path;
          if (assetId === recipe.source)
            sourceDimensions = { width: info.width, height: info.height };
        } catch {
          throw new ApiError(
            400,
            "asset_unavailable",
            `Source image ${assetId.slice(0, 8)} is missing or changed. Upload it again.`,
          );
        }
      }
      let recipeCheck;
      try {
        recipeCheck = validateRecipe(recipe, sourceDimensions);
      } catch {
        throw new ApiError(
          400,
          "invalid_recipe",
          "The recipe contains malformed facial calibration or frame arrays.",
        );
      }
      if (!recipeCheck.valid)
        throw new ApiError(
          400,
          "invalid_recipe",
          recipeCheck.errors[0] ?? "The calibration recipe is invalid.",
          { issues: recipeCheck.errors.slice(0, 20) },
        );
      directory = await mkdtemp(join(workRoot, "build-"));
      const outputDirectory = join(directory, "pack"),
        urlRoot = `/local-packs/${packId}`;
      let compilerReport: CharacterCompilerReport | void;
      try {
        compilerReport = await this.compile({
          recipe,
          assetFiles,
          outputDirectory,
          urlRoot,
          workDirectory: directory,
        });
        if (compilerReport && compilerReport.validation?.valid !== true)
          throw new Error("compiler validation failed");
      } catch {
        let issues: string[] = [];
        try {
          const reportPath = join(outputDirectory, "validation.json");
          if ((await stat(reportPath)).size <= 256 * 1024) {
            const report = JSON.parse(await readFile(reportPath, "utf8"));
            if (Array.isArray(report.errors))
              issues = report.errors
                .filter(
                  (item: unknown): item is string => typeof item === "string",
                )
                .slice(0, 20)
                .map((item: string) => item.slice(0, 500));
          }
        } catch {
          /* Some tool-start and timeout failures cannot produce calibration diagnostics. */
        }
        throw new ApiError(
          422,
          "character_build_failed",
          issues[0] ??
            "The calibrated recipe could not be compiled. Check its image sheets, face regions and control points. Existing packs and source artwork are preserved.",
          { issues },
        );
      }
      let catalog: Record<string, unknown>;
      try {
        catalog = JSON.parse(
          await readFile(join(outputDirectory, "catalog.json"), "utf8"),
        );
      } catch {
        throw new ApiError(
          422,
          "invalid_character_output",
          "The character compiler did not produce a valid catalog.",
        );
      }
      const checked = validateProject({
        schemaVersion: 1,
        id: "build-check",
        title: "Character build validation",
        description: "",
        startNodeId: "end",
        nodes: [
          { id: "end", type: "end", label: "End", text: "", position: 50 },
        ],
        characters: catalog.characters,
        backgrounds: [],
      });
      if (
        !checked.valid ||
        checked.project.characters.length !== 1 ||
        checked.project.characters[0].id !== characterId ||
        checked.project.characters[0].poses.length !== 1 ||
        checked.project.characters[0].poses[0].id !==
          (recipe.pose as Record<string, unknown>).id
      )
        throw new ApiError(
          422,
          "invalid_character_output",
          "The compiled character does not match its recipe or portable project schema.",
        );
      let effectiveRecipe = recipe;
      const effectiveRecipePath = join(
        outputDirectory,
        "authoring-recipe.json",
      );
      try {
        if ((await stat(effectiveRecipePath)).size > 1024 * 1024)
          throw new Error("Compiled recipe is too large.");
        const compiled = validateRecipeEnvelope({
          recipe: JSON.parse(await readFile(effectiveRecipePath, "utf8")),
        });
        const consistent =
          compiled.packId === packId &&
          compiled.characterId === characterId &&
          compiled.recipe.source === recipe.source &&
          (compiled.recipe.pose as Record<string, unknown>).id ===
            (recipe.pose as Record<string, unknown>).id &&
          JSON.stringify([...compiled.assetIds].sort()) ===
            JSON.stringify([...assetIds].sort());
        if (
          !consistent ||
          !validateRecipe(compiled.recipe, sourceDimensions).valid
        )
          throw new Error(
            "Compiler changed the recipe identity or asset references.",
          );
        if (
          recipe.calibrationStatus !== "reviewed" &&
          compiled.recipe.calibrationStatus === "reviewed"
        )
          throw new Error("Automatic fitting cannot grant visual approval.");
        effectiveRecipe = compiled.recipe;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          throw new ApiError(
            422,
            "invalid_character_output",
            "The compiler did not preserve a valid fitted recipe with the original identity and source images.",
          );
        await writeFile(effectiveRecipePath, JSON.stringify(recipe, null, 2), {
          mode: 0o600,
        });
      }
      for (const [assetId, path] of Object.entries(assetFiles))
        if (hash(await readFile(path)) !== assetId)
          throw new ApiError(
            500,
            "source_modified",
            "The compiler changed a source image. The build was not installed.",
          );
      const character = checked.project.characters[0];
      // Keep both: auto-registration may have added fitted anchors to the compiler's authoring recipe.
      await writeFile(
        join(outputDirectory, "submitted-recipe.json"),
        JSON.stringify(recipe, null, 2),
        { mode: 0o600 },
      );
      await rename(outputDirectory, target);
      const pack: InstalledPack = {
        id: packId,
        name: String((recipe.pack as Record<string, unknown>).name),
        localOnly: true,
        characterIds: [characterId],
        backgroundIds: [],
        catalogUrl: `${urlRoot}/catalog.json`,
      };
      const compilerWarnings =
        compilerReport?.validation.warnings?.filter(
          (item) => typeof item === "string",
        ) ?? [];
      return {
        pack,
        character,
        recipe: effectiveRecipe as unknown as CharacterRecipe,
        recipeUrl: `${urlRoot}/authoring-recipe.json`,
        validation: {
          valid: true,
          sourceAssetsPreserved: true,
          warnings: [
            ...new Set([
              ...recipeCheck.warnings,
              ...compilerWarnings,
              ...checked.warnings.map((item) => item.message),
            ]),
          ],
          registration: registrationDiagnostics(compilerReport),
        },
      };
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
      if (ownsCharacterLock) await rm(characterLockPath, { force: true });
      await rm(lockPath, { force: true });
    }
  }
}
