import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AudioLines,
  Check,
  ChevronDown,
  Clapperboard,
  Eye,
  Focus,
  Grid2X2,
  ImagePlus,
  Layers3,
  Maximize2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { Background, Character, Pose } from "../engine";
import { resolveAssetUrl } from "../engine/asset-urls";
import { Portrait, defaultMotion } from "../components/Portrait";
import type { MotionSettings, PortraitHandle } from "../components/Portrait";
import { VoiceWorkbench, type VoiceResult } from "../components/VoiceWorkbench";

const motionLabels: {
  key: keyof MotionSettings;
  label: string;
  detail: string;
  icon: typeof Eye;
}[] = [
  {
    key: "blink",
    label: "Natural blinking",
    detail: "Independent, varied eye movement",
    icon: Eye,
  },
  {
    key: "breathing",
    label: "Breathing",
    detail: "Subtle rhythm through the body",
    icon: Activity,
  },
  {
    key: "head",
    label: "Head movement",
    detail: "Pose-aware rotation and nods",
    icon: Focus,
  },
  {
    key: "gaze",
    label: "Natural gaze",
    detail: "Small glances and eye movements",
    icon: Eye,
  },
  {
    key: "secondary",
    label: "Secondary motion",
    detail: "Hair and clothing follow through",
    icon: Layers3,
  },
  {
    key: "life",
    label: "Expressive performance",
    detail: "Speech-driven gestures and brows",
    icon: Sparkles,
  },
  {
    key: "mouth",
    label: "Lip sync",
    detail: "Mouth shapes follow the audio clock",
    icon: AudioLines,
  },
];
export interface LabProps {
  character?: Character;
  pose?: Pose;
  characters: Character[];
  backgrounds: Background[];
  onCharacter: (id: string) => void;
  onPose: (id: string) => void;
  onCharacterChange: (c: Character) => void;
  onRemovePose: (poseId: string) => void;
  onNotice: (m: string) => void;
  onAdd: () => void;
  onUseDialogue: (text: string, audio?: VoiceResult) => void;
}
export function AnimationLab({
  character,
  pose,
  characters,
  backgrounds,
  onCharacter,
  onPose,
  onCharacterChange,
  onRemovePose,
  onNotice,
  onAdd,
  onUseDialogue,
}: LabProps) {
  const [settings, setSettings] = useState<MotionSettings>({
    ...defaultMotion,
  });
  const [background, setBackground] = useState("studio");
  const [zoom, setZoom] = useState(100);
  const [showRig, setShowRig] = useState(false);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const [text, setText] = useState(
    "There you are. I was starting to think this story would have to begin without you.",
  );
  const [generated, setGenerated] = useState<VoiceResult>();
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [shape, setShape] = useState<string | null>(null);
  const [comparison, setComparison] = useState(false);
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(
    null,
  );
  const portrait = useRef<PortraitHandle>(null);
  const stage = useRef<HTMLDivElement>(null);
  const poses = character?.poses || [];
  const hasRig = !!pose?.animation;
  const supports = (key: keyof MotionSettings) =>
    key === "breathing" ||
    (!!pose?.animation &&
      (key === "mouth"
        ? !!pose.capabilities?.mouth
        : key === "blink"
          ? !!pose.capabilities?.blink
          : key === "gaze"
            ? !!pose.capabilities?.gaze
            : true));
  useEffect(() => {
    setGenerated(undefined);
    setAudioPlaying(false);
    setReady(false);
    setShape(null);
  }, [character?.id]);
  useEffect(() => {
    setReady(false);
    setShape(null);
    setAudioPlaying(false);
  }, [pose?.id]);
  useEffect(() => {
    let cancelled = false;
    setManifest(null);
    if (showRig && pose?.animation)
      fetch(pose.animation.manifestUrl)
        .then((r) => r.json())
        .then((data) => {
          if (!cancelled)
            setManifest(data.sprites?.[pose.animation!.poseKey] || null);
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showRig, pose?.animation]);
  const effective = paused
    ? {
        ...settings,
        blink: false,
        breathing: false,
        life: false,
        head: false,
        gaze: false,
        secondary: false,
        mouth: false,
      }
    : settings;
  async function playSample() {
    if (audioPlaying) {
      portrait.current?.stop();
      setAudioPlaying(false);
      return;
    }
    const src = generated?.audioSrc || character?.voice?.src;
    const cues = generated?.cueUrl || character?.voice?.cueUrl;
    if (!src) {
      onNotice("Generate a voice line below to hear this character.");
      return;
    }
    try {
      setAudioPlaying(true);
      await portrait.current?.play(src, cues);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "Audio could not be played.");
      setAudioPlaying(false);
    }
  }
  const backdrop = backgrounds.find((item) => item.id === background);
  const stageStyle = backdrop
    ? {
        backgroundImage: `url(${JSON.stringify(resolveAssetUrl(backdrop.src))})`,
      }
    : {};
  return (
    <div className="lab-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="live-dot" /> THE CHARACTER PLAYGROUND
          </div>
          <h1>
            Animation lab<span>.</span>
          </h1>
          <p>
            A little movement makes a character feel alive. Make it your own.
          </p>
        </div>
        <button className="button" onClick={onAdd}>
          <Plus size={16} /> Add character
        </button>
      </div>
      <div className="lab-layout">
        <div className="lab-center">
          <div className="preview-card">
            <div className="preview-toolbar">
              <div className="character-select">
                <span
                  className="character-color"
                  style={{ background: character?.color }}
                />
                <select
                  aria-label="Preview character"
                  value={character?.id || ""}
                  onChange={(e) => onCharacter(e.target.value)}
                >
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} />
                <span className="subtle-divider" />
                <span className="pose-label">{pose?.name}</span>
              </div>
              <div className="toolbar-group">
                <button
                  className={`icon-button ${comparison ? "is-active" : ""}`}
                  title="Compare with static portrait"
                  aria-label="Compare with static portrait"
                  aria-pressed={comparison}
                  onClick={() => setComparison(!comparison)}
                >
                  <Grid2X2 size={16} />
                </button>
                <button
                  className={`icon-button ${showRig ? "is-active" : ""}`}
                  title="Show rig regions"
                  aria-label="Show rig regions"
                  aria-pressed={showRig}
                  disabled={!hasRig}
                  onClick={() => setShowRig(!showRig)}
                >
                  <Focus size={17} />
                </button>
                <button
                  className="icon-button"
                  title="Fullscreen preview"
                  aria-label="Fullscreen preview"
                  onClick={() => {
                    if (document.fullscreenElement)
                      void document.exitFullscreen();
                    else
                      void stage.current
                        ?.requestFullscreen()
                        .catch(() =>
                          onNotice(
                            "Fullscreen is unavailable in this browser.",
                          ),
                        );
                  }}
                >
                  <Maximize2 size={16} />
                </button>
              </div>
            </div>
            <div
              ref={stage}
              className={`lab-stage stage-${backdrop ? "backdrop" : "studio"} ${comparison ? "comparison" : ""}`}
              style={stageStyle}
            >
              <div className="stage-badge">
                <span
                  className={hasRig && ready ? "live-dot" : "neutral-dot"}
                />
                {hasRig
                  ? ready
                    ? "RIG ACTIVE"
                    : "PREPARING RIG"
                  : "PORTRAIT PREVIEW"}
              </div>
              <span className="stage-coordinate">
                {showRig ? "REGISTERED ARTWORK" : "LIVE PREVIEW"} / 01
              </span>
              <div className="stage-ground" />
              {comparison && (
                <div className="static-comparison">
                  <img
                    src={resolveAssetUrl(pose?.src)}
                    alt={`${character?.name} static reference`}
                  />
                  <span>Original artwork</span>
                </div>
              )}
              <div
                className="lab-actor"
                style={{ transform: `translateX(-50%) scale(${zoom / 100})` }}
              >
                <Portrait
                  ref={portrait}
                  character={character}
                  pose={pose}
                  settings={effective}
                  onReady={setReady}
                  onEnded={() => setAudioPlaying(false)}
                />
                {showRig && manifest && <RigOverlay manifest={manifest} />}
              </div>
              {comparison && (
                <span className="animated-label">Animated rig</span>
              )}
              <div className="stage-tools">
                <label>
                  <ImagePlus size={14} />
                  <select
                    aria-label="Preview background"
                    value={background}
                    onChange={(e) => setBackground(e.target.value)}
                  >
                    <option value="studio">Studio backdrop</option>
                    {backgrounds.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <button
                    aria-label="Zoom out"
                    disabled={zoom <= 60}
                    onClick={() => setZoom((v) => Math.max(60, v - 10))}
                  >
                    −
                  </button>
                  <span>{zoom}%</span>
                  <button
                    aria-label="Zoom in"
                    disabled={zoom >= 140}
                    onClick={() => setZoom((v) => Math.min(140, v + 10))}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
            <div className="playback-bar">
              <button
                className="playback-button"
                aria-label={paused ? "Resume animation" : "Pause animation"}
                onClick={() => setPaused(!paused)}
              >
                {paused ? (
                  <Play size={14} fill="currentColor" />
                ) : (
                  <Pause size={14} fill="currentColor" />
                )}
              </button>
              <div className={`animation-signal ${paused ? "paused" : ""}`}>
                {Array.from({ length: 22 }, (_, i) => (
                  <i
                    key={i}
                    style={{
                      height: `${6 + Math.sin(i * 1.7) ** 2 * 16}px`,
                      animationDelay: `${i * 0.09}s`,
                    }}
                  />
                ))}
              </div>
              <span className="playback-label">
                {paused ? "Motion paused" : "Ambient motion"}
              </span>
              <span className="playback-meta">
                {hasRig
                  ? "Audio-driven performance"
                  : "Original starter artwork"}
              </span>
              <button
                className="text-button"
                onClick={() => {
                  setSettings({ ...defaultMotion });
                  setZoom(100);
                  setPaused(false);
                  setShape(null);
                  portrait.current?.mouth(null);
                  onNotice("Animation settings reset.");
                }}
              >
                <RotateCcw size={13} /> Reset
              </button>
            </div>
          </div>
          <div className="expressions-heading">
            <span>
              Expressions <b>{poses.length.toString().padStart(2, "0")}</b>
            </span>
            <span>Same character. A different moment.</span>
          </div>
          <div className="expression-strip" aria-label="Expressions">
            {poses.map((p) => (
              <button
                key={p.id}
                aria-pressed={p.id === pose?.id}
                className={`expression-card ${p.id === pose?.id ? "selected" : ""}`}
                onClick={() => onPose(p.id)}
              >
                <div>
                  <img src={resolveAssetUrl(p.src)} alt="" loading="lazy" />
                  {p.id === pose?.id && (
                    <span>
                      <Check size={11} />
                    </span>
                  )}
                </div>
                <strong>{p.name}</strong>
              </button>
            ))}
          </div>
          <section className="dialogue-lab panel">
            <div className="section-heading">
              <span>
                <Clapperboard size={16} /> Dialogue test
              </span>
              <span className="small-label">{character?.name}</span>
            </div>
            <label htmlFor="lab-dialogue" className="dialogue-prompt">
              Give them something to say.
            </label>
            <textarea
              id="lab-dialogue"
              value={text}
              maxLength={1500}
              onChange={(e) => {
                setText(e.target.value);
                setGenerated(undefined);
                portrait.current?.stop();
              }}
              placeholder="Write a line of dialogue…"
              rows={3}
            />
            <div className="dialogue-bottom">
              <span>
                <span className="tiny-dot" />{" "}
                {generated
                  ? "Voice & mouth cues attached"
                  : "Try a new line, or preview the existing voice sample."}
              </span>
              <button
                className="button small"
                onClick={() => void playSample()}
                disabled={!generated && !character?.voice}
              >
                {audioPlaying ? <AudioLines size={14} /> : <Play size={13} />}{" "}
                {audioPlaying
                  ? "Stop playback"
                  : generated
                    ? "Play generated line"
                    : "Play voice sample"}
              </button>
            </div>
            <VoiceWorkbench
              key={character?.id}
              character={character}
              text={text}
              onVoiceChange={(id) =>
                character && onCharacterChange({ ...character, voiceId: id })
              }
              onGenerated={(r) => {
                setGenerated(r);
                onNotice(
                  "Voice generated and mouth cues mapped. Press Play generated line to preview.",
                );
              }}
            />
            <div className="use-dialogue-row">
              <span className="field-hint">
                Like this moment? Bring it into your story.
              </span>
              <button
                className="button small"
                disabled={!text.trim()}
                onClick={() => onUseDialogue(text, generated)}
              >
                <Plus size={14} /> Use in story
              </button>
            </div>
          </section>
        </div>
        <aside className="inspector panel">
          <div className="inspector-title">
            <SlidersHorizontal size={17} />
            <h2>Performance</h2>
            <span className="small-label">LIVE</span>
          </div>
          <div className="inspector-section">
            <div className="section-caption">EXPRESSION</div>
            <select
              className="expression-select"
              aria-label="Expression"
              value={pose?.id || ""}
              onChange={(e) => onPose(e.target.value)}
            >
              {poses.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="capability-chips">
              <span className={hasRig ? "available" : ""}>
                <span />
                {hasRig ? "Calibrated rig" : "Static portrait"}
              </span>
              <span>{hasRig ? "Per-pose artwork" : "Breathing available"}</span>
            </div>
            <button
              className="text-button"
              disabled={!pose || poses.length < 2}
              onClick={() => pose && onRemovePose(pose.id)}
            >
              <Trash2 size={12} /> Remove expression
            </button>
          </div>
          <div className="inspector-section">
            <div className="section-caption">
              ANIMATION LAYERS{" "}
              <span>
                {String(
                  motionLabels.filter((layer) => supports(layer.key)).length,
                ).padStart(2, "0")}
              </span>
            </div>
            <div className="motion-controls">
              {motionLabels.map((m) => (
                <label
                  className={`motion-row ${!supports(m.key) ? "unavailable" : ""}`}
                  key={m.key}
                >
                  <m.icon size={15} />
                  <span>
                    <strong>{m.label}</strong>
                    <small>{m.detail}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={supports(m.key) && !!settings[m.key]}
                    disabled={!supports(m.key)}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, [m.key]: e.target.checked }))
                    }
                  />
                  <i className="switch" />
                </label>
              ))}
            </div>
          </div>
          <div className="inspector-section">
            <div className="section-caption">QUICK TESTS</div>
            <div className="quick-tests">
              <button
                className="button small"
                disabled={!hasRig}
                onClick={() => portrait.current?.blink()}
              >
                <Eye size={14} /> Blink once
              </button>
              <button
                className="button small"
                onClick={() => void playSample()}
                disabled={!generated && !character?.voice}
              >
                <AudioLines size={14} /> Voice
              </button>
            </div>
            <div className="mouth-shapes" aria-label="Mouth shape test">
              {["X", "A", "B", "C", "D", "E", "F"].map((s) => (
                <button
                  key={s}
                  title={s === "X" ? "Rest shape" : `Mouth shape ${s}`}
                  aria-pressed={shape === s}
                  disabled={!pose?.capabilities?.mouth}
                  className={shape === s ? "active" : ""}
                  onClick={() => {
                    const value = shape === s ? null : s;
                    setShape(value);
                    portrait.current?.mouth(value);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
            <p className="field-hint">
              {shape
                ? `Holding shape ${shape}. Click it again to follow audio.`
                : "Inspect individual mouth shapes, then hear them in motion."}
            </p>
          </div>
          <div className="inspector-section">
            <div className="section-caption">
              BROW EXPRESSION{" "}
              <button
                className="text-button"
                disabled={!pose?.capabilities?.brows}
                aria-pressed={settings.brow === null}
                onClick={() => setSettings((s) => ({ ...s, brow: null }))}
              >
                {settings.brow === null ? "Automatic" : "Return to auto"}
              </button>
            </div>
            <label className="range-row">
              <span>Furrow</span>
              <input
                type="range"
                aria-label="Brow expression"
                min="-1"
                max="1"
                step="0.05"
                value={settings.brow ?? 0}
                disabled={!pose?.capabilities?.brows}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, brow: Number(e.target.value) }))
                }
              />
              <span>Raise</span>
            </label>
          </div>
          <div className="inspector-section">
            <div className="section-caption">VOICE LEVEL</div>
            <label className="range-row">
              <AudioLines size={15} />
              <input
                type="range"
                aria-label="Voice volume"
                min="0"
                max="1"
                step="0.05"
                value={settings.volume}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, volume: Number(e.target.value) }))
                }
              />
              <span>{Math.round(settings.volume * 100)}%</span>
            </label>
          </div>
          <div className="inspector-tip">
            <span>
              <Sparkles size={17} />
            </span>
            <div>
              <strong>A rig that stays with you.</strong>
              <p>
                Write new dialogue. The voice and mouth timing change; your
                carefully tuned character stays intact.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function RigOverlay({ manifest }: { manifest: Record<string, unknown> }) {
  const mouth = manifest.mouth as
    { x: number; y: number; width: number; height: number } | undefined;
  const blink = manifest.blink as
    | {
        eyes?: {
          rect: { x: number; y: number; width: number; height: number };
        }[];
      }
    | undefined;
  return (
    <svg
      className="rig-overlay"
      viewBox={`0 0 ${manifest.sourceWidth || 1024} ${manifest.sourceHeight || 1024}`}
      aria-label="Registered mouth and eye regions"
    >
      {mouth && (
        <g>
          <rect
            {...mouth}
            fill="rgba(167,219,112,.12)"
            stroke="#b7ed72"
            strokeWidth="2"
          />
          <text x={mouth.x} y={mouth.y - 10}>
            MOUTH
          </text>
        </g>
      )}
      {blink?.eyes?.map((e, i) => (
        <g key={i}>
          <rect
            {...e.rect}
            fill="rgba(117,195,237,.12)"
            stroke="#78d7e9"
            strokeWidth="2"
          />
          <text x={e.rect.x} y={e.rect.y - 10}>
            EYE {i + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}
