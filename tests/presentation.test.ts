import assert from "node:assert/strict";
import test from "node:test";
import {
  createStarterProject,
  exportStandaloneHtml,
  parseMarkup,
  parseScreenFx,
  SCREEN_FX_LABELS,
  ACTOR_MOTIONS,
  ACTOR_MOTION_LABELS,
  spokenWords,
  TRANSITION_LABELS,
  TRANSITIONS,
  WEATHER_LABELS,
  WEATHERS,
  GRADES,
  GRADE_LABELS,
  ambienceDuck,
  createPlayerState,
  advancePlayer,
  validateProject,
  type Project,
} from "../src/engine";
import { planReveal, VOICE_MARGIN_MS } from "../src/player/text";
import { usesStorybookFonts } from "../src/player/document";
import { PLAYER_STYLE } from "../src/player/style";
import { BINDING_PEAK_MS, FRACTURE_PEAK_MS, SCREEN_FX_MS, TRANSFORM_PEAK_MS } from "../src/player/screen-fx";
import { RAINDROPS_FADE_MS } from "../src/player/raindrops";
import { volumeAt } from "../server/render/audio-mix";

const IMAGE =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";
const resolveAsset = async () => IMAGE;

const events = (source: string) =>
  parseMarkup(source).items.flatMap((item) => (item.kind === "event" ? [item.event] : []));

test("{fx=…} tags become screen-effect events with optional stage positions", () => {
  assert.deepEqual(events("The ground {fx=crack}cracked. Her glasses{fx=glint, 48, 30} shone."), [
    { type: "fx", name: "crack" },
    { type: "fx", name: "glint", x: 48, y: 30 },
  ]);
  assert.deepEqual(parseScreenFx("sparkle,120,-5"), { name: "sparkle", x: 100, y: 0 });
  assert.deepEqual(parseScreenFx("Heartbeat"), { name: "heartbeat" });
  for (const bad of ["boom", "glint,40", "glint,a,b", "ink,1,2,3", ""])
    assert.equal(parseScreenFx(bad), null, bad);
  const parsed = parseMarkup("Hello {fx=boom} there");
  assert.equal(parsed.plain, "Hello  there");
  assert.deepEqual(parsed.unknownTags, ["{fx=boom}"]);
  // {/fx} still ends text animation and is not a screen effect.
  assert.deepEqual(events("{wave}Hi{/fx}"), []);
});

test("flying, wind and paper effects are part of the presentation vocabulary", () => {
  assert.deepEqual(events("Release it!{fx=comet,62,36} {fx=hair}{fx=tumble}{fx=stomp}"), [
    { type: "fx", name: "comet", x: 62, y: 36 },
    { type: "fx", name: "hair" },
    { type: "fx", name: "tumble" },
    { type: "fx", name: "stomp" },
  ]);
  for (const name of ["comet", "hair", "tumble", "stomp"] as const)
    assert.ok(SCREEN_FX_LABELS[name], name);
  for (const transition of ["burn", "seam"] as const)
    assert.ok(TRANSITIONS.includes(transition) && TRANSITION_LABELS[transition], transition);
  for (const weather of ["wind", "leaves", "airstream"] as const)
    assert.ok(WEATHERS.includes(weather) && WEATHER_LABELS[weather], weather);
  const result = validateProject(
    withNode({ transition: "burn", weather: "airstream", fx: ["comet,62,36", "hair", "stomp"] }),
  );
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  if (result.valid) {
    assert.equal(result.project.nodes[0].transition, "burn");
    assert.equal(result.project.nodes[0].weather, "airstream");
    assert.deepEqual(result.project.nodes[0].fx, ["comet,62,36", "hair", "stomp"]);
  }
});

