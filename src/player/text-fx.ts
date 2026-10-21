/**
 * Glyph animation shared by the player and the studio's effect previews. Text is built by
 * text.ts as `.w` (word) › `.g` (glyph, entrance) › `.fx` (one nested span per looping
 * behaviour), so entrances and any number of behaviours combine without fighting over
 * `transform`. Every animation is plain CSS, which the video renderer's virtual clock seeks
 * frame by frame, so recordings match the browser exactly.
 *
 * The quill entrance animates colour rather than opacity: its pen and sparkles are pseudo-
 * elements of the glyph and would otherwise be invisible while the glyph fades in.
 *
 * Variables: --d entrance delay, --n time until the next glyph (typewriter caret, quill), --i
 * glyph index (phase of travelling waves), --a behaviour strength, --sz relative size.
 */

/** A small gold-and-ivory quill, nib at the bottom left, for the enchanted-ink effect. */
const QUILL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs><linearGradient id="v" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#e2b65c"/><stop offset=".45" stop-color="#fbf0d2"/><stop offset="1" stop-color="#fffaf0"/></linearGradient></defs><path d="M13 35C16 22 29 9 46 2C43 15 31 29 13 35Z" fill="url(#v)" stroke="#b07f2c" stroke-width=".8"/><path d="M19 30l7-1M23 25l8-1M27 20l8-2M32 15l7-2M36 10l6-2M17 25l1-5M22 20l1-5M27 15l2-5M32 10l2-4" stroke="#c99a45" stroke-width=".7" stroke-linecap="round" opacity=".75"/><path d="M4 45L45 3" stroke="#8d6421" stroke-width="1.3" stroke-linecap="round"/><path d="M2 47l4-9 5 4z" fill="#d9ab4c" stroke="#6b4813" stroke-width=".6"/><path d="M2 47l2-4" stroke="#2a1c10" stroke-width="1.2" stroke-linecap="round"/></svg>`;
export const QUILL_URI = `url("data:image/svg+xml,${encodeURIComponent(QUILL_SVG)}")`;

