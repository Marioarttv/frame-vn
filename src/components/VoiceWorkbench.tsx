import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Check,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  WandSparkles,
} from "lucide-react";
import type { Character } from "../engine/types";

export interface VoiceResult {
  id: string;
  audioSrc: string;
  cueUrl: string;
  duration: number;
  model: string;
  voiceId: string;
  cached: boolean;
  cueSource: string;
  characterCost?: string | null;
}
export interface Voice {
  id: string;
  name: string;
  category?: string;
  previewUrl?: string | null;
  labels?: Record<string, string>;
}
export interface Health {
  configured: boolean;
  model: string;
  rhubarb: boolean;
  ffmpeg: boolean;
  sessionToken: string;
  alignment: string;
  maxCharacters?: number;
}
interface Props {
  character?: Character;
  text: string;
  onGenerated: (result: VoiceResult) => void;
  onVoiceChange?: (id: string) => void;
}
let healthRequest: Promise<Health> | undefined;
let voicesRequest: Promise<Voice[]> | undefined;
/** A restarted local server issues a new session token, so callers can force a fresh check. */
export function getHealth(refresh = false): Promise<Health> {
  if (refresh) healthRequest = undefined;
  return (healthRequest ??= fetch("/api/health")
    .then(async (r) => {
      if (!r.ok)
        throw new Error(
          "Start the local studio server to use voice generation.",
        );
      return r.json();
    })
    .catch((e) => {
      healthRequest = undefined;
      throw e;
    }));
}
/**
 * Submits one voice line. The session token is checked before any provider request, so a
 * single refresh after a server restart can never bill twice.
 */
export async function requestVoice(body: {
  text: string;
  voiceId: string;
  stability?: number;
  similarity?: number;
  languageCode?: string;
}): Promise<{ ok: boolean; data: any }> {
  const post = (token: string) =>
    fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Studio-Token": token },
      body: JSON.stringify(body),
    });
  let response = await post((await getHealth()).sessionToken);
  let data = await response.json();
  if (response.status === 403 && data.error?.code === "invalid_token") {
    response = await post((await getHealth(true)).sessionToken);
    data = await response.json();
  }
  return { ok: response.ok, data };
}

/**
 * Marks an uncertain attempt as reviewed so the same line may be submitted again. The record
 * itself is kept for cost reconciliation.
 */
export async function archiveAttempt(id: string): Promise<Health> {
  const fresh = await getHealth(true);
  const response = await fetch("/api/voice/attempts/archive", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Studio-Token": fresh.sessionToken,
    },
    body: JSON.stringify({ id }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error?.message || "The attempt could not be archived.");
  return fresh;
}

export function voiceErrorMessage(data: any): string {
  return typeof data?.error === "string"
    ? data.error
    : data?.error?.message || data?.message || "Voice generation failed.";
}

export function getVoices(): Promise<Voice[]> {
  return (voicesRequest ??= fetch("/api/voices")
    .then(async (r) => {
      const data = await r.json();
      if (!r.ok)
        throw new Error(
          data.error?.message || data.error || "Could not load voices.",
        );
      return data.voices;
    })
    .catch((e) => {
      voicesRequest = undefined;
      throw e;
    }));
}