test("storm, Dementor and Radiance effects are part of the presentation vocabulary", () => {
  assert.deepEqual(
    events("Lightning{fx=lightning,30,60} struck. Ice{fx=frost} spread. {fx=wandlight,52,58}Light{fx=wandfail} died. Patronum!{fx=radiance,50,40}"),
    [
      { type: "fx", name: "lightning", x: 30, y: 60 },
      { type: "fx", name: "frost" },
      { type: "fx", name: "wandlight", x: 52, y: 58 },
      { type: "fx", name: "wandfail" },
      { type: "fx", name: "radiance", x: 50, y: 40 },
    ],
  );
  for (const name of ["lightning", "frost", "radiance", "wandlight", "wandfail"] as const)
    assert.ok(SCREEN_FX_LABELS[name], name);
  for (const weather of ["downpour", "frost"] as const)
    assert.ok(WEATHERS.includes(weather) && WEATHER_LABELS[weather], weather);
  assert.ok(GRADES.includes("drained") && GRADE_LABELS.drained);
  for (const effect of ["sfx-lightning", "sfx-frost", "sfx-radiance", "sfx-wand"])
    assert.ok(PLAYER_STYLE.includes(`.${effect}`), effect);
  assert.match(PLAYER_STYLE, /data-grade=drained/);
  const result = validateProject(
    withNode({ weather: "frost", grade: "drained", fx: ["lightning,30,60", "radiance", "wandfail,40,70"] }),
  );
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  if (result.valid) {
    assert.equal(result.project.nodes[0].weather, "frost");
    assert.equal(result.project.nodes[0].grade, "drained");
  }
  const bad = validateProject(withNode({ fx: ["lightening"] }));
  assert.equal(bad.valid, false);
  assert.match(JSON.stringify(bad.errors), /lightning, frost, radiance, wandlight, wandfail/);
});

test("thread runs between two points and other effects still take one", () => {
  assert.deepEqual(
    events("Their eyes met{fx=thread}. Again{fx=thread, 30, 28, 70.5, 32}."),
    [
      { type: "fx", name: "thread" },
      { type: "fx", name: "thread", x: 30, y: 28, x2: 70.5, y2: 32 },
    ],
  );
  assert.deepEqual(parseScreenFx("Thread,-4,20,130,25"), { name: "thread", x: 0, y: 20, x2: 100, y2: 25 });
  for (const bad of ["thread,30", "thread,30,28", "thread,30,28,70", "thread,30,28,70,a", "thread,1,2,3,4,5", "thread,,2,3,4"])
    assert.equal(parseScreenFx(bad), null, bad);
  // One-point effects parse as before and do not accept a second point.
  assert.deepEqual(parseScreenFx("glint,48,30"), { name: "glint", x: 48, y: 30 });
  assert.deepEqual(parseScreenFx("lightning"), { name: "lightning" });
  for (const bad of ["glint,1,2,3,4", "crack,10,20,30,40", "radiance,50"])
    assert.equal(parseScreenFx(bad), null, bad);
  assert.ok(SCREEN_FX_LABELS.thread);
  for (const part of [".sfx-thread", ".sfx-thread-shade", ".sfx-thread-flash"])
    assert.ok(PLAYER_STYLE.includes(part), part);
  const result = validateProject(withNode({ fx: ["thread,34,30,66,30", "thread", "glint,48,30"] }));
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  if (result.valid) assert.deepEqual(result.project.nodes[0].fx, ["thread,34,30,66,30", "thread", "glint,48,30"]);
  const bad = validateProject(withNode({ fx: ["thread,34,30"] }));
  assert.equal(bad.valid, false);
  assert.match(JSON.stringify(bad.errors), /thread takes x1,y1,x2,y2/);
});

