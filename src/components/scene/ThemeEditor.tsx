import { Palette } from "lucide-react";
import {
  DEFAULT_MUSIC_DUCK,
  DEFAULT_THEME,
  FONT_LABELS,
  TEXTBOX_LABELS,
  TEXTBOX_STYLES,
  TEXT_EFFECTS,
  TEXT_EFFECT_LABELS,
  projectTheme,
  type Project,
  type Theme,
} from "../../engine";

interface Props {
  project: Project;
  onChange: (project: Project, discrete?: boolean) => void;
}

/** Project-wide presentation: the text box, how words appear, type and color. */
export function ThemeEditor({ project, onChange }: Props) {
  const theme = projectTheme(project);
  const update = (patch: Partial<Theme>, discrete = false) =>
    onChange({ ...project, theme: { ...theme, ...patch } }, discrete);
  return (
    <section className="panel data-section" aria-labelledby="theme-title">
      <div className="data-heading">
        <div>
          <h2 id="theme-title">
            <Palette size={16} /> Look & feel
          </h2>
          <p>
            Defaults for every scene. Any scene can still choose its own text box
            and text effect in its Look tab.
          </p>
        </div>
        <button
          className="button small"
          disabled={!project.theme}
          onClick={() => onChange({ ...project, theme: undefined }, true)}
        >
          Reset to defaults
        </button>
      </div>
      <div className="textbox-gallery" role="radiogroup" aria-label="Default text box">
        {TEXTBOX_STYLES.map((style) => (
          <button
            key={style}
            role="radio"
            aria-checked={theme.textbox === style}
            className={`textbox-swatch ${theme.textbox === style ? "is-active" : ""}`}
            onClick={() => update({ textbox: style }, true)}
          >
            <span className={`tb-mock tb-${style}`}>
              <i />
              <b />
              <b />
            </span>
            <span>{TEXTBOX_LABELS[style]}</span>
          </button>
        ))}
      </div>
      <div className="field-grid three-columns">
        <label className="form-field">
          <span>Text effect</span>
          <select
            value={theme.textEffect}
            onChange={(event) =>
              update({ textEffect: event.target.value as Theme["textEffect"] })
            }
          >
            {TEXT_EFFECTS.map((effect) => (
              <option key={effect} value={effect}>
                {TEXT_EFFECT_LABELS[effect]}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Typeface</span>
          <select
            value={theme.font}
            onChange={(event) => update({ font: event.target.value as Theme["font"] })}
          >
            {(Object.keys(FONT_LABELS) as Theme["font"][]).map((font) => (
              <option key={font} value={font}>
                {FONT_LABELS[font]}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Accent color</span>
          <input
            type="color"
            value={theme.accent.length === 4 ? `#${[...theme.accent.slice(1)].map((c) => c + c).join("")}` : theme.accent}
            onChange={(event) => update({ accent: event.target.value })}
          />
        </label>
      </div>
      <div className="field-grid three-columns">
        <label className="form-field">
          <span>
            Reading speed{" "}
            <span className="field-caption">{theme.textSpeed} characters per second</span>
          </span>
          <input
            type="range"
            min="10"
            max="120"
            value={theme.textSpeed}
            onChange={(event) => update({ textSpeed: Number(event.target.value) })}
          />
        </label>
        <label className="form-field">
          <span>Listeners while someone speaks</span>
          <select
            value={theme.focus}
            onChange={(event) => update({ focus: event.target.value as Theme["focus"] })}
          >
            <option value="dim">Dim them</option>
            <option value="spotlight">Spotlight the speaker</option>
            <option value="none">Keep everyone lit</option>
          </select>
        </label>
        <label className="form-field">
          <span>Expression changes</span>
          <select
            value={theme.expressionChange}
            onChange={(event) =>
              update({ expressionChange: event.target.value as Theme["expressionChange"] })
            }
          >
            <option value="morph">Morph from one emotion to the next</option>
            <option value="cut">Switch instantly</option>
          </select>
        </label>
        <label className="form-field">
          <span>
            Music under voices{" "}
            <span className="field-caption">
              {Math.round((theme.musicDuck ?? DEFAULT_MUSIC_DUCK) * 100) >= 100
                ? "not lowered"
                : `${Math.round((theme.musicDuck ?? DEFAULT_MUSIC_DUCK) * 100)}% while a line is spoken`}
            </span>
          </span>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={Math.round((theme.musicDuck ?? DEFAULT_MUSIC_DUCK) * 100)}
            onChange={(event) => update({ musicDuck: Number(event.target.value) / 100 })}
          />
        </label>
      </div>
      {!project.theme && (
        <p className="field-hint">
          Using the studio defaults ({TEXTBOX_LABELS[DEFAULT_THEME.textbox]},{" "}
          {TEXT_EFFECT_LABELS[DEFAULT_THEME.textEffect].toLowerCase()}).
        </p>
      )}
    </section>
  );
}
