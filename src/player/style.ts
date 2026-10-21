/**
 * The player's stylesheet. Sizes use container units of the stage, so a 720p video render, a
 * 1080p render and a browser window all show the same composition.
 */
import { QUILL_URI, TEXT_FX_STYLE } from "./text-fx";
import { SCREEN_FX_STYLE } from "./screen-fx";

const svgUri = (svg: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(svg.replace(/\s*\n\s*/g, " "))}")`;

/** Aged paper: fine grain plus long fibres, tinted brown, mostly transparent. */
const PAPER = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320">
<filter id="g"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" seed="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .36 0 0 0 0 .25 0 0 0 0 .12 0 0 0 .3 -.06"/></filter>
<filter id="f"><feTurbulence type="fractalNoise" baseFrequency=".012 .28" numOctaves="2" seed="11" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .45 0 0 0 0 .31 0 0 0 0 .15 0 0 0 .38 -.16"/></filter>
<rect width="100%" height="100%" filter="url(#f)"/><rect width="100%" height="100%" filter="url(#g)"/></svg>`);

/** One gilded filigree corner (top left); the others are mirrored copies. */
const CORNER_PATHS = `<defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f1d58e"/><stop offset=".55" stop-color="#b8892f"/><stop offset="1" stop-color="#8a6420"/></linearGradient></defs>
<g fill="none" stroke="url(#a)" stroke-width="1.7" stroke-linecap="round">
<path d="M16 9C24 9 27 4 34 5C41 6 40 15 34 14C30 13.5 30 9.5 33.5 9.5"/><path d="M35 5.5C43 3 50 6 58 7.5"/>
<path d="M9 16C9 24 4 27 5 34C6 41 15 40 14 34C13.5 30 9.5 30 9.5 33.5"/><path d="M5.5 35C3 43 6 50 7.5 58"/>
<path d="M14 14C18 22 26 26 30 22C33 19 29 15 26.5 18"/><path d="M14 14C22 18 26 26 22 30C19 33 15 29 18 26.5"/></g>
<g fill="url(#a)"><path d="M9 2.5L15.5 9L9 15.5L2.5 9Z"/><circle cx="42" cy="12.5" r="1.4"/><circle cx="12.5" cy="42" r="1.4"/><circle cx="31" cy="31" r="1.6"/></g>`;
const corner = (transform: string) =>
  svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60"><g transform="${transform}">${CORNER_PATHS}</g></svg>`);
const CORNERS = [
  `${corner("")} 0 0/6.6cqh 6.6cqh no-repeat`,
  `${corner("translate(60 0) scale(-1 1)")} 100% 0/6.6cqh 6.6cqh no-repeat`,
  `${corner("translate(0 60) scale(1 -1)")} 0 100%/6.6cqh 6.6cqh no-repeat`,
  `${corner("translate(60 60) scale(-1 -1)")} 100% 100%/6.6cqh 6.6cqh no-repeat`,
].join(",");

/** A short gold divider with a centred diamond, for narration and title cards. */
const DIVIDER = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 24"><defs><linearGradient id="d" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="240" y2="0"><stop offset="0" stop-color="#b8892f" stop-opacity="0"/><stop offset=".3" stop-color="#c99a45"/><stop offset=".5" stop-color="#f1d58e"/><stop offset=".7" stop-color="#c99a45"/><stop offset="1" stop-color="#b8892f" stop-opacity="0"/></linearGradient></defs>
<g fill="none" stroke="url(#d)" stroke-width="1.4" stroke-linecap="round"><path d="M8 12H98M142 12H232"/><path d="M98 12C104 12 106 6 112 7C116 8 114 13 111 12"/><path d="M142 12C136 12 134 18 128 17C124 16 126 11 129 12"/><path d="M98 12C104 12 106 18 112 17C116 16 114 11 111 12" opacity=".6"/><path d="M142 12C136 12 134 6 128 7C124 8 126 13 129 12" opacity=".6"/></g>
<path d="M120 4L128 12L120 20L112 12Z" fill="#e2bc68" stroke="#8a6420" stroke-width=".8"/><circle cx="120" cy="12" r="2.2" fill="#fff3cf"/></svg>`);

/** A wider flourish above and below title cards. */
const TITLE_RULE = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 40"><defs><linearGradient id="t" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="600" y2="0"><stop offset="0" stop-color="#c99a45" stop-opacity="0"/><stop offset=".25" stop-color="#d6ac58"/><stop offset=".5" stop-color="#fff0c4"/><stop offset=".75" stop-color="#d6ac58"/><stop offset="1" stop-color="#c99a45" stop-opacity="0"/></linearGradient></defs>
<g fill="none" stroke="url(#t)" stroke-linecap="round"><path d="M20 20H250M350 20H580" stroke-width="1.6"/><path d="M60 26H240M360 26H540" stroke-width=".8" opacity=".7"/>
<path d="M250 20C262 20 266 9 278 11C287 13 284 23 277 21C272 19.5 274 14 279 15" stroke-width="1.6"/><path d="M350 20C338 20 334 9 322 11C313 13 316 23 323 21C328 19.5 326 14 321 15" stroke-width="1.6"/>
<path d="M250 20C262 20 266 31 278 29" stroke-width="1.2" opacity=".7"/><path d="M350 20C338 20 334 31 322 29" stroke-width="1.2" opacity=".7"/></g>
<path d="M300 6L314 20L300 34L286 20Z" fill="#e8c474" stroke="#8a6420" stroke-width="1"/><path d="M300 12L308 20L300 28L292 20Z" fill="#fff3cf" opacity=".85"/><circle cx="270" cy="20" r="2" fill="#e8c474"/><circle cx="330" cy="20" r="2" fill="#e8c474"/></svg>`);

