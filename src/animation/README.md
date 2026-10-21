# Portrait runtime

`createPortraitController` mounts an independent portrait into an element. It owns its DOM, audio element, observers, timers, and animation handles. Call `dispose()` when changing characters or removing the stage. Two controllers can run at the same time without sharing a voice clock or facial state.

```ts
import { createPortraitController } from './animation/controller'

const portrait = createPortraitController(stage, { character, pose })
await portrait.ready
portrait.triggerBlink()
await portrait.play(recordingUrl, rhubarbCueUrl)
// When the portrait leaves the stage:
portrait.dispose()
```

Call `play()` from a user gesture when possible. Browser autoplay restrictions still apply; playback failures reject with the browser error. The audio element's actual `currentTime` drives articulation, including changes in playback speed. No text-length approximation or talking loop is used.

## Layers

- `runtime/spriteRuntime.js`: healed base, mouth mesh interpolation, independently timed eyelids, gaze patches, and calibrated brows.
- `runtime/vnBreathing.js`: torso-only breathing that preserves facial coordinates.
- `runtime/vnLife.js`: subtle head drift, eye fixations, brows, and speech-coupled motion.
- `runtime/vnPerformance.js`: sparse authored acting sampled from the recording clock.
- `runtime/vnSpriteMotion.js`: shared WebGL renderer for registered head, jaw, cheek, hair, and clothing deformation; falls back to the facial composite when WebGL is unavailable.

These modules are adapted from the existing character runtime. They contain no cast allowlist or bundled character artwork. Static images without a pack retain their full portrait and have only subtle whole-image breathing.

## Pack contract

The public types are `Character` and `Pose` in `src/engine/types.ts`. A rigged pose supplies `animation.poseKey`, `assetRoot`, `manifestUrl`, and `speechIndexUrl`; `browsIndexUrl` is optional. `manifest.sprites[poseKey]` supplies the artwork, crop coordinates, geometry, and `performanceRig` URL. Each rig supplies its own reference image, normalized body regions, optional gaze data, and `lines` index. Coordinates and artwork belong to that exact pose.

Speech sidecars use the Rhubarb shape:

```json
{
  "metadata": { "soundFile": "/generated/recording.mp3", "duration": 1.0 },
  "mouthCues": [
    { "start": 0.0, "end": 0.2, "value": "X" },
    { "start": 0.2, "end": 0.7, "value": "C" },
    { "start": 0.7, "end": 1.0, "value": "X" }
  ]
}
```

Production cue files must be derived from the exact recording. Cues must be sorted, non-overlapping, and use `A`–`F` or `X`; generate with Rhubarb `--extendedShapes X`. The approved library has seven mouth frames. The inspection API accepts `G` and `H` as explicit nearest-frame aliases to `B` and `C`, not additional authored artwork. Missing or mismatched cues leave the expression's resting mouth visible.

`update()` controls blinking, breathing, procedural life, head motion, gaze, secondary motion, lip sync, brow override, volume, and playback speed. `setMouthShape()` holds a frame for inspection; pass `null` to restore audio control. Reduced motion and document visibility suspend idle body/eye movement. `getStatus()` distinguishes base readiness, optional layer readiness, playback, and static fallback.

## Portable games

`scripts/build-player-runtime.mjs` bundles the same controller as an IIFE, exported by `player-runtime.generated.ts` as `PORTRAIT_RUNTIME_SOURCE`. The HTML exporter embeds this source and an asset map. Pass `resolveAsset(url)` to map original pack/audio URLs to embedded data URLs; metadata retains its original references so cue/recording identity checks still match. Regenerate the bundle after runtime changes.

## Verification

The public examples must be verified with the same browser compositor used by the studio and offline exports. Use `npm test` and `npm run test:e2e`; see the character authoring guide for source registration and preservation requirements.
