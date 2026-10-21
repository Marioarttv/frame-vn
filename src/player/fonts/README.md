# Storybook fonts

Embedded in exported players only when a project uses the `storybook` font or the `grimoire`
or `title` text boxes (`scripts/build-player-runtime.mjs` turns them into
`src/player/fonts.generated.ts`).

| File | Family | Styles | Licence |
| --- | --- | --- | --- |
| `cormorant-garamond-latin.woff2` | Cormorant Garamond (variable weight) | normal, 300–700 | SIL OFL 1.1, `OFL-CormorantGaramond.txt` |
| `cormorant-garamond-italic-latin.woff2` | Cormorant Garamond (variable weight) | italic, 300–700 | SIL OFL 1.1, `OFL-CormorantGaramond.txt` |
| `cinzel-600-latin.woff2` | Cinzel | normal, 600 | SIL OFL 1.1, `OFL-Cinzel.txt` |

Source: the Latin subsets served by Google Fonts, fetched on 2026-10-18 from
`https://fonts.googleapis.com/css2?family=Cinzel:wght@600&family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&display=swap`
(cormorantgaramond v21, cinzel v26). Licence texts from `github.com/google/fonts` (`ofl/cinzel`,
`ofl/cormorantgaramond`). The fonts are unmodified; under the OFL they may be bundled and
redistributed with software but not sold by themselves.
