# Release verification

Frame v0.1.0 starts with an independent source history and original distributable examples. This record distinguishes automated checks, technical visual review, and the maintainer's design approval.

## Release boundaries

- Source code was copied through an explicit allowlist into a separate repository. The original project was not modified.
- The maintainer confirmed ownership of the adapted animation code and authorized MIT licensing. This does not relicense third-party media.
- Private local packs, authoring state, environment files, recordings, generated provider data, production verification media, machine-specific asset maps, and prior project history are excluded.
- The original examples retain source art, raw edit candidates, hashes, approval records, calibration, and stated reuse terms. No franchise character images or private reference images are included.
- `npm run audit:release` checks tracked/distribution paths and common secret patterns. The release was also reviewed for private references, asset provenance, applicable notices, and unwanted files. Automated pattern checks supplement review; they do not establish legal ownership.

## Verified locally

| Check | Result |
| --- | --- |
| Clean dependency installation | `npm ci` passed |
| Dependency advisories | `npm audit --audit-level=high`: zero vulnerabilities reported |
| Unit/integration checks | 140 passed, 1 skipped |
| Browser flows | 28 passed, including the storyboard composition regression |
| Production build | Passed; React is split into a cached vendor chunk |
| Production studio smoke | Both examples load; storyboard and game export work |
| Offline game | Actual exported HTML opened with `file://`, networking disabled; both original rigs render with zero HTTP requests or page errors |
| Pixel preservation | Approved source copies hash-identical; neutral rendering/restoration exact; blinking while speaking changes no pixels outside the calibrated eye regions |
| Visual review | Native and 2× mouth states, partial/full blinks, source-pixel brows, plus natural-speed silent playback checked |
| Walkthrough | Real studio screenshots and a silent edit/play/export recording; no provider generation |

The skipped test checks expression pairs in optional installed local packs. Those private packs are absent from a clean checkout. The public examples each have one pose; their own asset, geometry, pixel, and offline checks run separately. This is not a claim that multi-expression artistic transitions have been reviewed for these single-pose examples.

Local verification ran on macOS. CI repeats installation, audit, tests, build, release-boundary checks, and browser flows on Linux with Node.js 22. See the [current CI result](https://github.com/Marioarttv/frame-vn/actions/workflows/ci.yml). Tests block paid generation and use synthetic or mocked provider responses.

## Approval and limitations

The maintainer approved both revised character identities/outfits before rigging. Technical rig review is recorded separately in each character's provenance; design approval is not presented as approval of every generated edit.

Each example has one everyday pose and no voice recording/provider voice ID. Mira's hair-covered brow stays fixed; no separate hair layers are supplied. New character art needs deliberate calibration. Optional voice generation and MP4 rendering need the tools described in their guides. No paid provider performance was generated for this release.

## Maintenance and program preparation

The repository includes contribution guidance, security reporting, a code of conduct, issue forms, dependency updates, and CI for pull requests/default-branch changes. The source, original art, and imported media have explicit licensing boundaries.

This is a newly public project. Adoption, ecosystem impact, and sustained public maintenance must be reported as they develop. No stars, users, downloads, contributors, endorsements, or completed human animation approvals are invented. Applying to an external maintainer program is a separate user action.