test("Chapter 11 effects: a sized dome, a transformation with a peak, warmth, mud and a wail", () => {
  assert.deepEqual(
    events("Privacy{fx=dome}. Again{fx=dome,40,55}{fx=dome, 40, 55, 30}. {fx=transform,50,55}{fx=warmth}{fx=splat,45,34}{fx=wail,72,30}"),
    [
      { type: "fx", name: "dome" },
      { type: "fx", name: "dome", x: 40, y: 55 },
      { type: "fx", name: "dome", x: 40, y: 55, r: 30 },
      { type: "fx", name: "transform", x: 50, y: 55 },
      { type: "fx", name: "warmth" },
      { type: "fx", name: "splat", x: 45, y: 34 },
      { type: "fx", name: "wail", x: 72, y: 30 },
    ],
  );
  // The radius is clamped to 2–80 percent of the stage width; positions to the stage.
  assert.deepEqual(parseScreenFx("Dome,-5,120,500"), { name: "dome", x: 0, y: 100, r: 80 });
  assert.deepEqual(parseScreenFx("dome,50,50,0.5"), { name: "dome", x: 50, y: 50, r: 2 });
  for (const bad of ["dome,40", "dome,40,55,", "dome,40,55,big", "dome,1,2,3,4", "dome,,2,3"])
    assert.equal(parseScreenFx(bad), null, bad);
  // Only the dome takes a radius; the other new effects take none or x,y.
  for (const bad of ["transform,50", "transform,50,55,20", "warmth,1,2,3", "splat,1,2,3,4", "wail,9", "glint,48,30,10"])
    assert.equal(parseScreenFx(bad), null, bad);
  for (const name of ["dome", "transform", "warmth", "splat", "wail"] as const) {
    assert.ok(SCREEN_FX_LABELS[name], name);
    assert.ok(SCREEN_FX_MS[name] > 1000, name);
  }
  // The production cuts or swaps the sprite at the transformation's peak.
  assert.equal(TRANSFORM_PEAK_MS, 1300);
  assert.ok(TRANSFORM_PEAK_MS < SCREEN_FX_MS.transform);
  for (const part of [".sfx-transform-still", ".sfx-warmth", ".sfx-warmth.is-still", ".sfx-splat.is-still", ".sfx-wail", ".sfx-wail-edge", "canvas.sfx-canvas"])
    assert.ok(PLAYER_STYLE.includes(part), part);
  const result = validateProject(withNode({ fx: ["dome,40,55,25", "dome", "transform,50,55", "warmth", "splat,45,34", "wail,72,30"] }));
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  if (result.valid)
    assert.deepEqual(result.project.nodes[0].fx, ["dome,40,55,25", "dome", "transform,50,55", "warmth", "splat,45,34", "wail,72,30"]);
  const bad = validateProject(withNode({ fx: ["transform,50,55,20"] }));
  assert.equal(bad.valid, false);
  assert.match(JSON.stringify(bad.errors), /dome may add a radius, x,y,r/);
  assert.match(JSON.stringify(bad.errors), /dome, transform, warmth, splat, wail/);
});

test("Chapter 12 effects: a binding vow, a soul torn apart and raindrops on the glass", () => {
  assert.deepEqual(
    events("The binding{fx=binding,50,45} holds. {fx=binding}A fragment{fx=fracture, 50, 58} tore.{fx=fracture}"),
    [
      { type: "fx", name: "binding", x: 50, y: 45 },
      { type: "fx", name: "binding" },
      { type: "fx", name: "fracture", x: 50, y: 58 },
      { type: "fx", name: "fracture" },
    ],
  );
  assert.deepEqual(parseScreenFx("Binding,-5,120"), { name: "binding", x: 0, y: 100 });
  // Both take nothing or a point; neither takes a radius or a second point.
  for (const bad of ["binding,50", "binding,50,45,20", "fracture,1,2,3,4", "fracture,,58", "bindings"])
    assert.equal(parseScreenFx(bad), null, bad);
  for (const name of ["binding", "fracture"] as const) assert.ok(SCREEN_FX_LABELS[name], name);
  assert.equal(SCREEN_FX_MS.binding, 2600);
  assert.equal(SCREEN_FX_MS.fracture, 2800);
  // The moments a sound lands on: the ring flares at its tightest; the shard tears away.
  assert.equal(BINDING_PEAK_MS, 1200);
  assert.equal(FRACTURE_PEAK_MS, 900);
  assert.ok(BINDING_PEAK_MS < SCREEN_FX_MS.binding && FRACTURE_PEAK_MS < SCREEN_FX_MS.fracture);
  // Rain on the glass is a sticky weather like the others and fades in over about two seconds.
  assert.ok(WEATHERS.includes("raindrops") && WEATHER_LABELS.raindrops);
  assert.equal(RAINDROPS_FADE_MS, 2000);
  assert.ok(PLAYER_STYLE.includes("canvas.sfx-canvas"));
  const result = validateProject(withNode({ weather: "raindrops", fx: ["binding,50,45", "fracture", "fracture,50,58"] }));
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  if (result.valid) {
    assert.equal(result.project.nodes[0].weather, "raindrops");
    assert.deepEqual(result.project.nodes[0].fx, ["binding,50,45", "fracture", "fracture,50,58"]);
  }
  const bad = validateProject(withNode({ weather: "raindrop" as never, fx: ["binding,50,45,20"] }));
  assert.equal(bad.valid, false);
  assert.match(JSON.stringify(bad.errors), /wail, binding, fracture/);
});

