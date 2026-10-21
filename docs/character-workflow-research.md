# A repeatable character workflow

Research checked 2 October 2026. This document separates findings from the recommended implementation. It is an authoring plan, not evidence that every proposed capability has shipped or that a character has passed visual acceptance. The implemented portrait interface is documented in [the runtime README](../src/animation/README.md).

## Recommendation

Build characters as **registered, layered puppets with a reproducible pack step**. Keep the original portrait immutable. Complete surfaces that will become visible during motion, define landmarks and allowed motion, then author speech, eyes, brows, and body movement against that same coordinate system. For a new commission, request these layers from the artist at the start. For existing flat artwork, perform that separation once and retain the editable master.

Keep the current native runtime and imported cast as the initial compatibility target. A small native format gives this browser studio control over preservation checks, fallback behavior, exports, and third-party asset boundaries. Evaluate an Inochi2D adapter when fuller layered models are needed. Live2D and Spine are valuable optional integrations, but neither should silently become a required dependency of an engine intended for open-source release.

This is a practical scope choice, not a claim that a new custom renderer already matches established character tools. The hard part remains art preparation and calibration. Automatic segmentation, landmarks, and weights can provide drafts; they cannot establish that hidden anatomy, perspective, or likeness is correct.

## What the primary sources establish

| Approach                   | Useful capability                                                                                                                                                                                                                                   | Implication for this studio                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live2D Cubism              | Its official workflow separates hair, face, and body, with individual eye components and upper/lower lips. Hidden regions are painted before motion exposes them.                                                                                   | Adopt the preparation discipline. A flattened PNG cannot supply unseen skin, mouth interiors, or covered hair by deformation alone. [Illustration processing](https://docs.live2d.com/en/cubism-editor-tutorials/psd/)                                                                                                                                  |
| Live2D source preparation  | Editable separation documents are kept separately from merged import documents. Import PSDs have one part per layer, unique names, RGB/8-bit data, and sRGB.                                                                                        | Preserve an editable master and generate disposable runtime outputs. Do not use a packed atlas as the only source. [Material separation](https://docs.live2d.com/en/cubism-editor-manual/divide-the-material/), [PSD preparation](https://docs.live2d.com/en/cubism-editor-manual/precautions-for-psd-data/)                                            |
| Live2D parameter templates | Standard parameters include independent eye openness, gaze, brows, head angles, and mouth controls. Templates can reuse deformation structures and parameter keyforms.                                                                              | Reuse semantic control names and rig structure across characters, while calibrating their geometry independently. [Standard parameters](https://docs.live2d.com/en/cubism-editor-manual/standard-parameter-list/), [model templates](https://docs.live2d.com/en/cubism-editor-manual/applying-the-model-template/)                                      |
| Spine                      | Mesh topology controls deformation; weighted vertices bind to bones. Linked meshes can share topology and weights. Clipping has measurable runtime cost and invalidates when its polygon self-intersects.                                           | Use a parent hierarchy and small stable meshes. Reuse compatible topology for same-pose variants; avoid extensive per-frame vertex keys and oversized clip regions. [Meshes](https://esotericsoftware.com/spine-meshes), [weights](https://esotericsoftware.com/spine-weights), [clipping](https://esotericsoftware.com/spine-clipping)                 |
| Inochi2D                   | The official runtime animates layered 2D meshes through parameters. It documents WebAssembly support and JavaScript wrappers. Its runtime and Creator editor use BSD-2-Clause licenses.                                                             | This is the strongest researched candidate for an open-source authoring/runtime adapter. Browser integration and actual target-device performance still need testing. [Runtime](https://github.com/Inochi2D/inochi2d), [runtime license](https://github.com/Inochi2D/inochi2d/blob/main/LICENSE), [Creator](https://github.com/Inochi2D/inochi-creator) |
| Rhubarb Lip Sync           | Generates timed mouth cues from final recordings, with six basic shapes and optional G/H/X shapes. Supplying the dialogue improves recognition. English uses PocketSphinx; the phonetic recognizer supports other languages with reduced precision. | Align the final audio once, then reuse it with the rig. A waveform envelope or typed-text timer cannot stand in for those articulation cues. [Official project and CLI documentation](https://github.com/DanielSWolf/rhubarb-lip-sync)                                                                                                                  |

Live2D's release terms distinguish ordinary content from an **Expandable Application**, relevant to a studio that loads user-created models. Spine runtime redistribution is governed by its runtime/editor agreements. These are integration constraints to review before distributing an adapter; source availability does not make every runtime an unrestricted open-source dependency. [Live2D publication terms](https://www.live2d.com/en/sdk/license/), [Spine runtime agreement](https://esotericsoftware.com/spine-runtimes-license)

## Artwork handoff for a new character

Request one neutral front or mild three-quarter pose, at the intended dialogue-camera angle. Start with enough face resolution to judge eyelids and lip corners at the final display size. A useful working target is a 1,500–2,500 px portrait with a face at least 350 px tall; these are project recommendations, not universal requirements. Very small source faces place a real limit on the result even after upscaling.

Deliver a layered PSD or equivalent editable document plus registered PNG exports. Keep all exports on the same canvas until packing. The layered document should reconstruct the approved neutral illustration when all parts are composed without motion.

| Group                          | Minimum useful parts                                                                  | Hidden artwork that must exist                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Body                           | Torso, neck, independently moving sleeves/arms, clothing accents                      | Neck behind the jaw; shoulder and clothing overlap underneath moving parts           |
| Head                           | Face/skin plate, ears, optional separate nose shading                                 | Skin underneath brows, eyelids, mouth, and displaced hair                            |
| Eyes, separately for each side | Whites, iris/pupil, upper lid/lashes, lower lid, highlights where needed              | Sclera behind the iris and the maximum gaze envelope; eyelid skin for closure        |
| Brows                          | Left and right brow artwork with independent pivots                                   | Skin underneath their full allowed movement; foreground hair retained as an occluder |
| Mouth                          | Upper/lower lip region, cavity, teeth, optional tongue; or registered viseme variants | An opaque healed base covering the entire original mouth, including corners          |
| Hair                           | Back mass, fringe, side locks, selected loose strands                                 | Forehead and scalp coverage at the maximum intended sway                             |

Not every painted style benefits from separating every highlight. Use the fewest independent layers that support the desired motion. Complex textures may look better with small registered artwork variants than with a heavily stretched mesh. Full head turns need genuinely authored alternate views; a flat portrait supports restrained depth cues, not arbitrary 3D rotation.

For existing artwork with a calibrated portrait, edits may reconstruct occluded regions and create articulation variants. They must preserve the source identity, costume, camera, lighting, and untouched areas. Generated full-face sheets are registration material; pack only the intended feature regions. Do not replace the whole face each time a mouth or blink is added.

## Authoring contract

The following is the recommended contract for authoring inputs. It deliberately does not redefine the existing runtime manifest.

1. **Source record.** Character/pose ID, source page and direct asset URL where known, artist and rights-holder credits, retrieval date, original dimensions, SHA-256, intended usage, and redistribution status. Keep the untouched source alongside a static fallback.
2. **Editable master and parts.** Retain the layered document, local repair edits, masks, and full-canvas exports. Give each part a stable semantic name. Preserve a record of how every derived image was produced.
3. **Calibration in source pixels.** Record face bounds; at least three non-collinear stable registration points where practical; both eyes' corners and aperture contours; mouth corners and center; brow support; head/neck/jaw pivots; and hair/clothing regions. A pair of anchors can fit a similarity transform, but additional anchors are needed to expose registration error. Never reuse another character's numerical landmarks as a calibrated result.
4. **Feature support and occlusion.** Every editable feature has a fixed support region, a feathered outer edge if required, and protected foreground pixels. Mask brows and fringe separately from an eye's bounding rectangle. A rectangle is not a sufficient anatomical mask.
5. **Feature states.** Mouth X is the approved original rest state. Author A–F for the existing runtime; G/H require explicit artwork and runtime support before claiming extra coverage. Author each eye at open, quarter, half, three-quarter, and closed positions. Keep original open-eye pixels and iris position. Include neutral/raised/lowered brow variants only if their skin repair is ready.
6. **Motion limits.** Declare conservative ranges for head tilt, nod, jaw opening, gaze, brow lift, hair sway, and torso breathing. Declare unavailable capabilities explicitly. A single opaque portrait must not be labelled a fully layered puppet.
7. **Export report.** Include source/edit hashes, registration transforms and residual error, crop bounds, reference coordinate space, supported controls, missing capabilities, validation results, and pack version. The pack step may trim and atlas textures, but must preserve offsets back to the source canvas.

The implemented character packer uses source-pixel calibration and registered edit inputs, then writes the normalized body/facial pack. The Rig builder walks through source upload, face calibration, four edit sheets, an unchanged-detail registration patch, and compilation. Automatic registration fits translation and scale against stable source detail, preserves explicit anchors, and rejects unusable matches. Treat automatically seeded landmarks as **drafts**. A pack that loads successfully has passed a format check, not an anatomy or visual check.

## Deformation and animation plan

Use a coherent hierarchy: stage → torso → neck/head → facial parts, with hair and clothing attached to their relevant parent. Mouth artwork, eye masks, brows, and highlights must follow the same head transformation. Moving a face patch in screen space while the face deforms underneath it creates sliding even when each patch looks correct in isolation.

Blend controls in a defined order: neutral pose, chosen expression, authored acting, audio articulation, blink/gaze, then subtle secondary motion. An expression establishes its own resting mouth, eye aperture, and brow limits. Do not automatically turn every face into a wide smile or round open mouth when speech starts.

For speech, map the current audio cue to mouth artwork and an opening curve. Couple jaw and cheek movement conservatively to articulation. Use audio energy only for secondary emphasis or silence checks, not to choose every mouth shape. Preserve brief lip closures instead of smoothing them away. Warp neighboring compatible mouth textures to common interpolated landmarks before blending; opacity-only crossfades can produce double lips.

For eyes, keep the iris behind an independently animated eyelid aperture. Gaze requires a clean sclera plate and visible-area constraints; moving a rectangle containing both iris and eyelids moves the whole eye. Blinks should preserve perspective and each pose's lower lid. For brows and hair, complete their underlying surfaces before enabling motion.

Use sparse authored performance cues for intentional beats such as a nod or emphasis. Dialogue tags can select conservative presets, but audio alone cannot reliably infer the character's intended acting. Keep generated suggestions editable and separate from the lip-sync sidecar.

## Dialogue to finished playback

1. Select the character, calibrated pose, language, voice, model, and desired delivery. Store the exact text and settings with the generation request.
2. Generate the ElevenLabs recording server-side. Cache it by request identity so a rig edit or repeat preview does not create another paid request.
3. Decode the final saved recording for alignment. Run Rhubarb with the exact spoken dialogue and the appropriate recognizer, using the shape set the rig actually supports. Store audio hash, duration, aligner version, recognizer, and cues together.
4. Validate sorted, bounded, non-overlapping cues and silence/rest behavior. Allow cue correction and realignment without regenerating speech. Inspect unexpected pauses, names, and non-English lines by listening.
5. Drive the performance from the audio element's actual playback clock, including seek, replay, pause, and speed changes. Keep blink timing independent. A stale generation or pose load must never attach to the current character accidentally.
6. Preview the exact exported runtime with the recording, then retain the resulting audio/cues as reusable game assets. Provider credentials remain outside the browser and exports.

The detailed server behavior is covered in [the voice pipeline](voice-pipeline.md). Changing the character's art should require repacking the rig, not generating another recording.

## Validation gates

**Artwork:** Compare the neutral composite with the original at identical size. Check the repaired face with all features hidden. Freeze the mouth and compare blink on/off; changes must stay within the intended eye masks, including protection for brows and hair inside those rectangles. After a blink, exact original open-eye pixels must return. Missing optional layers must leave a complete portrait.

**Geometry:** Validate bounds, asset dimensions, registration, triangle winding, zero-area triangles, mask self-intersections, and motion extremes. Sample intermediate blends as well as keys. Render those samples in a browser: valid triangles can still show raster seams.

**Motion:** Watch natural-speed dialogue first. Then inspect labelled slow-motion blinks, viseme transitions, brow extremes, and gaze limits. Include speech while blinking/nodding, rapid pose changes, interrupted playback, resize, hidden tabs, reduced motion, and disposal. Test two independent portraits so clocks and state cannot leak.

**Performance:** Measure real target browsers with two visible portraits and real audio. A provisional target is a stable 60 Hz desktop scene without frame spikes from repeated image decode or texture creation. Record the device, browser, viewport, frame-time distribution, memory, and fallback mode. This is a target, not a current result. Atlas small feature variants, cache decoded assets, update only changed composites, pause hidden motion, and bound texture resolution to the displayed size. Benchmark mobile and Safari separately before making support claims.

**Acceptance:** Keep automated format/pixel checks, observed browser playback, and the user's artistic acceptance separate. A successful build does not prove the face preserves the approved character identity. Record remaining defects precisely rather than describing the workflow as perfected.
