import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("local chapter alignment preserves speaker order, compounds and uncertain-word checks, and cuts lines in their pauses", () => {
  execFileSync(
    "python3",
    [
      fileURLToPath(
        new URL("../scripts/chapter/test_align.py", import.meta.url),
      ),
    ],
    { stdio: "pipe", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
  );
});

test("re-timing measures cuts and word starts against the audio", () => {
  execFileSync(
    "python3",
    [fileURLToPath(new URL("../scripts/chapter/test_retime.py", import.meta.url))],
    { stdio: "pipe", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
  );
});

test("a take voiced with ElevenLabs timestamps is aligned and re-timed from them, without a recognizer", () => {
  execFileSync(
    "python3",
    [fileURLToPath(new URL("../scripts/chapter/test_provider_alignment.py", import.meta.url))],
    { stdio: "pipe", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
  );
});