export const TEXT_FX_STYLE = String.raw`
.vn-text .w{white-space:nowrap}.vn-text .g{display:inline-block;white-space:pre;position:relative}
.vn-text .sz{font-size:calc(var(--sz,1)*1em);line-height:1.15}
.vn-text[data-effect=typewriter] .g{animation:g-type 1ms var(--d) both}
.vn-text[data-effect=fade] .g{animation:g-fade .34s var(--d) both ease-out}
.vn-text[data-effect=rise] .g{animation:g-rise .46s var(--d) both cubic-bezier(.2,.8,.2,1)}
.vn-text[data-effect=blur] .g{animation:g-blur .5s var(--d) both ease-out}
.vn-text[data-effect=pop] .g{animation:g-pop .42s var(--d) both cubic-bezier(.3,1.7,.5,1)}
.vn-text[data-effect=word] .w{display:inline-block;animation:g-word .42s var(--d) both cubic-bezier(.2,.8,.2,1)}
.vn-text[data-effect=word] .w:has(.g[data-in]){animation:none}
.vn-text[data-effect=scramble] .g{animation:g-type 1ms var(--d) both}
.vn-text[data-effect=bounce] .g{animation:g-bounce .64s var(--d) both linear}
.vn-text[data-effect=fly] .g{animation:g-fly .56s var(--d) both cubic-bezier(.16,.9,.3,1)}
.vn-text[data-effect=spin] .g{animation:g-spin .58s var(--d) both cubic-bezier(.2,.9,.3,1.15)}
.vn-text[data-effect=stretch] .g{transform-origin:50% 100%;animation:g-stretch .52s var(--d) both ease-out}
.vn-text[data-effect=unfold] .g{transform-origin:0 50%;animation:g-unfold .5s var(--d) both cubic-bezier(.2,.8,.2,1)}
.vn-text[data-effect=glitch] .g{animation:g-glitch .42s var(--d) both linear}
.vn-text .g.g[data-in=typewriter],.vn-text .g.g[data-in=scramble]{animation:g-type 1ms var(--d) both}
.vn-text .g.g[data-in=fade]{animation:g-fade .34s var(--d) both ease-out}
.vn-text .g.g[data-in=rise]{animation:g-rise .46s var(--d) both cubic-bezier(.2,.8,.2,1)}
.vn-text .g.g[data-in=blur]{animation:g-blur .5s var(--d) both ease-out}
.vn-text .g.g[data-in=pop]{animation:g-pop .42s var(--d) both cubic-bezier(.3,1.7,.5,1)}
.vn-text .g.g[data-in=bounce]{animation:g-bounce .64s var(--d) both linear}
.vn-text .g.g[data-in=fly]{animation:g-fly .56s var(--d) both cubic-bezier(.16,.9,.3,1)}
.vn-text .g.g[data-in=spin]{animation:g-spin .58s var(--d) both cubic-bezier(.2,.9,.3,1.15)}
.vn-text .g.g[data-in=stretch]{transform-origin:50% 100%;animation:g-stretch .52s var(--d) both ease-out}
.vn-text .g.g[data-in=unfold]{transform-origin:0 50%;animation:g-unfold .5s var(--d) both cubic-bezier(.2,.8,.2,1)}
.vn-text .g.g[data-in=glitch]{animation:g-glitch .42s var(--d) both linear}
.vn-text .g.g[data-in=quill]{animation:g-quill .44s var(--d) both cubic-bezier(.25,.7,.25,1)}
.vn-text[data-effect=quill] .g{animation:g-quill .44s var(--d) both cubic-bezier(.25,.7,.25,1)}
.vn-text .g.is-scrambling{color:var(--accent,#cce794);opacity:.75}
.vn-text[data-caret] .g::after{content:"";position:absolute;left:calc(100% + .05em);top:.2em;height:1.05em;width:.08em;border-radius:.04em;background:var(--accent,currentColor);box-shadow:0 0 .3em var(--accent,currentColor);opacity:0;animation:g-caret var(--n,90ms) var(--d) linear;pointer-events:none}
.vn-text[data-effect=quill] .g:not([data-in])::after,.vn-text .g[data-in=quill]::after{content:"";position:absolute;left:calc(100% - .06em);bottom:.32em;width:1.15em;height:1.15em;border-radius:0;background:${QUILL_URI} 0 100%/contain no-repeat;box-shadow:none;filter:drop-shadow(0 0 .1em #ffd98a99);transform-origin:0 100%;opacity:0;animation:g-quill-pen var(--n,90ms) var(--d) linear;pointer-events:none;z-index:1}
.vn-text[data-effect=quill] .g[data-last]:not([data-in])::after,.vn-text .g[data-last][data-in=quill]::after{animation-name:g-quill-pen-out;animation-duration:.42s}
.vn-text[data-effect=quill] .g:not([data-in])::before,.vn-text .g[data-in=quill]::before{content:"";position:absolute;left:35%;top:-.05em;width:.8em;height:.8em;background:radial-gradient(circle at 20% 80%,#fff6d0 0 .045em,#f0b84a .06em,transparent .1em),radial-gradient(circle at 75% 40%,#ffe9a8 0 .035em,#e8a93a .05em,transparent .085em),radial-gradient(circle at 45% 10%,#fffbe8 0 .03em,transparent .065em);opacity:0;animation:g-quill-spark .9s var(--d) both ease-out;pointer-events:none}
.vn-text[data-effect=quill] .g:nth-child(3n+2)::before,.vn-text .g[data-in=quill]:nth-child(3n+2)::before{animation-name:g-quill-spark-b}
.vn-text[data-effect=quill] .g:nth-child(3n)::before,.vn-text .g[data-in=quill]:nth-child(3n)::before{animation-name:g-quill-spark-c;left:10%}
@keyframes g-quill{from{color:#f6d27a00;transform:translateY(-.05em) scale(1.15);text-shadow:0 0 .4em #ffcf6a00}10%{color:#f8d98acc;text-shadow:0 0 .12em #fff1c4,0 0 .35em #ffcf6a,0 0 .8em #ffb84288}35%{color:#e3b04e;text-shadow:0 0 .2em #ffcf6a99}to{transform:none}}
@keyframes g-quill-pen{from{opacity:1;transform:translate(-.12em,.03em) rotate(-5deg)}to{opacity:1;transform:none}}
@keyframes g-quill-pen-out{from{opacity:1;transform:translate(-.12em,.03em) rotate(-5deg)}45%{opacity:1;transform:none}to{opacity:0;transform:translate(.25em,-.2em) rotate(6deg)}}
@keyframes g-quill-spark{from{opacity:0;transform:translate(0,.12em) scale(.5)}18%{opacity:1}to{opacity:0;transform:translate(.32em,-.55em) scale(1.1)}}
@keyframes g-quill-spark-b{from{opacity:0;transform:translate(0,.1em) scale(.5) rotate(40deg)}20%{opacity:.9}to{opacity:0;transform:translate(-.22em,-.6em) scale(1) rotate(40deg)}}
@keyframes g-quill-spark-c{from{opacity:0;transform:translate(0,.05em) scale(.45) rotate(-30deg)}22%{opacity:.85}to{opacity:0;transform:translate(.12em,-.75em) scale(.9) rotate(-30deg)}}
@media(prefers-reduced-motion:reduce){.vn-text[data-effect=quill] .g,.vn-text .g.g[data-in=quill]{animation:g-fade .3s var(--d) both ease-out}.vn-text[data-effect=quill] .g::before,.vn-text[data-effect=quill] .g::after,.vn-text .g[data-in=quill]::before,.vn-text .g[data-in=quill]::after{display:none}}
.vn-text.is-done .g,.vn-text.is-done .w{animation:none!important;opacity:1!important}.vn-text.is-done .g::after,.vn-text.is-done .g::before{display:none}
@keyframes g-type{from{opacity:0}to{opacity:1}}@keyframes g-fade{from{opacity:0}to{opacity:1}}@keyframes g-caret{from,to{opacity:.9}}
@keyframes g-rise{from{opacity:0;transform:translateY(.6em);filter:blur(.04em)}70%{opacity:1;transform:translateY(-.04em)}to{opacity:1;transform:none;filter:none}}
@keyframes g-blur{from{opacity:0;filter:blur(.35em);transform:scale(1.15)}to{opacity:1;filter:none;transform:none}}
@keyframes g-pop{0%{opacity:0;transform:scale(.2) rotate(-10deg)}100%{opacity:1;transform:none}}
@keyframes g-word{from{opacity:0;transform:translateY(.45em) scale(.92);filter:blur(.05em)}to{opacity:1;transform:none;filter:none}}
@keyframes g-bounce{0%{opacity:0;transform:translateY(-1em);animation-timing-function:cubic-bezier(.5,0,1,.6)}40%{opacity:1;transform:translateY(0);animation-timing-function:cubic-bezier(0,.4,.5,1)}60%{transform:translateY(-.26em);animation-timing-function:cubic-bezier(.5,0,1,.6)}78%{transform:translateY(0);animation-timing-function:cubic-bezier(0,.4,.5,1)}89%{transform:translateY(-.07em);animation-timing-function:cubic-bezier(.5,0,1,.6)}100%{opacity:1;transform:none}}
@keyframes g-fly{from{opacity:0;transform:translate(1.8em,-1em) rotate(28deg) scale(.35);filter:blur(.08em)}60%{opacity:1}to{opacity:1;transform:none;filter:none}}
@keyframes g-spin{from{opacity:0;transform:rotate(-300deg) scale(0)}to{opacity:1;transform:none}}
@keyframes g-stretch{0%{opacity:0;transform:scaleY(0) scaleX(1.3)}55%{opacity:1;transform:scaleY(1.32) scaleX(.85)}78%{transform:scaleY(.9) scaleX(1.06)}100%{opacity:1;transform:none}}
@keyframes g-unfold{from{opacity:0;transform:perspective(6em) rotateY(-100deg)}to{opacity:1;transform:none}}
@keyframes g-glitch{0%{opacity:0;transform:translate(-.2em,0) skewX(30deg)}15%{opacity:1;transform:translate(.14em,-.04em) skewX(-20deg);text-shadow:-.08em 0 #ff2a6d,.08em 0 #05d9e8}35%{opacity:.4;transform:translate(-.08em,.03em)}50%{opacity:1;transform:translate(.05em,0) skewX(8deg);text-shadow:.06em 0 #ff2a6d,-.06em 0 #05d9e8}70%{transform:translate(-.02em,0);text-shadow:none}100%{opacity:1;transform:none}}
.vn-text .fx{display:inline-block;white-space:pre;--a:1}
.vn-text [data-fx=wave]{animation:fx-wave 1.3s calc(var(--i)*-90ms) ease-in-out infinite}
.vn-text [data-fx=bounce]{animation:fx-bounce 1.05s calc(var(--i)*-75ms) infinite}
.vn-text [data-fx=jitter]{animation:fx-jitter-0 .26s steps(1) infinite}.vn-text .g[data-v="1"] [data-fx=jitter]{animation-name:fx-jitter-1}.vn-text .g[data-v="2"] [data-fx=jitter]{animation-name:fx-jitter-2}
.vn-text [data-fx=wiggle]{animation:fx-wiggle .44s calc(var(--i)*-70ms) ease-in-out infinite alternate}
.vn-text [data-fx=swing]{transform-origin:50% 60%;animation:fx-swing 1.7s calc(var(--i)*-130ms) ease-in-out infinite alternate}
.vn-text [data-fx=dangle]{transform-origin:50% 0;animation:fx-dangle 2s calc(var(--i)*-160ms) ease-in-out infinite alternate}
.vn-text [data-fx=float]{animation:fx-float 3.2s ease-in-out infinite alternate}
.vn-text [data-fx=pulse]{animation:fx-pulse 1.5s calc(var(--i)*-60ms) ease-in-out infinite alternate}
.vn-text [data-fx=grow]{animation:fx-grow 1.25s calc(var(--i)*-90ms) ease-in-out infinite}
.vn-text [data-fx=rainbow]{animation:fx-rainbow 2.6s calc(var(--i)*-110ms) linear infinite}
.vn-text [data-fx=glow]{animation:fx-glow 1.7s ease-in-out infinite alternate}
.vn-text [data-fx=glitch]{animation:fx-glitch 2.4s calc(var(--i)*-173ms) steps(1) infinite}
@keyframes fx-wave{0%,100%{transform:translateY(calc(.13em*var(--a)))}50%{transform:translateY(calc(-.17em*var(--a)))}}
@keyframes fx-bounce{0%,52%,100%{transform:translateY(0);animation-timing-function:cubic-bezier(.3,.7,.4,1)}24%{transform:translateY(calc(-.34em*var(--a)));animation-timing-function:cubic-bezier(.6,0,.8,.4)}38%{transform:translateY(calc(.03em*var(--a)))}}
@keyframes fx-jitter-0{0%{transform:translate(calc(.04em*var(--a)),calc(-.03em*var(--a)))}25%{transform:translate(calc(-.05em*var(--a)),calc(.02em*var(--a)))}50%{transform:translate(calc(.02em*var(--a)),calc(.04em*var(--a)))}75%{transform:translate(calc(-.03em*var(--a)),calc(-.04em*var(--a)))}}
@keyframes fx-jitter-1{0%{transform:translate(calc(-.03em*var(--a)),calc(.04em*var(--a)))}25%{transform:translate(calc(.05em*var(--a)),calc(-.02em*var(--a)))}50%{transform:translate(calc(-.04em*var(--a)),calc(-.03em*var(--a)))}75%{transform:translate(calc(.03em*var(--a)),calc(.03em*var(--a)))}}
@keyframes fx-jitter-2{0%{transform:translate(calc(.02em*var(--a)),calc(.03em*var(--a)))}25%{transform:translate(calc(-.04em*var(--a)),calc(-.04em*var(--a)))}50%{transform:translate(calc(.05em*var(--a)),calc(.01em*var(--a)))}75%{transform:translate(calc(-.02em*var(--a)),calc(.04em*var(--a)))}}
@keyframes fx-wiggle{from{transform:rotate(calc(-7deg*var(--a)))}to{transform:rotate(calc(7deg*var(--a)))}}
@keyframes fx-swing{from{transform:rotate(calc(-13deg*var(--a))) translateY(calc(.03em*var(--a)))}to{transform:rotate(calc(13deg*var(--a))) translateY(calc(-.03em*var(--a)))}}
@keyframes fx-dangle{from{transform:rotate(calc(11deg*var(--a)))}to{transform:rotate(calc(-11deg*var(--a)))}}
@keyframes fx-float{from{transform:translateY(calc(.08em*var(--a))) rotate(calc(-1.5deg*var(--a)))}to{transform:translateY(calc(-.14em*var(--a))) rotate(calc(1.5deg*var(--a)))}}
@keyframes fx-pulse{from{opacity:1}to{opacity:calc(1 - .6*min(1,var(--a)))}}
@keyframes fx-grow{0%,100%{transform:scale(1)}50%{transform:scale(calc(1 + .28*var(--a)))}}
@keyframes fx-rainbow{0%,100%{color:#ff6b6b}17%{color:#ffb84d}33%{color:#ffe94d}50%{color:#6dff8a}67%{color:#4dc9ff}83%{color:#b48cff}}
@keyframes fx-glow{from{text-shadow:0 0 calc(.08em*var(--a)) var(--accent,#cce794)}to{text-shadow:0 0 calc(.45em*var(--a)) var(--accent,#cce794),0 0 calc(.9em*var(--a)) var(--accent,#cce794)}}
@keyframes fx-glitch{0%,84%,100%{transform:none;text-shadow:none;opacity:1}86%{transform:translate(calc(.07em*var(--a)),calc(-.03em*var(--a))) skewX(-14deg);text-shadow:calc(-.07em*var(--a)) 0 #ff2a6d,calc(.07em*var(--a)) 0 #05d9e8}90%{transform:translate(calc(-.06em*var(--a)),calc(.02em*var(--a)));text-shadow:calc(.05em*var(--a)) 0 #ff2a6d,calc(-.05em*var(--a)) 0 #05d9e8;opacity:.7}94%{transform:translateX(calc(.03em*var(--a)));text-shadow:none}}
@media(prefers-reduced-motion:reduce){.vn-text .fx{animation:none!important}}
`;
