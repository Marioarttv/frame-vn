import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleAlert,
  Clapperboard,
  Download,
  LoaderCircle,
  X,
} from "lucide-react";
import type { Project } from "../engine/types";
import {
  DEFAULT_ROUTE_OPTIONS,
  planRoute,
  routeChoices,
  type RoutePlan,
} from "../engine/route";
import { fileSlug, studioExportOptions } from "../studio/media";
import { getHealth } from "./VoiceWorkbench";
import "./render-dialog.css";

interface Props {
  project: Project;
  startNodeId?: string;
  onClose: () => void;
  onNotice: (message: string) => void;
}

interface RenderJob {
  id: string;
  status: "queued" | "rendering" | "encoding" | "done" | "error" | "cancelled";
  title: string;
  width: number;
  height: number;
  fps: number;
  frame: number;
  seconds: number;
  scene: number;
  speed: number;
  elapsed: number;
  message?: string;
  warnings: string[];
  bytes?: number;
  position?: number;
}

type Resolution = "720p" | "1080p";
type Pacing = "brisk" | "normal" | "relaxed";

const RESOLUTIONS: Record<Resolution, { width: number; height: number }> = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
};
const PACING: Record<Pacing, { linePause: number; choicePause: number; label: string }> = {
  brisk: { linePause: 400, choicePause: 1500, label: "Brisk" },
  normal: {
    linePause: DEFAULT_ROUTE_OPTIONS.linePause,
    choicePause: DEFAULT_ROUTE_OPTIONS.choicePause,
    label: "Normal",
  },
  relaxed: { linePause: 1600, choicePause: 3000, label: "Relaxed" },
};
const TITLE_CARD_MS = 2500;
const POLL_MS = 600;

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function errorMessage(data: unknown, fallback: string): string {
  const error = (data as { error?: { message?: string } | string })?.error;
  if (typeof error === "string") return error;
  return error?.message || fallback;
}

/** POSTs with the session token, retrying once with a fresh token after a server restart. */
async function authorizedPost(url: string, init: RequestInit): Promise<Response> {
  const send = async (token: string) =>
    fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), "X-Studio-Token": token },
    });
  let response = await send((await getHealth()).sessionToken);
  if (response.status === 403) {
    const data = await response.clone().json().catch(() => null);
    if (data?.error?.code === "invalid_token")
      response = await send((await getHealth(true)).sessionToken);
  }
  return response;
}

function sceneLabel(project: Project, nodeId: string): string {
  const node = project.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return nodeId;
  const speaker =
    node.speaker ||
    project.characters.find((item) => item.id === node.characterId)?.name;
  const excerpt = node.text.replace(/\s+/g, " ").trim().slice(0, 48);
  return node.label || (speaker ? `${speaker}: ${excerpt}` : excerpt) || nodeId;
}

