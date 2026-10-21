import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { validateProject } from "../src/engine/validation";
import type { Background, Character } from "../src/engine/types";

export interface InstalledPack {
  id: string;
  name: string;
  localOnly: true;
  characterIds: string[];
  backgroundIds: string[];
  catalogUrl: string;
}
export interface CharacterLibrary {
  characters: Character[];
  backgrounds: Background[];
  packs: InstalledPack[];
  warnings: Array<{ packId: string; message: string }>;
}
const PACK_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/;
const skeleton = {
  schemaVersion: 1,
  id: "library-check",
  title: "Library validation",
  description: "",
  startNodeId: "end",
  nodes: [{ id: "end", type: "end", label: "End", text: "", position: 50 }],
};

/** Discover ordinary pack directories only. A broken or duplicate pack never hides the rest of the library. */
export async function discoverCharacterLibrary(
  projectRoot: string,
): Promise<CharacterLibrary> {
  const output: CharacterLibrary = {
    characters: [],
    backgrounds: [],
    packs: [],
    warnings: [],
  };
  const root = resolve(projectRoot, "public", "local-packs");
  let directories;
  try {
    directories = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return output;
    throw error;
  }
  const canonicalRoot = await realpath(root),
    backgroundIds = new Set<string>();
  const packIds = directories
    .filter((entry) => entry.isDirectory() && PACK_ID.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const packId of packIds.slice(0, 100)) {
    const warn = (message: string) => output.warnings.push({ packId, message });
    let catalog: Record<string, unknown>;
    try {
      const path = await realpath(join(root, packId, "catalog.json"));
      if (!path.startsWith(`${canonicalRoot}${sep}${packId}${sep}`))
        throw new Error("Catalog is outside its pack.");
      const info = await stat(path);
      if (!info.isFile() || info.size > 2 * 1024 * 1024)
        throw new Error("Catalog exceeds the 2 MB limit.");
      const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Catalog must be an object.");
      catalog = parsed as Record<string, unknown>;
      if (!Array.isArray(catalog.characters) || catalog.characters.length > 100)
        throw new Error("Catalog must contain at most 100 characters.");
      if (
        catalog.backgrounds !== undefined &&
        (!Array.isArray(catalog.backgrounds) ||
          catalog.backgrounds.length > 100)
      )
        throw new Error("Catalog must contain at most 100 backgrounds.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        warn(
          "The catalog is invalid, oversized, or outside its pack directory.",
        );
      continue;
    }
    const pack: InstalledPack = {
      id: packId,
      name:
        typeof catalog.name === "string" && catalog.name.trim()
          ? catalog.name.trim().slice(0, 140)
          : packId,
      localOnly: true,
      characterIds: [],
      backgroundIds: [],
      catalogUrl: `/local-packs/${encodeURIComponent(packId)}/catalog.json`,
    };
    for (const entry of catalog.characters as unknown[]) {
      const checked = validateProject({
        ...skeleton,
        characters: [entry],
        backgrounds: [],
      });
      if (!checked.valid) {
        warn(
          `Skipped a character with invalid project data (${checked.errors[0]?.path ?? "character"}).`,
        );
        continue;
      }
      const character = checked.project.characters[0];
      // Packs that share a character ID each add expressions; the first pack's details win.
      const existing = output.characters.find(
        (item) => item.id === character.id,
      );
      if (existing) {
        const poseIds = new Set(existing.poses.map((pose) => pose.id));
        const added = character.poses.filter((pose) => !poseIds.has(pose.id));
        if (added.length < character.poses.length)
          warn(
            `${character.name} already has an expression with the same ID from an earlier pack; the first pack in directory-name order wins.`,
          );
        if (!added.length) continue;
        existing.poses.push(...added);
        pack.characterIds.push(character.id);
        continue;
      }
      output.characters.push(character);
      pack.characterIds.push(character.id);
    }
    for (const entry of (catalog.backgrounds ?? []) as unknown[]) {
      const checked = validateProject({
        ...skeleton,
        characters: [],
        backgrounds: [entry],
      });
      if (!checked.valid) {
        warn(
          `Skipped a background with invalid project data (${checked.errors[0]?.path ?? "background"}).`,
        );
        continue;
      }
      const background = checked.project.backgrounds[0];
      if (backgroundIds.has(background.id)) {
        warn(
          `Background ID ${background.id} is already supplied by an earlier pack; the first pack in directory-name order wins.`,
        );
        continue;
      }
      backgroundIds.add(background.id);
      output.backgrounds.push(background);
      pack.backgroundIds.push(background.id);
    }
    output.packs.push(pack);
  }
  if (packIds.length > 100)
    output.warnings.push({
      packId: "",
      message: "Only the first 100 local packs are loaded.",
    });
  return output;
}
