# Video export

**Project → Export video (MP4)**, or **Export video** in a scene's toolbar, records one route through the story as an H.264/AAC MP4. The video shows exactly what the game shows: the same player, text boxes, typing, transitions, weather, camera moves, lip sync, music, voices and sound effects.

## Using it

1. Choose the start scene, the pacing (pause after each line and how long choices stay visible), the resolution (720p or 1080p), the frame rate (30 or 60) and an optional title card.
2. The dialog walks the route with the engine and shows a dropdown for every choice on the way, plus the number of scenes and an estimated length. Branch scenes resolve with the story's variables, exactly as in play.
3. **Render** sends a self-contained recording document to the local server. Progress, elapsed time and speed update live; **Cancel** stops the job. The finished video can be previewed in the dialog and downloaded.

Rendering runs on this machine with headless Chromium (`npm run setup:browser` installs it) and FFmpeg. Finished videos are kept in `.studio/renders/` (the ten newest). Nothing is uploaded anywhere.

## How it stays frame-accurate

`exportRecordingHtml(project, record)` builds the game document in record mode: it starts by itself, takes the planned choices and reports `window.FramePlayer.getRecording()` when it reaches an ending.

The renderer (`server/render/`) loads that document under a virtual clock injected before any page script (`virtual-clock.ts`). Timers, `requestAnimationFrame`, `requestIdleCallback`, `performance.now()` and `Date` all read one clock that advances only when the renderer asks for the next frame. Every CSS animation, CSS transition and Web Animation is paused and seeked to the virtual time each frame. Audio elements never really play: their position derives from the virtual clock, and every play, pause, seek and volume change is logged. Looping background videos are seeked frame by frame.

Each frame is captured and piped into FFmpeg (`renderer.ts`). Afterwards the audio log is turned into a sample-accurate mix of voices, looping music with its fades, and effects (`audio-mix.ts`), and muxed into the MP4. Fades the page draws frame by frame (music fading in and out, and ducking under each voice line to the theme's `musicDuck` level) are interpolated between frames, and sources are decoded when first heard and released after their last use, so long chapters with hundreds of voice clips stay within memory. Scene lighting on characters (an SVG colour and rim-light filter eased frame by frame), screen effects (`{fx=…}`), the quill text effect and the atmospheres are CSS animations or seeded, time-based canvas drawing, so they render exactly as in the browser. Because the weather is seeded and all motion follows the clock, rendering the same route twice gives the same video, independent of machine speed. On a recent Mac a 720p/30 render runs at roughly 40–50 frames per second, faster than real time.

## API

All routes share the local authoring API's loopback, origin and session-token checks.

| Route                            | Purpose                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `POST /api/render?width&height&fps&title` | Body: the recording document (`text/html`, up to 1 GB). Starts or queues a job; answers `202` with the job. |
| `GET /api/render`                | Recent jobs.                                                                                                      |
| `GET /api/render/<id>`           | Status (`queued`, `rendering`, `encoding`, `done`, `error`, `cancelled`), frame, seconds, scene, speed, warnings. |
| `GET /api/render/<id>/video`     | The finished MP4 (supports range requests).                                                                      |
| `POST /api/render/<id>/cancel`   | Stops a job and its Chromium and FFmpeg processes.                                                                |

## Limits

- A route that never reaches an ending stops at the scene limit or the time limit and is reported as a warning.
- Audio the page creates through the Web Audio API (rather than audio elements) is not captured; the player does not use it.
- Exported videos contain whatever artwork the story uses. Videos of local packs with third-party art are for private use like the packs themselves.

`tests/render-service.test.ts` renders a two-scene story with a voice line and looping music and checks the resolution, frame count, duration, audible mix and the first scene's background colour, and a second story that checks the music ducks by about 7 dB under a voice line and that a scene's sound and an inline `{sfx}` are both mixed. `npx tsx scripts/storybook-demo.ts render demo.mp4` renders the storybook demo (grimoire, quill, title card, screen effects, new atmospheres; `tests/fixtures/storybook-demo.ts`). `tests/engine-route.test.ts` covers route planning.
