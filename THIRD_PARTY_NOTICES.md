# Third-party notices

Frame's original engine code, documentation, and original starter assets are available under the MIT license in [LICENSE](LICENSE). Third-party components retain their own licenses. Your imported artwork, voices, music, and stories are not relicensed by Frame.

## Bundled fonts

The studio uses DM Sans and Manrope through the `@fontsource/dm-sans` and `@fontsource/manrope` packages, licensed under SIL Open Font License 1.1. Their complete license texts ship with those packages.

The portable storybook player embeds the following unmodified Google Fonts subsets only when a story uses the corresponding presentation:

| Family | Included styles | License |
| --- | --- | --- |
| Cinzel | 600, Latin | [SIL OFL 1.1](src/player/fonts/OFL-Cinzel.txt) |
| Cormorant Garamond | Normal and italic variable weights, Latin | [SIL OFL 1.1](src/player/fonts/OFL-CormorantGaramond.txt) |

See [font provenance](src/player/fonts/README.md) for the source URLs and retrieval record. Preserve these notices when redistributing the fonts. Fonts are not covered by Frame's MIT license.

## JavaScript dependencies

React and React DOM use the MIT license. Lucide React uses the ISC license, with its upstream icon attribution obligations. DM Sans and Manrope use SIL OFL 1.1. Build and test dependencies have their own licenses, including MIT, Apache-2.0, ISC, BSD-3-Clause, and CC-BY-4.0. Exact installed versions are locked in `package-lock.json`.

`npm run notices` produces the installed dependency license inventory and full available license texts for redistribution. Review the resulting inventory when dependencies change. A package's declared license is provenance information, not a substitute for its full terms.

## Optional tools and services

Chromium/Google Chrome, FFmpeg/FFprobe, Rhubarb Lip Sync, and optional speech-alignment tools are installed separately and are not distributed in this source repository. Their licenses and any external model terms apply separately. ElevenLabs is an optional external service governed by its provider terms; no provider account, voice, or generated performance is included by the code license.

## Example artwork

The public example cast is included as original designs. No third-party franchise character artwork, private reference images, private recordings, or imported cast packs are included. Each shipped character has retained source and edit generations, hashes, an approved design record, and calibrated runtime assets. See [example characters](docs/example-characters.md) and the per-character provenance under `art/characters/`. These AI-assisted assets are offered under MIT to the extent rights are held; AI-generated artwork may not be copyrightable in every jurisdiction.
