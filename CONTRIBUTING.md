# Contributing to Frame

Frame is a local visual-novel authoring studio with a reusable offline player. Useful contributions include reproducible bug reports, accessibility improvements, clearer guides, small well-tested engine fixes, and original example content with explicit reuse permissions.

For a substantial new feature or format change, open an issue describing the creator workflow first. Keep pull requests focused so another maintainer can understand and reproduce the change.

## Local setup

Use Node.js 22.12 or newer and `npm ci`. Run `npm run dev` and open http://127.0.0.1:5178. Use a separate `FRAME_PORT` for concurrent work. Rig compilation and browser tests require Chrome or Playwright Chromium; install the latter explicitly with `npm run setup:browser`. FFmpeg and FFprobe enable video rendering tests.

Editing and tests require no provider account. Do not configure real provider keys in CI or use real paid generation to validate a contribution. Provider tests inject transports; browser tests intercept generation endpoints. Include only synthetic recordings or media that you have permission to redistribute.

## Verify your change

```sh
npm test
npm run build
npm run audit:release
npm run test:e2e
```

Run the checks relevant to the change on its exact final candidate, and state any missing prerequisites or skipped tests. Do not describe skipped browser or rendering coverage as a pass. Export changes need an actual exported HTML opened through `file://` with networking disabled. Voice changes need caching, deduplication, saved-audio recovery, and uncertain-outcome coverage without provider billing.

Use Prettier for authored TypeScript, React, CSS, and documentation. Regenerate portable players using `npm run prebuild`; never edit generated bundles directly. `npm run notices` updates the installed dependency-license inventory after dependency changes.

## Character contributions

Keep original portraits and edit sources. Include their creation method, source/license records, hashes, and calibration. Never add private media or third-party franchise artwork as a test fixture. The engine, sample artwork, and imported media have separate provenance boundaries.

Animation changes need actual browser rendering as well as code checks. Inspect native and enlarged intermediate mouth/blink states, source restoration, protected pixels, audio-clock behavior, rapid pose replacement, reduced motion, multiple portraits, and disposal. Natural-speed playback is required for animation claims; a contact sheet or valid mesh alone is insufficient.

## Format and persistence

Keep incomplete authoring drafts separate from strict playback validation. Portable-format changes need validation, round-trip tests, and export coverage. A breaking format change needs a schema version and migration strategy. Include a small original or synthetic example when explaining a new field.

## Pull requests and review

Explain the concrete problem and the behavior after the fix. Include reproduction steps, relevant validation, and any remaining limitation. For UI changes, attach real screenshots or a short recording; ensure they contain no private projects or credentials. Maintainer review may request a narrower scope or additional verification.

Be respectful and specific in discussion. Critique work and ideas without harassment or personal attacks. See [the code of conduct](CODE_OF_CONDUCT.md) and [security reporting](SECURITY.md).
