import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  Check,
  CircleAlert,
  History,
  ListPlus,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import {
  MAX_STAGE_ACTORS,
  createId,
  type Character,
  type DialogueNode,
  type Project,
  type VoiceSettings,
} from "../engine";
import {
  getHealth,
  getVoices,
  requestVoice,
  voiceErrorMessage,
  type Health,
  type Voice,
  type VoiceResult,
} from "../components/VoiceWorkbench";

interface Props {
  project: Project;
  onChange: (project: Project, discrete?: boolean) => void;
  onNotice: (message: string) => void;
  onOpenScene: (nodeId: string) => void;
}

interface Block {
  id: string;
  characterId?: string;
  poseId?: string;
  voiceId?: string;
  text: string;
  direction?: string;
  result?: VoiceResult;
  /** The exact request text the result belongs to. */
  resultFor?: string;
}

interface HistoryItem {
  id: string;
  text: string;
  voiceId: string;
  duration: number;
  audioSrc: string;
  cueUrl: string;
  createdAt: string;
  characterCost: string | null;
}

const DIRECTIONS = [
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
const LANGUAGES: [string, string][] = [
  ["", "Detect automatically"],
  ["en", "English"],
  ["de", "German"],
  ["fr", "French"],
  ["es", "Spanish"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["nl", "Dutch"],
  ["pl", "Polish"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh", "Chinese"],
];
const DEFAULT_SETTINGS: VoiceSettings = { stability: 0.5, similarity: 0.75 };
const MAX_CHARACTERS = 2000;

const requestText = (block: Block) =>
  (block.direction ? `[${block.direction}] ${block.text}` : block.text).trim();
const storageKey = (projectId: string) => `frame-voice-script:${projectId}`;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function loadBlocks(project: Project): Block[] {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey(project.id)) ?? "null");
    if (Array.isArray(stored) && stored.length) return stored as Block[];
  } catch {
    /* Start fresh. */
  }
  const first = project.characters[0];
  return [
    {
      id: createId("line"),
      characterId: first?.id,
      poseId: first?.poses[0]?.id,
      voiceId: first?.voiceId,
      text: "",
    },
  ];
}

/**
 * Text to speech for the cast, in the spirit of ElevenLabs' own studio: pick who speaks, write
 * the line, tune the delivery, listen, then place the finished lines straight into the story.
 * Every generation is an explicit click; nothing retries or generates in the background.
 */
