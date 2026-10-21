/**
 * Backgrounds, their transitions and slow motion, the camera, and screen-wide effects.
 * Two background layers alternate: the incoming one is revealed over the outgoing one.
 */
import type {
  BackgroundMotion,
  Camera,
  Transition,
} from "../engine/types";

export interface BackgroundView {
  key: string;
  src: string;
  video: boolean;
}

const EASE = "cubic-bezier(.65,0,.25,1)";
const wait = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const settled = (animation: Animation) =>
  animation.finished.then(
    () => undefined,
    () => undefined,
  );

function blindsPolygon(open: number, slats = 9): string {
  const points: string[] = [];
  for (let index = 0; index < slats; index++) {
    const start = (index / slats) * 100;
    const end = start + (open * 100) / slats;
    points.push(`${start}% 100%`, `${start}% 0%`, `${end}% 0%`, `${end}% 100%`);
  }
  return `polygon(${points.join(",")})`;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svgNode<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}
/** Seeded so a transition looks the same in every playback and every video render. */
function seededRandom(seed: number) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (text: string) =>
  Array.from(text).reduce((sum, char) => (Math.imul(sum, 31) + char.charCodeAt(0)) | 0, 17);

let overlaySerial = 0;
/** Durations of the two picture-tearing transitions, in milliseconds. */
export const BURN_MS = 1900;
export const SEAM_MS = 1600;

type AnimationOptions = (duration: number, extra?: KeyframeAnimationOptions) => KeyframeAnimationOptions;

/**
 * The old picture, laid over the new one, burns away from its corners inward: a noise-edged
 * hole grows from the outside, its edge charred dark with a glowing ember rim, and sparks
 * rise from the burning edge.
 */
