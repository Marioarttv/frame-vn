import { useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  LoaderCircle,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { plainText, type Character } from "../../engine";
import { resolveAssetUrl } from "../../engine/asset-urls";
import {
  archiveAttempt,
  getHealth,
  getVoices,
  requestVoice,
  voiceErrorMessage,
  type Health,
  type Voice,
  type VoiceResult,
} from "../VoiceWorkbench";

const DELIVERY = [
  "",
  "calm",
  "warm",
  "excited",
  "angry",
  "sad",
  "whispering",
  "shouting",
  "sarcastic",
  "nervous",
  "thoughtfully",
  "laughing",
];
const BARS = 72;
const peaksCache = new Map<string, Promise<number[]>>();

/** A coarse loudness outline of a recording, decoded once per source. */
function loadPeaks(src: string): Promise<number[]> {
  let request = peaksCache.get(src);
  if (!request) {
    request = fetch(resolveAssetUrl(src))
      .then((response) => response.arrayBuffer())
      .then(async (buffer) => {
        const context = new OfflineAudioContext(1, 1, 22050);
        const audio = await context.decodeAudioData(buffer);
        const data = audio.getChannelData(0);
        const step = Math.max(1, Math.floor(data.length / BARS));
        const peaks: number[] = [];
        for (let bar = 0; bar < BARS; bar++) {
          let peak = 0;
          for (let index = bar * step; index < Math.min(data.length, (bar + 1) * step); index += 16)
            peak = Math.max(peak, Math.abs(data[index]));
          peaks.push(peak);
        }
        const loudest = Math.max(0.01, ...peaks);
        return peaks.map((peak) => Math.max(0.06, peak / loudest));
      })
      .catch(() => Array.from({ length: BARS }, (_, index) => 0.3 + 0.25 * Math.sin(index * 0.7) ** 2));
    peaksCache.set(src, request);
  }
  return request;
}

interface Props {
  character?: Character;
  /** The line as written, including direction tags; only the spoken words are sent. */
  text: string;
  audio?: { src: string; duration?: number };
  /** Receives the take with the spoken words it was made from. */
  onGenerated: (result: VoiceResult, spoken: string) => void;
  onRemove: () => void;
  onVoiceChange: (voiceId: string) => void;
}

/**
 * The line's recording, ElevenLabs style: the speaker's voice, a delivery, one click to
 * generate (with lip sync), and the take as a waveform you can play. Generating is always an
 * explicit click and replacing a take asks first, because every take is billed.
 */
export function VoiceTake({ character, text, audio, onGenerated, onRemove, onVoiceChange }: Props) {
  const [health, setHealth] = useState<Health>();
  const [voices, setVoices] = useState<Voice[]>([]);
  const [problem, setProblem] = useState("");
  const [delivery, setDelivery] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [review, setReview] = useState<string>();
  const [peaks, setPeaks] = useState<number[]>();
  const [progress, setProgress] = useState<number | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const frame = useRef(0);
  const mounted = useRef(true);
  const spoken = plainText(text).trim();
  const requestText = delivery ? `[${delivery}] ${spoken}` : spoken;
  const generated = useRef(onGenerated);
  generated.current = onGenerated;

  useEffect(() => {
    mounted.current = true;
    getHealth()
      .then((value) => {
        if (!mounted.current) return;
        setHealth(value);
        if (value.configured)
          getVoices()
            .then((list) => mounted.current && setVoices(list))
            .catch((error) => mounted.current && setProblem(error.message));
      })
      .catch((error) => mounted.current && setProblem(error.message));
    return () => {
      mounted.current = false;
      player.current?.pause();
      cancelAnimationFrame(frame.current);
    };
  }, []);
  useEffect(() => {
    setPeaks(undefined);
    stop();
    setConfirming(false);
    if (audio?.src) void loadPeaks(audio.src).then((value) => mounted.current && setPeaks(value));
    // stop only touches refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio?.src]);
  useEffect(() => setReview(undefined), [requestText, character?.voiceId]);
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);
  useEffect(() => {
    if (!busy) return;
    const began = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - began) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  function stop() {
    player.current?.pause();
    player.current = null;
    cancelAnimationFrame(frame.current);
    setProgress(null);
  }
  function toggle() {
    if (!audio?.src) return;
    if (player.current) return stop();
    const element = new Audio(resolveAssetUrl(audio.src));
    player.current = element;
    const tick = () => {
      if (player.current !== element) return;
      setProgress(element.duration ? element.currentTime / element.duration : 0);
      frame.current = requestAnimationFrame(tick);
    };
    element.onended = () => player.current === element && stop();
    setProgress(0);
    void element.play().then(tick, () => {
      stop();
      setProblem("This recording could not be played.");
    });
  }

  const maxCharacters = health?.maxCharacters ?? 2000;
  const ready = !!health?.configured && health.rhubarb && health.ffmpeg;
  const voiceId = character?.voiceId ?? "";
  const tooLong = requestText.length > maxCharacters;
  const canGenerate = ready && !!character && !!voiceId && !!spoken && !tooLong && !busy && !review;

  const inFlight = useRef(false);
  async function generate() {
    if (!canGenerate || !character || inFlight.current) return;
    if (audio?.src && !confirming) return setConfirming(true);
    inFlight.current = true;
    setConfirming(false);
    setBusy(true);
    setProblem("");
    stop();
    // The take is attached by the parent to the shot it was made for, even if this panel has
    // been closed or now shows another shot by the time the recording is ready.
    const attach = generated.current;
    const words = spoken;
    try {
      const { ok, data } = await requestVoice({
        text: requestText,
        voiceId,
        ...character.voiceSettings,
      });
      if (!ok && data.error?.code === "attempt_needs_review" && typeof data.error.id === "string" && mounted.current)
        setReview(data.error.id);
      if (!ok) throw new Error(voiceErrorMessage(data));
      attach(data as VoiceResult, words);
    } catch (error) {
      if (mounted.current)
        setProblem(error instanceof Error ? error.message : "Voice generation failed.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (!character)
    return (
      <div className="take take-empty">
        <Mic size={15} />
        <span>Narration has no voice. Choose who speaks to record this line.</span>
      </div>
    );
  return (
    <div className="take">
      <div className="take-row">
        <label className="take-field">
          <span>Voice</span>
          <select
            aria-label={`${character.name}'s voice`}
            value={voiceId}
            disabled={busy || !voices.length}
            onChange={(event) => onVoiceChange(event.target.value)}
          >
            <option value="">
              {!health
                ? "Checking voice service…"
                : !health.configured
                  ? "ElevenLabs not connected"
                  : voices.length
                    ? "Choose a voice…"
                    : "Loading voices…"}
            </option>
            {voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name}
                {voice.labels?.accent ? ` · ${voice.labels.accent}` : ""}
              </option>
            ))}
            {voiceId && !voices.some((voice) => voice.id === voiceId) && (
              <option value={voiceId}>Saved voice</option>
            )}
          </select>
        </label>
        <label className="take-field">
          <span>Delivery</span>
          <select
            aria-label="Delivery"
            value={delivery}
            disabled={busy}
            onChange={(event) => setDelivery(event.target.value)}
          >
            {DELIVERY.map((item) => (
              <option key={item} value={item}>
                {item ? item[0].toUpperCase() + item.slice(1) : "Natural"}
              </option>
            ))}
          </select>
        </label>
        <button
          className={`take-generate ${confirming ? "is-confirming" : ""}`}
          disabled={!canGenerate}
          onClick={() => void generate()}
          title={
            !voiceId
              ? "Choose a voice first"
              : !spoken
                ? "Write the line first"
                : "Generate the voice and its lip sync. Uses your ElevenLabs credits."
          }
        >
          {busy ? (
            <LoaderCircle size={15} className="spin" />
          ) : audio?.src ? (
            <RotateCcw size={15} />
          ) : (
            <WandSparkles size={15} />
          )}
          {busy
            ? `Recording · ${elapsed}s`
            : confirming
              ? "Replace this take?"
              : audio?.src
                ? "New take"
                : "Generate voice"}
          {!busy && <small>{requestText.length.toLocaleString()} chars</small>}
        </button>
      </div>
      {audio?.src ? (
        <div className={`take-wave ${progress !== null ? "is-playing" : ""}`}>
          <button
            className="take-play"
            onClick={toggle}
            aria-label={progress !== null ? "Stop the take" : "Play the take"}
          >
            {progress !== null ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
          </button>
          <span className="take-bars" aria-hidden="true">
            {(peaks ?? Array.from({ length: BARS }, () => 0.12)).map((peak, index) => (
              <i
                key={index}
                className={progress !== null && index / BARS <= progress ? "is-played" : ""}
                style={{ height: `${Math.round(peak * 100)}%` }}
              />
            ))}
          </span>
          <span className="take-time">{audio.duration ? `${audio.duration.toFixed(1)}s` : "—"}</span>
          <button className="take-remove" onClick={onRemove} aria-label="Remove the take" title="Remove the take">
            <Trash2 size={14} />
          </button>
        </div>
      ) : (
        <div className="take-wave is-empty">
          <span>
            {spoken
              ? `No recording yet · about ${Math.max(1, Math.round(spoken.split(/\s+/).length / 2.6))}s of speech`
              : "Write the line, then generate its voice."}
          </span>
        </div>
      )}
      {(problem || tooLong || (health && !ready)) && (
        <p className="take-problem" role="alert">
          <CircleAlert size={13} />
          {problem ||
            (tooLong
              ? `A voice line can hold at most ${maxCharacters.toLocaleString()} characters.`
              : !health?.configured
                ? "Set ELEVENLABS_API_KEY in .env.local and restart the studio to record voices."
                : "Lip sync tools (Rhubarb or FFmpeg) are missing.")}
        </p>
      )}
      {review && (
        <div className="take-review">
          <span>
            An earlier attempt for this line has an uncertain outcome. Check your ElevenLabs history
            before trying again.
          </span>
          <button
            onClick={() =>
              void archiveAttempt(review)
                .then((fresh) => {
                  if (!mounted.current) return;
                  setHealth(fresh);
                  setReview(undefined);
                  setProblem("");
                })
                .catch((error) => mounted.current && setProblem(error.message))
            }
          >
            I've checked — allow a new attempt
          </button>
        </div>
      )}
    </div>
  );
}
