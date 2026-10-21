# Existing audio to a voiced chapter

`scripts/chapter/align.py` and `scripts/chapter/build.ts` reuse existing full-cast
recordings. They perform local recognition, splicing and lip-sync alignment;
they never call a paid voice service. A supplied speaker-labelled transcript
determines the cast. Recognition only supplies timing, and never rewrites text.

Keep chapter text, config, recordings and outputs in ignored `.studio/` and
`public/local-packs/`. Do not commit third-party chapters or character artwork.

## Prepare local input

Create an input JSON with:

- `title`, `masterAudio` (absolute filename), `masterDuration` (seconds).
- `musicOffset`: seconds before the first source take in the master recording.
- `chunks`: ordered takes with `key`, `audio` (absolute filename), `duration`,
  `offset` (seconds from the first source take, including intervening pauses),
  optional `marker`, and `inputs` with `speaker`, `text`, optional source `line`.

The source takes must exactly match the master, without time stretching or
reordering. If a source is continuous, supply it as one chunk at offset zero.
Confirm the transcript and speaker assignments before processing.

```sh
python3 scripts/chapter/align.py .studio/chapters/example/input.json \
  --model /absolute/path/to/ggml-small.bin \
  --output .studio/chapters/example/timeline.json
python3 scripts/chapter/test_align.py
```

This requires local `whisper-cli`, `ffmpeg`, `ffprobe` and a compatible Whisper
model.

Where the recognizer is wrong and the audio is clear, add reviewed timing annotations
with `--overrides overrides.json`: per take key, the take's `sourceSha256` (so the notes
cannot drift onto another recording) and a list of `annotations`. `{"replaceText":
[old, new]}` corrects a misheard spelling, `{"replaceIndex": i, "segment": {...}}`
re-times recognized segment `i`, and `{"segment": {...}}` adds a word it missed, timed
from the measured audio. The cached recognition stays as heard; the timeline lists the
annotated takes. Intermediate word transcriptions are retained under `work/`. Repeated
phrases are matched monotonically; compound words and spelling variations of
names retain their whole audio span. Uncertain utterances stop the export.

Recognized word edges are approximate: a word's end often runs into the next word,
and a first word is often placed late. Each cut between two lines is therefore
placed in the measured pause near the recognized gap (up to 0.8 s before it or
0.4 s after it), 0.1 s before the next line's first sound. Silence is judged
against the local noise floor, and a pause must last 0.1 s, so soft consonants
("f", "h") and the closure before a plosive ("b", "t") stay with their word. No
clip then ends with the start of the next line or begins mid-word, which in the
player sounded like a stutter across the text-box change. Each line in
`timeline.json` also lists `words`: the start of every displayed word in master
seconds, measured against these cuts; the build uses them for word-synced text.
Review the resulting boundaries, especially stammers, omitted words and adjacent
voice changes. Recognition confidence and technical validation are not listening
acceptance. Cached word transcriptions are invalidated when the source recording
or local model changes; changed speaker/text annotations are matched afresh.

## Takes voiced with ElevenLabs timestamps

A take voiced through ElevenLabs' `text-to-dialogue/with-timestamps` endpoint (same price
as plain dialogue) can be saved with its response, minus the audio, as
`<key>.alignment.json` beside `<key>.mp3`: `alignment` (and `normalized_alignment`), the
start and end of every character, and `voice_segments`, which dialogue input each stretch
of characters belongs to. When a take has this file, `align.py` and `retime.py` take its
word starts from it instead of a recognizer (no Whisper model is loaded for it). Words
break at whitespace and between inputs; bracketed audio tags are left out. The acoustic
steps still run: cuts are placed in the measured pause before the next line's first sound,
word starts snap to sound, and the report checks for cuts inside speech and words across a
cut. Reviewed timing annotations (`--overrides`) are for recognizer output and are refused
for such a take. Takes without the file keep the Whisper path. The timeline's chunk
reports and the re-timing report mark these takes `"timing": "elevenlabs"`.

