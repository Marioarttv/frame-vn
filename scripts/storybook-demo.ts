#!/usr/bin/env -S npx tsx
/**
 * Exports or renders the storybook demo (tests/fixtures/storybook-demo.ts):
 *
 *   npx tsx scripts/storybook-demo.ts html <out.html>               offline game
 *   npx tsx scripts/storybook-demo.ts record <out.html>             recording document
 *   npx tsx scripts/storybook-demo.ts render <out.mp4> [w h fps]    MP4 (Chromium + FFmpeg)
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportRecordingHtml, exportStandaloneHtml } from "../src/engine/export";
import { renderRecording } from "../server/render/renderer";
import { createStorybookDemo } from "../tests/fixtures/storybook-demo";

const [mode, output, width = "1920", height = "1080", fps = "30"] = process.argv.slice(2);
if (!mode || !output || !["html", "record", "render"].includes(mode)) {
  console.error("Usage: storybook-demo.ts html|record|render <output> [width height fps]");
  process.exit(1);
}
const options = {
  // The starter art ships in public/assets.
  resolveAsset: async (src: string) =>
    src.startsWith("/assets/")
      ? `data:image/svg+xml;base64,${(await readFile(join("public", src))).toString("base64")}`
      : undefined,
};
const project = createStorybookDemo();
if (mode === "html") {
  await writeFile(output, await exportStandaloneHtml(project, options));
  console.log(`Wrote ${output}`);
} else {
  const html = await exportRecordingHtml(project, { linePause: 900 }, options);
  if (mode === "record") {
    await writeFile(output, html);
    console.log(`Wrote ${output}`);
  } else {
    const work = await mkdtemp(join(tmpdir(), "frame-storybook-"));
    try {
      const htmlPath = join(work, "story.html");
      await writeFile(htmlPath, html);
      const started = Date.now();
      const result = await renderRecording({
        htmlPath,
        outputPath: output,
        workDir: join(work, "scratch"),
        width: Number(width),
        height: Number(height),
        fps: Number(fps),
        maxSeconds: 120,
        onProgress: (progress) => {
          if (progress.phase !== "rendering") console.log(progress.phase);
        },
      });
      console.log(
        JSON.stringify(
          { ...result, realSeconds: (Date.now() - started) / 1000 },
          null,
          2,
        ),
      );
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
}
