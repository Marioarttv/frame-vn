import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, LoaderCircle, X } from "lucide-react";
import type { Project } from "../../engine/types";
import { plainText } from "../../engine/markup";
import {
  getHealth,
  requestVoice,
  voiceErrorMessage,
  type VoiceResult,
} from "../VoiceWorkbench";

const MAX_CHARACTERS = 2000;

interface Props {
  project: Project;
  onAttach: (nodeId: string, result: VoiceResult, text: string) => void;
  onClose: () => void;
}

/**
 * Voices every unvoiced line whose character has a voice. Requests run one at a time after an
 * explicit confirmation and stop at the first failure; nothing is retried automatically.
 */
export function VoiceBatch({ project, onAttach, onClose }: Props) {
  const [ready, setReady] = useState<boolean | string>();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [cached, setCached] = useState(0);
  const [error, setError] = useState("");
  const [finished, setFinished] = useState(false);
  const stop = useRef(false);
  const mounted = useRef(true);
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
  // The list is fixed when the dialog opens so progress stays meaningful.
  const [plan] = useState(() => {
    const characters = new Map(
      project.characters.map((item) => [item.id, item]),
    );
    const lines: {
      nodeId: string;
      label: string;
      text: string;
      voiceId: string;
      speaker: string;
      settings?: { stability: number; similarity: number; languageCode?: string };
    }[] = [];
    let narration = 0,
      unvoiced = 0,
      tooLong = 0;
    for (const node of project.nodes) {
      // Direction tags are never spoken.
      const spoken = plainText(node.text).trim();
      if (node.type === "branch" || !spoken || node.audioSrc) continue;
      const character = node.characterId
        ? characters.get(node.characterId)
        : undefined;
      if (!character) narration++;
      else if (!character.voiceId) unvoiced++;
      else if (spoken.length > MAX_CHARACTERS) tooLong++;
      else
        lines.push({
          nodeId: node.id,
          label: node.label,
          text: spoken,
          voiceId: character.voiceId,
          speaker: character.name,
          settings: character.voiceSettings,
        });
    }
    return { lines, narration, unvoiced, tooLong };
  });
  const total = useMemo(
    () => plan.lines.reduce((sum, line) => sum + line.text.trim().length, 0),
    [plan],
  );

  useEffect(() => {
    mounted.current = true;
    getHealth()
      .then((health) => {
        if (!mounted.current) return;
        setReady(
          !health.configured
            ? "Set ELEVENLABS_API_KEY in .env.local and restart the local server."
            : !health.rhubarb || !health.ffmpeg
              ? "Rhubarb Lip Sync and FFmpeg are needed for mouth timing. See the voice setup guide."
              : true,
        );
      })
      .catch((cause) => {
        if (mounted.current)
          setReady(
            cause instanceof Error
              ? cause.message
              : "The voice service is unavailable.",
          );
      });
    return () => {
      // Closing the dialog never abandons a request mid-flight; it only stops the next one.
      mounted.current = false;
      stop.current = true;
    };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !running) closeHandler.current();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [running]);

  async function run() {
    setRunning(true);
    setError("");
    stop.current = false;
    for (const [index, line] of plan.lines.entries()) {
      if (index < done) continue;
      if (stop.current) break;
      try {
        const { ok, data } = await requestVoice({
          text: line.text,
          voiceId: line.voiceId,
          ...line.settings,
        });
        if (!ok) {
          setError(
            `“${line.label || line.speaker}” stopped the batch: ${voiceErrorMessage(data)}` +
              (data.error?.code === "attempt_needs_review"
                ? " Open that scene's voice panel to review it."
                : ""),
          );
          break;
        }
        onAttach(line.nodeId, data as VoiceResult, line.text);
        if ((data as VoiceResult).cached) setCached((value) => value + 1);
        setDone(index + 1);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "The voice service could not be reached.",
        );
        break;
      }
    }
    if (mounted.current) {
      setRunning(false);
      setFinished(true);
    }
  }

  const remaining = plan.lines.length - done;
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !running) onClose();
      }}
    >
      <div
        className="modal voice-batch"
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-batch-title"
      >
        <button
          className="modal-close icon-button"
          aria-label="Close"
          disabled={running}
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <div className="eyebrow">ELEVEN v4 · RHUBARB</div>
        <h2 id="voice-batch-title">Voice missing lines</h2>
        <p>
          Generates speech and mouth timing for every line whose character has a
          voice. Lines are sent one at a time; identical lines reuse saved audio
          at no cost.
        </p>
        <ul className="batch-summary">
          <li>
            <strong>{plan.lines.length}</strong> line
            {plan.lines.length === 1 ? "" : "s"} to voice ·{" "}
            <strong>{total.toLocaleString()}</strong> characters of your
            ElevenLabs plan at most
          </li>
          {plan.unvoiced > 0 && (
            <li>
              {plan.unvoiced} line{plan.unvoiced === 1 ? "" : "s"} skipped: the
              character has no voice yet (choose one in a scene’s voice panel).
            </li>
          )}
          {plan.narration > 0 && (
            <li>
              {plan.narration} narration line{plan.narration === 1 ? "" : "s"}{" "}
              skipped.
            </li>
          )}
          {plan.tooLong > 0 && (
            <li>
              {plan.tooLong} line{plan.tooLong === 1 ? " is" : "s are"} longer
              than 2,000 characters; split {plan.tooLong === 1 ? "it" : "them"}{" "}
              first.
            </li>
          )}
        </ul>
        {plan.lines.length > 0 && (
          <ol className="batch-lines">
            {plan.lines.map((line, index) => (
              <li key={line.nodeId} className={index < done ? "is-done" : ""}>
                <strong>{line.speaker}</strong> {line.text}
              </li>
            ))}
          </ol>
        )}
        {(running || done > 0) && (
          <p className="batch-progress" role="status">
            {running && <LoaderCircle size={14} className="spin" />}
            {done} of {plan.lines.length} voiced
            {cached ? ` (${cached} from saved audio)` : ""}
            {finished && !error && !remaining ? ". All done." : "."}
          </p>
        )}
        {typeof ready === "string" && (
          <p className="inline-error" role="alert">
            {ready}
          </p>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          {running ? (
            <button
              className="button"
              onClick={() => {
                stop.current = true;
              }}
            >
              Stop after this line
            </button>
          ) : (
            <button className="button" onClick={onClose}>
              {done ? "Close" : "Cancel"}
            </button>
          )}
          <button
            className="button primary"
            disabled={ready !== true || running || !remaining}
            onClick={() => void run()}
          >
            <AudioLines size={15} />{" "}
            {done
              ? `Continue with ${remaining}`
              : `Generate ${remaining} voice line${remaining === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
