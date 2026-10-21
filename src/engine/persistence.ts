import type { Project } from "./types";
import { requireValidProject } from "./validation";
import {
  assetHash,
  assetRef,
  isAssetRef,
  mapProjectMedia,
  projectAssetRefs,
  projectMediaSources,
  type MediaKind,
} from "./asset-refs";

/**
 * Browser storage layout (IndexedDB "visual-novel-studio", version 2):
 * - projects: one small record per project, keyed by project ID. Media are `asset:<sha256>` refs.
 * - assets:   content-addressed Blobs, stored once no matter how many projects use them.
 * - meta:     the project that opens on start.
 * Version 1 kept a single "current" record with inline data URLs; it is migrated on first load.
 */
const DATABASE_NAME = "visual-novel-studio";
const DATABASE_VERSION = 2;
const PROJECTS = "projects";
const ASSETS = "assets";
const META = "meta";
const LEGACY_PROJECT_KEY = "current";
const CURRENT_PROJECT_KEY = "currentProjectId";
/** Assets created recently may belong to an edit another tab has not saved yet. */
const GARBAGE_GRACE_MS = 24 * 60 * 60 * 1000;
export const MAX_ASSET_BYTES = 40 * 1024 * 1024;
/** Looping background videos; base64 in a JSON backup must stay within its 256 MB limit. */
export const MAX_VIDEO_BYTES = 40 * 1024 * 1024;

export interface ProjectSummary {
  id: string;
  title: string;
  description: string;
  sceneCount: number;
  characterCount: number;
  savedAt: string;
}
export interface StoredAsset {
  hash: string;
  mime: string;
  size: number;
  blob: Blob;
  createdAt: number;
}
interface ProjectRecord {
  project: Project;
  savedAt: string;
}

let connection: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB)
    return Promise.reject(
      new Error(
        "This browser does not provide local project storage. Export your project JSON to keep your work.",
      ),
    );
  if (!connection) {
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PROJECTS))
          db.createObjectStore(PROJECTS);
        if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS);
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          connection = undefined;
        };
        resolve(db);
      };
      request.onerror = () =>
        reject(
          new Error(
            `Local storage could not open: ${request.error?.message ?? "unknown browser error"}. Export your project to keep your work.`,
          ),
        );
      request.onblocked = () =>
        reject(
          new Error(
            "Local storage is blocked by another editor tab. Close the other tab and try again.",
          ),
        );
    }).catch((error) => {
      connection = undefined;
      throw error;
    });
  }
  return connection;
}

/** Runs one transaction and resolves after it commits, never merely after a request succeeds. */
function transaction<T>(
  db: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
  operation: (tx: IDBTransaction) => IDBRequest<T> | void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const request = operation(tx);
    let result: T;
    if (request)
      request.onsuccess = () => {
        result = request.result;
      };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () =>
      reject(
        new Error(
          `Local project storage failed: ${tx.error?.message ?? "unknown browser error"}. Export your project to keep your work.`,
        ),
      );
    tx.onabort = () =>
      reject(
        new Error(
          `Local project storage was interrupted: ${tx.error?.message ?? "transaction aborted"}. Export your project to keep your work.`,
        ),
      );
  });
}

function readAll<T>(store: IDBObjectStore): Promise<[IDBValidKey, T][]> {
  return new Promise((resolve, reject) => {
    const entries: [IDBValidKey, T][] = [];
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) return resolve(entries);
      entries.push([current.key, current.value as T]);
      current.continue();
    };
    cursor.onerror = () => reject(cursor.error);
  });
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

const MIME_BY_KIND: Record<MediaKind, RegExp> = {
  image: /^image\/(?:png|jpeg|webp|gif|svg\+xml|avif)$/,
  audio: /^audio\/(?:mpeg|mp3|ogg|wav|wave|x-wav|webm|mp4|aac|flac)$/,
  video: /^video\/(?:mp4|webm)$/,
};