function burnOverlay(
  layer: HTMLElement,
  src: string,
  key: string,
  run: Animation[],
  options: AnimationOptions,
): Element {
  const rect = layer.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const id = `burn-${seedOf(key + src) >>> 0}-${++overlaySerial}`;
  const random = seededRandom(seedOf(key + src));
  const svg = svgNode("svg", {
    class: "tx-burn",
    viewBox: `0 0 ${w} ${h}`,
    preserveAspectRatio: "none",
    "aria-hidden": "true",
  });
  const defs = svgNode("defs");
  // Both filters use the same noise, so the glowing rim follows the mask's torn edge exactly.
  const noiseSeed = 1 + Math.floor(random() * 90);
  const noise = (name: string, glow: boolean) => {
    const filter = svgNode("filter", {
      id: `${id}-${name}`,
      filterUnits: "userSpaceOnUse",
      x: -w * 0.4,
      y: -h * 0.4,
      width: w * 1.8,
      height: h * 1.8,
    });
    filter.append(
      svgNode("feTurbulence", {
        type: "fractalNoise",
        baseFrequency: (4.2 / Math.min(w, h)).toFixed(5),
        numOctaves: 3,
        seed: noiseSeed,
        result: "noise",
      }),
      svgNode("feDisplacementMap", {
        in: "SourceGraphic",
        in2: "noise",
        scale: Math.round(Math.min(w, h) * 0.22),
        xChannelSelector: "R",
        yChannelSelector: "G",
        result: "torn",
      }),
    );
    if (glow) {
      const merge = svgNode("feMerge");
      merge.append(
        svgNode("feMergeNode", { in: "blur" }),
        svgNode("feMergeNode", { in: "torn" }),
      );
      filter.append(
        svgNode("feGaussianBlur", {
          in: "torn",
          stdDeviation: (Math.min(w, h) * 0.012).toFixed(1),
          result: "blur",
        }),
        merge,
      );
    }
    defs.append(filter);
    return `url(#${id}-${name})`;
  };
  const torn = noise("torn", false);
  const glowFilter = noise("glow", true);
  const shape = (attributes: Record<string, string | number>) =>
    svgNode("ellipse", {
      cx: w / 2,
      cy: h / 2,
      rx: w * 0.78,
      ry: h * 0.8,
      ...attributes,
    });
  const mask = svgNode("mask", {
    id: `${id}-mask`,
    maskUnits: "userSpaceOnUse",
    x: -w,
    y: -h,
    width: w * 3,
    height: h * 3,
  });
  const keepGroup = svgNode("g", { filter: torn });
  const keep = shape({ fill: "#fff" });
  keepGroup.append(keep);
  mask.append(keepGroup);
  defs.append(mask);
  const picture = svgNode("image", {
    href: src,
    x: 0,
    y: 0,
    width: w,
    height: h,
    preserveAspectRatio: "xMidYMid slice",
    mask: `url(#${id}-mask)`,
  });
  // Scorch: a soft dark band just inside the edge, on the paper that is about to burn.
  const charGroup = svgNode("g", { filter: torn, mask: `url(#${id}-mask)` });
  const char = shape({
    fill: "none",
    stroke: "#1b0c05",
    "stroke-opacity": 0.92,
    "stroke-width": Math.round(Math.min(w, h) * 0.12),
    "vector-effect": "non-scaling-stroke",
  });
  charGroup.append(char);
  const rimGroup = svgNode("g", { filter: glowFilter, class: "rim" });
  const rimOuter = shape({
    fill: "none",
    stroke: "#ff6a1a",
    "stroke-width": Math.max(4, Math.round(Math.min(w, h) * 0.024)),
    "vector-effect": "non-scaling-stroke",
  });
  const rimInner = shape({
    fill: "none",
    stroke: "#ffd27a",
    "stroke-width": Math.max(1.5, Math.round(Math.min(w, h) * 0.006)),
    "vector-effect": "non-scaling-stroke",
  });
  rimGroup.append(rimOuter, rimInner);
  const sparks = svgNode("g", { class: "sparks" });
  svg.append(defs, picture, charGroup, rimGroup, sparks);
  layer.append(svg);

  const origin = `${w / 2}px ${h / 2}px`;
  for (const element of [keep, char, rimOuter, rimInner]) {
    element.style.transformOrigin = origin;
    run.push(
      element.animate(
        [{ transform: "scale(1.3)" }, { transform: "scale(0)" }],
        options(BURN_MS, { easing: "cubic-bezier(.45,.05,.75,.95)" }),
      ),
    );
  }
  run.push(
    rimGroup.animate(
      [{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.86 }, { opacity: 0 }],
      options(BURN_MS, { easing: "linear" }),
    ),
  );
  // Sparks leave the burning edge as it passes and drift upward.
  for (let index = 0; index < 46; index++) {
    const at = 0.06 + random() * 0.78;
    const angle = random() * Math.PI * 2;
    const reach = 1.3 * (1 - at) * 0.85;
    const x = w / 2 + Math.cos(angle) * w * 0.78 * reach * 0.8;
    const y = h / 2 + Math.sin(angle) * h * 0.8 * reach * 0.8;
    const size = Math.min(w, h) * (0.003 + random() * 0.006);
    const spark = svgNode("circle", {
      cx: x.toFixed(1),
      cy: y.toFixed(1),
      r: size.toFixed(2),
      fill: random() < 0.3 ? "#fff1c4" : "#ffab4a",
    });
    sparks.append(spark);
    const rise = -h * (0.08 + random() * 0.16);
    const drift = w * (random() - 0.5) * 0.06;
    run.push(
      spark.animate(
        [
          { opacity: 0, transform: "translate(0,0)" },
          { opacity: 1, offset: 0.12 },
          { opacity: 0, transform: `translate(${drift.toFixed(1)}px,${rise.toFixed(1)}px)` },
        ],
        options(520 + random() * 520, { delay: at * BURN_MS, easing: "ease-out", fill: "both" }),
      ),
    );
  }
  return svg;
}

/**
 * A glowing silver line opens across the middle of the old picture, then its two halves part,
 * up and down, to reveal the new one.
 */