export function VoiceWorkbench({
  character,
  text,
  onGenerated,
  onVoiceChange,
}: Props) {
  const [health, setHealth] = useState<Health>();
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState(character?.voiceId || "");
  const [state, setState] = useState<"idle" | "generating" | "done">("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<VoiceResult>();
  const [expanded, setExpanded] = useState(false);
  const [direction, setDirection] = useState("");
  const [elapsed, setElapsed] = useState(0);
  // An uncertain earlier attempt that a person must reconcile before this line is submitted again.
  const [review, setReview] = useState<{
    id: string;
    requestId: string | null;
  }>();
  const [archiving, setArchiving] = useState(false);
  const latest = useRef({ text, characterId: character?.id });
  latest.current = { text, characterId: character?.id };
  const generatedHandler = useRef(onGenerated);
  generatedHandler.current = onGenerated;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    getHealth()
      .then((h) => {
        if (!mounted.current) return;
        setHealth(h);
        if (h.configured)
          getVoices()
            .then((v) => {
              if (mounted.current) setVoices(v);
            })
            .catch((e) => {
              if (mounted.current) setError(e.message);
            });
      })
      .catch((e) => {
        if (mounted.current) setError(e.message);
      });
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setSelectedVoice(character?.voiceId || "");
    setResult(undefined);
    if (state !== "generating") setState("idle");
    setError("");
  }, [character?.id, character?.voiceId]);
  // A pending review belongs to one exact request.
  useEffect(() => setReview(undefined), [text, direction, selectedVoice]);
  useEffect(() => {
    if (state !== "generating") return;
    const start = Date.now();
    setElapsed(0);
    const timer = setInterval(
      () => setElapsed(Math.round((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [state]);
  // Matches the request body exactly so cached lines keep their content hash.
  const requestText = direction ? `[${direction}] ${text}` : text;
  const maxCharacters = health?.maxCharacters ?? 2000;
  const tooLong = requestText.trim().length > maxCharacters;
  async function generate() {
    if (
      !health ||
      !selectedVoice ||
      !text.trim() ||
      tooLong ||
      state === "generating"
    )
      return;
    setState("generating");
    setError("");
    setReview(undefined);
    setResult(undefined);
    const submitted = { text, characterId: character?.id };
    try {
      const { ok, data } = await requestVoice({
        text: requestText,
        voiceId: selectedVoice,
        ...character?.voiceSettings,
      });
      if (mounted.current) void getHealth().then(setHealth);
      if (
        !ok &&
        data.error?.code === "attempt_needs_review" &&
        typeof data.error.id === "string" &&
        mounted.current
      )
        setReview({
          id: data.error.id,
          requestId: data.error.requestId ?? null,
        });
      if (!ok) throw new Error(voiceErrorMessage(data));
      if (!mounted.current) return;
      setResult(data);
      setState("done");
      if (
        latest.current.text === submitted.text &&
        latest.current.characterId === submitted.characterId
      )
        generatedHandler.current(data);
      else
        setError(
          "Your dialogue changed while generating. The audio is cached; restore the original line to attach it.",
        );
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : "Voice generation failed.");
        setState("idle");
      }
    }
  }
  async function archiveReviewedAttempt() {
    if (!review || !health || archiving) return;
    setArchiving(true);
    try {
      const fresh = await archiveAttempt(review.id);
      if (!mounted.current) return;
      setHealth(fresh);
      setReview(undefined);
      setError("");
      setState("idle");
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error ? e.message : "The attempt could not be archived.",
        );
    } finally {
      if (mounted.current) setArchiving(false);
    }
  }
  return (
    <section className="voice-workbench" aria-label="Voice generation">
      <div className="section-heading">
        <span>
          <AudioLines size={15} /> Voice & performance
        </span>
        <span className="model-badge">ELEVEN v4</span>
      </div>
      <div className="voice-select-row">
        <label className="form-field grow">
          <span>Character voice</span>
          <select
            aria-label="Character voice"
            value={selectedVoice}
            disabled={state === "generating"}
            onChange={(e) => {
              setSelectedVoice(e.target.value);
              onVoiceChange?.(e.target.value);
            }}
          >
            <option value="">
              {!health
                ? "Checking local voice service…"
                : health.configured
                  ? "Select a voice…"
                  : "Connect ElevenLabs to select a voice"}
            </option>
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.labels?.accent ? ` · ${v.labels.accent}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        className="text-button voice-direction-toggle"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        Performance direction <ChevronDown size={13} />
      </button>
      {expanded && (
        <label className="form-field">
          <span>Optional delivery tag</span>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            <option value="">Natural delivery</option>
            <option value="quietly">Quietly</option>
            <option value="excited">Excited</option>
            <option value="thoughtfully">Thoughtfully</option>
            <option value="whispering">Whispering</option>
            <option value="angry">Angry</option>
            <option value="sad">Sad</option>
          </select>
        </label>
      )}
      <button
        className="button generate-button"
        onClick={generate}
        disabled={
          !health?.configured ||
          !health.rhubarb ||
          !health.ffmpeg ||
          !selectedVoice ||
          !text.trim() ||
          tooLong ||
          state === "generating"
        }
      >
        {state === "generating" ? (
          <LoaderCircle size={16} className="spin" />
        ) : (
          <WandSparkles size={16} />
        )}{" "}
        {state === "generating"
          ? `Creating performance · ${elapsed}s`
          : "Generate voice & sync"}
      </button>
      {state === "generating" && (
        <p className="field-hint">
          Generating audio, then mapping mouth movements. Keep this window open.
        </p>
      )}
      {!health?.configured && health && (
        <p className="field-hint">
          Set ELEVENLABS_API_KEY in .env.local and restart the local server to
          connect your account.
        </p>
      )}
      {health?.configured && (!health.rhubarb || !health.ffmpeg) && (
        <p className="field-hint">
          {!health.rhubarb ? "Rhubarb" : "FFmpeg"} is unavailable. See the voice
          pipeline setup guide.
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          <CircleAlert size={14} />
          {error}
        </p>
      )}
      {review && (
        <div className="attempt-review">
          <p className="field-hint">
            Check your ElevenLabs history
            {review.requestId ? ` for request ${review.requestId}` : ""}. If you
            want a new take anyway, archive the earlier attempt (its record is
            kept for cost reconciliation), then generate again.
          </p>
          <button
            className="button small"
            disabled={archiving}
            onClick={() => void archiveReviewedAttempt()}
          >
            {archiving ? <LoaderCircle size={14} className="spin" /> : null}
            I've checked — allow a new attempt
          </button>
        </div>
      )}
      {result && !error && (
        <p className="inline-success" role="status">
          <Check size={14} />
          {result.duration.toFixed(1)}s · Audio + mouth cues ready
          {result.cached ? " · From cache" : ""}
        </p>
      )}
      {tooLong && (
        <p className="field-hint">
          A voice line can contain at most {maxCharacters.toLocaleString()}{" "}
          characters, including the delivery tag. Split this dialogue into
          separate scenes to voice it.
        </p>
      )}
      <p className="voice-footnote">
        {requestText.trim().length.toLocaleString()} /{" "}
        {maxCharacters.toLocaleString()} characters · Uses your ElevenLabs
        account
        {character?.poses.some((p) => p.capabilities?.mouth)
          ? " · Your rig, automatically animated"
          : ""}
      </p>
    </section>
  );
}
