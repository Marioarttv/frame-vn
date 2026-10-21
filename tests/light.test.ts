import assert from "node:assert/strict";
import test from "node:test";
import { createStarterProject, validateProject, type Project } from "../src/engine";
import { lightMatrix, lightState } from "../src/player/light";

const withScene = (patch: Record<string, unknown>, theme: Record<string, unknown> = {}) => {
  const project = createStarterProject() as Project;
  const next = structuredClone(project) as unknown as { nodes: Record<string, unknown>[]; theme?: Record<string, unknown> };
  Object.assign(next.nodes[0], patch);
  next.theme = {
    textbox: "classic",
    textEffect: "typewriter",
    textSpeed: 42,
    font: "serif",
    accent: "#d2bb86",
    focus: "dim",
    expressionChange: "cut",
    ...(next.theme ?? {}),
    ...theme,
  };
  return validateProject(next);
};

test("neutral lighting is the identity colour matrix", () => {
  const matrix = lightMatrix(lightState(undefined)).split(/\s+/).map(Number);
  assert.deepEqual(matrix, [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
});

test("a moonlight preset darkens and tints toward blue", () => {
  const state = lightState({ color: "#7fa8e0", amount: 0.6, brightness: 0.7 });
  assert.ok(state.b > state.r, "blue channel stays brighter than red");
  assert.ok(state.r < 0.7 && state.b <= 0.7);
  assert.equal(state.rimOpacity, 0);
  const rim = lightState({ color: "#ffffff", amount: 0, brightness: 1, rim: "#a8dcff", rimFrom: "right" });
  assert.equal(rim.rimFrom, "right");
  assert.ok(rim.rimOpacity > 0);
});

test("scene light and theme text scale validate", () => {
  const ok = withScene(
    { light: { color: "#ffcf98", amount: 0.35, brightness: 0.86, rim: "#ffd59a", rimFrom: "top", rimStrength: 0.4 } },
    { textScale: 1.3 },
  );
  assert.equal(ok.valid, true, JSON.stringify(ok.errors));
  assert.equal(ok.project?.nodes[0].light?.rimFrom, "top");
  assert.equal(ok.project?.theme?.textScale, 1.3);
  const bad = withScene({ light: { color: "blue", amount: 2, brightness: 0.8 } }, { textScale: 5 });
  assert.equal(bad.valid, false);
  const paths = bad.errors.map((e) => e.path).join(" ");
  assert.match(paths, /light\.color/);
  assert.match(paths, /light\.amount/);
  assert.match(paths, /textScale/);
});
