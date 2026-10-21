import type { Character, Pose } from '../engine/types'
import { createSpriteRuntime, type SpriteRuntime, type SpriteStatus } from './runtime/spriteRuntime.js'

export interface PortraitSettings {
  blink: boolean
  breathing: boolean
  life: boolean
  head: boolean
  gaze: boolean
  secondary: boolean
  lighting: boolean
  mouth: boolean
  brow: number | null
  volume: number
  speed: number
}

export const DEFAULT_PORTRAIT_SETTINGS: PortraitSettings = {
  blink: true, breathing: true, life: true, head: true, gaze: true,
  secondary: true, lighting: false, mouth: true, brow: null, volume: 0.8, speed: 1,
}

export type MouthShape = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'X'
export interface PortraitStatus extends SpriteStatus {
  renderer: 'rigged' | 'image'
  playing: boolean
  duration: number
  position: number
  error: string | null
}

export interface PortraitController {
  readonly ready: Promise<boolean>
  readonly audio: HTMLAudioElement
  update(settings: Partial<PortraitSettings>): void
  play(src: string, cueUrl?: string): Promise<void>
  /**
   * Lip-syncs to audio someone else plays, e.g. a story player that keeps one voice line going
   * while the character morphs between expressions. `src` identifies the line for its cues.
   */
  follow(audio: HTMLAudioElement, src: string, cueUrl?: string): void
  stop(): void
  triggerBlink(): boolean
  setMouthShape(shape: MouthShape | null): void
  getStatus(): PortraitStatus
  dispose(): void
}

/**
 * One portrait, one clock, one lifecycle. Multiple controllers can coexist on a stage.
 * Prepared facial artwork is pose-specific; an unrigged image stays visually complete.
 */
