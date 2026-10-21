import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createPortraitController } from "../animation/controller";
import type { Character, Pose } from "../engine/types";
import { resolveAssetUrl } from "../engine/asset-urls";

export interface MotionSettings {
  blink: boolean;
  breathing: boolean;
  life: boolean;
  head: boolean;
  gaze: boolean;
  secondary: boolean;
  lighting: boolean;
  mouth: boolean;
  brow: number | null;
  volume: number;
}
export const defaultMotion: MotionSettings = {
  blink: true,
  breathing: true,
  life: true,
  head: true,
  gaze: true,
  secondary: true,
  lighting: false,
  mouth: true,
  brow: null,
  volume: 0.8,
};
export interface PortraitHandle {
  blink: () => void;
  mouth: (shape: string | null) => void;
  stop: () => void;
  play: (src: string, cues?: string) => Promise<void>;
  status: () => unknown;
}
interface Props {
  character?: Character;
  pose?: Pose;
  settings?: Partial<MotionSettings>;
  className?: string;
  audioSrc?: string;
  cueUrl?: string;
  playing?: boolean;
  onReady?: (ready: boolean) => void;
  onEnded?: () => void;
}
export const Portrait = forwardRef<PortraitHandle, Props>(function Portrait(
  {
    character,
    pose,
    settings,
    className = "",
    audioSrc,
    cueUrl,
    playing = false,
    onReady,
    onEnded,
  },
  ref,
) {
  const target = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof createPortraitController> | null>(
    null,
  );
  const [error, setError] = useState("");
  const endedHandler = useRef(onEnded);
  endedHandler.current = onEnded;
  const readyHandler = useRef(onReady);
  readyHandler.current = onReady;
  const settingsRef = useRef({ ...defaultMotion, ...settings });
  settingsRef.current = { ...defaultMotion, ...settings };
  useImperativeHandle(
    ref,
    () => ({
      blink: () => controller.current?.triggerBlink(),
      mouth: (shape) =>
        controller.current?.setMouthShape(
          shape as "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "X" | null,
        ),
      stop: () => controller.current?.stop(),
      play: async (src, cues) => {
        await controller.current?.play(src, cues);
      },
      status: () => controller.current?.getStatus(),
    }),
    [],
  );
  useEffect(() => {
    if (!target.current || !character || !pose) return;
    setError("");
    let cancelled = false;
    const instance = createPortraitController(target.current, {
      character,
      pose,
      settings: settingsRef.current,
      resolveAsset: resolveAssetUrl,
    });
    controller.current = instance;
    const ended = () => endedHandler.current?.();
    instance.audio.addEventListener("ended", ended);
    instance.ready
      .then((ready) => {
        if (!cancelled) readyHandler.current?.(ready);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
      instance.audio.removeEventListener("ended", ended);
      instance.dispose();
      if (controller.current === instance) controller.current = null;
    };
  }, [character?.id, pose?.src, pose?.id]);
  useEffect(() => {
    controller.current?.update({ ...defaultMotion, ...settings });
  }, [settings]);
  useEffect(() => {
    const instance = controller.current;
    let cancelled = false;
    if (playing && audioSrc && instance)
      instance.ready
        .then(() => {
          if (!cancelled && controller.current === instance)
            return instance.play(audioSrc, cueUrl);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    else instance?.stop();
    return () => {
      cancelled = true;
      instance?.stop();
    };
  }, [audioSrc, cueUrl, playing, pose?.id, character?.id]);
  return (
    <div className={`portrait ${className}`}>
      <div
        ref={target}
        className="portrait-surface"
        role="img"
        aria-label={
          character
            ? `${character.name}, ${pose?.name || "portrait"}`
            : "Character preview"
        }
      />
      {error && (
        <span className="portrait-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
});
