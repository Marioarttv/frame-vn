# Project format and player engine

Frame stores stories as portable JSON using `schemaVersion: 3`. Versions 1 and 2 are still accepted: every field added since is optional, so older projects are read as version 3 unchanged. The core in `src/engine/` does not depend on React or the animation renderer. Import from `src/engine/index.ts` to validate, navigate, save, or export a project.

## A minimal project

```json
{
  "schemaVersion": 3,
  "id": "hello-world",
  "title": "Hello, world",
  "description": "My first visual novel.",
  "startNodeId": "hello",
  "characters": [],
  "backgrounds": [],
  "variables": [],
  "sounds": [],
  "nodes": [
    {
      "id": "hello",
      "label": "An introduction",
      "type": "dialogue",
      "speaker": "Narrator",
      "text": "Every story starts somewhere.",
      "position": 50,
      "nextId": "goodbye"
    },
    {
      "id": "goodbye",
      "label": "The ending",
      "type": "end",
      "text": "Until next time.",
      "position": 50
    }
  ]
}
```

IDs use letters, numbers, hyphens, and underscores, start with a letter or number, and are at most 96 characters. IDs must be unique within their collection. A pose ID is local to its character; a choice ID is local to its scene.

## Scenes and branching

All scenes have `id`, `label`, `type`, `text`, and a numeric `position` from 0 to 100. Position places the character horizontally on the stage. Optional fields are `speaker`, `backgroundId`, `characterId`, `poseId`, `audioSrc`, and `cueUrl`. Missing artwork produces an empty stage or narrator scene. A selected character without `poseId` uses its first pose. A supplied `speaker` overrides the character's display name.

- A `dialogue` scene has `nextId`, either the next scene ID or `null` to stop playback.
- A `choice` scene has one to eight `choices`, each with `id`, `text`, a destination `nextId`, and optional `conditions` (the choice is shown only when all hold) and `effects` (applied when picked).
- A `branch` scene is invisible to players. It has one to eight `branches` (`{ id, conditions, nextId }`) and an `elseId`; the first branch whose conditions all hold wins.
- An `end` scene completes the story.

Each scene fully describes its stage, so any branch can be entered on its own:

