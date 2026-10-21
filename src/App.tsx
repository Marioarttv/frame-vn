import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  ArrowRight,
  BookOpen,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Database,
  Download,
  FileJson,
  Film,
  FolderOpen,
  GalleryHorizontalEnd,
  LoaderCircle,
  Mic,
  Play,
  Undo2,
  Upload,
  Users,
  Video,
  WandSparkles,
  X,
} from "lucide-react";
import { characterUsage, validateProject } from "./engine";
import type { Character, Pose } from "./engine";
import { SceneEditor } from "./components/SceneEditor";
import { StoryData } from "./views/StoryData";
import { AnimationLab } from "./views/AnimationLab";
import { AddCharacter, CharacterLibrary } from "./views/CharacterLibrary";
import { Guide } from "./views/Guide";
import { ProjectManager } from "./views/ProjectManager";
import { useWorkspace } from "./studio/useWorkspace";
import type { View } from "./studio/views";

// The rig builder and the story player bundle are large and rarely needed at startup.
const RigBuilder = lazy(() =>
  import("./components/RigBuilder").then((module) => ({
    default: module.RigBuilder,
  })),
);
const VoiceStudio = lazy(() =>
  import("./views/VoiceStudio").then((module) => ({
    default: module.VoiceStudio,
  })),
);
const Storyboard = lazy(() =>
  import("./views/Storyboard").then((module) => ({
    default: module.Storyboard,
  })),
);
const RenderDialog = lazy(() =>
  import("./components/RenderDialog").then((module) => ({
    default: module.RenderDialog,
  })),
);
const StoryPlayer = lazy(() =>
  import("./components/StoryPlayer").then((module) => ({
    default: module.StoryPlayer,
  })),
);

const nav = [
  { id: "characters" as View, label: "Characters", icon: Users },
  { id: "rig" as View, label: "Rig builder", icon: WandSparkles },
  { id: "lab" as View, label: "Animation lab", icon: Activity },
  { id: "board" as View, label: "Storyboard", icon: GalleryHorizontalEnd },
  { id: "scenes" as View, label: "Scene builder", icon: Clapperboard },
  { id: "voice" as View, label: "Voice studio", icon: Mic },
  { id: "data" as View, label: "Story data", icon: Database },
];

