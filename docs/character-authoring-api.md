# Local character authoring API

The character builder turns an existing portrait, expression edit sheets and a calibrated recipe into a reusable local character pack. It does not call an image provider or replace the source artwork. Source images remain immutable, addressed by the SHA-256 of their original bytes.

All routes share the local authoring service's loopback, Host and same-origin checks. POST requests also require `Content-Type: application/json`, the studio's `Origin`, and the current `X-Studio-Token` from `GET /api/health`.

## Upload and restore source images

`POST /api/characters/assets` accepts `{dataUrl, name?}`. Supported inputs are base64 PNG, JPEG and WebP images, at most 12 MB, 8,192 pixels per side and 32 megapixels. The declared image MIME must match its binary format. SVG, external URLs and filesystem paths are rejected.

The response is `{assetId, src, width, height, mime, bytes, name}`. `src` points to a guarded `/character-assets/<hash>.<extension>` preview. `GET /api/characters/assets/<assetId>` restores the metadata for a saved recipe. Names are descriptive metadata and never determine filesystem paths. Identical uploads reuse their existing content ID.

Uploaded originals live under ignored `.studio/characters/assets/`. Keep that directory when restoring a saved recipe; exporting only the recipe does not include its source images.

## Compile a calibrated character

`POST /api/characters/build` accepts `{recipe}`. The versioned schema is defined in `scripts/character/schema.ts`. The source portrait and mouth, blink, brow and gaze sheets reference uploaded asset IDs. All geometry uses source-portrait pixel coordinates. `createDraftRecipe()` provides an explicitly unreviewed starting point; a person must inspect and calibrate those estimates against the artwork.

The server resolves uploaded images into a fixed asset map, validates the recipe and invokes the trusted local pack compiler. Client data cannot select executable commands, arbitrary input paths or output directories. Compilation runs with a three-minute timeout. The compiler fully decodes images and performs its mask, registration and mesh checks.

Build output first goes into private staging. The server verifies the resulting portable character catalog and confirms that source image hashes are unchanged before moving the complete pack into `public/local-packs/<packId>/`. The response is `{pack, character, recipe, recipeUrl, validation:{valid, sourceAssetsPreserved, warnings, registration}}`. The compiler's effective recipe, including fitted sheet anchors, is preserved as `authoring-recipe.json`; the original request is retained separately as `submitted-recipe.json`.

Generated edit sheets can shift, rotate or scale facial detail even when the source portrait's landmarks are calibrated. Optional `autoRegister` requires an explicit `registrationRegion` around unchanged, detailed artwork such as the nose bridge. The compiler fits that region against each edit-sheet cell before extracting features; weak matches fail or produce review warnings according to the registration helper's confidence thresholds. Portrait calibration alone does not prove that an edited sheet aligns. The API returns per-cell correlation, fitting method, available residual error and translation/scale diagnostics under `validation.registration`. Automatic fitting cannot change a draft calibration's status to visually reviewed.

Installed packs are never replaced: an existing pack ID returns HTTP 409 (`pack_exists`). A build may reuse an installed character ID to add a new expression in its own pack; reusing an expression ID that character already has returns 409 (`pose_exists`). The library merges expressions from every pack that shares a character ID, keeping the first pack (in directory-name order) for the character details and any duplicate expression. In the rig builder, choose **Add as an expression of** on the review step. Failed builds are removed from staging and can be corrected without losing installed packs. Pack and character locks prevent concurrent conflicting builds; a lock older than ten minutes (left by a terminated server) is replaced automatically.

## Library discovery

Full-profile poses author only their one visible eye. The `eyes` list accepts one eye with a `left` or `right` ID, or two eyes ordered left-to-right in the portrait. Blink and gaze metadata must describe the same visible eyes; do not add a dummy eye over hair or skin. Profile expressions retain eye and brow morph landmarks. Switching between a single-eye profile and a two-eye view uses a dissolve rather than stretching incompatible facial geometry.

