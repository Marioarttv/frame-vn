/**
 * The `uncloak` entrance and exit: a character takes off (or pulls on) a translucent veil.
 * A soft-edged alpha mask uncovers the figure from the top down while a silvery, liquid sheen
 * (contour bands of a stretched noise, like water-silk) slides down with the cloak's edge, and
 * a faint heat-haze displacement ripples the freshly revealed part. The exit plays the same
 * thing backwards, so the figure vanishes from the feet up.
 *
 * Mask and filter sit on the actor's motion element, so the portrait, blink, mouth and morph
 * layers inside it are uncovered together without seams. Everything is drawn each frame from
 * elapsed time, so the video renderer's virtual clock reproduces it exactly.
 */

/** Length of the reveal (and of the reverse on exit), in milliseconds. */
export const UNCLOAK_MS = 1400;
/** The reduced-motion replacement: a plain fade. */
const FADE_MS = 560;

const SVG_NS = "http://www.w3.org/2000/svg";
let serial = 0;

export interface CloakRun {
  /** Ends the effect at once and leaves the figure fully visible. */
  cancel(): void;
  /** Resolves when the effect has finished or been cancelled. */
  done: Promise<void>;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (value: number) => {
  const c = clamp01(value);
  return c * c * (3 - 2 * c);
};

function node<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes))
    element.setAttribute(key, String(value));
  return element;
}

/**
 * Plays the cloak on `target` (an actor's motion element). `reverse` is the exit: the figure
 * disappears from the bottom up and stays hidden until the caller removes it.
 */
