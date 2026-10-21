/** Headless-canvas helpers for authoring inspection. Pixels come only from caller-supplied local files. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { launchAuthoringBrowser } from "./browser.mjs";

export const dataUrl = async (file) =>
  "data:image/" +
  path.extname(file).slice(1).toLowerCase().replace("jpg", "jpeg") +
  ";base64," +
  (await readFile(file)).toString("base64");

/**
 * Run `script` (a function source string) inside a blank authoring page with the
 * supplied images decoded. The function receives `{ images, args, helpers }` and
 * returns JSON-serialisable data; PNG results are returned as base64 strings.
 */
export async function withCanvas(files, args, script) {
  const images = {};
  for (const [key, file] of Object.entries(files))
    images[key] = await dataUrl(file);
  const browser = await launchAuthoringBrowser();
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) => route.abort());
    return await page.evaluate(
      async ({ images, args, script }) => {
        const decoded = {};
        for (const [key, src] of Object.entries(images)) {
          const image = new Image();
          image.src = src;
          await image.decode();
          decoded[key] = image;
        }
        const helpers = {
          make(w, h) {
            const c = document.createElement("canvas");
            c.width = Math.max(1, Math.round(w));
            c.height = Math.max(1, Math.round(h));
            return c;
          },
          ctx(c) {
            return c.getContext("2d", { willReadFrequently: true });
          },
          png(c) {
            return c.toDataURL("image/png").split(",")[1];
          },
          crop(image, [x, y, w, h], scale = 1) {
            const c = helpers.make(w * scale, h * scale),
              g = helpers.ctx(c);
            g.imageSmoothingEnabled = scale < 1;
            g.drawImage(image, x, y, w, h, 0, 0, c.width, c.height);
            return c;
          },
          luminance(data, i) {
            return data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
          },
        };
        const fn = new Function("return (" + script + ")")();
        return fn({ images: decoded, args, helpers });
      },
      { images, args, script },
    );
  } finally {
    await browser.close();
  }
}
