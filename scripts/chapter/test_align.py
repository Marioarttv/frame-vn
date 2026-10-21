import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('chapter_align', Path(__file__).with_name('align.py'))
align = importlib.util.module_from_spec(spec)
spec.loader.exec_module(align)


def transcription(tokens):
    return [dict(text=text, offsets={'from':i*500,'to':(i+1)*500}) for i,text in enumerate(tokens)]


class AlignmentTests(unittest.TestCase):
    def test_repeated_phrases_keep_their_speaker_order(self):
        result = align.match_lines([{'text':'[quietly] Come here.'},{'text':'Come here, now.'}],
                                   transcription(['Come','here','Come','here','now']))
        self.assertEqual([(x['start'],x['end']) for x in result],[(0,1),(1,2.5)])
        self.assertTrue(all(x['coverage']==1 for x in result))

    def test_names_and_stammers_do_not_replace_authoritative_text(self):
        result=align.match_lines([{'text':'A—a hostage?'},{'text':'Yes, Malfoy.'}],
                                transcription(['A','hostage','Yes','Malfroy']))
        self.assertEqual(result[0]['matched'],2)
        self.assertEqual(result[0]['expected'],3)
        self.assertEqual(result[1]['unmatchedTail'],0)

    def test_compounds_and_names_keep_whole_boundary_words(self):
        result=align.match_lines([{'text':'A house of pureblood.'},{'text':'The Wizengamot.'}],
                                transcription(['A','house','of','pure','blood','The','Wisengamot']))
        self.assertEqual(result[0]['end'],2.5)
        self.assertEqual(result[1]['start'],2.5)
        self.assertEqual(result[1]['end'],3.5)

    def test_missing_utterance_is_rejected(self):
        with self.assertRaises(ValueError):
            align.match_lines([{'text':'Unrelated words.'}],transcription(['Hello']))

    def test_boundary_prefers_middle_of_real_silence(self):
        samples=[9000]*100+[0]*100+[9000]*100
        self.assertAlmostEqual(align.silent_boundary(samples,1000,.10,.20),.15)


def signal(*parts, rate=1000):
    """Samples from (seconds, amplitude) parts; low noise stands in for room tone."""
    samples=[]
    for seconds,amplitude in parts:
        samples += [amplitude if i%2 else -amplitude for i in range(round(seconds*rate))]
    return samples


class BoundaryTests(unittest.TestCase):
    def test_cut_moves_back_into_the_pause_when_recognized_edges_run_late(self):
        # The recognizer's gap (1.45-1.5) lies inside the next line's first sound.
        samples=signal((1.0,9000),(.4,3),(.6,9000))
        self.assertAlmostEqual(align.silent_boundary(samples,1000,1.45,1.5),1.3)

    def test_cut_moves_forward_into_the_pause_when_the_next_start_is_early(self):
        samples=signal((1.2,9000),(.4,3),(.6,9000))
        self.assertAlmostEqual(align.silent_boundary(samples,1000,1.1,1.1),1.5)

    def test_a_plosive_closure_is_not_a_pause(self):
        # "But": a short burst and a 50 ms closure before the voiced sound.
        samples=signal((1.0,9000),(.4,3),(.05,6000),(.05,3),(.5,9000))
        self.assertAlmostEqual(align.silent_boundary(samples,1000,1.48,1.48),1.3)

    def test_a_soft_consonant_is_speech_in_a_clean_recording(self):
        # "F-fine": a quiet fricative (about -50 dB) before the vowel.
        samples=signal((1.0,9000),(.4,3),(.2,100),(.4,9000))
        self.assertAlmostEqual(align.silent_boundary(samples,1000,1.65,1.65),1.3)

    def test_no_clip_ends_with_the_next_line_in_a_real_recording_shape(self):
        samples=signal((2.0,8000),(.35,2),(.03,500),(1.0,8000))
        cut=align.silent_boundary(samples,1000,2.37,2.4)
        self.assertLessEqual(cut,2.35)
        self.assertGreaterEqual(cut,2.0)


class WordStartTests(unittest.TestCase):
    def test_word_starts_follow_the_players_word_split(self):
        result=align.match_lines([{'text':'Hello.'},{'text':'F-fine... if that is it.'}],
                                 transcription(['Hello','F','fine','if','that','is','it']))
        self.assertEqual(result[1]['words'],[0.5,1.5,2.0,2.5,3.0])

    def test_missed_words_are_interpolated_and_a_missed_tail_is_left_out(self):
        result=align.match_lines([{'text':'One two three four five'}],
                                 transcription(['One','zzz','three','qqq']))
        self.assertEqual(result[0]['words'],[0,0.5,1.0])

    def test_first_word_starts_where_the_cut_found_the_sound(self):
        self.assertEqual(align.clip_words([2.3,2.6],2.0),[2.1,2.6])
        self.assertEqual(align.clip_words([1.9,2.05],2.0),[2.0,2.05])

    def test_reviewed_annotations_fix_spelling_timing_and_missed_words(self):
        raw = transcription(['three','394','person'])
        fixed = align.annotate(raw, [
            {'replaceText': ['394', 'ninety-four']},
            {'replaceIndex': 0, 'segment': {'offsets': {'from': 100, 'to': 400}}},
            {'segment': {'text': 'Ah', 'offsets': {'from': 50, 'to': 90}}},
        ])
        self.assertEqual([x['text'] for x in fixed], ['Ah', 'three', 'ninety-four', 'person'])
        self.assertEqual(fixed[1]['offsets'], {'from': 100, 'to': 400})
        self.assertEqual(raw[1]['text'], '394', 'the cached recognition stays unchanged')

    def test_annotations_must_be_bound_to_a_take(self):
        import json, tempfile
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'overrides.json'
            path.write_text(json.dumps({'take': [{'replaceText': ['a', 'b']}]}))
            with self.assertRaises(ValueError):
                align.load_overrides(path)
            path.write_text(json.dumps({'take': {'sourceSha256': '0' * 64, 'annotations': []}}))
            self.assertIn('take', align.load_overrides(path))
        self.assertEqual(align.load_overrides(None), {})


if __name__=='__main__':
    unittest.main()
