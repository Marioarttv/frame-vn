import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { createStarterProject } from "../src/engine/starter";
import { exportStandaloneHtml } from "../src/engine/export";
import { DEFAULT_THEME } from "../src/engine/staging";
import type { Project, StoryNode } from "../src/engine/types";

/** A staged chapter in miniature: two characters, a cut-only character and scene changes. */
function stagedProject(longText = false): Project {
  const project = createStarterProject();
  project.theme = { ...DEFAULT_THEME, expressionChange: "morph", textSpeed: 200 };
  const mira = project.characters.find((c) => c.id === "mira")!;
  mira.poses.push({ id: "focused", name: "Focused", src: "/assets/characters/noah.svg" });
  // Separately drawn poses without a face rig switch with a cut.
  mira.expressionChange = "cut";
  const line = (id: string, extra: Partial<StoryNode>): StoryNode =>
    ({ id, label: id, type: "dialogue", text: "A short line.", position: 30, ...extra }) as StoryNode;
  const noah = { characterId: "noah", poseId: "neutral", position: 70 };
  project.nodes = [
    line("a", {
      text: longText ? "A long passage that wraps over many lines on a phone. ".repeat(7) : "A short line.",
      characterId: "mira", poseId: "neutral", backgroundId: "atrium", cast: [noah], nextId: "b",
    }),
    line("b", { characterId: "mira", poseId: "focused", backgroundId: "atrium", cast: [noah], nextId: "c" }),
    // A new place under a dissolve: Mira leaves with the old picture.
    line("c", { characterId: "noah", poseId: "neutral", position: 50, backgroundId: "night",
      transition: "dissolve", nextId: "d" }),
    // Back on a cut: Mira is simply there again.
    line("d", { characterId: "mira", poseId: "neutral", backgroundId: "atrium", transition: "cut",
      cast: [noah], nextId: "ending" }),
    { id: "ending", label: "End", type: "end", text: "The end.", backgroundId: "atrium", position: 50 } as StoryNode,
  ];
  project.startNodeId = "a";
  return project;
}

async function exportGame(project: Project, file: string) {
  const mime: Record<string, string> = { ".svg": "image/svg+xml", ".png": "image/png" };
  const html = await exportStandaloneHtml(project, {
    resolveAsset: async (src) =>
      `data:${mime[extname(src)]};base64,${(await readFile(join("public", src))).toString("base64")}`,
  });
  await writeFile(file, html);
}

type Player = { getState(): { nodeId: string; revealed: boolean }; sampleActors(): Record<string, unknown> };
const player = (page: Page) => page.evaluate(() => (window as unknown as { FramePlayer: Player }).FramePlayer.getState());

async function advance(page: Page, to: string) {
  await expect
    .poll(async () => {
      const state = await player(page);
      if (state.nodeId !== to) await page.locator("#continue").click({ force: true });
      return (await player(page)).nodeId;
    })
    .toBe(to);
}

test("scene changes take portraits with the old picture, cut-only faces never morph, and actors can be sampled", async ({
  browser,
}, testInfo) => {
  const file = testInfo.outputPath("staged.html");
  await exportGame(stagedProject(), file);
  const context = await browser.newContext({ offline: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const log: string[] = [];
    (window as unknown as { morphs: string[] }).morphs = log;
    new MutationObserver((records) => {
      for (const record of records)
        for (const added of record.addedNodes)
          if ((added as Element).classList?.contains("actor-morph")) log.push("morph");
    }).observe(document, { subtree: true, childList: true });
  });
  await page.goto(pathToFileURL(file).href);
  await page.locator("#begin").click();
  await expect.poll(async () => (await player(page)).nodeId).toBe("a");

  const sampled = await page.evaluate(() =>
    Object.keys((window as unknown as { FramePlayer: Player }).FramePlayer.sampleActors()).sort());
  expect(sampled).toEqual(["mira", "noah"]);

  // Mira's expression changes with a cut: her face is replaced without a morph canvas.
  await advance(page, "b");
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as unknown as { morphs: string[] }).morphs)).toEqual([]);

  // A dissolve to a new background: Mira is gone at once, not fading over the new place.
  await advance(page, "c");
  expect(await page.locator('.actor[data-character="mira"]').count()).toBe(0);

  // A cut back: Mira and Noah are there at once, with no entrance animation.
  await advance(page, "d");
  const entering = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".actor .actor-motion")].map((el) => el.getAnimations().length));
  expect(entering.length).toBe(2);
  expect(entering.every((count) => count === 0)).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});

