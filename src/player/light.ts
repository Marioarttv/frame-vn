/**
 * Scene lighting for characters. Portraits are painted in neutral daylight; a scene's
 * `light` tints and darkens them toward the location's light and adds a soft rim light on
 * the side the light comes from, so a moonlit classroom or a candlelit hall reads as one
 * picture. Everything is one SVG filter on each actor's body, updated per frame while a
 * change eases in, so video renders reproduce it exactly.
 */
import type { ActorLight } from "../engine/types";

const SVG_NS = "http://www.w3.org/2000/svg";
const EASE_MS = 900;

interface State {
  r: number;
  g: number;
  b: number;
  saturation: number;
  rim: [number, number, number];
  rimOpacity: number;
  rimFrom: "left" | "right" | "top";
}

const NEUTRAL: State = { r: 1, g: 1, b: 1, saturation: 1, rim: [1, 1, 1], rimOpacity: 0, rimFrom: "left" };

function rgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? [...value].map((c) => c + c).join("") : value.slice(0, 6);
  const n = Number.parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** The filter values a light asks for. */
export function lightState(light: ActorLight | undefined): State {
  if (!light) return NEUTRAL;
  const [lr, lg, lb] = rgb(light.color);
  const amount = Math.max(0, Math.min(1, light.amount));
  const mix = (c: number) => light.brightness * (1 - amount + amount * c);
  return {
    r: mix(lr),
    g: mix(lg),
    b: mix(lb),
    saturation: light.saturation ?? 1,
    rim: light.rim ? rgb(light.rim) : [1, 1, 1],
    rimOpacity: light.rim ? Math.max(0, Math.min(1, light.rimStrength ?? 0.6)) : 0,
    rimFrom: light.rimFrom ?? "left",
  };
}

/** Row-major 4x5 colour matrix: channel tint applied after a saturation change. */
export function lightMatrix(state: State): string {
  const s = state.saturation;
  const sat = [
    [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
  ];
  const k = [state.r, state.g, state.b];
  const rows = sat.map((row, i) => [...row.map((v) => v * k[i]), 0, 0]);
  rows.push([0, 0, 0, 1, 0]);
  return rows.map((row) => row.map((v) => +v.toFixed(4)).join(" ")).join("  ");
}

function lerp(a: State, b: State, t: number): State {
  const l = (x: number, y: number) => x + (y - x) * t;
  return {
    r: l(a.r, b.r),
    g: l(a.g, b.g),
    b: l(a.b, b.b),
    saturation: l(a.saturation, b.saturation),
    rim: [l(a.rim[0], b.rim[0]), l(a.rim[1], b.rim[1]), l(a.rim[2], b.rim[2])],
    rimOpacity: l(a.rimOpacity, b.rimOpacity),
    rimFrom: t < 0.5 ? a.rimFrom : b.rimFrom,
  };
}

export interface ActorLighting {
  set(light: ActorLight | undefined, instant: boolean): void;
  dispose(): void;
}

/** Installs the filter in `host` and drives it through the `--actor-light` variable on `player`. */
export function createActorLighting(player: HTMLElement, host: HTMLElement, id = "vne-actor-light"): ActorLighting {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  svg.innerHTML = `<filter id="${id}" color-interpolation-filters="sRGB" x="-4%" y="-4%" width="108%" height="108%">
<feColorMatrix in="SourceGraphic" type="matrix" result="lit"/>
<feOffset in="SourceAlpha" result="shift"/>
<feComposite in="SourceAlpha" in2="shift" operator="out" result="edge"/>
<feGaussianBlur in="edge" result="soft"/>
<feFlood result="tone"/>
<feComposite in="tone" in2="soft" operator="in" result="glow"/>
<feComposite in="glow" in2="SourceAlpha" operator="in" result="rim"/>
<feBlend in="rim" in2="lit" mode="screen"/>
</filter>`;
  host.append(svg);
  const matrix = svg.querySelector("feColorMatrix")!;
  const offset = svg.querySelector("feOffset")!;
  const blur = svg.querySelector("feGaussianBlur")!;
  const flood = svg.querySelector("feFlood")!;
  let current: State = NEUTRAL;
  let target: State = NEUTRAL;
  let frame = 0;

  const apply = (state: State) => {
    const neutral =
      Math.abs(state.r - 1) + Math.abs(state.g - 1) + Math.abs(state.b - 1) + Math.abs(state.saturation - 1) < 0.002 &&
      state.rimOpacity < 0.002;
    player.style.setProperty("--actor-light", neutral ? "none" : `url(#${id})`);
    if (neutral) return;
    matrix.setAttribute("values", lightMatrix(state));
    // Rim width follows the stage size so 720p and 1080p renders look alike.
    const size = Math.max(2, (player.clientHeight || 1080) * 0.006);
    const [dx, dy] = state.rimFrom === "left" ? [size, size * 0.3] : state.rimFrom === "right" ? [-size, size * 0.3] : [0, size];
    offset.setAttribute("dx", dx.toFixed(2));
    offset.setAttribute("dy", dy.toFixed(2));
    blur.setAttribute("stdDeviation", (size * 0.45).toFixed(2));
    const [r, g, b] = state.rim.map((v) => Math.round(v * 255));
    flood.setAttribute("flood-color", `rgb(${r},${g},${b})`);
    flood.setAttribute("flood-opacity", state.rimOpacity.toFixed(3));
  };

  return {
    set(light, instant) {
      target = lightState(light);
      cancelAnimationFrame(frame);
      if (instant) {
        current = target;
        apply(current);
        return;
      }
      const from = current;
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / EASE_MS);
        const eased = t * t * (3 - 2 * t);
        current = lerp(from, target, eased);
        apply(current);
        if (t < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    },
    dispose() {
      cancelAnimationFrame(frame);
      svg.remove();
      player.style.removeProperty("--actor-light");
    },
  };
}
