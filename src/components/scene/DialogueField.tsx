import { useRef } from "react";
import { Hourglass, Italic, Palette, Snail, Sparkles, Zap } from "lucide-react";
import { plainText, SCREEN_FX, SCREEN_FX_LABELS, type Character, type Sound } from "../../engine";
import { FxMenu } from "./FxMenu";

interface Props {
  value: string;
  rows?: number;
  placeholder?: string;
  speaker?: Character;
  effects: Sound[];
  onChange: (value: string) => void;
}

/**
 * Dialogue with inline direction. Tags never reach players or voice generation; they time
 * pauses, expression changes, shakes, flashes and sounds to the exact word.
 */
export function DialogueField({ value, rows = 4, placeholder, speaker, effects, onChange }: Props) {
  const area = useRef<HTMLTextAreaElement>(null);
  const insert = (before: string, after = "") => {
    const element = area.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + before + value.slice(start, end) + after + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      if (!element) return;
      element.focus();
      const cursor = start + before.length + (end - start) + after.length;
      element.setSelectionRange(cursor, cursor);
    });
  };
  const words = plainText(value);
  const tagged = words !== value;
  return (
    <div className="form-field dialogue-field">
      <span className="field-label-row">
        <label htmlFor="scene-dialogue">
          Dialogue{" "}
          <span className="field-caption">
            {words.length.toLocaleString()} characters
            {tagged ? " spoken · direction tags hidden from players" : ""}
          </span>
        </label>
      </span>
      <div className="direction-bar" role="toolbar" aria-label="Insert direction">
        <button type="button" onClick={() => insert("{wait=0.5}")} title="Pause the text (and the beat) here">
          <Hourglass size={13} /> Pause
        </button>
        <button type="button" onClick={() => insert("*", "*")} title="Emphasise the selected words">
          <Italic size={13} /> Emphasis
        </button>
        <select
          aria-label="Change expression at the cursor"
          title="In a voiced line the face changes once the line has been spoken; in a silent line, at this word"
          value=""
          disabled={!speaker || speaker.poses.length < 2}
          onChange={(event) => {
            if (event.target.value) insert(`{expression=${event.target.value}}`);
          }}
        >
          <option value="">Change expression…</option>
          {speaker?.poses.map((pose) => (
            <option key={pose.id} value={pose.name}>
              {pose.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => insert("{shake}")} title="Shake the stage at this word">
          <Zap size={13} /> Shake
        </button>
        <button type="button" onClick={() => insert("{flash}")} title="Flash white at this word">
          <Sparkles size={13} /> Flash
        </button>
        <select
          aria-label="Play a sound effect at the cursor"
          value=""
          disabled={!effects.length}
          onChange={(event) => {
            if (event.target.value) insert(`{sfx=${event.target.value}}`);
          }}
        >
          <option value="">{effects.length ? "Sound at cursor…" : "No sound effects"}</option>
          {effects.map((sound) => (
            <option key={sound.id} value={sound.name}>
              {sound.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Play a screen effect at the cursor"
          title="Full-screen effects; add ,x,y (stage percent) to place a glint or sparkles, e.g. {fx=glint,48,30}, two points for a thread, e.g. {fx=thread,34,30,66,30}, or a radius for a dome, e.g. {fx=dome,40,55,25}"
          value=""
          onChange={(event) => {
            if (event.target.value) insert(`{fx=${event.target.value}}`);
          }}
        >
          <option value="">Screen effect…</option>
          {SCREEN_FX.map((name) => (
            <option key={name} value={name}>
              {SCREEN_FX_LABELS[name]}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => insert("{speed=0.5}", "{speed=1}")} title="Slow the selected words down">
          <Snail size={13} /> Slow
        </button>
        <button type="button" onClick={() => insert("{color=#7fe3ff}", "{/color}")} title="Colour the selected words">
          <Palette size={13} /> Color
        </button>
        <FxMenu onWrap={insert} />
      </div>
      <textarea
        id="scene-dialogue"
        ref={area}
        value={value}
        rows={rows}
        maxLength={10000}
        onChange={(event) => onChange(event.target.value)}
        placeholder={
          placeholder ??
          "What happens next? Write dialogue, narration, or a question for your player…"
        }
      />
    </div>
  );
}
