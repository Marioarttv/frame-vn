import assert from "node:assert/strict";
import test from "node:test";
import {
  addToShot,
  createStarterProject,
  insertShot,
  moveShot,
  placeActor,
  removeFromShot,
  setSpeaker,
  shotActors,
  shotLink,
  validateProject,
  type DialogueNode,
  type NodeBase,
  type Project,
} from "../src/engine";

const character = (id: string) => ({ id, poses: [{ id: `${id}-default` }] }) as never;

function chain(ids: string[]): Project {
  const project = createStarterProject();
  const template = project.nodes[0] as DialogueNode;
  project.nodes = ids.map((id, index) => ({
    ...template,
    id,
    label: id,
    nextId: ids[index + 1] ?? null,
  }));
  project.startNodeId = ids[0];
  return project;
}
const order = (project: Project) => {
  const seen: string[] = [];
  let id: string | null = project.startNodeId;
  while (id && !seen.includes(id)) {
    seen.push(id);
    const node = project.nodes.find((item) => item.id === id) as DialogueNode;
    id = node.nextId;
  }
  return seen.join("");
};

test("a listener who starts talking swaps places with the speaker", () => {
  const node: NodeBase = {
    id: "s",
    label: "",
    text: "Hi",
    characterId: "mira",
    poseId: "mira-angry",
    position: 30,
    scale: 1.2,
    flip: true,
    audioSrc: "/a.mp3",
    cast: [{ characterId: "noah", poseId: "noah-grin", position: 70, y: -4 }],
  };
  const patch = setSpeaker(node, character("noah"));
  const next = { ...node, ...patch };
  assert.equal(next.characterId, "noah");
  assert.equal(next.poseId, "noah-grin");
  assert.equal(next.position, 70);
  assert.equal(next.y, -4);
  assert.equal(next.flip, undefined);
  assert.equal(next.audioSrc, undefined);
  assert.deepEqual(next.cast, [
    { characterId: "mira", position: 30, poseId: "mira-angry", flip: true, scale: 1.2 },
  ]);
  // Narration keeps the former speaker on stage.
  const narrated = { ...next, ...setSpeaker(next, undefined) };
  assert.equal(narrated.characterId, undefined);
  assert.deepEqual(
    shotActors(narrated).map((actor) => actor.characterId),
    ["noah", "mira"],
  );
  // A newcomer walks on at a free mark, away from the others.
  const joined = { ...next, ...setSpeaker(next, character("rowan")) };
  assert.equal(joined.characterId, "rowan");
  assert.ok(![30, 70].includes(joined.position));
});

test("adding, placing and removing people on stage", () => {
  const empty: NodeBase = { id: "s", label: "", text: "", position: 50 };
  const first = { ...empty, ...(addToShot(empty, character("mira"), 33.4) as Partial<NodeBase>) };
  assert.equal(first.characterId, "mira");
  assert.equal(first.position, 33);
  const second = { ...first, ...(addToShot(first, character("noah")) as Partial<NodeBase>) };
  assert.equal(second.cast?.[0].characterId, "noah");
  const moved = { ...second, ...placeActor(second, "noah", { position: 81.6, scale: 1, y: 0 }) };
  assert.deepEqual(moved.cast?.[0], {
    characterId: "noah",
    poseId: "noah-default",
    position: 82,
    scale: undefined,
    y: undefined,
  });
  const speakerMoved = { ...moved, ...placeActor(moved, "mira", { flip: false, position: 20 }) };
  assert.equal(speakerMoved.position, 20);
  assert.equal(speakerMoved.flip, undefined);
  const crowded = Array.from({ length: 8 }, (_, index) => `c${index}`).reduce(
    (node, id) => {
      const patch = addToShot(node, character(id));
      return "error" in patch ? node : { ...node, ...patch };
    },
    speakerMoved as NodeBase,
  );
  assert.ok("error" in addToShot(crowded, character("one-too-many")));
  const narration = { ...moved, ...removeFromShot(moved, "mira") };
  assert.equal(narration.characterId, undefined);
  assert.equal(narration.cast?.length, 1);
  assert.equal({ ...moved, ...removeFromShot(moved, "noah") }.cast, undefined);
});

