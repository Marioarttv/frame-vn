import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  collectUnusedAssets,
  createStarterProject,
  deleteProject,
  externalizeProjectAssets,
  getAsset,
  internalizeProjectAssets,
  isAssetRef,
  listProjects,
  loadProject,
  projectAssetRefs,
  putAsset,
  resetStorageConnection,
  saveProject,
  type Project,
} from "../src/engine";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=";
const OTHER_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetStorageConnection();
});

function withImages(): Project {
  const project = createStarterProject();
  project.characters[0].poses[0].src = PNG;
  project.characters[1].poses[0].src = PNG;
  project.backgrounds[0].src = OTHER_PNG;
  return project;
}

async function legacyDatabase(record: unknown) {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("visual-novel-studio", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("projects");
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("projects", "readwrite");
      tx.objectStore("projects").put(record, "current");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

test("a version 1 workspace migrates once, moving inline media into the asset store", async () => {
  await legacyDatabase({
    project: withImages(),
    savedAt: "2026-01-01T00:00:00.000Z",
  });
  const project = await loadProject();
  assert.ok(project);
  assert.ok(isAssetRef(project.characters[0].poses[0].src));
  assert.equal(
    project.characters[0].poses[0].src,
    project.characters[1].poses[0].src,
    "identical bytes share one asset",
  );
  assert.ok(!JSON.stringify(project).includes("data:image"));
  const asset = await getAsset(project.characters[0].poses[0].src);
  assert.equal(asset?.mime, "image/png");
  assert.equal(
    Buffer.from(await asset!.blob.arrayBuffer()).toString("base64"),
    PNG.split(",")[1],
  );
  const projects = await listProjects();
  assert.deepEqual(
    projects.map((item) => [item.id, item.savedAt]),
    [["first-light", "2026-01-01T00:00:00.000Z"]],
  );
  resetStorageConnection();
  assert.deepEqual(await loadProject(), project, "migration is idempotent");
});

test("projects are saved independently and the last saved one reopens", async () => {
  const first = createStarterProject();
  const second = { ...createStarterProject(), id: "second", title: "Second" };
  await saveProject(first);
  await saveProject(second);
  assert.equal((await loadProject())?.id, "second");
  assert.equal((await loadProject("first-light"))?.title, first.title);
  assert.deepEqual((await listProjects()).map((item) => item.id).sort(), [
    "first-light",
    "second",
  ]);
  await deleteProject("second");
  assert.equal(await loadProject(), null, "no current project after deletion");
  assert.equal((await listProjects()).length, 1);
});

test("saving inline media stores it once and a backup restores identical bytes", async () => {
  const stored = await saveProject(withImages());
  assert.equal(projectAssetRefs(stored).size, 2);
  const reopened = await loadProject();
  assert.deepEqual(reopened, stored);
  const backup = await externalizeProjectAssets(reopened!);
  assert.equal(backup.characters[0].poses[0].src, PNG);
  assert.equal(backup.backgrounds[0].src, OTHER_PNG);
  const reimported = await internalizeProjectAssets(backup);
  assert.deepEqual(reimported, stored);
});

test("unused media is collected after a grace period; referenced media never is", async () => {
  const stored = await saveProject(withImages());
  const orphan = await putAsset(
    new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    "image",
  );
  assert.deepEqual(await collectUnusedAssets(), { removed: 0, freedBytes: 0 });
  const later = Date.now() + 2 * 24 * 60 * 60 * 1000;
  assert.deepEqual(await collectUnusedAssets(later), {
    removed: 1,
    freedBytes: 3,
  });
  assert.equal(await getAsset(orphan), undefined);
  for (const ref of projectAssetRefs(stored)) assert.ok(await getAsset(ref));
});

test("asset imports reject mismatched types, empty files and oversized files", async () => {
  await assert.rejects(
    putAsset(new Blob(["<svg/>"], { type: "text/html" }), "image"),
    /not a supported image/,
  );
  await assert.rejects(
    putAsset(new Blob([], { type: "image/png" }), "image"),
    /empty/,
  );
  await assert.rejects(
    putAsset(
      new Blob([new Uint8Array(41 * 1024 * 1024)], { type: "audio/mpeg" }),
      "audio",
    ),
    /40 MB/,
  );
});
