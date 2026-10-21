import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { validatePackedCharacter } from "../scripts/character/validate.mjs";
import {
  createExampleProject,
  createExampleTour,
} from "../src/studio/examples";
import { exportStandaloneHtml, validateProject } from "../src/engine";

test("public examples have valid asset closure and immutable approved source portraits", async () => {
  for (const name of ["mira", "noah"]) {
    const dir = `public/assets/characters/${name}`;
    const result = await validatePackedCharacter(dir);
    assert.equal(result.valid, true, result.errors.join("\n"));
    const bytes = await readFile(`${dir}/portrait.png`);
    assert.deepEqual(
      bytes,
      await readFile(`art/characters/${name}/source/portrait.png`),
    );
    const provenance = JSON.parse(
      await readFile(`art/characters/${name}/provenance.json`, "utf8"),
    );
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      provenance.source.sha256,
    );
    const catalog = JSON.parse(await readFile(`${dir}/catalog.json`, "utf8"));
    assert.equal(catalog.localOnly, false);
  }
});

test("studio templates use public animated examples and export their real nested assets", async () => {
  for (const project of [createExampleProject(), createExampleTour()]) {
    assert.equal(validateProject(project).valid, true);
    for (const character of project.characters) {
      assert.equal(character.poses[0].id, "neutral");
      assert.ok(
        character.poses[0].animation?.assetRoot?.startsWith(
          "/assets/characters/",
        ),
      );
    }
  }
  const html = await exportStandaloneHtml(createExampleProject(), {
    resolveAsset: async (src) => {
      assert.ok(src.startsWith("/assets/"));
      const bytes = await readFile(`public${src}`);
      const mime = src.endsWith(".json")
        ? "application/json"
        : src.endsWith(".png")
          ? "image/png"
          : "image/svg+xml";
      return `data:${mime};base64,${bytes.toString("base64")}`;
    },
  });
  assert.ok(html.includes("data:image/png;base64,"));
  assert.ok(html.includes("data:application/json;base64,"));
  assert.ok(!html.includes("/local-packs/"));
});
