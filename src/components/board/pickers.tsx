import { useEffect, useRef } from "react";
import {
  TEXTBOX_LABELS,
  TEXTBOX_STYLES,
  TEXT_EFFECTS,
  TEXT_EFFECT_LABELS,
  TRANSITIONS,
  TRANSITION_LABELS,
  type TextEffect,
  type TextboxStyle,
  type Transition,
} from "../../engine";
import { revealText } from "../../player/text";
import { TEXT_FX_STYLE } from "../../player/text-fx";

/** Injects the player's glyph animation CSS once, so studio samples match the player. */
let fxStyleInjected = false;
export function useTextFxStyle() {
  useEffect(() => {
    if (fxStyleInjected || typeof document === "undefined") return;
    fxStyleInjected = true;
    const style = document.createElement("style");
    style.dataset.frame = "text-fx";
    style.textContent = TEXT_FX_STYLE;
    document.head.append(style);
  }, []);
}

/**
 * A few words performed with the real text renderer, replayed every few seconds. `source`
 * may contain any inline animation tags.
 */
export function TextSample({
  source,
  effect = "typewriter",
  cps = 16,
  every = 2600,
  className = "",
}: {
  source: string;
  effect?: TextEffect;
  cps?: number;
  every?: number;
  className?: string;
}) {
  useTextFxStyle();
  const element = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    let reveal = revealText(target, source, { effect, cps, onEvent() {}, onDone() {} });
    const timer = window.setInterval(() => {
      reveal.dispose();
      reveal = revealText(target, source, { effect, cps, onEvent() {}, onDone() {} });
    }, every);
    return () => {
      window.clearInterval(timer);
      reveal.dispose();
    };
  }, [source, effect, cps, every]);
  return <span ref={element} className={`vn-text text-sample ${className}`} aria-hidden="true" />;
}

/** Every scene transition as a small looping film: shot A becomes shot B. */
export function TransitionPicker({
  value,
  onChange,
}: {
  value: Transition;
  onChange: (transition: Transition) => void;
}) {
  return (
    <div className="transition-grid" role="radiogroup" aria-label="Transition into this shot">
      {TRANSITIONS.map((transition) => (
        <button
          key={transition}
          role="radio"
          aria-checked={value === transition}
          className={value === transition ? "is-active" : ""}
          onClick={() => onChange(transition)}
          title={TRANSITION_LABELS[transition]}
        >
          <span className={`tr-film tr-${transition}`} aria-hidden="true">
            <i className="tr-a" />
            <i className="tr-b">
              {transition === "blinds" && [0, 1, 2, 3, 4].map((index) => <b key={index} />)}
            </i>
            <i className="tr-cover" />
          </span>
          <span className="tr-label">{TRANSITION_LABELS[transition]}</span>
        </button>
      ))}
    </div>
  );
}

/** Entrance effects for the line's words, each one shown live. */
export function TextEffectPicker({
  value,
  inherited,
  onChange,
}: {
  value?: TextEffect;
  inherited: TextEffect;
  onChange: (effect: TextEffect | undefined) => void;
}) {
  return (
    <div className="effect-grid" role="radiogroup" aria-label="Text effect">
      {TEXT_EFFECTS.map((effect) => {
        const active = (value ?? inherited) === effect;
        return (
          <button
            key={effect}
            role="radio"
            aria-checked={active}
            className={`${active ? "is-active" : ""} ${!value && active ? "is-inherited" : ""}`}
            onClick={() => onChange(effect === inherited && !value ? undefined : effect)}
          >
            <TextSample source="Hello there" effect={effect} cps={effect === "word" ? 6 : 14} />
            <span>{TEXT_EFFECT_LABELS[effect]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Text box styles drawn as small schematics. */
export function TextboxPicker({
  value,
  inherited,
  onChange,
}: {
  value?: TextboxStyle;
  inherited: TextboxStyle;
  onChange: (style: TextboxStyle | undefined) => void;
}) {
  return (
    <div className="textbox-grid" role="radiogroup" aria-label="Text box">
      {TEXTBOX_STYLES.map((style) => {
        const active = (value ?? inherited) === style;
        return (
          <button
            key={style}
            role="radio"
            aria-checked={active}
            className={active ? "is-active" : ""}
            onClick={() => onChange(style === inherited && !value ? undefined : style)}
          >
            <span className={`tb-mock tb-${style}`} aria-hidden="true">
              <i />
              <b />
              <b />
            </span>
            <span>{TEXTBOX_LABELS[style]}</span>
          </button>
        );
      })}
    </div>
  );
}
