import type { CharacterRecipe, RecipeValidation } from "./schema";
import type { Character } from "../../src/engine/types";
export interface PackedValidation extends RecipeValidation {
  checks: Record<string, unknown>;
}
export interface CharacterBuildOptions {
  assetFiles: Record<string, string>;
  outputDirectory: string;
  urlRoot: string;
}
export interface CharacterBuildResult {
  character: Character;
  catalog: { characters: Character[]; [key: string]: unknown };
  validation: PackedValidation;
  files: string[];
  sourceSha256: string;
}
export function buildCharacterPack(
  recipe: CharacterRecipe,
  options: CharacterBuildOptions,
): Promise<CharacterBuildResult>;
