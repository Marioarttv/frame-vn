import type { Point, Rect, MouthLandmarks, MouthShape } from "./schema";
export const FIXED_RING: Point[];
export function rectObject(rect: Rect): {
  x: number;
  y: number;
  width: number;
  height: number;
};
export function normalizePoints(points: Point[], rect: Rect): Point[];
export function denormalizePoints(points: Point[], rect: Rect): Point[];
export function triangleArea(points: Point[], triangle: number[]): number;
export function minimumTransitionArea(
  from: Point[],
  to: Point[],
  triangle: number[],
): number;
export function assertTransitions(
  frames: Point[][],
  triangles: number[][],
  label: string,
  allPairs?: boolean,
): void;
export function ringMesh(
  frames: Point[][],
  rings: number,
  center?: boolean,
): number[][];
export function estimatedMouth(rect: Rect, shape: MouthShape): MouthLandmarks;
export function mouthMeshPoints(
  rect: Rect,
  shape: MouthShape,
  calibrated?: Partial<MouthLandmarks>,
): Point[];
export function closedAperture(open: Point[], closure: number): Point[];
export function invertAffine(matrix: number[]): number[];
export function transformPoint(matrix: number[], point: Point): Point;
export function fitAffine(
  source: Point[],
  target: Point[],
): { affine: number[]; error: number };
export function insidePolygon(x: number, y: number, points: Point[]): boolean;
export function polygonDistance(x: number, y: number, points: Point[]): number;
/** Speech-shape landmarks derived from a calibrated rest mouth; see geometry.mjs. */
export function derivedMouthFrames(
  rest: MouthLandmarks,
  rect: Rect,
): Record<
  Exclude<MouthShape, "X">,
  { cell: number } & MouthLandmarks
>;
export function resampleOutline(polygon: Point[], count?: number): Point[];
export interface MorphLandmarks {
  version: 1;
  mouth: MouthLandmarks;
  eyes: Array<{ aperture: Point[]; iris: Point }>;
  brows: Point[][];
}
export function morphLandmarks(recipe: import("./schema").CharacterRecipe): MorphLandmarks;
export function browCenterline(polygon: Point[], count?: number): Point[];
