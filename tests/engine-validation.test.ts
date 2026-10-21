import assert from "node:assert/strict";
import test from "node:test";
import {
  createStarterProject,
  isSafeAssetUrl,
  parseProjectJSON,
  serializeProject,
  validateProject,
} from "../src/engine";

test("starter roundtrips through the versioned format without errors or graph warnings", () => {
  const project = createStarterProject();
  const result = parseProjectJSON(serializeProject(project));
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.deepEqual(JSON.parse(JSON.stringify(result.project)), project);
  assert.deepEqual(result.warnings, []);
});

test("malformed JSON and unsupported formats return actionable errors", () => {
  assert.equal(parseProjectJSON("{").valid, false);
  for (const input of [
    null,
    [],
    {},
    { ...createStarterProject(), schemaVersion: 4 },
  ])
    assert.equal(validateProject(input).valid, false);
});

test("validation identifies broken links and character/pose/background references", () => {
  const project = createStarterProject();
  project.startNodeId = "missing";
  project.nodes[0].backgroundId = "missing";
  project.nodes[0].characterId = "missing";
  project.nodes[0].poseId = "missing";
  if (project.nodes[1].type === "choice")
    project.nodes[1].choices[0].nextId = "missing";
  const result = validateProject(project);
  assert.equal(result.valid, false);
  for (const path of [
    "startNodeId",
    "nodes[0].backgroundId",
    "nodes[0].characterId",
    "nodes[0].poseId",
    "nodes[1].choices[0].nextId",
  ])
    assert.ok(
      result.errors.some((error) => error.path === path),
      path,
    );
});

test("validation rejects duplicate IDs, unbounded geometry, and CSS injection", () => {
  const project = createStarterProject();
  project.nodes[0].id = project.nodes[1].id;
  project.nodes[0].position = Infinity;
  project.characters[0].color = "red;url(x)";
  project.characters[0].poses.push({ ...project.characters[0].poses[0] });
  const result = validateProject(project);
  assert.equal(result.valid, false);
  for (const path of [
    "nodes[1].id",
    "nodes[0].position",
    "characters[0].color",
    "characters[0].poses[1].id",
  ])
    assert.ok(
      result.errors.some((error) => error.path === path),
      path,
    );
});

test("executable, credentialed, and ambiguous asset URLs are rejected", () => {
  for (const src of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "//other.example/image.png",
    "file:///private/image.png",
    "https://user:secret@example.com/file.png",
    "/assets/\nimage.png",
    "\\evil.example\\image.png",
  ]) {
    assert.equal(isSafeAssetUrl(src), false, src);
    const project = createStarterProject();
    project.characters[0].poses[0].src = src;
    assert.equal(validateProject(project).valid, false, src);
  }
  for (const src of [
    "/assets/mira.svg",
    "./characters/mira.png",
    "https://example.org/mira.png",
    "data:image/png;base64,iVBORw0KGgo=",
  ])
    assert.equal(isSafeAssetUrl(src), true, src);
});

test("unknown properties and prototype payloads are discarded on import", () => {
  const project = createStarterProject();
  const json = JSON.stringify(project).replace(
    '"schemaVersion":3',
    '"__proto__":{"polluted":true},"schemaVersion":3,"script":"alert(1)"',
  );
  assert.ok(json.includes('"script"'), "the payload must be present");
  const result = parseProjectJSON(json);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(Object.hasOwn(result.project, "__proto__"), false);
  assert.equal(Object.hasOwn(result.project, "script"), false);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("unreachable scenes and loops are warnings, while incomplete choice destinations are errors", () => {
  const project = createStarterProject();
  project.nodes.push({
    id: "unused",
    label: "Unused",
    type: "end",
    text: "",
    position: 50,
  });
  const result = validateProject(project);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((warning) => warning.path === "nodes[5]"));
  project.nodes = [
    {
      id: "loop",
      label: "Loop",
      type: "dialogue",
      text: "Again",
      position: 50,
      nextId: "loop",
    },
  ];
  project.startNodeId = "loop";
  const loop = validateProject(project);
  assert.equal(loop.valid, true);
  assert.ok(
    loop.warnings.some((warning) =>
      warning.message.includes("no reachable ending"),
    ),
  );
});

test("voice selection, generated audio, cues, and rig metadata survive roundtrip", () => {
  const project = createStarterProject();
  project.characters[0].voiceId = "voice-123";
  project.characters[0].voice = {
    src: "/generated/sample.mp3",
    cueUrl: "/generated/sample.cues.json",
  };
  project.nodes[0].audioSrc = "/generated/dialogue.mp3";
  project.nodes[0].cueUrl = "/generated/dialogue.cues.json";
  project.characters[0].poses[0].rig = "/packs/mira/rig.json";
  project.characters[0].poses[0].animation = {
    manifestUrl: "/packs/mira/manifest.json",
    speechIndexUrl: "/packs/mira/speech.json",
    assetRoot: "/packs/mira/",
    poseKey: "mira-neutral",
  };
  const result = parseProjectJSON(serializeProject(project));
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.project.characters[0].voiceId, "voice-123");
  assert.equal(result.project.nodes[0].cueUrl, "/generated/dialogue.cues.json");
  assert.equal(
    result.project.characters[0].poses[0].animation?.poseKey,
    "mira-neutral",
  );
});
