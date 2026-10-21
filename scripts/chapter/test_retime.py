import array
import importlib.util
import math
import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location('chapter_retime', HERE / 'retime.py')
retime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retime)

RATE = 16000


def take(sounds, length):
    """A take with a 220 Hz tone wherever sounds lists (start, end), quiet noise elsewhere."""
    samples = array.array('h', [0] * int(length * RATE))
    for i in range(len(samples)):
        samples[i] = (i * 7919) % 7 - 3
    for start, end in sounds:
        for i in range(int(start * RATE), int(end * RATE)):
            samples[i] = int(6000 * math.sin(2 * math.pi * 220 * i / RATE))
    return retime.Levels(samples, RATE)


class RetimeTests(unittest.TestCase):
    def test_word_starts_snap_to_the_sound(self):
        levels = take([(0.2, 1.0), (1.4, 1.8)], 2.5)
        # A start placed inside the pause moves forward to the sound...
        self.assertAlmostEqual(levels.snap(1.1, 1.8), 1.38, places=2)
        # ...and a start placed a little after the pause ends moves back to it.
        self.assertAlmostEqual(levels.snap(1.6, 1.8), 1.38, places=2)
        # A start well inside continuous sound stays put.
        self.assertEqual(levels.snap(0.8, 1.0), 0.8)

    def test_a_cut_falls_in_the_pause_just_before_the_next_line(self):
        levels = take([(0.2, 1.0), (1.6, 2.2)], 2.6)
        # Recognized edges overlap the pause; the cut lands 0.1 s before the next sound.
        cut = levels.cut(left=1.1, right=1.75, earliest=0.3, latest=2.1)
        self.assertAlmostEqual(cut, 1.5, places=2)
        self.assertFalse(levels.in_sound(cut))
        self.assertTrue(levels.in_sound(0.6))

    def test_late_recognition_is_corrected_and_cuts_move_out_of_speech(self):
        # Two lines; the old cut (1.70) sits inside the second line's first word.
        levels = take([(0.1, 0.5), (0.6, 1.0), (1.5, 1.9), (2.0, 2.4)], 2.6)
        lines = [dict(id='line-001', text='Hello there.', start=0.0, end=1.7, words=[0.3, 0.8]),
                 dict(id='line-002', text='General Kenobi.', start=1.7, end=2.6, words=[1.75, 2.25])]
        heard = [dict(w='Hello', s=0.25, e=0.5), dict(w='there.', s=0.75, e=1.0),
                 dict(w='General', s=1.62, e=1.9), dict(w='Kenobi.', s=2.12, e=2.4)]
        cuts, words, report = retime.retime_chunk(lines, heard, levels, 0.0, 2.6)
        self.assertAlmostEqual(cuts[1], 1.4, places=2)
        self.assertEqual(report['cutsInSoundBefore'], ['line-002'])
        self.assertEqual(report['cutsInSoundAfter'], [])
        self.assertEqual(report['wordsAcrossCut'], [])
        # Every word now starts at (or a frame before) its sound.
        for got, want in zip(words[0] + words[1], [0.1, 0.6, 1.5, 2.0]):
            self.assertLessEqual(got, want + .01)
            self.assertGreaterEqual(got, want - .12)

    def test_names_match_loosely_and_unheard_words_stay_open(self):
        starts, ends, matched, expected = retime.match_tokens(
            retime.tokens_of('A Wizengamot hearing — today.'),
            [('a', 0.0, 0.1), ('Wisengamot', 0.2, 0.8), ('today', 1.4, 1.8)])
        self.assertEqual((matched, expected), (3, 4))
        self.assertEqual(starts, [0.0, 0.2, None, None, 1.4])
        self.assertEqual(ends[1], 0.8)

if __name__ == '__main__':
    unittest.main()