The file's shape follows the API reference as read on 2026-10-20
(`scripts/chapter/fixtures/dialogue-with-timestamps.alignment.json` is a hand-made example).
The first real voicing run must confirm it: whether audio tags appear among the characters
and with what times, how inputs are joined in the character stream, and whether
`voice_segments` index `alignment` or `normalized_alignment`.

## Re-time words and cuts

```sh
python3 scripts/chapter/retime.py .studio/chapters/example/timeline.json
python3 scripts/chapter/test_retime.py
```

Run this after `align.py` and after any chapter-specific edits to `timeline.json`, then
build. The small Whisper model gives word starts that are often late. Review a few cuts by ear before building a full chapter; alignment quality depends on the recording and recognizer.

`retime.py` transcribes each take again with Whisper large-v3-turbo word timestamps
(MLX on Apple silicon through `uv`, cached as `work/<key>.turbo.json`) and matches the
words to the timeline's own text, which stays authoritative. It moves a word start that
lies in silence, or just after a pause, to the sound itself. It then places each cut in
the pause between the old line's last word and the new line's first word, 0.1 s before
the new sound. On the same chapters, the error at phrase starts fell to about 0.03 s.
Cuts inside speech went from 21 to 0. A word that the new recognition misses keeps its
earlier time. A cut that would move more than 1.2 s, or that has no pause nearby and
already lies in silence, is kept and listed for review.

The first run on a fresh timeline saves it as `timeline.pre-retime.json`. The report,
`verification/retime-report.json` (or beside the timeline), lists for each take:

- words heard
- cuts moved
- cuts inside speech, before and after
- whole words that would play under the wrong text box
- the cuts kept for review

`--check` writes only the report.

The player writes each timed word completely 0.3 s (`VOICE_MARGIN_MS`) before its
measured start. The voice waits up to 0.6 s at the start of a line so the first words
are ready. When several words share nearly the same start, they are written earlier
rather than pushed behind the voice.

## Build the set

Create a local config JSON with `id`, `title`, `engineRoot`, `timeline`, `input`,
`output`, `rhubarb`, `credit`, `creditLink`, and `roles`. Paths are absolute.
Each role has `name`, `voiceId`, optional `packs` (installed pack directory IDs)
and `pose` (pose name), plus optional `flip` for stage mirroring. A role without packs is voice-only.
A role without `voiceId` is silent (an animal, say): it can be staged but never speak a
line, and its packs may be mouthless (`capabilities.mouth: false`). A role may set
`expressionChange: "cut"` when its poses are separate drawings that cannot morph; it then
switches poses with a cut while everyone else morphs. Every pack of a role shares one
character ID, unless the role lists `aliases`: the character IDs of packs drawn for it later
under their own ID (an expression pack made after the first pose), whose poses then join the
first pack's character and morph with its poses. Any number of roles may have
artwork. Without a `direction`, the first remains visible from the opening and each other
appears at its first spoken passage. The source
voice must already be correct; assigning a different voice ID does not transform an
existing recording. `fileStem` names the outputs (default `chapter-1`).

```sh
node --import tsx scripts/chapter/build.ts .studio/chapters/example/config.json
```

Outputs:

- `<fileStem>.html`: self-contained continuous player using the unchanged master
  audio, an audio-clock transcript, line navigation, seek, mute, speed and replay.
  Only the current speaker receives speech shapes; narration keeps mouths at rest.
- `<fileStem>-engine.html`: the standard engine's self-contained playable export.
- `<fileStem>.frame.json`: editable project referencing this studio's local packs.
  Import it through the project menu, or choose the installed chapter template.
  This JSON requires the installed private media; the HTML exports work elsewhere.
- `line-index.tsv`, source timeline and validation evidence.
- `public/local-packs/<id>/`: individual audio clips, line and whole-chapter
  mouth cues, catalog and `stories/chapter.json`.

