import assert from "node:assert/strict";
import test from "node:test";
import {
  createShowcaseProject,
  createStarterProject,
  exportStandaloneHtml,
  parseMarkup,
  plainText,
  validateProject,
} from "../src/engine";

test("inline direction is removed from the spoken words and kept as timed events", () => {
  const parsed = parseMarkup(
    "Wait.{wait=0.6} You *knew*?{expression=Angry}{shake=heavy} {color=#7fe3ff}Holographic{/color}{sfx=Boom}{flash}",
  );
  assert.equal(parsed.plain, "Wait. You knew? Holographic");
  const events = parsed.items.flatMap((item) =>
    item.kind === "event" ? [item.event] : [],
  );
  assert.deepEqual(events, [
    { type: "wait", seconds: 0.6 },
    { type: "expression", value: "Angry" },
    { type: "shake", strength: "heavy" },
    { type: "sfx", value: "Boom" },
    { type: "flash" },
  ]);
  const runs = parsed.items.flatMap((item) =>
    item.kind === "text" ? [item.run] : [],
  );
  assert.deepEqual(
    runs.find((run) => run.text === "knew"),
    { text: "knew", em: true },
  );
  assert.deepEqual(
    runs.find((run) => run.text === "Holographic"),
    { text: "Holographic", color: "#7fe3ff" },
  );
});

test("unmatched asterisks, escapes and unknown tags stay safe", () => {
  assert.equal(plainText("5 * 3 = 15"), "5 * 3 = 15");
  assert.equal(plainText("\\{wait\\} and \\*stars\\*"), "{wait} and *stars*");
  assert.equal(plainText("**Bold** move"), "Bold move");
  const parsed = parseMarkup("Hello {mystery} there {wait=abc}");
  assert.equal(parsed.plain, "Hello  there ");
  assert.deepEqual(parsed.unknownTags, ["{mystery}"]);
  // An invalid wait falls back to the default half second.
  assert.deepEqual(
    parsed.items.find((item) => item.kind === "event"),
    { kind: "event", event: { type: "wait", seconds: 0.5 } },
  );
  // Values are clamped to sensible ranges.
  assert.deepEqual(parseMarkup("{wait=99}{speed=0}").items, [
    { kind: "event", event: { type: "wait", seconds: 10 } },
    { kind: "event", event: { type: "speed", factor: 1 } },
  ]);
});

test("the stage tour is a valid version 3 project", () => {
  const result = validateProject(createShowcaseProject());
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.warnings, []);
  assert.equal(result.project?.schemaVersion, 3);
  // Staging, look and theme fields survive validation unchanged.
  const tour = createShowcaseProject();
  assert.deepEqual(JSON.parse(JSON.stringify(result.project)), tour);
});

test("version 3 presentation fields are validated", () => {
  const project = createStarterProject();
  const node = project.nodes[0] as unknown as Record<string, unknown>;
  for (const [key, value, ok] of [
    ["transition", "iris", true],
    ["transition", "spin", false],
    ["textbox", "bubble", true],
    ["textbox", "comic-sans", false],
    ["weather", "storm", true],
    ["weather", "lava", false],
    ["grade", "noir", true],
    ["scale", 3, false],
    ["scale", 1.4, true],
    ["y", -80, false],
    ["camera", { zoom: 1.5, x: 40, y: 30 }, true],
    ["camera", { zoom: 9, x: 40, y: 30 }, false],
    ["emote", "jump", true],
    ["enter", "teleport", false],
    ["audioDuration", -1, false],
  ] as const) {
    const copy = structuredClone(project);
    (copy.nodes[0] as unknown as Record<string, unknown>)[key] = value;
    assert.equal(validateProject(copy).valid, ok, `${key}=${JSON.stringify(value)}`);
  }
  assert.equal(node.transition, undefined);
  const themed = {
    ...project,
    theme: {
      textbox: "gilded",
      textEffect: "rise",
      textSpeed: 50,
      font: "serif",
      accent: "#c9a75a",
      focus: "spotlight",
      expressionChange: "morph",
    },
  };
  assert.equal(validateProject(themed).valid, true);
  assert.equal(
    validateProject({ ...themed, theme: { ...themed.theme, font: "comic" } }).valid,
    false,
  );
  // A video background must be a video; an image URL with the video kind is still a URL.
  const video = structuredClone(project);
  video.backgrounds[0] = {
    ...video.backgrounds[0],
    kind: "video",
    src: "data:image/png;base64,AA==",
  };
  assert.equal(validateProject(video).valid, false);
  video.backgrounds[0].src = "data:video/mp4;base64,AA==";
  assert.equal(validateProject(video).valid, true);
});

