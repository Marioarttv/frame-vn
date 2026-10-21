"""ElevenLabs timestamps in the aligner and retime: a hand-made response fixture, a synthetic take.
No provider calls, no recognizer: the take has its own timestamps."""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.dont_write_bytecode = True
import provider_alignment  # noqa: E402

FIXTURE = HERE / 'fixtures/dialogue-with-timestamps.alignment.json'
WORDS = [('Hello', .2, .55), ('there.', .65, 1.05), ('Hi,', 1.6, 1.85), ('Mira.', 1.95, 2.35)]


def synthetic_take(folder):
    """A 2.6 s take with a tone during each fixture word and silence between them."""
    audio = folder / 'take.mp3'
    tones = '+'.join(f"between(t,{s},{e})" for _, s, e in WORDS)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i',
                    f"aevalsrc='0.4*sin(2*PI*220*t)*({tones})':s=44100:d=2.6", '-c:a', 'libmp3lame', str(audio)],
                   check=True)
    (folder / 'take.alignment.json').write_text(FIXTURE.read_text())
    duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                                              '-of', 'csv=p=0', str(audio)]))
    plan = dict(title='Demo', masterAudio=str(audio), masterDuration=duration, musicOffset=0, chunks=[dict(
        key='take', audio=str(audio), offset=0, duration=duration,
        inputs=[dict(speaker='mira', text='[sarcastic] Hello there.', line=1),
                dict(speaker='noah', text='Hi, Mira.', line=2)])])
    (folder / 'input.json').write_text(json.dumps(plan))
    (folder / 'verification').mkdir()
    return audio


NEEDS_FFMPEG = unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg is unavailable')


class ProviderAlignmentTests(unittest.TestCase):
    def test_words_skip_tags_and_break_between_inputs(self):
        data, digest = provider_alignment.load(FIXTURE.with_name('dialogue-with-timestamps.mp3'))
        self.assertEqual(len(digest), 64)
        self.assertEqual(provider_alignment.words(data), WORDS)

    def test_a_take_without_timestamps_has_none(self):
        self.assertEqual(provider_alignment.load(HERE / 'no-such-take.mp3'), (None, None))

    def test_unusable_alignment_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / 't.alignment.json').write_text(json.dumps({'alignment': {'characters': ['a']}}))
            with self.assertRaises(ValueError):
                provider_alignment.load(Path(folder) / 't.mp3')

    @NEEDS_FFMPEG
    def test_aligner_and_retime_use_the_takes_own_timestamps(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            synthetic_take(folder)
            timeline = folder / 'timeline.json'
            # No Whisper model exists: the take's timestamps must be enough.
            subprocess.run([sys.executable, '-I', str(HERE / 'align.py'), str(folder / 'input.json'),
                            '--model', str(folder / 'missing-model.bin'), '--output', str(timeline)],
                           check=True, capture_output=True)
            data = json.loads(timeline.read_text())
            first, second = data['lines']
            self.assertEqual(data['chunks'][0]['timing'], 'elevenlabs')
            self.assertEqual((first['text'], second['text']), ('Hello there.', 'Hi, Mira.'))
            self.assertTrue(1.05 < first['end'] == second['start'] < 1.6, (first['end'], second['start']))
            # A line's first word is never later than 0.1 s after its cut (the aligner's rule).
            self.assertEqual(first['words'], [.1, .65])
            self.assertEqual(second['words'][1], 1.95)
            self.assertFalse((folder / 'work/take.whisper.log').exists())
            # Retime keeps its acoustic checks but needs no recognizer either.
            subprocess.run([sys.executable, '-I', str(HERE / 'retime.py'), str(timeline)],
                           check=True, capture_output=True)
            report = json.loads((folder / 'verification/retime-report.json').read_text())
            chunk = report['chunks'][0]
            self.assertEqual(chunk['timing'], 'elevenlabs')
            self.assertEqual((chunk['matched'], chunk['expected']), (4, 4))
            self.assertEqual((chunk['cutsInSoundAfter'], chunk['wordsAcrossCut']), ([], []))
            self.assertIn('ElevenLabs', report['method'])
            retimed = json.loads(timeline.read_text())['lines']
            self.assertTrue(1.05 < retimed[1]['start'] < 1.6)
            self.assertFalse((folder / 'work/take.turbo.json').exists())

    @NEEDS_FFMPEG
    def test_annotations_cannot_be_applied_to_a_take_with_timestamps(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            audio = synthetic_take(folder)
            import hashlib
            (folder / 'overrides.json').write_text(json.dumps({'take': {
                'sourceSha256': hashlib.sha256(audio.read_bytes()).hexdigest(), 'annotations': []}}))
            result = subprocess.run([sys.executable, '-I', str(HERE / 'align.py'), str(folder / 'input.json'),
                                     '--model', 'missing.bin', '--output', str(folder / 'timeline.json'),
                                     '--overrides', str(folder / 'overrides.json')], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('ElevenLabs timestamps', result.stderr)


if __name__ == '__main__':
    unittest.main()