export function createPortraitController(
  element: HTMLElement,
  options: { character: Character; pose: Pose; settings?: Partial<PortraitSettings>; resolveAsset?: (url: string) => string },
): PortraitController {
  const { character, pose } = options
  const resolveAsset = options.resolveAsset || ((url: string) => url)
  let settings = { ...DEFAULT_PORTRAIT_SETTINGS, ...options.settings }
  let disposed = false
  let runtime: SpriteRuntime | undefined
  let error: string | null = null
  let playGeneration = 0
  let fallbackMotion: Animation | undefined
  let following: HTMLAudioElement | undefined
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  const layer = document.createElement('div')
  layer.className = 'vne-portrait-layer'
  layer.dataset.vnLipsyncScene = 'studio'
  layer.dataset.vnLipsyncCharacter = character.id
  layer.dataset.vnLipsyncDialogue = '0'
  layer.dataset.vnPoseKey = pose.animation?.poseKey || pose.id
  Object.assign(layer.style, { position: 'relative', width: '100%', height: '100%', pointerEvents: 'none' })
  const image = document.createElement('img')
  image.className = 'vne-portrait-image'
  image.alt = `${character.name} — ${pose.name}`
  image.draggable = false
  Object.assign(image.style, { display: 'block', width: '100%', height: '100%', objectFit: 'contain', transformOrigin: '50% 100%' })
  const canvas = document.createElement('canvas')
  canvas.className = 'vne-portrait-canvas'
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, { position: 'absolute', inset: '0 auto auto 0', visibility: 'hidden', pointerEvents: 'none' })
  layer.append(image, canvas)
  element.append(layer)
  const audio = new Audio()
  audio.preload = 'auto'

  function syncFallbackMotion() {
    if (runtime || disposed) return
    const moving = settings.breathing && !motionQuery.matches && !document.hidden
    if (!moving) { fallbackMotion?.cancel(); fallbackMotion = undefined; return }
    if (!fallbackMotion && typeof image.animate === 'function') {
      fallbackMotion = image.animate([
        { transform: 'scale(1, 1)' },
        { transform: 'scale(1.003, 1.005)', offset: 0.4 },
        { transform: 'scale(1, 1)' },
      ], { duration: 5000, iterations: Infinity, easing: 'ease-in-out' })
    }
  }

  function update(patch: Partial<PortraitSettings>) {
    if (disposed) return
    settings = { ...settings, ...patch }
    audio.volume = Math.max(0, Math.min(1, settings.volume))
    // Loading a new src resets playbackRate to defaultPlaybackRate, so set both.
    audio.defaultPlaybackRate = audio.playbackRate = Math.max(0.25, Math.min(2, settings.speed))
    runtime?.setBlinkEnabled(settings.blink)
    runtime?.setBreathingEnabled(settings.breathing)
    runtime?.setLifeEnabled(settings.life)
    runtime?.setMotionEnabled({ head: settings.head, gaze: settings.gaze, secondary: settings.secondary })
    runtime?.setLightingEnabled(settings.lighting)
    runtime?.setMouthAnimationOverride(settings.mouth)
    runtime?.setBrowOverride(settings.brow)
    syncFallbackMotion()
  }

  if (pose.animation) {
    runtime = createSpriteRuntime({ ...pose.animation, element: layer, resolveAsset })
  }
  update(settings)

  let settleLoaded: (value: boolean) => void = () => {}
  const loaded = new Promise<boolean>(resolve => {
    settleLoaded = resolve
    image.onload = () => resolve(true)
    image.onerror = () => { error = `Portrait unavailable: ${pose.name}`; resolve(false) }
    image.src = resolveAsset(pose.src)
  })
  const ready = loaded.then(async loadedSuccessfully => {
    if (disposed || !loadedSuccessfully) return false
    if (!runtime) return true
    runtime.refresh()
    const ready = await runtime.whenReady(15_000)
    if (!ready && !disposed) error = 'The portrait is visible; its animation pack could not be prepared.'
    return ready && !disposed
  })

  function stop() {
    playGeneration += 1
    following = undefined
    audio.pause()
    if (Number.isFinite(audio.duration)) audio.currentTime = 0
    runtime?.stop()
  }
  function ended() { runtime?.stop() }
  function playbackError() { error = 'The recording could not be loaded.'; runtime?.stop() }
  audio.addEventListener('ended', ended)
  audio.addEventListener('error', playbackError)
  document.addEventListener('visibilitychange', syncFallbackMotion)
  motionQuery.addEventListener('change', syncFallbackMotion)

  return {
    ready,
    audio,
    update,
    async play(src, cueUrl) {
      if (disposed) return
      stop()
      const generation = playGeneration
      error = null
      audio.src = resolveAsset(src)
      runtime?.setMouthShape(null)
      try {
        // Invoke play directly from the user gesture; awaiting asset preparation here loses autoplay permission.
        await audio.play()
        if (disposed || generation !== playGeneration) return
        runtime?.start({
          playing: () => !audio.paused && !audio.ended,
          seek: () => audio.currentTime,
          volume: () => audio.muted ? 0 : audio.volume,
        }, 0, src, { scene: 'studio', character: character.id, dialogue: 0 }, cueUrl)
      } catch (reason) {
        if (disposed || generation !== playGeneration) return
        error = reason instanceof Error ? reason.message : 'Audio playback was blocked.'
        throw reason
      }
    },
    follow(external, src, cueUrl) {
      if (disposed) return
      stop()
      error = null
      following = external
      runtime?.setMouthShape(null)
      runtime?.start({
        playing: () => !external.paused && !external.ended,
        seek: () => external.currentTime,
        volume: () => external.muted ? 0 : external.volume,
      }, 0, src, { scene: 'studio', character: character.id, dialogue: 0 }, cueUrl)
    },
    stop,
    triggerBlink: () => !disposed && !!runtime?.triggerBlink(),
    // The approved seven-shape library has no separate G/H textures. Inspection uses explicit nearest-shape aliases.
    setMouthShape: shape => { if (!disposed) runtime?.setMouthShape(shape === 'G' ? 'B' : shape === 'H' ? 'C' : shape) },
    getStatus() {
      const clock = following || audio
      const state = runtime?.getStatus() || {
        state: disposed ? 'disposed' : 'static', shape: 'X', active: !clock.paused,
        baseReady: image.complete && image.naturalWidth > 0, mouthEnabled: false, blinkReady: false,
        blinkClosure: 0, blinkPhase: 'open', performanceReady: false, gazeReady: false, browsReady: false,
        speechState: 'unavailable',
      }
      return {
        ...state,
        renderer: runtime ? 'rigged' : 'image',
        playing: !clock.paused && !clock.ended,
        position: clock.currentTime || 0,
        duration: Number.isFinite(clock.duration) ? clock.duration : 0,
        error,
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      stop()
      runtime?.dispose()
      fallbackMotion?.cancel()
      settleLoaded(false)
      image.onload = image.onerror = null
      audio.removeEventListener('ended', ended)
      audio.removeEventListener('error', playbackError)
      audio.removeAttribute('src')
      audio.load()
      document.removeEventListener('visibilitychange', syncFallbackMotion)
      motionQuery.removeEventListener('change', syncFallbackMotion)
      layer.remove()
    },
  }
}
