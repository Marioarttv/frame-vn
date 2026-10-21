import assert from "node:assert/strict";
import test from "node:test";
import {
  createStarterProject,
  insertScriptNodes,
  parseScript,
  validateProject,
} from "../src/engine";

test("a screenplay becomes linked dialogue, choices, jumps and an ending", () => {
  const project = createStarterProject();
  project.sounds = [
    { id: "theme", name: "Theme", src: "/theme.mp3", kind: "music" },
  ];
  const result = parseScript(
    [
      "# Meeting",
      "@bg After hours",
      "@music Theme",
      "Mira: You came.",
      "Noah (neutral): I did.",
      "Stranger: Who are you two?",
      "* Answer -> Answer",
      "* Leave -> The end",
      "# Answer",
      "The rain stops.",
      "@music stop",
      "-> The end",
      "# The end",
      "@end Goodnight.",
    ].join("\n"),
    project,
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 1, "unknown speakers are reported");
  const [mira, noah, stranger, rain, end] = result.nodes;
  assert.equal(result.nodes.length, 5);
  assert.equal(mira.label, "Meeting");
  assert.equal(mira.characterId, "mira");
  assert.equal(mira.backgroundId, "night");
  assert.equal(mira.musicId, "theme");
  assert.equal(mira.type === "dialogue" && mira.nextId, noah.id);
  assert.equal(noah.poseId, "neutral");
  assert.equal(stranger.speaker, "Stranger");
  assert.equal(stranger.characterId, undefined);
  assert.equal(stranger.type, "choice");
  if (stranger.type === "choice")
    assert.deepEqual(
      stranger.choices.map((choice) => [choice.text, choice.nextId]),
      [
        ["Answer", rain.id],
        ["Leave", end.id],
      ],
    );
  assert.equal(rain.characterId, undefined, "plain lines are narration");
  assert.equal(rain.type === "dialogue" && rain.nextId, end.id);
  assert.equal(end.type, "end");
  assert.equal(end.text, "Goodnight.");
  const next = insertScriptNodes(
    {
      ...project,
      nodes: project.nodes.map((node) =>
        node.id === "inside" && node.type === "dialogue"
          ? { ...node, nextId: null }
          : node,
      ),
    },
    result.nodes,
    "inside",
  );
  const inside = next.nodes.find((node) => node.id === "inside");
  assert.equal(inside?.type === "dialogue" && inside.nextId, mira.id);
  assert.equal(validateProject(next).valid, true);
});

test("script mistakes are reported with line numbers instead of importing a broken story", () => {
  const result = parseScript(
    "* Orphan -> Nowhere\nMira: Hi.\n-> Missing\n@teleport Moon\n# Twice\nA.\n# Twice\nB.",
    createStarterProject(),
  );
  for (const message of [
    "Line 1: a choice must follow",
    "Line 3: no scene is labelled “Missing”",
    "Line 4: unknown command @teleport",
    "Line 7: the label “Twice” is used twice",
  ])
    assert.ok(
      result.errors.some((error) => error.startsWith(message)),
      `${message}: ${JSON.stringify(result.errors)}`,
    );
  assert.deepEqual(
    parseScript("  \n// only a comment", createStarterProject()).errors,
    ["The script does not contain any lines."],
  );
});

test("stage and look directives stage a conversation and persist until changed", () => {
  const project = createStarterProject();
  const result = parseScript(
    [
      "@stage Mira right",
      "@weather Rain",
      "@textbox cinematic",
      "@transition iris",
      "Mira: It's pouring.",
      "@gesture Noah nod",
      "Noah: I noticed.",
      "@camera 1.4 Noah",
      "@shake heavy",
      "Mira: Thunder!",
      "@weather none",
      "@textbox default",
      "@camera wide",
      "@exit Noah",
      "Mira: He left.",
      "@textbox comic sans",
    ].join("\n"),
    project,
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, [
    "Line 16: @textbox does not know “comic sans”.",
  ]);
  const [first, second, third, fourth] = result.nodes;
  assert.equal(first.position, 70);
  assert.equal(first.weather, "rain");
  assert.equal(first.textbox, "cinematic");
  assert.equal(first.transition, "iris");
  assert.equal(first.cast, undefined);
  // Noah joins at a free mark; Mira stays on stage as a listener.
  assert.equal(second.characterId, "noah");
  assert.equal(second.position, 12);
  assert.equal(second.emote, "nod");
  assert.deepEqual(second.cast, [{ characterId: "mira", position: 70 }]);
  assert.equal(second.transition, undefined);
  assert.equal(second.weather, "rain");
  assert.deepEqual(third.camera, { zoom: 1.4, x: 12, y: 38 });
  assert.equal(third.shake, "heavy");
  assert.deepEqual(third.cast, [{ characterId: "noah", position: 12 }]);
  assert.equal(fourth.weather, undefined);
  assert.equal(fourth.textbox, undefined);
  assert.equal(fourth.camera, undefined);
  assert.equal(fourth.cast, undefined);
  const imported = insertScriptNodes(project, result.nodes, "ending");
  assert.equal(validateProject(imported).valid, true);
});