test("markup warnings point at unknown expressions and sounds", () => {
  const project = createStarterProject();
  project.nodes[0].text = "Hi {expression=Furious}{sfx=Thunder}{mystery}";
  const result = validateProject(project);
  assert.equal(result.valid, true);
  const messages = result.warnings.map((warning) => warning.message).join("\n");
  assert.match(messages, /expression=Furious/);
  assert.match(messages, /sfx=Thunder/);
  assert.match(messages, /\{mystery\}/);
});

test("export embeds sounds referenced only by inline direction", async () => {
  const project = createStarterProject();
  project.sounds = [
    { id: "boom", name: "Boom", src: "/boom.mp3", kind: "sfx" },
    { id: "unused", name: "Unused", src: "/unused.mp3", kind: "sfx" },
  ];
  project.nodes[0].text = "Down {sfx=boom}it goes.";
  const requested: string[] = [];
  const html = await exportStandaloneHtml(project, {
    resolveAsset: async (src) => {
      requested.push(src);
      return src.endsWith(".mp3")
        ? "data:audio/mpeg;base64,SUQz"
        : "data:image/svg+xml;base64,PHN2Zy8+";
    },
  });
  assert.ok(requested.includes("/boom.mp3"));
  assert.ok(!requested.includes("/unused.mp3"));
  assert.match(html, /"id":"boom"/);
});

test("export keeps poses that are only named by inline expression changes", async () => {
  const project = createStarterProject();
  project.characters[0].poses.push(
    { id: "angry", name: "Angry", src: "/angry.svg" },
    { id: "unused", name: "Unused", src: "/unused.svg" },
  );
  project.nodes[0].text = "Fine.{expression=angry} Fine!";
  const requested: string[] = [];
  const html = await exportStandaloneHtml(project, {
    resolveAsset: async (src) => {
      requested.push(src);
      return "data:image/svg+xml;base64,PHN2Zy8+";
    },
  });
  assert.ok(requested.includes("/angry.svg"));
  assert.ok(!requested.includes("/unused.svg"));
  assert.match(html, /"id":"angry"/);
});

test("text animation tags style runs without reaching the spoken words", () => {
  const parsed = parseMarkup(
    "{wave}Hi {rainbow=2}there{/rainbow}{/wave} {in=fly}{size=1.6}friend{/size}{/in}{jitter}!{/fx} done",
  );
  assert.equal(parsed.plain, "Hi there friend! done");
  assert.deepEqual(parsed.unknownTags, []);
  const runs = parsed.items.flatMap((item) => (item.kind === "text" ? [item.run] : []));
  assert.deepEqual(runs, [
    { text: "Hi ", fx: [{ name: "wave", strength: 1 }] },
    {
      text: "there",
      fx: [
        { name: "wave", strength: 1 },
        { name: "rainbow", strength: 2 },
      ],
    },
    { text: " " },
    { text: "friend", entry: "fly", size: 1.6 },
    { text: "!", fx: [{ name: "jitter", strength: 1 }] },
    { text: " done" },
  ]);
  // Strength and size are clamped; unknown entrances and closings are reported, not spoken.
  const odd = parseMarkup("{wave=99}a{/wave}{size=9}b{/size}{in=teleport}c{/bogus}");
  const oddRuns = odd.items.flatMap((item) => (item.kind === "text" ? [item.run] : []));
  assert.equal(oddRuns[0].fx?.[0].strength, 3);
  assert.equal(oddRuns[1].size, 2.5);
  assert.deepEqual(odd.unknownTags, ["{in=teleport}", "{/bogus}"]);
  assert.equal(plainText("{wave}calm{/wave} {glitch}static{/glitch}"), "calm static");
  // {shake} on its own is still the stage shake.
  assert.deepEqual(parseMarkup("Boom{shake}").items.at(-1), {
    kind: "event",
    event: { type: "shake", strength: "light" },
  });
});
