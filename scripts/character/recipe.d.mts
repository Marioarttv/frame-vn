import type {
  CharacterRecipe,
  DraftRecipeOptions,
  RecipeValidation,
} from "./schema";
export function createDraftRecipe(options: DraftRecipeOptions): CharacterRecipe;
export function validateRecipe(
  recipe: unknown,
  dimensions?: { width: number; height: number },
): RecipeValidation;