function seamOverlay(
  layer: HTMLElement,
  src: string,
  run: Animation[],
  options: AnimationOptions,
): Element {
  const root = document.createElement("div");
  root.className = "tx-seam";
  root.setAttribute("aria-hidden", "true");
  const top = document.createElement("i");
  const bottom = document.createElement("i");
  const line = document.createElement("b");
  top.className = "half top";
  bottom.className = "half bottom";
  for (const half of [top, bottom]) half.style.backgroundImage = `url("${src.replace(/"/g, '\\"')}")`;
  root.append(top, bottom, line);
  layer.append(root);
  const open = 0.32;
  run.push(
    line.animate(
      [
        { transform: "scaleX(0)", opacity: 0 },
        { transform: "scaleX(0.04)", opacity: 1, offset: 0.04 },
        { transform: "scaleX(1)", opacity: 1, offset: open },
        { transform: "scaleX(1) scaleY(2.2)", opacity: 1, offset: open + 0.08 },
        { transform: "scaleX(1) scaleY(6)", opacity: 0 },
      ],
      options(SEAM_MS, { easing: "ease-in-out" }),
    ),
  );
  for (const [half, sign] of [
    [top, -1],
    [bottom, 1],
  ] as const)
    run.push(
      half.animate(
        [
          { transform: "translateY(0)", filter: "brightness(1)" },
          { transform: "translateY(0)", filter: "brightness(1)", offset: open },
          { transform: `translateY(${sign * 54}%)`, filter: "brightness(.55)" },
        ],
        options(SEAM_MS, { easing: "cubic-bezier(.6,0,.3,1)" }),
      ),
    );
  return root;
}

export interface Stage {
  setBackground(
    view: BackgroundView | null,
    motion: BackgroundMotion | undefined,
    transition: Transition,
    instant: boolean,
  ): Promise<void>;
  setCamera(camera: Camera | undefined, instant: boolean): void;
  shake(strength: "light" | "heavy"): void;
  /** Covers the screen (fade/flash/glitch), applying the change at its midpoint. */
  cover(kind: "fade" | "flash" | "glitch", apply: () => void): Promise<void>;
  flash(): void;
  /** Ends a cover early, e.g. when the reader skips ahead. */
  clear(): void;
}

