import assert from "node:assert/strict";
import test from "node:test";
import {
  advancePlayer,
  chooseOption,
  createPlayerState,
  createStarterProject,
  duplicateNode,
  getCurrentNode,
  jumpToNode,
  previousNode,
  removeNode,
  restartPlayer,
  validateProject,
} from "../src/engine";

test("both story branches reach the ending and back follows the actual selected path", () => {
  const project = createStarterProject();
  for (const [choiceId, destination] of [
    ["explore", "outside"],
    ["stay", "inside"],
  ]) {
    const initial = createPlayerState(project);
    const invitation = advancePlayer(project, initial);
    const branch = chooseOption(project, invitation, choiceId);
    assert.equal(branch.nodeId, destination);
    const ending = advancePlayer(project, branch);
    assert.equal(getCurrentNode(project, ending).type, "end");
    assert.equal(previousNode(ending).nodeId, destination);
    assert.deepEqual(restartPlayer(project), initial);
    assert.deepEqual(initial, {
      nodeId: "arrival",
      variables: {},
      musicId: null,
      history: [],
    });
  }
});

test("invalid transitions cannot create broken player states", () => {
  const project = createStarterProject();
  const state = createPlayerState(project);
  assert.throws(() => jumpToNode(project, state, "missing"), /does not exist/);
  assert.throws(
    () => chooseOption(project, state, "explore"),
    /does not offer/,
  );
  assert.throws(
    () => chooseOption(project, advancePlayer(project, state), "missing"),
    /does not exist/,
  );
  assert.deepEqual(previousNode(state), state);
  const choice = advancePlayer(project, state);
  assert.equal(advancePlayer(project, choice), choice);
});

test("removing scenes repairs incoming branches and the start scene without mutating original", () => {
  const project = createStarterProject();
  const withoutBranch = removeNode(project, "outside");
  const choice = withoutBranch.nodes.find((node) => node.id === "invitation");
  assert.equal(choice?.type === "choice" && choice.choices[0].nextId, "ending");
  assert.equal(project.nodes.length, 5);
  assert.equal(withoutBranch.nodes.length, 4);
  assert.equal(validateProject(withoutBranch).valid, true);
  const withoutStart = removeNode(project, "arrival");
  assert.equal(withoutStart.startNodeId, "invitation");
  assert.equal(validateProject(withoutStart).valid, true);
});

test("removing a scene without one successor never redirects links to an unrelated scene", () => {
  const project = createStarterProject();
  const withoutEnding = removeNode(project, "ending");
  for (const id of ["outside", "inside"]) {
    const node = withoutEnding.nodes.find((candidate) => candidate.id === id);
    assert.equal(node?.type === "dialogue" && node.nextId, null);
  }
  assert.equal(validateProject(withoutEnding).valid, true);
  const withoutChoice = removeNode(project, "invitation");
  const opening = withoutChoice.nodes.find((node) => node.id === "arrival");
  assert.equal(opening?.type === "dialogue" && opening.nextId, null);
  if (project.nodes[3].type === "dialogue") project.nodes[3].nextId = "outside";
  const withoutTarget = removeNode(
    { ...project, nodes: project.nodes.filter((node) => node.id !== "ending") },
    "inside",
  );
  const choice = withoutTarget.nodes.find((node) => node.id === "invitation");
  assert.equal(
    choice?.type === "choice" && choice.choices[1].nextId,
    "outside",
  );
  const withoutBranchEnd = removeNode(
    {
      ...project,
      nodes: project.nodes.map((node) =>
        node.id === "outside" ? { ...node, type: "end" as const } : node,
      ),
    },
    "outside",
  );
  const draftChoice = withoutBranchEnd.nodes.find(
    (node) => node.id === "invitation",
  );
  assert.equal(
    draftChoice?.type === "choice" && draftChoice.choices[0].nextId,
    "",
  );
  assert.equal(validateProject(withoutBranchEnd, { draft: true }).valid, true);
});

test("removal can recover an incomplete source link and cannot delete the last scene", () => {
  const project = createStarterProject();
  if (project.nodes[0].type === "dialogue") project.nodes[0].nextId = "missing";
  assert.equal(validateProject(removeNode(project, "arrival")).valid, true);
  project.nodes = [
    { id: "ending", label: "End", type: "end", text: "", position: 50 },
  ];
  project.startNodeId = "ending";
  assert.throws(() => removeNode(project, "ending"), /at least one/);
});

test("duplicating a choice creates independent branch records and fresh IDs", () => {
  const original = createStarterProject();
  const duplicate = duplicateNode(original, "invitation");
  const source = original.nodes[1];
  const copy = duplicate.project.nodes.find(
    (node) => node.id === duplicate.nodeId,
  );
  assert.equal(copy?.type, "choice");
  if (copy?.type !== "choice" || source.type !== "choice") return;
  copy.choices[0].text = "Changed";
  assert.notEqual(copy.choices[0].id, source.choices[0].id);
  assert.notEqual(copy.choices[0].text, source.choices[0].text);
  assert.equal(validateProject(duplicate.project).valid, true);
});
