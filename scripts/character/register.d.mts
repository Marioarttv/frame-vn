import type { Browser } from "@playwright/test";
import type { CharacterRecipe, Rect } from "./schema";
export interface RegistrationMeasurement {
  sheet: string;
  cell: number;
  correlation: number;
  affine: number[];
  scale: number;
  translation: number[];
}
export function registerSheets(
  recipe: CharacterRecipe,
  options: {
    assetFiles: Record<string, string>;
    region: Rect;
    minimumCorrelation?: number;
    onBrowser?: (browser: Browser | null) => void;
  },
): Promise<{
  recipe: CharacterRecipe;
  measurements: RegistrationMeasurement[];
}>;
