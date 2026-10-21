# Architecture

The studio has four independent boundaries:

| Area              | Responsibility                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/engine/`     | Versioned project data, structural and playback validation, branching/history, safe draft storage, portable exports |
| `src/animation/`  | Per-portrait rendering and audio clocks; reusable calibrated assets; cancellation/disposal and accessibility        |
| `server/`         | Local authenticated authoring requests, ElevenLabs v4 generation, Rhubarb alignment, character-pack compilation     |
| `src/components/` | Library, animation experiments, scene authoring, rig builder, and player UI                                         |

## Storyboard

`src/views/Storyboard.tsx` composes the live stage (the player in stage mode, inside an iframe), the line editor, the shot or person inspector and the filmstrip from `src/components/board/`. Edits go through pure helpers in `src/engine/storyboard.ts`: `setSpeaker` swaps a listener into the speaker slot (the former speaker stays on stage), `addToShot`/`removeFromShot`/`placeActor` edit the speaker and cast uniformly, `insertShot` continues the stage, and `moveShot` relinks dialogue when a shot moves in the reading order. The stage reports drags, drops from the cast dock (HTML drag and drop into the iframe), selection and double-clicks by `postMessage`; with `fromNodeId` it shows the previous shot and then plays the change into the current one.

## Local data

IndexedDB contains one record per project plus a content-addressed asset store: imported images and audio are Blobs keyed by SHA-256 and referenced from projects as `asset:<hash>`. Autosave rewrites only the small project record. Unreferenced assets older than a day are collected at startup, and the studio asks the browser for persistent storage. Version 1 workspaces (one record with inline data URLs) migrate automatically on first load. `.studio/voice/` contains generated recordings, cues, and a persistent generation-attempt ledger. `.studio/characters/` retains immutable uploaded authoring sources and build records. `public/local-packs/` contains optional published-to-this-machine runtime packs. All filesystem data is Git-ignored.

A successful save is displayed only after IndexedDB commits. Safe unfinished drafts can be saved and backed up; strict graph validation applies to playback and playable export. Import errors do not replace the open project.

The original starter assets under `public/assets/` are the only media copied by the distributable studio build. Code builds never collect arbitrary source `public/` trees.

## Animation

The inherited facial compositor has been extracted from its original singleton/scene implementation into independent controller instances. Each receives an element, character, pose, settings, and an optional asset resolver. Audio seek time drives phoneme interpolation; speech energy drives small coordinated body/brow/cheek/jaw responses. Idle blink and breathing have separate lifecycles.

A pose explicitly declares its authored capabilities. Original open-eye and mouth-rest pixels form the neutral state. Generated artwork is confined to calibrated regions. A static image remains complete if its optional animation pack fails. Reduced motion restores the neutral state for unnecessary movement, and disposal cancels pending work and releases GPU resources.

The story player is shared by exported games, the studio preview, the scene editor's live stage and the video renderer; they run the same generated document in different modes (`export`, `preview`, `stage`, `record`). It is split into modules: `runtime.ts` (story flow, input, saves, modes), `stage.ts` (two alternating background layers with WAAPI transitions, slow background motion, camera framing, shakes and screen covers), `actors.ts` (placement, entrances, exits, gestures, and expression changes whose new face keeps following the same voice line), `morph.ts` (landmark-driven expression morphs: a Delaunay mesh over both poses' lips, eyelids, irises and brow centre lines, staggered per region, with a head transform for differently framed portraits and a per-region fallback when a mesh would fold), `text.ts` (inline direction, per-glyph reveal effects and voice-synced pacing), `weather.ts` (one seeded canvas for all atmosphere, so playback and video renders are identical) and `style.ts` (nine text boxes and the effect keyframes, sized in container units so 720p, 1080p and a browser window share one composition). In stage mode the studio posts the current project and scene to the frame on every edit and receives drag, depth and selection messages back. Story rules (variables, branches, history) come from `src/engine/player.ts`; the player only renders. The exported player's controller is bundled from the same source as the studio. A resolver maps original asset identifiers to embedded data URLs without changing audio/cue identity. The export pipeline collects the selected poses' dependency closure and fails if a required embedded asset is unavailable.

## Authoring requests

All API mutations require loopback access, a matching Origin, and a per-server session token. This prevents an unrelated website from invoking paid authoring through the local browser. API keys are read server-side and never returned. The threat model is a single-user local studio, not untrusted users sharing a public server.

Voice generation is content-addressed by model, voice, text, settings, and pipeline version. A durable attempt is claimed before a paid request. Completed audio can be realigned without generating it again. Failures with uncertain billing stay visible instead of being silently retried.

Character generation in this build means **packing edited source artwork**, not remotely generating a new portrait. Image editing is a separate creative step. The builder accepts opaque uploaded asset identifiers, source-pixel calibration, and a fixed recipe; it does not run client-supplied commands or read arbitrary file paths.

## Extension boundaries

New animation techniques should implement the portrait-controller interface or a separate adapter behind it. Keep story data independent of renderer state. Export support and lifecycle tests are required when adding an adapter. Live2D, Spine, and Inochi2D are researched integration options, not bundled dependencies or compatibility claims.

Each scene has one speaker and up to five further characters on stage. It does not include the source game's cooperative puzzle logic, research telemetry, multiplayer sessions, or account configuration. Multiple independent portrait instances are supported by the renderer and exercised in the animation audit.
