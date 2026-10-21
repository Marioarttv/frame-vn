import assert from "node:assert/strict";
import test from "node:test";
import {
  advancePlayer,
  availableChoices,
  characterUsage,
  chooseOption,
  createPlayerState,
  createStarterProject,
  previousNode,
  removeNode,
  validateDraftProject,
  validateProject,
  variableUsage,
  type Project,
} from "../src/engine";

/** The starter story plus a trust score, a flag, music, and a branch that reads them. */
function stateful(): Project {
  const project = createStarterProject();
  project.variables = [
    { id: "trust", name: "Trust", type: "number", initial: 0 },
    { id: "curious", name: "Curious", type: "boolean", initial: false },
  ];
  project.sounds = [
    { id: "theme", name: "Theme", src: "/assets/theme.mp3", kind: "music" },
    { id: "chime", name: "Chime", src: "/assets/chime.mp3", kind: "sfx" },
  ];
  const [arrival, invitation, outside, inside, ending] = project.nodes;
  arrival.musicId = "theme";
  arrival.effects = [{ variableId: "trust", operation: "add", value: 1 }];
  arrival.cast = [{ characterId: "noah", position: 25, flip: true }];
  if (invitation.type !== "choice") throw new Error("fixture");
  invitation.choices[0].effects = [
    { variableId: "curious", operation: "set", value: true },
    { variableId: "trust", operation: "add", value: 2 },
  ];
  invitation.choices.push({
    id: "secret",
    text: "Only for the trusting",
    nextId: "inside",
    conditions: [{ variableId: "trust", operator: ">=", value: 3 }],
  });
  if (outside.type !== "dialogue" || inside.type !== "dialogue")
    throw new Error("fixture");
  outside.nextId = "router";
  inside.nextId = "router";
  inside.musicId = null;
  project.nodes.splice(4, 0, {
    id: "router",
    label: "Who was curious?",
    type: "branch",
    text: "",
    position: 50,
    branches: [
      {
        id: "curious-path",
        conditions: [{ variableId: "curious", operator: "==", value: true }],
        nextId: "ending",
      },
    ],
    elseId: "quiet-ending",
  });
  project.nodes.push({
    ...ending,
    id: "quiet-ending",
    label: "A quiet ending",
    sfxId: "chime",
  });
  return project;
}

test("variables, effects, conditions and invisible branches drive playback", () => {
  const project = stateful();
  const result = validateProject(project);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  const start = createPlayerState(project);
  assert.deepEqual(start.variables, { trust: 1, curious: false });
  assert.equal(start.musicId, "theme");
  const invitation = advancePlayer(project, start);
  assert.deepEqual(
    availableChoices(project, invitation).map((choice) => choice.id),
    ["explore", "stay"],
  );
  assert.throws(
    () => chooseOption(project, invitation, "secret"),
    /not available/,
  );
  const outside = chooseOption(project, invitation, "explore");
  assert.deepEqual(outside.variables, { trust: 3, curious: true });
  const curiousEnd = advancePlayer(project, outside);
  assert.equal(curiousEnd.nodeId, "ending", "the branch scene is skipped");
  assert.equal(
    curiousEnd.history.some((entry) => entry.nodeId === "router"),
    false,
  );
  assert.deepEqual(previousNode(curiousEnd).variables, outside.variables);
  assert.deepEqual(previousNode(previousNode(curiousEnd)), invitation);

  const inside = chooseOption(project, invitation, "stay");
  assert.equal(inside.musicId, null, "null stops the music");
  assert.equal(advancePlayer(project, inside).nodeId, "quiet-ending");
});

test("v2 validation checks variable types, references, cast and branch loops", () => {
  const broken = stateful();
  const [arrival, invitation] = broken.nodes;
  arrival.effects = [{ variableId: "curious", operation: "add", value: true }];
  arrival.cast = [{ characterId: "mira", position: 20 }];
  arrival.musicId = "missing";
  if (invitation.type === "choice")
    invitation.choices[2].conditions = [
      { variableId: "curious", operator: ">", value: true },
    ];
  const router = broken.nodes.find((node) => node.id === "router");
  if (router?.type === "branch") router.elseId = "router";
  const result = validateProject(broken);
  assert.equal(result.valid, false);
  for (const path of [
    "nodes[0].effects[0].operation",
    "nodes[0].cast[0].characterId",
    "nodes[0].musicId",
    "nodes[1].choices[2].conditions[0].operator",
    "nodes[4]",
  ])
    assert.ok(
      result.errors.some((issue) => issue.path === path),
      `${path}: ${JSON.stringify(result.errors)}`,
    );
  const draft = validateDraftProject(broken);
  assert.equal(draft.valid, true, "semantic problems stay savable as drafts");
  const shape = stateful();
  (shape.variables[0] as unknown as Record<string, unknown>).initial = "0";
  assert.equal(validateDraftProject(shape).valid, false);
});

test("version 1 projects upgrade on read and v2 fields roundtrip exactly", () => {
  const legacy = JSON.parse(JSON.stringify(createStarterProject()));
  legacy.schemaVersion = 1;
  delete legacy.variables;
  delete legacy.sounds;
  const upgraded = validateProject(legacy);
  assert.equal(upgraded.valid, true);
  if (!upgraded.valid) return;
  assert.equal(upgraded.project.schemaVersion, 3);
  assert.deepEqual(upgraded.project.variables, []);
  assert.deepEqual(upgraded.project.sounds, []);
  const project = stateful();
  const roundtrip = validateProject(JSON.parse(JSON.stringify(project)));
  assert.equal(roundtrip.valid, true);
  if (roundtrip.valid)
    assert.deepEqual(JSON.parse(JSON.stringify(roundtrip.project)), project);
});

test("usage counts include non-speaking cast and every variable reference", () => {
  const project = stateful();
  assert.equal(characterUsage(project, "noah"), 2, "speaks once, stands once");
  assert.equal(characterUsage(project, "noah", "neutral"), 2);
  assert.equal(characterUsage(project, "noah", "other"), 0);
  assert.equal(variableUsage(project, "trust"), 2);
  assert.equal(variableUsage(project, "curious"), 2);
  const withoutRouterTarget = removeNode(project, "quiet-ending");
  const router = withoutRouterTarget.nodes.find((node) => node.id === "router");
  assert.equal(router?.type === "branch" && router.elseId, "");
});