test("uncloak is an entrance and exit like the others and survives validation", () => {
  assert.ok(ACTOR_MOTIONS.includes("uncloak") && ACTOR_MOTION_LABELS.uncloak);
  // "none" stays last, as the studio's pickers list it.
  assert.equal(ACTOR_MOTIONS.at(-1), "none");
  const project = createStarterProject();
  const node = project.nodes[0];
  node.cast = [{ characterId: "noah", poseId: "neutral", position: 70, enter: "uncloak", exit: "uncloak" }];
  Object.assign(node, { enter: "uncloak" });
  const result = validateProject(project);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  if (result.valid) {
    assert.equal(result.project.nodes[0].cast?.[0].enter, "uncloak");
    assert.equal(result.project.nodes[0].cast?.[0].exit, "uncloak");
    assert.equal(result.project.nodes[0].enter, "uncloak");
  }
  const typo = structuredClone(project);
  typo.nodes[0].cast![0].enter = "cloak" as never;
  assert.equal(validateProject(typo).valid, false);
});

test("an ambience bed is its own channel: it continues between scenes and stops on null", () => {
  const project = createStarterProject();
  project.sounds = [
    { id: "score", name: "Score", src: "/score.mp3", kind: "music" },
    { id: "rain", name: "Rain", src: "/rain.mp3", kind: "ambience", volume: 0.7 },
  ];
  const [first] = project.nodes;
  project.nodes = [
    { ...first, id: "a", type: "dialogue", musicId: "score", ambienceId: "rain", nextId: "b" },
    { ...first, id: "b", type: "dialogue", nextId: "c" },
    { ...first, id: "c", type: "dialogue", ambienceId: null, nextId: "d" },
    { ...first, id: "d", type: "end", musicId: null, ambienceId: "rain" },
  ] as Project["nodes"];
  project.startNodeId = "a";
  const checked = validateProject(project);
  assert.equal(checked.valid, true, JSON.stringify(checked.errors));
  if (!checked.valid) return;
  assert.equal(checked.project.sounds[1].kind, "ambience");
  assert.equal(checked.project.nodes[2].ambienceId, null);
  let state = createPlayerState(checked.project);
  const seen = [[state.musicId, state.ambienceId]];
  for (let index = 0; index < 3; index++) {
    state = advancePlayer(checked.project, state);
    seen.push([state.musicId, state.ambienceId]);
  }
  assert.deepEqual(seen, [
    ["score", "rain"],
    ["score", "rain"],
    ["score", null],
    [null, "rain"],
  ]);
  // Back navigation restores the earlier bed with the rest of the snapshot.
  assert.equal(state.history.at(-1)?.ambienceId, null);
  const missing = validateProject({
    ...checked.project,
    nodes: checked.project.nodes.map((node) => (node.id === "b" ? { ...node, ambienceId: "wind" } : node)),
  });
  assert.equal(missing.valid, false);
  assert.match(JSON.stringify(missing.errors), /ambience track does not exist/);
  // Under a voice the bed ducks half as deep as the music.
  assert.equal(ambienceDuck(0.45), 0.725);
  assert.equal(ambienceDuck(1), 1);
});

test("spoken words are whitespace-separated with punctuation attached, tags removed", () => {
  assert.deepEqual(spokenWords("  Wait.{wait=0.5} You *knew*?{shake}\nHolographic, again… "), [
    "Wait.",
    "You",
    "knew?",
    "Holographic,",
    "again…",
  ]);
  assert.deepEqual(spokenWords("{fx=crack}"), []);
});

test("quill is an entrance for part of a line and a line effect", () => {
  const run = parseMarkup("{in=quill}ink{/in}").items[0];
  assert.equal(run.kind === "text" && run.run.entry, "quill");
  const plan = planReveal("Ink.", { effect: "quill", cps: 40 });
  assert.equal(plan.effect, "quill");
  // The last glyph's entrance (ink settling) is part of the line's duration.
  assert.ok(plan.duration >= plan.glyphs[plan.glyphs.length - 1].at + 400);
});

