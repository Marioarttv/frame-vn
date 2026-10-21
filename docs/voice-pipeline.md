# Voice authoring pipeline

The local authoring server sends a single character's dialogue to ElevenLabs `eleven_v4`, saves the returned MP3, and runs Rhubarb Lip Sync on the decoded audio. The resulting A–F/X mouth cues drive the character's existing expression-specific mouth rig. Blinking, gaze, brows and body motion remain reusable character animation layers; a new voice line does not regenerate the artwork or rig.

## Setup

Set `ELEVENLABS_API_KEY` in the server environment or an ignored `.env.local` file. Alternatively, set `ELEVENLABS_ENV_FILE` to an existing private environment file. The API key is only read on the server. It is never sent to the browser, embedded in a project export or stored in the attempt ledger.

Install FFmpeg (including `ffprobe`) and [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync). `RHUBARB_PATH` selects the Rhubarb executable; otherwise the server checks `.studio/tools/rhubarb` and then `PATH`. Keep the complete `res/` folder beside that executable; copying only the binary makes `--version` work while recognition fails. `FFMPEG_PATH` and `FFPROBE_PATH` can override those executable locations. Before submitting a paid voice request, the server checks tool availability, required recognition resources, and runs a local synthetic voiced-WAV PocketSphinx probe. The probe contains voiced harmonics because pure silence can bypass recognition. Successful probe results are reused for 30 seconds; failures for five seconds. Health reports `rhubarbExecutable` separately from functional `rhubarb` readiness and includes an actionable `alignmentError` when needed.

`npm run dev` and `npm run preview` use the same local API through `studioApiPlugin()`. `createStudioApi()` also exports a reusable Node HTTP middleware. This is a local authoring service; it deliberately rejects non-loopback connections. A public hosted service would need its own authentication, authorization, quotas and protected storage before enabling paid generation.

## API

| Endpoint                           | Response                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                  | Credential/tool availability, model, character limit and an ephemeral `sessionToken`. No credential value is returned. |
| `GET /api/library`                 | Optional locally imported character catalog and installed packs; an empty collection when none exists.                 |
| `GET /api/voices`                  | Current account voice inventory, following pagination and preserving category, labels and fine-tuning metadata.        |
| `POST /api/voice`                  | Generates or retrieves one voice line with synchronized mouth cues.                                                    |
| `POST /api/voice/attempts/archive` | `{id}`: archives one reconciled uncertain attempt. It never generates speech.                                          |

The voice request accepts `{text, voiceId, languageCode?, stability?, similarity?}`. Stability defaults to `0.5`, similarity to `0.75`; both range from 0 to 1. Language codes are two-letter ISO codes. Requests contain at most 2,000 characters and are never automatically split into additional paid requests. Direction tags such as `[quietly]` are passed to ElevenLabs but removed from the recognizer's transcript hint.

Voice POST requests require JSON, an `Origin` matching the local studio and `X-Studio-Token` containing the current health response's token. Host and loopback checks apply to the API and generated asset routes, and cross-site requests are rejected. The service does not enable CORS.

The response is `{id, audioSrc, cueUrl, duration, model, voiceId, cached, cueSource, requestId, characterCost}`. `requestId` and `characterCost` are provider response header values, or `null` when absent. Character cost is provider metadata, not a currency estimate. Audio and cues use `/generated/<sha256>.mp3` and `/generated/<sha256>.cues.json`; audio supports byte ranges for seeking.

## Alignment and reuse

FFmpeg fully decodes the returned audio to mono PCM. Rhubarb uses `pocketSphinx` for English and `phonetic` for other explicit languages, with `--extendedShapes X` to match the existing six mouth shapes plus rest. The server checks cue ordering, shape names, complete coverage and decoded duration. Measured silent intervals below −45 dB for at least 0.2 seconds close the mouth without replacing phoneme timing. Lip sync remains an approximation made from the actual audio, and should be checked visually for each character's mouth geometry.

The request's model, text, voice, language and settings form a content hash. Repeated identical requests reuse completed audio/cues. Concurrent identical submissions share one promise; an exclusive on-disk claim prevents a second process from independently paying for the same request.

Private output lives under ignored `.studio/voice/`: `assets/` contains audio and cues; `attempts/` contains one persistent record per request hash. These files do not enter the static build automatically. Project exports should explicitly embed selected audio and cue files when portability is requested.

Optional character packs under `public/local-packs/` are served locally in development and preview through the same loopback guard. Realpath containment blocks directory traversal and escaping symlinks; only raster images, supported audio and JSON files are served. The packs are still excluded from the distributable static build.

## Failure recovery

An attempt record is created before contacting ElevenLabs. Provider request IDs, character-cost headers, HTTP status and download state are saved as they become available. There are no automatic paid retries. A failed/interrupted request can have been billed; the same request returns `attempt_needs_review` until a person reconciles that attempt against ElevenLabs history. The `attempt_needs_review` error includes the request hash `id`, the provider `requestId` and the `attemptId`. After confirming an intentional new submission is appropriate, choose **I've checked — allow a new attempt** in the voice panel (or call the archive endpoint). The record moves to `.studio/voice/attempts/archive/<id>.<attemptId>.json` for cost reconciliation; nothing is submitted until you generate again. Attempts whose audio is already saved cannot be archived, because generating them again only repeats local alignment.

**Voice missing lines** in the scene builder voices every unvoiced line whose character has a voice. It shows the number of lines and the maximum character usage first, sends one request at a time only after confirmation, attaches each result as it arrives, and stops at the first failure. Continuing after a failure is a separate, explicit action.

If the MP3 downloaded successfully but local alignment failed, submitting the same dialogue repairs alignment from the saved MP3 without another ElevenLabs call. Fix the local tool problem first. The API does not substitute a different speech model, retrain a voice, use a professional voice as an instant clone, or reroll a performance automatically.

## Verification

`npm test` includes mocked-upstream tests for v4 request routing, persistent cache reuse, concurrent deduplication, uncertain billing failures, local alignment recovery, voice pagination, silence gating, input limits, same-origin protection and byte-range delivery. Those tests do not prove live account/model access or voice quality. A separately authorized live generation and browser playback verify those aspects.

References checked on 2026-10-02: [ElevenLabs Create dialogue](https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert), [ElevenLabs model catalog](https://elevenlabs.io/docs/overview/models).
