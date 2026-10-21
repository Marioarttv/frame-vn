import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  landmarksOf,
  planMorph,
  type FaceLandmarks,
  type SpriteData,
} from "../src/player/morph";

const face = (shift: number): FaceLandmarks => ({
  width: 1000,
  height: 1000,
  groups: {
    brows: [
      [380, 380 + shift],
      [420, 372 + shift],
      [460, 375 + shift],
      [540, 375 + shift],
      [580, 372 + shift],
      [620, 380 + shift],
    ],
    eyes: [
      ...[
        [390, 430],
        [405, 420],
        [430, 416],
        [455, 420],
        [470, 430],
        [455, 438],
        [430, 441],
        [405, 438],
      ],
      ...[
        [530, 430],
        [545, 420],
        [570, 416],
        [595, 420],
        [610, 430],
        [595, 438],
        [570, 441],
        [545, 438],
      ],
    ] as [number, number][],
    mouth: [
      ...[
        [450, 600],
        [475, 590],
        [500, 592],
        [525, 590],
        [550, 600],
        [525, 612],
        [500, 615],
        [475, 612],
      ],
      [500, 601],
    ] as [number, number][],
    lips: [
      [455, 600],
      [475, 597],
      [500, 598],
      [525, 597],
      [545, 600],
      [525, 604],
      [500, 605],
      [475, 604],
    ],
  },
});

test("a morph warps every feature when the faces are compatible", () => {
  const plan = planMorph(face(0), face(14), 400, 400, 1);
  assert.equal(plan.warp, true);
  assert.deepEqual(plan.groups, ["brows", "eyes", "mouth", "lips"]);
  // Brows are anchored to their own timing; frame corners never move.
  assert.ok(plan.points.a.some((p, i) => p[1] !== plan.points.b[i][1]));
  assert.deepEqual(plan.points.a.at(-8), plan.points.b.at(-8));
});

test("a region that would tear is given up instead of the whole warp", () => {
  const folding = face(0);
  // The brow drops through the eye: warping it would flip triangles.
  folding.groups.brows = folding.groups.brows!.map(
    ([x, y]) => [x, y + 70] as [number, number],
  );
  const plan = planMorph(face(0), folding, 400, 400, 1);
  assert.equal(plan.warp, true);
  assert.ok(!plan.groups.includes("brows"));
  assert.ok(plan.groups.includes("mouth"));
});

test("portraits without landmarks fall back to a sweeping dissolve", () => {
  const plan = planMorph(null, null, 400, 400, 1);
  assert.equal(plan.warp, false);
  assert.ok(plan.triangles.length > 40);
});

test("profile expressions retain their single visible eye and morph without invalid corners", () => {
  const marks = face(0);
  const sprite: SpriteData = {
    sourceWidth: 1000,
    sourceHeight: 1000,
    morph: {
      eyes: [{ aperture: marks.groups.eyes!.slice(0, 8), iris: [430, 430] }],
      brows: [marks.groups.brows!.slice(0, 3)],
    },
  };
  const profile = landmarksOf(sprite)!;
  assert.equal(profile.groups.eyes?.length, 8);
  assert.equal(profile.groups.irises?.length, 1);
  assert.equal(profile.groups.brows?.length, 3);
  const next = structuredClone(profile);
  next.groups.brows = next.groups.brows!.map(([x, y]) => [x, y + 6]);
  const plan = planMorph(profile, next, 400, 400, 1);
  assert.equal(plan.warp, true);
  assert.ok(plan.groups.includes("eyes"));
  assert.ok(plan.points.a.flat().every(Number.isFinite));
  assert.ok(plan.points.b.flat().every(Number.isFinite));
  assert.equal(planMorph(marks, profile, 400, 400, 1).warp, false);
  assert.equal(planMorph(profile, marks, 400, 400, 1).warp, false);
});

test("every pair of expressions of each installed rigged character morphs with a warp", (context) => {
  const root = "public/local-packs";
  if (!existsSync(root)) return context.skip("No local packs are installed.");
  const byCharacter = new Map<string, FaceLandmarks[]>();
  for (const pack of readdirSync(root)) {
    const catalogPath = join(root, pack, "catalog.json");
    if (!existsSync(catalogPath)) continue;
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    for (const character of catalog.characters ?? [])
      for (const pose of character.poses ?? []) {
        const animation = pose.animation;
        if (!animation) continue;
        const manifestPath = join("public", animation.manifestUrl);
        if (!existsSync(manifestPath)) continue;
        const sprite = JSON.parse(readFileSync(manifestPath, "utf8")).sprites?.[
          animation.poseKey
        ] as SpriteData | undefined;
        const marks = sprite ? landmarksOf(sprite) : null;
        if (!marks) continue;
        byCharacter.set(character.id, [
          ...(byCharacter.get(character.id) ?? []),
          marks,
        ]);
      }
  }
  let pairs = 0;
  const partial: string[] = [];
  for (const [id, faces] of byCharacter)
    for (let i = 0; i < faces.length; i++)
      for (let j = 0; j < faces.length; j++) {
        if (i === j) continue;
        const plan = planMorph(faces[i], faces[j], 480, 640, 2);
        pairs++;
        if (
          faces[i].groups.eyes &&
          faces[j].groups.eyes &&
          faces[i].groups.eyes!.length !== faces[j].groups.eyes!.length
        ) {
          assert.equal(
            plan.warp,
            false,
            `${id} ${i}→${j} should dissolve between views`,
          );
          continue;
        }
        assert.equal(plan.warp, true, `${id} ${i}→${j} could not warp`);
        // Eyes and outer lips must survive whenever both poses describe them.
        for (const group of ["eyes", "mouth"] as const)
          if (
            faces[i].groups[group] &&
            faces[j].groups[group] &&
            !plan.groups.includes(group)
          )
            partial.push(
              `${id} ${i}→${j}: lost ${group} (${plan.groups.join(",")})`,
            );
      }
  if (!pairs)
    return context.skip("No rigged expressions with landmarks are installed.");
  assert.deepEqual(
    partial,
    [],
    "Eyes and outer lips should warp whenever both poses have them",
  );
  context.diagnostic(
    `${pairs} expression pairs across ${byCharacter.size} characters warp.`,
  );
});
