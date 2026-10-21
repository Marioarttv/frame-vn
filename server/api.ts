import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import type { Plugin } from "vite";
import {
  ApiError,
  VoiceService,
  type VoiceServiceOptions,
} from "./voice-service";
import { discoverCharacterLibrary } from "./character-library";
import { discoverStoryTemplates } from "./story-templates";
import { CharacterService, MAX_ASSET_BODY_BYTES } from "./character-service";
import { handleRenderRequest } from "./render-service";

export { VoiceService } from "./voice-service";
export type {
  VoiceResult,
  VoiceRequest,
  VoiceInfo,
  VoiceHistoryItem,
} from "./voice-service";
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const ASSET_MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".json": "application/json; charset=utf-8",
};
type Next = () => void;

/** This paid-authoring API intentionally only serves the machine running the studio. */
export function assertLocalRequest(
  request: IncomingMessage,
  mutation = false,
): void {
  if (!LOOPBACK.has(request.socket.remoteAddress ?? ""))
    throw new ApiError(
      403,
      "local_only",
      "The authoring API only accepts loopback connections.",
    );
  let host: URL;
  try {
    host = new URL(`http://${request.headers.host ?? ""}`);
  } catch {
    throw new ApiError(403, "invalid_host", "Invalid authoring host.");
  }
  if (
    !LOCAL_HOSTS.has(host.hostname) ||
    (host.port ? Number(host.port) : 80) !== request.socket.localPort
  )
    throw new ApiError(403, "invalid_host", "Use the local studio address.");
  if (request.headers["sec-fetch-site"] === "cross-site")
    throw new ApiError(
      403,
      "cross_origin",
      "Cross-site authoring requests are blocked.",
    );
  const origin = request.headers.origin;
  if (origin !== undefined) {
    let originUrl: URL;
    try {
      originUrl = new URL(origin);
    } catch {
      throw new ApiError(403, "cross_origin", "Invalid request origin.");
    }
    const protocol = "encrypted" in request.socket ? "https:" : "http:";
    if (
      originUrl.host !== host.host ||
      originUrl.protocol !== protocol ||
      originUrl.username ||
      originUrl.password
    )
      throw new ApiError(
        403,
        "cross_origin",
        "Open the authoring API from this studio only.",
      );
  } else if (mutation)
    throw new ApiError(
      403,
      "origin_required",
      "Authoring changes require a same-origin request.",
    );
}

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "same-origin",
  });
  response.end(JSON.stringify(value));
}
async function readBody(
  request: IncomingMessage,
  maximum = 16 * 1024,
): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")
  )
    throw new ApiError(415, "json_required", "Send application/json.");
  if (Number(request.headers["content-length"] ?? 0) > maximum)
    throw new ApiError(413, "request_too_large", "The request is too large.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const data of request) {
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    size += chunk.length;
    if (size > maximum)
      throw new ApiError(413, "request_too_large", "The request is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "invalid_json", "The request is not valid JSON.");
  }
}

