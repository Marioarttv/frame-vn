import type { Project } from "../engine/types";
import { PORTRAIT_RUNTIME_SOURCE } from "../animation/player-runtime.generated";
import { PLAYER_RUNTIME_SOURCE } from "./player-runtime.generated";
import type { PlayerConfig } from "./runtime";
import { PLAYER_STYLE } from "./style";
import { STORYBOOK_FONT_FACES } from "./fonts.generated";
import { RUNTIME_LICENSE, STORYBOOK_FONT_LICENSES } from "./licenses.generated";

const STORYBOOK_TEXTBOXES = new Set<string>(["grimoire", "title"]);
/**
 * Whether the story shows the storybook fonts (the "storybook" theme font or the grimoire and
 * title text boxes). Only then are they embedded, so other exports do not grow. The studio's live
 * stage always has them, because the look can change while it is open.
 */
export function usesStorybookFonts(project: Project): boolean {
  const theme = project.theme;
  return (
    theme?.font === "storybook" ||
    STORYBOOK_TEXTBOXES.has(theme?.textbox ?? "") ||
    project.nodes.some((node) => STORYBOOK_TEXTBOXES.has(node.textbox ?? ""))
  );
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}

/** Safe inside a script element even if dialogue contains closing tags or JS line separators. */
export function serializeForHtml(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (character) =>
      ({
        "<": "\\u003c",
        ">": "\\u003e",
        "&": "\\u0026",
        "\u2028": "\\u2028",
        "\u2029": "\\u2029",
      })[character]!,
  );
}

const inlineScript = (source: string) =>
  `<script>${source.replace(/<\/script/gi, "<\\/script")}</script>`;


/**
 * One document for exported games and the studio preview. `assets` maps project URLs to
 * embedded data URLs (export) or to loadable studio URLs (preview).
 */
export function createPlayerDocument(
  project: Project,
  assets: Record<string, string>,
  config: PlayerConfig,
  /** A host's own style rules, appended after the player's (an export's look, say). */
  styles = "",
): string {
  const preview = config.mode === "preview";
  const extra = styles.replace(/<\/style/gi, "<\\/style");
  const includeFonts = usesStorybookFonts(project) || config.mode === "stage";
  // Exported players carry the runtime's terms and the terms of any embedded fonts.
  // Character and story permissions remain the exporter's responsibility.
  const licenses = (RUNTIME_LICENSE + (includeFonts ? `\n\n${STORYBOOK_FONT_LICENSES}` : ""))
    .replace(/--/g, "&#45;&#45;");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${escapeHtml(project.title)}</title>
<!-- Frame runtime and embedded font notices. These do not license the story or imported media.
${licenses}
-->
<style>${includeFonts ? STORYBOOK_FONT_FACES : ""}${PLAYER_STYLE}${extra}</style></head><body>
<main class="player" id="player" aria-label="Visual novel player">
<div class="viewport" id="viewport"><div class="camera" id="camera"><div class="bg-layer is-empty is-top" id="bg-a"></div><div class="bg-layer" id="bg-b" hidden></div><div class="actors" id="actors"></div></div>
<canvas class="weather" id="weather" aria-hidden="true"></canvas><div class="grade" id="grade"></div><div class="vignette"></div><div class="shade"></div><div class="screen-fx" id="screen-fx" aria-hidden="true"></div></div>
<div class="letterbox top"></div><div class="letterbox bottom"></div>
<header><span class="brand" id="project-title"></span><div class="tools"><button id="auto" aria-pressed="false" title="Advance automatically (A)">Auto</button><button id="history-open" title="History (H)">History</button><button id="saves-open" hidden>Save / Load</button><button id="settings-open">Settings</button><button id="sound" aria-pressed="true">Sound on</button><button id="restart">Restart</button><button id="close-preview" aria-label="Close story preview" hidden>Close ✕</button></div></header>
<span class="scene-label" id="scene-label"${preview ? "" : " hidden"}></span>
<section class="conversation" id="conversation" aria-label="Story"><div class="dialogue" id="dialogue-box"><div class="novel-log" id="novel-log"></div><div class="nameplate" id="speaker"></div><p class="text vn-text" id="dialogue" aria-hidden="true"></p><span class="advance" aria-hidden="true"></span><p id="accessible-dialogue" class="sr-only" aria-live="polite"></p></div></section>
<div class="choices" id="choices" aria-label="Choose your path"></div>
<nav class="quick" aria-label="Reading controls"><span id="notice" role="status" hidden></span><button id="back">← Back</button><span class="hint" id="hint">Click or press Space to continue</span><button class="primary" id="continue">Continue →</button></nav>
<div class="curtain" id="curtain"></div>
<section class="title-card" id="title-card" hidden><div><h1 id="title-card-title"></h1><p id="title-card-subtitle"></p></div></section>
<section class="intro" id="intro"${config.mode === "export" ? "" : " hidden"}><div class="intro-content"><div class="eyebrow">An interactive story</div><h1 id="intro-title"></h1><p id="intro-description"></p><div class="intro-actions"><button class="primary" id="begin">Begin story →</button><button id="resume" hidden>Continue where you left off</button></div><small>Click or Space continues · ← goes back · H opens history · A toggles auto</small></div></section>
<div id="fatal" role="alert" hidden></div>
</main>
<dialog id="history-dialog" aria-labelledby="history-title"><h2 id="history-title">Your story so far</h2><div id="history-content"></div><button id="history-close">Close</button></dialog>
<dialog id="saves-dialog" aria-labelledby="saves-title"><h2 id="saves-title">Save or load</h2><ul class="slots" id="save-slots"></ul><button id="saves-close">Close</button></dialog>
<dialog id="settings-dialog" aria-labelledby="settings-title"><h2 id="settings-title">Settings</h2>
<label class="setting"><span>Text speed</span><select id="setting-speed"><option value="slow">Slow</option><option value="normal">Normal</option><option value="fast">Fast</option><option value="instant">Instant</option></select></label>
<label class="setting"><span>Music volume</span><input id="setting-music" type="range" min="0" max="1" step="0.05"></label>
<label class="setting"><span>Voice volume</span><input id="setting-voice" type="range" min="0" max="1" step="0.05"></label>
<label class="setting"><span>Sound effects</span><input id="setting-effects" type="range" min="0" max="1" step="0.05"></label>
<button id="settings-close">Close</button></dialog>
<script id="project-data" type="application/json">${serializeForHtml(project)}</script>
<script id="asset-data" type="application/json">${serializeForHtml(assets)}</script>
<script id="player-config" type="application/json">${serializeForHtml(config)}</script>
${inlineScript(PORTRAIT_RUNTIME_SOURCE)}
${inlineScript(PLAYER_RUNTIME_SOURCE)}</body></html>`;
}
