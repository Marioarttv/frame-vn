import {
  createExampleProject as createStarterProject,
  createExampleTour as createShowcaseProject,
} from "./examples";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  collectUnusedAssets,
  createBlankProject,
  createId,
  deleteProject as removeStoredProject,
  externalizeProjectAssets,
  internalizeProjectAssets,
  listProjects,
  loadProject,
  parseProjectJSON,
  projectExists,
  requestPersistentStorage,
  saveProject,
  setCurrentProject,
  serializeProject,
  validateDraftProject,
  type Background,
  type Character,
  type Project,
  type ProjectSummary,
} from "../engine";
import { loadProjectAssetUrls } from "../engine/asset-urls";
import { download, fileSlug, studioExportOptions } from "./media";

interface Library {
  characters: Character[];
  backgrounds: Background[];
}
const EMPTY_LIBRARY: Library = { characters: [], backgrounds: [] };

/**
 * Local packs (public/local-packs) are installed on this machine, not stored in projects.
 * Opening a project refreshes pack poses it already uses and offers the remaining pack cast.
 */
export function mergeLibrary(base: Project, library: Library): Project {
  const ids = new Set(base.characters.map((c) => c.id));
  return {
    ...base,
    characters: [
      ...base.characters.map((existing) => {
        const refreshed = library.characters.find(
          (candidate) => candidate.id === existing.id,
        );
        if (!refreshed) return existing;
        const roots = new Set(
          refreshed.poses
            .map((p) => p.animation?.assetRoot)
            .filter((root) => root?.startsWith("/local-packs/")),
        );
        if (!existing.poses.some((p) => roots.has(p.animation?.assetRoot)))
          return existing;
        const existingIds = new Set(existing.poses.map((p) => p.id));
        return {
          ...existing,
          voiceId: existing.voiceId || refreshed.voiceId,
          voice:
            !existing.voice || existing.voice.src.startsWith("/local-packs/")
              ? refreshed.voice || existing.voice
              : existing.voice,
          poses: [
            ...existing.poses.map(
              (p) =>
                refreshed.poses.find(
                  (fresh) =>
                    fresh.id === p.id &&
                    fresh.src === p.src &&
                    fresh.animation?.assetRoot === p.animation?.assetRoot,
                ) || p,
            ),
            ...refreshed.poses.filter((p) => !existingIds.has(p.id)),
          ],
        };
      }),
      ...library.characters.filter((c) => !ids.has(c.id)),
    ],
    backgrounds: [
      ...base.backgrounds,
      ...library.backgrounds.filter(
        (b) => !base.backgrounds.some((existing) => existing.id === b.id),
      ),
    ],
  };
}

