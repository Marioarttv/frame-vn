import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { launchAuthoringBrowser } from "../scripts/character/browser.mjs";
import { PORTRAIT_RUNTIME_SOURCE } from "../src/animation/player-runtime.generated";

test(
  "distributed rigs preserve source rest and isolate blinks while speaking",
  { timeout: 60000 },
  async () => {
    const browser = await launchAuthoringBrowser();
    try {
      for (const name of ["mira", "noah"]) {
        const directory = `public/assets/characters/${name}`,
          prefix = `/assets/characters/${name}`;
        const catalog = JSON.parse(
          await readFile(`${directory}/catalog.json`, "utf8"),
        );
        const recipe = JSON.parse(
          await readFile(`art/characters/${name}/poses/neutral.json`, "utf8"),
        );
        const assets: Record<string, string> = {};
        for (const file of await readdir(directory))
          if (/\.(json|png)$/.test(file))
            assets[`${prefix}/${file}`] =
              `data:${file.endsWith(".json") ? "application/json" : "image/png"};base64,${(await readFile(`${directory}/${file}`)).toString("base64")}`;
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.route("**/*", (route) => route.abort());
        await page.setContent(
          '<div id="portrait" style="width:512px;height:768px"></div>',
        );
        await page.addScriptTag({ content: "globalThis.__name=(fn)=>fn;" });
        await page.addScriptTag({ content: PORTRAIT_RUNTIME_SOURCE });
        await page.evaluate(
          async ({ assets, character }: any) => {
            const w = window as any;
            w.c = w.FrameAnimation.createPortraitController(
              document.querySelector("#portrait"),
              {
                character,
                pose: character.poses[0],
                settings: {
                  blink: false,
                  life: false,
                  breathing: false,
                  head: false,
                  gaze: false,
                  secondary: false,
                  brow: 0,
                },
                resolveAsset: (u: string) => assets[u] || u,
              },
            );
            if (!(await w.c.ready)) throw new Error("Rig unavailable");
            w.read = () => {
              const c = document.querySelector("canvas")!;
              return c.getContext("2d")!.getImageData(0, 0, c.width, c.height)
                .data;
            };
            w.rest = w.read();
            const source = new Image();
            source.src = assets[character.poses[0].src];
            await source.decode();
            const c = document.createElement("canvas");
            c.width = source.width;
            c.height = source.height;
            c.getContext("2d")!.drawImage(source, 0, 0);
            const original = c
              .getContext("2d")!
              .getImageData(0, 0, c.width, c.height).data;
            w.neutralChanges = original.reduce(
              (sum: number, v: number, i: number) =>
                sum + Number(v !== w.rest[i]),
              0,
            );
          },
          { assets, character: catalog.characters[0] },
        );
        await page.waitForFunction(() => {
          const s = (window as any).c.getStatus();
          return s.blinkReady && s.gazeReady && s.browsReady;
        });
        await page.evaluate(() => {
          const w = window as any;
          w.c.setMouthShape("C");
          w.mouth = w.read();
        });
        await page.clock.install({ time: new Date("2026-10-21T12:00:00Z") });
        await page.clock.pauseAt(new Date("2026-10-21T12:00:01Z"));
        await page.evaluate(() => {
          const w = window as any;
          w.c.update({ blink: true });
          if (!w.c.triggerBlink()) throw new Error("Blink unavailable");
        });
        await page.clock.runFor(110);
        const closed = await page.evaluate(
          (eyes: number[][]) => {
            const w = window as any,
              pixels = w.read();
            let outside = 0,
              changed = 0;
            for (let y = 0; y < 1536; y++)
              for (let x = 0; x < 1024; x++) {
                const eye = eyes.some(
                  ([a, b, sw, sh]) =>
                    x >= a && y >= b && x < a + sw && y < b + sh,
                );
                for (let c = 0; c < 4; c++) {
                  const k = (y * 1024 + x) * 4 + c;
                  if (pixels[k] !== w.mouth[k]) {
                    if (eye) changed++;
                    else outside++;
                  }
                }
              }
            return {
              neutralChanges: w.neutralChanges,
              outside,
              changed,
              closure: w.c.getStatus().blinkClosure,
            };
          },
          recipe.eyes.map((e: any) => e.rect),
        );
        assert.equal(closed.neutralChanges, 0, `${name}: exact approved rest`);
        assert.equal(
          closed.outside,
          0,
          `${name}: mouth and other pixels stay fixed`,
        );
        assert.ok(
          closed.changed > 0 && closed.closure > 0.95,
          `${name}: closed eyes actually rendered`,
        );
        await page.clock.runFor(600);
        const restored = await page.evaluate(() => {
          const w = window as any;
          w.c.setMouthShape("X");
          const p = w.read();
          const changed = p.reduce(
            (s: number, v: number, i: number) => s + Number(v !== w.rest[i]),
            0,
          );
          w.c.dispose();
          return changed;
        });
        assert.equal(restored, 0, `${name}: exact neutral restoration`);
        assert.deepEqual(errors, []);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  },
);
