/**
 * Virtual clock injected into the recording document before any page script runs
 * (Playwright `page.addInitScript(installVirtualClock, options)`).
 *
 * Every time source a browser page can observe is replaced by one virtual clock that only
 * advances when the renderer asks for the next frame, so each captured frame shows the exact
 * state at `frame / fps` seconds regardless of how fast or slowly the machine renders:
 *
 * - timers (`setTimeout`/`setInterval`), `requestAnimationFrame`, `requestIdleCallback`
 * - `performance.now()`, `Date.now()` and `new Date()`
 * - every `document.getAnimations()` entry (CSS animations, CSS transitions, WAAPI): paused on
 *   first sight, seeked to the virtual elapsed time each frame and `finish()`ed when they pass
 *   their end so `finished` promises and events still fire
 * - `HTMLMediaElement`: audio never really plays; `currentTime`/`paused`/`ended` derive from the
 *   virtual clock and `play`/`pause`/`timeupdate`/`ended` events fire at the right virtual time.
 *   Every play/pause/seek/volume/rate change is written to an audio timeline that the renderer
 *   turns into the final mix. Videos are seeked to the virtual position every frame.
 *
 * The function must stay self-contained (no imports, no outer references): Playwright
 * serialises its source text. Keep the browser-only code free of Node types.
 */

export interface VirtualClockOptions {
  /** Media durations in seconds keyed by `mediaKey(src)`, for sources the browser cannot decode. */
  durations: Record<string, number>;
  /** Longest chain of due timers processed in one step before giving up (guards busy loops). */
  maxTimersPerStep?: number;
}

export type AudioEventType =
  | "play"
  | "pause"
  | "seek"
  | "ended"
  | "volume"
  | "rate"
  | "loop"
  | "src"
  | "error";

export interface AudioEvent {
  /** Virtual time in milliseconds. */
  t: number;
  /** Stable per-element id. */
  id: number;
  kind: "audio" | "video";
  type: AudioEventType;
  /** `mediaKey` of the element's source at that moment. */
  key?: string;
  /** Non-data sources are kept verbatim so the renderer can report them. */
  src?: string;
  /** Media position in seconds (play/seek/pause/ended). */
  position?: number;
  /** Effective volume (0 when muted), playback rate, or 1/0 for loop. */
  value?: number;
  rate?: number;
  loop?: boolean;
}

export interface RecordingStatus {
  status: "playing" | "done" | "error" | "unknown";
  scenes?: number;
  nodeId?: string;
  message?: string;
}

export interface StepResult {
  /** Virtual time after the step, in milliseconds. */
  now: number;
  timersRun: number;
  pendingTimers: number;
  animations: number;
  media: number;
  settled: boolean;
  /** Real milliseconds spent waiting for the page to settle. */
  waited: number;
  pending: string[];
  recording: RecordingStatus;
  errors: string[];
}

export interface VirtualClockApi {
  step(deltaMs: number, settleCapMs: number): Promise<StepResult>;
  settle(capMs: number): Promise<{ settled: boolean; waited: number; pending: string[] }>;
  now(): number;
  getAudioLog(): AudioEvent[];
  /** Full data URL for a media key the renderer did not find in the document. */
  getSource(key: string): string | null;
  status(): RecordingStatus;
  /** Snapshot of scheduled work, for diagnostics. */
  debug(): {
    now: number;
    timers: { in: number; interval: number | null }[];
    frameCallbacks: number;
    idleCallbacks: number;
    animations: Record<string, number>;
    media: { id: number; kind: string; playing: boolean; readyState: number; position: number; key: string }[];
  };
}

