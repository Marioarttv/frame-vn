/** Build a private full-cast chapter from an aligned recording, without generating voices. */
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  readdir,
} from "node:fs/promises";
import { resolve, dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  alignAudio,
  type CueSheet,
  type MouthCue,
} from "../../server/alignment";
import { exportStandaloneHtml } from "../../src/engine/export";
import { validateProject } from "../../src/engine/validation";
import { PORTRAIT_RUNTIME_SOURCE } from "../../src/animation/player-runtime.generated";
import type {
  ActorLight,
  BackgroundMotion,
  Character,
  ColorGrade,
  Project,
  StageActor,
  StoryNode,
  TextboxStyle,
  TextEffect,
  Theme,
  Transition,
  Weather,
} from "../../src/engine/types";

const run = promisify(execFile);
type Line = {
  id: string;
  speaker: string;
  text: string;
  direction: string;
  start: number;
  end: number;
  chunk: string;
  chunkStart: number;
  sourceLine: number;
  /** Start of each displayed word in master seconds (from scripts/chapter/align.py). */
  words?: number[];
};
type Config = {
  id: string;
  title: string;
  engineRoot: string;
  timeline: string;
  input: string;
  output: string;
  rhubarb: string;
  credit: string;
  creditLink: string;
  /** Text of the closing card; defaults to `credit`. */
  endCard?: string;
  /** Output file stem: <stem>.html, <stem>-engine.html, <stem>.frame.json (default "chapter-1"). */
  fileStem?: string;
  /** Optional staging script: backgrounds, music, sfx, expressions, camera and effects per line. */
  direction?: string;
  /** Optional per-line word start times (seconds from each clip's start) for word-synced text. */
  wordTimes?: string;
  roles: Record<
    string,
    {
      name: string;
      /** Omitted for a silent role (an animal, say): it never speaks. */
      voiceId?: string;
      packs?: string[];
      pose?: string;
      flip?: boolean;
      /** "cut" for separately drawn poses that cannot morph (see Character.expressionChange). */
      expressionChange?: "morph" | "cut";
      /**
       * Character IDs of packs drawn for this role later under their own ID (an expression pack
       * made after the first pose): their poses join the first pack's character. Without it,
       * every pack of a role must share one character ID.
       */
      aliases?: string[];
    }
  >;
};
type Tag = [word: string, markup: string];
type Cue = {
  text?: string;
  textbox?: string;
  textEffect?: string;
  bg?: string | null;
  music?: string | null;
  /** An ambience bed ID from direction.ambience; null fades it out. */
  ambience?: string | null;
  sfx?: string;
  weather?: string | null;
  grade?: string | null;
  motion?: string | null;
  camera?: { zoom: number; x: number; y: number } | null;
  /** A light preset name from direction.lights, or null for neutral. */
  light?: string | null;
  transition?: string;
  cast?: string[];
  expr?: Record<string, string>;
  enter?: Record<string, string>;
  exit?: Record<string, string>;
  emote?: Record<string, string>;
  shake?: "light" | "heavy";
  fx?: string[];
  tags?: Tag[];
  noTimings?: boolean;
  /** Cut this line's clip at this master time (seconds), e.g. to drop a spoken notice. */
  clipEnd?: number;
  /** Seconds of silence after a cut clip, so the scene can breathe before the next line. */
  hold?: number;
};
type Music = string | { src: string; loop?: boolean; volume?: number };
type Insert = Cue & { id: string; seconds: number };
type Direction = {
  media: string;
  backgrounds: Record<string, string>;
  music: Record<string, Music>;
  /** Looping beds (rain, wind) on their own channel; same entry shape as music. */
  ambience?: Record<string, Music>;
  sfx: string[];
  theme?: Record<string, unknown>;
  colors?: Record<string, string>;
  positions?: Record<string, number>;
  lights?: Record<string, ActorLight>;
  inserts?: Record<string, Insert>;
  /** The end card's music (an outro jingle) and ambience; null stops what was playing. */
  ending?: { music?: string | null; ambience?: string | null };
  lines: Record<string, Cue>;
};
const config: Config = JSON.parse(
  await readFile(resolve(process.argv[2]), "utf8"),
);
if (!/^[a-z0-9-]+$/.test(config.id))
  throw new Error("Use a simple lowercase chapter ID.");
