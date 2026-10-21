export interface SpriteRuntimeOptions {
  element: HTMLElement
  assetRoot: string
  manifestUrl: string
  speechIndexUrl: string
  browsIndexUrl?: string
  lightingUrl?: string
  performanceIndexUrl?: string
  resolveAsset?: (url: string) => string
}

export interface SpriteStatus {
  state: string
  shape: string
  active: boolean
  baseReady: boolean
  mouthEnabled: boolean
  blinkReady: boolean
  blinkClosure: number
  blinkPhase: string
  performanceReady: boolean
  gazeReady: boolean
  browsReady: boolean
  speechState: string
  position?: number
  breathing?: { phase: string; amount: number; cycleMs: number; enabled?: boolean; running?: boolean }
  motion?: { available: boolean; warmed: boolean; disposed: boolean }
  [key: string]: unknown
}

export interface SpriteRuntime {
  refresh(): void
  whenReady(timeout?: number): Promise<boolean>
  dispose(): void
  start(clock: { playing(id?: number): boolean; seek(id?: number): number; volume(): number }, soundId: number, src: string, binding: { character: string; scene: string; dialogue: number }, cueUrl?: string): void
  stop(): void
  triggerBlink(): boolean
  setMouthShape(shape: string | null): void
  setMouthAnimationOverride(value: boolean | null): boolean
  setBlinkEnabled(value: boolean): void
  setBreathingEnabled(value: boolean): void
  setLifeEnabled(value: boolean): void
  setLightingEnabled(value: boolean): void
  setBrowOverride(value: number | null): boolean
  setMotionEnabled(value: { head?: boolean; gaze?: boolean; secondary?: boolean }): void
  getStatus(): SpriteStatus
}

export function createSpriteRuntime(options: SpriteRuntimeOptions): SpriteRuntime

export function blinkSeed(character: string, sequence: number): number
