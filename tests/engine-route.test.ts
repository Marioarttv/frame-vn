import assert from "node:assert/strict";
import test from "node:test";
import { createStarterProject } from "../src/engine";
import type { Project } from "../src/engine/types";
import { planRoute, routeChoices } from "../src/engine/route";

function choiceNode(project: Project) {
  const node = project.nodes.find((candidate) => candidate.type === "choice");
  assert.ok(node && node.type === "choice");
  return node;
}

test("planRoute follows the first available choice by default and stops at the ending", () => {
  const project = createStarterProject();
  const plan = planRoute(project);
  assert.equal(plan.stoppedBy, "ending");
  assert.equal(plan.steps[0].nodeId, project.startNodeId);
  assert.equal(plan.steps.at(-1)!.kind, "end");
  assert.equal(plan.choices.length, 1);
  const choice = choiceNode(project);
  assert.equal(plan.choices[0].nodeId, choice.id);
  assert.equal(plan.choices[0].selectedId, choice.choices[0].id);
  assert.equal(plan.choices[0].defaulted, true);
  assert.deepEqual(routeChoices(plan), { [choice.id]: choice.choices[0].id });
  assert.ok(plan.estimatedMs > 0);
  assert.equal(
    plan.estimatedMs,
    Math.round(
      plan.steps.reduce((sum, step) => sum + step.estimatedMs, 0) + 900,
    ),
  );
  assert.ok(plan.steps.every((step) => step.node.type !== "branch"));
});

test("planRoute takes the requested choice and recomputes the path", () => {
  const project = createStarterProject();
  const choice = choiceNode(project);
  const alternative = choice.choices[1];
  const plan = planRoute(project, undefined, { [choice.id]: alternative.id });
  assert.equal(plan.choices[0].selectedId, alternative.id);
  assert.equal(plan.choices[0].defaulted, false);
  const choiceIndex = plan.steps.findIndex((step) => step.kind === "choice");
  assert.equal(plan.steps[choiceIndex].choiceId, alternative.id);
  assert.equal(plan.steps[choiceIndex + 1].nodeId, alternative.nextId);
  const first = planRoute(project);
  assert.notDeepEqual(
    first.steps.map((step) => step.nodeId),
    plan.steps.map((step) => step.nodeId),
  );
});

test("planRoute can start from a later scene and honours the scene limit", () => {
  const project = createStarterProject();
  const choice = choiceNode(project);
  const plan = planRoute(project, choice.id);
  assert.equal(plan.steps[0].nodeId, choice.id);
  assert.equal(plan.steps[0].kind, "choice");
  const limited = planRoute(project, undefined, {}, { maxScenes: 2 });
  assert.equal(limited.stoppedBy, "maxScenes");
  assert.equal(limited.steps.length, 2);
  const missing = planRoute(project, "no-such-scene");
  assert.equal(missing.stoppedBy, "error");
  assert.equal(missing.steps.length, 0);
});

test("planRoute detects loops and unavailable choices", () => {
  const project = createStarterProject();
  project.variables = [{ id: "seen", name: "Seen", type: "boolean", initial: false }];
  project.nodes = [
    {
      id: "a",
      type: "dialogue",
      label: "A",
      text: "Round and round.",
      position: 50,
      nextId: "pick",
    },
    {
      id: "pick",
      type: "choice",
      label: "Pick",
      text: "Which way?",
      position: 50,
      choices: [
        {
          id: "locked",
          text: "Locked",
          nextId: "a",
          conditions: [{ variableId: "seen", operator: "==", value: true }],
        },
        { id: "again", text: "Again", nextId: "a" },
      ],
    },
  ];
  project.startNodeId = "a";
  const plan = planRoute(project, "a", { pick: "locked" });
  assert.equal(plan.stoppedBy, "loop");
  assert.equal(plan.choices[0].selectedId, "again");
  assert.equal(plan.choices[0].defaulted, true);
  assert.deepEqual(
    plan.choices[0].options.map((choice) => choice.id),
    ["again"],
  );
  assert.deepEqual(
    plan.steps.map((step) => step.nodeId),
    ["a", "pick"],
  );
});

test("planRoute estimates use recorded voice durations and pacing options", () => {
  const project = createStarterProject();
  const slow = planRoute(project, undefined, {}, { linePause: 3000 });
  const quick = planRoute(project, undefined, {}, { linePause: 200 });
  assert.ok(slow.estimatedMs > quick.estimatedMs);
  const withCard = planRoute(project, undefined, {}, { titleCard: 2500 });
  assert.equal(withCard.estimatedMs - quick.estimatedMs > 2500, true);
  const first = project.nodes.find((node) => node.id === project.startNodeId)!;
  const base = planRoute(project).steps[0].estimatedMs;
  Object.assign(first, { audioSrc: "data:audio/mpeg;base64,SUQz", audioDuration: 12 });
  const voiced = planRoute(project).steps[0].estimatedMs;
  assert.ok(voiced >= 12_000 + 900);
  assert.notEqual(voiced, base);
});
