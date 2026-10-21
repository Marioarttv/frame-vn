import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, X } from "lucide-react";
import { insertScriptNodes, parseScript, type Project } from "../../engine";

const EXAMPLE = `# The meeting
@bg The atrium
@stage Mira right
@weather dust
Mira: You came after all.
Noah (neutral): I almost didn't.
Mira: Then let's not waste the evening.
* Walk outside -> Outside
* Stay in -> Inside

# Outside
The night air is cold and bright.
-> Ending

# Inside
Noah: Tell me a story.

# Ending
@end The evening ends, but the story doesn't.`;

interface Props {
  project: Project;
  afterNodeId?: string;
  onClose: () => void;
  onImport: (
    project: Project,
    firstNodeId: string | undefined,
    count: number,
  ) => void;
}

export function ScriptImport({
  project,
  afterNodeId,
  onClose,
  onImport,
}: Props) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
  const after = project.nodes.find((node) => node.id === afterNodeId);
  const result = useMemo(
    () =>
      text.trim()
        ? parseScript(text, project, { backgroundId: after?.backgroundId })
        : null,
    [text, project, after?.backgroundId],
  );
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    area.current?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeHandler.current();
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
      previous?.focus();
    };
  }, []);
  const continues = after?.type === "dialogue" && !after.nextId;
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal script-import"
        role="dialog"
        aria-modal="true"
        aria-labelledby="script-import-title"
      >
        <button
          className="modal-close icon-button"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <div className="eyebrow">FROM YOUR SCRIPT</div>
        <h2 id="script-import-title">Import a script</h2>
        <p>
          Paste screenplay-style lines. Each line becomes a scene; characters,
          expressions, backgrounds and music are matched by name.
        </p>
        <div className="script-columns">
          <div className="form-field">
            <span className="field-label-row">
              <label htmlFor="script-text">Script</label>
              <button
                type="button"
                className="text-button"
                onClick={() => setText(EXAMPLE)}
              >
                Insert example
              </button>
            </span>
            <textarea
              id="script-text"
              ref={area}
              rows={16}
              value={text}
              spellCheck
              onChange={(event) => setText(event.target.value)}
              placeholder={"Mira: Hello there.\nThe lights flicker."}
            />
          </div>
          <div className="script-help">
            <strong>Format</strong>
            <dl>
              <dt>Name: line</dt>
              <dd>A character speaks</dd>
              <dt>Name (expression): line</dt>
              <dd>…with an expression</dd>
              <dt>Plain text</dt>
              <dd>Narration</dd>
              <dt># Label</dt>
              <dd>Names the next scene</dd>
              <dt>* Choice -&gt; Label</dt>
              <dd>Turns the line above into a choice</dd>
              <dt>-&gt; Label</dt>
              <dd>Jump instead of continuing</dd>
              <dt>@bg / @music / @sfx Name</dt>
              <dd>Background, music (or “stop”), effect</dd>
              <dt>@end text</dt>
              <dd>An ending</dd>
              <dt>@stage Mira left, Noah right</dt>
              <dd>Keeps everyone on stage; speakers join</dd>
              <dt>@enter / @exit Name</dt>
              <dd>Someone arrives or leaves</dd>
              <dt>@gesture Name nod</dt>
              <dd>A one-off gesture on the next line</dd>
              <dt>@weather / @grade / @textbox / @effect / @motion</dt>
              <dd>Look until changed (“none” resets)</dd>
              <dt>@camera 1.4 Name · @camera wide</dt>
              <dd>Close-up or wide shot</dd>
              <dt>@transition iris · @shake heavy</dt>
              <dd>One-offs for the next line</dd>
              <dt>{"{wait=0.5} {expression=Angry} {shake}"}</dt>
              <dd>Timed direction inside a line</dd>
            </dl>
          </div>
        </div>
        {result && (
          <div className="script-report" role="status">
            {result.errors.length ? (
              <ul className="script-errors">
                {result.errors.slice(0, 8).map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            ) : (
              <p>
                {result.nodes.length} scene
                {result.nodes.length === 1 ? "" : "s"} ready
                {continues
                  ? `, continuing from “${after?.label}”.`
                  : `. They are added after “${after?.label ?? "the last scene"}”; connect the first one where it belongs.`}
              </p>
            )}
            {result.warnings.length > 0 && (
              <ul className="script-warnings">
                {result.warnings.slice(0, 6).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="modal-footer">
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={!result || !!result.errors.length || !result.nodes.length}
            onClick={() =>
              result &&
              onImport(
                insertScriptNodes(project, result.nodes, afterNodeId),
                result.nodes[0]?.id,
                result.nodes.length,
              )
            }
          >
            <FileText size={15} /> Import scenes
          </button>
        </div>
      </div>
    </div>
  );
}
