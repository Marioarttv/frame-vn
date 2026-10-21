import type { Project } from "./types";
import { assetHash, isAssetRef, projectAssetRefs } from "./asset-refs";
import { getAsset } from "./persistence";

/**
 * Rendering needs synchronous URLs. Stored assets are opened once as object URLs; the Blob
 * itself stays in IndexedDB-backed storage, so this costs no copy of the media in memory.
 */
const urls = new Map<string, string>();
const missing = new Set<string>();

export function registerAssetUrl(ref: string, blob: Blob): string {
  const hash = assetHash(ref);
  let url = urls.get(hash);
  if (!url) {
    url = URL.createObjectURL(blob);
    urls.set(hash, url);
  }
  missing.delete(hash);
  return url;
}

/** Maps any project media source to something an <img>, <audio> or fetch() can load. */
export function resolveAssetUrl(src: string): string;
export function resolveAssetUrl(src: string | undefined): string | undefined;
export function resolveAssetUrl(src: string | undefined): string | undefined {
  if (!src || !isAssetRef(src)) return src;
  return urls.get(assetHash(src)) ?? "";
}

/** Opens every asset a project uses. Returns the references this browser no longer has. */
export async function loadProjectAssetUrls(
  project: Project,
): Promise<string[]> {
  const absent: string[] = [];
  await Promise.all(
    [...projectAssetRefs(project)].map(async (ref) => {
      if (urls.has(assetHash(ref))) return;
      const asset = await getAsset(ref);
      if (asset) registerAssetUrl(ref, asset.blob);
      else {
        missing.add(assetHash(ref));
        absent.push(ref);
      }
    }),
  );
  return absent;
}

export function isAssetMissing(src: string | undefined): boolean {
  return isAssetRef(src) && missing.has(assetHash(src));
}