export default function App() {
  const [view, setView] = useState<View>("lab");
  const [selectedScene, setSelectedScene] = useState<string>();
  const [activeId, setActiveId] = useState("mira");
  const [poseId, setPoseId] = useState("neutral");
  const [notice, setNotice] = useState("");
  // The preview's opening scene; null when closed.
  const [playing, setPlaying] = useState<{ startNodeId?: string } | null>(null);
  const [adding, setAdding] = useState(false);
  // The video export dialog's first scene; null when closed.
  const [rendering, setRendering] = useState<{ startNodeId?: string } | null>(
    null,
  );
  const [projectMenu, setProjectMenu] = useState(false);
  const [managingProjects, setManagingProjects] = useState(false);
  const importer = useRef<HTMLInputElement>(null);

  const notify = useCallback((message: string) => setNotice(message), []);
  const workspace = useWorkspace(notify);
  const { project, change } = workspace;

  useEffect(() => {
    if (!projectMenu) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProjectMenu(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [projectMenu]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  // Prefer a calibrated character, then the first character in the project.
  useEffect(() => {
    if (!workspace.loaded) return;
    const first =
      project.characters.find((c) =>
        c.poses.some((p) => Boolean(p.animation)),
      ) ||
      project.characters[0];
    if (first) {
      setActiveId(first.id);
      setPoseId(first.poses[0].id);
    }
    setSelectedScene(undefined);
    setPlaying(null);
    setRendering(null);
    // Only a different project, not each edit, resets the selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, workspace.loaded]);

  const character =
    project.characters.find((c) => c.id === activeId) || project.characters[0];
  const pose =
    character?.poses.find((p) => p.id === poseId) || character?.poses[0];
  function chooseCharacter(id: string) {
    const c = project.characters.find((c) => c.id === id);
    if (c) {
      setActiveId(c.id);
      setPoseId(c.poses[0].id);
    }
  }
  function updateCharacter(c: Character) {
    change({
      ...project,
      characters: project.characters.map((item) =>
        item.id === c.id ? c : item,
      ),
    });
  }
  // Pack artwork is re-merged from public/local-packs on every load, so removing it here would not last.
  const fromLocalPack = (item: Pose) => item.src.startsWith("/local-packs/");
  function removeCharacter(id: string) {
    const target = project.characters.find((c) => c.id === id);
    if (!target) return;
    const scenes = characterUsage(project, id);
    if (scenes)
      return notify(
        `${target.name} appears in ${scenes} scene${scenes === 1 ? "" : "s"}. Change those scenes first.`,
      );
    if (target.poses.some(fromLocalPack))
      return notify(
        `${target.name} comes from a local character pack. Remove the pack folder to remove them.`,
      );
    const remaining = project.characters.filter((c) => c.id !== id);
    change({ ...project, characters: remaining }, true);
    if (character?.id === id && remaining[0]) {
      setActiveId(remaining[0].id);
      setPoseId(remaining[0].poses[0].id);
    }
    notify(`${target.name} was removed. Use Undo to restore them.`);
  }
  function removePose(characterId: string, removedId: string) {
    const target = project.characters.find((c) => c.id === characterId);
    const removed = target?.poses.find((p) => p.id === removedId);
    if (!target || !removed) return;
    if (target.poses.length < 2)
      return notify("A character needs at least one expression.");
    const scenes = characterUsage(project, characterId, removedId);
    if (scenes)
      return notify(
        `“${removed.name}” is used in ${scenes} scene${scenes === 1 ? "" : "s"}. Choose another expression there first.`,
      );
    if (fromLocalPack(removed))
      return notify(
        `“${removed.name}” comes from a local character pack and cannot be removed here.`,
      );
    const poses = target.poses.filter((p) => p.id !== removedId);
    change(
      {
        ...project,
        characters: project.characters.map((c) =>
          c.id === characterId ? { ...target, poses } : c,
        ),
      },
      true,
    );
    if (pose?.id === removedId) setPoseId(poses[0].id);
    notify(`“${removed.name}” was removed. Use Undo to restore it.`);
  }
  async function exportGame() {
    setProjectMenu(false);
    await workspace.exportGame();
  }
  const validation = useMemo(() => validateProject(project), [project]);
  if (!workspace.loaded)
    return (
      <div className="workspace-loading" role="status">
        <span className="brand-loading">frame.</span>
        <LoaderCircle size={22} className="spin" />
        <p>Opening your workspace…</p>
      </div>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="wordmark"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("lab");
          }}
          aria-label="Frame home"
        >
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          <span>
            frame<span className="wordmark-dot">.</span>
          </span>
        </a>
        <button
          className="workspace-switch"
          aria-label="Manage projects"
          onClick={() => setManagingProjects(true)}
        >
          <span className="workspace-symbol">
            <Film size={18} />
          </span>
          <div>
            <strong>My projects</strong>
            <span>{Math.max(1, workspace.projects.length)} stored locally</span>
          </div>
          <ChevronDown size={14} />
        </button>
        <div className="nav-label">CREATE</div>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <button
              key={n.id}
              aria-label={n.label}
              aria-current={view === n.id ? "page" : undefined}
              className={`nav-item ${view === n.id ? "active" : ""}`}
              onClick={() => setView(n.id)}
            >
              <n.icon size={18} />
              <span>{n.label}</span>
              {n.id === "characters" && (
                <span className="nav-count">{project.characters.length}</span>
              )}
              {view === n.id && n.id !== "characters" && (
                <span className="nav-indicator" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-project">
          <div className="nav-label">CURRENT PROJECT</div>
          <button
            className="project-shortcut"
            onClick={() => setView("board")}
          >
            <span className="project-thumb">
              <Clapperboard size={18} />
            </span>
            <div>
              <strong>{project.title || "Untitled story"}</strong>
              <span>{project.nodes.length} scenes · Browser game</span>
            </div>
          </button>
        </div>
        <div className="sidebar-bottom">
          <div className="studio-note">
            <span className="little-star">✳</span>
            <p>
              Every story starts
              <br />
              with a little possibility.
            </p>
            <span>Make something yours.</span>
          </div>
          <button
            aria-label="Studio guide"
            className={`nav-item ${view === "guide" ? "active" : ""}`}
            onClick={() => setView("guide")}
          >
            <BookOpen size={18} />
            <span>Studio guide</span>
            <ArrowRight size={14} />
          </button>
          <div className="local-status">
            <span /> Local workspace <span className="version">v0.1.0</span>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <strong>
              {view === "guide"
                ? "Studio guide"
                : nav.find((n) => n.id === view)?.label}
            </strong>
          </div>
          <div className="topbar-actions">
            <span
              className={`saved-status ${workspace.saveState === "Save failed" ? "has-error" : ""}`}
            >
              <span />
              {workspace.saveState}
            </span>
            <button
              className="icon-button"
              title="Undo last edit"
              aria-label="Undo last edit"
              disabled={!workspace.canUndo}
              onClick={() => {
                if (workspace.undo()) notify("Last edit undone.");
              }}
            >
              <Undo2 size={17} />
            </button>
            <div className="menu-anchor">
              <button
                className="button small"
                onClick={() => setProjectMenu(!projectMenu)}
                aria-expanded={projectMenu}
              >
                <FolderOpen size={15} /> Project <ChevronDown size={13} />
              </button>
              {projectMenu && (
                <>
                  <button
                    className="menu-backdrop"
                    aria-label="Close project menu"
                    onClick={() => setProjectMenu(false)}
                  />
                  <div className="dropdown-menu">
                    <button
                      onClick={() => {
                        setProjectMenu(false);
                        setManagingProjects(true);
                      }}
                    >
                      <FolderOpen size={15} /> Manage projects
                    </button>
                    <button
                      onClick={() => {
                        importer.current?.click();
                        setProjectMenu(false);
                      }}
                    >
                      <Upload size={15} /> Import project JSON
                    </button>
                    <button
                      onClick={() => {
                        setProjectMenu(false);
                        void workspace.exportProjectJson();
                      }}
                    >
                      <FileJson size={15} /> Export project JSON
                    </button>
                    <button onClick={() => void exportGame()}>
                      <Download size={15} /> Export playable game
                    </button>
                    <button
                      disabled={!validation.valid}
                      onClick={() => {
                        setProjectMenu(false);
                        setRendering({});
                      }}
                    >
                      <Video size={15} /> Export video (MP4)
                    </button>
                  </div>
                </>
              )}
            </div>
            <button
              className="button primary small"
              disabled={workspace.busy || !validation.valid}
              onClick={() => setPlaying({})}
            >
              <Play size={14} fill="currentColor" /> Play story
            </button>
          </div>
        </header>
        <main className={view === "board" ? "is-full-bleed" : undefined}>
          {view === "board" && (
            <Suspense fallback={<LoadingView />}>
              <Storyboard
                key={project.id}
                project={project}
                initialNodeId={selectedScene}
                onChange={change}
                onPlay={(startNodeId) => setPlaying({ startNodeId })}
                onRender={(startNodeId) => setRendering({ startNodeId })}
                onNotice={notify}
                onNewCharacter={() => setAdding(true)}
                onOpenScene={(id) => {
                  setSelectedScene(id);
                  setView("scenes");
                }}
              />
            </Suspense>
          )}
          {view === "lab" && (
            <AnimationLab
              character={character}
              pose={pose}
              characters={project.characters}
              backgrounds={project.backgrounds}
              onCharacter={chooseCharacter}
              onPose={setPoseId}
              onCharacterChange={updateCharacter}
              onRemovePose={(id) => character && removePose(character.id, id)}
              onNotice={notify}
              onAdd={() => setAdding(true)}
              onUseDialogue={(text, audio) => {
                if (!character || !pose) return;
                const id = crypto.randomUUID();
                change(
                  {
                    ...project,
                    nodes: [
                      ...project.nodes,
                      {
                        id,
                        label: `${character.name}'s moment`,
                        type: "dialogue",
                        characterId: character.id,
                        poseId: pose.id,
                        backgroundId: project.backgrounds[0]?.id,
                        position: 65,
                        text,
                        nextId: null,
                        audioSrc: audio?.audioSrc,
                        cueUrl: audio?.cueUrl,
                      },
                    ],
                  },
                  true,
                );
                setSelectedScene(id);
                setView("scenes");
                notify(
                  "Dialogue added as a scene. Connect it to your story when ready.",
                );
              }}
            />
          )}
          {view === "rig" && (
            <Suspense fallback={<LoadingView />}>
              <RigBuilder
                characters={project.characters}
                onNotice={notify}
                onCharacter={(c) => {
                  // A build for an existing character adds (or refreshes) one expression.
                  const merge = (old: Character): Character => ({
                    ...old,
                    poses: [
                      ...old.poses.filter(
                        (p) => !c.poses.some((built) => built.id === p.id),
                      ),
                      ...c.poses,
                    ],
                  });
                  change(
                    {
                      ...project,
                      characters: project.characters.some(
                        (old) => old.id === c.id,
                      )
                        ? project.characters.map((old) =>
                            old.id === c.id ? merge(old) : old,
                          )
                        : [...project.characters, c],
                    },
                    true,
                  );
                  setActiveId(c.id);
                  setPoseId(c.poses[0].id);
                  setView("lab");
                  notify(`${c.name} is ready in the animation lab.`);
                }}
              />
            </Suspense>
          )}
          {view === "characters" && (
            <CharacterLibrary
              characters={project.characters}
              onSelect={(id) => {
                chooseCharacter(id);
                setView("lab");
              }}
              onAdd={() => setAdding(true)}
              onUpdate={updateCharacter}
              onRemove={removeCharacter}
              onNotice={notify}
            />
          )}
          {view === "scenes" && (
            <>
              <div className="page-heading scene-page-heading">
                <div>
                  <div className="eyebrow">YOUR STORY, SCENE BY SCENE</div>
                  <h1>
                    Scene builder<span>.</span>
                  </h1>
                  <p>
                    Set the stage. Find the words. Choose what happens next.
                  </p>
                </div>
                <button
                  className="button"
                  disabled={workspace.busy}
                  onClick={() => void exportGame()}
                >
                  {workspace.busy ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <Download size={16} />
                  )}{" "}
                  Export game
                </button>
              </div>
              <SceneEditor
                key={project.id}
                initialNodeId={selectedScene}
                project={project}
                onChange={change}
                onPlay={(startNodeId) => setPlaying({ startNodeId })}
                onRender={(startNodeId) => setRendering({ startNodeId })}
                onNotice={notify}
              />
            </>
          )}
          {view === "voice" && (
            <Suspense fallback={<LoadingView />}>
              <VoiceStudio
                key={project.id}
                project={project}
                onChange={change}
                onNotice={notify}
                onOpenScene={(id) => {
                  setSelectedScene(id);
                  setView("scenes");
                }}
              />
            </Suspense>
          )}
          {view === "data" && (
            <StoryData project={project} onChange={change} onNotice={notify} />
          )}
          {view === "guide" && (
            <Guide project={project} onChange={change} onView={setView} />
          )}
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <CheckCheck size={17} />
          <span>{notice}</span>
          <button aria-label="Dismiss message" onClick={() => setNotice("")}>
            <X size={14} />
          </button>
        </div>
      )}
      {adding && (
        <AddCharacter
          onClose={() => setAdding(false)}
          onAdd={(c) => {
            change(
              { ...project, characters: [...project.characters, c] },
              true,
            );
            setActiveId(c.id);
            setPoseId(c.poses[0].id);
            setAdding(false);
            setView("lab");
            notify(`${c.name} joined your character library.`);
          }}
        />
      )}
      {managingProjects && (
        <ProjectManager
          currentId={project.id}
          projects={workspace.projects}
          busy={workspace.busy}
          onOpen={(id) =>
            void workspace
              .openProject(id)
              .then(() => setManagingProjects(false))
          }
          onCreate={(kind) =>
            void workspace
              .createProject(kind)
              .then(() => setManagingProjects(false))
          }
          onCreateFromTemplate={(src) =>
            void workspace
              .createFromTemplate(src)
              .then(() => setManagingProjects(false))
          }
          onDuplicate={() =>
            void workspace
              .duplicateProject()
              .then(() => setManagingProjects(false))
          }
          onDelete={(id) => void workspace.deleteProject(id)}
          onClose={() => setManagingProjects(false)}
        />
      )}
      {rendering && (
        <Suspense fallback={<LoadingView />}>
          <RenderDialog
            project={project}
            startNodeId={rendering.startNodeId}
            onClose={() => setRendering(null)}
            onNotice={notify}
          />
        </Suspense>
      )}
      {playing && (
        <Suspense fallback={<LoadingView />}>
          <StoryPlayer
            project={project}
            startNodeId={playing.startNodeId}
            onClose={() => setPlaying(null)}
          />
        </Suspense>
      )}
      <input
        type="file"
        ref={importer}
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void workspace.importProjectFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function LoadingView() {
  return (
    <div className="view-loading" role="status">
      <LoaderCircle size={20} className="spin" /> Loading…
    </div>
  );
}