/** Stores media once by content; identical bytes from any project share one record. */
export async function putAsset(blob: Blob, kind?: MediaKind): Promise<string> {
  const mime = blob.type.toLowerCase();
  if (kind && !MIME_BY_KIND[kind].test(mime))
    throw new Error(`This file is not a supported ${kind} format.`);
  if (!blob.size) throw new Error("This file is empty.");
  const video = mime.startsWith("video/");
  if (blob.size > (video ? MAX_VIDEO_BYTES : MAX_ASSET_BYTES))
    throw new Error(
      `Each ${video ? "video" : "file"} must be smaller than 40 MB.`,
    );
  const hash = await sha256(await blob.arrayBuffer());
  const db = await database();
  await transaction(db, ASSETS, "readwrite", (tx) => {
    const store = tx.objectStore(ASSETS);
    const existing = store.get(hash);
    existing.onsuccess = () => {
      const asset: StoredAsset = {
        hash,
        mime,
        size: blob.size,
        blob,
        createdAt: Date.now(),
      };
      // Refresh the timestamp so collection never races a fresh re-import of old bytes.
      if (existing.result) asset.blob = (existing.result as StoredAsset).blob;
      store.put(asset, hash);
    };
  });
  return assetRef(hash);
}

export async function getAsset(ref: string): Promise<StoredAsset | undefined> {
  if (!isAssetRef(ref)) return undefined;
  const db = await database();
  return transaction<StoredAsset | undefined>(db, ASSETS, "readonly", (tx) =>
    tx.objectStore(ASSETS).get(assetHash(ref)),
  );
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

async function dataUrlToBlob(src: string): Promise<Blob> {
  const separator = src.indexOf(",");
  const header = src.slice(5, separator);
  const mime = header.split(";")[0].toLowerCase();
  const payload = src.slice(separator + 1);
  const bytes = header.includes(";base64")
    ? Uint8Array.from(atob(payload), (character) => character.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(payload));
  return new Blob([bytes], { type: mime });
}

/** Moves inline data URLs into the asset store. Used for migration and JSON import. */
export async function internalizeProjectAssets(
  project: Project,
): Promise<Project> {
  const seen = new Map<string, Promise<string>>();
  return mapProjectMedia(project, (src, kind) => {
    if (!src.startsWith("data:")) return src;
    if (!seen.has(src))
      seen.set(
        src,
        dataUrlToBlob(src).then((blob) => putAsset(blob, kind)),
      );
    return seen.get(src)!;
  });
}

/** Re-embeds stored media so a JSON backup works in any browser. */
export async function externalizeProjectAssets(
  project: Project,
): Promise<Project> {
  const seen = new Map<string, Promise<string>>();
  return mapProjectMedia(project, (src) => {
    if (!isAssetRef(src)) return src;
    if (!seen.has(src))
      seen.set(
        src,
        getAsset(src).then((asset) => {
          if (!asset)
            throw new Error(
              "A project image or recording is missing from this browser's storage.",
            );
          return blobToDataUrl(asset.blob);
        }),
      );
    return seen.get(src)!;
  });
}

function summary(record: ProjectRecord): ProjectSummary {
  return {
    id: record.project.id,
    title: record.project.title,
    description: record.project.description,
    sceneCount: record.project.nodes.length,
    characterCount: record.project.characters.length,
    savedAt: record.savedAt,
  };
}

/** Converts the version 1 single-project record. Its data URLs move into the asset store. */
async function migrateLegacyProject(db: IDBDatabase): Promise<void> {
  const legacy = await transaction<ProjectRecord | undefined>(
    db,
    PROJECTS,
    "readonly",
    (tx) => tx.objectStore(PROJECTS).get(LEGACY_PROJECT_KEY),
  );
  if (legacy === undefined) return;
  if (!legacy || typeof legacy !== "object" || !("project" in legacy))
    throw new Error(
      "The saved project is damaged. Import a project backup to recover your work.",
    );
  const project = await internalizeProjectAssets(
    requireValidProject(legacy.project, { draft: true }),
  );
  await transaction(db, [PROJECTS, META], "readwrite", (tx) => {
    const projects = tx.objectStore(PROJECTS);
    const existing = projects.get(project.id);
    existing.onsuccess = () => {
      // A project already saved under its own ID is newer than the legacy copy.
      if (!existing.result)
        projects.put(
          { project, savedAt: legacy.savedAt ?? new Date().toISOString() },
          project.id,
        );
      projects.delete(LEGACY_PROJECT_KEY);
      tx.objectStore(META).put(project.id, CURRENT_PROJECT_KEY);
    };
  });
}

/**
 * Saves structurally safe drafts, including incomplete story text and connections.
 * Inline data URLs are moved into the asset store first; the stored project is returned.
 */
export async function saveProject(project: Project): Promise<Project> {
  let validated = requireValidProject(project, { draft: true });
  if (projectMediaSources(validated).some(({ src }) => src.startsWith("data:")))
    validated = await internalizeProjectAssets(validated);
  const db = await database();
  await transaction(db, [PROJECTS, META], "readwrite", (tx) => {
    tx.objectStore(PROJECTS).put(
      { project: validated, savedAt: new Date().toISOString() },
      validated.id,
    );
    tx.objectStore(META).put(validated.id, CURRENT_PROJECT_KEY);
  });
  return validated;
}

/** Opens a project by ID, or the last opened project. Returns null in a fresh browser. */
export async function loadProject(id?: string): Promise<Project | null> {
  const db = await database();
  await migrateLegacyProject(db);
  const key =
    id ??
    (await transaction<string | undefined>(db, META, "readonly", (tx) =>
      tx.objectStore(META).get(CURRENT_PROJECT_KEY),
    ));
  if (!key) return null;
  const record = await transaction<ProjectRecord | undefined>(
    db,
    PROJECTS,
    "readonly",
    (tx) => tx.objectStore(PROJECTS).get(key),
  );
  if (record === undefined) return null;
  if (!record || typeof record !== "object" || !("project" in record))
    throw new Error(
      "The saved project is damaged. Import a project backup to recover your work.",
    );
  try {
    return requireValidProject(record.project, { draft: true });
  } catch (error) {
    throw new Error(
      `The saved project could not be read: ${error instanceof Error ? error.message : "invalid project data"}`,
    );
  }
}

async function allProjectRecords(
  db: IDBDatabase,
): Promise<[IDBValidKey, ProjectRecord][]> {
  const tx = db.transaction(PROJECTS, "readonly");
  return readAll<ProjectRecord>(tx.objectStore(PROJECTS));
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await database();
  await migrateLegacyProject(db);
  return (await allProjectRecords(db))
    .filter(
      ([key, record]) =>
        key !== LEGACY_PROJECT_KEY && record?.project?.id === key,
    )
    .map(([, record]) => summary(record))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** Records which stored project opens next time. */
export async function setCurrentProject(id: string): Promise<void> {
  const db = await database();
  await transaction(db, META, "readwrite", (tx) => {
    tx.objectStore(META).put(id, CURRENT_PROJECT_KEY);
  });
}

export async function deleteProject(id: string): Promise<void> {
  const db = await database();
  await transaction(db, [PROJECTS, META], "readwrite", (tx) => {
    tx.objectStore(PROJECTS).delete(id);
    const meta = tx.objectStore(META);
    const current = meta.get(CURRENT_PROJECT_KEY);
    current.onsuccess = () => {
      if (current.result === id) meta.delete(CURRENT_PROJECT_KEY);
    };
  });
}

export async function projectExists(id: string): Promise<boolean> {
  const db = await database();
  const count = await transaction<number>(db, PROJECTS, "readonly", (tx) =>
    tx.objectStore(PROJECTS).count(id),
  );
  return count > 0;
}

/**
 * Deletes stored media that no saved project references. Recent assets are kept so an
 * unsaved edit in another tab, or this session's undo history, can still use them.
 */
export async function collectUnusedAssets(
  now = Date.now(),
): Promise<{ removed: number; freedBytes: number }> {
  const db = await database();
  const used = new Set<string>();
  for (const [, record] of await allProjectRecords(db))
    if (record?.project)
      for (const ref of projectAssetRefs(record.project))
        used.add(assetHash(ref));
  let removed = 0,
    freedBytes = 0;
  await transaction(db, ASSETS, "readwrite", (tx) => {
    const store = tx.objectStore(ASSETS);
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) return;
      const asset = current.value as StoredAsset;
      if (
        !used.has(String(current.key)) &&
        now - (asset.createdAt ?? 0) > GARBAGE_GRACE_MS
      ) {
        removed += 1;
        freedBytes += asset.size ?? 0;
        current.delete();
      }
      current.continue();
    };
  });
  return { removed, freedBytes };
}

/** Asks the browser not to evict studio data under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{
  usage: number;
  quota: number;
} | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return estimate
      ? { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
      : null;
  } catch {
    return null;
  }
}

/** Test hook: forget the cached connection, e.g. after replacing the IndexedDB factory. */
export function resetStorageConnection(): void {
  connection = undefined;
}