| Field        | Meaning                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------- |
| `flip`       | Mirrors the speaking character.                                                               |
| `cast`       | Up to five non-speaking characters `{ characterId, poseId?, position, flip? }`, shown dimmed. |
| `transition` | How the scene arrives. See [staging and presentation](#staging-and-presentation).             |
| `musicId`    | Omitted: keep the current music. `null`: stop it. An ID: start that looping track.            |
| `ambienceId` | The same for the ambience bed (rain, wind, a crowd), a second looping channel beside the music. |
| `sfxId`      | A sound effect played once when the scene begins.                                             |
| `effects`    | Variable changes applied when the scene is entered.                                           |

Every destination, background, character, pose, variable and sound reference must exist. Loops are supported, except loops made only of branch scenes, which would never show anything. Unreachable scenes, a story without any reachable ending, and a choice whose every option is conditional produce warnings rather than preventing editing or export. Array order controls the editor's presentation; connections determine playback order.

## Staging and presentation

Version 3 adds optional fields that describe how a scene looks. They are written only when set.

**Placement.** The speaker (on the scene) and each `cast` entry accept `y` (vertical offset in percent of the stage height, −60 to 60), `scale` (depth, 0.4 to 1.8), `enter` and `exit` (`fade` by default, or `slide-left`, `slide-right`, `rise`, `pop`, `zoom`, `blur`, `uncloak`, `none`; `uncloak` reveals a translucent veil over 1.4 s: the figure appears from the top down under a silvery, liquid sheen with a faint heat-haze ripple at the cloak's edge, all of its layers at once; as an exit it plays backwards, vanishing from the feet up; with reduced motion it is a plain fade) and a one-off `emote` gesture (`nod`, `shake`, `bounce`, `jump`, `tremble`, `lean`, `recoil`). An entrance plays when the character was not on stage in the previous scene; an exit plays when the next scene no longer shows them. Larger characters are drawn in front.

**Scene look.**

| Field              | Values                                                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transition`       | `cut`, `dissolve`, `fade` (through black), `flash` (through white), `wipe-left/right/up/down`, `iris`, `blinds`, `slide-left/right` (push), `zoom`, `blur`, `glitch`, `burn` (the old picture burns away from its edges inward with a glowing ember rim and sparks, 1.9 s), `seam` (a silver line opens across the old picture and its halves part, 1.6 s). `burn` and `seam` need an image as the outgoing background; otherwise they dissolve |
| `backgroundMotion` | `zoom-in`, `zoom-out`, `pan-left`, `pan-right`, `drift`, `sway`: slow camera motion that makes a still background feel alive                                    |
| `weather`          | `rain`, `storm`, `snow`, `embers`, `dust`, `fog`, `fireflies`, `sparks`, `motes` (warm dust in light), `candles` (floating candles in the top of the frame), `magic` (rising gold and teal glitter), `smoke` (low, dark tendrils), `wind` (gusting air streaks with autumn leaves blown across), `leaves` (gently falling autumn leaves), `airstream` (speed lines and cloud wisps rushing past, for flying), `downpour` (the storm's heavy slanting rain without its random lightning, for scenes that cue `{fx=lightning}` by hand), `frost` (ice creeps in from the screen edges over about four seconds and stays while scenes keep this weather, with fine ice motes and low cold mist; `{fx=radiance}` melts it), `raindrops` (rain on the camera's glass rather than in the scene: sparse round beads with a soft lens look land, sit and dry, and now and then one grows heavy and slides down in an irregular path, leaving a short wet trail; sliding drops keep to the outer thirds and faces stay readable; it fades in over 2 s and out when the weather changes, and with reduced motion it stays as still beads while other weather is switched off): procedural and seeded, so it costs no storage and renders identically |
| `grade`            | `warm`, `cold`, `night`, `dusk`, `noir`, `sepia`, `toxic`, `dream`, `vivid`, `drained` (colour and contrast sucked out under a cold blue-black shade)                                                                                     |
| `camera`           | `{ zoom, x, y }` with zoom 1–2.5 and the focus in stage percent. Camera changes glide between scenes.                                                          |
| `light`            | Scene lighting on the characters: `{ color, amount, brightness, saturation?, rim?, rimFrom?, rimStrength? }`. Tints portraits toward `color` (0–1), scales brightness (0.1–2), optionally mutes saturation and adds a soft rim light from `left`, `right` or `top`, so sprites match a moonlit or candlelit background. Changes ease in over about a second. |
| `shake`            | `light` or `heavy`, once when the scene begins                                                                                                                 |
| `fx`               | Up to eight screen effects played when the scene begins, each `"name"` or `"name,x,y"` (x and y in stage percent): `crack`, `glint`, `sparkle`, `ink`, `heartbeat`, `comet`, `hair`, `tumble`, `stomp`, `lightning`, `frost`, `radiance`, `wandlight`, `wandfail`, `thread`, which takes two points, `"thread,x1,y1,x2,y2"`, `dome`, which may add a radius, `"dome,x,y,r"`, `transform`, `warmth`, `splat`, `wail`, `binding` and `fracture`. See inline `{fx=…}` below. |
| `textbox`          | `classic`, `cinematic`, `bubble`, `novel`, `minimal`, `gilded`, `chem`, `terminal`, `parchment`, `glass`, `hologram`, `grimoire` (aged parchment with gilded filigree, a ribbon nameplate and italic, centred narration), `title` (no panel; large gilded centred text with flourishes for chapter cards); overrides the theme                                           |
| `textEffect`       | `typewriter`, `fade`, `rise`, `blur`, `pop`, `scramble`, `word`, `bounce`, `fly`, `spin`, `stretch`, `unfold`, `glitch`, `quill` (each letter is written in glowing gold ink that settles to the text colour, with a quill pen and sparkles following the writing), `instant`; overrides the theme                                                                |
| `audioDuration`    | Seconds of `audioSrc`. When present, text reveals in step with the recording. On a scene without audio (a title card) it is how long auto-play and video renders hold the scene. |
| `textTimings`      | Start time in seconds, from the start of `audioSrc`, of each spoken word: the whitespace-separated words of the text once tags are removed (`spokenWords(text)`), punctuation attached. Each word is written in one go and is complete 0.2 s before the voice starts saying it, then the text waits for the voice; so that the first word is ready too, the voice starts up to 0.45 s after the text. Inline events fire when the word they sit before is spoken; `{wait}` and `{speed}` are ignored because the recording already has its pacing. Timings must be finite, non-negative and never go backwards; words after the last timing are paced normally, and extra timings are ignored with a warning. Cleared by the studio whenever the recording or the spoken words change. |

A background may set `kind: "video"` and use an MP4 or WebM `src`; it plays muted and looped.

**Theme.** The optional project `theme` holds the defaults: `textbox`, `textEffect`, `textSpeed` (characters per second, 5–200), `font` (`sans`, `serif`, `mono`, `rounded`, `condensed`, `storybook`), an `accent` hex color, `focus` for listeners (`dim` also gives the speaker a slight lift while listeners shrink a little; `spotlight`, `none`), `expressionChange` (`morph` warps one expression into the next, `cut` switches instantly) and optionally `musicDuck` (0–1: the music's level while a voice line plays, as a fraction of the music volume; 1 turns ducking off; default 0.45; the music comes back up 1.2 s after a line ends, so it stays down between back-to-back lines) and `textScale` (0.6–2, scales all story text; useful for phone-first video). `storybook` uses Cormorant Garamond for text and Cinzel for names (SIL Open Font License, `src/player/fonts/`); they are embedded in exported players only when the theme font or a `grimoire`/`title` text box uses them, and other fonts fall back to Georgia-like serifs.

**Inline direction.** Dialogue text may contain tags that time effects to a word: `{wait=0.5}` pauses, `{speed=0.5}` changes reading speed until `{speed=1}`, `{expression=Angry}` changes the speaker's expression (by pose name or ID; in a voiced line the change waits until the recording ends, so faces never change while they speak), `{shake}` or `{shake=heavy}`, `{flash}`, `{sfx=Name}` plays a sound by name or ID, `{fx=crack}` or `{fx=glint,48,30}` plays a screen effect (optionally at x,y in stage percent) above the characters and below the text box (`crack`: glass cracks spread from the point, hold and fall away, about 2.9 s; `glint`: a lens or spectacle glint, 0.75 s; `sparkle`: a burst of gold sparkles, 1.3 s; `ink`: ink bleeds in from the edges and recedes, 3 s; `heartbeat`: two dark-red pulses with a small stage pulse, 1.25 s; `comet`: a small golden comet darts in, loops once around the point and shoots away with a trail, 1.7 s; `hair`: a curtain of pale blonde hair whips across the whole screen and clears, 1.75 s; `tumble`: the view lurches, rolls and drops, stops hard and settles, 1.35 s; `stomp`: two sharp downward bumps of the view, 0.7 s; `lightning`: a branching bolt strikes from above down to the point with a blue-white flash that flickers twice and a small jolt, 1.15 s; `frost`: ice creeps in from the edges, holds and melts, 4.6 s; `radiance`: silver-white light bursts from the point with turning rays, two ring waves and drifting silver motes, and melts any `frost` weather, 3.4 s; `wandlight`: a small light flares at a wand tip, flickers and holds, then shrinks away, 3.2 s; `wandfail`: the same light sputters and gutters out, dropping a few sparks, 1.7 s; `thread`: placed by two points, `{fx=thread,34,30,66,30}` (x1,y1,x2,y2, the default; for two characters' eye lines), the screen edges dim while a thin silver-blue thread of light trembles between the points, pulls taut as it brightens to white, then snaps at the middle with a small white flash and two sparks, its halves recoiling to their ends, 2.4 s, snapping at 1.8 s; `dome`: A translucent protective bubble, `{fx=dome,50,55}` or with a radius in percent of the stage width, `{fx=dome,40,55,25}` (default 22, 2–80): a translucent soap-bubble dome swells from the point over 0.9 s with a thin iridescent rim and a soft inner sheen, a ripple runs across it once, it holds faintly and fades, while the scene outside dims slightly, 3.2 s; `transform`: an Smoke transformation, dark smoke and flecks of black fur swirl upward in a column around the point, thickening until they hide a figure-sized region (about a fifth of the stage wide, most of its height) at its peak at 1.3 s, where a production cuts or swaps the sprite, then a soft dark pulse and the column rises away, 2.8 s; `warmth`: a small ember-orange glow blooms at the point within 0.4 s, then warm amber light spreads out to the edges with a faint rising heat shimmer and a warm grade on the whole frame, holds and fades, and melts any `frost` weather, 3.6 s; `splat`: four to six mud clods fly in quick arcs from off-screen right to around the point and burst into irregular splashes with droplets and a drip, landing between about 0.35 and 1.2 s and gone by 2 s; `wail`: a ghostly shriek, three faint pale ripples spread from the point across the screen while the whole view wavers and the edges flicker pale and cold, 1.6 s; `binding`: a vow of silence closing on a person, placed on the throat, `{fx=binding,50,45}`: a throat-sized ring of small pale-gold rune marks (abstract, not letters of any alphabet) fades in, turns slowly and tightens like a chain drawing shut, flares once at its tightest at 1.2 s, then sinks into the point and fades, leaving a brief faint glow, 2.6 s; `fracture`: a soul torn apart, placed on the chest: a pale white-green wisp pulses at the point, a jagged crack runs through it, and at 0.9 s a dark-edged shard tears away with a sharp ripple; four to six fragments drift outward trailing faint sickly-green smoke into a dark green vignette that recedes, 2.8 s. With reduced motion, `lightning` is a dim flash, `frost` and the wand lights hold still, `radiance` is only its glow, `thread` is the dimmed edges and a still line that fades, `dome` appears at full size and fades, `transform` is a soft dark pulse at the point (darkest at 1.3 s), `warmth` a still glow and grade, `splat` the splashes appearing and fading, `wail` one pale flicker of the edges, `binding` the still ring at its tightest, brightening at 1.2 s and fading, and `fracture` a still glow and the dark green vignette), and `{color=#7fe3ff}…{/color}` colors words. `*emphasis*` and `**strong**` style text, and a backslash escapes `{`, `}`, `*` and `\`. `plainText(text)` returns the words without tags; it is what history, accessibility text and voice generation use, so adding direction never invalidates a recording. Unknown tags are dropped and reported as warnings, as are expressions or sounds that do not exist. Sounds referenced only by tags are still embedded on export.

**Text animation.** Inspired by Febucci's Text Animator, words can keep moving while they are shown: `{wave}…{/wave}`, `{bounce}`, `{jitter}`, `{wiggle}`, `{swing}`, `{dangle}`, `{float}`, `{pulse}`, `{grow}`, `{rainbow}`, `{glow}` and `{glitch}`, each closed by its own `{/name}`. An optional strength scales the motion (`{wave=2}`, 0.25–3). `{in=fly}…{/in}` (or `{in=quill}`) gives some words their own entrance (any text effect name except `word` and `instant`), `{size=1.6}…{/size}` scales them (0.5–2.5), and `{/fx}` ends every running behaviour and entrance. Tags nest and combine; like all direction they never reach the spoken words. The animation is plain CSS shared by the player and the studio's previews (`src/player/text-fx.ts`), so MP4 renders match the browser frame for frame. `{shake}` on its own is still the stage shake; letters shake with `{jitter}`.

Characters may store ElevenLabs delivery as `voiceSettings: { stability, similarity, languageCode? }` (0–1 each).

## Variables and conditions

`variables` holds `{ id, name, type: "number" | "boolean", initial }`. A condition is `{ variableId, operator, value }` with `==`, `!=`, `>`, `>=`, `<` or `<=` (true/false variables allow only `==` and `!=`). An effect is `{ variableId, operation: "set" | "add", value }`; only numbers can be added to.

`sounds` holds `{ id, name, src, kind: "music" | "sfx" | "ambience" }`, optionally with `volume` (0–1, multiplied with the player's music or effects volume; default 1) and, for music and ambience, `loop: false` to play the track once instead of looping it. A track that has finished stays silent until a scene asks for different music. Ambience plays on its own channel beside the music: a scene's `ambienceId` starts a bed (it fades in over 1.5 s and loops), `null` fades it out over 1.2 s, and omitting it keeps the current bed. It follows the effects volume and ducks half as deep as the music under a voice line (0.725 with the default `musicDuck` of 0.45), so rain does not vanish between words.

The pure player helpers use `{ nodeId, variables, musicId, ambienceId?, history }`, where history holds snapshots of earlier scenes. `createPlayerState(project, startNodeId?)` applies the starting values; entering a scene applies its effects, music and ambience and follows branch scenes until a visible scene is reached. `advancePlayer` follows dialogue connections; `availableChoices` lists the choices whose conditions hold; `chooseOption` applies the choice's effects and follows it; `previousNode` restores the previous scene's variables, music and ambience. No helper changes the project or previous state. `removeNode` repairs incoming links and the opening scene atomically; removing the last scene is rejected.

## Script import

`parseScript(text, project)` turns screenplay lines into linked scenes: `Name: line`, `Name (expression): line`, narration, `# Label`, `* Choice -> Label`, `-> Label`, `@bg`, `@music` (or `@music stop`), `@sfx` and `@end text`. Staging directives keep characters on stage between lines once a script uses them: `@stage Mira left, Noah right`, `@enter Name [mark]`, `@exit Name`, `@clear`, and `@gesture Name nod` for the next line. Look directives last until changed: `@weather`, `@grade`, `@textbox`, `@effect` and `@motion` (each accepts a value or its label, and `none`/`default` resets), and `@camera 1.4 Name`, `@camera 1.5 30 40` or `@camera wide`. `@transition iris` and `@shake heavy` apply to the next line only. Names match characters, expressions, backgrounds and sounds case-insensitively. Problems are reported with line numbers. `insertScriptNodes(project, nodes, afterNodeId)` adds them after a scene and continues from it if it had no next scene.

## Characters, backgrounds, and asset URLs

A character contains `id`, `name`, a hex `color`, and a nonempty `poses` array. It may contain `description`, `voiceId`, and a `voice` sample with `src` and optional `cueUrl`. Each pose contains `id`, `name`, and image `src`.

Optional animation fields are:

```ts
interface PoseAnimation {
  manifestUrl: string;
  speechIndexUrl: string;
  browsIndexUrl?: string;
  lightingUrl?: string;
  assetRoot: string;
  poseKey: string;
}
```

A pose may also contain a `rig` JSON URL and `capabilities` with boolean `mouth`, `blink`, `body`, `gaze`, and `brows` flags. These fields describe optional renderer features; the project engine does not assume a particular animation technique. The studio's animation adapter consumes them.

A background is `{ id, name, src, kind? }`.

Assets accept relative URLs, HTTP(S) URLs without credentials, supported image/audio/video/JSON data URLs, or `asset:<sha256>` references to the browser's local asset store (images, audio and background videos). Asset references are re-embedded as data URLs by JSON backup export and by the game export. Executable URLs, HTML data URLs, protocol-relative URLs, and control characters are rejected. Embedded data URLs are the portable choice for user uploads. A JSON export preserves URLs; relative assets must accompany it when moving to another installation. Generated speech uses an audio URL plus a JSON cue URL. Selecting a voice ID does not itself generate audio.

Local character packs may reference separately stored images, rigs, animation frames, and samples. A project pointing to such a pack requires that pack to be installed. Those references do not grant rights to redistribute the artwork. Keep project code, reusable format, and optional third-party or private media licenses separate.

## Validation and persistence

`validateProject(unknown)` and `parseProjectJSON(string)` return `{ valid, errors, warnings }`; a valid result includes a normalized `project`. Each issue contains `path` and `message`. Unknown fields are discarded. User dialogue is plain text, never HTML. Input files are limited to 256 MB (backups embed their media, including background videos of up to 40 MB), projects to 1,000 scenes and 100 characters/backgrounds, and characters to 100 poses.

Authoring drafts can temporarily have blank names, labels, choice text, destination references, or links to items that do not yet exist. `validateDraftProject(unknown)` (equivalently `validateProject(input, { draft: true })`) preserves these fields and reports them as warnings. Draft mode still rejects unsafe URLs, malformed field types, invalid colors or positions, unsupported versions, invalid/duplicate identity IDs, and collection/text limits. This distinction permits autosave during an edit while keeping playback and game export strictly validated.

`serializeProject(project)` validates and produces formatted JSON. Use `serializeProject(project, { draft: true })` and `parseProjectJSON(text, { draft: true })` for draft backups and restores. `saveProject(project)` stores a structurally safe draft under its project ID, moving any inline data URLs into the asset store first, and resolves with the stored project after its transaction commits. `loadProject(id?)` uses the same draft validation and returns that project, the last opened project, or `null`. `listProjects()`, `setCurrentProject(id)`, `deleteProject(id)`, `putAsset(blob, kind)`, `getAsset(ref)`, `internalizeProjectAssets(project)`, `externalizeProjectAssets(project)` and `collectUnusedAssets()` complete the storage API. Missing storage access, quota failures, damaged saves, and blocked databases reject with actionable messages. The host UI must display these failures and must not label a failed operation as saved.

IndexedDB keeps imported media out of synchronous localStorage and stores each file once. Storage still belongs to this browser and origin and can be cleared by the user or browser. JSON export is the explicit backup path.

## Standalone game export

`await exportStandaloneHtml(project, options?)` returns a single HTML document running the same player as the studio preview (`src/player/`): staged characters with entrances, gestures and expression morphs, every transition, text box and text effect, weather, grading and camera moves, music and sound effects, conditional choices, three save slots plus autosave and "Continue", history, auto-advance and settings for text speed and volume. It embeds the images, audio, and cue files referenced by the story, deduplicates repeated URLs, and excludes unused character poses and backgrounds. Animation manifests and brow indexes are reduced to selected poses; speech and performance indexes are reduced to the story's recordings. Referenced rig, gaze, brow, mouth, eyelid, and reference assets are then embedded recursively. A missing asset fails the export with its path. A host can provide `resolveAsset(src): Promise<string | undefined>` returning a data URL, or `undefined` to fetch it normally; asset-store references require a resolver. Fetching assets on another origin requires `allowExternalAssets: true` and that server's CORS support. Individual fetched assets are limited to 150 MB; a complete package is limited to 2,500 assets and 400 MB of encoded data.

The document plays locally without a server or additional libraries. It includes branching, back/restart navigation, dialogue history, text reveal, audio on/off, keyboard operation, mobile layout, and reduced-motion support. It stores no external analytics and requires no account. A missing embedded URL is an error; the exported player never silently falls back to downloading it.

The exported player uses the same portrait controller as the studio, including layered mouth animation driven by the audio clock, blinking, breathing, gaze, brows, and body performance when that pose provides those capabilities. Original asset identifiers remain stable for cue matching; a resolver maps them to embedded data. A static character remains a static character with optional breathing. Missing optional source capabilities are not invented by the exporter.

`scripts/build-player-runtime.mjs` bundles the controller into a generated TypeScript string module containing only runtime code. Run it after animation-runtime changes; the normal development/build commands also regenerate it. Exported HTML includes this bundle directly and does not require ESM imports or network modules. Tests exercise the same generated bundle. Private artwork remains outside the code bundle; only a user's explicit game export embeds selected local media.

Project data is embedded as escaped JSON. The player inserts user text with `textContent`; script-closing tags and HTML in dialogue remain ordinary story text. The runtime is self-contained, so no third-party JavaScript is downloaded when someone opens an exported story.

`await exportRecordingHtml(project, record, options?)` returns the same document in record mode for the video renderer: it starts by itself, follows `record.route` (choice scene ID → choice ID, otherwise the first available choice), paces lines by their recordings (`linePause`, `choicePause`, optional `titleCard`) and reports `window.FramePlayer.getRecording()` plus `document.documentElement.dataset.recording = "done" | "error"` when finished.

## Checks

Run `npx tsx --test tests/engine*.test.ts`. Tests cover branching/history, immutable duplication and deletion, referential integrity, invalid and hostile imports, voice/rig roundtrips, unavailable storage, missing export assets, URL policy, embedded asset deduplication, and HTML/script breakout payloads. Browser-level verification should additionally cover actual image/audio decoding, local saves and reloads, keyboard interaction, responsive rendering, and both exported story branches.