async function fetchLibrary(): Promise<Library> {
  try {
    const res = await fetch("/api/library", {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return EMPTY_LIBRARY;
    const data = await res.json();
    return {
      characters: data.characters || [],
      backgrounds: data.backgrounds || [],
    };
  } catch {
    return EMPTY_LIBRARY; // The studio works without the local server's packs.
  }
}

export type SaveState =
  "Loading workspace" | "Saving…" | "Saved on this device" | "Save failed";

export type ProjectTemplate = "blank" | "starter" | "showcase";

export function useWorkspace(notify: (message: string) => void) {
  const [project, setProject] = useState<Project>(createStarterProject);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("Loading workspace");
  const [past, setPast] = useState<Project[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const library = useRef<Library>(EMPTY_LIBRARY);
  const latest = useRef(project);
  latest.current = project;
  const pendingSave = useRef<Promise<unknown>>(Promise.resolve());
  const dirty = useRef(false);
  // A deleted project must never be re-created by a save that was already scheduled.
  const deleted = useRef(new Set<string>());
  // Rapid edits such as typing form one undo step; discrete actions always get their own.
  const lastEdit = useRef(0);
  // Opening a stored project is not an edit; it should not move its "saved" time.
  const skipSave = useRef(false);

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch {
      /* The project list is informational; loading errors are reported elsewhere. */
    }
  }, []);

  /** Shows a project only after its stored media can render. */
  const present = useCallback(
    async (next: Project, stored = false) => {
      const missing = await loadProjectAssetUrls(next);
      setPast([]);
      lastEdit.current = 0;
      skipSave.current = stored;
      setProject(next);
      if (missing.length)
        notify(
          `${missing.length} image or audio file${missing.length === 1 ? " is" : "s are"} missing from this browser. Re-import ${missing.length === 1 ? "it" : "them"} or restore a project backup.`,
        );
    },
    [notify],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let saved: Project | null = null;
      let damaged = false;
      try {
        saved = await loadProject();
        if (!saved) {
          const [recent] = await listProjects();
          if (recent) saved = await loadProject(recent.id);
        }
      } catch (e) {
        damaged = true;
        if (!cancelled)
          notify(
            e instanceof Error ? e.message : "Could not load this workspace.",
          );
      }
      library.current = await fetchLibrary();
      if (cancelled) return;
      // Keep a damaged record intact for recovery instead of saving over its ID.
      const fallback = damaged
        ? { ...createStarterProject(), id: createId("project") }
        : createStarterProject();
      await present(mergeLibrary(saved || fallback, library.current), !!saved);
      if (cancelled) return;
      setLoaded(true);
      void refreshProjects();
      void requestPersistentStorage();
      // Never blocks opening; recent and referenced media are always kept.
      void collectUnusedAssets().catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [notify, present, refreshProjects]);

  const persist = useCallback((target: Project) => {
    const run = pendingSave.current
      .catch(() => undefined)
      .then(() =>
        deleted.current.has(target.id) ? target : saveProject(target),
      );
    pendingSave.current = run;
    return run;
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (skipSave.current) {
      skipSave.current = false;
      setSaveState("Saved on this device");
      return;
    }
    dirty.current = true;
    setSaveState("Saving…");
    let cancelled = false;
    const timer = setTimeout(() => {
      dirty.current = false;
      persist(project)
        .then(() => {
          if (!cancelled) setSaveState("Saved on this device");
          void refreshProjects();
        })
        .catch((e) => {
          if (!cancelled) {
            setSaveState("Save failed");
            notify(e.message);
          }
        });
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project, loaded, notify, persist, refreshProjects]);

  /** Writes the open project now, e.g. before switching to another one. */
  const flush = useCallback(async () => {
    if (dirty.current) {
      dirty.current = false;
      await persist(latest.current);
    } else await pendingSave.current.catch(() => undefined);
  }, [persist]);

  const change = useCallback((next: Project, discrete = false) => {
    const now = Date.now();
    if (discrete || now - lastEdit.current > 800)
      setPast((p) => [...p.slice(-49), latest.current]);
    lastEdit.current = discrete ? 0 : now;
    setProject(next);
  }, []);

  const undo = useCallback(() => {
    const previous = past[past.length - 1];
    if (!previous) return false;
    lastEdit.current = 0;
    setProject(previous);
    setPast(past.slice(0, -1));
    return true;
  }, [past]);

  const run = useCallback(
    async (task: () => Promise<void>, failure: string) => {
      setBusy(true);
      try {
        await task();
      } catch (e) {
        notify(e instanceof Error ? e.message : failure);
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );

  const openProject = useCallback(
    (id: string) =>
      run(async () => {
        if (id === latest.current.id) return;
        await flush();
        const next = await loadProject(id);
        if (!next) throw new Error("That project is no longer stored here.");
        await setCurrentProject(id);
        await present(mergeLibrary(next, library.current), true);
        notify(`Opened “${next.title || "Untitled project"}”.`);
      }, "The project could not be opened."),
    [flush, notify, present, run],
  );

  const createProject = useCallback(
    (kind: ProjectTemplate) =>
      run(async () => {
        await flush();
        const base =
          kind === "starter"
            ? { ...createStarterProject(), id: createId("project") }
            : kind === "showcase"
              ? createShowcaseProject(createId("project"))
              : createBlankProject(createId("project"));
        const created = mergeLibrary(base, library.current);
        await persist(created);
        await present(created);
        notify(
          kind === "showcase"
            ? "The stage tour is ready. Press Play story to see every effect."
            : kind === "starter"
              ? "A new copy of the example story is ready."
              : "A new project is ready. Start with its first scene.",
        );
      }, "The project could not be created."),
    [flush, notify, present, run],
  );

  /** Starts a new project from an example story shipped in a local pack. */
  const createFromTemplate = useCallback(
    (src: string) =>
      run(async () => {
        await flush();
        const response = await fetch(src);
        if (!response.ok) throw new Error("That example story is unavailable.");
        const result = validateDraftProject(await response.json());
        if (!result.valid)
          throw new Error(
            result.errors[0]?.message ?? "That example story is invalid.",
          );
        const created = mergeLibrary(
          { ...result.project, id: createId("project") },
          library.current,
        );
        await persist(created);
        await present(created);
        notify(`“${created.title}” is ready. Press Play story to watch it.`);
      }, "The example story could not be opened."),
    [flush, notify, present, run],
  );

  const duplicateProject = useCallback(
    () =>
      run(async () => {
        await flush();
        const copy = {
          ...structuredClone(latest.current),
          id: createId("project"),
          title: `${latest.current.title.slice(0, 133)} (copy)`,
        };
        await persist(copy);
        await present(copy);
        notify("Project duplicated. You are now editing the copy.");
      }, "The project could not be duplicated."),
    [flush, notify, present, run],
  );

  const deleteProject = useCallback(
    (id: string) =>
      run(async () => {
        deleted.current.add(id);
        await pendingSave.current.catch(() => undefined);
        await removeStoredProject(id);
        if (id === latest.current.id) {
          dirty.current = false;
          const [recent] = await listProjects();
          const next = recent ? await loadProject(recent.id) : null;
          if (next) await setCurrentProject(next.id);
          await present(
            mergeLibrary(
              next ?? createBlankProject(createId("project")),
              library.current,
            ),
            !!next,
          );
        }
        await refreshProjects();
        notify("Project deleted from this browser.");
      }, "The project could not be deleted."),
    [notify, present, refreshProjects, run],
  );

  /** Imported JSON replaces the open project (Undo restores it); media move into the store. */
  const importProjectFile = useCallback(
    (file: File) =>
      run(async () => {
        if (file.size > 80 * 1024 * 1024)
          throw new Error("Project files must be smaller than 80 MB.");
        const parsed = parseProjectJSON(await file.text(), { draft: true });
        if (!parsed.valid)
          throw new Error(
            parsed.errors
              .slice(0, 3)
              .map((e) => e.message)
              .join(" "),
          );
        let imported = await internalizeProjectAssets(parsed.project);
        // Never overwrite a different stored project that happens to share this ID.
        if (
          deleted.current.has(imported.id) ||
          (imported.id !== latest.current.id &&
            (await projectExists(imported.id)))
        )
          imported = { ...imported, id: createId("project") };
        await loadProjectAssetUrls(imported);
        change(mergeLibrary(imported, library.current), true);
        notify(
          "Project imported. Your previous project is available with Undo.",
        );
      }, "Import failed."),
    [change, notify, run],
  );

  const exportProjectJson = useCallback(
    () =>
      run(async () => {
        const portable = await externalizeProjectAssets(latest.current);
        download(
          `${latest.current.id}.json`,
          serializeProject(portable, { draft: true }),
        );
        notify("Project JSON exported with its images and recordings.");
      }, "Project backup could not be exported."),
    [notify, run],
  );

  const exportGame = useCallback(
    () =>
      run(async () => {
        // The exporter embeds the game runtime, so it loads only when needed.
        const { exportStandaloneHtml } = await import("../engine/export");
        const html = await exportStandaloneHtml(
          latest.current,
          studioExportOptions,
        );
        download(`${fileSlug(latest.current.title)}.html`, html, "text/html");
        notify("Playable story exported. Open the HTML file in any browser.");
      }, "Export failed."),
    [notify, run],
  );

  return {
    project,
    loaded,
    saveState,
    busy,
    projects,
    canUndo: past.length > 0,
    change,
    undo,
    openProject,
    createProject,
    createFromTemplate,
    duplicateProject,
    deleteProject,
    importProjectFile,
    exportProjectJson,
    exportGame,
    refreshProjects,
  };
}
