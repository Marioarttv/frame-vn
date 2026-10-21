import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, chmod, cp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  createDraftRecipe,
  validateRecipe,
  type Point,
  type Rect,
} from "../scripts/character/schema";
import {
  mouthMeshPoints,
  ringMesh,
  assertTransitions,
  closedAperture,
  FIXED_RING,
  normalizePoints,
  fitAffine,
  transformPoint,
  minimumTransitionArea,
} from "../scripts/character/geometry.mjs";
import { buildCharacterPack } from "../scripts/character/pack.mjs";
import { validatePackedCharacter } from "../scripts/character/validate.mjs";
import { registerSheets } from "../scripts/character/register.mjs";
import { launchAuthoringBrowser } from "../scripts/character/browser.mjs";
import { PORTRAIT_RUNTIME_SOURCE } from "../src/animation/player-runtime.generated";
import type { PortraitController } from "../src/animation/controller";
import type { Character } from "../src/engine/types";

const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const draft = () =>
  createDraftRecipe({
    packId: "fixture",
    characterName: "Fixture",
    sourceAsset: "source",
    width: 320,
    height: 320,
    face: [64, 20, 192, 180],
    sheets: { mouth: "mouth", blink: "blink", brows: "brows", gaze: "gaze" },
  });

test("authoring validates source bounds, required artwork, and a real registration region", () => {
  const recipe = draft();
  assert.equal(recipe.autoRegister, true);
  assert.equal(validateRecipe(recipe, { width: 320, height: 320 }).valid, true);
  assert(
    validateRecipe(recipe).warnings.some((message) =>
      message.includes("estimated"),
    ),
  );
  recipe.mouth.rect = [310, 200, 100, 50];
  recipe.registrationRegion = undefined;
  recipe.sheets.blink.asset = "";
  const result = validateRecipe(recipe, { width: 320, height: 320 });
  assert.equal(result.valid, false);
  assert(result.errors.some((message) => message.includes("outside")));
  assert(result.errors.some((message) => message.includes("unchanged-detail")));
  assert(result.errors.some((message) => message.includes("uploaded asset")));
});

test("eyelid brow influence accepts independent lids and rejects invalid strengths", () => {
  const recipe = draft();
  recipe.eyes[0].browInfluence = 0;
  assert.equal(validateRecipe(recipe).valid, true);
  for (const value of [-1, 1.01, NaN]) {
    recipe.eyes[0].browInfluence = value;
    assert.equal(validateRecipe(recipe).valid, false);
  }
});

test("mouth transitions reject intermediate folds even when endpoint triangles are positive", () => {
  const from: Point[] = [
      [0, 0],
      [1, 0],
      [0, 1],
    ],
    to: Point[] = [
      [0, 0],
      [-1, 0],
      [0, -1],
    ];
  assert.equal(minimumTransitionArea(from, to, [0, 1, 2]), 0);
  assert.throws(
    () => assertTransitions([from, to], [[0, 1, 2]], "fixture"),
    /folds during transition/,
  );
  const frames = Array.from("ABCDEFX", (shape) =>
    mouthMeshPoints([0, 0, 180, 100], shape as "A"),
  );
  const triangles = ringMesh(frames, 3, true);
  assert.equal(triangles.length, 40);
  assert.doesNotThrow(() =>
    assertTransitions(frames, triangles, "mouth", true),
  );
});

test("closing perspective eyes converges paired upper/lower vertices without folding", () => {
  const rect: Rect = [463, 365, 124, 66];
  const aperture: Point[] = [
    [480, 390],
    [492, 380],
    [522, 376],
    [546, 380],
    [568, 394],
    [546, 407],
    [522, 411],
    [494, 403],
  ];
  const frames = [0, 0.25, 0.5, 0.75, 1].map((closure) => [
    ...FIXED_RING,
    ...normalizePoints(closedAperture(aperture, closure), rect),
  ]);
  const triangles = ringMesh(frames, 2);
  assert.doesNotThrow(() =>
    assertTransitions(frames, triangles, "perspective eye"),
  );
  assert.equal(closedAperture(aperture, 1)[1][0], aperture[7][0]);
});

