import assert from "node:assert/strict";
import test from "node:test";
import {
  createStarterProject,
  exportStandaloneHtml,
  parseProjectJSON,
  saveProject,
  serializeProject,
  validateDraftProject,
  validateProject,
  type Project,
} from "../src/engine";

function incompleteDraft(): Project {
  const draft = createStarterProject();
  draft.title = "";
  draft.characters[0].name = " ";
  draft.characters[0].poses[0].name = "";
  draft.backgrounds[0].name = "";
  draft.nodes[0].label = "";
  draft.nodes[0].text = "";
  draft.nodes[0].characterId = "not-added-yet";
  draft.nodes[0].backgroundId = "not-added-yet";
  draft.nodes[0].poseId = "not-added-yet";
  if (draft.nodes[0].type === "dialogue")
    draft.nodes[0].nextId = "unfinished-target";
  if (draft.nodes[1].type === "choice") {
    draft.nodes[1].choices[0].text = "";
    draft.nodes[1].choices[0].nextId = "";
  }
  return draft;
}

test("unfinished authoring fields and dangling references roundtrip as safe drafts", () => {
  const draft = incompleteDraft();
  const valid = validateDraftProject(draft);
  assert.equal(valid.valid, true);
  assert.equal(valid.errors.length, 0);
  for (const path of [
    "title",
    "characters[0].name",
    "characters[0].poses[0].name",
    "backgrounds[0].name",
    "nodes[0].label",
    "nodes[0].characterId",
    "nodes[0].nextId",
    "nodes[1].choices[0].nextId",
  ])
    assert.ok(
      valid.warnings.some((warning) => warning.path === path),
      path,
    );
  const backup = serializeProject(draft, { draft: true });
  const restored = parseProjectJSON(backup, { draft: true });
  assert.equal(restored.valid, true);
  if (restored.valid)
    assert.deepEqual(JSON.parse(JSON.stringify(restored.project)), draft);
});

test("strict playback and game export still reject incomplete drafts", async () => {
  const draft = incompleteDraft();
  assert.equal(validateProject(draft).valid, false);
  assert.throws(() => serializeProject(draft), /incomplete/);
  assert.equal(parseProjectJSON(JSON.stringify(draft)).valid, false);
  await assert.rejects(exportStandaloneHtml(draft), /incomplete/);
});

test("a temporarily blank opening scene or character selection can be saved as a draft", () => {
  const draft = createStarterProject();
  draft.startNodeId = "";
  draft.nodes[0].characterId = "";
  draft.nodes[0].poseId = "";
  draft.nodes[0].backgroundId = "";
  const result = validateDraftProject(draft);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((warning) => warning.path === "startNodeId"));
  assert.equal(validateProject(draft).valid, false);
});

test("draft mode retains structural, identity, type, geometry, and size constraints", () => {
  const cases: Array<(project: Project) => void> = [
    (project) => {
      project.characters[0].id = "";
    },
    (project) => {
      project.nodes[0].id = project.nodes[1].id;
    },
    (project) => {
      project.nodes[0].position = NaN;
    },
    (project) => {
      project.nodes[0].position = -1;
    },
    (project) => {
      project.title = "a".repeat(141);
    },
    (project) => {
      project.characters[0].poses = [];
    },
    (project) => {
      project.nodes = [];
    },
    (project) => {
      project.characters[0].color = "url(javascript:alert(1))";
    },
    (project) => {
      (project as unknown as Record<string, unknown>).title = null;
    },
    (project) => {
      (project as unknown as Record<string, unknown>).schemaVersion = 4;
    },
    (project) => {
      (project.nodes[0] as unknown as Record<string, unknown>).type = "script";
    },
    (project) => {
      if (project.nodes[1].type === "choice")
        (
          project.nodes[1].choices[0] as unknown as Record<string, unknown>
        ).nextId = {};
    },
    (project) => {
      project.nodes[0].audioSrc = "javascript:alert(1)";
    },
    (project) => {
      project.nodes[0].cueUrl = "data:text/html,alert(1)";
    },
    (project) => {
      project.characters[0].poses[0].src = "";
    },
    (project) => {
      project.characters[0].poses[0].rig = "javascript:alert(1)";
    },
  ];
  cases.forEach((mutate, index) => {
    const draft = incompleteDraft();
    mutate(draft);
    assert.equal(validateDraftProject(draft).valid, false, `case ${index}`);
  });
});

test("unsafe drafts are rejected before they can reach persistence", async () => {
  const draft = incompleteDraft();
  draft.characters[0].poses[0].src = "javascript:alert(1)";
  await assert.rejects(saveProject(draft), /supported image data URL/);
  assert.throws(
    () => serializeProject(draft, { draft: true }),
    /supported image data URL/,
  );
});

test("animation metadata survives draft validation without changing the runtime contract", () => {
  const draft = incompleteDraft();
  const pose = draft.characters[0].poses[0];
  pose.rig = "/packs/character/rig.json";
  pose.capabilities = {
    mouth: true,
    blink: true,
    body: true,
    gaze: true,
    brows: true,
  };
  pose.animation = {
    manifestUrl: "/packs/manifest.json",
    speechIndexUrl: "/packs/speech.json",
    browsIndexUrl: "/packs/brows.json",
    lightingUrl: "/packs/lighting.json",
    assetRoot: "/packs",
    poseKey: "neutral",
  };
  const result = validateDraftProject(draft);
  assert.equal(result.valid, true);
  if (result.valid)
    assert.deepEqual(result.project.characters[0].poses[0], pose);
});