export function VoiceStudio({ project, onChange, onNotice, onOpenScene }: Props) {
  const [blocks, setBlocks] = useState<Block[]>(() => loadBlocks(project));
  const [selectedId, setSelectedId] = useState(() => blocks[0]?.id);
  const [health, setHealth] = useState<Health>();
  const [healthError, setHealthError] = useState("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceError, setVoiceError] = useState("");
  const [filter, setFilter] = useState("");
  const [panel, setPanel] = useState<"settings" | "history">("settings");
  const [history, setHistory] = useState<HistoryItem[]>();
  const [busy, setBusy] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [batch, setBatch] = useState<{ ids: string[]; done: number; running: boolean; error?: string }>();
  const [inserting, setInserting] = useState(false);
  const [playing, setPlaying] = useState<string>();
  const audio = useRef<HTMLAudioElement | null>(null);
  const stopBatch = useRef(false);
  const latestBlocks = useRef(blocks);
  latestBlocks.current = blocks;

  useEffect(() => {
    localStorage.setItem(storageKey(project.id), JSON.stringify(blocks));
  }, [blocks, project.id]);
  useEffect(() => {
    let active = true;
    getHealth()
      .then((value) => {
        if (!active) return;
        setHealth(value);
        if (value.configured)
          getVoices()
            .then((list) => active && setVoices(list))
            .catch((error) => active && setVoiceError(error instanceof Error ? error.message : "Voices are unavailable."));
      })
      .catch((error) => active && setHealthError(error instanceof Error ? error.message : "The voice service is unavailable."));
    return () => {
      active = false;
      audio.current?.pause();
      stopBatch.current = true;
    };
  }, []);
  useEffect(() => {
    if (panel !== "history" || history) return;
    fetch("/api/voice/history")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(voiceErrorMessage(data));
        setHistory(data.items ?? []);
      })
      .catch(() => setHistory([]));
  }, [panel, history]);

  const characters = useMemo(
    () => new Map(project.characters.map((item) => [item.id, item])),
    [project.characters],
  );
  const voiceNames = useMemo(() => new Map(voices.map((voice) => [voice.id, voice.name])), [voices]);
  const selected = blocks.find((block) => block.id === selectedId) ?? blocks[0];
  const selectedCharacter = selected?.characterId ? characters.get(selected.characterId) : undefined;
  const settings: VoiceSettings = selectedCharacter?.voiceSettings ?? DEFAULT_SETTINGS;
  const ready = !!health?.configured && health.rhubarb && health.ffmpeg;

  const update = (id: string, patch: Partial<Block>) =>
    setBlocks((list) =>
      list.map((block) => {
        if (block.id !== id) return block;
        const next = { ...block, ...patch };
        // A result only belongs to the exact words and voice it was made from.
        if (next.result && (requestText(next) !== next.resultFor || next.voiceId !== next.result.voiceId))
          return { ...next, result: undefined, resultFor: undefined };
        return next;
      }),
    );
  const updateCharacter = (character: Character, patch: Partial<Character>) =>
    onChange({
      ...project,
      characters: project.characters.map((item) => (item.id === character.id ? { ...item, ...patch } : item)),
    });
  const setSetting = (patch: Partial<VoiceSettings>) => {
    if (!selectedCharacter) return;
    const next = { ...settings, ...patch };
    if (!next.languageCode) delete next.languageCode;
    updateCharacter(selectedCharacter, { voiceSettings: next });
  };
  const chooseVoice = (voiceId: string) => {
    if (!selected) return;
    update(selected.id, { voiceId });
    if (selectedCharacter && !selectedCharacter.voiceId) updateCharacter(selectedCharacter, { voiceId });
  };
  const addBlock = (after?: string) => {
    const anchor = blocks.find((block) => block.id === after) ?? blocks[blocks.length - 1];
    // Conversations alternate: the next line defaults to the previous line's partner.
    const speakers = [...new Set(blocks.map((block) => block.characterId).filter(Boolean))] as string[];
    const nextSpeaker =
      speakers.length > 1
        ? speakers[(speakers.indexOf(anchor?.characterId ?? "") + 1) % speakers.length]
        : anchor?.characterId;
    const character = nextSpeaker ? characters.get(nextSpeaker) : undefined;
    const block: Block = {
      id: createId("line"),
      characterId: character?.id,
      poseId: character?.poses[0]?.id,
      voiceId: character?.voiceId,
      text: "",
    };
    setBlocks((list) => {
      const index = list.findIndex((item) => item.id === anchor?.id);
      const next = [...list];
      next.splice(index + 1, 0, block);
      return next;
    });
    setSelectedId(block.id);
  };
  const move = (id: string, direction: -1 | 1) =>
    setBlocks((list) => {
      const index = list.findIndex((block) => block.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  function play(id: string, src: string) {
    audio.current?.pause();
    if (playing === id) {
      setPlaying(undefined);
      return;
    }
    const element = new Audio(src);
    element.onended = () => setPlaying((current) => (current === id ? undefined : current));
    audio.current = element;
    setPlaying(id);
    void element.play().catch(() => {
      setPlaying(undefined);
      onNotice("This audio could not be played.");
    });
  }

  async function generate(block: Block): Promise<boolean> {
    const character = block.characterId ? characters.get(block.characterId) : undefined;
    const voiceId = block.voiceId ?? character?.voiceId;
    const text = requestText(block);
    if (!voiceId || !block.text.trim() || text.length > MAX_CHARACTERS) return false;
    setBusy(block.id);
    setErrors(({ [block.id]: _, ...rest }) => rest);
    try {
      const { ok, data } = await requestVoice({
        text,
        voiceId,
        ...(character?.voiceSettings ?? DEFAULT_SETTINGS),
      });
      if (!ok) {
        setErrors((list) => ({
          ...list,
          [block.id]:
            voiceErrorMessage(data) +
            (data.error?.code === "attempt_needs_review"
              ? " Review it in a scene's voice panel before generating this line again."
              : ""),
        }));
        return false;
      }
      setBlocks((list) =>
        list.map((item) =>
          // Attach only if the words, speaker and voice are still what was sent; otherwise the
          // take stays in History.
          item.id === block.id &&
          requestText(item) === text &&
          item.characterId === block.characterId &&
          (item.voiceId ?? characters.get(item.characterId ?? "")?.voiceId) === voiceId
            ? { ...item, voiceId, result: data as VoiceResult, resultFor: text }
            : item,
        ),
      );
      setHistory(undefined);
      return true;
    } catch (error) {
      setErrors((list) => ({
        ...list,
        [block.id]: error instanceof Error ? error.message : "The voice service could not be reached.",
      }));
      return false;
    } finally {
      setBusy(undefined);
    }
  }

  const pending = blocks.filter((block) => {
    const character = block.characterId ? characters.get(block.characterId) : undefined;
    return !block.result && block.text.trim() && (block.voiceId ?? character?.voiceId) && requestText(block).length <= MAX_CHARACTERS;
  });
  const pendingCharacters = pending.reduce((sum, block) => sum + requestText(block).length, 0);
  async function runBatch(ids: string[]) {
    stopBatch.current = false;
    setBatch({ ids, done: 0, running: true });
    for (const [index, id] of ids.entries()) {
      if (stopBatch.current) break;
      const block = latestBlocks.current.find((item) => item.id === id);
      if (!block || block.result) {
        setBatch((value) => value && { ...value, done: index + 1 });
        continue;
      }
      const ok = await generate(block);
      if (!ok) {
        setBatch((value) => value && { ...value, running: false, error: "Stopped at the first line that failed. Nothing was retried." });
        return;
      }
      setBatch((value) => value && { ...value, done: index + 1 });
    }
    setBatch((value) => value && { ...value, running: false });
  }

  const usable = blocks.filter((block) => block.text.trim());
  const visibleVoices = voices.filter((voice) =>
    `${voice.name} ${Object.values(voice.labels ?? {}).join(" ")}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const totalCharacters = blocks.reduce((sum, block) => sum + requestText(block).length, 0);

  return (
    <div className="voice-studio">
      <div className="page-heading">
        <div>
          <div className="eyebrow">TEXT TO SPEECH · ELEVEN v4 · LIP SYNC</div>
          <h1>
            Voice studio<span>.</span>
          </h1>
          <p>Choose who speaks. Write the line. Hear it with mouth timing, then put it in your story.</p>
        </div>
        <span className={`vs-status ${ready ? "is-ready" : ""}`}>
          <span />
          {health
            ? !health.configured
              ? "ElevenLabs not connected"
              : !health.rhubarb || !health.ffmpeg
                ? "Lip sync tools missing"
                : "Connected"
            : healthError || "Checking voice service…"}
        </span>
      </div>

      <div className="vs-layout">
        <section className="panel vs-script" aria-label="Script">
          <div className="vs-script-heading">
            <div>
              <h2>Script</h2>
              <span className="muted">
                {blocks.length} line{blocks.length === 1 ? "" : "s"} · {totalCharacters.toLocaleString()} characters
              </span>
            </div>
            <button className="button small" onClick={() => addBlock(selected?.id)}>
              <Plus size={14} /> Add line
            </button>
          </div>
          <ol className="vs-blocks">
            {blocks.map((block, index) => {
              const character = block.characterId ? characters.get(block.characterId) : undefined;
              const voiceId = block.voiceId ?? character?.voiceId;
              const text = requestText(block);
              const isSelected = block.id === selected?.id;
              return (
                <li
                  key={block.id}
                  className={`vs-block ${isSelected ? "is-selected" : ""}`}
                  onFocusCapture={() => setSelectedId(block.id)}
                  onClick={() => setSelectedId(block.id)}
                >
                  <div className="vs-speaker">
                    <span className="vs-avatar" style={{ background: character?.color ?? "#8a948a" }}>
                      {character ? initials(character.name) : "N"}
                    </span>
                    <select
                      aria-label={`Line ${index + 1} speaker`}
                      value={block.characterId ?? ""}
                      onChange={(event) => {
                        const next = characters.get(event.target.value);
                        update(block.id, {
                          characterId: next?.id,
                          poseId: next?.poses[0]?.id,
                          voiceId: next?.voiceId ?? block.voiceId,
                        });
                      }}
                    >
                      <option value="">Narrator</option>
                      {project.characters.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                    <span className="vs-voice-name">
                      {voiceId ? (voiceNames.get(voiceId) ?? "Saved voice") : "No voice yet"}
                    </span>
                    <span className="vs-block-tools">
                      <button className="icon-button" aria-label={`Move line ${index + 1} up`} disabled={index === 0} onClick={() => move(block.id, -1)}>
                        <ArrowUp size={14} />
                      </button>
                      <button className="icon-button" aria-label={`Move line ${index + 1} down`} disabled={index === blocks.length - 1} onClick={() => move(block.id, 1)}>
                        <ArrowDown size={14} />
                      </button>
                      <button
                        className="icon-button danger"
                        aria-label={`Remove line ${index + 1}`}
                        disabled={blocks.length < 2}
                        onClick={() => setBlocks((list) => list.filter((item) => item.id !== block.id))}
                      >
                        <Trash2 size={14} />
                      </button>
                    </span>
                  </div>
                  <textarea
                    aria-label={`Line ${index + 1} text`}
                    value={block.text}
                    rows={Math.min(8, Math.max(2, Math.ceil(block.text.length / 90)))}
                    placeholder={character ? `What does ${character.name} say?` : "Narration…"}
                    onChange={(event) => update(block.id, { text: event.target.value })}
                  />
                  <div className="vs-block-footer">
                    <select
                      aria-label={`Line ${index + 1} delivery`}
                      value={block.direction ?? ""}
                      onChange={(event) => update(block.id, { direction: event.target.value || undefined })}
                    >
                      {DIRECTIONS.map((direction) => (
                        <option key={direction} value={direction}>
                          {direction ? `[${direction}]` : "Natural delivery"}
                        </option>
                      ))}
                    </select>
                    <span className={`vs-count ${text.length > MAX_CHARACTERS ? "is-over" : ""}`}>
                      {text.length.toLocaleString()} / {MAX_CHARACTERS.toLocaleString()}
                    </span>
                    {block.result && (
                      <button
                        className="button small vs-play"
                        onClick={(event) => {
                          event.stopPropagation();
                          play(block.id, block.result!.audioSrc);
                        }}
                      >
                        {playing === block.id ? <Pause size={13} /> : <Play size={13} fill="currentColor" />}
                        {block.result.duration.toFixed(1)}s{block.result.cached ? " · saved" : ""}
                      </button>
                    )}
                    <button
                      className="button small primary"
                      disabled={!ready || !voiceId || !block.text.trim() || text.length > MAX_CHARACTERS || !!busy || !!batch?.running}
                      title={!voiceId ? "Choose a voice in the settings panel first" : undefined}
                      onClick={(event) => {
                        event.stopPropagation();
                        void generate(block);
                      }}
                    >
                      {busy === block.id ? <LoaderCircle size={13} className="spin" /> : <WandSparkles size={13} />}
                      {block.result ? "New take" : "Generate"}
                    </button>
                  </div>
                  {errors[block.id] && (
                    <p className="inline-error" role="alert">
                      <CircleAlert size={13} /> {errors[block.id]}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="vs-script-footer">
            <span className="muted">
              {pending.length
                ? `${pending.length} line${pending.length === 1 ? "" : "s"} without audio · up to ${pendingCharacters.toLocaleString()} characters of your plan`
                : "Every line with a voice has audio."}
            </span>
            <button
              className="button small"
              disabled={!ready || !pending.length || !!busy || !!batch?.running}
              onClick={() => setBatch({ ids: pending.map((block) => block.id), done: 0, running: false })}
            >
              <AudioLines size={14} /> Generate all…
            </button>
            <button className="button small primary" disabled={!usable.length} onClick={() => setInserting(true)}>
              <ListPlus size={14} /> Add {usable.length} line{usable.length === 1 ? "" : "s"} to story…
            </button>
          </div>
        </section>

        <aside className="panel vs-side" aria-label="Voice settings">
          <div className="vs-side-tabs" role="tablist">
            <button role="tab" aria-selected={panel === "settings"} className={panel === "settings" ? "is-active" : ""} onClick={() => setPanel("settings")}>
              <SlidersHorizontal size={14} /> Settings
            </button>
            <button role="tab" aria-selected={panel === "history"} className={panel === "history" ? "is-active" : ""} onClick={() => setPanel("history")}>
              <History size={14} /> History
            </button>
          </div>
          {panel === "settings" ? (
            <div className="vs-settings">
              <div className="vs-settings-for">
                <span className="vs-avatar small" style={{ background: selectedCharacter?.color ?? "#8a948a" }}>
                  {selectedCharacter ? initials(selectedCharacter.name) : "N"}
                </span>
                <div>
                  <strong>{selectedCharacter?.name ?? "Narrator"}</strong>
                  <span className="muted">Settings for the selected line</span>
                </div>
              </div>
              {!health?.configured && health && (
                <p className="field-hint">
                  Set ELEVENLABS_API_KEY in .env.local and restart the studio to list your voices. You can
                  still write the script and reuse saved audio from History.
                </p>
              )}
              {voiceError && <p className="inline-error">{voiceError}</p>}
              <label className="vs-search">
                <Search size={14} />
                <input placeholder="Search voices, accents, ages…" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Search voices" />
              </label>
              <ul className="vs-voices" aria-label="Voices">
                {visibleVoices.slice(0, 80).map((voice) => {
                  const active = (selected?.voiceId ?? selectedCharacter?.voiceId) === voice.id;
                  const labels = Object.values(voice.labels ?? {}).slice(0, 3).join(" · ");
                  return (
                    <li key={voice.id} className={active ? "is-active" : ""}>
                      <button className="vs-voice" onClick={() => chooseVoice(voice.id)} aria-pressed={active}>
                        <strong>{voice.name}</strong>
                        <span>{labels || voice.category}</span>
                      </button>
                      {voice.previewUrl && (
                        <button
                          className="icon-button"
                          aria-label={`Preview ${voice.name}`}
                          onClick={() => play(`preview:${voice.id}`, voice.previewUrl!)}
                        >
                          {playing === `preview:${voice.id}` ? <Pause size={13} /> : <Play size={13} />}
                        </button>
                      )}
                      {active && <Check size={14} className="vs-check" />}
                    </li>
                  );
                })}
                {health?.configured && !voices.length && !voiceError && (
                  <li className="muted">
                    <LoaderCircle size={14} className="spin" /> Loading your voices…
                  </li>
                )}
              </ul>
              <div className="vs-sliders">
                <label>
                  <span>
                    Stability <em>{Math.round(settings.stability * 100)}%</em>
                  </span>
                  <input type="range" min="0" max="1" step="0.05" value={settings.stability} disabled={!selectedCharacter} onChange={(event) => setSetting({ stability: Number(event.target.value) })} />
                  <small>More variable ←→ More stable</small>
                </label>
                <label>
                  <span>
                    Similarity <em>{Math.round(settings.similarity * 100)}%</em>
                  </span>
                  <input type="range" min="0" max="1" step="0.05" value={settings.similarity} disabled={!selectedCharacter} onChange={(event) => setSetting({ similarity: Number(event.target.value) })} />
                  <small>Low ←→ High</small>
                </label>
                <label>
                  <span>Language</span>
                  <select value={settings.languageCode ?? ""} disabled={!selectedCharacter} onChange={(event) => setSetting({ languageCode: event.target.value || undefined })}>
                    {LANGUAGES.map(([code, name]) => (
                      <option key={code} value={code}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {selectedCharacter && selected?.voiceId && selected.voiceId !== selectedCharacter.voiceId && (
                <button className="button small" onClick={() => updateCharacter(selectedCharacter, { voiceId: selected.voiceId })}>
                  Make this {selectedCharacter.name}'s voice
                </button>
              )}
              <p className="field-hint">
                Settings belong to the character and apply to their scene lines too. Identical requests reuse
                saved audio at no cost.
              </p>
            </div>
          ) : (
            <div className="vs-history">
              {!history ? (
                <p className="muted">
                  <LoaderCircle size={14} className="spin" /> Reading saved generations…
                </p>
              ) : !history.length ? (
                <p className="muted">Generated lines appear here, saved on this computer.</p>
              ) : (
                <ul>
                  {history.map((item) => (
                    <li key={item.id}>
                      <button className="icon-button" aria-label="Play saved line" onClick={() => play(`history:${item.id}`, item.audioSrc)}>
                        {playing === `history:${item.id}` ? <Pause size={13} /> : <Play size={13} />}
                      </button>
                      <div>
                        <p>{item.text}</p>
                        <span className="muted">
                          {voiceNames.get(item.voiceId) ?? "Voice"} · {item.duration.toFixed(1)}s · {new Date(item.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <button
                        className="button small"
                        onClick={() => {
                          const match = project.characters.find((character) => character.voiceId === item.voiceId);
                          const text = item.text.replace(/^\[[^\]]*\]\s*/, "");
                          const direction = item.text.match(/^\[([^\]]*)\]/)?.[1];
                          const block: Block = {
                            id: createId("line"),
                            characterId: match?.id,
                            poseId: match?.poses[0]?.id,
                            voiceId: item.voiceId,
                            text,
                            ...(direction ? { direction } : {}),
                            result: {
                              id: item.id,
                              audioSrc: item.audioSrc,
                              cueUrl: item.cueUrl,
                              duration: item.duration,
                              model: "eleven_v4",
                              voiceId: item.voiceId,
                              cached: true,
                              cueSource: "rhubarb",
                            },
                            resultFor: item.text.trim(),
                          };
                          setBlocks((list) => [...list.filter((entry) => entry.text.trim() || entry.result), block]);
                          setSelectedId(block.id);
                          onNotice("Saved line added to the script. No new generation was needed.");
                        }}
                      >
                        Use
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>
      </div>

      {batch && !batch.running && batch.done === 0 && !batch.error && (
        <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && setBatch(undefined)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="vs-batch-title">
            <button className="modal-close icon-button" aria-label="Close" onClick={() => setBatch(undefined)}>
              <X size={18} />
            </button>
            <div className="eyebrow">ELEVEN v4 · RHUBARB</div>
            <h2 id="vs-batch-title">Generate {batch.ids.length} lines?</h2>
            <p>
              This sends {batch.ids.length} request{batch.ids.length === 1 ? "" : "s"}, one at a time, using up to{" "}
              {pendingCharacters.toLocaleString()} characters of your ElevenLabs plan. It stops at the first failure and never
              retries by itself.
            </p>
            <div className="modal-footer">
              <button className="button" onClick={() => setBatch(undefined)}>
                Cancel
              </button>
              <button className="button primary" onClick={() => void runBatch(batch.ids)}>
                <AudioLines size={15} /> Generate {batch.ids.length} lines
              </button>
            </div>
          </div>
        </div>
      )}
      {batch && (batch.running || batch.done > 0 || batch.error) && (
        <div className="vs-batch-bar" role="status">
          {batch.running && <LoaderCircle size={14} className="spin" />}
          {batch.done} of {batch.ids.length} generated{batch.error ? ` · ${batch.error}` : batch.running ? "" : " · done"}
          {batch.running ? (
            <button className="button small" onClick={() => (stopBatch.current = true)}>
              Stop after this line
            </button>
          ) : (
            <button className="icon-button" aria-label="Dismiss" onClick={() => setBatch(undefined)}>
              <X size={14} />
            </button>
          )}
        </div>
      )}
      {inserting && (
        <InsertDialog
          project={project}
          blocks={usable}
          onClose={() => setInserting(false)}
          onInsert={(next, firstId) => {
            onChange(next, true);
            setInserting(false);
            onNotice(`${usable.length} line${usable.length === 1 ? "" : "s"} added to your story with their voices.`);
            onOpenScene(firstId);
          }}
        />
      )}
    </div>
  );
}

/** Turns script lines into staged dialogue scenes: everyone in the conversation stays on stage. */
function InsertDialog({
  project,
  blocks,
  onClose,
  onInsert,
}: {
  project: Project;
  blocks: Block[];
  onClose: () => void;
  onInsert: (project: Project, firstId: string) => void;
}) {
  const dialogues = project.nodes.filter((node) => node.type === "dialogue");
  const [after, setAfter] = useState(dialogues[dialogues.length - 1]?.id ?? "");
  const anchor = project.nodes.find((node) => node.id === after);
  const [backgroundId, setBackgroundId] = useState(anchor?.backgroundId ?? project.backgrounds[0]?.id ?? "");
  const [stageEveryone, setStageEveryone] = useState(true);
  function insert() {
    const speakers = [...new Set(blocks.map((block) => block.characterId).filter(Boolean))] as string[];
    const slots = new Map(
      speakers.map((id, index) => [id, speakers.length === 1 ? 50 : Math.round(((index + 1) / (speakers.length + 1)) * 100)]),
    );
    const ids = blocks.map(() => createId("scene"));
    const continuation = anchor?.type === "dialogue" ? anchor.nextId : null;
    const nodes: DialogueNode[] = blocks.map((block, index) => {
      const character = block.characterId ? project.characters.find((item) => item.id === block.characterId) : undefined;
      const position = (block.characterId && slots.get(block.characterId)) || 50;
      const result = block.result && block.resultFor === requestText(block) ? block.result : undefined;
      // A scene shows at most five listeners: keep the ones who spoke most recently.
      const recent = blocks
        .slice(0, index)
        .reverse()
        .map((item) => item.characterId)
        .concat(speakers)
        .filter((id): id is string => !!id && id !== block.characterId);
      const cast = stageEveryone
        ? [...new Set(recent)]
            .slice(0, MAX_STAGE_ACTORS)
            .map((id) => ({ characterId: id, position: slots.get(id)! }))
        : [];
      return {
        id: ids[index],
        type: "dialogue",
        label: `${character?.name ?? "Narration"}: ${block.text.trim().slice(0, 40)}`,
        text: block.text.trim(),
        ...(character ? { characterId: character.id, poseId: block.poseId ?? character.poses[0]?.id } : {}),
        ...(backgroundId ? { backgroundId } : {}),
        position,
        ...(cast.length ? { cast } : {}),
        ...(result ? { audioSrc: result.audioSrc, cueUrl: result.cueUrl, audioDuration: result.duration, textTimings: undefined } : {}),
        nextId: index < blocks.length - 1 ? ids[index + 1] : continuation,
      };
    });
    const list = project.nodes.map((node) =>
      anchor && node.id === anchor.id && node.type === "dialogue" ? { ...node, nextId: ids[0] } : node,
    );
    const index = list.findIndex((node) => node.id === after);
    list.splice(index < 0 ? list.length : index + 1, 0, ...nodes);
    onInsert({ ...project, nodes: list }, ids[0]);
  }
  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="vs-insert-title">
        <button className="modal-close icon-button" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
        <div className="eyebrow">FROM SCRIPT TO STAGE</div>
        <h2 id="vs-insert-title">Add {blocks.length} lines to the story</h2>
        <p>
          Each line becomes a dialogue scene with its voice and mouth timing. Lines without audio can be voiced later.
        </p>
        <label className="form-field">
          <span>Insert after</span>
          <select value={after} onChange={(event) => setAfter(event.target.value)}>
            <option value="">The end of the scene list (unconnected)</option>
            {dialogues.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Background</span>
          <select value={backgroundId} onChange={(event) => setBackgroundId(event.target.value)}>
            <option value="">Studio backdrop</option>
            {project.backgrounds.map((background) => (
              <option key={background.id} value={background.id}>
                {background.name}
              </option>
            ))}
          </select>
        </label>
        <label className="check-field">
          <input type="checkbox" checked={stageEveryone} onChange={(event) => setStageEveryone(event.target.checked)} />
          Keep everyone in the conversation on stage
        </label>
        <div className="modal-footer">
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" onClick={insert}>
            <ListPlus size={15} /> Add to story
          </button>
        </div>
      </div>
    </div>
  );
}
