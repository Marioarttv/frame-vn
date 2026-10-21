# Troubleshooting

## Installation and startup

**Node version errors:** check `node --version`. Frame needs Node.js 22.12 or newer. Use `npm ci` with the committed lockfile.

**Port 5178 is in use:** keep the existing process if it belongs to other work. Start Frame with another `FRAME_PORT` value, for example `FRAME_PORT=5186 npm run dev`, and use that port in your browser. On PowerShell, set `$env:FRAME_PORT=5186` first.

**A project seems missing:** projects live in the current browser's storage for that exact origin. Check the browser profile and port you used. Import a previously exported project JSON if you moved to another browser or machine.

## Browsers and animation

**No authoring browser:** install Google Chrome or explicitly run `npm run setup:browser`. Frame does not download a browser automatically while compiling a rig. `FRAME_BROWSER_CHANNEL=chromium` selects an installed Playwright Chromium.

**A portrait does not move its mouth:** a static image has no facial rig. For a rigged portrait, check that its pack and referenced files load and that cues match the selected recording. Silence and missing cues intentionally leave the resting mouth visible.

**Motion is reduced:** check the operating system's reduced-motion preference. Idle motion is also suspended while the page is hidden. Reduced motion is part of the intended player behavior.

**A face looks wrong despite a successful build:** inspect the source, registered feature crops, open/half/closed states, and actual browser playback. A format check does not establish visual quality. Preserve the approved source and fix the local feature region.

## Audio and exports

**No sound:** click the player's start button, confirm the player is not muted, and inspect the voice/music/effects volume sliders. Browser autoplay policies require a user gesture.

**Voice generation is disabled:** read the local API health message. Follow the [voice setup guide](voice-pipeline.md); a server-side key, working FFmpeg/FFprobe, and Rhubarb with its recognition resources are required. Never put a provider key in a `VITE_` variable.

**A generation has an uncertain outcome:** inspect the saved attempt and any returned recording before manually retrying. Do not repeatedly click generate; a retry may create another paid request.

**HTML export reports missing media:** restore the required source file or remove its reference from the story. Export deliberately fails instead of producing a game with missing assets.

**An offline game requests a network resource:** keep the exported file and a minimal synthetic reproduction, then report it. A completed playable export is intended to embed every used resource. Test through `file://` with networking disabled.

**MP4 export is unavailable:** check FFmpeg, FFprobe, and Chromium first. See [video export](video-export.md). You can still export an offline playable game without these tools.

## Reporting a problem

Include your release/commit, OS, Node and browser versions, exact reproduction steps, and a sanitized error. Reproduce with the bundled examples when possible. Do not upload keys, private character packs, or recordings without the necessary permission. Security issues follow [SECURITY.md](../SECURITY.md).