test("without word timings the reveal keeps its even, punctuation-aware pacing", () => {
  const plan = planReveal("Hi, you.", { effect: "typewriter", cps: 10 });
  // Units: H0 i1 ,2 (pause 3) space .6 → y6.6 o7.6 u8.6 .9.6
  assert.deepEqual(
    plan.glyphs.map((glyph) => glyph.at),
    [0, 100, 200, 660, 760, 860, 960],
  );
  assert.deepEqual(
    plan.glyphs.map((glyph) => glyph.word),
    [0, 0, 0, 1, 1, 1, 1],
  );
  assert.equal(plan.glyphs[0].rest, 100);
  assert.equal(plan.glyphs[plan.glyphs.length - 1].rest, 260);
  // Stretched to the recording when its duration is known.
  // 17.6 units (the final full stop's pause included) stretched to 1920 ms.
  const synced = planReveal("Hi, you.", { effect: "typewriter", cps: 10, syncTo: 1920 });
  assert.equal(synced.glyphs[6].at, Math.round((9.6 * 1920) / 17.6));
});

test("word timings write each word in full just before it is spoken", () => {
  const plan = planReveal("I {shake}knew. Of course{sfx=Boom} I knew!", {
    effect: "fade",
    cps: 40,
    timings: [0.2, 0.5, 2.0, 2.1, 2.6],
  });
  // "I" is spoken 200 ms in: the voice waits just long enough for the margin.
  assert.equal(plan.voiceDelay, VOICE_MARGIN_MS - 200);
  const lastOf = (word: number) => plan.glyphs.filter((glyph) => glyph.word === word).at(-1)!.at;
  // Every timed word is complete VOICE_MARGIN_MS before its spoken start.
  assert.deepEqual(
    [0, 1, 2, 3, 4].map(lastOf),
    [0.2, 0.5, 2.0, 2.1, 2.6].map((seconds) => seconds * 1000 + plan.voiceDelay - VOICE_MARGIN_MS),
  );
  // "knew." is written in one go, 40 ms per glyph, then the text waits for the voice.
  assert.deepEqual(
    plan.glyphs.filter((glyph) => glyph.word === 1).map((glyph) => glyph.at),
    [140, 180, 220, 260, 300],
  );
  // "course" has only 100 ms after "Of": its glyphs are written faster but never all at once.
  const course = plan.glyphs.filter((glyph) => glyph.word === 3);
  for (let index = 1; index < course.length; index++)
    assert.ok(course[index].at - course[index - 1].at >= 12, `step ${index}`);
  // Events still fire when the word they sit before is spoken.
  assert.deepEqual(
    plan.events.map((event) => [event.event.type, event.at]),
    [
      ["shake", 500 + plan.voiceDelay],
      ["sfx", 2600 + plan.voiceDelay],
    ],
  );
  // The word without a timing ("knew!") follows at the line's pace after the last timed word.
  const tail = plan.glyphs.filter((glyph) => glyph.word === 5);
  assert.ok(tail[0].at > lastOf(4));
  assert.ok(tail[0].at < lastOf(4) + 100, `tail starts at ${tail[0].at}`);
  for (let index = 1; index < tail.length; index++) assert.ok(tail[index].at > tail[index - 1].at);
  // The caret rests on a word's last glyph until the next word starts.
  const lastOfFirst = plan.glyphs.filter((glyph) => glyph.word === 0).at(-1)!;
  assert.equal(lastOfFirst.at + lastOfFirst.rest, 140);
});

test("the voice starts a moment after the text so the first word is ready too", () => {
  const plan = planReveal("Hello there", { effect: "quill", cps: 40, timings: [0.1, 0.6] });
  // "Hello" needs the margin plus four 40 ms strokes; the recording gives it 100 ms.
  assert.equal(plan.voiceDelay, VOICE_MARGIN_MS + 160 - 100);
  assert.ok(plan.glyphs[0].at >= 0);
  assert.equal(plan.glyphs[4].at, 100 + plan.voiceDelay - VOICE_MARGIN_MS);
  assert.equal(plan.glyphs.at(-1)!.at, 600 + plan.voiceDelay - VOICE_MARGIN_MS);
  // The delay is capped; a long first word is then written faster.
  const long = planReveal("Unbelievably, no", { effect: "quill", cps: 40, timings: [0, 0.9] });
  assert.equal(long.voiceDelay, 600);
  assert.ok(long.glyphs[0].at >= 0);
  assert.equal(long.glyphs[12].at, 600 - VOICE_MARGIN_MS);
  // Without timings there is no delay.
  assert.equal(planReveal("Hello", { effect: "quill", cps: 40 }).voiceDelay, 0);
});

