/** Authoring coordinates are pixels in the immutable source portrait. */
export type Point = [number, number];
export type Rect = [number, number, number, number];
export type MouthShape = "A" | "B" | "C" | "D" | "E" | "F" | "X";

export interface Registration {
  /** Absolute coordinates in the generated sheet (not relative to its cell). */
  sourceAnchors: Point[];
  /** Matching coordinates in the approved portrait. Three or more non-collinear pairs. */
  portraitAnchors: Point[];
  maxErrorPixels?: number;
}

export interface EditSheet {
  asset: string;
  columns: number;
  rows: number;
  /** Portrait area shown inside every equal sheet cell. */
  referenceRect: Rect;
  registrations?: Record<string, Registration>;
}

export interface MouthLandmarks {
  /** Eight clockwise vertices, starting at the left lip corner. */
  outer: Point[];
  /** Eight clockwise vertices, starting at the left inner lip corner. */
  inner: Point[];
  center: Point;
}

export interface EyeRecipe {
  id: "left" | "right";
  rect: Rect;
  /** Eight clockwise points: left, upper-left, top, upper-right, right, lower-right, bottom, lower-left. */
  aperture: Point[];
  maskPolygon?: Point[];
  /** Foreground occluders such as glasses rims; their original pixels stay fixed over the moving eye. */
  protectedPolygons?: Point[][];
  /** Lid response to brows (0 keeps separately authored blinks independent). Defaults to 1. */
  browInfluence?: number;
  /** Eight fixed vertices enclosing the aperture, constraining nearby hair and brows during eyelid warps. */
  supportRing?: Point[];
  /** Disable boundary color correction when registered edit colors already match the source. */
  matchColor?: boolean;
  iris: { center: Point; radius: Point; feather?: number; maxShift?: Point };
  frames?: Array<{
    cell: number;
    closure: number;
    /** Aperture in the registered source edit. */
    aperture?: Point[];
    /** Optional authored destination contour; defaults to closing toward the original lower lid. */
    targetAperture?: Point[];
  }>;
}

export interface CharacterRecipe {
  schemaVersion: 1;
  pack: { id: string; name: string };
  character: {
    id: string;
    name: string;
    color: string;
    voiceId?: string;
    description?: string;
  };
  pose: { id: string; name: string };
  /** Opaque asset ID, resolved to a local file by the server or CLI asset map. */
  source: string;
  sourceSha256?: string;
  /** Descriptive only; the packer never fetches this URL. */
  provenance?: {
    name?: string;
    url?: string;
    creator?: string;
    license?: string;
  };
  calibrationStatus?: "draft" | "reviewed";
  /** Stable, unchanged nose/bridge detail used to align generated sheet cells. */
  registrationRegion?: Rect;
  autoRegister?: boolean;
  sheets: {
    mouth: EditSheet;
    blink: EditSheet;
    brows: EditSheet;
    gaze: EditSheet;
  };
  mouth: {
    rect: Rect;
    rest?: MouthLandmarks;
    frames?: Partial<
      Record<
        Exclude<MouthShape, "X">,
        { cell: number } & Partial<MouthLandmarks>
      >
    >;
    repairCell?: number;
    maskPolygon?: Point[];
    repairMaskPolygon?: Point[];
    featherPixels?: number;
  };
  /** Only visible eyes are authored; a full-profile pose has one. */
  eyes: [EyeRecipe] | [EyeRecipe, EyeRecipe];
  brows: {
    /** Warp the approved source brow pixels instead of using an edited sheet. */
    sourcePixels?: boolean;
    matchColor?: boolean;
    rect: Rect;
    /** Separate closed polygons around each brow; eyes and hair stay outside these supports. */
    maskPolygons: Point[][];
    frames?: Array<{
      cell: number;
      value: -1 | 1;
      controls?: Array<{ from: Point; to: Point; radius?: number }>;
    }>;
    featherPixels?: number;
  };
  body: {
    head: { pivot: Point; rigidUntil: number; anchoredFrom: number };
    chin: number;
    neck: number;
    breathing?: { fixedTop: number; vertical: number; horizontal: number };
    hair?: Array<{
      x: [number, number, number, number];
      y: [number, number, number, number];
      vector: Point;
    }>;
    clothing?: {
      left: Point;
      right: Point;
      y: [number, number, number, number];
    };
  };
}

export interface DraftRecipeOptions {
  packId: string;
  characterName: string;
  sourceAsset: string;
  width: number;
  height: number;
  face?: Rect;
  sheets?: Partial<Record<"mouth" | "blink" | "brows" | "gaze", string>>;
}

export interface RecipeValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export { createDraftRecipe, validateRecipe } from "./recipe.mjs";
