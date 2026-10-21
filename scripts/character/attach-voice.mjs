#!/usr/bin/env node
/** Attach an already-generated, already-aligned local recording. No provider calls. */
import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { validatePackedCharacter } from "./validate.mjs";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const load = async (dir, name) =>
  JSON.parse(await readFile(path.join(dir, name), "utf8"));
const save = (dir, name, data) =>
  writeFile(path.join(dir, name), JSON.stringify(data, null, 2) + "\n");

export async function attachVoice({
  packDirectory,
  audioFile,
  cueFile,
  voiceId,
}) {
  const [catalog, cues, audioBytes] = await Promise.all([
    load(packDirectory, "catalog.json"),
    JSON.parse(await readFile(cueFile, "utf8")),
    readFile(audioFile),
  ]);
  const sourceSha256 = hash(audioBytes);
  if (
    cues.metadata?.sourceSha256 &&
    cues.metadata.sourceSha256 !== sourceSha256
  )
    throw new Error(
      "Cue sidecar was generated from a different audio recording.",
    );
  if (
    !Array.isArray(cues.mouthCues) ||
    !cues.mouthCues.length ||
    cues.mouthCues.some(
      (c, i, list) =>
        !Number.isFinite(c.start) ||
        !Number.isFinite(c.end) ||
        c.start < 0 ||
        c.end <= c.start ||
        !/^[A-FX]$/.test(c.value) ||
        (i && c.start < list[i - 1].end),
    )
  )
    throw new Error(
      "Sidecar needs sorted non-overlapping real A–F/X mouth cues.",
    );
  const character = catalog.characters[0],
    root = character.poses[0].animation.assetRoot;
  const extension = path.extname(audioFile).toLowerCase();
  if (![".mp3", ".wav", ".ogg", ".opus", ".m4a"].includes(extension))
    throw new Error("Unsupported recording format.");
  const filename = "sample" + extension,
    src = root + "/" + filename,
    cueUrl = root + "/sample.cues.json";
  await copyFile(audioFile, path.join(packDirectory, filename));
  if (hash(await readFile(path.join(packDirectory, filename))) !== sourceSha256)
    throw new Error("Recording copy was not byte-identical.");
  const rewritten = {
    ...cues,
    metadata: {
      ...cues.metadata,
      originalSoundFile:
        cues.metadata?.originalSoundFile || cues.metadata?.soundFile,
      soundFile: src,
      sourceSha256,
    },
  };
  await save(packDirectory, "sample.cues.json", rewritten);
  const speech = await load(packDirectory, "speech.json");
  speech.lines[src] = cueUrl;
  await save(packDirectory, "speech.json", speech);
  character.voice = { src, cueUrl };
  if (voiceId) character.voiceId = voiceId;
  await save(packDirectory, "catalog.json", catalog);
  const provenance = await load(packDirectory, "provenance.json");
  provenance.files[filename] = sourceSha256;
  provenance.files["sample.cues.json"] = hash(
    await readFile(path.join(packDirectory, "sample.cues.json")),
  );
  provenance.voice = {
    sourceSha256,
    originalCueSha256: hash(await readFile(cueFile)),
    duration: cues.metadata?.duration,
    voiceId: voiceId || null,
  };
  await save(packDirectory, "provenance.json", provenance);
  const validation = await validatePackedCharacter(packDirectory);
  if (!validation.valid) throw new Error(validation.errors.join("\n"));
  const previous = await load(packDirectory, "validation.json");
  previous.checks = {
    ...previous.checks,
    ...validation.checks,
    voiceAudioByteIdentical: true,
    voiceCueCount: cues.mouthCues.length,
  };
  await save(packDirectory, "validation.json", previous);
  return {
    voice: character.voice,
    sourceSha256,
    cues: cues.mouthCues.length,
    duration: cues.metadata?.duration,
  };
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const a = process.argv.slice(2),
    get = (k) => a[a.indexOf("--" + k) + 1];
  try {
    if (
      !a.includes("--pack") ||
      !a.includes("--audio") ||
      !a.includes("--cues")
    )
      throw new Error(
        "Usage: attach-voice.mjs --pack directory --audio recording.mp3 --cues recording.cues.json [--voice-id ID]",
      );
    console.log(
      JSON.stringify(
        await attachVoice({
          packDirectory: path.resolve(get("pack")),
          audioFile: path.resolve(get("audio")),
          cueFile: path.resolve(get("cues")),
          voiceId: a.includes("--voice-id") ? get("voice-id") : undefined,
        }),
      ),
    );
  } catch (error) {
    console.error(JSON.stringify({ valid: false, errors: [error.message] }));
    process.exitCode = 1;
  }
}
