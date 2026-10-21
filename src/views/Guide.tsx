import { ArrowRight } from "lucide-react";
import type { Project } from "../engine";
import type { View } from "../studio/views";

export function Guide({
  project,
  onChange,
  onView,
}: {
  project: Project;
  onChange: (p: Project) => void;
  onView: (v: View) => void;
}) {
  return (
    <div className="guide-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">A PLACE TO BEGIN</div>
          <h1>
            Your story. Your studio<span>.</span>
          </h1>
          <p>Frame is a browser-native workspace for visual novel makers.</p>
        </div>
      </div>
      <div className="guide-hero">
        <span className="guide-star">✳</span>
        <div>
          <span className="eyebrow">FROM A CHARACTER TO A CONVERSATION</span>
          <h2>
            Small scenes.
            <br />
            Endless possibilities.
          </h2>
          <p>
            Experiment with expression and movement, write a branching scene,
            then take a playable story with you.
          </p>
          <button className="button primary" onClick={() => onView("scenes")}>
            Build your first scene <ArrowRight size={16} />
          </button>
        </div>
      </div>
      <div className="guide-steps">
        {[
          {
            n: "01",
            title: "Build your cast",
            text: "Import portraits and add expressions. Local character packs bring along their approved facial artwork and calibrated rigs.",
            view: "characters" as View,
          },
          {
            n: "02",
            title: "Find their voice",
            text: "Choose an ElevenLabs voice, write a line, and generate. Audio is analyzed once; reusable rigs animate from the real playback clock.",
            view: "lab" as View,
          },
          {
            n: "03",
            title: "Make a moment",
            text: "Connect dialogue and choices in the scene builder. Preview both paths and export a portable HTML game.",
            view: "scenes" as View,
          },
        ].map((s) => (
          <button
            key={s.n}
            className="guide-step"
            onClick={() => onView(s.view)}
          >
            <span>{s.n}</span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
            <ArrowRight size={17} />
          </button>
        ))}
      </div>
      <section className="panel project-settings">
        <h2>Project details</h2>
        <p>
          Your workspace saves automatically on this device. Export JSON to keep
          a backup of the editable project.
        </p>
        <label className="form-field">
          <span>Project title</span>
          <input
            value={project.title}
            maxLength={100}
            onChange={(e) => onChange({ ...project, title: e.target.value })}
          />
        </label>
        <label className="form-field">
          <span>Description</span>
          <textarea
            value={project.description}
            maxLength={2000}
            onChange={(e) =>
              onChange({ ...project, description: e.target.value })
            }
            rows={2}
          />
        </label>
        <div className="guide-facts">
          <div>
            <strong>Local by design</strong>
            <p>
              Projects live in this browser. Voice generation calls ElevenLabs
              through your local server.
            </p>
          </div>
          <div>
            <strong>Bring your own artwork</strong>
            <p>
              The original starter artwork is included. Optional local cast
              packs remain separate from the distributable studio.
            </p>
          </div>
          <div>
            <strong>A foundation for experimentation</strong>
            <p>
              Animation controllers, portable story data, and voice generation
              are separate modules. Extend one without replacing the others.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
