#!/usr/bin/env python3
"""Align existing, speaker-labelled takes locally. Never calls a voice provider.

Input JSON: masterAudio, masterDuration, musicOffset, chunks[]. Each chunk has
audio, offset, duration, key, inputs[{speaker,text,line}], optional marker.
Word times come from ElevenLabs' own character timestamps when the take has them
(<key>.alignment.json beside its audio, saved when voicing with timestamps), else from
local Whisper; the supplied transcript remains authoritative. Speaker boundaries are placed
between matched words, preferably in silence.
"""
import argparse
import math
import array
import difflib
import hashlib
import json
import re
import subprocess
import sys
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import provider_alignment  # noqa: E402


def words(text):
    return re.findall(r"[a-z0-9]+(?:'[a-z]+)?", text.lower().replace('’', "'"))


def spoken(text):
    return re.sub(r'\[[^\]]*\]', '', text).strip()


def word_starts(text, first, mapping, times):
    """Start time of each whitespace-separated word of `text` (as the player splits it).

    `first` is the index of the text's first recognizable word in the matched sequence.
    Words the recognizer missed are interpolated; trailing unmatched words are left out,
    so the player paces them normally.
    """
    starts, index = [], first
    for token in text.split():
        heard = [times[mapping[i]][0] for i in range(index, index+len(words(token))) if i in mapping]
        index += len(words(token))
        starts.append(min(heard) if heard else None)
    while starts and starts[-1] is None:
        starts.pop()
    for i, value in enumerate(starts):
        if value is None:
            before = next(starts[j] for j in range(i-1, -1, -1) if starts[j] is not None) if any(x is not None for x in starts[:i]) else None
            after = next(x for x in starts[i+1:] if x is not None)
            starts[i] = after if before is None else (before+after)/2
    for i in range(1, len(starts)):
        starts[i] = max(starts[i], starts[i-1])
    return starts


def match_lines(inputs, transcription):
    """Monotonic transcript matching, with explicit coverage for each utterance."""
    heard, times = [], []
    for segment in transcription:
        tokens = words(segment['text'])
        start, end = (segment['offsets'][k] / 1000 for k in ('from', 'to'))
        for i, token in enumerate(tokens):
            heard.append(token)
            times.append((start + (end-start)*i/len(tokens), start + (end-start)*(i+1)/len(tokens)))
    expected, spans = [], []
    for item in inputs:
        start = len(expected)
        expected.extend(words(spoken(item['text'])))
        spans.append((start, len(expected)))
    # ASR commonly splits compounds (pureblood -> pure blood). Join only when
    # the complete compound occurs in the authoritative transcript.
    vocabulary = set(expected)
    i = 0
    while i+1 < len(heard):
        if heard[i]+heard[i+1] in vocabulary and heard[i]+heard[i+1] not in (heard[i],heard[i+1]):
            heard[i:i+2] = [heard[i]+heard[i+1]]
            times[i:i+2] = [(times[i][0],times[i+1][1])]
        else:
            i += 1
    mapping = {}
    matcher = difflib.SequenceMatcher(None, expected, heard, autojunk=False)
    for block in matcher.get_matching_blocks():
        for i in range(block.size):
            mapping[block.a+i] = block.b+i
    # A misspelled proper name still occupies audio. Include a close spelling
    # between exact anchors so a speaker cut never slices that final word.
    for tag,a,b,c,d in matcher.get_opcodes():
        if tag == 'replace' and b-a == d-c:
            for x,y in zip(range(a,b),range(c,d)):
                if difflib.SequenceMatcher(None,expected[x],heard[y]).ratio() >= .6:
                    mapping[x] = y
    aligned = []
    for (a, b), item in zip(spans, inputs):
        matches = [(i, mapping[i]) for i in range(a, b) if i in mapping]
        if not matches:
            raise ValueError('An utterance has no matching audio words; review before exporting.')
        first, last = matches[0], matches[-1]
        aligned.append(dict(start=times[first[1]][0], end=times[last[1]][1],
                            words=word_starts(spoken(item['text']), a, mapping, times),
                            matched=len(matches), expected=b-a,
                            coverage=len(matches)/max(1,b-a),
                            unmatchedHead=first[0]-a, unmatchedTail=b-1-last[0]))
    return aligned


QUIET_DB = -45      # a 10 ms frame is silent below this level...
QUIET_ABOVE_FLOOR = 20  # ...and within this many dB of the quietest frame nearby,
QUIET_FLOOR_DB = -70    # (never demanding more than this), so soft consonants such as
                        # "f" or "h" count as speech in clean recordings
MIN_PAUSE = .1      # shortest silence that can separate two lines (longer than a plosive's closure)
LOOKAHEAD = .4      # how far after the recognized start a pause may lie (seconds)
PREROLL = .1        # silence kept before the next line's first sound (seconds)
LOOKBACK = .8       # how far before the recognized end a pause may lie (seconds)


