"""Word timings from ElevenLabs character timestamps saved beside a take. No provider calls.

Voicing through `text-to-dialogue/with-timestamps` saves `<key>.alignment.json` next to
`<key>.mp3`: the response without its audio, i.e. `alignment` and `normalized_alignment`
(characters with start and end seconds) and `voice_segments` (per dialogue input: character
index range and seconds). The aligner and retime.py use these words instead of a recognizer
when the file is present; takes without one keep the Whisper path.

The shape follows the API reference (read 2026-10-20); the first paid run must confirm it.
"""
import hashlib
import json
from pathlib import Path


def path_for(audio):
    """Where a take's alignment lives: beside the audio, `<key>.alignment.json`."""
    return Path(audio).with_suffix('.alignment.json')


def load(audio):
    """(alignment data, its SHA-256) for a take, or (None, None) when it has none."""
    path = path_for(audio)
    if not path.is_file():
        return None, None
    raw = path.read_bytes()
    data = json.loads(raw)
    alignment = data.get('alignment') or data.get('normalized_alignment')
    keys = ('characters', 'character_start_times_seconds', 'character_end_times_seconds')
    if not isinstance(alignment, dict) or not all(isinstance(alignment.get(k), list) for k in keys) \
            or not len(alignment['characters']) == len(alignment['character_start_times_seconds']) \
            == len(alignment['character_end_times_seconds']):
        raise ValueError(f'{path}: no usable character alignment; review the saved response.')
    return data, hashlib.sha256(raw).hexdigest()


def words(data):
    """[(word, start, end)] in seconds, in spoken order.

    Words break at whitespace and at every dialogue input boundary (inputs may follow each
    other without a space in the character stream). Bracketed audio tags such as
    `[sarcastic]` are not spoken and are left out.
    """
    alignment = data.get('alignment') or data.get('normalized_alignment')
    chars = alignment['characters']
    starts = alignment['character_start_times_seconds']
    ends = alignment['character_end_times_seconds']
    breaks = set()
    for segment in data.get('voice_segments') or []:
        breaks.add(segment.get('character_start_index'))
        breaks.add(segment.get('character_end_index'))
    out, current, depth = [], [], 0

    def flush():
        if current:
            text = ''.join(chars[i] for i in current)
            if any(c.isalnum() for c in text):
                out.append((text, round(starts[current[0]], 3), round(ends[current[-1]], 3)))
            current.clear()

    for i, char in enumerate(chars):
        if i in breaks:
            flush()
        if char == '[':
            flush()
            depth += 1
            continue
        if char == ']' and depth:
            depth -= 1
            continue
        if depth:
            continue
        if char.isspace():
            flush()
        else:
            current.append(i)
    flush()
    return out


def transcription(data):
    """The words as recognizer-style segments (text, offsets in ms) for align.match_lines."""
    return [dict(text=w, offsets={'from': round(s * 1000), 'to': round(e * 1000)}) for w, s, e in words(data)]
