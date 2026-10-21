#!/usr/bin/env python3
"""Re-measure word starts and line cuts of an aligned chapter. Never calls a voice provider.

    python3 scripts/chapter/retime.py .studio/chapters/example/timeline.json
    python3 scripts/chapter/retime.py .studio/chapters/example/timeline.json --check

Run it after align.py (and after any chapter-specific edits to timeline.json). The small
Whisper model behind align.py places most word starts late (in a production chapter by a
median 0.2 s, a third of them by more than 0.3 s), so word-synced text fell behind the voice,
and a late first word moved some cuts into the next line's first sound. This step:

- takes each take's word timestamps from ElevenLabs' own character timestamps when the
  take has them (<key>.alignment.json beside its audio), else transcribes it again with
  Whisper large-v3-turbo (MLX, local; cached in work/<key>.turbo.json), and matches them to
  the timeline's own text, which stays authoritative;
- moves a word start that lies in silence to the sound that follows it;
- places each cut between two lines in the pause between the old line's last word and the
  new line's first word, 0.1 s before the new line's first sound;
- keeps the previous value wherever the new recognition does not cover a word, and keeps a
  cut that would move more than MAX_CUT_MOVE seconds (reported for review).

Retiming a fresh timeline keeps it as timeline.pre-retime.json. A report goes to
verification/retime-report.json (or next to the timeline). --check writes only the report.
Requires uv (https://docs.astral.sh/uv/), ffmpeg and Apple silicon for MLX.
"""
import argparse
import array
import difflib
import hashlib
import json
import shutil
import statistics
import subprocess
import sys
import wave
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import align  # noqa: E402
import provider_alignment  # noqa: E402

PREROLL = align.PREROLL     # silence kept before a line's first sound (s)
MIN_PAUSE = .1              # a pause this long separates two lines cleanly...
SHORT_PAUSE = .04           # ...or, in a quick exchange, at least this long
SNAP_AHEAD = .6             # a word start in silence moves to sound at most this far ahead (s)
SNAP_BACK = .4             # a start this soon after a pause moves back to the pause's end (s)
SEARCH = .35                # pause search around the recognized gap (s)
MAX_CUT_MOVE = 1.2          # larger cut moves are kept as they were and reported
END_GUARD = .04             # word starts stay this far inside their clip
SPEECH_DB = -45             # louder frames on both sides of a cut mean it lies inside speech
BELOW_SPEECH = 32           # ...and a pause is at least this far (dB) below the loudest nearby speech


def tokens_of(text):
    return [align.words(token) for token in text.split()]


def match_tokens(token_parts, heard):
    """Start and end (s) of every token, from recognized words; None where unheard.

    token_parts: per token, its normalized words (possibly none, e.g. a dash).
    heard: [(word, start, end)] in order.
    """
    expected, owner = [], []
    for index, parts in enumerate(token_parts):
        for part in parts:
            expected.append(part)
            owner.append(index)
    words, times = [], []
    for word, start, end in heard:
        parts = align.words(word)
        for i, part in enumerate(parts):
            words.append(part)
            span = (end - start) / max(1, len(parts))
            times.append((start + i * span, start + (i + 1) * span))
    vocabulary = set(expected)
    i = 0
    while i + 1 < len(words):
        joined = words[i] + words[i + 1]
        if joined in vocabulary and joined not in (words[i], words[i + 1]):
            words[i:i + 2] = [joined]
            times[i:i + 2] = [(times[i][0], times[i + 1][1])]
        else:
            i += 1
    matcher = difflib.SequenceMatcher(None, expected, words, autojunk=False)
    mapping = {}
    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            mapping[block.a + k] = block.b + k
    # Misspelled names still occupy audio: pair the rest of a replaced stretch in order by
    # spelling, even where the recognizer also dropped or added a word.
    for tag, a, b, c, d in matcher.get_opcodes():
        if tag != "replace":
            continue
        y = c
        for x in range(a, b):
            for candidate in range(y, d):
                if difflib.SequenceMatcher(None, expected[x], words[candidate]).ratio() >= .6:
                    mapping[x] = candidate
                    y = candidate + 1
                    break
    starts = [None] * len(token_parts)
    ends = [None] * len(token_parts)
    for e, h in mapping.items():
        token = owner[e]
        start, end = times[h]
        starts[token] = start if starts[token] is None else min(starts[token], start)
        ends[token] = end if ends[token] is None else max(ends[token], end)
    return starts, ends, len(mapping), len(expected)