For eyelids close to bangs or brows, an optional eight-point `eye.supportRing` holds the surrounding artwork fixed during source registration and runtime interpolation. It must enclose every aperture and fit inside the eye rectangle. A blink frame's `aperture` describes its source artwork; optional `targetAperture` preserves an explicitly calibrated destination contour instead of the default lower-lid closure. Both contours and every interpolated triangle are validated during packing.

Set optional `eye.browInfluence` between 0 and 1 to calibrate the lid response to eyebrows. A value of 0 retains independent blinking while preventing eyebrow poses from narrowing or widening an occluded eye. The default is 1.

Use `eye.protectedPolygons` for foreground occluders inside an eye region, such as glasses rims. The packer excludes these polygons from edited eyelids, and playback restores their approved portrait pixels over blinking, widened lids, and gaze.

`GET /api/library` returns `{characters, backgrounds, packs, warnings}` from up to 100 ordinary directories under `public/local-packs/`. Catalogs are capped at 2 MB and validated against the portable project schema. Escaping catalog symlinks, malformed catalogs and invalid entries are skipped with warnings. Packs load in directory-name order; the first valid occurrence of a character or background ID wins. Duplicate IDs never appear in the returned library.

Local packs and source uploads remain outside the distributable build. Importing or compiling artwork locally does not grant redistribution rights. Source/provenance metadata can document the artwork and its license for later review.

## Verification boundary

Server tests exercise upload format and size boundaries, immutable bytes, asset restoration, multi-pack discovery, collision handling, token/origin checks, staging and failure recovery with a mocked compiler. Real compiler validation and browser animation review are separate checks. A successful HTTP build confirms the compiler and schema checks; visual likeness, edit quality and acceptable animation still require inspection.

## Reproducible command-line workflow

`scripts/character/workspace.mjs` builds packs from a pose file that keeps calibration next to the private artwork it describes (paths relative to the character's workspace folder, for example `.studio/characters/<id>/`):

```sh
node scripts/character/workspace.mjs build   poses/neutral.json [--replace] [--dry-run]
node scripts/character/workspace.mjs variant poses/neutral.json --pose mira_grin --name Grinning \
     --pack mira-grin --source source/portrait-grin.png --sheets edits/grin- --out poses/grin.json
node scripts/character/workspace.mjs sheet-grid poses/neutral.json --sheet mouth --out grid.png
```

`build` stores the source and sheets in the same content-addressed asset store the studio uses, compiles with the trusted packer and installs `public/local-packs/<packId>/`; `--replace` rebuilds an existing pack. `variant` starts another expression of the same character from an existing calibration: same canvas, same pack layout, new source and sheets. Expression variants should be edits of the approved portrait with identical framing, so the player's expression morph cross-dissolves faces rather than jumping; recalibrate each variant's lips, eyelids and brows, because they move with the emotion.

`scripts/character/inspect.mjs` supports calibration with labelled zoom grids (`grid`), recipe overlays (`overlay`), face crops, region diffs, alignment search and composites. Read coordinates from a grid, write them into the pose file, and check the overlay before building.

Every pack manifest carries a `morph` block per pose (rest lips, eyelid openings, iris centres and brow centre lines in source pixels) that the player uses to morph between expressions. `node scripts/character/add-morph.mjs <pack folders…>` adds it to packs built before it existed, from their own `authoring-recipe.json`. Packs without it still morph using their mouth and eyelid meshes. Measure iris centres and radii from the pixels, not by eye: an iris circle smaller than the painted iris or off-centre leaves the old iris outline visible when the gaze moves.

When a recipe has a calibrated rest mouth but no traced speech shapes, the packer derives A–F from that rest contour (`derivedMouthFrames` in `geometry.mjs`): it opens the lips mostly downward and narrows rounded vowels while keeping the pose's own lip topology, so an asymmetric smirk interpolates to every shape without folding. Traced frames still take precedence.

Contours must be star-shaped around the mouth center for the mesh to be valid. On strongly turned faces the lip seam can curve too much; relax the inner contour toward the corner-to-corner chord rather than forcing it onto the seam. A generated mouth-repair cell sometimes fails for beards or strong smiles; regenerate only that cell as a single targeted edit of the face reference and splice it into the sheet, keeping the other cells.
