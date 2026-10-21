import { test } from "node:test";
import assert from "node:assert/strict";
import { blinkSeed } from "../src/animation/runtime/spriteRuntime.js";

test("each character gets its own blink rhythm, the same on every run", () => {
  // Every portrait has its own runtime, so both faces on stage are surface 1.
  assert.notEqual(blinkSeed("mira-neutral", 1), blinkSeed("noah-neutral", 1));
  assert.equal(blinkSeed("mira-neutral", 1), blinkSeed("mira-neutral", 1));
  assert.notEqual(blinkSeed("mira-neutral", 1), blinkSeed("mira-neutral", 2));
  for (let i = 0; i < 200; i++) assert.ok(blinkSeed(`c${i}`, i) > 0);
});