class Levels:
    """10 ms frame levels of one take, with the local quiet threshold of align.py."""

    def __init__(self, samples, rate):
        self.samples, self.rate = samples, rate
        self.db = [level for _, level in align.frame_levels(samples, rate, 0, len(samples) / rate)]

    def quiet(self, t):
        """Frames below this level count as a pause: near the local noise floor (as in align.py)
        or, in takes with a reverb tail, far enough below the surrounding speech."""
        lo, hi = max(0, int((t - 1) * 100)), int((t + 1) * 100)
        window = self.db[lo:hi] or [-99]
        return min(align.QUIET_DB, max(align.QUIET_FLOOR_DB, min(window) + align.QUIET_ABOVE_FLOOR,
                                       max(window) - BELOW_SPEECH))

    def level(self, t):
        f = int(round(t * 100))
        return self.db[f] if 0 <= f < len(self.db) else -99

    def runs(self, lo, hi, threshold):
        """Quiet runs (start, end) overlapping lo..hi; a run is followed to its real end."""
        out, begin = [], None
        f = max(0, int(lo * 100))
        while f < len(self.db):
            t = f / 100
            if self.db[f] < threshold:
                if begin is None:
                    if t >= hi:
                        break
                    begin = t
            elif begin is not None:
                out.append((begin, t))
                begin = None
                if t >= hi:
                    break
            elif t >= hi:
                break
            f += 1
        if begin is not None:
            out.append((begin, len(self.db) / 100))
        return out

    def snap(self, t, limit, floor=0.0):
        """A word cannot start in silence: move a start that lies in a pause to the next sound.
        A start shortly after a pause moves back to the sound that ends it (recognizers place
        such words a little late); floor keeps it after the previous word's start."""
        threshold = self.quiet(t)
        if self.level(t) >= threshold:
            for begin, end in reversed(self.runs(t - SNAP_BACK - MIN_PAUSE, t, threshold)):
                if end - begin >= MIN_PAUSE * .8 and t - SNAP_BACK <= end <= t:
                    return round(max(floor, min(t, end - .02)), 3)
            return t
        for begin, end in self.runs(t, t + .01, threshold):
            if begin <= t < end and end <= min(limit, t + SNAP_AHEAD):
                return round(max(t, end - .02), 3)
        return t

    def in_sound(self, cut):
        """Speech right before and right after a cut: the cut lies inside a sound."""
        threshold = max(self.quiet(cut), SPEECH_DB)
        f = int(round(cut * 100))
        before = max(self.db[max(0, f - 6):f] or [-99])
        after = max(self.db[f:f + 3] or [-99])
        return before >= threshold and after >= threshold

    def quietest(self, lo, hi):
        """The quietest 10 ms frame between lo and hi (None if the span is empty)."""
        frames = range(max(0, int(lo * 100)), min(len(self.db), int(hi * 100) + 1))
        return round(min(frames, key=lambda f: self.db[f]) / 100, 3) if frames else None

    def cut(self, left, right, earliest, latest):
        """Cut in the pause between the old line's last word (ends at left) and the new line's
        first word (starts at right), PREROLL before the new sound. None if there is no pause."""
        lo = max(earliest, min(left, right) - SEARCH)
        hi = min(latest, max(left, right) + SEARCH)
        if hi <= lo:
            return None
        threshold = self.quiet((left + right) / 2)
        for shortest in (MIN_PAUSE, SHORT_PAUSE):
            runs = [(b, min(e, latest)) for b, e in self.runs(lo, hi, threshold)
                    if min(e, latest) - max(b, lo) >= shortest]
            if runs:
                gap = (min(left, right), max(left, right))
                distance = lambda r: max(0, r[0] - gap[1], gap[0] - r[1])
                begin, onset = min(runs, key=lambda r: (round(distance(r), 2), -(r[1] - r[0])))
                return round(max((begin + onset) / 2, onset - PREROLL), 3)
        return None


def load_wav(path):
    with wave.open(str(path), "rb") as stream:
        return array.array("h", stream.readframes(stream.getnframes())), stream.getframerate()


def heard_words(chunk, wav, work):
    """(words, source): the take's ElevenLabs timestamps when saved with it, else Whisper turbo.
    The acoustic steps (snapping to sound, cuts in the measured pause, the checks) run either way."""
    data, _ = provider_alignment.load(chunk["audio"])
    if data is not None:
        return [dict(w=w, s=s, e=e) for w, s, e in provider_alignment.words(data)], "elevenlabs"
    return turbo(chunk, wav, work), "whisper-large-v3-turbo"