export function RenderDialog({ project, startNodeId, onClose, onNotice }: Props) {
  const modal = useRef<HTMLDivElement>(null);
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
  const scenes = useMemo(
    () => project.nodes.filter((node) => node.type !== "branch"),
    [project.nodes],
  );
  const [start, setStart] = useState(() =>
    startNodeId && scenes.some((node) => node.id === startNodeId)
      ? startNodeId
      : project.startNodeId,
  );
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [resolution, setResolution] = useState<Resolution>("720p");
  const [fps, setFps] = useState<30 | 60>(30);
  const [pacing, setPacing] = useState<Pacing>("normal");
  const [titleCard, setTitleCard] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [job, setJob] = useState<RenderJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estimateMs, setEstimateMs] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const plan: RoutePlan = useMemo(
    () =>
      planRoute(project, start, choices, {
        linePause: PACING[pacing].linePause,
        choicePause: PACING[pacing].choicePause,
        titleCard: titleCard ? TITLE_CARD_MS : 0,
      }),
    [project, start, choices, pacing, titleCard],
  );
  const busy =
    preparing ||
    (!!job && ["queued", "rendering", "encoding"].includes(job.status));

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    modal.current?.querySelector<HTMLElement>("select, button")?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeHandler.current();
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
      previous?.focus();
    };
  }, []);

  // A render started earlier (or from another dialog) keeps reporting here.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/render")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { jobs?: RenderJob[] } | null) => {
        if (cancelled || !data?.jobs?.length) return;
        const active = data.jobs.find((item) =>
          ["queued", "rendering", "encoding"].includes(item.status),
        );
        if (active) {
          setJob(active);
          setStartedAt(Date.now() - active.elapsed * 1000);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!job || !["queued", "rendering", "encoding"].includes(job.status)) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/render/${job.id}`);
        if (!response.ok) {
          if (response.status === 404) {
            setError("The render was removed from the server.");
            setJob(null);
          }
          return;
        }
        const next = (await response.json()) as RenderJob;
        if (cancelled) return;
        setJob(next);
        if (next.status === "done") onNotice("Video rendered. Download it or preview it below.");
        else if (next.status === "error") setError(next.message || "The render failed.");
      } catch {
        /* The server may be restarting; keep polling. */
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [job?.id, job?.status, onNotice]);

  const render = useCallback(async () => {
    setError(null);
    setPreparing(true);
    setJob(null);
    try {
      const { exportRecordingHtml } = await import("../engine/export");
      const html = await exportRecordingHtml(
        project,
        {
          startNodeId: start,
          route: routeChoices(plan),
          titleCard: titleCard ? TITLE_CARD_MS : 0,
          linePause: PACING[pacing].linePause,
          choicePause: PACING[pacing].choicePause,
          // A looping route stops where the plan said it would.
          maxScenes:
            plan.stoppedBy === "ending"
              ? DEFAULT_ROUTE_OPTIONS.maxScenes
              : Math.max(1, plan.steps.length),
        },
        studioExportOptions,
      );
      const size = RESOLUTIONS[resolution];
      const query = new URLSearchParams({
        width: String(size.width),
        height: String(size.height),
        fps: String(fps),
        title: project.title || "story",
      });
      const response = await authorizedPost(`/api/render?${query}`, {
        method: "POST",
        headers: { "Content-Type": "text/html" },
        body: html,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(data, "The render could not start."));
      setEstimateMs(plan.estimatedMs);
      setStartedAt(Date.now());
      setJob(data as RenderJob);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The recording could not be prepared.",
      );
    } finally {
      setPreparing(false);
    }
  }, [project, start, plan, titleCard, pacing, resolution, fps]);

  const cancel = useCallback(async () => {
    if (!job) return;
    setCancelling(true);
    try {
      const response = await authorizedPost(`/api/render/${job.id}/cancel`, {
        method: "POST",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(data, "Cancel failed."));
      setJob(data as RenderJob);
      onNotice("Render cancelled.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Cancel failed.");
    } finally {
      setCancelling(false);
    }
  }, [job, onNotice]);

  const estimatedFrames =
    job && estimateMs ? Math.max(1, (estimateMs / 1000) * job.fps) : null;
  const fraction =
    job?.status === "done"
      ? 1
      : job && estimatedFrames
        ? Math.min(0.98, job.frame / estimatedFrames)
        : 0;
  const elapsedMs =
    job && startedAt ? Date.now() - startedAt : job ? job.elapsed * 1000 : 0;
  const etaMs =
    job && estimatedFrames && job.speed > 0 && job.status === "rendering"
      ? Math.max(0, ((estimatedFrames - job.frame) / job.speed) * 1000)
      : null;
  const videoUrl = job?.status === "done" ? `/api/render/${job.id}/video` : null;
  const downloadName = `${fileSlug(project.title)}.mp4`;

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={modal}
        className="modal render-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="render-dialog-title"
      >
        <button className="modal-close icon-button" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
        <div className="eyebrow">VIDEO EXPORT</div>
        <h2 id="render-dialog-title">Record a playthrough</h2>
        <p>
          The story plays one route by itself and is rendered frame by frame into an MP4 with
          voices, music and effects. Choose where it starts and which path it takes.
        </p>

        <div className="render-grid">
          <label className="form-field">
            <span>Start scene</span>
            <select value={start} disabled={busy} onChange={(event) => setStart(event.target.value)}>
              {scenes.map((node) => (
                <option key={node.id} value={node.id}>
                  {sceneLabel(project, node.id)}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Pacing</span>
            <select
              value={pacing}
              disabled={busy}
              onChange={(event) => setPacing(event.target.value as Pacing)}
            >
              {(Object.keys(PACING) as Pacing[]).map((key) => (
                <option key={key} value={key}>
                  {PACING[key].label} · {PACING[key].linePause / 1000}s after each line
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Resolution</span>
            <select
              value={resolution}
              disabled={busy}
              onChange={(event) => setResolution(event.target.value as Resolution)}
            >
              <option value="720p">720p · 1280 × 720</option>
              <option value="1080p">1080p · 1920 × 1080</option>
            </select>
          </label>
          <label className="form-field">
            <span>Frame rate</span>
            <select
              value={fps}
              disabled={busy}
              onChange={(event) => setFps(Number(event.target.value) as 30 | 60)}
            >
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>
          </label>
        </div>
        <label className="render-check">
          <input
            type="checkbox"
            checked={titleCard}
            disabled={busy}
            onChange={(event) => setTitleCard(event.target.checked)}
          />
          Open with a title card ({TITLE_CARD_MS / 1000}s)
        </label>

        <div className="render-choices" aria-label="Route">
          <div className="render-choices-title">Route</div>
          {plan.choices.length ? (
            plan.choices.map((point) => (
              <label key={point.nodeId} className="render-choice">
                <span title={point.label}>
                  {point.label}
                  <small>Choice scene</small>
                </span>
                <select
                  value={point.selectedId}
                  disabled={busy}
                  onChange={(event) =>
                    setChoices((current) => ({ ...current, [point.nodeId]: event.target.value }))
                  }
                >
                  {point.options.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.text || "Continue"}
                    </option>
                  ))}
                </select>
              </label>
            ))
          ) : (
            <span className="render-empty-choices">
              No choices on this path; the story plays straight through.
            </span>
          )}
        </div>

        <div className="render-summary">
          <span>
            <strong>{plan.steps.length}</strong> scene{plan.steps.length === 1 ? "" : "s"}
          </span>
          <span>
            about <strong>{formatDuration(plan.estimatedMs)}</strong>
          </span>
          <span>
            ends at{" "}
            <strong>
              {plan.steps.length ? sceneLabel(project, plan.steps[plan.steps.length - 1].nodeId) : "—"}
            </strong>
          </span>
          {plan.stoppedBy !== "ending" && (
            <span className="render-stop">
              {plan.message ||
                (plan.stoppedBy === "maxScenes"
                  ? "The scene limit was reached before an ending."
                  : "The route does not reach an ending.")}
            </span>
          )}
        </div>

        {(job || preparing) && (
          <div className="render-progress" aria-live="polite">
            <div className="render-progress-head">
              <strong>
                {(preparing || (job && ["queued", "rendering", "encoding"].includes(job.status))) && (
                  <LoaderCircle size={14} className="spin" />
                )}
                {preparing
                  ? "Preparing the recording…"
                  : job?.status === "queued"
                    ? `Waiting for another render${job.position ? ` (${job.position} ahead)` : ""}…`
                    : job?.status === "rendering"
                      ? "Rendering frames…"
                      : job?.status === "encoding"
                        ? "Mixing audio and encoding…"
                        : job?.status === "done"
                          ? "Video ready"
                          : job?.status === "cancelled"
                            ? "Cancelled"
                            : "Render failed"}
              </strong>
              {job && job.status !== "queued" && <span>{formatDuration(job.seconds * 1000)} rendered</span>}
            </div>
            <div
              className={`render-bar${preparing || job?.status === "queued" || job?.status === "encoding" ? " is-indeterminate" : ""}`}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(fraction * 100)}
            >
              <span style={{ width: `${Math.round(fraction * 100)}%` }} />
            </div>
            {job && (
              <div className="render-meta">
                <span>
                  <b>{job.width}×{job.height}</b> · {job.fps} fps
                </span>
                {job.frame > 0 && (
                  <span>
                    frame <b>{job.frame}</b>
                  </span>
                )}
                {job.scene > 0 && (
                  <span>
                    scene <b>{job.scene}</b>
                  </span>
                )}
                {job.speed > 0 && job.status === "rendering" && (
                  <span>
                    <b>{job.speed.toFixed(1)}</b> frames/s
                  </span>
                )}
                <span>
                  elapsed <b>{formatDuration(elapsedMs)}</b>
                </span>
                {etaMs !== null && (
                  <span>
                    about <b>{formatDuration(etaMs)}</b> left
                  </span>
                )}
                {job.bytes !== undefined && (
                  <span>
                    <b>{formatBytes(job.bytes)}</b>
                  </span>
                )}
              </div>
            )}
            {videoUrl && (
              <video className="render-video" src={videoUrl} controls playsInline preload="metadata" />
            )}
            {job && job.warnings.length > 0 && (
              <ul className="render-warnings">
                {job.warnings.slice(0, 8).map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && (
          <div className="render-error" role="alert">
            <CircleAlert size={15} />
            <span>{error}</span>
          </div>
        )}

        <div className="modal-footer">
          <span className="render-footnote">
            Rendered on this machine with headless Chromium and FFmpeg. Finished videos are kept in
            .studio/renders.
          </span>
          {job && ["queued", "rendering", "encoding"].includes(job.status) ? (
            <button className="button" onClick={cancel} disabled={cancelling}>
              {cancelling ? <LoaderCircle size={15} className="spin" /> : <X size={15} />}
              Cancel render
            </button>
          ) : (
            <button className="button" onClick={onClose}>
              Close
            </button>
          )}
          {videoUrl && (
            <a className="button primary" href={videoUrl} download={downloadName}>
              <Download size={15} /> Download MP4
            </a>
          )}
          {!videoUrl && (
            <button
              className="button primary"
              onClick={render}
              disabled={busy || plan.steps.length === 0}
            >
              {preparing ? <LoaderCircle size={15} className="spin" /> : <Clapperboard size={15} />}
              {job && ["rendering", "encoding", "queued"].includes(job.status)
                ? "Rendering…"
                : "Render video"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default RenderDialog;