const stem = config.fileStem ?? "chapter-1";
if (!/^[a-z0-9-]+$/.test(stem))
  throw new Error("Use a simple lowercase file stem.");
const root = resolve(config.engineRoot),
  output = resolve(config.output),
  pack = join(root, "public/local-packs", config.id),
  url = `/local-packs/${config.id}`;
const timeline = JSON.parse(await readFile(config.timeline, "utf8"));
const direction: Direction | undefined = config.direction
  ? JSON.parse(await readFile(config.direction, "utf8"))
  : undefined;
const wordTimes: Record<string, number[]> = config.wordTimes
  ? JSON.parse(await readFile(config.wordTimes, "utf8"))
  : {};
const input = JSON.parse(await readFile(config.input, "utf8"));
const lines: Line[] = timeline.lines;
const audioBytes = await readFile(timeline.masterAudio);
if (
  createHash("sha256").update(audioBytes).digest("hex") !==
  timeline.masterSha256
)
  throw new Error("The aligned recording changed.");
await mkdir(join(pack, "audio"), { recursive: true });
await mkdir(join(pack, "cues"), { recursive: true });
await mkdir(join(output, "verification"), { recursive: true });
await mkdir(join(output, "work"), { recursive: true });
await copyFile(timeline.masterAudio, join(pack, "chapter.mp3"));
const characters: Character[] = [];
const roleIds: Record<string, string> = {};
for (const [role, spec] of Object.entries(config.roles)) {
  if (!spec.packs?.length) continue;
  let character: Character | undefined;
  for (const name of spec.packs) {
    const catalog = JSON.parse(
      await readFile(
        join(root, "public/local-packs", name, "catalog.json"),
        "utf8",
      ),
    );
    const source: Character = catalog.characters[0];
    if (!character)
      character = {
        ...source,
        name: spec.name,
        color: direction?.colors?.[role] ?? source.color,
        ...(spec.voiceId ? { voiceId: spec.voiceId } : {}),
        ...(spec.expressionChange ? { expressionChange: spec.expressionChange } : {}),
        poses: [],
      };
    if (character.id !== source.id && !spec.aliases?.includes(source.id))
      throw new Error(
        `All poses for one role must share a character ID (${role}: ${source.id} is not ${character.id} ` +
          "or one of the role's aliases).",
      );
    for (const pose of source.poses)
      if (character.poses.some((p) => p.id === pose.id))
        throw new Error(`${role}: pose ID ${pose.id} appears in two packs.`);
    character.poses.push(...source.poses);
  }
  characters.push(character!);
  roleIds[role] = character!.id;
}
if (!characters.length)
  throw new Error("A chapter needs at least one illustrated role.");
for (const line of lines)
  if (config.roles[line.speaker] && !config.roles[line.speaker].voiceId)
    throw new Error(`${line.id}: the silent role "${line.speaker}" cannot speak a line.`);