export function playUncloak(
  target: HTMLElement,
  options: { reverse?: boolean; reducedMotion?: boolean },
): CloakRun {
  const reverse = !!options.reverse;
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => (finish = resolve));
  const width = target.offsetWidth;
  const height = target.offsetHeight;

  if (options.reducedMotion || !width || !height) {
    const fade = target.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: FADE_MS,
      easing: "ease-in-out",
      direction: reverse ? "reverse" : "normal",
      fill: reverse ? "forwards" : "backwards",
    });
    fade.finished.catch(() => undefined).then(finish);
    return {
      cancel() {
        if (!reverse) fade.cancel();
        finish();
      },
      done,
    };
  }

  serial += 1;
  const id = `vne-uncloak-${serial}`;
  const w = width;
  const h = height;
  const pad = Math.round(h * 0.05);
  const svg = node("svg", { width: 0, height: 0, "aria-hidden": "true" });
  svg.style.position = "absolute";
  const filter = node("filter", {
    id,
    filterUnits: "userSpaceOnUse",
    primitiveUnits: "userSpaceOnUse",
    x: -pad,
    y: -pad,
    width: w + pad * 2,
    height: h + pad * 2,
    "color-interpolation-filters": "sRGB",
  });
  // Noise stretched sideways: soft horizontal folds, like light on water-silk.
  const noise = node("feTurbulence", {
    type: "fractalNoise",
    baseFrequency: `${(3.2 / w).toFixed(5)} ${(26 / h).toFixed(5)}`,
    numOctaves: 2,
    seed: 11,
    result: "noise0",
  });
  const flow = node("feOffset", {
    in: "noise0",
    dx: 0,
    dy: 0,
    result: "noise",
  });
  const haze = node("feDisplacementMap", {
    in: "SourceGraphic",
    in2: "noise",
    scale: 0,
    xChannelSelector: "R",
    yChannelSelector: "G",
    result: "haze",
  });
  const hazeFlat = node("feFlood", {
    "flood-color": "#fff",
    result: "hazeFlat",
  });
  const hazeBlur = node("feGaussianBlur", {
    in: "hazeFlat",
    stdDeviation: `0 ${(h * 0.028).toFixed(1)}`,
    result: "hazeBand",
  });
  const sheenFlat = node("feFlood", {
    "flood-color": "#fff",
    result: "sheenFlat",
  });
  const sheenBlur = node("feGaussianBlur", {
    in: "sheenFlat",
    stdDeviation: `0 ${(h * 0.016).toFixed(1)}`,
    result: "sheenBand",
  });
  // White with the noise as alpha, then contour bands of it: rippling caustic lines.
  const white = node("feColorMatrix", {
    in: "noise",
    type: "matrix",
    values: "0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1.4 0 0 0 -0.2",
    result: "noiseAlpha",
  });
  const contours = node("feComponentTransfer", {
    in: "noiseAlpha",
    result: "folds",
  });
  contours.append(
    node("feFuncA", {
      type: "table",
      tableValues: "0 .15 .95 .2 0 .25 1 .2 0 .15 .8 .1 0",
    }),
  );
  const sheenGlow = node("feComposite", {
    in: "sheenBand",
    in2: "folds",
    operator: "arithmetic",
    k1: 0.75,
    k2: 0.22,
    k3: 0,
    k4: 0,
    result: "sheenRaw",
  });
  const tint = node("feColorMatrix", {
    in: "sheenRaw",
    type: "matrix",
    // Cool silver with a hint of blue: R .88, G .93, B 1.
    values: "0.88 0 0 0 0  0 0.93 0 0 0  0 0 1 0 0  0 0 0 1 0",
    result: "sheenTint",
  });
  const sheenOpacity = node("feComponentTransfer", {
    in: "sheenTint",
    result: "sheenFaded",
  });
  const sheenAlpha = node("feFuncA", {
    type: "linear",
    slope: 0,
    intercept: 0,
  });
  sheenOpacity.append(sheenAlpha);
  filter.append(
    noise,
    flow,
    haze,
    hazeFlat,
    hazeBlur,
    node("feComposite", {
      in: "haze",
      in2: "hazeBand",
      operator: "in",
      result: "hazeIn",
    }),
    node("feComposite", {
      in: "SourceGraphic",
      in2: "hazeBand",
      operator: "out",
      result: "rest",
    }),
    (() => {
      const merge = node("feMerge", { result: "moved" });
      merge.append(
        node("feMergeNode", { in: "rest" }),
        node("feMergeNode", { in: "hazeIn" }),
      );
      return merge;
    })(),
    sheenFlat,
    sheenBlur,
    white,
    contours,
    sheenGlow,
    tint,
    sheenOpacity,
    node("feComposite", {
      in: "sheenFaded",
      in2: "SourceAlpha",
      operator: "in",
      result: "sheen",
    }),
    node("feBlend", { in: "sheen", in2: "moved", mode: "screen" }),
  );
  svg.append(filter);
  (target.parentElement ?? target).append(svg);

  const region = (
    element: SVGElement,
    top: number,
    bottom: number,
    spill = 0,
  ) => {
    element.setAttribute("x", String(-pad - spill));
    element.setAttribute("width", String(w + (pad + spill) * 2));
    element.setAttribute("y", top.toFixed(1));
    element.setAttribute("height", Math.max(1, bottom - top).toFixed(1));
  };
  const soft = h * 0.07;
  const draw = (elapsed: number) => {
    const f = clamp01(elapsed / UNCLOAK_MS);
    const t = reverse ? 1 - f : f;
    // The cloak's edge: from above the head to below the feet, easing in and out.
    const eased = 0.5 - Math.cos(Math.PI * t) / 2;
    const line = -soft * 1.6 + eased * (h + soft * 3.2);
    const mask = `linear-gradient(to bottom,#000 ${(line - soft).toFixed(1)}px,rgba(0,0,0,.35) ${(line - soft * 0.25).toFixed(1)}px,rgba(0,0,0,0) ${(line + soft).toFixed(1)}px)`;
    target.style.setProperty("-webkit-mask-image", mask);
    target.style.setProperty("mask-image", mask);
    // Strongest in the middle of the reveal, gone at either end.
    const envelope = smooth(f / 0.12) * (1 - smooth((f - 0.82) / 0.18));
    haze.setAttribute("scale", (h * 0.022 * envelope).toFixed(2));
    // The folds sway sideways; the noise is painted wider than the region so it never runs out.
    flow.setAttribute("dx", (Math.sin(elapsed / 260) * w * 0.02).toFixed(1));
    const hazeTop = line - h * 0.14;
    const hazeBottom = line + soft;
    region(noise, hazeTop - h * 0.06, hazeBottom + h * 0.06, w * 0.03);
    for (const element of [flow, haze])
      region(element, hazeTop - h * 0.06, hazeBottom + h * 0.06);
    region(hazeFlat, hazeTop, hazeBottom);
    region(hazeBlur, hazeTop - h * 0.06, hazeBottom + h * 0.06);
    const sheenCentre = line - soft * 0.55;
    region(sheenFlat, sheenCentre - h * 0.03, sheenCentre + h * 0.03);
    region(sheenBlur, sheenCentre - h * 0.08, sheenCentre + h * 0.08);
    sheenAlpha.setAttribute("slope", (0.95 * envelope).toFixed(3));
  };
  target.style.filter = `url(#${id})`;
  draw(0);

  let ended = false;
  const end = (visible: boolean) => {
    if (ended) return;
    ended = true;
    target.style.removeProperty("filter");
    if (visible) {
      target.style.removeProperty("-webkit-mask-image");
      target.style.removeProperty("mask-image");
    } else {
      target.style.setProperty(
        "-webkit-mask-image",
        "linear-gradient(transparent,transparent)",
      );
      target.style.setProperty(
        "mask-image",
        "linear-gradient(transparent,transparent)",
      );
    }
    svg.remove();
    finish();
  };
  const began = performance.now();
  const tick = () => {
    if (ended) return;
    if (!target.isConnected) return end(true);
    const elapsed = performance.now() - began;
    if (elapsed >= UNCLOAK_MS) return end(!reverse);
    draw(elapsed);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // A hidden tab may never deliver a frame: the figure still ends where it should.
  window.setTimeout(() => end(!reverse), UNCLOAK_MS + 120);
  return { cancel: () => end(true), done };
}