export function createStage(elements: {
  viewport: HTMLElement;
  camera: HTMLElement;
  layers: [HTMLElement, HTMLElement];
  curtain: HTMLElement;
  reducedMotion: boolean;
}): Stage {
  const { viewport, camera, layers, curtain, reducedMotion } = elements;
  let front = 0;
  let current: { key: string | null; motion?: BackgroundMotion } = {
    key: null,
  };
  let generation = 0;
  const animations = new Set<Animation>();
  const track = (animation: Animation) => {
    animations.add(animation);
    void settled(animation).then(() => animations.delete(animation));
    return animation;
  };

  function media(view: BackgroundView): HTMLElement {
    if (view.video) {
      const video = document.createElement("video");
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.autoplay = true;
      video.setAttribute("aria-hidden", "true");
      video.src = view.src;
      void video.play().catch(() => undefined);
      return video;
    }
    const image = document.createElement("img");
    image.alt = "";
    image.decoding = "async";
    image.src = view.src;
    return image;
  }
  async function ready(element: HTMLElement) {
    if (element instanceof HTMLImageElement) {
      if (element.complete) return;
      await Promise.race([element.decode().catch(() => undefined), wait(900)]);
    } else if (element instanceof HTMLVideoElement && element.readyState < 2)
      await Promise.race([
        new Promise((resolve) =>
          element.addEventListener("loadeddata", resolve, { once: true }),
        ),
        wait(1200),
      ]);
  }
  function setMotion(layer: HTMLElement, motion?: BackgroundMotion) {
    const child = layer.firstElementChild as HTMLElement | null;
    if (!child) return;
    child.className = motion && !reducedMotion ? `m-${motion}` : "";
  }
  function resetLayer(layer: HTMLElement) {
    layer.getAnimations().forEach((animation) => animation.cancel());
    layer.style.cssText = "";
  }
  function empty(layer: HTMLElement) {
    for (const video of layer.querySelectorAll("video")) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    layer.replaceChildren();
  }

  async function setBackground(
    view: BackgroundView | null,
    motion: BackgroundMotion | undefined,
    transition: Transition,
    instant: boolean,
  ) {
    const key = view?.key ?? null;
    const outgoing = layers[front];
    if (key === current.key) {
      if (motion !== current.motion) setMotion(outgoing, motion);
      current = { key, motion };
      return;
    }
    const mine = ++generation;
    current = { key, motion };
    const incoming = layers[1 - front];
    for (const animation of animations) animation.finish();
    resetLayer(incoming);
    resetLayer(outgoing);
    empty(incoming);
    incoming.classList.toggle("is-empty", !view);
    if (view) {
      const element = media(view);
      incoming.append(element);
      setMotion(incoming, motion);
      if (!instant) await ready(element);
      if (mine !== generation) return;
    }
    incoming.classList.add("is-top");
    outgoing.classList.remove("is-top");
    incoming.hidden = false;
    front = 1 - front;
    const effect =
      instant || reducedMotion
        ? "cut"
        : transition === "fade" || transition === "flash" || transition === "glitch"
          ? "cut"
          : transition;
    const finish = () => {
      if (mine !== generation) return;
      empty(outgoing);
      outgoing.hidden = true;
      resetLayer(outgoing);
      resetLayer(incoming);
    };
    if (effect === "cut") return finish();
    // Burn and seam tear the old picture itself, so they need a still image to work with.
    const oldMedia = outgoing.firstElementChild;
    const oldSrc =
      oldMedia instanceof HTMLImageElement ? oldMedia.currentSrc || oldMedia.src : "";
    const tearing = effect === "burn" || effect === "seam";
    const chosen = tearing && !oldSrc ? "dissolve" : effect;
    let overlay: Element | null = null;
    const options = (duration: number, extra: KeyframeAnimationOptions = {}) => ({
      duration,
      easing: EASE,
      fill: "both" as FillMode,
      ...extra,
    });
    const run: Animation[] = [];
    const mask = (image: string, size: string, from: string, to: string) => {
      for (const prefix of ["mask", "webkitMask"] as const) {
        const style = incoming.style as unknown as Record<string, string>;
        style[`${prefix}Image`] = image;
        style[`${prefix}Size`] = size;
        style[`${prefix}Repeat`] = "no-repeat";
      }
      run.push(
        incoming.animate(
          [
            { maskPosition: from, webkitMaskPosition: from },
            { maskPosition: to, webkitMaskPosition: to },
          ] as Keyframe[],
          options(1000),
        ),
      );
    };
    const soft = (direction: string) =>
      `linear-gradient(${direction},#000 0%,#000 40%,transparent 60%,transparent 100%)`;
    switch (chosen) {
      case "burn":
        overlay = burnOverlay(incoming, oldSrc, key ?? "", run, options);
        break;
      case "seam":
        overlay = seamOverlay(incoming, oldSrc, run, options);
        break;
      case "dissolve":
        run.push(incoming.animate([{ opacity: 0 }, { opacity: 1 }], options(850)));
        break;
      case "wipe-right":
        mask(soft("to right"), "250% 100%", "100% 0%", "0% 0%");
        break;
      case "wipe-left":
        mask(soft("to left"), "250% 100%", "0% 0%", "100% 0%");
        break;
      case "wipe-down":
        mask(soft("to bottom"), "100% 250%", "0% 100%", "0% 0%");
        break;
      case "wipe-up":
        mask(soft("to top"), "100% 250%", "0% 0%", "0% 100%");
        break;
      case "iris":
        run.push(
          incoming.animate(
            [
              { clipPath: "circle(0% at 50% 45%)" },
              { clipPath: "circle(80% at 50% 45%)" },
            ],
            options(1000),
          ),
        );
        break;
      case "blinds":
        run.push(
          incoming.animate(
            [{ clipPath: blindsPolygon(0) }, { clipPath: blindsPolygon(1) }],
            options(950),
          ),
        );
        break;
      case "slide-left":
      case "slide-right": {
        const sign = effect === "slide-left" ? 1 : -1;
        run.push(
          incoming.animate(
            [
              { transform: `translateX(${sign * 100}%)` },
              { transform: "translateX(0)" },
            ],
            options(950),
          ),
          outgoing.animate(
            [
              { transform: "translateX(0)", filter: "brightness(1)" },
              {
                transform: `translateX(${sign * -35}%)`,
                filter: "brightness(.45)",
              },
            ],
            options(950),
          ),
        );
        break;
      }
      case "zoom":
        run.push(
          incoming.animate(
            [
              { transform: "scale(1.35)", opacity: 0, filter: "blur(10px)" },
              { transform: "scale(1)", opacity: 1, filter: "blur(0)" },
            ],
            options(950),
          ),
          outgoing.animate(
            [
              { transform: "scale(1)", opacity: 1 },
              { transform: "scale(.88)", opacity: 0.4 },
            ],
            options(950),
          ),
        );
        break;
      case "blur":
        run.push(
          outgoing.animate(
            [{ filter: "blur(0)" }, { filter: "blur(22px)" }],
            options(600),
          ),
          incoming.animate(
            [
              { opacity: 0, filter: "blur(22px)" },
              { opacity: 1, filter: "blur(0)" },
            ],
            options(800, { delay: 250 }),
          ),
        );
        break;
    }
    run.forEach(track);
    await Promise.all(run.map(settled));
    overlay?.remove();
    finish();
  }

  function setCamera(view: Camera | undefined, instant: boolean) {
    const zoom = view?.zoom ?? 1;
    let transform = "none";
    if (zoom > 1.001) {
      const clamp = (value: number) =>
        Math.min(0, Math.max(100 - 100 * zoom, value));
      const x = clamp(50 - (view!.x ?? 50) * zoom);
      const y = clamp(50 - (view!.y ?? 50) * zoom);
      transform = `translate(${x}%, ${y}%) scale(${zoom})`;
    }
    if (camera.style.transform === transform) return;
    if (instant || reducedMotion) {
      camera.style.transition = "none";
      camera.style.transform = transform;
      void camera.offsetWidth;
      camera.style.transition = "";
    } else camera.style.transform = transform;
  }

  function shake(strength: "light" | "heavy") {
    if (reducedMotion) return;
    const amount = strength === "heavy" ? 1.6 : 0.6;
    const frames: Keyframe[] = [];
    for (let index = 0; index <= 10; index++) {
      const decay = 1 - index / 10;
      const x = (index % 2 ? 1 : -1) * amount * decay;
      const y = (index % 3 ? -0.6 : 0.6) * amount * decay;
      const rotate = strength === "heavy" ? (index % 2 ? 0.5 : -0.5) * decay : 0;
      frames.push({
        transform: `translate(${x}%, ${y}%) rotate(${rotate}deg)`,
      });
    }
    track(
      viewport.animate(frames, {
        duration: strength === "heavy" ? 750 : 420,
        easing: "linear",
      }),
    );
  }

  async function cover(kind: "fade" | "flash" | "glitch", apply: () => void) {
    if (reducedMotion) return apply();
    if (kind === "glitch") {
      window.setTimeout(apply, 140);
      const frames: Keyframe[] = [];
      for (let index = 0; index < 12; index++) {
        const offset = ((index * 37) % 11) - 5;
        frames.push({
          transform: `translate(${offset * 0.4}%, ${((index * 17) % 5) - 2}px) skewX(${offset * 0.6}deg)`,
          filter: `hue-rotate(${(index * 47) % 360}deg) saturate(${index % 2 ? 3 : 1}) contrast(${1 + (index % 3) * 0.3})`,
          clipPath: `inset(${(index * 13) % 40}% 0 ${(index * 7) % 30}% 0)`,
        });
      }
      frames.push({
        transform: "none",
        filter: "none",
        clipPath: "inset(0 0 0 0)",
      });
      await settled(
        track(viewport.animate(frames, { duration: 650, easing: "steps(12)" })),
      );
      return;
    }
    curtain.classList.toggle("white", kind === "flash");
    curtain.getAnimations().forEach((animation) => animation.cancel());
    await settled(
      track(
        curtain.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: kind === "flash" ? 140 : 380,
          fill: "forwards",
          easing: "ease-in",
        }),
      ),
    );
    apply();
    await settled(
      track(
        curtain.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: kind === "flash" ? 700 : 560,
          fill: "forwards",
          easing: "ease-out",
        }),
      ),
    );
  }

  function flash() {
    if (reducedMotion) return;
    curtain.classList.add("white");
    track(
      curtain.animate([{ opacity: 0 }, { opacity: 0.85 }, { opacity: 0 }], {
        duration: 380,
        easing: "ease-out",
      }),
    );
  }

  return {
    setBackground,
    setCamera,
    shake,
    cover,
    flash,
    clear() {
      for (const animation of animations) animation.finish();
    },
  };
}
