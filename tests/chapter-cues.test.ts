import { test } from "node:test";
import assert from "node:assert/strict";
import { isLocalChapterCue } from "../src/animation/runtime/cueUrl.js";

test("chapter cues can accompany audio in a separate local pack", () => {
  assert.equal(
    isLocalChapterCue(
      "/local-packs/chapter-1/cues/line-036.json",
      "http://127.0.0.1:5178/",
    ),
    true,
  );
  assert.equal(
    isLocalChapterCue(
      "http://127.0.0.1:5178/local-packs/chapter-1/cues/line-036.json",
      "http://127.0.0.1:5178/studio",
    ),
    true,
  );
});

test("chapter cue allowance rejects remote origins, other files and URLs with credentials or queries", () => {
  const base = "http://127.0.0.1:5178/";
  for (const url of [
    null,
    "/generated/audio.mp3",
    "/local-packs/chapter-1/cues/line.mp3",
    "/local-packs/chapter-1/cues/../../../secret.json",
    "https://example.com/local-packs/chapter-1/cues/line.json",
    "http://user@127.0.0.1:5178/local-packs/chapter-1/cues/line.json",
    "/local-packs/chapter-1/cues/line.json?file=other",
    "/local-packs/chapter-1/cues/line.json#other",
  ]) {
    assert.equal(isLocalChapterCue(url, base), false);
  }
});