def frame_levels(samples, rate, start, end):
    """dBFS of each 10 ms frame from start to end (seconds)."""
    size = max(1, int(rate*.01))
    levels = []
    first = max(0, int(start*100))
    for frame in range(first, max(first, int(end*100))):
        window = samples[frame*size:(frame+1)*size]
        if not window:
            break
        energy = sum(x*x for x in window)/len(window)
        levels.append((frame/100, 10*math.log10(energy/32768**2+1e-12)))
    return levels


def silent_boundary(samples, rate, left, right, earliest=None, latest=None):
    """Cut between two lines inside the pause that separates them.

    Recognized word edges are approximate: a word's end often runs up to the next word, so
    the real pause can lie before `left`. Search a little earlier, take the silence nearest
    the recognized gap (the longest if several touch it) and cut just before the next line's
    first sound, so no clip ends with the start of the following line.
    """
    lo = max(0 if earliest is None else earliest, min(left, right) - LOOKBACK)
    hi = max(left, right) + LOOKAHEAD
    # Read on past the search window so a pause that starts inside it ends at the real onset.
    limit = hi + 1.0 if latest is None else min(hi + 1.0, latest)
    hi = min(hi, limit)
    levels = frame_levels(samples, rate, lo, limit)
    if not levels:
        return (left+right)/2
    quiet = min(QUIET_DB, max(QUIET_FLOOR_DB, min(x[1] for x in levels)+QUIET_ABOVE_FLOOR))
    runs, begin = [], None
    for t, level in levels + [(limit, 0.0)]:
        if level < quiet and begin is None and t < hi:
            begin = t
        elif level >= quiet and begin is not None:
            if t - begin >= MIN_PAUSE:
                runs.append((begin, t))
            begin = None
    if runs:
        gap = (min(left, right), max(left, right))
        # A pause after the recognized start is more likely inside the next line: weigh it more.
        distance = lambda run: max(0, 3*(run[0]-gap[1]), gap[0]-run[1])
        begin, onset = min(runs, key=lambda run: (round(distance(run), 2), -(run[1]-run[0])))
        return round(max((begin+onset)/2, onset-PREROLL), 3)
    # No clean pause: the quietest moment near the recognized gap.
    near = [x for x in levels if min(left, right)-.3 <= x[0] <= max(left, right)] or levels
    return min(near, key=lambda x: x[1])[0]


def clip_words(starts, cut):
    """Word starts kept inside a line's clip. Recognizers place a first word late, so it
    starts no later than the sound the cut was placed before."""
    starts = [max(t, cut) for t in starts]
    if starts:
        starts[0] = min(starts[0], cut+PREROLL)
    return starts


def load_overrides(path):
    """Reviewed timing annotations: {take key: {"sourceSha256": ..., "annotations": [...]}}."""
    if path is None:
        return {}
    data = json.loads(Path(path).read_text())
    for key, entry in data.items():
        if not isinstance(entry, dict) or not re.fullmatch(r'[0-9a-f]{64}', str(entry.get('sourceSha256', ''))) \
                or not isinstance(entry.get('annotations'), list):
            raise ValueError(f'{key}: overrides need the take\'s sourceSha256 and a list of annotations.')
    return data


