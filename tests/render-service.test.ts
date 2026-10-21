import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createStarterProject, type Project } from "../src/engine";
import { exportRecordingHtml } from "../src/engine/export";
import { DEFAULT_THEME } from "../src/engine/staging";
import { resolveChromium, renderRecording } from "../server/render/renderer";
import { mediaKey } from "../server/render/virtual-clock";

test("media keys distinguish recordings that only differ in the middle", () => {
  const a = tone(440, 1);
  const b = tone(660, 1);
  assert.equal(a.length, b.length);
  assert.notEqual(mediaKey(a), mediaKey(b));
  assert.equal(mediaKey(a), mediaKey(`${a}`));
  assert.equal(mediaKey("/audio/line.mp3"), "/audio/line.mp3");
});

const run = promisify(execFile);

/** A mono 16-bit PCM WAV tone as a data URL. */
function tone(frequency: number, seconds: number, amplitude = 0.4): string {
  const rate = 8000;
  const samples = Math.round(rate * seconds);
  const data = Buffer.alloc(44 + samples * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + samples * 2, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++)
    data.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * frequency * index) / rate) * amplitude * 32767),
      44 + index * 2,
    );
  return `data:audio/wav;base64,${data.toString("base64")}`;
}

const svg = (color: string) =>
  `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="${color}"/></svg>`).toString("base64")}`;

async function available(): Promise<boolean> {
  try {
    await resolveChromium();
    await run("ffmpeg", ["-version"]);
    await run("ffprobe", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

test("a recorded route renders to an MP4 with mixed voice and looping music", async (context) => {
  if (!(await available())) return context.skip("Chromium or FFmpeg is unavailable.");
  const project: Project = {
    ...createStarterProject(),
    backgrounds: [
      { id: "red", name: "Red", src: svg("#d01010") },
      { id: "blue", name: "Blue", src: svg("#1030d0") },
    ],
    sounds: [{ id: "loop", name: "Loop", src: tone(220, 0.7, 0.2), kind: "music" }],
    nodes: [
      {
        id: "one",
        type: "dialogue",
        label: "One",
        text: "Hi.",
        backgroundId: "red",
        position: 50,
        musicId: "loop",
        audioSrc: tone(660, 1),
        audioDuration: 1,
        // Leaves before the second scene with a keyframed exit.
        cast: [{ characterId: "noah", poseId: "neutral", position: 25, exit: "pop" }],
        nextId: "two",
      },
      {
        id: "two",
        type: "end",
        label: "Two",
        text: "Bye.",
        backgroundId: "blue",
        position: 50,
        audioSrc: tone(440, 1),
        audioDuration: 1,
      },
    ],
    startNodeId: "one",
  };
  const work = await mkdtemp(join(tmpdir(), "frame-render-test-"));
  try {
    const html = await exportRecordingHtml(
      project,
      { linePause: 300 },
      {
        // The starter portraits come from the distributable public assets.
        resolveAsset: async (src) =>
          src.startsWith("/assets/")
            ? `data:image/svg+xml;base64,${(await readFile(join("public", src))).toString("base64")}`
            : undefined,
      },
    );
    const htmlPath = join(work, "story.html");
    await writeFile(htmlPath, html);
    const outputPath = join(work, "story.mp4");
    const result = await renderRecording({
      htmlPath,
      outputPath,
      workDir: join(work, "scratch"),
      width: 320,
      height: 180,
      fps: 15,
      maxSeconds: 30,
    });
    assert.equal(result.recording.status, "done");
    // Music plus two different voice lines of identical length.
    assert.ok(result.audioSegments >= 3, `audio segments: ${result.audioSegments}`);
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,width,height,nb_frames:format=duration",
      "-of",
      "json",
      outputPath,
    ]);
    const probe = JSON.parse(stdout);
    const video = probe.streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
    assert.equal(video.width, 320);
    assert.equal(video.height, 180);
    assert.ok(probe.streams.some((stream: { codec_type: string }) => stream.codec_type === "audio"));
    // Fade-in, the voiced line, the pause, the ending's hold and the closing fade.
    const duration = Number(probe.format.duration);
    assert.ok(duration > 3 && duration < 12, `duration ${duration}`);
    assert.equal(Number(video.nb_frames), result.frames);
    // The mix is audible while the voice line plays.
    const loudness = await run("ffmpeg", [
      "-v",
      "info",
      "-ss",
      "0.2",
      "-t",
      "0.6",
      "-i",
      outputPath,
      "-af",
      "volumedetect",
      "-f",
      "null",
      "-",
    ]).catch((error) => error);
    const mean = Number(/mean_volume: (-?[\d.]+) dB/.exec(String(loudness.stderr))?.[1]);
    assert.ok(mean > -40, `mean volume ${mean} dB`);
    // The first scene's red background is on screen while its line plays.
    const frame = await run(
      "ffmpeg",
      ["-v", "error", "-ss", "0.85", "-i", outputPath, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
      { encoding: "buffer" },
    );
    const [red, green, blue] = frame.stdout as unknown as Buffer;
    assert.ok(red > green + 60 && red > blue + 60, `pixel ${red},${green},${blue}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

