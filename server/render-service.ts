/**
 * Local video-render API: accepts a recording document, renders it to MP4 in a background job
 * (one at a time), reports progress, streams the result and prunes old renders.
 *
 *   POST /api/render?width=&height=&fps=&title=   body: text/html  → { id, position }
 *   GET  /api/render                              → { jobs: [...] }
 *   GET  /api/render/<id>                         → job status
 *   GET  /api/render/<id>/video                   → the MP4 (Range supported)
 *   POST /api/render/<id>/cancel                  → job status
 *
 * Loopback, Origin and session-token checks happen in server/api.ts before this module is
 * reached. Jobs live on `globalThis` so a Vite config reload keeps running renders visible.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { ApiError } from "./voice-service";
import {
  RenderError,
  renderRecording,
  type RenderProgress,
} from "./render/renderer";

export type RenderJobStatus =
  | "queued"
  | "rendering"
  | "encoding"
  | "done"
  | "error"
  | "cancelled";

export interface RenderJobInfo {
  id: string;
  status: RenderJobStatus;
  title: string;
  width: number;
  height: number;
  fps: number;
  /** Frames captured so far. */
  frame: number;
  /** Virtual seconds rendered so far. */
  seconds: number;
  scene: number;
  nodeId?: string;
  /** Frames rendered per real second. */
  speed: number;
  /** Real seconds since the job started rendering. */
  elapsed: number;
  message?: string;
  warnings: string[];
  bytes?: number;
  createdAt: string;
  finishedAt?: string;
  position?: number;
}

interface RenderJob extends RenderJobInfo {
  htmlPath: string;
  outputPath: string;
  controller: AbortController;
  startedAt?: number;
}

const MAX_BODY_BYTES = 1024 * 1024 * 1024;
const MAX_QUEUE = 3;
const KEEP_FINISHED = 10;
const ALLOWED_FPS = new Set([24, 25, 30, 48, 50, 60]);

function slug(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-")
      .slice(0, 80) || "story"
  );
}

