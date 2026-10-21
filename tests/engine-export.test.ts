import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";
import { DEFAULT_THEME } from "../src/engine/staging";
import {
  createStarterProject,
  exportStandaloneHtml,
  loadProject,
  saveProject,
  serializeForHtml,
} from "../src/engine";

const IMAGE =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";
const AUDIO = "data:audio/mpeg;base64,SUQz";
const CUES = "data:application/json;base64,e30=";

function embeddedProject(html: string) {
  const match = html.match(
    /<script id="project-data" type="application\/json">([\s\S]*?)<\/script>/,
  );
  assert.ok(match);
  return JSON.parse(match[1]);
}

function embeddedAssets(html: string) {
  const match = html.match(
    /<script id="asset-data" type="application\/json">([\s\S]*?)<\/script>/,
  );
  assert.ok(match);
  return JSON.parse(match[1]) as Record<string, string>;
}

test("offline games retain the runtime license and licenses for embedded storybook fonts", async () => {
  const project = createStarterProject();
  const plain = await exportStandaloneHtml(project, { resolveAsset: async () => IMAGE });
  assert.match(plain, /MIT License/);
  assert.match(plain, /Copyright \(c\) 2026 Mario Manzocco/);
  assert.doesNotMatch(plain, /SIL OPEN FONT LICENSE Version 1\.1/);
  project.theme = { ...DEFAULT_THEME, textbox: "grimoire" };
  const storybook = await exportStandaloneHtml(project, { resolveAsset: async () => IMAGE });
  assert.match(storybook, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(storybook, /OFL-Cinzel\.txt/);
  assert.match(storybook, /OFL-CormorantGaramond\.txt/);
  assert.ok(storybook.includes('src:url(data:font/woff2;base64,'));
});

test("standalone export embeds referenced images, generated audio, and cue data", async () => {
  const project = createStarterProject();
  project.nodes[0].audioSrc = "/generated/line.mp3";
  project.nodes[0].cueUrl = "/generated/line.cues.json";
  project.characters[0].poses.push({
    id: "unused",
    name: "Unused",
    src: "/missing-unused.png",
  });
  project.characters[0].poses[0].rig = "/packs/rig.json";
  const calls: string[] = [];
  const html = await exportStandaloneHtml(project, {
    resolveAsset: async (src) => {
      calls.push(src);
      return src.endsWith(".mp3")
        ? AUDIO
        : src.endsWith(".json")
          ? CUES
          : IMAGE;
    },
  });
  const portable = embeddedProject(html);
  const assets = embeddedAssets(html);
  assert.equal(assets[portable.nodes[0].audioSrc], AUDIO);
  assert.equal(assets[portable.nodes[0].cueUrl], CUES);
  assert.equal(assets[portable.characters[0].poses[0].src], IMAGE);
  assert.equal(assets[portable.characters[0].poses[0].rig], CUES);
  assert.equal(portable.characters[0].poses.length, 1);
  assert.equal(calls.includes("/missing-unused.png"), false);
  assert.equal(calls.includes("/packs/rig.json"), true);
  assert.equal(
    project.characters[0].poses[0].src,
    "/assets/characters/mira.svg",
  );
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 2);
  scripts.forEach((script) => assert.doesNotThrow(() => new Script(script[1])));
});

test("script and title breakout payloads are safely escaped without changing dialogue", async () => {
  const payload =
    "</script><script>globalThis.pwned=true</script><img src=x onerror=alert(1)>\u2028\u2029";
  const project = createStarterProject();
  project.title = "</title><img src=x onerror=alert(1)>";
  project.nodes[0].text = payload;
  project.characters[0].name = "<b>Unsafe name</b>";
  const html = await exportStandaloneHtml(project, {
    resolveAsset: async () => IMAGE,
  });
  assert.equal(html.includes(payload), false);
  assert.equal(html.includes("<title></title>"), false);
  assert.equal(embeddedProject(html).nodes[0].text, payload);
  assert.equal(html.includes("text.innerHTML"), false);
  assert.equal(serializeForHtml({ payload }).includes("<"), false);
});

test("export fails on missing assets and on resolvers returning executable content", async () => {
  await assert.rejects(
    exportStandaloneHtml(createStarterProject(), {
      resolveAsset: async () => {
        throw new Error("Not found");
      },
    }),
    /Could not embed.*Not found/,
  );
  await assert.rejects(
    exportStandaloneHtml(createStarterProject(), {
      resolveAsset: async () => "data:text/html;base64,PHNjcmlwdD4=",
    }),
    /not a supported image/,
  );
});

test("export deduplicates repeated source assets", async () => {
  const project = createStarterProject();
  project.characters[1].poses[0].src = project.characters[0].poses[0].src;
  let count = 0;
  await exportStandaloneHtml(project, {
    resolveAsset: async () => {
      count++;
      return IMAGE;
    },
  });
  assert.equal(count, 3);
});