test("affine registration recovers a known transform and rejects collinear anchors", () => {
  const source: Point[] = [
      [10, 10],
      [100, 10],
      [10, 100],
      [100, 100],
    ],
    expected = [1.02, 0.015, -0.02, 0.98, 7, -4];
  const target = source.map((point) => transformPoint(expected, point)),
    fit = fitAffine(source, target);
  assert(fit.error < 1e-9);
  fit.affine.forEach((value, i) =>
    assert(Math.abs(value - expected[i]) < 1e-9),
  );
  assert.throws(
    () =>
      fitAffine(
        [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
        [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
      ),
    /non-collinear/,
  );
});

async function mediaFixture(directory: string) {
  const recipe = draft();
  recipe.autoRegister = false;
  for (const sheet of Object.values(recipe.sheets))
    sheet.referenceRect = [0, 0, 320, 320];
  const browser = await launchAuthoringBrowser();
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: "globalThis.__name = (fn) => fn;" });
    const images = await page.evaluate((eye: Rect) => {
      const make = (w: number, h: number) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        return c;
      };
      const source = make(320, 320),
        ctx = source.getContext("2d")!,
        pixels = ctx.createImageData(320, 320);
      // Opaque deterministic calibration pattern: no copyrighted or generated character artwork.
      for (let y = 0; y < 320; y++)
        for (let x = 0; x < 320; x++) {
          const k = (y * 320 + x) * 4,
            v =
              4 * Math.sin(x * 0.173) +
              3 * Math.cos(y * 0.219) +
              2 * Math.sin((x + y) * 0.111) +
              38 * Math.exp(-((x - 143) ** 2 + (y - 107) ** 2) / 70) -
              30 * Math.exp(-((x - 170) ** 2 + (y - 124) ** 2) / 50) +
              19 * Math.exp(-((x - 154) ** 2 + (y - 125) ** 2) / 22);
          pixels.data[k] = 180 + v;
          pixels.data[k + 1] = 145 + v;
          pixels.data[k + 2] = 115 + v;
          pixels.data[k + 3] = 255;
          // An antialiased foreground edge must retain alpha when restored over a blink.
          if (
            x >= eye[0] + eye[2] * 0.35 &&
            x < eye[0] + eye[2] * 0.35 + 8 &&
            y >= eye[1] + eye[3] * 0.5 &&
            y < eye[1] + eye[3] * 0.5 + 4
          )
            pixels.data[k + 3] = 254;
        }
      ctx.putImageData(pixels, 0, 0);
      const sheet = (columns: number, rows: number) => {
        const c = make(columns * 320, rows * 320),
          x = c.getContext("2d")!;
        for (let i = 0; i < columns * rows; i++)
          x.drawImage(
            source,
            (i % columns) * 320,
            Math.floor(i / columns) * 320,
          );
        return c.toDataURL().split(",")[1];
      };
      const shifted = make(320, 320);
      shifted.getContext("2d")!.drawImage(source, 7, -5);
      const flat = make(320, 320);
      flat.getContext("2d")!.fillStyle = "#baa285";
      flat.getContext("2d")!.fillRect(0, 0, 320, 320);
      return {
        source: source.toDataURL().split(",")[1],
        mouth: sheet(4, 2),
        blink: sheet(2, 2),
        brows: sheet(2, 1),
        gaze: sheet(1, 1),
        shifted: shifted.toDataURL().split(",")[1],
        flat: flat.toDataURL().split(",")[1],
      };
    }, recipe.eyes[0].rect);
    const assetFiles: Record<string, string> = {};
    for (const [name, bytes] of Object.entries(images)) {
      assetFiles[name] = join(directory, name + ".png");
      await writeFile(assetFiles[name], Buffer.from(bytes, "base64"));
    }
    await chmod(assetFiles.source, 0o400);
    return { recipe, assetFiles };
  } finally {
    await browser.close();
  }
}

