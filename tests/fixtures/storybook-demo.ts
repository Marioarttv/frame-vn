/**
 * A short story exercising the storybook presentation: the grimoire text box, the quill text
 * effect with word-synced timings, a title card, screen effects ({fx=…} and a scene's `fx`),
 * the new atmospheres, music ducking under voice lines and sound effects. Audio is generated
 * tones and the art is the distributable starter art, so it can be exported and rendered
 * anywhere (scripts/storybook-demo.ts).
 */
import { spokenWords, type Project } from "../../src/engine";

/** A mono 16-bit PCM WAV as a data URL: a steady tone, or a decaying pluck. */
export function toneWav(frequency: number, seconds: number, amplitude = 0.3, pluck = false): string {
  const rate = 16000;
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
  for (let index = 0; index < samples; index++) {
    const t = index / rate;
    const envelope = pluck
      ? Math.exp(-t * 7)
      : Math.min(1, t / 0.02, (seconds - t) / 0.02);
    const value = Math.sin(2 * Math.PI * frequency * t) * amplitude * envelope;
    data.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
  }
  return `data:audio/wav;base64,${data.toString("base64")}`;
}

/** Evenly spaced word starts, as Whisper word timestamps would provide them. */
function timings(text: string, start = 0.15, step = 0.32): number[] {
  return spokenWords(text).map((_, index) => Number((start + index * step).toFixed(2)));
}

function voiced(text: string, frequency: number) {
  const words = spokenWords(text).length;
  const duration = Number((0.3 + words * 0.32).toFixed(2));
  return {
    text,
    audioSrc: toneWav(frequency, duration, 0.28),
    audioDuration: duration,
    textTimings: timings(text),
  };
}

export function createStorybookDemo(): Project {
  const lines = {
    corridor: "The corridor was quiet, *too* quiet; golden dust drifted through the light.",
    glint: "Did you see that?{fx=glint,63,27} Even the portraits are {in=quill}whispering{/in}.{sfx=Chime}",
    glass: "The ground beneath her feet felt like thin glass{fx=crack}… cracking… splintering apart.",
    magic: "{fx=sparkle,30,42}Magic. Real {wave}magic{/wave}.",
  };
  return {
    schemaVersion: 3,
    id: "storybook-demo",
    title: "The Storybook Demo",
    description: "Grimoire pages, an enchanted quill and a few screen effects.",
    startNodeId: "title",
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
    characters: [
      {
        id: "mira",
        name: "Mira",
        color: "#7fb5a0",
        poses: [{ id: "neutral", name: "Everyday", src: "/assets/characters/mira.svg" }],
      },
      {
        id: "noah",
        name: "Noah",
        color: "#c1a887",
        poses: [{ id: "neutral", name: "Everyday", src: "/assets/characters/noah.svg" }],
      },
    ],
    backgrounds: [
      { id: "hall", name: "Hall", src: "/assets/backgrounds/night.svg" },
      { id: "corridor", name: "Corridor", src: "/assets/backgrounds/atrium.svg" },
    ],
    variables: [],
    sounds: [
      { id: "theme", name: "Theme", src: toneWav(196, 2.4, 0.22), kind: "music" },
      { id: "chime", name: "Chime", src: toneWav(1320, 0.6, 0.35, true), kind: "sfx" },
    ],
    nodes: [
      {
        id: "title",
        type: "dialogue",
        label: "Title",
        text: "Chapter One · The Diary",
        textbox: "title",
        backgroundId: "hall",
        weather: "candles",
        grade: "night",
        musicId: "theme",
        position: 50,
        nextId: "corridor",
      },
      {
        id: "corridor",
        type: "dialogue",
        label: "Corridor",
        ...voiced(lines.corridor, 330),
        backgroundId: "corridor",
        weather: "motes",
        grade: "warm",
        transition: "dissolve",
        sfxId: "chime",
        position: 50,
        nextId: "glint",
      },
      {
        id: "glint",
        type: "dialogue",
        label: "Glint",
        ...voiced(lines.glint, 392),
        characterId: "mira",
        poseId: "neutral",
        position: 68,
        cast: [{ characterId: "noah", poseId: "neutral", position: 30 }],
        backgroundId: "corridor",
        weather: "magic",
        nextId: "glass",
      },
      {
        id: "glass",
        type: "dialogue",
        label: "Glass",
        ...voiced(lines.glass, 294),
        cast: [
          { characterId: "noah", poseId: "neutral", position: 30 },
          { characterId: "mira", poseId: "neutral", position: 68 },
        ],
        backgroundId: "corridor",
        weather: "smoke",
        grade: "cold",
        position: 50,
        nextId: "magic",
      },
      {
        id: "magic",
        type: "dialogue",
        label: "Magic",
        ...voiced(lines.magic, 440),
        characterId: "noah",
        poseId: "neutral",
        position: 30,
        cast: [{ characterId: "mira", poseId: "neutral", position: 68 }],
        backgroundId: "corridor",
        weather: "magic",
        nextId: "choice",
      },
      {
        id: "choice",
        type: "choice",
        label: "Choice",
        text: "Shall we follow the whispering?",
        characterId: "mira",
        poseId: "neutral",
        position: 68,
        cast: [{ characterId: "noah", poseId: "neutral", position: 30 }],
        backgroundId: "corridor",
        weather: "magic",
        choices: [
          { id: "follow", text: "Follow the voice into the dark.", nextId: "watching" },
          { id: "stay", text: "Stay where the candles still burn.", nextId: "watching" },
        ],
      },
      {
        id: "watching",
        type: "end",
        label: "Watching",
        text: "Something in the dark was watching.{fx=heartbeat}",
        fx: ["ink"],
        backgroundId: "hall",
        weather: "smoke",
        grade: "night",
        position: 50,
      },
    ],
  };
}