Clips partition the master without dropping the intro, inter-take pauses or
closing credits/music. They are re-encoded for ordinary engine playback; the
continuous player retains the original master byte-for-byte. Rhubarb results are
cached against audio and transcript hashes. A rebuild replaces only this task's
named output files. Pick a fresh ID/output folder for an independent chapter.

Open both exported HTML files using `file://`, verify speaker handoffs and lip
sync against real audio, and test narration/rest, pause, mute, seeking, replay,
reduced motion and mobile layout. The local project should also be imported into
the studio and played there. Same-origin chapter cues are allowed under
`/local-packs/<pack>/cues/<line>.json`, independently of the portrait's pack.

## Staging a chapter

`config.json` may add `direction` (a staging script) and `wordTimes` (per-line word
start times in seconds from each clip's start, one per word of the displayed text).
Word times in the timeline take precedence; `wordTimes` serves timelines aligned
before they were recorded there, and must be remade whenever the timeline is.
Roles may list several packs of the same character, one per expression pose.

The direction file names a private media pack and its `backgrounds`, `music` and
`sfx`, a `theme`, character `colors` and stage `positions`, `lights` presets (scene
light on the characters, by name; a preset named after a background is used
automatically whenever that background is set), `inserts` (silent scenes such as
title cards, placed before a line, held for `seconds`), `ending` (the end card's `music`, such
as an outro jingle, and `ambience`; `null` stops what was playing) and per-line `lines` cues.
Cues are sticky until changed: `bg`, `weather`, `grade`, `motion`, `camera`,
`light`, `cast` (roles on stage) and `expr` (role to pose name). One-off cues:
`music`, `sfx`, `transition`, `enter`/`exit`/`emote` (role to motion), `shake`, `fx`,
`textbox`, `textEffect`, `text` (a display override such as a title) and `tags`,
inline markup inserted before the first word starting with the given text, so
effects fire on that spoken word. Without `direction` the build behaves as before.

Some screen effects have a moment that sound or picture should meet, counted from the word
their tag sits on and listed with each effect's length in `SCREEN_FX_MS`
(`src/player/screen-fx.ts`): `thread` snaps at 1.8 s, and `transform` peaks at 1.3 s
(`TRANSFORM_PEAK_MS`), when its smoke column hides a figure-sized region, so a cut or a
sprite swap placed there is not seen; `binding` flares at its tightest at 1.2 s
(`BINDING_PEAK_MS`), and `fracture` tears its shard away at 0.9 s (`FRACTURE_PEAK_MS`). A sound
lands on such a moment with a fixed lead from the tagged word rather than from word times.
Place `binding` on the throat of the bound person (for a portrait at mark 50, about
`{fx=binding,50,45}`) and `fracture` on the chest. The `raindrops` weather is rain on the
camera's glass (it fades in over 2 s and stays while scenes keep it); unlike other weather it
stays with reduced motion, as still beads. An `enter` or `exit` cue of `uncloak` brings a
role on, or takes it off, under a translucent veil (1.4 s).

The player keeps a staged chapter readable without chapter-specific code:

- each character blinks on its own rhythm, also right after an expression morph;
- a change of background under a transition that does not cover the frame (anything but
  `fade`) takes the outgoing portraits with the old picture, and on a `cut` newcomers are
  simply there, so nobody stands over the wrong place for a moment;
- on narrow screens portraits are lifted above a tall text panel and backgrounds are shown
  whole;
- a recording holds its end card 2.2 s, and while a closing track that does not loop (an
  outro jingle on the end node's `musicId`) plays out, then 1 s more: the curtain never cuts
  it off;
- `FramePlayer.sampleActors()` returns the animation status of every portrait on stage, for
  automated checks of speech, rest and blinks.

An export may append its own CSS (`exportStandaloneHtml(project, { styles })`, also for
recordings), for a production's look: glyph speed, or a soft lower edge on one character.