function publicInfo(job: RenderJob, position?: number): RenderJobInfo {
  const info: RenderJobInfo = {
    id: job.id,
    status: job.status,
    title: job.title,
    width: job.width,
    height: job.height,
    fps: job.fps,
    frame: job.frame,
    seconds: job.seconds,
    scene: job.scene,
    nodeId: job.nodeId,
    speed: job.speed,
    elapsed: job.startedAt ? (Date.now() - job.startedAt) / 1000 : 0,
    message: job.message,
    warnings: job.warnings,
    bytes: job.bytes,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
  if (position !== undefined) info.position = position;
  if (job.status === "done" && job.finishedAt && job.startedAt)
    info.elapsed = (new Date(job.finishedAt).getTime() - job.startedAt) / 1000;
  return info;
}

export class RenderService {
  readonly directory: string;
  private readonly jobs = new Map<string, RenderJob>();
  private readonly queue: RenderJob[] = [];
  private active: RenderJob | null = null;
  private ready: Promise<void>;

  constructor(root: string) {
    this.directory = join(root, ".studio", "renders");
    this.ready = this.prepare();
  }

  private async prepare(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    // Leftovers from a previous server process: uploaded documents and scratch directories.
    for (const entry of await readdir(this.directory).catch(() => [] as string[])) {
      if (entry.endsWith(".html") || entry.startsWith("work-"))
        await rm(join(this.directory, entry), { recursive: true, force: true }).catch(
          () => undefined,
        );
    }
    await this.prune();
  }

  private async prune(): Promise<void> {
    const entries = await readdir(this.directory).catch(() => [] as string[]);
    const videos: { name: string; mtime: number }[] = [];
    for (const name of entries) {
      if (!name.endsWith(".mp4")) continue;
      const id = name.slice(0, -4);
      const job = this.jobs.get(id);
      if (job && job.status !== "done" && job.status !== "error" && job.status !== "cancelled")
        continue;
      const info = await stat(join(this.directory, name)).catch(() => null);
      if (info) videos.push({ name, mtime: info.mtimeMs });
    }
    videos.sort((a, b) => b.mtime - a.mtime);
    for (const video of videos.slice(KEEP_FINISHED)) {
      await rm(join(this.directory, video.name), { force: true }).catch(() => undefined);
      this.jobs.delete(video.name.slice(0, -4));
    }
  }

  list(): RenderJobInfo[] {
    return Array.from(this.jobs.values())
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((job) => publicInfo(job, this.positionOf(job)));
  }

  get(id: string): RenderJobInfo {
    const job = this.jobs.get(id);
    if (!job) throw new ApiError(404, "not_found", "This render does not exist.");
    return publicInfo(job, this.positionOf(job));
  }

  private positionOf(job: RenderJob): number | undefined {
    const index = this.queue.indexOf(job);
    return index >= 0 ? index + 1 : undefined;
  }

  videoPath(id: string): string {
    const job = this.jobs.get(id);
    if (!job) throw new ApiError(404, "not_found", "This render does not exist.");
    if (job.status !== "done")
      throw new ApiError(409, "not_ready", "This render is not finished yet.");
    return job.outputPath;
  }

  /** Streams the uploaded document to disk and queues the job. */
  async create(
    request: IncomingMessage,
    options: { width: number; height: number; fps: number; title: string },
  ): Promise<RenderJobInfo> {
    await this.ready;
    if (this.queue.length >= MAX_QUEUE)
      throw new ApiError(
        409,
        "render_busy",
        "A render is already running and the queue is full. Wait for it to finish or cancel it.",
      );
    const id = randomBytes(8).toString("hex");
    const htmlPath = join(this.directory, `${id}.html`);
    let size = 0;
    await new Promise<void>((resolve, reject) => {
      const file = createWriteStream(htmlPath, { mode: 0o600 });
      const fail = (error: Error) => {
        request.unpipe(file);
        file.destroy();
        reject(error);
      };
      request.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES)
          fail(new ApiError(413, "request_too_large", "The recording document exceeds 1 GB."));
      });
      request.on("error", fail);
      request.on("aborted", () =>
        fail(new ApiError(400, "upload_aborted", "The upload was interrupted.")),
      );
      file.on("error", fail);
      file.on("finish", () => resolve());
      request.pipe(file);
    }).catch(async (error) => {
      await rm(htmlPath, { force: true }).catch(() => undefined);
      throw error;
    });
    if (!size) throw new ApiError(400, "empty_document", "Send the recording document as the request body.");
    const job: RenderJob = {
      id,
      status: "queued",
      title: options.title,
      width: options.width,
      height: options.height,
      fps: options.fps,
      frame: 0,
      seconds: 0,
      scene: 0,
      speed: 0,
      elapsed: 0,
      warnings: [],
      createdAt: new Date().toISOString(),
      htmlPath,
      outputPath: join(this.directory, `${id}.mp4`),
      controller: new AbortController(),
    };
    this.jobs.set(id, job);
    this.queue.push(job);
    void this.pump();
    return publicInfo(job, this.positionOf(job));
  }

  cancel(id: string): RenderJobInfo {
    const job = this.jobs.get(id);
    if (!job) throw new ApiError(404, "not_found", "This render does not exist.");
    if (job.status === "queued") {
      this.queue.splice(this.queue.indexOf(job), 1);
      job.status = "cancelled";
      job.message = "Cancelled before rendering started.";
      job.finishedAt = new Date().toISOString();
      void rm(job.htmlPath, { force: true }).catch(() => undefined);
    } else if (job.status === "rendering" || job.status === "encoding") {
      job.controller.abort();
    }
    return publicInfo(job);
  }

  private async pump(): Promise<void> {
    if (this.active) return;
    const job = this.queue.shift();
    if (!job) return;
    this.active = job;
    job.status = "rendering";
    job.startedAt = Date.now();
    const workDir = join(this.directory, `work-${job.id}`);
    try {
      const result = await renderRecording({
        htmlPath: job.htmlPath,
        outputPath: job.outputPath,
        workDir,
        width: job.width,
        height: job.height,
        fps: job.fps,
        signal: job.controller.signal,
        onProgress: (progress: RenderProgress) => {
          job.frame = progress.frame;
          job.seconds = progress.seconds;
          job.scene = progress.scene;
          job.nodeId = progress.nodeId;
          job.speed = progress.speed;
          if (progress.phase === "encoding" || progress.phase === "mixing")
            job.status = "encoding";
        },
      });
      job.status = "done";
      job.bytes = result.bytes;
      job.warnings = result.warnings;
      job.message = result.recording.message;
    } catch (error) {
      await rm(job.outputPath, { force: true }).catch(() => undefined);
      if (job.controller.signal.aborted) {
        job.status = "cancelled";
        job.message = "Render cancelled.";
      } else {
        job.status = "error";
        job.message =
          error instanceof RenderError || error instanceof Error
            ? error.message
            : "The render failed.";
      }
    } finally {
      job.finishedAt = new Date().toISOString();
      await rm(job.htmlPath, { force: true }).catch(() => undefined);
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      this.active = null;
      await this.prune().catch(() => undefined);
      void this.pump();
    }
  }
}

const services = new Map<string, RenderService>();
export function getRenderService(root: string): RenderService {
  const shared = globalThis as unknown as {
    __frameRenderServices?: Map<string, RenderService>;
  };
  const registry = (shared.__frameRenderServices ??= services);
  let service = registry.get(root);
  if (!service) {
    service = new RenderService(root);
    registry.set(root, service);
  }
  return service;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "same-origin",
  });
  response.end(JSON.stringify(value));
}