test("words with clustered timings are written early instead of falling behind the voice", () => {
  // Recognizers often give several quick words the same start. Each word must still be
  // complete VOICE_MARGIN_MS before its own start, so the bunch is written before it.
  const timings = [1, 1.05, 1.05, 1.05, 1.1];
  const plan = planReveal("Wait, what did you say", { effect: "quill", cps: 40, timings });
  for (let word = 0; word < timings.length; word++) {
    const glyphs = plan.glyphs.filter((glyph) => glyph.word === word);
    assert.ok(
      glyphs.at(-1)!.at <= timings[word] * 1000 + plan.voiceDelay - VOICE_MARGIN_MS,
      `word ${word} complete in time`,
    );
    for (let index = 1; index < glyphs.length; index++)
      assert.ok(glyphs[index].at - glyphs[index - 1].at >= 12, `word ${word} step ${index}`);
  }
  // Words follow one another; nothing is written before the line starts.
  for (let index = 1; index < plan.glyphs.length; index++)
    assert.ok(plan.glyphs[index].at > plan.glyphs[index - 1].at, `glyph ${index}`);
  assert.ok(plan.glyphs[0].at >= 0);
  // The last word is written as late as allowed: just in time, not early.
  assert.equal(plan.glyphs.at(-1)!.at, 1100 + plan.voiceDelay - VOICE_MARGIN_MS);
});

test("word timings ignore waits and speed changes, and extra timings", () => {
  const plan = planReveal("One{wait=2} {speed=0.2}two", {
    effect: "typewriter",
    cps: 30,
    timings: [0, 1, 5, 9],
  });
  assert.equal(plan.voiceDelay, VOICE_MARGIN_MS + 80);
  assert.equal(plan.glyphs[5].at, 1000 + plan.voiceDelay - VOICE_MARGIN_MS);
  assert.deepEqual(
    plan.events.map((event) => [event.event.type, event.at]),
    [["wait", 1000 + plan.voiceDelay]],
  );
  assert.ok(plan.duration < 2000);
  // A single timing still anchors the line.
  const single = planReveal("Go", { effect: "typewriter", cps: 30, timings: [1.5] });
  assert.deepEqual(
    single.glyphs.map((glyph) => glyph.at),
    [1460 - VOICE_MARGIN_MS, 1500 - VOICE_MARGIN_MS],
  );
  // Instant text ignores timings.
  const instant = planReveal("Go now", { effect: "instant", cps: 30, timings: [1, 2] });
  assert.equal(instant.duration, 0);
  assert.equal(instant.voiceDelay, 0);
});

test("a title card's entrance lasts at least its minimum", () => {
  const plan = planReveal("Chapter One", { effect: "typewriter", cps: 45, minEntryMs: 1950 });
  assert.equal(plan.duration, plan.glyphs.at(-1)!.at + 1950);
});

function withNode(patch: Record<string, unknown>): Project {
  const project = createStarterProject();
  Object.assign(project.nodes[0], patch);
  return project;
}

