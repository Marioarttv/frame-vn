import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createShowcaseProject } from "../src/engine";
import { discoverStoryTemplates } from "../server/story-templates";

test("local packs offer their example stories as templates, skipping unsafe or invalid files", async () => {
  const root = await mkdtemp(join(tmpdir(), "frame-stories-"));
  try {
    const stories = join(root, "public", "local-packs", "demo", "stories");
    await mkdir(stories, { recursive: true });
    await writeFile(
      join(stories, "tour.json"),
      JSON.stringify(createShowcaseProject("tour")),
    );
    await writeFile(join(stories, "broken.json"), "{ not json");
    const outside = join(root, "outside.json");
    await writeFile(outside, JSON.stringify(createShowcaseProject("outside")));
    await symlink(outside, join(stories, "escape.json"));
    const { templates, warnings } = await discoverStoryTemplates(root);
    assert.deepEqual(templates, [
      {
        id: "demo/tour.json",
        title: "Stage Tour",
        description: createShowcaseProject().description,
        scenes: createShowcaseProject().nodes.length,
        pack: "demo",
        src: "/local-packs/demo/stories/tour.json",
      },
    ]);
    assert.equal(warnings.length, 2);
    assert.match(warnings.join("\n"), /broken\.json/);
    assert.match(warnings.join("\n"), /escape\.json: it points outside/);
    // No packs folder at all is simply an empty list.
    assert.deepEqual(await discoverStoryTemplates(join(root, "missing")), {
      templates: [],
      warnings: [],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