def annotate(transcription, annotations):
    """Apply reviewed annotations to a recognizer transcription (segments with text and ms offsets).

    - {"replaceText": [old, new]}: correct a misheard spelling in every segment;
    - {"replaceIndex": i, "segment": {...}}: replace fields of segment i (a mistimed word);
    - {"segment": {...}}: add a word the recognizer missed, timed from the audio.
    The raw recognition stays cached unchanged; segments are re-sorted by start.
    """
    transcription = [dict(segment, offsets=dict(segment['offsets'])) for segment in transcription]
    for annotation in annotations:
        if annotation.get('replaceText') is not None:
            old, new = annotation['replaceText']
            for segment in transcription:
                segment['text'] = segment['text'].replace(old, new)
        elif annotation.get('replaceIndex') is not None:
            transcription[annotation['replaceIndex']].update(annotation['segment'])
        else:
            transcription.append(annotation['segment'])
    transcription.sort(key=lambda segment: segment['offsets']['from'])
    return transcription


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--model', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--overrides', type=Path,
                        help='reviewed timing annotations per take, bound to the take\'s SHA-256')
    args = parser.parse_args()
    plan = json.loads(args.input.read_text())
    overrides = load_overrides(args.overrides)
    annotated = []
    work = args.output.parent/'work'
    work.mkdir(parents=True,exist_ok=True)
    lines, reports = [], []
    offset = plan.get('musicOffset',0)
    for chunk in plan['chunks']:
        key = chunk['key']
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,96}',key):
            raise ValueError('Chunk keys must be simple filename identifiers.')
        source_hash = hashlib.sha256(Path(chunk['audio']).read_bytes()).hexdigest()
        provider, provider_hash = provider_alignment.load(chunk['audio'])
        if provider is not None:
            identity = dict(sourceSha256=source_hash, alignmentSha256=provider_hash, timestampMode='elevenlabs-v1')
        else:
            model_info = args.model.stat()
            identity = dict(sourceSha256=source_hash, model=str(args.model.resolve()),
                            modelSize=model_info.st_size, modelModified=model_info.st_mtime_ns,
                            timestampMode='word-v1')
        cache_meta = work/f'{key}.alignment-cache.json'
        try:
            cache_matches = json.loads(cache_meta.read_text()) == identity
        except (OSError,ValueError):
            cache_matches = False
        wav = work/f'{key}.wav'
        if not cache_matches or not wav.exists():
            subprocess.run(['ffmpeg','-v','error','-y','-i',chunk['audio'],'-ar','16000','-ac','1',str(wav)],check=True)
        transcript = work/f'{key}.json'
        if provider is not None:
            # The provider's own timestamps for exactly this text: no recognizer needed.
            transcript.write_text(json.dumps(dict(source='elevenlabs-alignment',
                                                  transcription=provider_alignment.transcription(provider))))
        elif not cache_matches or not transcript.exists():
            print(f'Transcribing {key}',flush=True)
            with (work/f'{key}.whisper.log').open('w') as log:
                subprocess.run(['whisper-cli','-m',str(args.model),'-f',str(wav),'-ojf','-of',str(work/key),'-ml','1','-sow','-np','-l','en'],stdout=log,stderr=log,check=True)
        cache_meta.write_text(json.dumps(identity))
        transcription = json.loads(transcript.read_text())['transcription']
        if key in overrides:
            if provider is not None:
                raise ValueError(f'{key}: timing annotations are for recognizer output; this take has '
                                 'ElevenLabs timestamps. Remove the annotations.')
            if overrides[key]['sourceSha256'] != source_hash:
                raise ValueError(f'{key}: timing annotations belong to another recording.')
            transcription = annotate(transcription, overrides[key]['annotations'])
            annotated.append(key)
        aligned = match_lines(chunk['inputs'],transcription)
        with wave.open(str(wav),'rb') as stream:
            samples = array.array('h',stream.readframes(stream.getnframes()))
            rate = stream.getframerate()
        boundaries = [0.0]
        for previous, following in zip(aligned, aligned[1:]):
            boundaries.append(silent_boundary(samples,rate,previous['end'],following['start'],
                                              earliest=max(boundaries[-1],previous['start']),latest=following['end']))
        boundaries.append(chunk['duration'])
        for i,(item,match) in enumerate(zip(chunk['inputs'],aligned)):
            # Short stammers can lose a repeated word while retaining both edges.
            anchored_short = match['expected'] <= 4 and match['matched'] >= 2 and not match['unmatchedHead'] and not match['unmatchedTail']
            if (match['coverage'] < .70 and not anchored_short) or match['unmatchedHead'] > 3 or match['unmatchedTail'] > 3:
                raise ValueError(f'{key} input {i}: uncertain boundary {match}; review transcription.')
            if boundaries[i+1] <= boundaries[i]:
                raise ValueError(f'{key}: non-monotonic boundaries')
            lines.append(dict(id=f'line-{len(lines)+1:03d}',speaker=item['speaker'],text=spoken(item['text']),
                              direction=' '.join(re.findall(r'\[([^\]]*)\]',item['text'])),sourceLine=item.get('line',0),
                              start=round(offset+chunk['offset']+boundaries[i],4),
                              end=round(offset+chunk['offset']+boundaries[i+1],4),
                              chunk=key,chunkStart=boundaries[i],chunkEnd=boundaries[i+1],
                              # Word starts in master seconds, inside the line's own clip.
                              words=[round(offset+chunk['offset']+t,4) for t in clip_words(match['words'],boundaries[i])],
                              chapter=chunk.get('marker'),alignment={k:v for k,v in match.items() if k!='words'}))
        reports.append(dict(key=key,utterances=len(aligned),minimumCoverage=min(x['coverage'] for x in aligned),
                            sourceSha256=source_hash,**({'timing':'elevenlabs'} if provider is not None else {})))
        print(f'{key}: {len(aligned)} utterances, minimum word coverage {reports[-1]["minimumCoverage"]:.1%}',flush=True)
    result=dict(schemaVersion=1,title=plan['title'],masterAudio=plan['masterAudio'],
                masterDuration=plan['masterDuration'],masterSha256=hashlib.sha256(Path(plan['masterAudio']).read_bytes()).hexdigest(),
                method=('Word timestamps (ElevenLabs character timestamps where saved with the take, else local Whisper) '
                        'matched monotonically to the supplied speaker-labelled transcript; silence-refined boundaries.'
                        if any(r.get('timing') == 'elevenlabs' for r in reports) else
                        'Local Whisper word timestamps matched monotonically to the supplied speaker-labelled transcript; '
                        'silence-refined boundaries.'),
                lines=lines,chunks=reports,**({'annotatedTakes':annotated} if annotated else {}))
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(f'Wrote {args.output}: {len(lines)} utterances',flush=True)


if __name__ == '__main__':
    main()
