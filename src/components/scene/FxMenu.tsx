import { useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { TEXT_BEHAVIORS, type TextBehaviorName, type TextEntry } from "../../engine";
import { TextSample } from "../board/pickers";

const BEHAVIOR_INFO: Record<TextBehaviorName, string> = {
  wave: "Wave",
  bounce: "Bounce",
  jitter: "Jitter",
  wiggle: "Wiggle",
  swing: "Swing",
  dangle: "Dangle",
  float: "Float",
  pulse: "Pulse",
  grow: "Grow",
  rainbow: "Rainbow",
  glow: "Glow",
  glitch: "Glitch",
};
const ENTRANCES: { id: TextEntry; label: string }[] = [
  { id: "fly", label: "Fly in" },
  { id: "bounce", label: "Drop" },
  { id: "spin", label: "Spin" },
  { id: "stretch", label: "Stretch" },
  { id: "unfold", label: "Unfold" },
  { id: "pop", label: "Pop" },
  { id: "rise", label: "Rise" },
  { id: "blur", label: "Blur" },
  { id: "glitch", label: "Glitch" },
  { id: "scramble", label: "Decode" },
  { id: "quill", label: "Quill" },
];
const SIZES = [
  { value: "0.8", label: "Small" },
  { value: "1.4", label: "Big" },
  { value: "2", label: "Huge" },
];

/**
 * Text animation for the selected words, in the spirit of Febucci's Text Animator: looping
 * behaviours, one-off entrances and size. Every option is previewed live.
 */
export function FxMenu({ onWrap }: { onWrap: (open: string, close: string) => void }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<React.CSSProperties>({});
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    const outside = (event: PointerEvent) => {
      if (!panel.current?.parentElement?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);
  const wrap = (start: string, end: string) => {
    onWrap(start, end);
    setOpen(false);
  };
  return (
    <span className="fx-menu-anchor">
      <button
        type="button"
        className={open ? "is-active" : ""}
        aria-expanded={open}
        onClick={(event) => {
          // Fixed to the viewport so scrolling panels never clip it.
          const rect = event.currentTarget.getBoundingClientRect();
          const width = 400;
          const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
          const below = window.innerHeight - rect.bottom > 420;
          setPlace(
            below
              ? { left, top: rect.bottom + 6 }
              : { left, bottom: window.innerHeight - rect.top + 6 },
          );
          setOpen(!open);
        }}
        title="Animate the selected words"
      >
        <Sparkles size={13} /> Animate text
      </button>
      {open && (
        <div className="fx-menu" ref={panel} role="dialog" aria-label="Animate text" style={place}>
          <div className="fx-menu-head">
            <strong>Animate the selected words</strong>
            <button type="button" className="fx-close" aria-label="Close" onClick={() => setOpen(false)}>
              <X size={14} />
            </button>
          </div>
          <span className="fx-menu-label">Keeps moving while shown</span>
          <div className="fx-menu-grid">
            {TEXT_BEHAVIORS.map((name) => (
              <button
                type="button"
                key={name}
                onClick={() => wrap(`{${name}}`, `{/${name}}`)}
                aria-label={`${BEHAVIOR_INFO[name]} animation`}
              >
                <TextSample source={`{${name}}${BEHAVIOR_INFO[name]}{/${name}}`} effect="instant" cps={0} every={60000} />
              </button>
            ))}
          </div>
          <span className="fx-menu-label">How the words appear</span>
          <div className="fx-menu-grid">
            {ENTRANCES.map((entry) => (
              <button
                type="button"
                key={entry.id}
                onClick={() => wrap(`{in=${entry.id}}`, "{/in}")}
                aria-label={`${entry.label} entrance`}
              >
                <TextSample source={`{in=${entry.id}}${entry.label}{/in}`} cps={10} every={2200} />
              </button>
            ))}
          </div>
          <span className="fx-menu-label">Size</span>
          <div className="fx-menu-sizes">
            {SIZES.map((size) => (
              <button type="button" key={size.value} onClick={() => wrap(`{size=${size.value}}`, "{/size}")}>
                <span style={{ fontSize: `${Number(size.value)}em` }}>{size.label}</span>
              </button>
            ))}
          </div>
          <p className="fx-menu-hint">
            Tags never reach the voice. Combine them freely, add a strength like {"{wave=2}"}, or end
            everything with {"{/fx}"}.
          </p>
        </div>
      )}
    </span>
  );
}