/** Mean level (dB) of one frequency band of the MP4's audio between `start` and `start + seconds`. */
async function bandLevel(path: string, frequency: number, start: number, seconds: number) {
  const result = await run("ffmpeg", [
    "-v",
    "info",
    "-ss",
    String(start),
    "-t",
    String(seconds),
    "-i",
    path,
    "-af",
    `bandpass=f=${frequency}:width_type=h:w=40,volumedetect`,
    "-f",
    "null",
    "-",
  ]).catch((error) => error);
  return Number(/mean_volume: (-?[\d.]+) dB/.exec(String(result.stderr))?.[1]);
}

test("recordings duck music under voice lines and mix scene and inline sound effects", async (context) => {
  if (!(await available())) return context.skip("Chromium or FFmpeg is unavailable.");
  const project: Project = {
    ...createStarterProject(),
    theme: {
      textbox: "grimoire",
      textEffect: "quill",
      textSpeed: 45,
      font: "storybook",
      accent: "#e8c474",
      focus: "dim",
      expressionChange: "morph",
      musicDuck: 0.45,
    },
    backgrounds: [{ id: "red", name: "Red", src: svg("#802020") }],
    sounds: [
      { id: "loop", name: "Loop", src: tone(220, 1, 0.3), kind: "music" },
      { id: "ding", name: "Ding", src: tone(1320, 0.25, 0.4), kind: "sfx" },
    ],
    nodes: [
      {
        id: "one",
        type: "dialogue",
        label: "One",
        text: "Glass{fx=crack} cracks {sfx=Ding}softly.",
        textTimings: [0.1, 0.5, 0.9],
        backgroundId: "red",
        position: 50,
        musicId: "loop",
        sfxId: "ding",
        weather: "candles",
        audioSrc: tone(660, 1.6),
        audioDuration: 1.6,
        nextId: "two",
      },
      {
        id: "two",
        type: "end",
        label: "Two",
        text: "The end.",
        textbox: "title",
        backgroundId: "red",
        position: 50,
        audioSrc: tone(660, 0.8),
        audioDuration: 0.8,
      },
    ],
    startNodeId: "one",
  };
  const work = await mkdtemp(join(tmpdir(), "frame-render-mix-"));
  try {
    const html = await exportRecordingHtml(project, { linePause: 3400 });
    const htmlPath = join(work, "story.html");
    await writeFile(htmlPath, html);
    const outputPath = join(work, "story.mp4");
    const result = await renderRecording({
      htmlPath,
      outputPath,
      workDir: join(work, "scratch"),
      width: 320,
      height: 180,
      fps: 15,
      maxSeconds: 30,
    });
    assert.equal(result.recording.status, "done");
    // Music, two voice lines, the scene's sound and the inline {sfx}.
    assert.ok(result.audioSegments >= 5, `audio segments: ${result.audioSegments}`);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(
      result.scenes.map((scene) => scene.nodeId),
      ["one", "two"],
    );
    assert.equal(result.scenes[0].seconds, 0);
    assert.ok(result.scenes[1].seconds > 1.6, `second scene at ${result.scenes[1].seconds} s`);
    // The music sits about 7 dB (×0.45) lower while the first line is spoken than after it;
    // it comes back up only after a real pause, not in the gap between two lines.
    const ducked = await bandLevel(outputPath, 220, 0.6, 0.7);
    const open = await bandLevel(outputPath, 220, 3.9, 0.6);
    const difference = open - ducked;
    assert.ok(difference > 4 && difference < 10, `ducked ${ducked} dB, open ${open} dB`);
    // Both sound effects are audible: the scene's at the start, the tag's at "softly" (0.9 s).
    const sceneSfx = await bandLevel(outputPath, 1320, 0, 0.3);
    const inlineSfx = await bandLevel(outputPath, 1320, 0.9, 0.3);
    const quiet = await bandLevel(outputPath, 1320, 3.9, 0.6);
    assert.ok(sceneSfx > quiet + 15, `scene sfx ${sceneSfx} dB vs ${quiet} dB`);
    assert.ok(inlineSfx > quiet + 15, `inline sfx ${inlineSfx} dB vs ${quiet} dB`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("an ambience bed is mixed beside the music, ducks only lightly and fades out on null", async (context) => {
  if (!(await available())) return context.skip("Chromium or FFmpeg is unavailable.");
  const project: Project = {
    ...createStarterProject(),
    theme: {
      textbox: "cinematic",
      textEffect: "instant",
      textSpeed: 45,
      font: "serif",
      accent: "#e8c474",
      focus: "dim",
      expressionChange: "cut",
      musicDuck: 0.45,
    },
    backgrounds: [{ id: "night", name: "Night", src: svg("#102030") }],
    sounds: [
      { id: "score", name: "Score", src: tone(220, 1, 0.3), kind: "music" },
      { id: "rain", name: "Rain", src: tone(880, 0.5, 0.3), kind: "ambience" },
    ],
    nodes: [
      {
        id: "one",
        type: "dialogue",
        label: "One",
        text: "The storm{fx=lightning,40,60} broke.",
        backgroundId: "night",
        position: 50,
        musicId: "score",
        ambienceId: "rain",
        weather: "downpour",
        audioSrc: tone(660, 1.6),
        audioDuration: 1.6,
        nextId: "two",
      },
      {
        id: "two",
        type: "dialogue",
        label: "Two",
        text: "Then the cold{fx=frost} hit.",
        backgroundId: "night",
        position: 50,
        ambienceId: null,
        weather: "frost",
        grade: "drained",
        audioSrc: tone(660, 0.6),
        audioDuration: 0.6,
        nextId: "three",
      },
      {
        id: "three",
        type: "end",
        label: "Three",
        text: "Light{fx=radiance,50,45}{fx=wandfail,40,60}.",
        backgroundId: "night",
        position: 50,
        audioSrc: tone(660, 0.6),
        audioDuration: 0.6,
      },
    ],
    startNodeId: "one",
  };
  const work = await mkdtemp(join(tmpdir(), "frame-render-ambience-"));
  try {
    const html = await exportRecordingHtml(project, { linePause: 3400 });
    const htmlPath = join(work, "story.html");
    await writeFile(htmlPath, html);
    const outputPath = join(work, "story.mp4");
    const result = await renderRecording({
      htmlPath,
      outputPath,
      workDir: join(work, "scratch"),
      width: 320,
      height: 180,
      fps: 15,
      maxSeconds: 40,
    });
    assert.equal(result.recording.status, "done");
    assert.deepEqual(result.warnings, []);
    const second = result.scenes[1].seconds;
    // The bed loops under the first line and keeps playing after it, at a steady level.
    const underVoice = await bandLevel(outputPath, 880, 0.6, 0.7);
    const open = await bandLevel(outputPath, 880, second - 1.2, 0.6);
    assert.ok(open > -45, `ambience ${open} dB`);
    // It ducks by about 2.8 dB (×0.725), far less than the music's 7 dB.
    const ambienceDip = open - underVoice;
    const musicDip = (await bandLevel(outputPath, 220, second - 1.2, 0.6)) - (await bandLevel(outputPath, 220, 0.6, 0.7));
    assert.ok(ambienceDip > 1 && ambienceDip < 5, `ambience dip ${ambienceDip} dB`);
    assert.ok(musicDip > ambienceDip + 2, `music dip ${musicDip} dB vs ambience ${ambienceDip} dB`);
    // ambienceId: null fades it out with the second scene while the music carries on.
    const after = await bandLevel(outputPath, 880, second + 2, 0.6);
    assert.ok(after < open - 25, `after the fade ${after} dB vs ${open} dB`);
    assert.ok((await bandLevel(outputPath, 220, second + 2, 0.6)) > -45, "the music continues");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("a music track can play once at its own level without starting over", async (context) => {
  if (!(await available())) return context.skip("Chromium or FFmpeg is unavailable.");
  const scene = (id: string, nextId?: string): Project["nodes"][number] =>
    ({
      id,
      type: nextId ? "dialogue" : "end",
      label: id,
      text: "Quiet.",
      position: 50,
      musicId: "once",
      ...(nextId ? { nextId } : {}),
    }) as Project["nodes"][number];
  const project: Project = {
    ...createStarterProject(),
    sounds: [
      { id: "once", name: "Once", src: tone(220, 1.4, 0.3), kind: "music", loop: false, volume: 0.5 },
    ],
    nodes: [scene("one", "two"), scene("two")],
    startNodeId: "one",
  };
  const work = await mkdtemp(join(tmpdir(), "frame-render-once-"));
  try {
    const htmlPath = join(work, "story.html");
    await writeFile(htmlPath, await exportRecordingHtml(project, { linePause: 1800 }));
    const outputPath = join(work, "story.mp4");
    const result = await renderRecording({
      htmlPath,
      outputPath,
      workDir: join(work, "scratch"),
      width: 320,
      height: 180,
      fps: 15,
      maxSeconds: 30,
    });
    assert.equal(result.recording.status, "done");
    assert.ok(result.scenes.length === 2 && result.scenes[1].seconds > 1.5, JSON.stringify(result.scenes));
    const playing = await bandLevel(outputPath, 220, 0.8, 0.5);
    const after = await bandLevel(outputPath, 220, result.scenes[1].seconds + 0.2, 0.8);
    assert.ok(playing > after + 20, `playing ${playing} dB, after the end ${after} dB`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("the end card holds until its closing jingle has played out", async (context) => {
  if (!(await available())) return context.skip("Chromium or FFmpeg is unavailable.");
  const project: Project = {
    ...createStarterProject(),
    sounds: [
      { id: "jingle", name: "Jingle", src: tone(330, 5, 0.3), kind: "music", loop: false, volume: 0.5 },
    ],
    nodes: [
      { id: "one", type: "dialogue", label: "one", text: "Quiet.", position: 50, nextId: "ending" },
      { id: "ending", type: "end", label: "End", text: "The end.", position: 50, musicId: "jingle" },
    ] as Project["nodes"],
    startNodeId: "one",
  };
  const work = await mkdtemp(join(tmpdir(), "frame-render-jingle-"));
  try {
    const htmlPath = join(work, "story.html");
    await writeFile(htmlPath, await exportRecordingHtml(project, { linePause: 400 }));
    const outputPath = join(work, "story.mp4");
    const result = await renderRecording({
      htmlPath, outputPath, workDir: join(work, "scratch"), width: 320, height: 180, fps: 15, maxSeconds: 30,
    });
    assert.equal(result.recording.status, "done");
    const ending = result.scenes.find((scene: { nodeId: string }) => scene.nodeId === "ending")!.seconds;
    // A 5 s jingle: a 1 s hold, the curtain (1.1 s) and the stop (0.4 s) come only after it.
    assert.ok(result.seconds >= ending + 5 + 2.3, JSON.stringify({ ending, seconds: result.seconds }));
    assert.ok(result.seconds <= ending + 5 + 3.2, JSON.stringify({ ending, seconds: result.seconds }));
    const late = await bandLevel(outputPath, 330, ending + 4.2, 0.5);
    assert.ok(late > -60, `the jingle still plays near its end: ${late} dB`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("the transformation hides its column at the peak in a real render, with an uncloaked entrance beside it", async (context) => {
  if (!(await available())) return context.skip("Chromium or FFmpeg is unavailable.");
  const scene = (id: string, extra: Partial<Project["nodes"][number]>): Project["nodes"][number] =>
    ({ id, type: "dialogue", label: id, text: "…", backgroundId: "pale", position: 50, ...extra }) as Project["nodes"][number];
  const project: Project = {
    ...createStarterProject(),
    theme: { ...DEFAULT_THEME, textbox: "minimal", textEffect: "instant" },
    backgrounds: [{ id: "pale", name: "Pale", src: svg("#c8c8c8") }],
    nodes: [
      scene("one", { audioDuration: 1.2, nextId: "two" }),
      scene("two", {
        fx: ["transform,50,55"],
        cast: [{ characterId: "noah", poseId: "neutral", position: 82, enter: "uncloak", exit: "uncloak" }],
        audioDuration: 3.2,
        nextId: "three",
      }),
      // The other effects render too, without warnings.
      scene("three", { fx: ["dome,50,55,20", "warmth", "splat", "wail"], audioDuration: 2, nextId: "end" }),
      { ...scene("end", { audioDuration: 0.4 }), type: "end" } as Project["nodes"][number],
    ],
    startNodeId: "one",
  };
  const work = await mkdtemp(join(tmpdir(), "frame-render-ch11-"));
  try {
    const html = await exportRecordingHtml(project, { linePause: 300 }, {
      resolveAsset: async (src) =>
        src.startsWith("/assets/")
          ? `data:image/svg+xml;base64,${(await readFile(join("public", src))).toString("base64")}`
          : undefined,
    });
    const htmlPath = join(work, "story.html");
    await writeFile(htmlPath, html);
    const outputPath = join(work, "story.mp4");
    const result = await renderRecording({
      htmlPath,
      outputPath,
      workDir: join(work, "scratch"),
      width: 320,
      height: 180,
      fps: 15,
      maxSeconds: 20,
    });
    assert.equal(result.recording.status, "done");
    assert.deepEqual(result.warnings, []);
    const start = result.scenes.find((item) => item.nodeId === "two")!.seconds;
    // Mean brightness of the column's middle, where the figure stands.
    const column = async (at: number) => {
      const frame = await run(
        "ffmpeg",
        ["-v", "error", "-ss", at.toFixed(3), "-i", outputPath, "-frames:v", "1", "-vf", "crop=32:90:144:45,scale=1:1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        { encoding: "buffer" },
      );
      return (frame.stdout as unknown as Buffer)[0];
    };
    const before = await column(start - 0.3);
    const peak = await column(start + 1.3);
    const after = await column(start + 3);
    assert.ok(before > 150, `before ${before}`);
    assert.ok(peak < 70, `at the peak ${peak}`);
    assert.ok(after > peak + 60, `after ${after}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("the binding flares at its peak and the fracture darkens the edges after its tear in a real render", async (context) => {
  if (!(await available())) return context.skip("Chromium or FFmpeg is unavailable.");
  const scene = (id: string, extra: Partial<Project["nodes"][number]>): Project["nodes"][number] =>
    ({ id, type: "dialogue", label: id, text: "…", backgroundId: "pale", position: 50, ...extra }) as Project["nodes"][number];
  const project: Project = {
    ...createStarterProject(),
    theme: { ...DEFAULT_THEME, textbox: "minimal", textEffect: "instant" },
    backgrounds: [{ id: "pale", name: "Pale", src: svg("#808080") }],
    nodes: [
      scene("one", { audioDuration: 1.2, nextId: "two" }),
      scene("two", { fx: ["binding,50,50"], audioDuration: 3, nextId: "three" }),
      scene("three", { fx: ["fracture,50,50"], audioDuration: 3.2, nextId: "end" }),
      { ...scene("end", { audioDuration: 0.4 }), type: "end" } as Project["nodes"][number],
    ],
    startNodeId: "one",
  };
  const work = await mkdtemp(join(tmpdir(), "frame-render-ch12-"));
  try {
    const html = await exportRecordingHtml(project, { linePause: 300 });
    const htmlPath = join(work, "story.html");
    await writeFile(htmlPath, html);
    const outputPath = join(work, "story.mp4");
    const result = await renderRecording({
      htmlPath,
      outputPath,
      workDir: join(work, "scratch"),
      width: 640,
      height: 360,
      fps: 15,
      maxSeconds: 20,
    });
    assert.equal(result.recording.status, "done");
    assert.deepEqual(result.warnings, []);
    const at = (nodeId: string) => result.scenes.find((item) => item.nodeId === nodeId)!.seconds;
    // Mean brightness of a region of the frame at a time.
    const mean = async (seconds: number, crop: string) => {
      const frame = await run(
        "ffmpeg",
        ["-v", "error", "-ss", seconds.toFixed(3), "-i", outputPath, "-frames:v", "1", "-vf", `crop=${crop},scale=1:1:flags=area`, "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        { encoding: "buffer" },
      );
      return (frame.stdout as unknown as Buffer)[0];
    };
    // The ring round the point: at its tightest and brightest at 1.2 s, gone by its end.
    const ring = "64:24:288:168";
    const binding = at("two");
    const bindingBefore = await mean(binding - 0.3, ring);
    const bindingPeak = await mean(binding + 1.2, ring);
    const bindingAfter = await mean(binding + 2.75, ring);
    assert.ok(bindingPeak > bindingBefore + 12, `binding ${bindingBefore} → ${bindingPeak}`);
    assert.ok(Math.abs(bindingAfter - bindingBefore) <= 3, `binding after ${bindingAfter}`);
    // The corner of the frame: dark green just after the tear, clear again when it ends.
    const corner = "48:48:0:0";
    const fracture = at("three");
    const edgeBefore = await mean(fracture - 0.2, corner);
    const edgeDark = await mean(fracture + 1.3, corner);
    const edgeAfter = await mean(fracture + 3, corner);
    assert.ok(edgeDark < edgeBefore - 20, `fracture edge ${edgeBefore} → ${edgeDark}`);
    assert.ok(Math.abs(edgeAfter - edgeBefore) <= 3, `fracture edge after ${edgeAfter}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test("raindrops on the glass fade in, keep sliding and render identically twice", async (context) => {
  if (!(await available())) return context.skip("Chromium or FFmpeg is unavailable.");
  const scene = (id: string, extra: Partial<Project["nodes"][number]>): Project["nodes"][number] =>
    ({ id, type: "dialogue", label: id, text: "…", backgroundId: "dusk", position: 50, ...extra }) as Project["nodes"][number];
  const project: Project = {
    ...createStarterProject(),
    theme: { ...DEFAULT_THEME, textbox: "minimal", textEffect: "instant" },
    backgrounds: [{ id: "dusk", name: "Dusk", src: svg("#5a6a80") }],
    nodes: [
      // Long enough for the opening fade to finish before the rain starts.
      scene("one", { audioDuration: 2, nextId: "two" }),
      scene("two", { weather: "raindrops", audioDuration: 6, nextId: "end" }),
      { ...scene("end", { audioDuration: 0.4 }), type: "end" } as Project["nodes"][number],
    ],
    startNodeId: "one",
  };
  const work = await mkdtemp(join(tmpdir(), "frame-render-raindrops-"));
  try {
    const html = await exportRecordingHtml(project, { linePause: 300 });
    const htmlPath = join(work, "story.html");
    await writeFile(htmlPath, html);
    const frames = async (name: string) => {
      const outputPath = join(work, `${name}.mp4`);
      const result = await renderRecording({
        htmlPath,
        outputPath,
        workDir: join(work, `scratch-${name}`),
        width: 320,
        height: 180,
        fps: 15,
        maxSeconds: 20,
      });
      assert.equal(result.recording.status, "done");
      assert.deepEqual(result.warnings, []);
      const start = result.scenes.find((item) => item.nodeId === "two")!.seconds;
      const grab = async (seconds: number) =>
        (
          await run(
            "ffmpeg",
            ["-v", "error", "-ss", seconds.toFixed(3), "-i", outputPath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
            { encoding: "buffer", maxBuffer: 1 << 24 },
          )
        ).stdout as unknown as Buffer;
      return Promise.all([start - 0.3, start + 0.2, start + 3, start + 4.5].map(grab));
    };
    // Share of pixels above the text box that changed by more than a few levels.
    const changed = (a: Buffer, b: Buffer) => {
      const area = 640 * 240;
      let count = 0;
      for (let index = 0; index < area; index++) if (Math.abs(a[index] - b[index]) > 6) count++;
      return count / area;
    };
    const [before, early, full, later] = await frames("first");
    // Faint while it fades in, then sparse drops: visible, but most of the frame stays clear.
    assert.ok(changed(before, early) < changed(before, full), `fades in ${changed(before, early)} < ${changed(before, full)}`);
    assert.ok(changed(before, full) > 0.003, `drops ${changed(before, full)}`);
    assert.ok(changed(before, full) < 0.12, `sparse ${changed(before, full)}`);
    // Drops keep appearing, drying and sliding.
    assert.ok(changed(full, later) > 0.002, `moving ${changed(full, later)}`);
    // A second render draws the same glass, frame for frame. Renders without effects already
    // differ by background raster noise, which the encoder can turn into a few stray pixels.
    const again = await frames("second");
    for (const [index, frame] of [before, early, full, later].entries())
      assert.ok(changed(frame, again[index]) < 0.001, `frame ${index} differs`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
