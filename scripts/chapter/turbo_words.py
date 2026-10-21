"""Word timestamps from Whisper large-v3-turbo on Apple silicon (MLX). Called by retime.py.

    uv run --no-project --with mlx-whisper python -I turbo_words.py <audio.wav> <out.json>

Writes [{"w": word, "s": start, "e": end, "p": probability}, ...] in seconds.
"""
import json
import sys

import mlx_whisper

MODEL = "mlx-community/whisper-large-v3-turbo"


def main():
    audio, out = sys.argv[1], sys.argv[2]
    result = mlx_whisper.transcribe(audio, path_or_hf_repo=MODEL, word_timestamps=True,
                                    language="en", condition_on_previous_text=False)
    words = [dict(w=w["word"].strip(), s=round(w["start"], 3), e=round(w["end"], 3),
                  p=round(w.get("probability", 0), 3))
             for segment in result["segments"] for w in segment.get("words", [])]
    with open(out, "w") as f:
        json.dump(dict(model=MODEL, words=words), f)


if __name__ == "__main__":
    main()