test("word timings, scene effects and music ducking are validated", () => {
  const words = spokenWords(createStarterProject().nodes[0].text).length;
  const ok = validateProject(
    withNode({
      audioSrc: "/line.mp3",
      textTimings: Array.from({ length: words }, (_, index) => index * 0.3),
      fx: ["crack", "glint,48,30"],
    }),
  );
  assert.equal(ok.valid, true, JSON.stringify(ok.errors));
  assert.deepEqual(ok.warnings, []);
  if (ok.valid) assert.deepEqual(ok.project.nodes[0].fx, ["crack", "glint,48,30"]);

  for (const textTimings of [[0.5, 0.2], [-1], [Number.NaN], "0.1", [0, "1"]]) {
    const result = validateProject(withNode({ audioSrc: "/line.mp3", textTimings }));
    assert.equal(result.valid, false, JSON.stringify(textTimings));
    assert.ok(result.errors.some((error) => error.path.startsWith("nodes[0].textTimings")));
  }
  const extra = validateProject(
    withNode({ audioSrc: "/line.mp3", textTimings: Array.from({ length: words + 2 }, (_, i) => i) }),
  );
  assert.equal(extra.valid, true);
  assert.ok(extra.warnings.some((warning) => /extra timings/.test(warning.message)));
  const silent = validateProject(withNode({ textTimings: [0] }));
  assert.ok(silent.warnings.some((warning) => /voice recording/.test(warning.message)));

  for (const fx of [["boom"], ["glint,40"], "crack", [3]]) {
    const result = validateProject(withNode({ fx }));
    assert.equal(result.valid, false, JSON.stringify(fx));
  }

  const project = createStarterProject();
  project.theme = {
    textbox: "grimoire",
    textEffect: "quill",
    textSpeed: 45,
    font: "storybook",
    accent: "#e8c474",
    focus: "dim",
    expressionChange: "morph",
    musicDuck: 0.45,
  };
  project.nodes[0].weather = "candles";
  project.nodes[0].textbox = "title";
  const themed = validateProject(project);
  assert.equal(themed.valid, true, JSON.stringify(themed.errors));
  if (themed.valid) assert.equal(themed.project.theme?.musicDuck, 0.45);
  project.theme.musicDuck = 1.5;
  assert.equal(validateProject(project).valid, false);
  project.theme.musicDuck = 0.45;

  project.sounds = [
    { id: "waltz", name: "Waltz", src: "/music/waltz.mp3", kind: "music", loop: false, volume: 0.55 },
  ];
  const once = validateProject(project);
  assert.equal(once.valid, true, JSON.stringify(once.errors));
  if (once.valid) assert.deepEqual(once.project.sounds[0], project.sounds[0]);
  for (const bad of [{ volume: 1.4 }, { volume: -0.1 }, { loop: "no" }]) {
    project.sounds = [{ ...project.sounds[0], ...bad } as Project["sounds"][number]];
    assert.equal(validateProject(project).valid, false, JSON.stringify(bad));
  }
});

test("title letters settle in place, so a centred title never shifts while it appears", () => {
  const keyframes = /@keyframes g-title-in\{[^@]*\}\}/.exec(PLAYER_STYLE)?.[0] ?? "";
  assert.ok(keyframes.includes("transform"), keyframes);
  assert.ok(!/letter-spacing|width|margin|padding/.test(keyframes), keyframes);
});

test("storybook fonts are embedded only in stories that use them", async () => {
  const plain = createStarterProject();
  assert.equal(usesStorybookFonts(plain), false);
  const html = await exportStandaloneHtml(plain, { resolveAsset });
  assert.ok(!html.includes("Cormorant Garamond\";font-style"));
  assert.ok(html.includes('id="screen-fx"'));

  const titled = createStarterProject();
  titled.nodes[0].textbox = "title";
  assert.equal(usesStorybookFonts(titled), true);
  const withFonts = await exportStandaloneHtml(titled, { resolveAsset });
  assert.ok(withFonts.includes('@font-face{font-family:"Cinzel"'));
  assert.ok(withFonts.includes("data:font/woff2;base64,"));
  assert.ok(withFonts.length - html.length > 60_000);

  const themed = createStarterProject();
  themed.theme = { ...themed.theme!, font: "storybook" } as Project["theme"];
  assert.equal(usesStorybookFonts(themed), true);
});

test("the mix interpolates frame-by-frame fades but keeps deliberate steps", () => {
  const fade = [
    { t: 0, v: 0.6 },
    { t: 1 / 30, v: 0.5 },
    { t: 2 / 30, v: 0.4 },
    { t: 3, v: 1 },
  ];
  assert.equal(volumeAt(fade, 0, 0), 0.6);
  assert.ok(Math.abs(volumeAt(fade, 0, 1 / 60) - 0.55) < 1e-9);
  // A long hold is a step, not a three-second ramp.
  assert.equal(volumeAt(fade, 2, 1.5), 0.4);
  assert.equal(volumeAt(fade, 3, 4), 1);
});