for (const visibleEyes of [2, 1])
  test(
    `the real ${visibleEyes}-eye compiler/runtime preserve source/rest pixels, isolate blinks, and stage failed rebuilds`,
    { timeout: 120_000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "frame-rig-"));
      try {
        const { recipe, assetFiles } = await mediaFixture(directory),
          outputDirectory = join(directory, "pack");
        if (visibleEyes === 1) {
          recipe.eyes = [recipe.eyes[0]];
          const eye = recipe.eyes[0],
            rect = eye.rect;
          const px = rect[0] + rect[2] * 0.35,
            py = rect[1] + rect[3] * 0.5;
          eye.browInfluence = 0;
          eye.protectedPolygons = [
            [
              [px, py],
              [px + 8, py],
              [px + 8, py + 4],
              [px, py + 4],
            ],
          ];
          eye.supportRing = FIXED_RING.map(
            ([x, y], i) =>
              [
                (rect[0] + x * rect[2] + eye.aperture[i][0]) / 2,
                (rect[1] + y * rect[3] + eye.aperture[i][1]) / 2,
              ] as Point,
          );
          eye.frames = [0.25, 0.5, 0.75, 1].map((closure, cell) => ({
            closure,
            cell,
            targetAperture: closedAperture(eye.aperture, closure * 0.95),
          }));
        }
        const result = await buildCharacterPack(recipe, {
          assetFiles,
          outputDirectory,
          urlRoot: "/local-packs/fixture",
        });
        assert.equal(result.validation.valid, true);
        assert.equal(result.validation.checks.sourceCopiedByteIdentical, true);
        assert.equal(
          result.validation.checks.localizedEditsOutsideMaskUnchanged,
          true,
        );
        assert(Number(result.validation.checks.protectedPixels) > 0);
        assert.equal(
          hash(await readFile(assetFiles.source)),
          hash(await readFile(join(outputDirectory, "portrait.png"))),
        );
        const assets: Record<string, string> = {};
        for (const file of result.files) {
          if (!/\.(json|png)$/.test(file)) continue;
          assets["/local-packs/fixture/" + file] =
            "data:" +
            (file.endsWith(".json") ? "application/json" : "image/png") +
            ";base64," +
            (await readFile(join(outputDirectory, file))).toString("base64");
        }
        const browser = await launchAuthoringBrowser();
        try {
          const page = await browser.newPage();
          await page.addScriptTag({
            content: "globalThis.__name = (fn) => fn;",
          });
          await page.setContent(
            '<div id="portrait" style="width:320px;height:320px"></div>',
          );
          await page.addScriptTag({ content: PORTRAIT_RUNTIME_SOURCE });
          const pixels = await page.evaluate(
            async ({
              assets,
              character,
              eyes,
              protectedPolygons,
              neutralLids,
              eyeApertures,
            }) => {
              const api = (
                globalThis as unknown as {
                  FrameAnimation: {
                    createPortraitController(
                      element: HTMLElement,
                      options: {
                        character: Character;
                        pose: Character["poses"][0];
                        settings: Record<string, boolean | number>;
                        resolveAsset: (url: string) => string;
                      },
                    ): PortraitController;
                  };
                }
              ).FrameAnimation;
              const c = api.createPortraitController(
                document.getElementById("portrait")!,
                {
                  character,
                  pose: character.poses[0],
                  settings: {
                    life: false,
                    breathing: false,
                    head: false,
                    gaze: false,
                    secondary: false,
                    blink: false,
                    brow: 0,
                  },
                  resolveAsset: (url) => assets[url] || url,
                },
              );
              await c.ready;
              for (
                let i = 0;
                i < 100 &&
                !(
                  c.getStatus().blinkReady &&
                  c.getStatus().gazeReady &&
                  c.getStatus().browsReady
                );
                i++
              )
                await new Promise((r) => setTimeout(r, 20));
              const ready = c.getStatus();
              const visible = document.querySelector("canvas")!,
                read = () =>
                  visible.getContext("2d")!.getImageData(0, 0, 320, 320).data;
              const image = new Image();
              image.src = assets[character.poses[0].src];
              await image.decode();
              const reference = document.createElement("canvas");
              reference.width = 320;
              reference.height = 320;
              reference.getContext("2d")!.drawImage(image, 0, 0);
              const original = reference
                  .getContext("2d")!
                  .getImageData(0, 0, 320, 320).data,
                rest = read();
              let neutralChanges = 0;
              for (let i = 0; i < rest.length; i++)
                if (rest[i] !== original[i]) neutralChanges++;
              let browEyeChanges = 0;
              const browSamples: unknown[] = [];
              const contains = (x: number, y: number, polygon: Point[]) => {
                let inside = false;
                for (
                  let i = 0, j = polygon.length - 1;
                  i < polygon.length;
                  j = i++
                ) {
                  const a = polygon[i],
                    b = polygon[j];
                  if (
                    a[1] > y !== b[1] > y &&
                    x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
                  )
                    inside = !inside;
                }
                return inside;
              };
              if (neutralLids) {
                for (const brow of [-1, 1]) {
                  c.update({ brow });
                  await new Promise((r) => setTimeout(r, 50));
                  const pixels = read();
                  for (const [eyeIndex, [x, y, w, h]] of eyes.entries())
                    for (let py = y; py < y + h; py++)
                      for (let px = x; px < x + w; px++)
                        for (let channel = 0; channel < 4; channel++)
                          if (
                            contains(
                              px + 0.5,
                              py + 0.5,
                              eyeApertures[eyeIndex],
                            ) &&
                            pixels[(py * 320 + px) * 4 + channel] !==
                              rest[(py * 320 + px) * 4 + channel]
                          ) {
                            browEyeChanges++;
                            if (browSamples.length < 8)
                              browSamples.push({
                                px,
                                py,
                                channel,
                                before: rest[(py * 320 + px) * 4 + channel],
                                after: pixels[(py * 320 + px) * 4 + channel],
                              });
                          }
                }
                c.update({ brow: 0 });
                await new Promise((r) => setTimeout(r, 50));
              }
              c.setMouthShape("C");
              const mouth = read();
              c.update({ blink: true });
              c.triggerBlink();
              await new Promise((r) => setTimeout(r, 105));
              const blink = read();
              let outsideEyes = 0;
              let protectedChanges = 0;
              for (let y = 0; y < 320; y++)
                for (let x = 0; x < 320; x++) {
                  const inside = eyes.some(
                    ([a, b, w, h]) =>
                      x >= a && x < a + w && y >= b && y < b + h,
                  );
                  if (!inside)
                    for (let n = 0; n < 4; n++)
                      if (
                        mouth[(y * 320 + x) * 4 + n] !==
                        blink[(y * 320 + x) * 4 + n]
                      )
                        outsideEyes++;
                  if (
                    protectedPolygons.some(
                      (p) =>
                        x + 0.5 > p[0][0] &&
                        x + 0.5 < p[1][0] &&
                        y + 0.5 > p[0][1] &&
                        y + 0.5 < p[2][1],
                    )
                  )
                    for (let n = 0; n < 4; n++)
                      if (
                        mouth[(y * 320 + x) * 4 + n] !==
                        blink[(y * 320 + x) * 4 + n]
                      )
                        protectedChanges++;
                }
              c.dispose();
              return {
                neutralChanges,
                browEyeChanges,
                browSamples,
                outsideEyes,
                protectedChanges,
                blinkReady: ready.blinkReady,
                gazeReady: ready.gazeReady,
                browsReady: ready.browsReady,
                eyeCount: (ready.blinkApertures as unknown[] | undefined)
                  ?.length,
              };
            },
            {
              assets,
              neutralLids: visibleEyes === 1,
              eyeApertures: recipe.eyes.map((eye) => eye.aperture),
              character: result.character,
              eyes: recipe.eyes.map((eye) => eye.rect),
              protectedPolygons: recipe.eyes.flatMap(
                (eye) => eye.protectedPolygons || [],
              ),
            },
          );
          assert.equal(pixels.neutralChanges, 0);
          assert.equal(
            pixels.browEyeChanges,
            0,
            JSON.stringify(pixels.browSamples),
          );
          assert.equal(pixels.outsideEyes, 0);
          assert.equal(pixels.protectedChanges, 0);
          assert.equal(pixels.blinkReady, true);
          assert.equal(pixels.gazeReady, true);
          assert.equal(pixels.browsReady, true);
          assert.equal(pixels.eyeCount, visibleEyes);
        } finally {
          await browser.close();
        }
        const before = await readFile(join(outputDirectory, "catalog.json")),
          beforeValidation = await readFile(
            join(outputDirectory, "validation.json"),
          );
        const invalid = structuredClone(recipe);
        invalid.mouth.rest = {
          outer: Array.from({ length: 8 }, () => [130, 140] as Point),
          inner: Array.from({ length: 8 }, () => [130, 140] as Point),
          center: [130, 140],
        };
        await assert.rejects(
          () =>
            buildCharacterPack(invalid, {
              assetFiles,
              outputDirectory,
              urlRoot: "/local-packs/fixture",
            }),
          /folded|degenerate/,
        );
        assert.deepEqual(
          await readFile(join(outputDirectory, "catalog.json")),
          before,
        );
        assert.deepEqual(
          await readFile(join(outputDirectory, "validation.json")),
          beforeValidation,
        );
        const updated = await buildCharacterPack(
          {
            ...recipe,
            character: {
              ...recipe.character,
              description: "Updated calibration",
            },
          },
          { assetFiles, outputDirectory, urlRoot: "/local-packs/fixture" },
        );
        assert.equal(updated.character.description, "Updated calibration");
        // A silent pose (no mouth rig) still validates its blinks, brows, gaze and body.
        const silentPack = join(directory, "silent-pack");
        await cp(outputDirectory, silentPack, { recursive: true });
        const silentCatalog = JSON.parse(
          await readFile(join(silentPack, "catalog.json"), "utf8"),
        );
        const silentPose = silentCatalog.characters[0].poses[0];
        silentPose.capabilities.mouth = false;
        await writeFile(join(silentPack, "catalog.json"), JSON.stringify(silentCatalog));
        const silentManifest = JSON.parse(
          await readFile(join(silentPack, "manifest.json"), "utf8"),
        );
        const withMouth = structuredClone(silentManifest);
        delete silentManifest.sprites[silentPose.id].mouth;
        await writeFile(join(silentPack, "manifest.json"), JSON.stringify(silentManifest));
        const silent = await validatePackedCharacter(silentPack);
        assert.equal(silent.valid, true, JSON.stringify(silent.errors));
        assert.equal(silent.checks.mouth, "none (silent pose)");
        assert.ok(Object.keys(silent.checks).some((name) => name.endsWith("Blink")));
        await writeFile(join(silentPack, "manifest.json"), JSON.stringify(withMouth));
        const contradictory = await validatePackedCharacter(silentPack);
        assert.equal(contradictory.valid, false);
        assert.match(contradictory.errors.join(" "), /without mouth capability/);
        assert.equal(
          hash(await readFile(assetFiles.source)),
          hash(await readFile(join(outputDirectory, "portrait.png"))),
        );
        await writeFile(join(directory, "bad.png"), "not an image");
        await assert.rejects(
          () =>
            buildCharacterPack(recipe, {
              assetFiles: { ...assetFiles, source: join(directory, "bad.png") },
              outputDirectory: join(directory, "bad-pack"),
              urlRoot: "/local-packs/fixture",
            }),
          /decod|image|encoding/i,
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

test(
  "automatic stable-template alignment recovers translation, preserves explicit anchors, and rejects flat detail",
  { timeout: 120_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "frame-registration-"));
    try {
      const { recipe, assetFiles } = await mediaFixture(directory);
      for (const sheet of Object.values(recipe.sheets)) {
        sheet.asset = "shifted";
        sheet.columns = 1;
        sheet.rows = 1;
      }
      recipe.mouth.repairCell = 0;
      recipe.mouth.frames = Object.fromEntries(
        Array.from("ABCDEF", (shape) => [shape, { cell: 0 }]),
      );
      recipe.eyes.forEach((eye) => {
        eye.frames = [0.25, 0.5, 0.75, 1].map((closure) => ({
          cell: 0,
          closure,
        }));
      });
      recipe.brows.frames = [
        { cell: 0, value: -1 },
        { cell: 0, value: 1 },
      ];
      recipe.sheets.brows.registrations = {
        "0": {
          sourceAnchors: [
            [0, 0],
            [100, 0],
            [0, 100],
          ],
          portraitAnchors: [
            [0, 0],
            [100, 0],
            [0, 100],
          ],
        },
      };
      const registered = await registerSheets(recipe, {
        assetFiles,
        region: [135, 100, 48, 32],
      });
      assert.equal(registered.measurements.length, 3);
      for (const measurement of registered.measurements) {
        assert(measurement.correlation > 0.97);
        assert(
          Math.abs(measurement.translation[0] + 7) < 1.5,
          JSON.stringify(measurement),
        );
        assert(
          Math.abs(measurement.translation[1] - 5) < 1.5,
          JSON.stringify(measurement),
        );
      }
      assert.deepEqual(
        registered.recipe.sheets.brows.registrations,
        recipe.sheets.brows.registrations,
      );
      await assert.rejects(
        () =>
          registerSheets(
            { ...recipe, source: "flat" },
            { assetFiles, region: [135, 100, 48, 32] },
          ),
        /lacks stable visual detail/,
      );
      await assert.rejects(
        () =>
          registerSheets(recipe, { assetFiles, region: [315, 315, 30, 30] }),
        /within the immutable source/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("speech shapes derived from a calibrated rest mouth never fold, even for a smirk", async () => {
  const geometry = await import("../scripts/character/geometry.mjs");
  const rect: [number, number, number, number] = [524, 524, 180, 110];
  // An asymmetrical smiling pose: the right corner is raised far above the left one.
  type Point = [number, number];
  const rest: { outer: Point[]; inner: Point[]; center: Point } = {
    outer: [
      [545, 569],
      [585, 547],
      [610, 554],
      [650, 546],
      [687, 545],
      [656, 587],
      [607, 601],
      [569, 594],
    ],
    inner: [
      [549, 569],
      [583, 568],
      [610, 571],
      [647, 559],
      [684, 547],
      [647, 566],
      [610, 577],
      [583, 573],
    ],
    center: [612, 572],
  };
  const derived = geometry.derivedMouthFrames(rest, rect);
  assert.deepEqual(Object.keys(derived), ["A", "B", "C", "D", "E", "F"]);
  const shapes = ["A", "B", "C", "D", "E", "F", "X"] as const;
  const frames = shapes.map((shape) =>
    geometry.mouthMeshPoints(
      rect,
      shape,
      shape === "X" ? rest : derived[shape],
    ),
  );
  for (const points of frames)
    assert.ok(points.every((p: number[]) => p.every((v) => v >= 0 && v <= 1)));
  const triangles = geometry.ringMesh(frames, 3, true);
  assert.doesNotThrow(() =>
    geometry.assertTransitions(frames, triangles, "Mouth", true),
  );
  // The wide vowel opens downward more than upward, and rounded vowels narrow the mouth.
  assert.ok(
    derived.D.inner[6][1] - rest.inner[6][1] >
      rest.inner[2][1] - derived.D.inner[2][1],
  );
  assert.ok(
    derived.F.outer[4][0] - derived.F.outer[0][0] <
      rest.outer[4][0] - rest.outer[0][0],
  );
});