def turbo(chunk, wav, work):
    """Cached large-v3-turbo word timestamps for a take."""
    source = hashlib.sha256(Path(chunk["audio"]).read_bytes()).hexdigest()
    cache = work / f"{chunk['key']}.turbo.json"
    try:
        data = json.loads(cache.read_text())
        if data.get("sourceSha256") == source:
            return data["words"]
    except (OSError, ValueError, KeyError):
        pass
    if not shutil.which("uv"):
        raise SystemExit("retime.py needs uv to run Whisper large-v3-turbo (brew install uv).")
    print(f"Transcribing {chunk['key']} (large-v3-turbo)", flush=True)
    raw = work / f"{chunk['key']}.turbo.raw.json"
    subprocess.run(["uv", "run", "-q", "--no-project", "--with", "mlx-whisper", "python", "-I",
                    str(HERE / "turbo_words.py"), str(wav), str(raw)], check=True)
    data = json.loads(raw.read_text())
    raw.unlink()
    data["sourceSha256"] = source
    cache.write_text(json.dumps(data))
    return data["words"]


def words_across(lines, cuts, starts, ends):
    """Lines whose recognized last word starts after their clip ends, or whose first word ends
    before their clip starts: a whole word would play under the wrong text box."""
    out = []
    for i in range(1, len(lines)):
        last = next((x for x in reversed(starts[i - 1]) if x is not None), None)
        first = next((x for x in ends[i] if x is not None), None)
        if (last is not None and last > cuts[i]) or (first is not None and first < cuts[i]):
            out.append(lines[i]["id"])
    return out


