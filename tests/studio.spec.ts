import { test, expect, type Frame, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { Project } from "../src/engine/types";

const runtimeErrors = new WeakMap<Page, string[]>();
const unexpectedGenerations = new WeakMap<Page, string[]>();
const portraitPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=",
  "base64",
);

test.beforeEach(async ({ page }) => {
  runtimeErrors.set(page, []);
  unexpectedGenerations.set(page, []);
  page.on("pageerror", (error) => runtimeErrors.get(page)!.push(error.message));
  await page.route("**/api/health", (route) =>
    route.fulfill({
      json: {
        configured: true,
        model: "eleven_v4",
        rhubarb: true,
        ffmpeg: true,
        sessionToken: "e2e-test-only",
        alignment: "rhubarb",
      },
    }),
  );
  await page.route("**/api/voices", (route) =>
    route.fulfill({
      json: {
        voices: [
          {
            id: "test_voice",
            name: "Studio Test Voice",
            labels: { accent: "neutral" },
          },
        ],
      },
    }),
  );
  await page.route("**/api/voice", (route) => {
    unexpectedGenerations.get(page)!.push(route.request().method());
    return route.fulfill({
      status: 418,
      json: { error: "E2E prevented a paid generation request." },
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Animation lab." }),
  ).toBeVisible();
  await expect(
    page.getByText("Saved on this device", { exact: true }),
  ).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(
    unexpectedGenerations.get(page),
    "Browser tests must never call paid generation",
  ).toEqual([]);
  expect(runtimeErrors.get(page), "No uncaught browser exceptions").toEqual([]);
});

/** Reveal without advancing if typing finished while the browser command was in flight. */
async function revealLine(page: Page | Frame, nodeId: string) {
  await page.waitForFunction((id) => {
    const state = (window as unknown as { FramePlayer: { getState(): { nodeId: string; revealed: boolean } } }).FramePlayer.getState();
    const button = document.querySelector<HTMLButtonElement>("#continue");
    return state.nodeId === id && (state.revealed || (button && !button.hidden && !button.disabled));
  }, nodeId);
  await page.evaluate((id) => {
    const state = (window as unknown as { FramePlayer: { getState(): { nodeId: string; revealed: boolean } } }).FramePlayer.getState();
    if (state.nodeId !== id) throw new Error(`Expected ${id}, found ${state.nodeId}`);
    if (!state.revealed) document.querySelector<HTMLButtonElement>("#continue")!.click();
  }, nodeId);
  await expect.poll(() => page.evaluate(() => {
    const { nodeId, revealed } = (window as unknown as { FramePlayer: { getState(): { nodeId: string; revealed: boolean } } }).FramePlayer.getState();
    return { nodeId, revealed };
  })).toEqual({ nodeId, revealed: true });
}

async function openScenes(page: Page) {
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Scene builder" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Scene builder." }),
  ).toBeVisible();
}

/** The scene inspector groups its settings in tabs. */
async function openTab(
  page: Page,
  name: "Write" | "Stage" | "Look" | "Sound & voice",
) {
  await page
    .locator(".inspector-tabs")
    .getByRole("tab", { name, exact: true })
    .click();
}

async function exportJson(page: Page): Promise<Project> {
  await page.getByRole("button", { name: "Project", exact: true }).click();
  const downloadEvent = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: "Export project JSON" }).click();
  const downloaded = await downloadEvent;
  const path = await downloaded.path();
  expect(path).toBeTruthy();
  return JSON.parse(await readFile(path!, "utf8"));
}