test("on a phone, portraits lift above a tall text panel", async ({ browser }, testInfo) => {
  const file = testInfo.outputPath("phone.html");
  await exportGame(stagedProject(true), file);
  const context = await browser.newContext({ offline: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(pathToFileURL(file).href);
  await page.locator("#begin").click();
  await expect.poll(async () => (await player(page)).revealed || (await page.locator("#continue").click({ force: true }), false)).toBe(true);
  const lift = await page.evaluate(() => {
    const panel = document.querySelector(".conversation")!.getBoundingClientRect().height;
    const actors = document.querySelector<HTMLElement>("#actors")!;
    return { panel, lift: parseFloat(actors.style.getPropertyValue("--panel-lift")),
      transform: new DOMMatrix(getComputedStyle(actors).transform).m42 };
  });
  expect(lift.panel).toBeGreaterThan(210);
  expect(lift.lift).toBeCloseTo(-(lift.panel - 210), 0);
  expect(lift.transform).toBeCloseTo(lift.lift, 0);
  // A desktop window keeps portraits where they are.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => page.evaluate(() =>
    new DOMMatrix(getComputedStyle(document.querySelector("#actors")!).transform).m42)).toBe(0);
  await context.close();
});

/** A scene that brings Noah in under the Veil reveal and plays the Chapter 11 effects. */
function cloakProject(): Project {
  const project = createStarterProject();
  project.theme = { ...DEFAULT_THEME, textSpeed: 200 };
  const line = (id: string, extra: Partial<StoryNode>): StoryNode =>
    ({ id, label: id, type: "dialogue", text: "A short line.", characterId: "mira", poseId: "neutral",
      backgroundId: "atrium", position: 30, ...extra }) as StoryNode;
  project.nodes = [
    line("a", { nextId: "b" }),
    line("b", { cast: [{ characterId: "noah", poseId: "neutral", position: 70, enter: "uncloak", exit: "uncloak" }],
      fx: ["dome,40,55,25", "transform,70,55", "warmth,50,60", "splat,45,34", "wail,72,30"], nextId: "c" }),
    line("c", { nextId: "ending" }),
    { id: "ending", label: "End", type: "end", text: "The end.", backgroundId: "atrium", position: 50 } as StoryNode,
  ];
  project.startNodeId = "a";
  return project;
}

const cloakState = (page: Page) =>
  page.evaluate(() => {
    const motion = document.querySelector<HTMLElement>('.actor[data-character="noah"] .actor-motion');
    const viewport = document.querySelector<HTMLElement>("#viewport")!;
    return {
      present: !!motion,
      mask: motion?.style.maskImage ?? "",
      filter: motion?.style.filter ?? "",
      filters: document.querySelectorAll('filter[id^="vne-uncloak-"]').length,
      warp: viewport.style.filter,
      fx: [...document.querySelectorAll("#screen-fx > *")].map((element) => element.getAttribute("class") ?? ""),
    };
  });