def retime_chunk(lines, heard, levels, offset, duration):
    """New cuts and word starts (chunk seconds) for one take's lines, plus a report."""
    old_cuts = [line["start"] - offset for line in lines] + [lines[-1]["end"] - offset]
    old_words = [[t - offset for t in line.get("words", [])] for line in lines]
    starts, ends, report = [], [], dict(flagged=[])
    token_parts = [tokens_of(line["text"]) for line in lines]
    flat = [parts for line in token_parts for parts in line]
    s, e, matched, expected = match_tokens(flat, [(w["w"], w["s"], w["e"]) for w in heard])
    report.update(matched=matched, expected=expected)
    k = 0
    for parts in token_parts:
        starts.append(s[k:k + len(parts)])
        ends.append(e[k:k + len(parts)])
        k += len(parts)

    # Cuts: the first line starts with the take, the last ends with it.
    cuts = [old_cuts[0]]
    for i in range(1, len(lines)):
        previous_end = next((x for x in reversed(ends[i - 1]) if x is not None), None)
        first = next((x for x in starts[i] if x is not None), None)
        left = previous_end if previous_end is not None else old_cuts[i]
        right = first if first is not None else old_cuts[i] + PREROLL
        if first is not None:
            right = levels.snap(first, (ends[i][starts[i].index(first)] or first + SNAP_AHEAD))
        earliest = max(cuts[-1] + .05, next((x for x in starts[i - 1] if x is not None), cuts[-1]))
        later = [x for x in starts[i][1:] if x is not None]
        latest = min(old_cuts[i + 1] - .05, later[0] if later else right + SNAP_AHEAD)
        cut = levels.cut(left, right, earliest, max(latest, right))
        reason = None
        if cut is None and levels.in_sound(old_cuts[i]):
            # No pause at all (a quick exchange): the quietest moment between the two words
            # beats a cut inside a sound.
            cut = levels.quietest(max(earliest, min(left, right) - .1), min(max(latest, right), max(left, right) + .1))
        if cut is None:
            reason = "no pause near the recognized gap"
        elif abs(cut - old_cuts[i]) > MAX_CUT_MOVE:
            reason = f"would move {cut - old_cuts[i]:+.2f} s"
        elif cut <= cuts[-1] + .05:
            reason = "out of order"
        if reason:
            report["flagged"].append(dict(id=lines[i]["id"], at=round(old_cuts[i], 3), kept=True,
                                          proposed=cut, reason=reason))
            cut = old_cuts[i]
        cuts.append(cut)
    cuts.append(old_cuts[-1])

    words = []
    for i, line in enumerate(lines):
        lo, hi = cuts[i], cuts[i + 1]
        values = []
        for j, start in enumerate(starts[i]):
            if start is None:
                values.append(None)
                continue
            limit = ends[i][j] if ends[i][j] is not None else start + SNAP_AHEAD
            floor = next((x for x in reversed(starts[i][:j]) if x is not None), lo - .1) + .1
            values.append(levels.snap(start, min(limit, hi), max(lo, floor)))
        # Unheard words: between two heard ones, interpolate; at the start, take the next one;
        # at the end, keep the previous measurement (or leave them to the player's pace).
        known = [j for j, v in enumerate(values) if v is not None]
        if not known:
            values = list(old_words[i])
        else:
            for j in range(len(values)):
                if values[j] is not None:
                    continue
                before = [x for x in known if x < j]
                after = [x for x in known if x > j]
                if before and after:
                    a, b = before[-1], after[0]
                    values[j] = values[a] + (values[b] - values[a]) * (j - a) / (b - a)
                elif after:
                    values[j] = values[after[0]]
            while values and values[-1] is None:
                j = len(values) - 1
                if j < len(old_words[i]):
                    values[j] = old_words[i][j]
                    break
                values.pop()
            values = [v if v is not None else old_words[i][j] for j, v in enumerate(values)]
        clipped = [min(max(v, lo), max(lo, hi - END_GUARD)) for v in values]
        if clipped:
            clipped[0] = min(clipped[0], lo + PREROLL)
        for j in range(1, len(clipped)):
            clipped[j] = max(clipped[j], clipped[j - 1])
        words.append([round(v, 3) for v in clipped])
    report["wordsAcrossCut"] = words_across(lines, cuts, starts, ends)
    report["cutsMoved"] = sum(abs(a - b) > .05 for a, b in zip(cuts, old_cuts))
    report["largestCutMove"] = round(max((abs(a - b) for a, b in zip(cuts, old_cuts)), default=0), 3)
    report["cutsInSoundBefore"] = [lines[i]["id"] for i in range(1, len(lines)) if levels.in_sound(old_cuts[i])]
    report["cutsInSoundAfter"] = [lines[i]["id"] for i in range(1, len(lines)) if levels.in_sound(cuts[i])]
    shifts = [n - o for old, new in zip(old_words, words) for o, n in zip(old, new)]
    report["medianWordShift"] = round(statistics.median(shifts), 3) if shifts else 0
    return cuts, words, report


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("timeline", type=Path)
    parser.add_argument("--input", type=Path, help="align.py input JSON (default: input.json beside the timeline)")
    parser.add_argument("--work", type=Path, help="align.py work folder (default: work/ beside the timeline)")
    parser.add_argument("--check", action="store_true", help="write only the report")
    args = parser.parse_args()
    folder = args.timeline.resolve().parent
    plan = json.loads((args.input or folder / "input.json").read_text())
    work = args.work or folder / "work"
    work.mkdir(parents=True, exist_ok=True)
    timeline = json.loads(args.timeline.read_text())
    music = plan.get("musicOffset", 0)
    chunks = {chunk["key"]: chunk for chunk in plan["chunks"]}
    reports = []
    for key, chunk in chunks.items():
        lines = [line for line in timeline["lines"] if line.get("chunk") == key]
        if not lines:
            continue
        wav = work / f"{key}.wav"
        if not wav.exists():
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", chunk["audio"], "-ar", "16000", "-ac", "1",
                            str(wav)], check=True)
        offset = music + chunk["offset"]
        levels = Levels(*load_wav(wav))
        heard, source = heard_words(chunk, wav, work)
        cuts, words, report = retime_chunk(lines, heard, levels, offset, chunk["duration"])
        if source != "whisper-large-v3-turbo":
            report["timing"] = source
        for i, line in enumerate(lines):
            line["start"], line["end"] = round(offset + cuts[i], 4), round(offset + cuts[i + 1], 4)
            if "chunkStart" in line:
                line["chunkStart"], line["chunkEnd"] = cuts[i], cuts[i + 1]
            line["words"] = [round(offset + t, 4) for t in words[i]]
        report["key"] = key
        reports.append(report)
        print(f"{key}: {report['matched']}/{report['expected']} words heard, {report['cutsMoved']} cuts moved, "
              f"cuts in speech {len(report['cutsInSoundBefore'])} -> {len(report['cutsInSoundAfter'])}, "
              f"{len(report['wordsAcrossCut'])} words across a cut, "
              f"median word shift {report['medianWordShift']:+.3f} s, {len(report['flagged'])} kept for review",
              flush=True)
    provider = any(r.get("timing") == "elevenlabs" for r in reports)
    summary = dict(method=("ElevenLabs character timestamps where saved with the take, else " if provider else "") +
                          "Whisper large-v3-turbo word timestamps (MLX), silence-snapped; cuts in the measured "
                          "pause between lines", timeline=str(args.timeline), checkOnly=args.check, chunks=reports)
    verification = folder / "verification"
    target = (verification if verification.is_dir() else folder) / "retime-report.json"
    target.write_text(json.dumps(summary, indent=2) + "\n")
    if args.check:
        return
    if "retimed" not in json.loads(args.timeline.read_text()):
        shutil.copyfile(args.timeline, folder / "timeline.pre-retime.json")
    timeline["retimed"] = dict(method=summary["method"], version=1)
    args.timeline.write_text(json.dumps(timeline, ensure_ascii=False, indent=2) + "\n")
    print(f"Wrote {args.timeline}; report {target}")


if __name__ == "__main__":
    main()