export interface StudioApiOptions extends VoiceServiceOptions {
  service?: VoiceService;
  characterService?: CharacterService;
}
/** Reusable Node middleware for Vite or another local HTTP server. No public deployment auth is implied. */
export function createStudioApi(options: StudioApiOptions = {}) {
  const service = options.service ?? new VoiceService(options);
  const characters =
    options.characterService ?? new CharacterService({ root: service.root });
  const sessionToken = randomBytes(32).toString("hex");
  const handler = async (
    request: IncomingMessage,
    response: ServerResponse,
    next: Next = () =>
      send(response, 404, {
        error: { code: "not_found", message: "Not found." },
      }),
  ): Promise<void> => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (
      !pathname.startsWith("/api/") &&
      !pathname.startsWith("/generated/") &&
      !pathname.startsWith("/local-packs/") &&
      !pathname.startsWith("/character-assets/")
    ) {
      next();
      return;
    }
    try {
      assertLocalRequest(
        request,
        request.method !== "GET" && request.method !== "HEAD",
      );
      if (request.method !== "GET" && request.method !== "HEAD") {
        const token = request.headers["x-studio-token"];
        if (
          typeof token !== "string" ||
          !/^[a-f0-9]{64}$/.test(token) ||
          !timingSafeEqual(Buffer.from(token), Buffer.from(sessionToken))
        )
          throw new ApiError(
            403,
            "invalid_token",
            "Refresh the studio before saving or generating assets.",
          );
      }
      if (
        pathname.startsWith("/generated/") ||
        pathname.startsWith("/local-packs/") ||
        pathname.startsWith("/character-assets/")
      ) {
        if (request.method !== "GET" && request.method !== "HEAD")
          throw new ApiError(405, "method_not_allowed", "Use GET or HEAD.");
        let path: string;
        const generated = pathname.startsWith("/generated/");
        if (pathname.startsWith("/character-assets/")) {
          const match =
            /^\/character-assets\/([a-f0-9]{64}\.(?:png|jpg|webp))$/.exec(
              pathname,
            );
          if (!match)
            throw new ApiError(404, "not_found", "Source image not found.");
          path = join(characters.assetsDirectory, match[1]);
        } else if (generated) {
          const match =
            /^\/generated\/([a-f0-9]{64}\.(?:mp3|cues\.json))$/.exec(pathname);
          if (!match)
            throw new ApiError(404, "not_found", "Generated asset not found.");
          path = join(service.assetsDirectory, match[1]);
        } else {
          const root = resolve(service.root, "public", "local-packs");
          let relative: string;
          try {
            relative = decodeURIComponent(
              pathname.slice("/local-packs/".length),
            );
          } catch {
            throw new ApiError(404, "not_found", "Local asset not found.");
          }
          const candidate = resolve(root, relative);
          if (
            !candidate.startsWith(`${root}${sep}`) ||
            !ASSET_MIME[extname(candidate).toLowerCase()]
          )
            throw new ApiError(404, "not_found", "Local asset not found.");
          try {
            const canonicalRoot = await realpath(root);
            path = await realpath(candidate);
            if (!path.startsWith(`${canonicalRoot}${sep}`))
              throw new Error("outside-root");
          } catch {
            throw new ApiError(404, "not_found", "Local asset not found.");
          }
        }
        if (generated || pathname.startsWith("/character-assets/")) {
          try {
            const root = await realpath(
              generated ? service.assetsDirectory : characters.assetsDirectory,
            );
            path = await realpath(path);
            if (!path.startsWith(`${root}${sep}`))
              throw new Error("outside-root");
          } catch {
            throw new ApiError(404, "not_found", "Asset not found.");
          }
        }
        let info;
        try {
          info = await stat(path);
          if (!info.isFile() || !info.size) throw new Error("not-file");
        } catch {
          throw new ApiError(404, "not_found", "Asset not found.");
        }
        const headers = {
          "content-type":
            ASSET_MIME[extname(path).toLowerCase()] ??
            "application/octet-stream",
          "cache-control": generated
            ? "private, max-age=31536000, immutable"
            : "private, no-cache",
          "x-content-type-options": "nosniff",
          "cross-origin-resource-policy": "same-origin",
          "accept-ranges": "bytes",
        };
        let start = 0,
          end = info.size - 1,
          partial = false;
        if (request.headers.range) {
          const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
          if (!range || (!range[1] && !range[2])) {
            response.writeHead(416, {
              "content-range": `bytes */${info.size}`,
            });
            response.end();
            return;
          }
          if (!range[1]) start = Math.max(0, info.size - Number(range[2]));
          else {
            start = Number(range[1]);
            end = range[2] ? Math.min(Number(range[2]), end) : end;
          }
          if (
            !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(end) ||
            start > end ||
            start >= info.size
          ) {
            response.writeHead(416, {
              "content-range": `bytes */${info.size}`,
            });
            response.end();
            return;
          }
          partial = true;
        }
        response.writeHead(partial ? 206 : 200, {
          ...headers,
          "content-length": end - start + 1,
          ...(partial
            ? { "content-range": `bytes ${start}-${end}/${info.size}` }
            : {}),
        });
        if (request.method === "HEAD") {
          response.end();
          return;
        }
        const stream = createReadStream(path, { start, end });
        stream.on("error", () => response.destroy());
        response.on("close", () => stream.destroy());
        stream.pipe(response);
        return;
      }
      if (
        await handleRenderRequest(request, response, pathname, {
          root: service.root,
        })
      )
        return;
      if (pathname === "/api/health" && request.method === "GET") {
        send(response, 200, {
          ...(await service.health()),
          characterAuthoring: true,
          sessionToken,
        });
        return;
      }
      if (pathname === "/api/library" && request.method === "GET") {
        send(response, 200, await discoverCharacterLibrary(service.root));
        return;
      }
      if (pathname === "/api/voices" && request.method === "GET") {
        send(response, 200, await service.voices());
        return;
      }
      if (pathname === "/api/stories" && request.method === "GET") {
        send(response, 200, await discoverStoryTemplates(service.root));
        return;
      }
      if (pathname === "/api/voice/history" && request.method === "GET") {
        send(response, 200, await service.history());
        return;
      }
      if (
        pathname.startsWith("/api/characters/assets/") &&
        request.method === "GET"
      ) {
        send(
          response,
          200,
          await characters.asset(
            pathname.slice("/api/characters/assets/".length),
          ),
        );
        return;
      }
      if (pathname === "/api/characters/assets" && request.method === "POST") {
        send(
          response,
          200,
          await characters.upload(
            await readBody(request, MAX_ASSET_BODY_BYTES),
          ),
        );
        return;
      }
      if (pathname === "/api/characters/build" && request.method === "POST") {
        send(
          response,
          200,
          await characters.build(await readBody(request, 1024 * 1024)),
        );
        return;
      }
      if (
        pathname === "/api/voice/attempts/archive" &&
        request.method === "POST"
      ) {
        send(
          response,
          200,
          await service.archiveAttempt(await readBody(request)),
        );
        return;
      }
      if (pathname === "/api/voice" && request.method === "POST") {
        send(response, 200, await service.generate(await readBody(request)));
        return;
      }
      throw new ApiError(404, "not_found", "Authoring endpoint not found.");
    } catch (error) {
      const known =
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              "internal_error",
              "The local authoring service could not complete this request.",
            );
      if (!response.headersSent)
        send(response, known.status, {
          error: { code: known.code, message: known.message, ...known.details },
        });
      else response.destroy();
    }
  };
  return { handler, service };
}

export function studioApiPlugin(options: StudioApiOptions = {}): Plugin {
  let root = options.root ?? process.cwd();
  return {
    name: "frame-local-authoring-api",
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      const api = createStudioApi({ ...options, root });
      server.middlewares.use((request, response, next) => {
        void api.handler(request, response, next);
      });
    },
    configurePreviewServer(server) {
      const api = createStudioApi({ ...options, root });
      server.middlewares.use((request, response, next) => {
        void api.handler(request, response, next);
      });
    },
  };
}
