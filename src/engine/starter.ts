import type { Project } from "./types";

export function createStarterProject(): Project {
  return {
    schemaVersion: 3,
    id: "first-light",
    title: "First Light",
    description:
      "A little conversation. Two possible paths. A place to begin your own story.",
    startNodeId: "arrival",
    characters: [
      {
        id: "mira",
        name: "Mira",
        color: "#a4b9aa",
        description:
          "Observant, curious, and always looking for the next story.",
        poses: [
          {
            id: "neutral",
            name: "Everyday",
            src: "/assets/characters/mira.svg",
          },
        ],
      },
      {
        id: "noah",
        name: "Noah",
        color: "#c1a887",
        description: "A quiet optimist with an eye for the unexpected.",
        poses: [
          {
            id: "neutral",
            name: "Everyday",
            src: "/assets/characters/noah.svg",
          },
        ],
      },
    ],
    backgrounds: [
      {
        id: "atrium",
        name: "The atrium",
        src: "/assets/backgrounds/atrium.svg",
      },
      {
        id: "night",
        name: "After hours",
        src: "/assets/backgrounds/night.svg",
      },
    ],
    nodes: [
      {
        id: "arrival",
        label: "A place to begin",
        type: "dialogue",
        text: "Every story begins with a small possibility. A place, a person, a moment worth staying for.",
        characterId: "mira",
        poseId: "neutral",
        backgroundId: "atrium",
        position: 65,
        nextId: "invitation",
      },
      {
        id: "invitation",
        label: "An open invitation",
        type: "choice",
        text: "We have the whole evening ahead of us. Where should we start?",
        characterId: "mira",
        poseId: "neutral",
        backgroundId: "atrium",
        position: 65,
        choices: [
          {
            id: "explore",
            text: "Let’s see what’s out there.",
            nextId: "outside",
          },
          {
            id: "stay",
            text: "Stay a little. Tell me a story.",
            nextId: "inside",
          },
        ],
      },
      {
        id: "outside",
        label: "The world outside",
        type: "dialogue",
        text: "Look up. Even familiar places feel different when you give them a second glance.",
        characterId: "noah",
        poseId: "neutral",
        backgroundId: "night",
        position: 35,
        nextId: "ending",
      },
      {
        id: "inside",
        label: "A story between us",
        type: "dialogue",
        text: "All right. But the best stories leave a little room for you to change them.",
        characterId: "mira",
        poseId: "neutral",
        backgroundId: "atrium",
        position: 65,
        nextId: "ending",
      },
      {
        id: "ending",
        label: "Your story starts here",
        type: "end",
        speaker: "First Light",
        text: "A beginning, not an ending. Make this story yours.",
        backgroundId: "night",
        position: 50,
      },
    ],
    variables: [],
    sounds: [],
  };
}

/** An empty story with one opening scene. Local pack characters are merged in by the studio. */
export function createBlankProject(id: string): Project {
  return {
    schemaVersion: 3,
    id,
    title: "Untitled story",
    description: "",
    startNodeId: "opening",
    nodes: [
      {
        id: "opening",
        label: "Opening",
        type: "dialogue",
        text: "",
        position: 50,
        nextId: null,
      },
    ],
    characters: [],
    backgrounds: [],
    variables: [],
    sounds: [],
  };
}