test("moving a shot relinks the story in its new reading order", () => {
  const project = chain(["A", "B", "C", "D"]);
  assert.equal(order(moveShot(project, "D", 1)), "ADBC");
  assert.equal(order(moveShot(project, "B", 3)), "ACDB");
  assert.equal(order(moveShot(project, "A", 2)), "BCAD");
  const first = moveShot(project, "C", 0);
  assert.equal(order(first), "CABD");
  assert.equal(first.startNodeId, "C");
  for (const moved of [first, moveShot(project, "B", 3)])
    assert.equal(validateProject(moved).valid, true);
  assert.equal(moveShot(project, "B", 1), project);
});

test("a new shot continues the stage and hands the line to a listener", () => {
  const project = chain(["A", "B"]);
  const a = project.nodes[0];
  Object.assign(a, {
    characterId: "mira",
    poseId: "neutral",
    position: 30,
    emote: "nod",
    weather: "rain",
    audioSrc: "/a.mp3",
    cast: [{ characterId: "noah", poseId: "neutral", position: 70, enter: "pop" }],
  });
  const { project: next, id } = insertShot(project, "A");
  assert.equal(order(next), `A${id}B`);
  const shot = next.nodes[1];
  assert.equal(shot.characterId, "noah");
  assert.equal(shot.position, 70);
  assert.equal(shot.enter, undefined);
  assert.equal(shot.weather, "rain");
  assert.equal(shot.audioSrc, undefined);
  assert.deepEqual(shot.cast, [{ characterId: "mira", position: 30, poseId: "neutral" }]);
  assert.equal(shotLink(next.nodes[0], next.nodes[1]), "continues");
  assert.equal(shotLink(next.nodes[0], next.nodes[2]), "jumps");
  assert.equal(validateProject(next).valid, true);
});

test("a full stage refuses a new listener instead of dropping someone", () => {
  const cast = ["b", "c", "d", "e", "f"].map((id, index) => ({ characterId: id, position: 10 + index * 15 }));
  const full: NodeBase = { id: "s", label: "", text: "", characterId: "a", position: 50, cast };
  assert.ok("error" in setSpeaker(full, undefined));
  assert.ok("error" in setSpeaker(full, character("newcomer")));
  // A listener stepping up only swaps places, so it always fits.
  const swapped = setSpeaker(full, character("c"));
  assert.ok(!("error" in swapped));
  assert.equal({ ...full, ...swapped }.cast?.length, 5);
});

test("new shots keep the backdrop, and shots after a choice start unconnected", () => {
  const project = createStarterProject();
  const arrival = project.nodes.find((node) => node.id === "arrival")!;
  delete arrival.backgroundId;
  const after = insertShot(project, "arrival");
  assert.equal(after.project.nodes.find((node) => node.id === after.id)?.backgroundId, undefined);
  const choice = insertShot(project, "invitation");
  const shot = choice.project.nodes.find((node) => node.id === choice.id) as DialogueNode;
  assert.equal(shot.nextId, null);
  assert.deepEqual(
    choice.project.nodes.find((node) => node.id === "invitation"),
    project.nodes.find((node) => node.id === "invitation"),
  );
});

test("choices keep pointing at a shot wherever it moves", () => {
  const project = createStarterProject();
  // "outside" is a choice target that continues to the ending.
  const from = project.nodes.findIndex((node) => node.id === "outside");
  const moved = moveShot(project, "outside", 0);
  assert.notEqual(from, 0);
  const invitation = moved.nodes.find((node) => node.id === "invitation");
  assert.ok(invitation?.type === "choice" && invitation.choices.some((item) => item.nextId === "outside"));
  assert.equal(moved.startNodeId, "outside");
  assert.equal(validateProject(moved).valid, true);
});