const sheets: Record<string, CueSheet> = {};
// Bound local recognizer concurrency; reuse source/transcript-verified results.
const jobs = [...input.chunks];
await Promise.all(
  Array.from({ length: 2 }, async () => {
    while (jobs.length) {
      const chunk = jobs.shift();
      const destination = join(output, "work", `${chunk.key}.cues.json`);
      const text = chunk.inputs
        .map((item: { text: string }) => item.text)
        .join(" ");
      const sourceHash = createHash("sha256")
        .update(await readFile(chunk.audio))
        .digest("hex");
      const textHash = createHash("sha256")
        .update(
          text
            .replace(/\[[^\]\r\n]*\]/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .digest("hex");
      try {
        const cached: CueSheet = JSON.parse(
          await readFile(destination, "utf8"),
        );
        if (
          cached.metadata.sourceSha256 !== sourceHash ||
          cached.metadata.transcriptSha256 !== textHash
        )
          throw new Error("Stale cues");
        sheets[chunk.key] = cached;
        continue;
      } catch {
        /* A missing/stale local alignment is safe to recompute. */
      }
      console.log("Lip sync:", chunk.key);
      const sheet = await alignAudio(
        {
          audioPath: chunk.audio,
          audioSrc: `take-${chunk.key}.mp3`,
          text,
          languageCode: "en",
        },
        { ffmpeg: "ffmpeg", ffprobe: "ffprobe", rhubarb: config.rhubarb },
      );
      await writeFile(destination, JSON.stringify(sheet));
      sheets[chunk.key] = sheet;
    }
  }),
);

function append(
  cues: MouthCue[],
  start: number,
  end: number,
  value: MouthCue["value"],
) {
  if (end <= start) return;
  const last = cues.at(-1);
  if (last && last.value === value && Math.abs(last.end - start) < 0.001)
    last.end = end;
  else cues.push({ start, end, value });
}
const duration: number = timeline.masterDuration;
const actorCues: Record<string, MouthCue[]> = Object.fromEntries(
  Object.keys(roleIds).map((role) => [role, []]),
);
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const source = sheets[line.chunk];
  const chunk = input.chunks.find((c: { key: string }) => c.key === line.chunk);
  const origin = input.musicOffset + chunk.offset;
  for (const [role, cues] of Object.entries(actorCues)) {
    append(cues, cues.at(-1)?.end ?? 0, line.start, "X");
    if (role === line.speaker) {
      for (const cue of source.mouthCues)
        append(
          cues,
          Math.max(line.start, origin + cue.start),
          Math.min(line.end, origin + cue.end),
          cue.value,
        );
    } else append(cues, line.start, line.end, "X");
  }
}
for (const [role, cues] of Object.entries(actorCues)) {
  append(cues, cues.at(-1)?.end ?? 0, duration, "X");
  await writeFile(
    join(pack, "cues", `${role}-chapter.json`),
    JSON.stringify({
      metadata: { duration, soundFile: `${url}/chapter.mp3` },
      mouthCues: cues,
    }),
  );
}
const nodes: StoryNode[] = [];
const firstAppearance = Object.fromEntries(
  Object.keys(roleIds).map((role) => [
    role,
    lines.findIndex((line) => line.speaker === role),
  ]),
);
/** Sticky staging: every node describes its complete stage, built from the cues so far. */
const stage = {
  bg: null as string | null,
  weather: null as string | null,
  grade: null as string | null,
  motion: null as string | null,
  camera: null as Cue["camera"],
  light: null as string | null,
  cast: undefined as string[] | undefined,
  expr: {} as Record<string, string>,
};
const roleOrder = Object.keys(roleIds);
const poseFor = (role: string) => {
  const character = characters.find((c) => c.id === roleIds[role])!;
  const wanted = stage.expr[role] ?? config.roles[role].pose ?? "front";
  const pose =
    character.poses.find((p) => p.name === wanted) ??
    character.poses.find((p) => p.name === (config.roles[role].pose ?? "front"))!;
  return pose.id;
};
const norm = (word: string) => word.toLowerCase().replace(/[^a-z0-9']/g, "");
function applyTags(text: string, tags: Tag[] | undefined) {
  if (!tags?.length) return text;
  const words = text.split(/(\s+)/);
  for (const [word, markup] of tags) {
    const i = words.findIndex((w, k) => k % 2 === 0 && norm(w).startsWith(norm(word)));
    if (i < 0) throw new Error(`Direction tag word not found: ${word} in "${text}"`);
    words[i] = markup + words[i];
  }
  return words.join("");
}
function stageNode(cue: Cue | undefined, index: number, speakerRole?: string) {
  if (cue?.bg !== undefined) stage.bg = cue.bg;
  if (cue?.weather !== undefined) stage.weather = cue.weather;
  if (cue?.grade !== undefined) stage.grade = cue.grade;
  if (cue?.motion !== undefined) stage.motion = cue.motion;
  if (cue?.camera !== undefined) stage.camera = cue.camera;
  if (cue?.light !== undefined) stage.light = cue.light;
  else if (cue?.bg && direction?.lights?.[cue.bg]) stage.light = cue.bg;
  if (cue?.cast !== undefined) stage.cast = cue.cast;
  Object.assign(stage.expr, cue?.expr ?? {});
  const onStage = (stage.cast ??
    roleOrder.filter((role) => role === roleOrder[0] || index >= firstAppearance[role]))
    .filter((role) => roleIds[role]);
  const actor = (role: string) => ({
    characterId: roleIds[role],
    poseId: poseFor(role),
    position: direction?.positions?.[role] ?? (role === roleOrder[0] ? 28 : 72),
    flip: config.roles[role].flip ?? false,
    scale: 0.94,
    enter: (cue?.enter?.[role] ?? "none") as StageActor["enter"],
    ...(cue?.exit?.[role] ? { exit: cue.exit[role] as StageActor["exit"] } : {}),
    ...(cue?.emote?.[role] ? { emote: cue.emote[role] as StageActor["emote"] } : {}),
  });
  const speaking = speakerRole && onStage.includes(speakerRole) ? actor(speakerRole) : undefined;
  return {
    ...(speaking ?? {}),
    position: speaking?.position ?? 50,
    cast: onStage.filter((role) => role !== speakerRole).map(actor),
    ...(stage.bg ? { backgroundId: stage.bg } : {}),
    ...(stage.weather ? { weather: stage.weather as Weather } : {}),
    ...(stage.grade ? { grade: stage.grade as ColorGrade } : {}),
    ...(stage.motion ? { backgroundMotion: stage.motion as BackgroundMotion } : {}),
    ...(stage.camera ? { camera: stage.camera } : {}),
    ...(stage.light && direction?.lights?.[stage.light] ? { light: direction.lights[stage.light] } : {}),
    ...(cue?.music !== undefined ? { musicId: cue.music } : {}),
    ...(cue?.ambience !== undefined ? { ambienceId: cue.ambience } : {}),
    ...(cue?.sfx ? { sfxId: `sfx-${cue.sfx}` } : {}),
    ...(cue?.shake ? { shake: cue.shake } : {}),
    ...(cue?.fx ? { fx: cue.fx } : {}),
    ...(cue?.textbox ? { textbox: cue.textbox as TextboxStyle } : {}),
    ...(cue?.textEffect ? { textEffect: cue.textEffect as TextEffect } : {}),
    transition: (cue?.transition ?? "cut") as Transition,
  };
}
for (let i = 0; i < lines.length; i++) {
  const line = lines[i],
    cue = direction?.lines[line.id],
    start = i === 0 ? 0 : line.start,
    natural = i === lines.length - 1 ? duration : lines[i + 1].start,
    cut = cue?.clipEnd !== undefined && cue.clipEnd > start && cue.clipEnd < natural,
    hold = cut ? Math.max(0, cue?.hold ?? 0) : 0,
    end = cut ? cue!.clipEnd! : natural;
  const clip = join(pack, "audio", `${line.id}.mp3`);
  await run(
    "ffmpeg",
    [
      "-nostdin",
      "-v",
      "error",
      "-y",
      "-i",
      timeline.masterAudio,
      // A cut clip ends with a short fade and then holds in silence.
      ...(cut
        ? [
            "-af",
            `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,` +
              `afade=t=out:st=${Math.max(0, end - start - 0.12)}:d=0.12,apad=pad_dur=${hold}`,
          ]
        : // A fractional cut can leave the decoder with an unpadded plane, which the MP3
          // encoder rejects; converting to padded signed-16 planar keeps timing exact.
          ["-ss", String(start), "-t", String(end - start), "-af", "aformat=sample_fmts=s16p"]),
      "-map_metadata",
      "-1",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "128k",
      clip,
    ],
    { timeout: 120000 },
  );
  const fullCues = actorCues[line.speaker] ?? [
      { start: 0, end: duration, value: "X" as const },
    ],
    cues: MouthCue[] = [];
  for (const mouth of fullCues)
    append(
      cues,
      Math.max(start, mouth.start) - start,
      Math.min(end, mouth.end) - start,
      mouth.value,
    );
  append(cues, end - start, end - start + hold, "X");
  const audioSrc = `${url}/audio/${line.id}.mp3`,
    cueUrl = `${url}/cues/${line.id}.json`;
  await writeFile(
    join(pack, "cues", `${line.id}.json`),
    JSON.stringify({
      metadata: { duration: end - start + hold, soundFile: audioSrc },
      mouthCues: cues,
    }),
  );
  const insert = direction?.inserts?.[line.id];
  if (insert) {
    nodes.push({
      id: insert.id,
      type: "dialogue",
      label: insert.text?.replace(/\n/g, " · ") ?? insert.id,
      text: insert.text ?? "",
      ...stageNode(insert, i),
      audioDuration: insert.seconds,
      textEffect: (insert.textEffect ?? "fade") as TextEffect,
      nextId: line.id,
    } as StoryNode);
    if (nodes.length > 1) (nodes[nodes.length - 2] as { nextId: string }).nextId = insert.id;
  }
  const characterId = roleIds[line.speaker];
  const text = applyTags(cue?.text ?? line.text, cue?.tags);
  // The aligner's word starts follow its own cuts; a wordTimes file serves older timelines.
  const timings =
    cue?.noTimings || cue?.text
      ? undefined
      : (line.words?.map((t) => Math.max(0, Math.round((t - start) * 1000) / 1000)) ??
        wordTimes[line.id]);
  nodes.push({
    id: line.id,
    type: "dialogue",
    label: `${config.roles[line.speaker]?.name ?? line.speaker} · ${i + 1}`,
    text,
    ...(characterId || config.roles[line.speaker]?.name !== "Narrator"
      ? { speaker: config.roles[line.speaker]?.name ?? line.speaker }
      : {}),
    ...stageNode(cue, i, characterId ? line.speaker : undefined),
    audioSrc,
    cueUrl,
    audioDuration: end - start + hold,
    ...(timings ? { textTimings: timings } : {}),
    ...(direction ? {} : { textEffect: "instant" as const }),
    nextId: i === lines.length - 1 ? "ending" : lines[i + 1].id,
  } as StoryNode);
}
nodes.push({
  id: "ending",
  type: "end",
  label: "End of chapter",
  text: config.endCard ?? config.credit,
  position: 50,
  transition: "fade",
  ...(direction && stage.bg ? { backgroundId: stage.bg } : {}),
  ...(direction?.ending?.music !== undefined ? { musicId: direction.ending.music } : {}),
  ...(direction?.ending?.ambience !== undefined ? { ambienceId: direction.ending.ambience } : {}),
});
const project: Project = {
  schemaVersion: 3,
  id: config.id,
  title: config.title,
  description: config.credit,
  startNodeId: lines[0].id,
  nodes,
  characters,
  backgrounds: direction
    ? Object.entries(direction.backgrounds).map(([id, src]) => ({
        id,
        name: id,
        src: `/local-packs/${direction.media}/${src}`,
      }))
    : [],
  variables: [],
  sounds: direction
    ? [
        ...Object.entries(direction.music).map(([id, entry]) => {
          const music = typeof entry === "string" ? { src: entry } : entry;
          return {
            id,
            name: id,
            src: `/local-packs/${direction.media}/${music.src}`,
            kind: "music" as const,
            ...(music.loop === false ? { loop: false } : {}),
            ...(music.volume !== undefined ? { volume: music.volume } : {}),
          };
        }),
        ...Object.entries(direction.ambience ?? {}).map(([id, entry]) => {
          const bed = typeof entry === "string" ? { src: entry } : entry;
          return {
            id,
            name: id,
            src: `/local-packs/${direction.media}/${bed.src}`,
            kind: "ambience" as const,
            ...(bed.loop === false ? { loop: false } : {}),
            ...(bed.volume !== undefined ? { volume: bed.volume } : {}),
          };
        }),
        ...direction.sfx.map((id) => ({
          id: `sfx-${id}`,
          name: id,
          src: `/local-packs/${direction.media}/sfx/${id}.mp3`,
          kind: "sfx" as const,
        })),
      ]
    : [],
  theme: {
    textbox: "cinematic",
    textEffect: "instant",
    textSpeed: 42,
    font: "serif",
    accent: "#d2bb86",
    focus: "dim",
    expressionChange: "cut",
    ...(direction?.theme as Partial<Theme> | undefined),
  },
};
const validation = validateProject(project);
await writeFile(
  join(output, "verification", "project-validation.json"),
  JSON.stringify(
    validation.valid
      ? { valid: true, warnings: validation.warnings }
      : { valid: false, errors: validation.errors },
    null,
    2,
  ),
);
if (!validation.valid) throw new Error(JSON.stringify(validation.errors));
await mkdir(join(pack, "stories"), { recursive: true });
await writeFile(
  join(pack, "stories", "chapter.json"),
  JSON.stringify(project, null, 2),
);
await writeFile(
  join(pack, "catalog.json"),
  JSON.stringify(
    {
      version: 1,
      id: config.id,
      name: config.title,
      localOnly: true,
      characters: [],
      stories: [
        {
          id: config.id,
          name: config.title,
          src: `${url}/stories/chapter.json`,
        },
      ],
    },
    null,
    2,
  ),
);
const mime: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".mp3": "audio/mpeg",
  ".svg": "image/svg+xml",
};
const resolveAsset = async (src: string) => {
  if (!src.startsWith("/local-packs/"))
    throw new Error(`Unexpected chapter asset: ${src}`);
  const file = resolve(root, "public", "." + src);
  if (!file.startsWith(join(root, "public/local-packs") + "/"))
    throw new Error("Asset leaves private pack directory");
  return `data:${mime[extname(file)]};base64,${(await readFile(file)).toString("base64")}`;
};
console.log("Exporting engine player");
const exported = await exportStandaloneHtml(project, { resolveAsset });
await writeFile(join(output, `${stem}-engine.html`), exported);
// Editable project for this studio; its installed private packs supply the media.
await writeFile(
  join(output, `${stem}.frame.json`),
  JSON.stringify(project, null, 2),
);
const assets: Record<string, string> = {};
for (const spec of Object.values(config.roles))
  for (const name of spec.packs ?? []) {
    for (const file of await readdir(join(root, "public/local-packs", name)))
      if (/\.(png|json)$/.test(file)) {
        const src = `/local-packs/${name}/${file}`;
        assets[src] = await resolveAsset(src);
      }
  }
const audio = await resolveAsset(`${url}/chapter.mp3`);
const data = {
  title: config.title,
  credit: config.credit,
  creditLink: config.creditLink,
  duration,
  lines,
  characters,
  roles: config.roles,
  roleIds,
  firstAppearance,
  assets,
  audio,
  actorCues,
};
const template = await readFile(
  join(dirname(fileURLToPath(import.meta.url)), "player.html"),
  "utf8",
);
const html = template
  .replace(
    "/*__RUNTIME__*/",
    PORTRAIT_RUNTIME_SOURCE.replaceAll("</script", "<\\/script"),
  )
  .replace("/*__DATA__*/", JSON.stringify(data).replaceAll("<", "\\u003c"));
await writeFile(join(output, `${stem}.html`), html);
await writeFile(
  join(output, "line-index.tsv"),
  [
    "id\tspeaker\tstart\tend\tsourceLine\tdirection",
    ...lines.map((l) =>
      [l.id, l.speaker, l.start, l.end, l.sourceLine, l.direction].join("\t"),
    ),
  ].join("\n"),
);
console.log(
  JSON.stringify({
    utterances: lines.length,
    characters: characters.length,
    duration,
    preview: join(output, `${stem}.html`),
    engineExport: join(output, `${stem}-engine.html`),
    project: join(output, `${stem}.frame.json`),
  }),
);