test("uncloak reveals a character from the top down and the Chapter 11 effects play and clean up", async ({ browser }, testInfo) => {
  const file = testInfo.outputPath("cloak.html");
  await exportGame(cloakProject(), file);
  const context = await browser.newContext({ offline: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(file).href);
  await page.locator("#begin").click();
  await expect.poll(async () => (await player(page)).nodeId).toBe("a");
  await advance(page, "b");
  // Mid-reveal: the motion layer carries the moving mask and the cloak's filter.
  const during = await cloakState(page);
  expect(during.present).toBe(true);
  expect(during.mask).toContain("linear-gradient");
  expect(during.filter).toMatch(/^url\("?#vne-uncloak-\d+"?\)$/);
  expect(during.filters).toBe(1);
  const classes = during.fx.join(" ");
  for (const name of ["sfx-dome", "sfx-transform", "sfx-warmth", "sfx-splat", "sfx-wail", "sfx-wail-edge"])
    expect(classes).toContain(name);
  // The wail wavers the whole view while its ripples pass.
  await expect.poll(async () => (await cloakState(page)).warp).toMatch(/sfx-wail-\d+-warp/);
  // Afterwards the figure is fully visible again and nothing is left behind.
  await expect.poll(async () => (await cloakState(page)).mask, { timeout: 4000 }).toBe("");
  const after = await cloakState(page);
  expect(after.filter).toBe("");
  expect(after.filters).toBe(0);
  await expect.poll(async () => (await cloakState(page)).fx.length, { timeout: 6000 }).toBe(0);
  expect((await cloakState(page)).warp).toBe("");
  // The exit pulls the cloak back on: masked from the feet up, then gone.
  await advance(page, "c");
  const leaving = await cloakState(page);
  expect(leaving.present).toBe(true);
  expect(leaving.mask).toContain("linear-gradient");
  await expect.poll(async () => (await cloakState(page)).present, { timeout: 4000 }).toBe(false);
  expect(errors).toEqual([]);
  await context.close();
});

test("with reduced motion, uncloak is a plain fade and the Chapter 11 effects hold still", async ({ browser }, testInfo) => {
  const file = testInfo.outputPath("cloak-reduced.html");
  await exportGame(cloakProject(), file);
  const context = await browser.newContext({ offline: true, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(file).href);
  await page.locator("#begin").click();
  await expect.poll(async () => (await player(page)).nodeId).toBe("a");
  await advance(page, "b");
  const state = await cloakState(page);
  expect(state.present).toBe(true);
  expect(state.mask).toBe("");
  expect(state.filters).toBe(0);
  const fades = await page.evaluate(() =>
    document.querySelector<HTMLElement>('.actor[data-character="noah"] .actor-motion')!.getAnimations().length);
  expect(fades).toBe(1);
  const classes = state.fx.join(" ");
  for (const name of ["sfx-dome", "sfx-transform-still", "sfx-warmth is-still", "sfx-splat is-still", "sfx-wail-edge is-still"])
    expect(classes).toContain(name);
  // No moving parts: no ripples, no smoke canvas, and the view is never warped.
  expect(classes).not.toMatch(/(^| )sfx-wail( |$)/);
  expect(classes).not.toMatch(/sfx-canvas sfx-transform/);
  expect(state.warp).toBe("");
  expect(errors).toEqual([]);
  await context.close();
});

/** A scene that plays the Chapter 12 effects under rain on the glass, then a change of weather. */
function vowProject(): Project {
  const project = createStarterProject();
  project.theme = { ...DEFAULT_THEME, textSpeed: 200 };
  const line = (id: string, extra: Partial<StoryNode>): StoryNode =>
    ({ id, label: id, type: "dialogue", text: "A short line.", characterId: "mira", poseId: "neutral",
      backgroundId: "atrium", position: 50, ...extra }) as StoryNode;
  project.nodes = [
    line("a", { nextId: "b" }),
    line("b", { fx: ["binding,50,45", "fracture,50,58"], weather: "raindrops", nextId: "c" }),
    line("c", { weather: "rain", nextId: "ending" }),
    { id: "ending", label: "End", type: "end", text: "The end.", backgroundId: "atrium", position: 50 } as StoryNode,
  ];
  project.startNodeId = "a";
  return project;
}

const glassState = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#weather")!;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let drawn = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) drawn++;
    return {
      on: canvas.classList.contains("on"),
      drawn: drawn / (canvas.width * canvas.height),
      image: canvas.toDataURL(),
      fx: [...document.querySelectorAll("#screen-fx > *")].map((element) => element.getAttribute("class") ?? ""),
    };
  });

test("the binding and the fracture play and clean up, and raindrops fade in on the glass", async ({ browser }, testInfo) => {
  const file = testInfo.outputPath("vow.html");
  await exportGame(vowProject(), file);
  const context = await browser.newContext({ offline: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(file).href);
  await page.locator("#begin").click();
  await expect.poll(async () => (await player(page)).nodeId).toBe("a");
  await advance(page, "b");
  const during = await glassState(page);
  const classes = during.fx.join(" ");
  for (const name of ["sfx-canvas sfx-binding", "sfx-canvas sfx-fracture"]) expect(classes).toContain(name);
  expect(during.on).toBe(true);
  // The drops fade in, then keep changing as they land, dry and slide.
  await page.waitForTimeout(600);
  const fading = await glassState(page);
  await page.waitForTimeout(1600);
  const settled = await glassState(page);
  expect(settled.drawn).toBeGreaterThan(0.002);
  // Sparse: most of the glass stays clear.
  expect(settled.drawn).toBeLessThan(0.2);
  expect(settled.image).not.toBe(fading.image);
  await expect.poll(async () => (await glassState(page)).fx.length, { timeout: 6000 }).toBe(0);
  // Another weather replaces the drops; they fade out under the rain rather than vanishing.
  await advance(page, "c");
  expect((await glassState(page)).on).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});

test("with reduced motion, raindrops stay as still beads and the Chapter 12 effects hold still", async ({ browser }, testInfo) => {
  const file = testInfo.outputPath("vow-reduced.html");
  await exportGame(vowProject(), file);
  const context = await browser.newContext({ offline: true, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(file).href);
  await page.locator("#begin").click();
  await expect.poll(async () => (await player(page)).nodeId).toBe("a");
  await advance(page, "b");
  const first = await glassState(page);
  expect(first.on).toBe(true);
  const classes = first.fx.join(" ");
  for (const name of ["sfx-binding", "sfx-fracture"]) expect(classes).toContain(name);
  // Drawn once: the beads are there and nothing on the glass moves.
  await expect.poll(async () => (await glassState(page)).drawn).toBeGreaterThan(0.002);
  const still = await glassState(page);
  await page.waitForTimeout(900);
  expect((await glassState(page)).image).toBe(still.image);
  // Other weather stays off with reduced motion, as before.
  await advance(page, "c");
  expect((await glassState(page)).on).toBe(false);
  expect(errors).toEqual([]);
  await context.close();
});