test("animated export includes the selected rig closure and excludes other poses and recordings", async () => {
  const project = createStarterProject();
  const pose = project.characters[0].poses[0];
  pose.animation = {
    assetRoot: "/pack",
    poseKey: "neutral",
    manifestUrl: "/pack/manifest.json",
    speechIndexUrl: "/pack/speech.json",
    browsIndexUrl: "/pack/brows.json",
  };
  pose.rig = "/pack/rig.json";
  project.nodes[0].audioSrc = "/pack/audio/used.mp3";
  const json = (value: unknown) =>
    `data:application/json;base64,${Buffer.from(JSON.stringify(value)).toString("base64")}`;
  const fixtures: Record<string, string> = {
    "/pack/manifest.json": json({
      sprites: {
        neutral: {
          image: "/pack/mouth.png",
          performanceRig: "/pack/rig.json",
          provenance: "Documentation/unused-source.png",
        },
        unused: { image: "/pack/do-not-fetch.png" },
      },
    }),
    "/pack/rig.json": json({
      referenceImage: "/pack/reference.png",
      gaze: "/pack/gaze.json",
      lines: "/pack/performance.json",
    }),
    "/pack/gaze.json": json({ image: "/pack/gaze.png" }),
    "/pack/performance.json": json({
      lines: {
        "/audio/used.mp3": { head: [], gaze: [] },
        "/audio/unused.mp3": { head: [], gaze: [] },
      },
    }),
    "/pack/speech.json": json({
      lines: {
        "/audio/used.mp3": "/pack/used-cues.json",
        "/audio/unused.mp3": "/pack/do-not-fetch-cues.json",
      },
    }),
    "/pack/used-cues.json": json({
      metadata: { soundFile: "/audio/used.mp3" },
      mouthCues: [{ start: 0, end: 1, value: "A" }],
    }),
    "/pack/brows.json": json({
      poses: {
        neutral: "/pack/neutral-brows.json",
        unused: "/pack/do-not-fetch-brows.json",
      },
    }),
    "/pack/neutral-brows.json": json({ image: "/pack/brow-atlas.png" }),
  };
  const requested: string[] = [];
  const html = await exportStandaloneHtml(project, {
    resolveAsset: async (src) => {
      requested.push(src);
      assert.equal(src.includes("do-not-fetch"), false);
      assert.equal(src.startsWith("Documentation"), false);
      return fixtures[src] ?? (src.endsWith(".mp3") ? AUDIO : IMAGE);
    },
  });
  const assets = embeddedAssets(html);
  const decoded = (url: string) =>
    JSON.parse(Buffer.from(assets[url].split(",")[1], "base64").toString());
  assert.deepEqual(Object.keys(decoded("/pack/manifest.json").sprites), [
    "neutral",
  ]);
  assert.deepEqual(Object.keys(decoded("/pack/brows.json").poses), ["neutral"]);
  assert.deepEqual(Object.keys(decoded("/pack/speech.json").lines), [
    "/audio/used.mp3",
  ]);
  assert.deepEqual(Object.keys(decoded("/pack/performance.json").lines), [
    "/audio/used.mp3",
  ]);
  for (const needed of [
    "/pack/rig.json",
    "/pack/reference.png",
    "/pack/gaze.png",
    "/pack/brow-atlas.png",
    "/pack/used-cues.json",
    "/pack/audio/used.mp3",
  ])
    assert.ok(assets[needed], needed);
  assert.equal(requested.filter((src) => src === "/pack/rig.json").length, 1);
  assert.ok(html.includes("FrameAnimation"));
});

test("a missing selected animation pose prevents an incomplete export", async () => {
  const project = createStarterProject();
  project.characters[0].poses[0].animation = {
    assetRoot: "/pack",
    poseKey: "missing",
    manifestUrl: "/pack/manifest.json",
    speechIndexUrl: "/pack/speech.json",
  };
  const manifest = `data:application/json;base64,${Buffer.from('{"sprites":{}}').toString("base64")}`;
  await assert.rejects(
    exportStandaloneHtml(project, {
      resolveAsset: async (src) => (src.endsWith(".json") ? manifest : IMAGE),
    }),
    /missing a selected pose/,
  );
});

test("remote asset embedding requires explicit permission", async () => {
  const project = createStarterProject();
  project.characters[0].poses[0].src = "https://example.com/portrait.png";
  await assert.rejects(
    exportStandaloneHtml(project),
    /remote asset needs permission/,
  );
});

test("unavailable browser storage rejects visibly and never reports a false save", async () => {
  if (globalThis.indexedDB) return;
  await assert.rejects(
    saveProject(createStarterProject()),
    /does not provide local project storage/,
  );
  await assert.rejects(loadProject(), /does not provide local project storage/);
});

test("an export can carry the production's own styles and a character's cut-only expressions", async () => {
  const project = createStarterProject();
  project.characters[0].expressionChange = "cut";
  const html = await exportStandaloneHtml(project, {
    resolveAsset: async () => IMAGE,
    styles: ".vn-text .g{animation-duration:.18s}</style><script>alert(1)</script>",
  });
  const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  assert.ok(style.includes(".vn-text .g{animation-duration:.18s}"));
  assert.ok(!html.includes("</style><script>alert(1)"), "extra styles cannot close the style element");
  assert.equal(embeddedProject(html).characters[0].expressionChange, "cut");
  const invalid = createStarterProject();
  (invalid.characters[0] as { expressionChange?: string }).expressionChange = "wipe";
  await assert.rejects(exportStandaloneHtml(invalid, { resolveAsset: async () => IMAGE }), /expressionChange/);
});