/** Records every toast inside the page, so a slow host cannot miss one that has already timed out. */
async function recordNotices(page: Page) {
  await page.evaluate(() => {
    const target = window as unknown as { frameNotices?: string[] };
    target.frameNotices = [];
    const observer = new MutationObserver(() => {
      const text = document.querySelector(".toast span")?.textContent;
      if (text && target.frameNotices!.at(-1) !== text) target.frameNotices!.push(text);
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}

async function importJson(page: Page, project: Project) {
  await recordNotices(page);
  await page.getByRole("button", { name: "Project", exact: true }).click();
  const fileChooserEvent = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import project JSON" }).click();
  const chooser = await fileChooserEvent;
  await chooser.setFiles({
    name: "roundtrip-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { frameNotices: string[] }).frameNotices), { timeout: 30_000 })
    .toContain("Project imported. Your previous project is available with Undo.");
}

/** Reads the studio's IndexedDB directly to prove what is (and is not) persisted. */
async function readStoredProjects(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ projects: unknown[]; assetCount: number }>(
        (resolve, reject) => {
          const request = indexedDB.open("visual-novel-studio");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(["projects", "assets"], "readonly");
            const projects = tx.objectStore("projects").getAll();
            const assets = tx.objectStore("assets").count();
            tx.oncomplete = () => {
              db.close();
              resolve({
                projects: projects.result,
                assetCount: assets.result,
              });
            };
          };
        },
      ),
  );
}

test("projects are created, switched and deleted independently", async ({
  page,
}) => {
  const manager = () =>
    page.getByRole("dialog", { name: "Projects", exact: true });
  await page.getByRole("button", { name: "Manage projects" }).click();
  await expect(manager().getByText("First Light")).toBeVisible();
  await manager().getByRole("button", { name: "New blank project" }).click();
  await expect(manager()).toBeHidden();
  await expect(
    page.locator(".project-shortcut").getByText("Untitled story"),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Scene builder" })
    .click();
  await expect(page.locator(".node-card")).toHaveCount(1);
  await page.getByRole("textbox", { name: /^Dialogue/ }).fill("A blank page.");
  await expect(
    page.getByText("Saved on this device", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Manage projects" }).click();
  await expect(manager().locator(".project-list li")).toHaveCount(2);
  await manager().getByRole("button", { name: "Open First Light" }).click();
  await expect(page.locator(".node-card")).toHaveCount(5);
  await page.reload();
  await expect(
    page.locator(".project-shortcut").getByText("First Light"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Manage projects" }).click();
  await manager()
    .getByRole("button", { name: "Delete Untitled story" })
    .click();
  await manager().getByRole("button", { name: "Confirm delete" }).click();
  await expect(manager().locator(".project-list li")).toHaveCount(1);
  const stored = await readStoredProjects(page);
  expect(stored.projects).toHaveLength(1);
  expect(JSON.stringify(stored.projects)).not.toContain("A blank page.");
});

test("a version 1 browser workspace migrates its inline images into the asset store", async ({
  page,
}) => {
  const legacy = await exportJson(page);
  legacy.title = "Legacy workspace";
  legacy.characters[0].name = "Legacy Mira";
  legacy.characters[0].poses[0].src = `data:image/png;base64,${portraitPng.toString("base64")}`;
  await page.evaluate(async (project) => {
    await new Promise<void>((resolve, reject) => {
      const removal = indexedDB.deleteDatabase("visual-novel-studio");
      removal.onsuccess = () => resolve();
      removal.onerror = () => reject(removal.error);
    });
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("visual-novel-studio", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("projects");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("projects", "readwrite");
        tx.objectStore("projects").put(
          { project, savedAt: new Date().toISOString() },
          "current",
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
  }, legacy);
  await page.reload();
  await expect(
    page.locator(".project-shortcut").getByText("Legacy workspace"),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /^Characters/ })
    .click();
  const picture = page.getByRole("img", { name: "Legacy Mira" });
  await expect(picture).toHaveAttribute("src", /^blob:/);
  await expect
    .poll(() =>
      picture.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(1);
  const stored = await readStoredProjects(page);
  expect(stored.projects).toHaveLength(1);
  expect(JSON.stringify(stored.projects)).toContain('"src":"asset:');
  expect(JSON.stringify(stored.projects)).not.toContain("data:image");
  const backup = await exportJson(page);
  expect(backup.characters[0].poses[0].src).toBe(
    legacy.characters[0].poses[0].src,
  );
});

test("character library search and local PNG import survive a browser reload", async ({
  page,
}) => {
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /^Characters/ })
    .click();
  const search = page.getByRole("textbox", { name: "Search characters" });
  await search.fill("mira");
  await expect(page.locator(".character-card")).toHaveCount(1);
  await expect(
    page.locator(".character-card").getByRole("heading", { name: "Mira" }),
  ).toBeVisible();
  await search.fill("A name that does not exist");
  await expect(page.getByText(/No characters match/)).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.locator(".character-card")).not.toHaveCount(0);
  await page
    .getByRole("button", { name: "Add character", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Meet your next character.",
  });
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({
      name: "Local portrait.png",
      mimeType: "image/png",
      buffer: portraitPng,
    });
  await dialog
    .getByRole("textbox", { name: "Character name" })
    .fill("E2E Portrait");
  await dialog
    .getByRole("textbox", { name: /A little about them/ })
    .fill("A local portrait used to verify persistence.");
  await dialog.getByRole("button", { name: "Add to library" }).click();
  await expect(
    page.getByRole("combobox", { name: "Preview character" }),
  ).toHaveValue(/.+/);
  await expect(
    page.locator(".small-label").filter({ hasText: "E2E Portrait" }),
  ).toBeVisible();
  await expect(
    page.getByText("Saved on this device", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Saved on this device", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /^Characters/ })
    .click();
  await page
    .getByRole("textbox", { name: "Search characters" })
    .fill("E2E Portrait");
  await expect(page.locator(".character-card")).toHaveCount(1);
  const picture = page.locator(".character-card img");
  await expect(picture).toHaveAttribute("src", /^blob:/);
  await expect
    .poll(() =>
      picture.evaluate(
        (element: HTMLImageElement) =>
          element.complete && element.naturalWidth > 0,
      ),
    )
    .toBe(true);
  const stored = await readStoredProjects(page);
  const record = JSON.stringify(stored.projects);
  expect(record).toContain("E2E Portrait");
  expect(record).not.toContain("data:image");
  expect(stored.assetCount).toBeGreaterThan(0);
});

test("backgrounds import into a scene and unused characters or expressions can be removed", async ({
  page,
}) => {
  const characters = () =>
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: /^Characters/ })
      .click();
  await openScenes(page);
  await openTab(page, "Look");
  const backgroundChooser = page.waitForEvent("filechooser");
  await page
    .locator(".scene-inspector")
    .getByRole("button", { name: "Import background", exact: true })
    .click();
  await (
    await backgroundChooser
  ).setFiles({
    name: "night_market.png",
    mimeType: "image/png",
    buffer: portraitPng,
  });
  const background = page.getByRole("combobox", {
    name: "Background",
    exact: true,
  });
  await expect(background).toHaveValue(/^background-/);
  await expect(background.locator("option:checked")).toHaveText(
    "night market",
  );

  await characters();
  await page.getByRole("button", { name: "Remove Mira", exact: true }).click();
  await expect(
    page.getByText(/^Mira appears in \d+ scenes?\. Change those scenes first\.$/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add character", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Meet your next character.",
  });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "spare.png",
    mimeType: "image/png",
    buffer: portraitPng,
  });
  await dialog
    .getByRole("textbox", { name: "Character name" })
    .fill("Spare Portrait");
  await dialog.getByRole("button", { name: "Add to library" }).click();
  await characters();
  const poseChooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Add expression to Spare Portrait" })
    .click();
  await (
    await poseChooser
  ).setFiles({
    name: "second_look.png",
    mimeType: "image/png",
    buffer: portraitPng,
  });
  await expect(
    page.getByText("Expression added to Spare Portrait.", { exact: true }),
  ).toBeVisible();
  await page
    .locator(".character-card")
    .filter({ hasText: "Spare Portrait" })
    .getByRole("heading", { name: "Spare Portrait" })
    .click();
  const expression = page.getByRole("combobox", { name: "Expression" });
  await expect(expression.locator("option")).toHaveCount(2);
  await expression.selectOption({ label: "second look" });
  await page.getByRole("button", { name: "Remove expression" }).click();
  await expect(
    page.getByText("“second look” was removed. Use Undo to restore it.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(expression.locator("option")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Remove expression" }),
  ).toBeDisabled();
  await characters();
  await page
    .getByRole("button", { name: "Remove Spare Portrait", exact: true })
    .click();
  await expect(
    page.getByText("Spare Portrait was removed. Use Undo to restore them.", {
      exact: true,
    }),
  ).toBeVisible();
  const exported = await exportJson(page);
  expect(
    exported.backgrounds.find((item) => item.name === "night market")?.src,
  ).toMatch(/^data:image\/png;base64,/);
  expect(exported.characters.some((c) => c.name === "Spare Portrait")).toBe(
    false,
  );
  expect(exported.characters.some((c) => c.id === "mira")).toBe(true);
});

test("animation lab changes expression and performance controls without runtime errors", async ({
  page,
}, testInfo) => {
  const expression = page.getByRole("combobox", {
    name: "Expression",
    exact: true,
  });
  const options = expression.locator("option");
  const hasRig = await page
    .getByRole("button", { name: "Show rig regions", exact: true })
    .isEnabled();
  if (hasRig) {
    await expect(page.getByText("RIG ACTIVE", { exact: true })).toBeVisible({
      timeout: 45_000,
    });
    if ((await options.count()) > 1) {
      const second = await options.nth(1).getAttribute("value");
      await expression.selectOption(second!);
      await expect(expression).toHaveValue(second!);
      await expect(page.getByText("RIG ACTIVE", { exact: true })).toBeVisible({
        timeout: 45_000,
      });
    }
    const blink = page.getByRole("checkbox", { name: /Natural blinking/ });
    await blink.uncheck();
    await expect(blink).not.toBeChecked();
    await blink.check();
    await page.getByRole("button", { name: "Blink once", exact: true }).click();
    await page.getByRole("button", { name: "C", exact: true }).click();
    await expect(
      page.getByText("Holding shape C. Click it again to follow audio.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.locator(".lab-actor canvas[data-mouth-shape]"),
    ).toHaveAttribute("data-mouth-shape", "C");
    await page.getByRole("button", { name: "C", exact: true }).click();
    await expect(
      page.getByText(
        "Inspect individual mouth shapes, then hear them in motion.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.locator(".lab-actor canvas[data-mouth-shape]"),
    ).toHaveAttribute("data-mouth-shape", "X");
    await page
      .getByRole("button", { name: "Show rig regions", exact: true })
      .click();
    await expect(
      page.getByLabel("Registered mouth and eye regions"),
    ).toBeVisible();
  } else {
    testInfo.annotations.push({
      type: "coverage",
      description:
        "No optional calibrated cast pack installed; static portrait controls verified. Rig controls require a calibrated character pack.",
    });
    await expect(
      page.getByRole("button", { name: "Blink once", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "C", exact: true }),
    ).toBeDisabled();
  }
  const breathing = page.getByRole("checkbox", { name: /Breathing/ });
  await breathing.uncheck();
  await expect(breathing).not.toBeChecked();
  await breathing.check();
  await page
    .getByRole("button", { name: "Pause animation", exact: true })
    .click();
  await expect(page.getByText("Motion paused", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Resume animation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Compare with static portrait", exact: true })
    .click();
  await expect(
    page.getByText("Original artwork", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Preview background" })
    .selectOption("night");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.getByText("110%", { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("animation-lab.png"),
    fullPage: true,
  });
});

test("scene editing repairs graph references and project JSON round-trips", async ({
  page,
}) => {
  await openScenes(page);
  await expect(page.locator(".node-card")).toHaveCount(5);
  await page
    .locator(".node-list-header")
    .getByRole("button", { name: "Add scene" })
    .click();
  await expect(page.locator(".node-card")).toHaveCount(6);
  await page
    .getByRole("textbox", { name: "Scene name", exact: true })
    .fill("A test interruption");
  await page
    .getByRole("textbox", { name: /^Dialogue/ })
    .fill("A new line connects the opening to a choice.");
  await page
    .getByRole("combobox", { name: "Character", exact: true })
    .selectOption("noah");
  await openTab(page, "Look");
  await page
    .getByRole("combobox", { name: "Background", exact: true })
    .selectOption("night");
  await openTab(page, "Stage");
  await page
    .getByRole("slider", { name: /^Stage position/ })
    .press("ArrowLeft");
  await openTab(page, "Write");
  await page
    .getByRole("combobox", { name: "Scene type", exact: true })
    .selectOption("choice");
  await page.getByRole("button", { name: "Add choice", exact: true }).click();
  await expect(
    page.getByText(
      "Choose a valid next scene for every connection before playing this part of the story.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page
      .locator(".editor-toolbar")
      .getByRole("button", { name: "Play story", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Choice 1 text", exact: true })
    .fill("Explore the invitation");
  await page
    .getByRole("textbox", { name: "Choice 2 text", exact: true })
    .fill("End the experiment");
  await page
    .getByRole("combobox", { name: "Choice 1 target scene", exact: true })
    .selectOption("invitation");
  await page
    .getByRole("combobox", { name: "Choice 2 target scene", exact: true })
    .selectOption("ending");
  await expect(
    page
      .locator(".editor-toolbar")
      .getByRole("button", { name: "Play story", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Duplicate scene", exact: true })
    .click();
  await expect(page.locator(".node-card")).toHaveCount(7);
  await page.getByRole("button", { name: "Delete scene", exact: true }).click();
  await expect(page.locator(".node-card")).toHaveCount(6);
  const exported = await exportJson(page);
  const added = exported.nodes.find(
    (node) => node.label === "A test interruption",
  );
  expect(added?.type).toBe("choice");
  expect(added?.position).toBe(64);
  expect(added?.characterId).toBe("noah");
  expect(added?.backgroundId).toBe("night");
  const initial = exported.nodes.find((node) => node.id === "arrival");
  expect(initial?.type === "dialogue" && initial.nextId).toBe(added?.id);
  const ids = new Set(exported.nodes.map((node) => node.id));
  for (const node of exported.nodes) {
    if (node.type === "dialogue" && node.nextId)
      expect(ids.has(node.nextId)).toBe(true);
    if (node.type === "choice")
      for (const choice of node.choices)
        expect(ids.has(choice.nextId)).toBe(true);
  }
  await importJson(page, { ...exported, title: "Roundtrip proof" });
  const roundtrip = await exportJson(page);
  expect(roundtrip).toEqual({ ...exported, title: "Roundtrip proof" });
  await page
    .locator(".node-card")
    .filter({ hasText: "A test interruption" })
    .click();
  await page.getByRole("button", { name: "Delete scene", exact: true }).click();
  const repaired = await exportJson(page);
  expect(repaired.nodes).toHaveLength(5);
  expect(
    repaired.nodes.some(
      (node) => node.type === "dialogue" && node.nextId === added?.id,
    ),
  ).toBe(false);
});

test("a lab dialogue opens its new scene and later scene selection remains editable", async ({
  page,
}) => {
  await page
    .getByRole("combobox", { name: "Preview character", exact: true })
    .selectOption("mira");
  await page
    .getByRole("textbox", { name: "Give them something to say.", exact: true })
    .fill("This moment began in the animation lab.");
  await page.getByRole("button", { name: "Use in story", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Scene builder." }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^Dialogue/ })).toHaveValue(
    "This moment began in the animation lab.",
  );
  await expect(
    page.getByRole("combobox", { name: "Character", exact: true }),
  ).toHaveValue("mira");
  await expect(page.locator('.node-card[aria-current="true"]')).toContainText(
    "Mira's moment",
  );
  await page
    .locator(".node-card")
    .filter({ hasText: "A place to begin" })
    .click();
  await page
    .getByRole("textbox", { name: /^Dialogue/ })
    .fill("Editing the opening must not reselect the requested scene.");
  await expect(page.locator('.node-card[aria-current="true"]')).toContainText(
    "A place to begin",
  );
  await expect(page.getByRole("textbox", { name: /^Dialogue/ })).toHaveValue(
    "Editing the opening must not reselect the requested scene.",
  );
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Animation lab", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Preview character", exact: true })
    .selectOption("noah");
  await page
    .getByRole("textbox", { name: "Give them something to say.", exact: true })
    .fill("A second character gets a second moment.");
  await page.getByRole("button", { name: "Use in story", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /^Dialogue/ })).toHaveValue(
    "A second character gets a second moment.",
  );
  await expect(page.locator('.node-card[aria-current="true"]')).toContainText(
    "Noah's moment",
  );
  const project = await exportJson(page);
  expect(project.nodes).toHaveLength(7);
  expect(
    project.nodes.find((node) => node.label === "Mira's moment")?.text,
  ).toBe("This moment began in the animation lab.");
  expect(
    project.nodes.find((node) => node.label === "Noah's moment")?.text,
  ).toBe("A second character gets a second moment.");
});

test("an incomplete scene draft survives autosave, reload, and JSON backup import", async ({
  page,
}) => {
  await openScenes(page);
  await page
    .locator(".node-list-header")
    .getByRole("button", { name: "Add scene" })
    .click();
  await page
    .getByRole("textbox", { name: "Scene name", exact: true })
    .fill("An unfinished draft");
  await page
    .getByRole("textbox", { name: /^Dialogue/ })
    .fill("This choice is still a work in progress.");
  await page
    .getByRole("combobox", { name: "Scene type", exact: true })
    .selectOption("choice");
  await page
    .getByRole("textbox", { name: "Choice 1 text", exact: true })
    .fill("");
  await page
    .getByRole("combobox", { name: "Choice 1 target scene", exact: true })
    .selectOption("");
  await expect(
    page
      .locator(".topbar")
      .getByRole("button", { name: "Play story", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Saved on this device", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Save failed", { exact: true })).toHaveCount(0);
  const backup = await exportJson(page);
  const drafted = backup.nodes.find(
    (node) => node.label === "An unfinished draft",
  );
  expect(drafted?.type).toBe("choice");
  if (drafted?.type !== "choice")
    throw new Error("The drafted choice must appear in the backup.");
  expect(drafted.choices).toEqual([
    { id: expect.any(String), text: "", nextId: "" },
  ]);
  await page.reload();
  await expect(
    page.getByText("Saved on this device", { exact: true }),
  ).toBeVisible();
  await openScenes(page);
  await page
    .locator(".node-card")
    .filter({ hasText: "An unfinished draft" })
    .click();
  await expect(page.getByRole("textbox", { name: /^Dialogue/ })).toHaveValue(
    "This choice is still a work in progress.",
  );
  await expect(
    page.getByRole("textbox", { name: "Choice 1 text", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("combobox", { name: "Choice 1 target scene", exact: true }),
  ).toHaveValue("");
  await expect(
    page
      .locator(".editor-toolbar")
      .getByRole("button", { name: "Play story", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Delete scene", exact: true }).click();
  await expect(page.locator(".node-card")).toHaveCount(5);
  await importJson(page, backup);
  await expect(page.locator(".node-card")).toHaveCount(6);
  await page
    .locator(".node-card")
    .filter({ hasText: "An unfinished draft" })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Choice 1 text", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("combobox", { name: "Choice 1 target scene", exact: true }),
  ).toHaveValue("");
  expect(await exportJson(page)).toEqual(backup);
});

test("voice generation attaches audio and cues, finishes preview, and invalidates edited text", async ({
  page,
}) => {
  const samples = 1600;
  const wav = Buffer.alloc(44 + samples, 128);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + samples, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples, 40);
  const audioSrc = `data:audio/wav;base64,${wav.toString("base64")}`;
  const cueUrl = `data:application/json;base64,${Buffer.from(JSON.stringify({ mouthCues: [{ start: 0, end: 0.2, value: "X" }] })).toString("base64")}`;
  const requests: unknown[] = [];
  await page.route("**/api/voice", (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        id: "e2e-line",
        audioSrc,
        cueUrl,
        duration: 0.2,
        model: "eleven_v4",
        voiceId: "test_voice",
        cached: false,
        cueSource: "rhubarb",
      },
    });
  });
  await openScenes(page);
  await page
    .getByRole("textbox", { name: /^Dialogue/ })
    .fill("An entirely local voice test.");
  await openTab(page, "Sound & voice");
  await page
    .getByRole("combobox", { name: "Character voice", exact: true })
    .selectOption("test_voice");
  await page
    .getByRole("button", { name: "Generate voice & sync", exact: true })
    .click();
  await expect(page.getByText(/Audio \+ mouth cues ready/)).toBeVisible();
  expect(requests).toEqual([
    { text: "An entirely local voice test.", voiceId: "test_voice" },
  ]);
  await page
    .getByRole("button", { name: "Preview voice", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Preview voice", exact: true }),
  ).toBeVisible();
  const voiced = await exportJson(page);
  expect(voiced.nodes[0].audioSrc).toBe(audioSrc);
  expect(voiced.nodes[0].cueUrl).toBe(cueUrl);
  expect(voiced.nodes[0].audioDuration).toBe(0.2);
  await openTab(page, "Write");
  // Direction tags change timing, not the words, so the recording stays.
  await page
    .getByRole("textbox", { name: /^Dialogue/ })
    .fill("An entirely local{wait=0.4} voice test.");
  expect((await exportJson(page)).nodes[0].audioSrc).toBe(audioSrc);
  await page
    .getByRole("textbox", { name: /^Dialogue/ })
    .fill("This changed line must not use the old recording.");
  const changed = await exportJson(page);
  expect(changed.nodes[0].audioSrc).toBeUndefined();
  expect(changed.nodes[0].cueUrl).toBeUndefined();
});

test("story preview runs the game player: typewriter, both branches, back, saves, restart, and Escape", async ({
  page,
}) => {
  await page
    .locator(".topbar")
    .getByRole("button", { name: "Play story", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "First Light" });
  await expect(dialog).toBeVisible();
  const player = page.frameLocator('iframe[title="Story preview"]');
  const label = player.locator("#scene-label");
  await expect(label).toHaveText("A place to begin");
  await expect(player.locator("#continue")).toBeFocused();
  const preview = (await (await page
    .locator('iframe[title="Story preview"]')
    .elementHandle())!.contentFrame())!;
  const nodeId = () =>
    preview.evaluate(() => (window as unknown as { FramePlayer: { getState(): { nodeId: string } } }).FramePlayer.getState().nodeId);
  // Typing may already have finished on a slow host, so reveal by state rather than by key.
  await revealLine(preview, "arrival");
  await expect(player.locator("#dialogue")).toHaveText(
    "Every story begins with a small possibility. A place, a person, a moment worth staying for.",
  );
  await expect(player.locator("#continue")).toHaveText("Continue →");
  // A revealed line always advances, so the keys are tested where their effect is certain.
  await page.keyboard.press("Space");
  await expect.poll(nodeId).toBe("invitation");
  await revealLine(preview, "invitation");
  await expect(
    player.getByRole("button", { name: /Let’s see what’s out there/ }),
  ).toBeVisible();
  await page.keyboard.press("1");
  await expect(label).toHaveText("The world outside");
  await player.getByRole("button", { name: "Save / Load" }).click();
  await player.getByRole("button", { name: "Save to slot 1" }).click();
  await expect(player.locator("#save-slots li").first()).toContainText(
    "The world outside",
  );
  await player.getByRole("button", { name: "Close", exact: true }).click();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(nodeId).toBe("invitation");
  await revealLine(preview, "invitation");
  await player
    .getByRole("button", { name: /Stay a little. Tell me a story./ })
    .click();
  await expect(label).toHaveText("A story between us");
  await revealLine(preview, "inside");
  await page.keyboard.press("ArrowRight");
  await expect.poll(nodeId).toBe("ending");
  await revealLine(preview, "ending");
  await expect(player.locator("#hint")).toHaveText("The end");
  await expect(player.locator("#continue")).toHaveText("Read again ↺");
  await player.getByRole("button", { name: "Save / Load" }).click();
  await player.getByRole("button", { name: "Load slot 1" }).click();
  await expect(label).toHaveText("The world outside");
  await player.getByRole("button", { name: "Restart", exact: true }).click();
  await expect(label).toHaveText("A place to begin");
  await expect(player.locator("#back")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page
      .locator(".topbar")
      .getByRole("button", { name: "Play story", exact: true }),
  ).toBeFocused();
});

/** A short silent WAV, enough for the player to treat it as real audio. */
function silentWav(seconds = 0.3, rate = 8000): string {
  const samples = Math.round(seconds * rate);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return `data:audio/wav;base64,${buffer.toString("base64")}`;
}

test("variables, conditional choices, branches, cast and music play in an offline exported game", async ({
  page,
  browser,
}, testInfo) => {
  const project = await exportJson(page);
  const wav = silentWav();
  project.title = "Logic test";
  project.variables = [
    { id: "trust", name: "Trust", type: "number", initial: 0 },
  ];
  project.sounds = [
    { id: "theme", name: "Theme", src: wav, kind: "music" },
    { id: "chime", name: "Chime", src: wav, kind: "sfx" },
  ];
  const node = (id: string) => project.nodes.find((item) => item.id === id)!;
  Object.assign(node("arrival"), {
    musicId: "theme",
    transition: "fade",
    cast: [{ characterId: "noah", position: 25, flip: true }],
  });
  const invitation = node("invitation");
  if (invitation.type !== "choice") throw new Error("fixture");
  invitation.choices[0].effects = [
    { variableId: "trust", operation: "add", value: 2 },
  ];
  invitation.choices.push({
    id: "secret",
    text: "The trusted path",
    nextId: "ending",
    conditions: [{ variableId: "trust", operator: ">=", value: 2 }],
  });
  for (const id of ["outside", "inside"])
    Object.assign(node(id), { nextId: "router" });
  project.nodes.push(
    {
      id: "router",
      label: "Router",
      type: "branch",
      text: "",
      position: 50,
      branches: [
        {
          id: "trusted",
          conditions: [{ variableId: "trust", operator: ">=", value: 2 }],
          nextId: "ending",
        },
      ],
      elseId: "quiet",
    },
    {
      id: "quiet",
      label: "A quiet ending",
      type: "end",
      text: "Some evenings stay quiet.",
      position: 50,
      sfxId: "chime",
      musicId: null,
    },
  );
  await importJson(page, project);
  await page.getByRole("button", { name: "Project", exact: true }).click();
  const downloadEvent = page.waitForEvent("download", { timeout: 60_000 });
  await page
    .getByRole("button", { name: "Export playable game", exact: true })
    .click();
  const file = testInfo.outputPath("logic-test.html");
  await (await downloadEvent).saveAs(file);

  const offline = await browser.newContext({ offline: true });
  const game = await offline.newPage();
  const errors: string[] = [];
  game.on("pageerror", (error) => errors.push(error.message));
  const state = () =>
    game.evaluate(
      () =>
        (
          window as unknown as {
            FramePlayer: {
              getState(): {
                nodeId: string;
                variables: Record<string, unknown>;
                musicId: string | null;
                actors: string[];
              };
            };
          }
        ).FramePlayer.getState(),
    );
  await game.goto(pathToFileURL(file).href);
  await game.getByRole("button", { name: "Begin story →" }).click();
  await expect.poll(async () => (await state()).actors.sort()).toEqual([
    "mira",
    "noah",
  ]);
  expect((await state()).musicId).toBe("theme");
  await expect(game.locator(".actor.flipped")).toHaveCount(1);
  await expect(game.locator(".actor.listening")).toHaveCount(1);
  await revealLine(game, "arrival");
  await game.locator("#continue").click();
  await expect(
    game.getByRole("button", { name: /Let’s see what’s out there/ }),
  ).toBeVisible();
  await expect(
    game.getByRole("button", { name: /The trusted path/ }),
  ).toHaveCount(0);
  await game.getByRole("button", { name: /Let’s see what’s out there/ }).click();
  expect((await state()).variables).toEqual({ trust: 2 });
  await revealLine(game, "outside");
  await game.locator("#continue").click();
  await expect.poll(async () => (await state()).nodeId).toBe("ending");
  await game.locator("#back").click();
  await game.locator("#back").click();
  expect((await state()).variables).toEqual({ trust: 0 });
  await expect(
    game.getByRole("button", { name: /The trusted path/ }),
  ).toHaveCount(0);
  await game.getByRole("button", { name: /Stay a little/ }).click();
  await revealLine(game, "inside");
  await game.locator("#continue").click();
  await expect.poll(async () => (await state()).nodeId).toBe("quiet");
  expect((await state()).musicId).toBe(null);
  await expect(game.locator("#dialogue")).toHaveText(
    "Some evenings stay quiet.",
  );

  await game.reload();
  await expect(
    game.getByRole("button", { name: "Continue where you left off" }),
  ).toBeVisible();
  await game.getByRole("button", { name: "Continue where you left off" }).click();
  await expect.poll(async () => (await state()).nodeId).toBe("quiet");
  await game.getByRole("button", { name: "Settings" }).click();
  await game.getByRole("combobox", { name: "Text speed" }).selectOption("fast");
  await game.getByRole("button", { name: "Close", exact: true }).click();
  expect(errors).toEqual([]);
  await offline.close();
});

test("authoring tools: variables, choice effects, branch scenes, stage cast, story map and script import", async ({
  page,
}) => {
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Story data" })
    .click();
  await page.getByRole("button", { name: "Add variable" }).click();
  await page
    .getByRole("textbox", { name: "Variable 1 name" })
    .fill("Curiosity");
  await openScenes(page);

  await openTab(page, "Stage");
  await page.getByRole("button", { name: "Add character to stage" }).click();
  await expect(
    page.getByRole("combobox", { name: "On-stage character 1", exact: true }),
  ).toHaveValue("noah");
  await expect(
    page.frameLocator('iframe[title="Live scene"]').locator(".actor"),
  ).toHaveCount(2);

  await page.locator(".node-card").filter({ hasText: "An open invitation" }).click();
  await openTab(page, "Write");
  await page.locator(".choice-logic summary").first().click();
  await page.getByRole("button", { name: "Add choice 1 effect" }).click();
  await page
    .getByRole("spinbutton", { name: "Choice 1 effect 1 value" })
    .fill("3");
  await page.locator(".choice-logic summary").nth(1).click();
  await page.getByRole("button", { name: "Add choice 2 condition" }).click();
  await page
    .getByRole("combobox", { name: "Choice 2 condition 1 comparison" })
    .selectOption(">=");

  await page.locator(".node-card").filter({ hasText: "The world outside" }).click();
  await page
    .locator(".node-list-header")
    .getByRole("button", { name: "Add scene" })
    .click();
  await page
    .getByRole("textbox", { name: "Scene name", exact: true })
    .fill("Curious check");
  await page
    .getByRole("combobox", { name: "Scene type", exact: true })
    .selectOption("branch");
  await page.getByRole("button", { name: "Add branch 1 condition" }).click();
  await page
    .getByRole("combobox", { name: "Branch 1 condition 1 comparison" })
    .selectOption(">");
  await page
    .getByRole("combobox", { name: "Branch 1 target scene" })
    .selectOption("ending");
  await page
    .getByRole("combobox", { name: "Otherwise go to" })
    .selectOption("inside");
  await expect(page.getByText("INVISIBLE BRANCH")).toBeVisible();

  await page.getByRole("button", { name: "Story map" }).click();
  await expect(page.locator(".map-node")).toHaveCount(6);
  await expect(page.locator(".map-node.type-branch")).toHaveCount(1);
  await page.getByRole("button", { name: /Open scene 1: A place to begin/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Scene name", exact: true }),
  ).toHaveValue("A place to begin");

  await page.getByRole("button", { name: "Import script" }).click();
  const dialog = page.getByRole("dialog", { name: "Import a script" });
  await dialog
    .getByRole("textbox", { name: "Script" })
    .fill(
      "# Late\nMira: It's getting late.\nNoah: One more story?\n* Yes -> More\n* No -> Goodnight\n# More\nMira: Then listen closely.\n-> Goodnight\n# Goodnight\n@end Goodnight.",
    );
  await expect(dialog.getByText(/^4 scenes ready/)).toBeVisible();
  await dialog.getByRole("button", { name: "Import scenes" }).click();
  await expect(
    page.getByText("4 scenes imported from your script."),
  ).toBeVisible();
  await expect(page.locator(".node-card")).toHaveCount(10);

  const exported = await exportJson(page);
  expect(exported.schemaVersion).toBe(3);
  expect(exported.variables).toHaveLength(1);
  const variableId = exported.variables[0].id;
  const choiceNode = exported.nodes.find((item) => item.id === "invitation");
  expect(choiceNode?.type === "choice" && choiceNode.choices[0].effects).toEqual([
    { variableId, operation: "add", value: 3 },
  ]);
  expect(
    choiceNode?.type === "choice" && choiceNode.choices[1].conditions?.[0],
  ).toMatchObject({ variableId, operator: ">=" });
  const branch = exported.nodes.find((item) => item.label === "Curious check");
  expect(branch).toMatchObject({ type: "branch", elseId: "inside" });
  expect(exported.nodes.find((item) => item.id === "arrival")?.cast).toEqual([
    { characterId: "noah", poseId: "neutral", position: 30 },
  ]);
  const imported = exported.nodes.find((item) => item.label === "Late");
  expect(imported).toMatchObject({ characterId: "mira", type: "dialogue" });
  const firstNext = imported?.type === "dialogue" ? imported.nextId : null;
  const choiceScene = exported.nodes.find((item) => item.id === firstNext);
  expect(choiceScene?.type).toBe("choice");
});

test("batch voicing confirms the cost, stops at the first failure and never retries on its own", async ({
  page,
}) => {
  const project = await exportJson(page);
  for (const character of project.characters)
    if (character.id === "mira" || character.id === "noah")
      character.voiceId = "test_voice";
  await importJson(page, project);
  const audioSrc = silentWav(0.2);
  const requests: { text: string; voiceId: string }[] = [];
  await page.route("**/api/voice", (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 2)
      return route.fulfill({
        status: 409,
        json: {
          error: {
            code: "attempt_needs_review",
            message: "A previous attempt may have been billed.",
            id: "a".repeat(64),
          },
        },
      });
    return route.fulfill({
      json: {
        id: `line-${requests.length}`,
        audioSrc,
        cueUrl: `data:application/json;base64,${Buffer.from('{"mouthCues":[]}').toString("base64")}`,
        duration: 0.2,
        model: "eleven_v4",
        voiceId: "test_voice",
        cached: requests.length === 3,
        cueSource: "rhubarb",
      },
    });
  });
  await openScenes(page);
  await page.getByRole("button", { name: "Voice missing lines" }).click();
  const dialog = page.getByRole("dialog", { name: "Voice missing lines" });
  await expect(dialog.locator(".batch-summary li").first()).toContainText(
    "4 lines to voice",
  );
  await expect(dialog.getByText("1 narration line skipped.")).toBeVisible();
  expect(requests).toEqual([]);
  await dialog
    .getByRole("button", { name: "Generate 4 voice lines" })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "A previous attempt may have been billed.",
  );
  await expect(dialog.getByText("1 of 4 voiced.")).toBeVisible();
  expect(requests).toHaveLength(2);
  await dialog.getByRole("button", { name: "Continue with 3" }).click();
  await expect(dialog.getByText(/4 of 4 voiced \(1 from saved audio\)\. All done\./)).toBeVisible();
  expect(requests).toHaveLength(5);
  expect(requests.every((request) => request.voiceId === "test_voice")).toBe(
    true,
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
  const voiced = await exportJson(page);
  expect(
    voiced.nodes.filter((node) => node.audioSrc?.startsWith("data:audio/wav")),
  ).toHaveLength(4);
});

test("small screens retain accessible content without horizontal document overflow", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ["Animation lab", "Characters", "Scene builder"]) {
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", {
        name: name === "Characters" ? /^Characters/ : name,
        exact: name !== "Characters",
      })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      `${name} must fit the viewport`,
    ).toBe(true);
  }
  const clipped = await page
    .locator(
      ".scene-workspace, .scene-inspector, .scene-fields input, .scene-fields textarea, .scene-fields select",
    )
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const rect = element.getBoundingClientRect();
        return rect.right > innerWidth + 1 || rect.left < 0
          ? [
              {
                element: element.tagName,
                className: element.className,
                left: rect.left,
                right: rect.right,
              },
            ]
          : [];
      }),
    );
  expect(
    clipped,
    "Clipping overflow must not hide scene controls or the live stage",
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("mobile-scene-builder.png"),
    fullPage: true,
  });
  await page
    .locator(".topbar")
    .getByRole("button", { name: "Play story", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "First Light" });
  await expect(dialog).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  const player = page.frameLocator('iframe[title="Story preview"]');
  await expect(
    player.getByRole("button", { name: "Close story preview", exact: true }),
  ).toBeInViewport();
  await expect(player.locator(".conversation")).toBeInViewport({ ratio: 1 });
});

test("exported HTML is self-contained and plays from a local file with no server requests", async ({
  page,
  browser,
}, testInfo) => {
  await page.getByRole("button", { name: "Project", exact: true }).click();
  const downloadEvent = page.waitForEvent("download", { timeout: 60_000 });
  await page
    .getByRole("button", { name: "Export playable game", exact: true })
    .click();
  const download = await downloadEvent;
  const file = testInfo.outputPath("first-light.html");
  await download.saveAs(file);
  const document = await readFile(file, "utf8");
  expect(document).toContain("data:image/svg+xml;base64,");
  expect(document).not.toMatch(/<script[^>]+src=/i);
  const offline = await browser.newContext({ offline: true });
  const game = await offline.newPage();
  const requests: string[] = [];
  const errors: string[] = [];
  game.on("request", (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url());
  });
  game.on("pageerror", (error) => errors.push(error.message));
  await game.goto(pathToFileURL(file).href);
  await expect(
    game.getByRole("heading", { name: "First Light", exact: true }),
  ).toBeVisible();
  await game
    .getByRole("button", { name: "Begin story →", exact: true })
    .click();
  // Deliberately let typing finish: revealing an already-complete line must not advance it.
  await expect.poll(() => game.evaluate(() =>
    (window as unknown as { FramePlayer: { getState(): { revealed: boolean } } }).FramePlayer.getState().revealed,
  )).toBe(true);
  await revealLine(game, "arrival");
  await expect(game.locator("#dialogue")).toHaveText(
    "Every story begins with a small possibility. A place, a person, a moment worth staying for.",
  );
  await game.locator("#continue").click();
  await game
    .getByRole("button", { name: /Let’s see what’s out there/ })
    .click();
  await revealLine(game, "outside");
  await expect(game.locator("#dialogue")).toHaveText(
    "Look up. Even familiar places feel different when you give them a second glance.",
  );
  await game.locator("#back").click();
  await game
    .getByRole("button", { name: /Stay a little. Tell me a story./ })
    .click();
  await revealLine(game, "inside");
  await expect(game.locator("#dialogue")).toHaveText(
    "All right. But the best stories leave a little room for you to change them.",
  );
  await game.getByRole("button", { name: "History", exact: true }).click();
  await expect(game.getByRole("dialog")).toBeVisible();
  await game.getByRole("button", { name: "Close", exact: true }).click();
  await game.getByRole("button", { name: "Restart", exact: true }).click();
  await expect(game.locator("#back")).toBeDisabled();
  expect(
    await game
      .locator(".bg-layer.is-top img")
      .evaluate(
        (element: HTMLImageElement) =>
          element.complete && element.naturalWidth > 0,
      ),
  ).toBe(true);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
  await game.screenshot({ path: testInfo.outputPath("offline-export.png") });
  await offline.close();
});

test("voice studio voices a two-person script with confirmed requests and stages it as scenes", async ({
  page,
}) => {
  const requests: { text: string; voiceId: string }[] = [];
  await page.route("**/api/voice/history", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/voice", (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    return route.fulfill({
      json: {
        id: `line-${requests.length}`,
        audioSrc: silentWav(0.4),
        cueUrl: `data:application/json;base64,${Buffer.from(JSON.stringify({ mouthCues: [] })).toString("base64")}`,
        duration: 0.4,
        model: "eleven_v4",
        voiceId: body.voiceId,
        cached: false,
        cueSource: "rhubarb",
      },
    });
  });
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Voice studio" })
    .click();
  await expect(page.getByRole("heading", { name: "Voice studio." })).toBeVisible();
  await page.getByRole("combobox", { name: "Line 1 speaker" }).selectOption("mira");
  await page.getByRole("textbox", { name: "Line 1 text" }).fill("Are you coming?");
  await page.getByRole("button", { name: "Studio Test Voice" }).click();
  await page.getByRole("button", { name: "Add line" }).click();
  await page.getByRole("combobox", { name: "Line 2 speaker" }).selectOption("noah");
  await page
    .getByRole("textbox", { name: "Line 2 text" })
    .fill("Right behind you{wait=0.5}.");
  await page.getByRole("button", { name: "Studio Test Voice" }).click();
  await page.getByRole("combobox", { name: "Line 2 delivery" }).selectOption("calm");
  // A batch always asks first and lists what it will spend.
  await page.getByRole("button", { name: "Generate all…" }).click();
  const confirm = page.getByRole("dialog", { name: "Generate 2 lines?" });
  await expect(confirm).toContainText("one at a time");
  expect(requests).toEqual([]);
  await confirm.getByRole("button", { name: "Generate 2 lines" }).click();
  await expect(page.getByText("2 of 2 generated · done")).toBeVisible();
  expect(requests.map(({ text, voiceId }) => ({ text, voiceId }))).toEqual([
    { text: "Are you coming?", voiceId: "test_voice" },
    // Direction tags never reach the voice; the delivery tag does.
    { text: "[calm] Right behind you{wait=0.5}.", voiceId: "test_voice" },
  ]);
  await page.getByRole("button", { name: /Add 2 lines to story/ }).click();
  const insert = page.getByRole("dialog", { name: "Add 2 lines to the story" });
  await insert.getByRole("combobox", { name: "Insert after" }).selectOption("arrival");
  await insert.getByRole("button", { name: "Add to story" }).click();
  await expect(page.getByRole("heading", { name: "Scene builder." })).toBeVisible();
  const project = await exportJson(page);
  const arrival = project.nodes.find((node) => node.id === "arrival");
  const first = project.nodes.find(
    (node) => node.id === (arrival?.type === "dialogue" ? arrival.nextId : ""),
  );
  expect(first).toMatchObject({
    characterId: "mira",
    text: "Are you coming?",
    audioDuration: 0.4,
    cast: [{ characterId: "noah" }],
  });
  const second = project.nodes.find(
    (node) => node.id === (first?.type === "dialogue" ? first.nextId : ""),
  );
  expect(second).toMatchObject({ characterId: "noah", cast: [{ characterId: "mira" }] });
  expect(second?.type === "dialogue" && second.nextId).toBe("invitation");
});

test("the live stage shows the real player and dragging a character moves it", async ({
  page,
}) => {
  await openScenes(page);
  const stage = page.frameLocator('iframe[title="Live scene"]');
  const actor = stage.locator(".actor").first();
  await expect(actor).toBeVisible();
  await expect(stage.locator("#dialogue")).toContainText(
    "Every story begins with a small possibility.",
  );
  const box = (await page.locator('iframe[title="Live scene"]').boundingBox())!;
  // Mira stands at 65%; drag her left by a fifth of the stage.
  const start = { x: box.x + box.width * 0.65, y: box.y + box.height * 0.55 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - box.width * 0.1, start.y, { steps: 4 });
  await page.mouse.move(start.x - box.width * 0.2, start.y, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole("tab", { name: "Stage", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("slider", { name: /^Stage position/ })).toHaveValue("45");
  // Look changes reach the stage immediately.
  await openTab(page, "Look");
  await page.getByRole("combobox", { name: "Text box" }).selectOption("bubble");
  await expect(stage.locator("#player")).toHaveAttribute("data-textbox", "bubble");
  await page.getByRole("combobox", { name: "Weather & atmosphere" }).selectOption("snow");
  await expect(stage.locator("#weather")).toHaveClass(/on/);
});

test("the video export dialog plans the route through choices before rendering", async ({
  page,
}) => {
  await page.route("**/api/render", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { jobs: [] } })
      : route.fulfill({ status: 503, json: { error: { message: "Not in tests." } } }),
  );
  await page.getByRole("button", { name: "Project", exact: true }).click();
  await page.getByRole("button", { name: "Export video (MP4)" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Record a playthrough")).toBeVisible();
  await expect(dialog).toContainText("4 scenes");
  await expect(dialog).toContainText("ends at Your story starts here");
  const choice = dialog.getByRole("combobox").filter({ hasText: "Let’s see what’s out there." });
  await choice.selectOption({ label: "Stay a little. Tell me a story." });
  await expect(dialog).toContainText("4 scenes");
  await dialog.locator(".modal-close").click();
  await expect(dialog).toHaveCount(0);
});

test("expressions change between speech: tags in voiced lines wait, and voices start after a morph", async ({
  page,
  browser,
}, testInfo) => {
  const project = await exportJson(page);
  project.title = "Morph timing";
  const mira = project.characters.find((item) => item.id === "mira")!;
  mira.poses.push({ id: "focused", name: "Focused", src: "/assets/characters/noah.svg" });
  const node = (id: string) => project.nodes.find((item) => item.id === id)!;
  Object.assign(node("arrival"), {
    text: "Hello{expression=Focused} there.",
    audioSrc: silentWav(1.4),
  });
  // The next scene starts back in the first expression, so it must morph before speaking.
  Object.assign(node("invitation"), { poseId: "neutral", audioSrc: silentWav(0.6) });
  await importJson(page, project);
  await page.getByRole("button", { name: "Project", exact: true }).click();
  const downloadEvent = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: "Export playable game", exact: true }).click();
  const file = testInfo.outputPath("morph-timing.html");
  await (await downloadEvent).saveAs(file);

  const offline = await browser.newContext({ offline: true });
  const game = await offline.newPage();
  const errors: string[] = [];
  game.on("pageerror", (error) => errors.push(error.message));
  await game.addInitScript(() => {
    const log: { event: string; at: number }[] = [];
    (window as unknown as { morphLog: typeof log }).morphLog = log;
    const samples = { restWhileSpeaking: false, changedDuringVoice: false };
    (window as unknown as { morphSamples: typeof samples }).morphSamples = samples;
    const sample = () => {
      const state = (window as unknown as { FramePlayer?: { getState(): { nodeId: string; revealed: boolean; speaking: boolean; expressions: Record<string, string | null> } } }).FramePlayer?.getState();
      if (state?.nodeId === "arrival" && state.revealed && state.speaking) {
        samples.restWhileSpeaking ||= state.expressions.mira === "neutral";
        samples.changedDuringVoice ||= state.expressions.mira !== "neutral";
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      log.push({ event: "voice", at: performance.now() });
      return play.call(this);
    };
    new MutationObserver((records) => {
      for (const record of records) {
        for (const added of record.addedNodes)
          if ((added as Element).classList?.contains("actor-morph"))
            log.push({ event: "morph-start", at: performance.now() });
        for (const removed of record.removedNodes)
          if ((removed as Element).classList?.contains("actor-morph"))
            log.push({ event: "morph-end", at: performance.now() });
      }
    }).observe(document, { subtree: true, childList: true });
  });
  type State = { nodeId: string; revealed: boolean; speaking: boolean; expressions: Record<string, string | null> };
  const state = () =>
    game.evaluate(() => (window as unknown as { FramePlayer: { getState(): State } }).FramePlayer.getState());
  await game.goto(pathToFileURL(file).href);
  await game.getByRole("button", { name: "Begin story →" }).click();
  // Observe inside the page so a slow host cannot miss the short audio window
  // between separate remote calls. A premature face change must never be sampled.
  await expect.poll(async () => (await state()).expressions.mira, { timeout: 8000 }).toBe("focused");
  expect(await game.evaluate(() => (window as unknown as { morphSamples: { restWhileSpeaking: boolean; changedDuringVoice: boolean } }).morphSamples)).toEqual({ restWhileSpeaking: true, changedDuringVoice: false });
  await game.locator("#continue").click();
  await expect.poll(async () => (await state()).nodeId).toBe("invitation");
  await expect.poll(() => game.evaluate(() => (window as unknown as { morphLog: { event: string }[] }).morphLog.filter(entry => entry.event === "voice").length), { timeout: 8000 }).toBe(2);
  const log = await game.evaluate(() => (window as unknown as { morphLog: { event: string; at: number }[] }).morphLog);
  const morphEnds = log.filter((entry) => entry.event === "morph-end").map((entry) => entry.at);
  const voices = log.filter((entry) => entry.event === "voice").map((entry) => entry.at);
  expect(morphEnds.length).toBeGreaterThanOrEqual(2);
  // The second scene's voice starts only after its morph back to Neutral has landed.
  expect(voices.at(-1)!).toBeGreaterThanOrEqual(morphEnds.at(-1)!);
  expect((await state()).expressions.mira).toBe("neutral");
  expect(errors).toEqual([]);
  await offline.close();
});

test("the storyboard blocks a conversation: cast, lines, faces, voice, transitions and order", async ({
  page,
}) => {
  const requests: { text: string; voiceId: string }[] = [];
  await page.route("**/api/voice", (route) => {
    const body = route.request().postDataJSON();
    requests.push({ text: body.text, voiceId: body.voiceId });
    return route.fulfill({
      json: {
        id: `take-${requests.length}`,
        audioSrc: silentWav(0.5),
        cueUrl: `data:application/json;base64,${Buffer.from(JSON.stringify({ mouthCues: [] })).toString("base64")}`,
        duration: 0.5,
        model: "eleven_v4",
        voiceId: body.voiceId,
        cached: false,
        cueSource: "rhubarb",
      },
    });
  });
  // Mira gets a second expression so the face picker has a choice.
  const seeded = await exportJson(page);
  const mira = seeded.characters.find((item) => item.id === "mira")!;
  mira.poses.push({ ...mira.poses[0], id: "smile", name: "Smile" });
  await importJson(page, seeded);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Storyboard" })
    .click();
  const board = page.getByRole("region", { name: "Storyboard" });
  await expect(board.getByText(/Shot\s*01\s*of/)).toBeVisible();
  const stage = page.frameLocator('iframe[title="Live scene"]');
  await expect(stage.locator(".actor")).toHaveCount(1);

  // Drag Noah from the cast onto the left of the stage; he lands on the nearest mark.
  const frame = page.locator('iframe[title="Live scene"]');
  const box = (await frame.boundingBox())!;
  await page
    .locator(".cast-card", { hasText: "Noah" })
    .dragTo(frame, { targetPosition: { x: box.width * 0.31, y: box.height * 0.5 } });
  await expect(stage.locator(".actor")).toHaveCount(2);
  const inspector = page.getByRole("complementary", { name: "Person on stage" });
  await expect(inspector.getByRole("heading", { name: "Noah" })).toBeVisible();
  await expect(inspector.getByText("Listening")).toBeVisible();

  // Mira's face, then hand the line to Noah: Mira stays on stage as a listener.
  await page.getByRole("radiogroup", { name: "Mira's expression" }).getByRole("radio", { name: "Smile" }).click();
  await page.getByRole("radiogroup", { name: "Who speaks" }).getByRole("radio", { name: "Noah" }).click();
  await expect(stage.locator(".actor.speaking")).toHaveAttribute("data-character", "noah");

  // Write the line and animate one word.
  const text = page.locator("#scene-dialogue");
  await text.fill("We should go.");
  await text.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(10, 12));
  await page.getByRole("button", { name: "Animate text" }).click();
  await page.getByRole("button", { name: "Wave animation" }).click();
  await expect(text).toHaveValue("We should {wave}go{/wave}.");
  await expect(stage.locator('#dialogue [data-fx="wave"]')).toHaveCount(2);

  // Voice the line: only the spoken words are sent, once, and the take appears as a waveform.
  await page.getByRole("combobox", { name: "Noah's voice" }).selectOption("test_voice");
  expect(requests).toEqual([]);
  await page.getByRole("button", { name: /Generate voice/ }).click();
  await expect(page.getByRole("button", { name: "Play the take" })).toBeVisible();
  expect(requests).toEqual([{ text: "We should go.", voiceId: "test_voice" }]);
  // A new take asks first, because every take is billed.
  await page.getByRole("button", { name: /New take/ }).click();
  await expect(page.getByRole("button", { name: /Replace this take\?/ })).toBeVisible();
  expect(requests).toHaveLength(1);

  // A transition into the next shot, chosen from the joint on the filmstrip.
  await page.getByRole("button", { name: /Transition into shot 2/ }).click();
  await page
    .getByRole("dialog", { name: "Choose a transition" })
    .getByRole("radio", { name: "Iris open" })
    .click();
  await page.getByRole("dialog", { name: "Choose a transition" }).getByRole("button", { name: "Done" }).click();

  // A new shot continues the stage and hands the line back to the listener.
  await page.getByRole("button", { name: "Insert a shot after shot 1" }).click();
  await expect(board.getByText(/Shot\s*02\s*of/)).toBeVisible();
  await expect(
    page.getByRole("radiogroup", { name: "Who speaks" }).getByRole("radio", { name: "Mira" }),
  ).toHaveAttribute("aria-checked", "true");
  await page.locator("#scene-dialogue").fill("Then lead the way.");
  await page.getByRole("button", { name: "From previous shot" }).click();
  await expect(stage.locator("#dialogue")).toContainText("Then lead the way.", { timeout: 8000 });

  // Drag the new shot in front of the first one: the story now opens with it.
  const cards = page.locator(".shot-card[draggable]");
  const first = (await cards.nth(0).boundingBox())!;
  await cards.nth(1).dragTo(cards.nth(0), { targetPosition: { x: 10, y: first.height / 2 } });
  const project = await exportJson(page);
  const opening = project.nodes[0];
  expect(project.startNodeId).toBe(opening.id);
  expect(opening).toMatchObject({ characterId: "mira", text: "Then lead the way.", nextId: "arrival" });
  const arrival = project.nodes.find((node) => node.id === "arrival")!;
  expect(arrival).toMatchObject({
    characterId: "noah",
    text: "We should {wave}go{/wave}.",
    audioDuration: 0.5,
    position: 30,
    nextId: "invitation",
    cast: [{ characterId: "mira", poseId: "smile", position: 65 }],
  });
  expect(project.nodes.find((node) => node.id === "invitation")?.transition).toBe("iris");
  expect(project.characters.find((item) => item.id === "noah")?.voiceId).toBe("test_voice");
});

test("a voice take still reaches its shot when another shot is opened while it records", async ({
  page,
}) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const requests: string[] = [];
  await page.route("**/api/voice", async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body.text);
    await held;
    await route.fulfill({
      json: {
        id: "late-take",
        audioSrc: silentWav(0.6),
        cueUrl: `data:application/json;base64,${Buffer.from(JSON.stringify({ mouthCues: [] })).toString("base64")}`,
        duration: 0.6,
        model: "eleven_v4",
        voiceId: body.voiceId,
        cached: false,
        cueSource: "rhubarb",
      },
    });
  });
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Storyboard" })
    .click();
  await page.getByRole("combobox", { name: "Mira's voice" }).selectOption("test_voice");
  await page.getByRole("button", { name: /Generate voice/ }).click();
  await expect(page.getByRole("button", { name: /Recording/ })).toBeVisible();
  // Open another shot before the recording is ready.
  await page.getByRole("button", { name: /^Shot 3:/ }).click();
  release();
  await expect(page.locator('.shot-card[aria-label^="Shot 1:"] .badge-voiced')).toBeVisible();
  expect(requests).toHaveLength(1);
  const project = await exportJson(page);
  expect(project.nodes.find((node) => node.id === "arrival")).toMatchObject({ audioDuration: 0.6 });
  expect(project.nodes.find((node) => node.id === "outside")?.audioSrc).toBeUndefined();
});

test("small landscape storyboard stages keep the example face above the text", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  const stage = page.frameLocator('iframe[title="Live scene"]');
  await expect(stage.locator(".actor canvas").first()).toBeVisible();
  await expect
    .poll(() =>
      stage
        .locator(".actor canvas")
        .first()
        .evaluate((canvas) => {
          const image = canvas.getBoundingClientRect(),
            panel = document
              .querySelector(".conversation")!
              .getBoundingClientRect();
          // The approved portrait's chin is at source y=400 of 1536.
          return image.top + (image.height * 400) / 1536 < panel.top;
        }),
    )
    .toBe(true);
});