/** Same key the injected clock computes for data URLs: a hash of the complete contents. */
export function mediaKey(src: string): string {
  if (!src.startsWith("data:")) return src;
  return (() => {
  // FNV-1a over every character with two seeds: distinct recordings never share a key.
  let a = 0x811c9dc5, b = 0x01000193 ^ src.length;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return `d:${src.length}:${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
  })();
}

/**
 * Init-script source for Playwright. Bundlers (tsx, Vite's config loader) may wrap named
 * functions in an esbuild `__name` helper, so the serialised function gets a local stand-in.
 */
export function virtualClockScript(options: VirtualClockOptions): string {
  const source = installVirtualClock.toString();
  return `(() => { var __name = (target, value) => { try { Object.defineProperty(target, "name", { value, configurable: true }); } catch (_) {} return target; }; (${source})(${JSON.stringify(options)}); })();`;
}

export function installVirtualClock(options: VirtualClockOptions): void {
  const win = window as unknown as Record<string, unknown> & Window;
  if (win.__frameClock) return;
  const durations = options.durations ?? {};
  const maxTimers = options.maxTimersPerStep ?? 20000;
  const errors: string[] = [];
  const report = (error: unknown) => {
    const text = error instanceof Error ? `${error.message}` : String(error);
    if (errors.length < 50) errors.push(text);
    // Keep the page's own error reporting intact for the renderer's console listener.
    try {
      console.error("[virtual-clock] callback failed:", error);
    } catch {
      /* ignore */
    }
  };

  const native = {
    setTimeout: window.setTimeout.bind(window),
    performanceNow: performance.now.bind(performance),
    Date: Date,
    fetch: window.fetch?.bind(window),
    Audio: window.Audio,
  };
  const keyCache = new Map<string, string>();
  const keyFor = (src: string): string => {
    if (!src.startsWith("data:")) return src;
    const cached = keyCache.get(src);
    if (cached) return cached;
    const key = (() => {
        // FNV-1a over every character with two seeds: distinct recordings never share a key.
        let a = 0x811c9dc5, b = 0x01000193 ^ src.length;
        for (let i = 0; i < src.length; i++) {
          const c = src.charCodeAt(i);
          a = Math.imul(a ^ c, 0x01000193);
          b = Math.imul(b ^ c, 0x5bd1e995);
        }
        return `d:${src.length}:${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
      })();
    keyCache.set(src, key);
    return key;
  };

  // A real macrotask boundary lets microtasks and DOM event side effects complete between
  // virtual callbacks without waiting for a real timer.
  const channel = new MessageChannel();
  let yieldResolvers: (() => void)[] = [];
  channel.port1.onmessage = () => {
    const resolvers = yieldResolvers;
    yieldResolvers = [];
    for (const resolve of resolvers) resolve();
  };
  const yieldTask = () =>
    new Promise<void>((resolve) => {
      yieldResolvers.push(resolve);
      channel.port2.postMessage(0);
    });

  /* ---------- time ---------- */
  let now = 0;
  const epoch = native.Date.now();
  const virtualNow = () => now;
  performance.now = virtualNow;
  try {
    Performance.prototype.now = virtualNow;
  } catch {
    /* read-only in exotic environments */
  }
  const NativeDate = native.Date;
  class VirtualDate extends NativeDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(epoch + now);
      else super(...(args as [number]));
    }
    static now(): number {
      return epoch + now;
    }
  }
  Object.defineProperty(VirtualDate, "name", { value: "Date" });
  VirtualDate.parse = NativeDate.parse;
  VirtualDate.UTC = NativeDate.UTC;
  (win as unknown as { Date: unknown }).Date = VirtualDate;

  /* ---------- timers ---------- */
  interface Timer {
    id: number;
    time: number;
    seq: number;
    fn: (...args: unknown[]) => void;
    args: unknown[];
    interval: number | null;
  }
  let nextId = 1;
  let seq = 0;
  const timers = new Map<number, Timer>();
  const asFunction = (fn: unknown): ((...args: unknown[]) => void) | null =>
    typeof fn === "function" ? (fn as (...args: unknown[]) => void) : null;
  const schedule = (
    fn: unknown,
    delay: unknown,
    args: unknown[],
    repeat: boolean,
  ): number => {
    const id = nextId++;
    const callback = asFunction(fn);
    if (!callback) return id;
    const wait = Math.max(1, Number(delay) || 0);
    timers.set(id, {
      id,
      time: now + wait,
      seq: seq++,
      fn: callback,
      args,
      interval: repeat ? wait : null,
    });
    return id;
  };
  win.setTimeout = ((fn: unknown, delay?: unknown, ...args: unknown[]) =>
    schedule(fn, delay, args, false)) as typeof window.setTimeout;
  win.setInterval = ((fn: unknown, delay?: unknown, ...args: unknown[]) =>
    schedule(fn, delay, args, true)) as typeof window.setInterval;
  win.clearTimeout = ((id?: number) => {
    if (id !== undefined) timers.delete(id);
  }) as typeof window.clearTimeout;
  win.clearInterval = win.clearTimeout as typeof window.clearInterval;

  /* ---------- animation frames and idle callbacks ---------- */
  let frameCallbacks = new Map<number, FrameRequestCallback>();
  win.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const id = nextId++;
    if (typeof callback === "function") frameCallbacks.set(id, callback);
    return id;
  }) as typeof window.requestAnimationFrame;
  win.cancelAnimationFrame = ((id: number) => {
    frameCallbacks.delete(id);
  }) as typeof window.cancelAnimationFrame;
  const idleCallbacks = new Map<number, IdleRequestCallback>();
  win.requestIdleCallback = ((callback: IdleRequestCallback) => {
    const id = nextId++;
    if (typeof callback === "function") idleCallbacks.set(id, callback);
    return id;
  }) as typeof window.requestIdleCallback;
  win.cancelIdleCallback = ((id: number) => {
    idleCallbacks.delete(id);
  }) as typeof window.cancelIdleCallback;

  /* ---------- pending work the renderer must wait for in real time ---------- */
  let pendingFetches = 0;
  let pendingDecodes = 0;
  const pendingImages = new Set<HTMLImageElement>();
  const decodedSource = new WeakMap<HTMLImageElement, string>();
  if (native.fetch) {
    win.fetch = ((...args: Parameters<typeof fetch>) => {
      pendingFetches++;
      let done = false;
      const settle = () => {
        if (!done) {
          done = true;
          pendingFetches--;
        }
      };
      const result = native.fetch!(...args);
      result.then(settle, settle);
      return result;
    }) as typeof fetch;
  }
  for (const method of ["json", "text", "arrayBuffer", "blob"] as const) {
    const original = Response.prototype[method] as (
      this: Response,
    ) => Promise<unknown>;
    if (typeof original !== "function") continue;
    Object.defineProperty(Response.prototype, method, {
      configurable: true,
      writable: true,
      value: function (this: Response) {
        pendingFetches++;
        let done = false;
        const settle = () => {
          if (!done) {
            done = true;
            pendingFetches--;
          }
        };
        const result = original.call(this);
        result.then(settle, settle);
        return result;
      },
    });
  }
  const imageSource = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    "src",
  );
  if (imageSource?.set && imageSource.get) {
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      configurable: true,
      enumerable: imageSource.enumerable,
      get: imageSource.get,
      set(this: HTMLImageElement, value: string) {
        pendingImages.add(this);
        imageSource.set!.call(this, value);
      },
    });
  }
  const imageSetAttribute = HTMLImageElement.prototype.setAttribute;
  HTMLImageElement.prototype.setAttribute = function (
    this: HTMLImageElement,
    name: string,
    value: string,
  ) {
    if (String(name).toLowerCase() === "src") pendingImages.add(this);
    return imageSetAttribute.call(this, name, value);
  };
  const imageDecode = HTMLImageElement.prototype.decode;
  const trackDecode = (promise: Promise<void>) => {
    pendingDecodes++;
    let done = false;
    const settle = () => {
      if (!done) {
        done = true;
        pendingDecodes--;
      }
    };
    promise.then(settle, settle);
    return promise;
  };
  HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
    return trackDecode(imageDecode.call(this));
  };

  /* ---------- media ---------- */
  interface MediaState {
    id: number;
    kind: "audio" | "video";
    playing: boolean;
    /** Virtual time (ms) when the current play run started. */
    startAt: number;
    /** Media position (s) at `startAt`, or the paused position. */
    offset: number;
    rate: number;
    lastTimeUpdate: number;
    seekPending: boolean;
    src: string;
    error: string | null;
  }
  const mediaStates = new WeakMap<HTMLMediaElement, MediaState>();
  const mediaRegistry = new Set<HTMLMediaElement>();
  const audioLog: AudioEvent[] = [];
  const dataSources = new Map<string, string>();
  let mediaSeq = 1;
  const proto = HTMLMediaElement.prototype;
  const accessor = (name: string) =>
    Object.getOwnPropertyDescriptor(proto, name)!;
  const nativeMedia = {
    play: proto.play,
    pause: proto.pause,
    load: proto.load,
    duration: accessor("duration").get!,
    currentTimeGet: accessor("currentTime").get!,
    currentTimeSet: accessor("currentTime").set!,
    paused: accessor("paused").get!,
    volumeGet: accessor("volume").get!,
    volumeSet: accessor("volume").set!,
    mutedGet: accessor("muted").get!,
    mutedSet: accessor("muted").set!,
    loopGet: accessor("loop").get!,
    loopSet: accessor("loop").set!,
    rateGet: accessor("playbackRate").get!,
    rateSet: accessor("playbackRate").set!,
    srcGet: accessor("src").get!,
    srcSet: accessor("src").set!,
    readyState: accessor("readyState").get!,
    error: accessor("error").get!,
    setAttribute: proto.setAttribute,
    removeAttribute: proto.removeAttribute,
  };
  const stateFor = (element: HTMLMediaElement): MediaState => {
    let state = mediaStates.get(element);
    if (!state) {
      state = {
        id: mediaSeq++,
        kind: element.tagName === "VIDEO" ? "video" : "audio",
        playing: false,
        startAt: 0,
        offset: 0,
        rate: 1,
        lastTimeUpdate: -Infinity,
        seekPending: false,
        src: "",
        error: null,
      };
      mediaStates.set(element, state);
      mediaRegistry.add(element);
      if (state.kind === "video") {
        element.addEventListener("seeked", () => {
          state!.seekPending = false;
        });
        element.addEventListener("error", () => {
          state!.seekPending = false;
        });
      }
    }
    return state;
  };
  const durationOf = (element: HTMLMediaElement, state: MediaState): number => {
    const real = nativeMedia.duration.call(element);
    if (Number.isFinite(real) && real > 0) return real;
    const known = durations[keyFor(state.src)];
    return typeof known === "number" && known > 0 ? known : NaN;
  };
  const rawPosition = (state: MediaState) =>
    state.offset +
    (state.playing ? ((now - state.startAt) / 1000) * state.rate : 0);
  const positionOf = (element: HTMLMediaElement, state: MediaState) => {
    let position = rawPosition(state);
    const duration = durationOf(element, state);
    if (Number.isFinite(duration)) {
      if (nativeMedia.loopGet.call(element)) position %= duration;
      else position = Math.min(position, duration);
    }
    return Math.max(0, position);
  };
  const effectiveVolume = (element: HTMLMediaElement) =>
    nativeMedia.mutedGet.call(element) ? 0 : nativeMedia.volumeGet.call(element);
  const log = (
    _element: HTMLMediaElement,
    state: MediaState,
    type: AudioEventType,
    extra: Partial<AudioEvent> = {},
  ) => {
    const event: AudioEvent = {
      t: now,
      id: state.id,
      kind: state.kind,
      type,
      key: keyFor(state.src),
      ...extra,
    };
    if (!state.src.startsWith("data:")) event.src = state.src.slice(0, 2000);
    audioLog.push(event);
  };
  const dispatch = (element: HTMLMediaElement, type: string) => {
    try {
      element.dispatchEvent(new Event(type));
    } catch (error) {
      report(error);
    }
  };
  const stopForLoad = (element: HTMLMediaElement, state: MediaState) => {
    const wasPlaying = state.playing;
    state.playing = false;
    state.offset = 0;
    state.rate = 1;
    if (wasPlaying) dispatch(element, "pause");
    dispatch(element, "emptied");
  };
  const setSource = (element: HTMLMediaElement, value: string) => {
    const state = stateFor(element);
    stopForLoad(element, state);
    state.src = String(value ?? "");
    state.error = null;
    if (state.src.startsWith("data:") && dataSources.size < 500)
      dataSources.set(keyFor(state.src), state.src);
    log(element, state, "src");
  };
  proto.play = function (this: HTMLMediaElement) {
    const state = stateFor(this);
    if (!state.playing) {
      const duration = durationOf(this, state);
      if (
        Number.isFinite(duration) &&
        !nativeMedia.loopGet.call(this) &&
        state.offset >= duration
      )
        state.offset = 0; // Replaying an ended element restarts it.
      state.playing = true;
      state.startAt = now;
      state.lastTimeUpdate = now;
      log(this, state, "play", {
        position: state.offset,
        value: effectiveVolume(this),
        rate: state.rate,
        loop: nativeMedia.loopGet.call(this),
      });
      dispatch(this, "play");
      dispatch(this, "playing");
    }
    return Promise.resolve();
  };
  proto.pause = function (this: HTMLMediaElement) {
    const state = stateFor(this);
    if (state.playing) {
      state.offset = positionOf(this, state);
      state.playing = false;
      log(this, state, "pause", { position: state.offset });
      dispatch(this, "timeupdate");
      dispatch(this, "pause");
    }
  };
  proto.load = function (this: HTMLMediaElement) {
    const state = stateFor(this);
    stopForLoad(this, state);
    state.src = nativeMedia.srcGet.call(this) || "";
    log(this, state, "src");
    return nativeMedia.load.call(this);
  };
  Object.defineProperty(proto, "currentTime", {
    configurable: true,
    get(this: HTMLMediaElement) {
      return positionOf(this, stateFor(this));
    },
    set(this: HTMLMediaElement, value: number) {
      const state = stateFor(this);
      const target = Math.max(0, Number(value) || 0);
      state.offset = target;
      state.startAt = now;
      log(this, state, "seek", { position: target });
      if (state.kind === "video") {
        state.seekPending = true;
        try {
          nativeMedia.currentTimeSet.call(this, target);
        } catch {
          state.seekPending = false;
        }
      } else {
        dispatch(this, "seeking");
        dispatch(this, "timeupdate");
        dispatch(this, "seeked");
      }
    },
  });
  Object.defineProperty(proto, "paused", {
    configurable: true,
    get(this: HTMLMediaElement) {
      return !stateFor(this).playing;
    },
  });
  Object.defineProperty(proto, "ended", {
    configurable: true,
    get(this: HTMLMediaElement) {
      const state = stateFor(this);
      const duration = durationOf(this, state);
      return (
        Number.isFinite(duration) &&
        !nativeMedia.loopGet.call(this) &&
        rawPosition(state) >= duration
      );
    },
  });
  Object.defineProperty(proto, "duration", {
    configurable: true,
    get(this: HTMLMediaElement) {
      return durationOf(this, stateFor(this));
    },
  });
  Object.defineProperty(proto, "volume", {
    configurable: true,
    get(this: HTMLMediaElement) {
      return nativeMedia.volumeGet.call(this);
    },
    set(this: HTMLMediaElement, value: number) {
      nativeMedia.volumeSet.call(this, value);
      const state = stateFor(this);
      log(this, state, "volume", { value: effectiveVolume(this) });
      dispatch(this, "volumechange");
    },
  });
  Object.defineProperty(proto, "muted", {
    configurable: true,
    get(this: HTMLMediaElement) {
      return nativeMedia.mutedGet.call(this);
    },
    set(this: HTMLMediaElement, value: boolean) {
      nativeMedia.mutedSet.call(this, value);
      const state = stateFor(this);
      log(this, state, "volume", { value: effectiveVolume(this) });
      dispatch(this, "volumechange");
    },
  });
  Object.defineProperty(proto, "loop", {
    configurable: true,
    get(this: HTMLMediaElement) {
      return nativeMedia.loopGet.call(this);
    },
    set(this: HTMLMediaElement, value: boolean) {
      nativeMedia.loopSet.call(this, value);
      const state = stateFor(this);
      log(this, state, "loop", { loop: !!value });
    },
  });
  Object.defineProperty(proto, "playbackRate", {
    configurable: true,
    get(this: HTMLMediaElement) {
      return stateFor(this).rate;
    },
    set(this: HTMLMediaElement, value: number) {
      const state = stateFor(this);
      const rate = Math.max(0.0625, Math.min(16, Number(value) || 1));
      state.offset = positionOf(this, state);
      state.startAt = now;
      state.rate = rate;
      try {
        nativeMedia.rateSet.call(this, rate);
      } catch {
        /* the native element is never played */
      }
      log(this, state, "rate", { rate, position: state.offset });
      dispatch(this, "ratechange");
    },
  });
  Object.defineProperty(proto, "src", {
    configurable: true,
    get(this: HTMLMediaElement) {
      return nativeMedia.srcGet.call(this);
    },
    set(this: HTMLMediaElement, value: string) {
      setSource(this, value);
      nativeMedia.srcSet.call(this, value);
    },
  });
  proto.setAttribute = function (
    this: HTMLMediaElement,
    name: string,
    value: string,
  ) {
    if (String(name).toLowerCase() === "src") setSource(this, value);
    return nativeMedia.setAttribute.call(this, name, value);
  };
  proto.removeAttribute = function (this: HTMLMediaElement, name: string) {
    if (String(name).toLowerCase() === "src") {
      const state = stateFor(this);
      stopForLoad(this, state);
      state.src = "";
      log(this, state, "src");
    }
    return nativeMedia.removeAttribute.call(this, name);
  };
  // `new Audio(src)` sets the attribute natively; route it through the virtual setter instead.
  const NativeAudio = native.Audio;
  const VirtualAudio = function Audio(this: unknown, src?: string) {
    const element = new NativeAudio();
    if (src !== undefined) element.src = src;
    return element;
  } as unknown as typeof Audio;
  VirtualAudio.prototype = NativeAudio.prototype;
  win.Audio = VirtualAudio;
  // Markup <audio>/<video> elements never pass through the setters; adopt them when first seen.
  const adoptMarkupMedia = () => {
    for (const element of Array.from(
      document.querySelectorAll<HTMLMediaElement>("audio, video"),
    )) {
      if (mediaStates.has(element)) continue;
      const state = stateFor(element);
      state.src = nativeMedia.srcGet.call(element) || element.currentSrc || "";
      if (element.hasAttribute("autoplay")) void element.play();
    }
  };
  const stepMedia = () => {
    adoptMarkupMedia();
    for (const element of mediaRegistry) {
      const state = mediaStates.get(element)!;
      // Nothing may really play; a native autoplay would desynchronise the mix.
      if (!nativeMedia.paused.call(element)) nativeMedia.pause.call(element);
      const mediaError = nativeMedia.error.call(element);
      if (mediaError && !state.error && state.src) {
        state.error = `media error ${mediaError.code}`;
        log(element, state, "error", { value: mediaError.code });
      }
      if (state.playing) {
        const duration = durationOf(element, state);
        const position = rawPosition(state);
        if (
          Number.isFinite(duration) &&
          !nativeMedia.loopGet.call(element) &&
          position >= duration
        ) {
          state.playing = false;
          state.offset = duration;
          log(element, state, "ended", { position: duration });
          dispatch(element, "timeupdate");
          dispatch(element, "pause");
          dispatch(element, "ended");
        } else if (now - state.lastTimeUpdate >= 250) {
          state.lastTimeUpdate = now;
          dispatch(element, "timeupdate");
        }
      }
      if (
        state.kind === "video" &&
        state.src &&
        !mediaError &&
        nativeMedia.readyState.call(element) >= 1
      ) {
        const target = positionOf(element, state);
        const current = nativeMedia.currentTimeGet.call(element);
        if (Math.abs(current - target) > 0.001) {
          state.seekPending = true;
          try {
            nativeMedia.currentTimeSet.call(element, target);
          } catch {
            state.seekPending = false;
          }
        }
      }
    }
  };

  /* ---------- animations ---------- */
  interface TrackedAnimation {
    /** Virtual start time in ms, or null when the page itself holds the animation paused. */
    start: number | null;
  }
  const tracked = new Map<Animation, TrackedAnimation>();
  const numeric = (value: CSSNumberish | null | undefined): number =>
    typeof value === "number" ? value : 0;
  const stepAnimations = async () => {
    for (let round = 0; round < 4; round++) {
      let changed = false;
      const list = document.getAnimations();
      const seen = new Set(list);
      for (const animation of list) {
        let info = tracked.get(animation);
        const state = animation.playState;
        if (!info) {
          if (state === "paused" || state === "idle" || state === "finished") {
            tracked.set(animation, { start: null });
            continue;
          }
          const rate = animation.playbackRate || 1;
          info = { start: now - numeric(animation.currentTime) / rate };
          tracked.set(animation, info);
          try {
            animation.pause();
          } catch (error) {
            report(error);
          }
          changed = true;
        }
        if (info.start === null) continue;
        if (state === "idle") {
          tracked.delete(animation);
          continue;
        }
        if (state === "finished") continue;
        try {
          if (state === "running") animation.pause();
          const rate = animation.playbackRate || 1;
          const timing = animation.effect?.getComputedTiming();
          const endTime = timing?.endTime;
          const end = typeof endTime === "number" ? endTime : Infinity;
          const elapsed = (now - info.start) * rate;
          if (rate > 0 && Number.isFinite(end) && elapsed >= end) {
            animation.currentTime = end;
            animation.finish();
            changed = true;
          } else animation.currentTime = Math.max(0, elapsed);
        } catch (error) {
          report(error);
        }
      }
      for (const animation of tracked.keys())
        if (!seen.has(animation)) tracked.delete(animation);
      if (!changed) break;
      await yieldTask(); // finished promises resolve before dependants are measured
    }
  };

  /* ---------- settle: wait (in real time) for loads the page started ---------- */
  const pendingReasons = (): string[] => {
    const reasons: string[] = [];
    let loading = 0;
    for (const image of pendingImages)
      if (image.complete) pendingImages.delete(image);
      else loading++;
    for (const image of Array.from(document.images)) {
      if (!image.complete) loading++;
      else if (
        image.naturalWidth > 0 &&
        decodedSource.get(image) !== image.currentSrc
      ) {
        decodedSource.set(image, image.currentSrc);
        trackDecode(imageDecode.call(image).catch(() => undefined));
      }
    }
    if (loading) reasons.push(`${loading} image(s) loading`);
    if (pendingFetches) reasons.push(`${pendingFetches} fetch(es)`);
    if (pendingDecodes) reasons.push(`${pendingDecodes} image decode(s)`);
    let metadata = 0;
    let seeks = 0;
    for (const element of mediaRegistry) {
      const state = mediaStates.get(element)!;
      if (!state.src) continue;
      if (nativeMedia.error.call(element)) continue;
      if (nativeMedia.readyState.call(element) < 1) metadata++;
      else if (state.seekPending) seeks++;
    }
    if (metadata) reasons.push(`${metadata} media metadata`);
    if (seeks) reasons.push(`${seeks} video seek(s)`);
    return reasons;
  };
  const settle = async (capMs: number) => {
    const started = native.performanceNow();
    let stable = 0;
    let pending: string[] = [];
    for (;;) {
      pending = pendingReasons();
      if (!pending.length) {
        if (++stable >= 2)
          return {
            settled: true,
            waited: native.performanceNow() - started,
            pending,
          };
      } else stable = 0;
      if (native.performanceNow() - started > capMs)
        return {
          settled: false,
          waited: native.performanceNow() - started,
          pending,
        };
      await new Promise<void>((resolve) =>
        native.setTimeout(resolve, pending.length ? 4 : 0),
      );
    }
  };

  const status = (): RecordingStatus => {
    try {
      const player = (
        win as unknown as {
          FramePlayer?: { getRecording?: () => RecordingStatus };
        }
      ).FramePlayer;
      const recording = player?.getRecording?.();
      if (recording && typeof recording.status === "string") return recording;
    } catch (error) {
      report(error);
    }
    const flag = document.documentElement.dataset.recording;
    if (flag === "done" || flag === "error") return { status: flag };
    return { status: "unknown" };
  };

  /* ---------- one frame ---------- */
  const step = async (deltaMs: number, settleCapMs: number): Promise<StepResult> => {
    const target = now + deltaMs;
    let timersRun = 0;
    for (;;) {
      let next: Timer | null = null;
      for (const timer of timers.values())
        if (
          timer.time <= target &&
          (!next ||
            timer.time < next.time ||
            (timer.time === next.time && timer.seq < next.seq))
        )
          next = timer;
      if (!next) break;
      if (++timersRun > maxTimers) {
        report(new Error("Too many timers in one frame; a busy loop was cut short."));
        break;
      }
      now = Math.max(now, next.time);
      if (next.interval === null) timers.delete(next.id);
      else {
        next.time = now + next.interval;
        next.seq = seq++;
      }
      try {
        next.fn(...next.args);
      } catch (error) {
        report(error);
      }
      await yieldTask();
    }
    now = target;
    const callbacks = frameCallbacks;
    frameCallbacks = new Map();
    for (const callback of callbacks.values()) {
      try {
        callback(now);
      } catch (error) {
        report(error);
      }
    }
    await yieldTask();
    await stepAnimations();
    stepMedia();
    const idle = Array.from(idleCallbacks.values());
    idleCallbacks.clear();
    for (const callback of idle) {
      try {
        callback({ didTimeout: false, timeRemaining: () => 50 });
      } catch (error) {
        report(error);
      }
    }
    await yieldTask();
    await stepAnimations();
    const settled = await settle(settleCapMs);
    // Loads that finished during the wait may have started animations; place them at this frame.
    await stepAnimations();
    const result: StepResult = {
      now,
      timersRun,
      pendingTimers: timers.size,
      animations: tracked.size,
      media: mediaRegistry.size,
      settled: settled.settled,
      waited: settled.waited,
      pending: settled.pending,
      recording: status(),
      errors: errors.splice(0, errors.length),
    };
    return result;
  };

  const api: VirtualClockApi = {
    step,
    settle,
    now: () => now,
    getAudioLog: () => audioLog.slice(),
    getSource: (key) => dataSources.get(key) ?? null,
    status,
    debug: () => {
      const animations: Record<string, number> = {};
      for (const animation of document.getAnimations()) {
        const label = `${animation.playState}${tracked.get(animation)?.start === null ? ":held" : ""}`;
        animations[label] = (animations[label] ?? 0) + 1;
      }
      return {
        now,
        timers: Array.from(timers.values())
          .sort((a, b) => a.time - b.time)
          .slice(0, 30)
          .map((timer) => ({ in: timer.time - now, interval: timer.interval })),
        frameCallbacks: frameCallbacks.size,
        idleCallbacks: idleCallbacks.size,
        animations,
        media: Array.from(mediaRegistry).map((element) => {
          const state = mediaStates.get(element)!;
          return {
            id: state.id,
            kind: state.kind,
            playing: state.playing,
            readyState: nativeMedia.readyState.call(element),
            position: positionOf(element, state),
            key: keyFor(state.src).slice(0, 40),
          };
        }),
      };
    },
  };
  Object.defineProperty(win, "__frameClock", {
    value: Object.freeze(api),
    configurable: false,
    writable: false,
  });
}