export const PLAYER_STYLE = String.raw`
*{box-sizing:border-box}html,body{height:100%}body{margin:0;background:#000;color:#f4f3e9;overflow:hidden;font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
button,select,input{font:inherit;color:inherit}button{cursor:pointer;border:1px solid #ffffff30;border-radius:8px;background:#ffffff0d;padding:10px 17px}button:hover{background:#ffffff20}
button:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid var(--accent);outline-offset:3px}button:disabled{opacity:.4;cursor:default}[hidden]{display:none!important}
.player{--accent:#dbe7b1;--name:var(--accent);--font-book:"Cormorant Garamond","Cormorant","EB Garamond",Garamond,"Iowan Old Style","Palatino Linotype",Georgia,serif;--font-display:"Cinzel","Trajan Pro","Iowan Old Style","Palatino Linotype",Georgia,serif;--fs:calc(clamp(15px,calc(1cqw + .55cqh),34px) * var(--text-scale,1));--font-story:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;position:relative;width:100vw;height:100svh;min-height:320px;overflow:hidden;container-type:size;background:#05070a;user-select:none;-webkit-user-select:none}
.player[data-font=serif]{--font-story:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif}
.player[data-font=mono]{--font-story:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
.player[data-font=rounded]{--font-story:ui-rounded,"SF Pro Rounded","Nunito","Varela Round",system-ui,sans-serif}
.player[data-font=condensed]{--font-story:"Avenir Next Condensed","Roboto Condensed","Arial Narrow",system-ui,sans-serif}
.player[data-font=storybook]{--font-story:var(--font-book)}.player[data-font=storybook] .text{font-size:calc(var(--fs)*1.1);font-weight:500}.player[data-font=storybook] .nameplate{font-family:var(--font-display);font-weight:600}
.viewport{position:absolute;inset:0;overflow:hidden;cursor:pointer}
.camera{position:absolute;inset:0;transform-origin:0 0;transition:transform 1.6s cubic-bezier(.45,0,.2,1),filter 1.2s ease;will-change:transform}
.bg-layer{position:absolute;inset:-3%;overflow:hidden;background:radial-gradient(ellipse at 40% 25%,#34443e,#141b19)}
.bg-layer.is-empty{background:radial-gradient(ellipse at 40% 25%,#2c3a36,#101513)}
.bg-layer>img,.bg-layer>video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.bg-layer.is-top{z-index:1}
.bg-layer>.tx-burn,.bg-layer>.tx-seam{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;overflow:hidden}
.tx-seam .half{position:absolute;inset:0;background-size:cover;background-position:center;will-change:transform}
.tx-seam .top{clip-path:inset(0 0 50% 0)}.tx-seam .bottom{clip-path:inset(50% 0 0 0)}
.tx-seam b{position:absolute;left:0;right:0;top:calc(50% - 1px);height:2px;background:linear-gradient(90deg,transparent,#eef7ff 10%,#fff 50%,#eef7ff 90%,transparent);box-shadow:0 0 10px 3px rgba(210,235,255,.9),0 0 46px 12px rgba(150,205,255,.42);transform-origin:50% 50%;opacity:0}
.m-zoom-in{animation:m-zoom-in 30s ease-in-out infinite alternate}.m-zoom-out{animation:m-zoom-out 30s ease-in-out infinite alternate}
.m-pan-left{animation:m-pan-left 34s ease-in-out infinite alternate}.m-pan-right{animation:m-pan-right 34s ease-in-out infinite alternate}
.m-drift{animation:m-drift 26s ease-in-out infinite alternate}.m-sway{animation:m-sway 9s ease-in-out infinite alternate}
@keyframes m-zoom-in{from{transform:scale(1)}to{transform:scale(1.14)}}@keyframes m-zoom-out{from{transform:scale(1.14)}to{transform:scale(1)}}
@keyframes m-pan-left{from{transform:scale(1.1) translateX(3.5%)}to{transform:scale(1.1) translateX(-3.5%)}}@keyframes m-pan-right{from{transform:scale(1.1) translateX(-3.5%)}to{transform:scale(1.1) translateX(3.5%)}}
@keyframes m-drift{0%{transform:scale(1.08) translate(-1.5%,-1%)}50%{transform:scale(1.11) translate(1%,.5%)}100%{transform:scale(1.08) translate(1.5%,-.5%)}}
@keyframes m-sway{from{transform:scale(1.05) rotate(-.6deg)}to{transform:scale(1.05) rotate(.6deg)}}
.actors{position:absolute;inset:0;z-index:2;pointer-events:none}
.actor{--x:50%;--y:0%;--s:1;--z:100;position:absolute;left:var(--x);bottom:0;height:90%;width:min(72cqw,128cqh);transform:translate(-50%,calc(var(--y) + var(--lift,0%))) scale(calc(var(--s)*var(--k,1)));transform-origin:50% 100%;transition:left .75s cubic-bezier(.3,.7,.2,1),transform .75s cubic-bezier(.3,.7,.2,1),filter .5s ease;z-index:var(--z);filter:drop-shadow(0 2cqh 2.4cqh #0004)}
.actor-motion,.actor-body,.actor-face{position:absolute;inset:0}.actor-body{filter:var(--actor-light,none)}.actor-morph{display:block;width:100%;height:100%;pointer-events:none}.actor-face{transition:none}.actor.flipped .actor-face{transform:scaleX(-1)}
.actor.is-instant{transition:none}
.player[data-focus=dim] .actor.listening{--k:.985;filter:drop-shadow(0 2cqh 2.4cqh #0004) brightness(.64) saturate(.82)}
.player[data-focus=dim] .actor.speaking{--lift:-.45%}
.player[data-focus=spotlight] .actor.listening{filter:drop-shadow(0 2cqh 2.4cqh #0004) brightness(.52) saturate(.7) blur(.18cqw)}
.player[data-mode=stage] .actor{pointer-events:auto;cursor:grab}.player[data-mode=stage] .actor.dragging{cursor:grabbing;transition:none}
.player[data-mode=stage] .actor.is-selected .actor-body{outline:2px dashed #ffffff70;outline-offset:-2px;border-radius:12px}
.stage-guides{position:absolute;inset:0;z-index:6;pointer-events:none;opacity:0;transition:opacity .2s}.player.is-dragging .stage-guides,.player.is-dropping .stage-guides{opacity:1}
.stage-guides i{position:absolute;top:8%;bottom:0;width:0;border-left:1px dashed #ffffff40;transition:border-color .15s}.stage-guides i.is-hit{border-left:2px solid var(--accent);box-shadow:0 0 1.2cqw var(--accent)}
.stage-guides b{position:absolute;top:0;bottom:0;width:.35cqw;margin-left:-.175cqw;background:linear-gradient(180deg,transparent,var(--accent));opacity:0}.player.is-dropping .stage-guides b{opacity:.85}
.weather{position:absolute;inset:0;z-index:3;width:100%;height:100%;pointer-events:none;opacity:0;transition:opacity 1.4s ease}
.weather.on{opacity:1}
.grade{position:absolute;inset:0;z-index:4;pointer-events:none;opacity:0;transition:opacity 1.2s ease,background 1.2s ease}
.vignette{position:absolute;inset:0;z-index:4;pointer-events:none;background:radial-gradient(ellipse at 50% 42%,transparent 58%,#0007 100%)}
.shade{position:absolute;inset:0;z-index:4;pointer-events:none;background:linear-gradient(180deg,#05080a70,transparent 22%,transparent 55%,#05080acc);transition:opacity .8s}
.player[data-grade=warm] .camera{filter:saturate(1.08) sepia(.14) brightness(1.03)}.player[data-grade=warm] .grade{opacity:.22;background:#ff9a3c;mix-blend-mode:soft-light}
.player[data-grade=cold] .camera{filter:saturate(.88) hue-rotate(-8deg) brightness(.97)}.player[data-grade=cold] .grade{opacity:.3;background:#3c7dff;mix-blend-mode:soft-light}
.player[data-grade=night] .camera{filter:brightness(.74) saturate(.75) contrast(1.05)}.player[data-grade=night] .grade{opacity:.36;background:#22336e;mix-blend-mode:multiply}
.player[data-grade=dusk] .camera{filter:saturate(1.12) brightness(.9)}.player[data-grade=dusk] .grade{opacity:.6;background:linear-gradient(180deg,#ff7b54,#6a3d9a);mix-blend-mode:soft-light}
.player[data-grade=noir] .camera{filter:grayscale(1) contrast(1.28) brightness(.9)}.player[data-grade=noir] .grade{opacity:.35;background:radial-gradient(ellipse at 50% 40%,transparent 40%,#000 100%)}
.player[data-grade=sepia] .camera{filter:sepia(.78) contrast(.95) brightness(1.03)}.player[data-grade=sepia] .grade{opacity:.25;background:#3b2410;mix-blend-mode:multiply}
.player[data-grade=toxic] .camera{filter:saturate(1.25) hue-rotate(16deg) brightness(.92)}.player[data-grade=toxic] .grade{opacity:.3;background:radial-gradient(ellipse at 50% 100%,#39ff8a,#0b3d22);mix-blend-mode:soft-light}
.player[data-grade=dream] .camera{filter:saturate(1.12) brightness(1.08) contrast(.94)}.player[data-grade=dream] .grade{opacity:.35;background:radial-gradient(ellipse at 50% 35%,#fff,#ffd6f5 60%,#b8a6ff);mix-blend-mode:soft-light}
.player[data-grade=vivid] .camera{filter:saturate(1.35) contrast(1.08)}
.player[data-grade=drained] .camera{filter:saturate(.16) brightness(.74) contrast(.84)}.player[data-grade=drained] .grade{opacity:.5;background:radial-gradient(ellipse at 50% 45%,#2a3a52 0,#0b1220 100%);mix-blend-mode:multiply}
${SCREEN_FX_STYLE}
.curtain{position:absolute;inset:0;z-index:40;background:#000;opacity:0;pointer-events:none}.curtain.white{background:#fff}
.letterbox{position:absolute;left:0;right:0;z-index:5;height:0;background:#000;pointer-events:none;transition:height .9s cubic-bezier(.6,0,.2,1)}.letterbox.top{top:0}.letterbox.bottom{bottom:0}
.player[data-textbox=cinematic] .letterbox{height:11.5cqh}
header{position:absolute;inset:0 0 auto;display:flex;justify-content:space-between;align-items:center;padding:16px 22px;gap:16px;z-index:20;pointer-events:none}
header>*{pointer-events:auto}.brand{font-size:12px;letter-spacing:.14em;text-transform:uppercase;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.8;text-shadow:0 1px 6px #000}
.tools{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.tools button{font-size:12px;padding:6px 11px;background:#0b0f0ca6;backdrop-filter:blur(8px)}
.tools button[aria-pressed=true]{background:var(--accent);color:#141a14}
.scene-label{position:absolute;left:22px;top:58px;z-index:20;font-size:11px;letter-spacing:.08em;color:#d5e3c0;background:#0b0f0c99;border-radius:6px;padding:3px 9px}
.quick{position:absolute;right:1.4cqw;bottom:1.2cqh;z-index:21;display:flex;align-items:center;gap:8px}
.quick button{font-size:12px;padding:5px 12px;background:#0b0f0cb3;backdrop-filter:blur(8px)}.quick .primary{background:var(--accent);color:#141a14;border-color:transparent}
.hint{font-size:11px;color:#c8d2c8;text-shadow:0 1px 4px #000}#notice{position:absolute;right:0;bottom:calc(100% + 8px);width:max-content;max-width:60cqw;color:#f1dfa8;background:#1d1a10e6;border-radius:8px;padding:6px 10px;font-size:12px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.conversation{position:absolute;z-index:10;left:50%;bottom:7cqh;transform:translateX(-50%);width:min(1180px,84cqw);font-family:var(--font-story);transition:opacity .35s ease}
.conversation.is-hidden{opacity:0;pointer-events:none}
.dialogue{position:relative;--panel:#0d1512e6;--ink:#f4f3e9;--line:#d5e0cf38;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:1.2cqw;padding:2.2cqh 2.4cqw 2.6cqh;box-shadow:0 1.5cqh 6cqh #0005;backdrop-filter:blur(16px);min-height:17cqh}
.nameplate{font-size:calc(var(--fs)*.78);letter-spacing:.07em;font-weight:700;margin-bottom:.7cqh;color:var(--name);text-transform:uppercase}
.text{margin:0;white-space:pre-wrap;font-size:var(--fs);line-height:1.62;min-height:3.2em;text-wrap:pretty}
.text em{font-style:italic;color:var(--accent)}.text strong{font-weight:800}
.advance{position:absolute;right:1.6cqw;bottom:1.2cqh;width:.9cqw;height:.9cqw;min-width:8px;min-height:8px;border-right:2px solid var(--accent);border-bottom:2px solid var(--accent);transform:rotate(45deg);opacity:0;pointer-events:none}
.dialogue.is-waiting .advance{opacity:.85;animation:advance 1.1s ease-in-out infinite}@keyframes advance{0%,100%{translate:0 0}50%{translate:0 .5cqh}}
${TEXT_FX_STYLE}
.novel-log{display:none}
.choices{position:absolute;z-index:12;left:50%;top:42%;transform:translate(-50%,-50%);width:min(780px,54cqw);display:grid;gap:1.2cqh;justify-items:stretch;font-family:var(--font-story)}.choices:empty{display:none}
.choice{--cb:#13201ce6;display:flex;gap:1cqw;align-items:center;text-align:left;background:var(--cb);border:1px solid #b2c7a750;color:#f4f3e9;padding:1.3cqh 1.6cqw;border-radius:.8cqw;backdrop-filter:blur(14px);font-size:calc(var(--fs)*.92);font-family:var(--font-story);transition:transform .2s ease,background .2s ease,border-color .2s ease;animation:choice-in .45s calc(var(--i)*70ms) both cubic-bezier(.2,.8,.2,1)}
.choice:hover,.choice.picked{background:#2d4232;border-color:var(--accent);transform:translateX(.5cqw)}.choice.picked{box-shadow:0 0 0 2px var(--accent),0 0 3cqh color-mix(in srgb,var(--accent) 45%,transparent)}
@keyframes choice-in{from{opacity:0;transform:translateY(1.5cqh)}to{opacity:1;transform:none}}
.choice-key{display:inline-grid;place-items:center;width:1.9em;height:1.9em;border-radius:6px;background:#ffffff18;font-size:.7em;flex:none}
.no-choices{margin:0;padding:12px 16px;border-radius:10px;background:#3b2a20cc;color:#f0d9c0;font-size:14px}
/* Cinematic subtitles */
.player[data-textbox=cinematic] .conversation{bottom:1.6cqh;width:min(1300px,76cqw);text-align:center}
.player[data-textbox=cinematic] .dialogue{background:none;border:0;box-shadow:none;backdrop-filter:none;padding:0;min-height:0}
.player[data-textbox=cinematic] .nameplate{font-size:calc(var(--fs)*.62);letter-spacing:.32em;margin-bottom:.4cqh;font-weight:600}
.player[data-textbox=cinematic] .text{font-size:calc(var(--fs)*.98);min-height:0;text-shadow:0 .2cqh .8cqh #000,0 0 .2cqh #000}
.player[data-textbox=cinematic] .advance{display:none}.player[data-textbox=cinematic] .quick{bottom:calc(11.5cqh + 1cqh)}.player[data-textbox=cinematic] .shade{opacity:.4}
/* Speech bubble */
.player[data-textbox=bubble] .conversation{left:var(--bubble-x,50%);bottom:auto;top:6cqh;width:min(640px,40cqw);transition:left .6s cubic-bezier(.3,.7,.2,1),opacity .35s}
.player[data-textbox=bubble] .dialogue{--panel:#fbfaf3;--ink:#17140f;background:var(--panel);border:.25cqw solid #17140f;border-radius:2.6cqw;padding:2.2cqh 2.2cqw 2.4cqh;box-shadow:.5cqw .7cqh 0 #000a;backdrop-filter:none;min-height:0}
.player[data-textbox=bubble] .dialogue::after{content:"";position:absolute;left:var(--tail-x,50%);bottom:-2.6cqh;width:2.6cqw;height:3cqh;background:#fbfaf3;border-right:.25cqw solid #17140f;border-bottom:.25cqw solid #17140f;transform:translateX(-50%) skewX(var(--tail-skew,-18deg)) rotate(45deg) scale(.8)}
.player[data-textbox=bubble] .nameplate{position:absolute;top:-2.4cqh;left:1.6cqw;background:var(--name);color:#111;border:.2cqw solid #17140f;border-radius:1cqw;padding:.2cqh .9cqw;margin:0;font-size:calc(var(--fs)*.66)}
.player[data-textbox=bubble] .text{font-size:calc(var(--fs)*.95);min-height:0;font-weight:500}.player[data-textbox=bubble] .text em{color:#b03a20}
.player[data-textbox=bubble] .advance{border-color:#17140f}
.player[data-textbox=bubble] .conversation.is-narration{left:4cqw!important;transform:none;top:5cqh}
.player[data-textbox=bubble] .is-narration .dialogue{--panel:#f6e7b0;border-radius:.3cqw;box-shadow:.4cqw .5cqh 0 #000a}.player[data-textbox=bubble] .is-narration .dialogue::after{display:none}
.player[data-textbox=bubble] .choice{background:#fbfaf3;color:#17140f;border:.2cqw solid #17140f;box-shadow:.3cqw .4cqh 0 #000a}.player[data-textbox=bubble] .choice:hover,.player[data-textbox=bubble] .choice.picked{background:#ffe27a}
/* Full-screen novel page */
.player[data-textbox=novel] .conversation{inset:7cqh 11cqw 9cqh;width:auto;transform:none;left:11cqw}
.player[data-textbox=novel] .dialogue{height:100%;overflow:hidden;background:#05080cc4;border-color:#ffffff1c;border-radius:1cqw;padding:5cqh 4cqw;display:flex;flex-direction:column;justify-content:flex-start}
.player[data-textbox=novel] .novel-log{display:block}.novel-entry{margin:0 0 2.2cqh;opacity:.55;font-size:var(--fs);line-height:1.62;white-space:pre-wrap}
.novel-entry b{color:var(--entry-color,var(--accent));font-weight:700;margin-right:.6em;font-size:.8em;letter-spacing:.06em;text-transform:uppercase}
.player[data-textbox=novel] .nameplate{margin-bottom:.4cqh}.player[data-textbox=novel] .shade{opacity:.2}
/* Minimal */
.player[data-textbox=minimal] .conversation{left:8cqw;transform:none;width:min(1100px,70cqw);bottom:6cqh}
.player[data-textbox=minimal] .dialogue{background:none;border:0;box-shadow:none;backdrop-filter:none;padding:0;min-height:0}
.player[data-textbox=minimal] .nameplate{display:inline-block;border-bottom:2px solid var(--name);padding-bottom:.3cqh;margin-bottom:1cqh}
.player[data-textbox=minimal] .text{text-shadow:0 .2cqh 1cqh #000d,0 0 .3cqh #000}
/* Gilded art deco */
.player[data-textbox=gilded] .dialogue{--panel:linear-gradient(180deg,#13233aee,#0b1626f2);--gold:#d6b46a;background:var(--panel);border:2px solid var(--gold);border-radius:.3cqw;box-shadow:inset 0 0 0 .5cqw #0b1626,inset 0 0 0 calc(.5cqw + 1px) #d6b46a66,0 2cqh 6cqh #000a;padding:3.6cqh 3.4cqw 3cqh;backdrop-filter:blur(10px)}
.player[data-textbox=gilded] .dialogue::before,.player[data-textbox=gilded] .dialogue::after{content:"";position:absolute;width:2.4cqw;height:2.4cqw;border:2px solid #d6b46a;transform:rotate(45deg);background:#0b1626;top:calc(50% - 1.2cqw)}
.player[data-textbox=gilded] .dialogue::before{left:-1.3cqw}.player[data-textbox=gilded] .dialogue::after{right:-1.3cqw}
.player[data-textbox=gilded] .nameplate{position:absolute;top:-1.9cqh;left:50%;transform:translateX(-50%);background:linear-gradient(180deg,#e9cf8b,#b38a3e);color:#1a1408;padding:.4cqh 2.4cqw;font-family:"Iowan Old Style",Georgia,serif;letter-spacing:.28em;font-size:calc(var(--fs)*.62);clip-path:polygon(6% 0,94% 0,100% 50%,94% 100%,6% 100%,0 50%);margin:0;white-space:nowrap}
.player[data-textbox=gilded] .text{font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;color:#f3ead2}.player[data-textbox=gilded] .text em{color:#e9cf8b}
.player[data-textbox=gilded] .choice{background:#0e1b2ef0;border:1px solid #d6b46a88;border-radius:.2cqw;font-family:"Iowan Old Style",Georgia,serif}.player[data-textbox=gilded] .choice:hover,.player[data-textbox=gilded] .choice.picked{background:#1d3150;border-color:#e9cf8b}
.player[data-textbox=gilded] .advance{border-color:#d6b46a}
/* Neon chem-punk */
.player[data-textbox=chem] .dialogue{--neon:#7dff6b;background:linear-gradient(180deg,#0a120bf0,#050806f5);border:0;border-radius:0;clip-path:polygon(0 0,calc(100% - 2.4cqw) 0,100% 2.4cqw,100% 100%,2.4cqw 100%,0 calc(100% - 2.4cqw));box-shadow:none;padding:3cqh 3cqw 3cqh;outline:none;backdrop-filter:blur(8px)}
.player[data-textbox=chem] .conversation{filter:drop-shadow(0 0 .25cqw #7dff6b) drop-shadow(0 0 1.6cqw #7dff6b55)}
.player[data-textbox=chem] .dialogue::before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(0deg,#7dff6b08 0 2px,transparent 2px 4px);pointer-events:none}
.player[data-textbox=chem] .nameplate{display:inline-block;background:#7dff6b;color:#041004;padding:.3cqh 1.2cqw;transform:skewX(-14deg);font-family:"Avenir Next Condensed","Arial Narrow",sans-serif;letter-spacing:.18em}
.player[data-textbox=chem] .text{color:#e9ffe4;font-family:"Avenir Next Condensed","Roboto Condensed","Arial Narrow",sans-serif;font-size:calc(var(--fs)*1.04)}.player[data-textbox=chem] .text em{color:#7dff6b;font-style:normal;text-shadow:0 0 .6cqw #7dff6b}
.player[data-textbox=chem] .choice{background:#071007f0;border:1px solid #7dff6b88;border-radius:0;clip-path:polygon(0 0,calc(100% - 1cqw) 0,100% 1cqw,100% 100%,0 100%)}.player[data-textbox=chem] .choice:hover,.player[data-textbox=chem] .choice.picked{background:#123d12;border-color:#7dff6b}
.player[data-textbox=chem] .advance{border-color:#7dff6b}
/* Terminal */
.player[data-textbox=terminal] .dialogue{background:#010703f2;border:1px solid #2bff7a55;border-radius:.4cqw;box-shadow:0 0 3cqh #14ff6a22,inset 0 0 6cqh #14ff6a10;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
.player[data-textbox=terminal] .dialogue::before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(0deg,#0000 0 3px,#00ff6608 3px 4px);pointer-events:none;border-radius:inherit}
.player[data-textbox=terminal] .nameplate{color:#2bff7a;font-family:inherit;text-transform:none;letter-spacing:0}.player[data-textbox=terminal] .nameplate::before{content:"> "}
.player[data-textbox=terminal] .text{color:#b6ffcf;font-family:inherit;font-size:calc(var(--fs)*.9);text-shadow:0 0 .5cqw #2bff7a66}.player[data-textbox=terminal] .text em{color:#2bff7a}
.player[data-textbox=terminal] .advance{width:.7em;height:1.1em;border:0;background:#2bff7a;transform:none;animation:caret 1s steps(1) infinite}@keyframes caret{50%{opacity:0}}
.player[data-textbox=terminal] .choice{font-family:ui-monospace,Menlo,monospace;background:#010703f0;border-color:#2bff7a55;border-radius:.2cqw;color:#b6ffcf}.player[data-textbox=terminal] .choice:hover,.player[data-textbox=terminal] .choice.picked{background:#06301a;border-color:#2bff7a}
/* Parchment */
.player[data-textbox=parchment] .dialogue{background:radial-gradient(ellipse at 30% 20%,#f6ecd0,#e6d3a6 70%,#d7c08b);border:1px solid #9d7f46;border-radius:.5cqw;box-shadow:inset 0 0 4cqh #8a6a3255,0 2cqh 5cqh #0009;color:#3a2a17;backdrop-filter:none}
.player[data-textbox=parchment] .nameplate{position:absolute;top:-2cqh;left:2.4cqw;background:linear-gradient(180deg,#a3332a,#7c211b);color:#f7e7c3;padding:.4cqh 1.6cqw;border-radius:.2cqw;font-family:"Iowan Old Style",Georgia,serif;letter-spacing:.14em;font-size:calc(var(--fs)*.64);box-shadow:0 .4cqh 1cqh #0006}
.player[data-textbox=parchment] .text{font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;color:#3a2a17}.player[data-textbox=parchment] .text em{color:#8a2a1c}
.player[data-textbox=parchment] .choice{background:#efe0bb;color:#3a2a17;border-color:#9d7f46;font-family:"Iowan Old Style",Georgia,serif}.player[data-textbox=parchment] .choice:hover,.player[data-textbox=parchment] .choice.picked{background:#f8edd2}
.player[data-textbox=parchment] .advance{border-color:#7c211b}
/* Frosted glass */
.player[data-textbox=glass] .dialogue{background:linear-gradient(135deg,#ffffff24,#ffffff0a 55%,#ffffff12),#0c111866;border:1px solid #ffffff38;border-radius:1.6cqw;backdrop-filter:blur(22px) saturate(1.5);box-shadow:0 2cqh 6cqh #0007,inset 0 1px 0 #ffffff4d;padding:2.6cqh 2.8cqw 2.8cqh 3.2cqw}
.player[data-textbox=glass] .dialogue::before{content:"";position:absolute;left:0;top:22%;bottom:22%;width:.3cqw;border-radius:0 .4cqw .4cqw 0;background:var(--name);box-shadow:0 0 1.6cqw var(--name);transition:background .4s,box-shadow .4s}
.player[data-textbox=glass] .nameplate{display:inline-flex;align-items:center;gap:.55em;text-transform:none;letter-spacing:.02em;font-size:calc(var(--fs)*.84);color:#fff}
.player[data-textbox=glass] .nameplate::before{content:"";width:.5em;height:.5em;border-radius:50%;background:var(--name);box-shadow:0 0 .7em var(--name)}
.player[data-textbox=glass] .text{color:#f8f8fc;text-shadow:0 1px 2px #0005}.player[data-textbox=glass] .text em{color:var(--name)}
.player[data-textbox=glass] .choice{background:#ffffff16;border-color:#ffffff38;border-radius:1.2cqw;backdrop-filter:blur(18px) saturate(1.4)}.player[data-textbox=glass] .choice:hover,.player[data-textbox=glass] .choice.picked{background:#ffffff2c;border-color:#fff}
/* Holographic hologram */
.player[data-textbox=hologram] .conversation{filter:drop-shadow(0 0 .5cqw #5fd4ff66) drop-shadow(0 0 2.4cqw #2a8dff33)}
.player[data-textbox=hologram] .dialogue{background:linear-gradient(180deg,#071c31eb,#020d1af2);border:0;border-radius:0;clip-path:polygon(1.8cqw 0,calc(100% - 1.8cqw) 0,100% 1.8cqw,100% calc(100% - 1.8cqw),calc(100% - 1.8cqw) 100%,1.8cqw 100%,0 calc(100% - 1.8cqw),0 1.8cqw);box-shadow:inset 0 0 0 1px #5fd4ff70,inset 0 0 5cqh #5fd4ff1f;padding:3.2cqh 3.6cqw 3cqh;backdrop-filter:none}
.player[data-textbox=hologram] .dialogue::before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(60deg,#5fd4ff09 0 1px,transparent 1px 2.2cqw),repeating-linear-gradient(-60deg,#5fd4ff09 0 1px,transparent 1px 2.2cqw);pointer-events:none}
.player[data-textbox=hologram] .dialogue::after{content:"";position:absolute;top:0;bottom:0;left:-30%;width:30%;background:linear-gradient(90deg,transparent,#8fe3ff1c,transparent);animation:hex-scan 5.5s linear infinite;pointer-events:none}
@keyframes hex-scan{from{transform:translateX(0)}to{transform:translateX(440%)}}
.player[data-textbox=hologram] .nameplate{color:#f1c86b;letter-spacing:.3em;font-size:calc(var(--fs)*.66);display:flex;align-items:center;gap:.8em}
.player[data-textbox=hologram] .nameplate::before{content:"";width:.7em;height:.7em;background:#5fd4ff;transform:rotate(45deg);box-shadow:0 0 .8em #5fd4ff}
.player[data-textbox=hologram] .nameplate::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,#f1c86b88,transparent)}
.player[data-textbox=hologram] .text{color:#e3f7ff;text-shadow:0 0 .5cqw #5fd4ff55}.player[data-textbox=hologram] .text em{color:#f1c86b;font-style:normal}
.player[data-textbox=hologram] .advance{border-color:#5fd4ff}
.player[data-textbox=hologram] .choice{background:#04182bf0;border:1px solid #5fd4ff77;border-radius:0;clip-path:polygon(1cqw 0,100% 0,100% calc(100% - 1cqw),calc(100% - 1cqw) 100%,0 100%,0 1cqw)}.player[data-textbox=hologram] .choice:hover,.player[data-textbox=hologram] .choice.picked{background:#0b3354;border-color:#f1c86b}
/* Grimoire: an aged parchment page with gilded filigree, ink-dark serif text and a ribbon nameplate. */
.player[data-textbox=grimoire] .conversation{width:min(1240px,78cqw);bottom:4.2cqh}
.player[data-textbox=grimoire] .dialogue{--ink:#2a1a0d;color:var(--ink);background:${PAPER} 0 0/320px 320px,radial-gradient(ellipse 45% 70% at 9% 18%,#b07a3c30,transparent 70%),radial-gradient(ellipse 40% 60% at 93% 86%,#94602a3a,transparent 70%),radial-gradient(ellipse 30% 45% at 72% 8%,#c3955522,transparent 70%),linear-gradient(176deg,#f5e9cb,#ecdab3 55%,#e3cd9e);border:0;border-radius:.35cqw;box-shadow:inset 0 0 0 1px #6b441855,inset 0 0 2.4cqh #8a5a2270,inset 0 0 .7cqh #5a3410a0,0 1.4cqh 3.6cqh #000000a8,0 .3cqh .7cqh #0007;backdrop-filter:none;padding:3.6cqh 4cqw 3.2cqh;min-height:18cqh}
.player[data-textbox=grimoire] .dialogue::before{content:"";position:absolute;inset:1.1cqh .8cqw;border:max(3px,.36cqh) double #a87b2fd0;border-radius:.2cqw;pointer-events:none}
.player[data-textbox=grimoire] .dialogue::after{content:"";position:absolute;inset:.45cqh .3cqw;pointer-events:none;background:${CORNERS};filter:drop-shadow(0 .1cqh .1cqh #5a341066)}
.player[data-textbox=grimoire] .nameplate{position:absolute;top:-2.5cqh;left:3.4cqw;z-index:1;margin:0;padding:.7cqh 2.7cqw .6cqh;font-family:var(--font-display);font-weight:600;font-size:calc(var(--fs)*.7);letter-spacing:.16em;line-height:1.5;text-transform:uppercase;white-space:nowrap;color:#f3d58c;text-shadow:0 .1cqh 0 #000a,0 0 .7em #e8b95a55;background:linear-gradient(180deg,color-mix(in srgb,var(--name) 16%,#4d1a40),color-mix(in srgb,var(--name) 9%,#240a1e));clip-path:polygon(0 0,100% 0,calc(100% - 1.1cqw) 50%,100% 100%,0 100%,1.1cqw 50%);box-shadow:inset 0 .24cqh 0 #e3bd6a,inset 0 -.24cqh 0 #e3bd6a,inset 0 .5cqh 0 #0000004d,inset 0 -.5cqh 0 #0000004d}
.player[data-textbox=grimoire] .dialogue.is-new{animation-name:grim-box-in}@keyframes grim-box-in{from{opacity:.7;translate:0 .8cqh}to{opacity:1;translate:0 0}}
.player[data-textbox=grimoire] .nameplate.is-new{animation-name:grim-name-in}@keyframes grim-name-in{from{opacity:0;translate:-1.4em 0;letter-spacing:.42em}}
.player[data-textbox=grimoire] .text{font-family:var(--font-book);font-weight:500;font-size:calc(var(--fs)*1.24);line-height:1.5;color:var(--ink);text-shadow:0 0 .04em #2b1b0e66;min-height:3em}
.player[data-textbox=grimoire] .text em{color:#7a1d1d}.player[data-textbox=grimoire] .text strong{font-weight:700}
.player[data-textbox=grimoire] .conversation.no-name .dialogue{background:${PAPER} 0 0/320px 320px,radial-gradient(ellipse 50% 80% at 50% 50%,transparent 40%,#a0723a26),linear-gradient(176deg,#f2e3c1f7,#e7d3a8f2 60%,#ddc595f4)}
.player[data-textbox=grimoire] .conversation.no-name .text{font-style:italic;text-align:center;color:#3b2915}
.player[data-textbox=grimoire] .conversation.no-name .text::before{content:"";display:block;width:min(15cqw,30cqh);height:1.8cqh;margin:-.6cqh auto .5cqh;background:${DIVIDER} center/contain no-repeat;opacity:.9}
.player[data-textbox=grimoire] .advance{right:3.6cqw;bottom:2.4cqh;width:2.6cqh;height:2.6cqh;border:0;transform:none;background:${QUILL_URI} center/contain no-repeat;filter:drop-shadow(0 .2cqh .2cqh #5a3a1066)}
.player[data-textbox=grimoire] .vn-text[data-caret] .g::after{background:var(--ink);box-shadow:none}
.player[data-textbox=grimoire] .vn-text[data-effect=quill] .g::after,.player[data-textbox=grimoire] .vn-text .g[data-in=quill]::after{filter:drop-shadow(0 .04em .05em #4a2c0c99) drop-shadow(0 0 .1em #ffd98a88)}
.player[data-textbox=grimoire] .choice{background:${PAPER} 0 0/320px 320px,linear-gradient(176deg,#f5e9cb,#e8d4aa);color:#2b1b0e;border:1px solid #a87b2f;border-radius:.25cqw;box-shadow:inset 0 0 0 .4cqh #f4e6c4,inset 0 0 0 calc(.4cqh + 1px) #a87b2f99,inset 0 0 1.8cqh #8a5a2250,0 .8cqh 2.2cqh #0009;font-family:var(--font-book);font-weight:600;font-size:calc(var(--fs)*1.02);backdrop-filter:none;padding:1.5cqh 2cqw}
.player[data-textbox=grimoire] .choice:hover,.player[data-textbox=grimoire] .choice.picked{background:${PAPER} 0 0/320px 320px,linear-gradient(176deg,#fbf2da,#efdfba);border-color:#d9b25f;box-shadow:inset 0 0 0 .4cqh #fbf0d4,inset 0 0 0 calc(.4cqh + 1px) #c99a45,0 0 2.4cqh #f1c76a88,0 .8cqh 2.2cqh #0009}
.player[data-textbox=grimoire] .choice-key{border-radius:50%;background:radial-gradient(circle at 35% 30%,#b0414a,#6d1420 60%,#4a0c14);color:#f3d58c;font-family:var(--font-display);box-shadow:inset 0 0 0 1px #d9b25f99,0 .15cqh .3cqh #0006}
/* Title card: a gilded, centred line for chapter titles. */
.player[data-textbox=title] .conversation{left:50%;top:50%;bottom:auto;transform:translate(-50%,-50%);width:min(1500px,86cqw);text-align:center}
.player[data-textbox=title] .dialogue{background:none;border:0;box-shadow:none;backdrop-filter:none;padding:0;min-height:0}
.player[data-textbox=title] .dialogue::before,.player[data-textbox=title] .dialogue::after{content:"";display:block;width:min(44cqw,90cqh);height:4cqh;margin:0 auto;background:${TITLE_RULE} center/contain no-repeat;filter:drop-shadow(0 .2cqh .4cqh #000c)}
.player[data-textbox=title] .dialogue::before{margin-bottom:2.2cqh}.player[data-textbox=title] .dialogue::after{margin-top:2.2cqh;transform:scaleY(-1)}
.player[data-textbox=title] .dialogue.is-new{animation:none}
.player[data-textbox=title] .dialogue.is-new::before{animation:title-rule 1.5s .15s both cubic-bezier(.2,.7,.2,1)}.player[data-textbox=title] .dialogue.is-new::after{animation:title-rule-flip 1.5s .3s both cubic-bezier(.2,.7,.2,1)}
@keyframes title-rule{from{opacity:0;transform:scaleX(.15)}to{opacity:1;transform:none}}@keyframes title-rule-flip{from{opacity:0;transform:scaleY(-1) scaleX(.15)}to{opacity:1;transform:scaleY(-1)}}
.player[data-textbox=title] .nameplate,.player[data-textbox=title] .advance{display:none!important}
.player[data-textbox=title] .text{font-family:var(--font-display);font-weight:600;font-style:normal;font-size:calc(var(--fs)*2.05);line-height:1.38;letter-spacing:.14em;min-height:0;color:#f1d48a;text-wrap:balance;filter:drop-shadow(0 .25cqh .45cqh #000d) drop-shadow(0 0 2.2cqh #0009)}
.player[data-textbox=title] .text em{font-style:normal;color:inherit}
.player[data-textbox=title] .vn-text .g.g{background-image:linear-gradient(100deg,transparent 38%,#fffdf0 50%,transparent 62%),linear-gradient(180deg,#fff4d2 6%,#f0cf7e 40%,#c38f2c 64%,#efd28a 94%);background-size:500% 100%,100% 100%;background-position:130% 0,0 0;background-repeat:no-repeat;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;animation:g-title-in 1.15s var(--d) both cubic-bezier(.2,.7,.2,1),g-title-shine 1.1s calc(var(--d) + 850ms) both ease-in-out!important;opacity:1}
.player[data-textbox=title] .vn-text .g::after,.player[data-textbox=title] .vn-text .g::before{display:none}
.player[data-textbox=title] .vn-text .w{animation:none!important}
@keyframes g-title-in{from{opacity:0;transform:scale(1.6);filter:blur(.12em)}to{opacity:1;transform:none;filter:none}}
@keyframes g-title-shine{from{background-position:130% 0,0 0}to{background-position:-30% 0,0 0}}
.player[data-textbox=title] .shade{background:radial-gradient(ellipse 58% 40% at 50% 50%,#000000a6,transparent 78%),linear-gradient(180deg,#05080a70,transparent 22%,transparent 55%,#05080acc)}
/* A new speaker: the nameplate slides in and the panel answers in their colour. */
.nameplate.is-new{animation:name-in .5s both cubic-bezier(.2,.8,.2,1)}
@keyframes name-in{from{opacity:0;transform:translateX(-.8em);letter-spacing:.3em;filter:blur(2px)}}
.player[data-textbox=gilded] .nameplate.is-new,.player[data-textbox=bubble] .nameplate.is-new,.player[data-textbox=chem] .nameplate.is-new{animation-name:name-drop}@keyframes name-drop{from{opacity:0;translate:0 -.6em}}
.dialogue.is-new{animation:box-in .55s both cubic-bezier(.2,.8,.2,1)}
@keyframes box-in{from{opacity:.25;translate:0 1.2cqh}to{opacity:1;translate:0 0}}
.player[data-textbox=bubble] .dialogue.is-new{animation-name:bubble-in;animation-timing-function:cubic-bezier(.3,1.5,.5,1);transform-origin:var(--tail-x,50%) 110%}@keyframes bubble-in{from{opacity:0;scale:.82}}
.player[data-textbox=cinematic] .dialogue.is-new,.player[data-textbox=minimal] .dialogue.is-new{animation-name:caption-in}@keyframes caption-in{from{opacity:0;filter:blur(4px)}}
.player[data-textbox=terminal] .vn-text[data-caret] .g::after{width:.55em;top:.15em;height:1.1em;border-radius:0;background:#2bff7a;box-shadow:0 0 .5em #2bff7a}
.player[data-textbox=parchment] .vn-text[data-caret] .g::after,.player[data-textbox=bubble] .vn-text[data-caret] .g::after{background:currentColor;box-shadow:none}
.player[data-mode=record] header,.player[data-mode=record] .quick,.player[data-mode=record] .scene-label,.player[data-mode=stage] header,.player[data-mode=stage] .quick,.player[data-mode=stage] .scene-label{display:none!important}
.player[data-mode=record] .viewport,.player[data-mode=stage] .viewport{cursor:default}
.title-card{position:absolute;inset:0;z-index:35;display:grid;place-items:center;text-align:center;background:radial-gradient(ellipse at 50% 40%,#18241f,#05070a);pointer-events:none}
.title-card h1{font-family:var(--font-story);font-weight:400;font-size:6cqw;margin:0 6cqw;letter-spacing:.02em;animation:title-in 1.6s both cubic-bezier(.2,.8,.2,1)}.title-card p{color:#c4cfc4;font-size:1.4cqw;letter-spacing:.3em;text-transform:uppercase;animation:title-in 1.6s .3s both}
@keyframes title-in{from{opacity:0;transform:translateY(2cqh);filter:blur(6px)}to{opacity:1;transform:none;filter:none}}
.intro{position:absolute;inset:0;z-index:30;display:grid;place-items:center;text-align:center;background:linear-gradient(120deg,#0d1411ed,#162420c7);padding:32px;font-family:var(--font-story)}
.intro-content{max-width:620px}.intro .eyebrow{color:var(--accent);letter-spacing:.24em;font-size:12px;text-transform:uppercase}
.intro h1{font-weight:400;font-size:clamp(40px,7cqw,84px);line-height:1.08;margin:22px 0}.intro p{color:#c4cfc4;line-height:1.8;margin-bottom:32px}
.intro-actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}.intro small{display:block;color:#899b8d;margin-top:26px;font-family:ui-sans-serif,system-ui,sans-serif}
.primary{background:var(--accent);color:#17201a;border-color:transparent}.primary:hover{filter:brightness(1.08);background:var(--accent)}
dialog{color:#e8eee6;background:#152019;border:1px solid #65715a;border-radius:16px;width:min(650px,calc(100% - 32px));max-height:80vh;padding:24px}
dialog::backdrop{background:#0009;backdrop-filter:blur(4px)}dialog h2{margin-top:0;font-weight:500}
.log-entry{border-bottom:1px solid #ffffff18;padding:14px 0;white-space:pre-wrap}.log-entry strong{color:#c3d5a8;display:block}.log-entry p{margin:6px 0}
.slots{list-style:none;padding:0;margin:0 0 18px;display:grid;gap:8px}.slots li{display:flex;gap:8px;align-items:center;padding:10px 12px;border:1px solid #ffffff20;border-radius:10px}
.slots li div{flex:1;min-width:0}.slots strong{display:block}.slots span{display:block;font-size:12px;color:#aebcae;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.setting{display:grid;grid-template-columns:140px 1fr;gap:12px;align-items:center;margin-bottom:14px}.setting select{background:#0f1712;border:1px solid #ffffff30;border-radius:8px;padding:6px}
#fatal{position:absolute;inset:auto 20px 20px;z-index:50;background:#4a1f17;color:#ffe5dc;padding:14px;border-radius:10px}
@media(prefers-reduced-motion:reduce){.actor,.camera,.conversation{transition:none}.bg-layer>*{animation:none!important}}
/* The editor stage keeps the same composition as a full-size game. */
@media(max-width:600px){.player:not([data-mode=stage]) .actors{transform:translateY(var(--panel-lift,0px))}.player:not([data-mode=stage]) .bg-layer>img{object-fit:contain;object-position:center 30%}.player:not([data-mode=stage]) .bg-layer{background:#131c20}}
@media(max-width:720px){.player:not([data-mode=stage]) header{padding:10px 12px;align-items:flex-start}.player:not([data-mode=stage]) .brand{font-size:10px;max-width:90px}.player:not([data-mode=stage]) .tools{gap:4px}.player:not([data-mode=stage]) .tools button{font-size:10px;padding:5px 7px}.player:not([data-mode=stage]) .scene-label{display:none}.player:not([data-mode=stage]) .conversation,.player:not([data-mode=stage])[data-textbox=minimal] .conversation,.player:not([data-mode=stage])[data-textbox=cinematic] .conversation{left:50%;transform:translateX(-50%);width:calc(100% - 20px);bottom:54px}.player:not([data-mode=stage])[data-textbox=bubble] .conversation{left:50%!important;transform:translateX(-50%);width:calc(100% - 24px);top:auto;bottom:54px}.player:not([data-mode=stage])[data-textbox=bubble] .dialogue::after{display:none}.player:not([data-mode=stage])[data-textbox=novel] .conversation{inset:60px 10px 54px}.player:not([data-mode=stage])[data-textbox=title] .conversation{top:45%;bottom:auto;transform:translate(-50%,-50%)}.player:not([data-mode=stage])[data-textbox=grimoire] .conversation{width:calc(100% - 20px);bottom:62px}.player:not([data-mode=stage])[data-textbox=grimoire] .nameplate{font-size:11px;top:-14px;padding:3px 18px}.player:not([data-mode=stage])[data-textbox=grimoire] .text{font-size:19px}.player:not([data-mode=stage])[data-textbox=grimoire] .dialogue{padding:20px 26px 18px}.player:not([data-mode=stage])[data-textbox=grimoire] .dialogue::after{background-size:34px 34px}.player:not([data-mode=stage]) .choices{width:calc(100% - 40px);top:40%}.player:not([data-mode=stage]) .dialogue{padding:14px 16px;border-radius:12px}.player:not([data-mode=stage]) .text{font-size:16px}.player:not([data-mode=stage]) .nameplate{font-size:12px}.player:not([data-mode=stage]) .actor{height:66%;width:150cqw}.player:not([data-mode=stage]) .quick{right:10px;bottom:10px}.player:not([data-mode=stage]) .hint{display:none}.player:not([data-mode=stage]) .setting{grid-template-columns:1fr}.player:not([data-mode=stage]) .choice{font-size:15px;padding:10px 14px}}
`;