function integer(value: string | null, fallback: number): number {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new ApiError(400, "invalid_parameter", "Resolution and frame rate must be whole numbers.");
  return parsed;
}

async function streamVideo(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  title: string,
): Promise<void> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw new ApiError(404, "not_found", "The video file is missing.");
  const headers: Record<string, string | number> = {
    "content-type": "video/mp4",
    "content-disposition": `attachment; filename="${slug(title)}.mp4"`,
    "cache-control": "private, no-cache",
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "same-origin",
    "accept-ranges": "bytes",
  };
  let start = 0;
  let end = info.size - 1;
  let partial = false;
  if (request.headers.range) {
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
    if (!range || (!range[1] && !range[2])) {
      response.writeHead(416, { "content-range": `bytes */${info.size}` });
      response.end();
      return;
    }
    if (!range[1]) start = Math.max(0, info.size - Number(range[2]));
    else {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), end) : end;
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
      response.writeHead(416, { "content-range": `bytes */${info.size}` });
      response.end();
      return;
    }
    partial = true;
  }
  response.writeHead(partial ? 206 : 200, {
    ...headers,
    "content-length": end - start + 1,
    ...(partial ? { "content-range": `bytes ${start}-${end}/${info.size}` } : {}),
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  const stream = createReadStream(path, { start, end });
  stream.on("error", () => response.destroy());
  response.on("close", () => stream.destroy());
  stream.pipe(response);
}

/**
 * Routes `/api/render...` requests. Returns false when the path is not a render route so the
 * caller can continue matching. Errors are thrown as ApiError for the caller's error format.
 */
export async function handleRenderRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  context: { root: string },
): Promise<boolean> {
  if (pathname !== "/api/render" && !pathname.startsWith("/api/render/")) return false;
  try {
    await routeRender(request, response, pathname, context);
  } catch (error) {
    // Answer in the shared error format here: the caller's class check may not see our ApiError
    // instance when modules are bundled separately.
    const known =
      error instanceof ApiError ||
      (error instanceof Error && typeof (error as ApiError).status === "number")
        ? (error as ApiError)
        : new ApiError(500, "internal_error", "The video render service could not complete this request.");
    if (!(error instanceof ApiError)) console.error("[render] request failed:", error);
    if (!response.headersSent)
      sendJson(response, known.status, {
        error: { code: known.code, message: known.message, ...known.details },
      });
    else response.destroy();
  }
  return true;
}

async function routeRender(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  context: { root: string },
): Promise<void> {
  const service = getRenderService(context.root);
  const url = new URL(request.url ?? "/", "http://localhost");
  if (pathname === "/api/render") {
    if (request.method === "GET") {
      sendJson(response, 200, { jobs: service.list() });
      return;
    }
    if (request.method !== "POST") throw new ApiError(405, "method_not_allowed", "Use GET or POST.");
    if (!/^text\/html(?:\s*;|$)/i.test(request.headers["content-type"] ?? ""))
      throw new ApiError(415, "html_required", "Send the recording document as text/html.");
    const width = integer(url.searchParams.get("width"), 1280);
    const height = integer(url.searchParams.get("height"), 720);
    const fps = integer(url.searchParams.get("fps"), 30);
    if (width < 320 || width > 3840 || height < 180 || height > 2160 || width % 2 || height % 2)
      throw new ApiError(400, "invalid_parameter", "Choose an even resolution between 320×180 and 3840×2160.");
    if (!ALLOWED_FPS.has(fps))
      throw new ApiError(400, "invalid_parameter", "Choose 24, 25, 30, 48, 50 or 60 frames per second.");
    const title = (url.searchParams.get("title") ?? "story").slice(0, 120);
    sendJson(response, 202, await service.create(request, { width, height, fps, title }));
    return;
  }
  const match = /^\/api\/render\/([a-f0-9]{16})(?:\/(video|cancel))?$/.exec(pathname);
  if (!match) throw new ApiError(404, "not_found", "This render does not exist.");
  const [, id, action] = match;
  if (!action) {
    if (request.method !== "GET") throw new ApiError(405, "method_not_allowed", "Use GET.");
    sendJson(response, 200, service.get(id));
    return;
  }
  if (action === "video") {
    if (request.method !== "GET" && request.method !== "HEAD")
      throw new ApiError(405, "method_not_allowed", "Use GET.");
    await streamVideo(request, response, service.videoPath(id), service.get(id).title);
    return;
  }
  if (request.method !== "POST") throw new ApiError(405, "method_not_allowed", "Use POST.");
  sendJson(response, 200, service.cancel(id));
}
