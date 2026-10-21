import { useMemo } from "react";
import {
  CircleAlert,
  Flag,
  GitBranch,
  GitFork,
  MessageSquare,
} from "lucide-react";
import {
  nodeTargets,
  plainText,
  type Project,
  type ValidationIssue,
} from "../../engine";
import type { StoryNode } from "../../engine/types";

const WIDTH = 200;
const HEIGHT = 72;
const GAP_X = 132;
const GAP_Y = 22;
const PAD = 28;
const ICONS = {
  dialogue: MessageSquare,
  choice: GitBranch,
  branch: GitFork,
  end: Flag,
};

interface Placed {
  node: StoryNode;
  index: number;
  column: number;
  row: number;
  x: number;
  y: number;
}

/** Columns follow the shortest path from the opening scene; unreachable scenes sit last. */
export function layoutStory(project: Project): Placed[] {
  const byId = new Map(project.nodes.map((node) => [node.id, node]));
  const depth = new Map<string, number>();
  const queue: string[] = [];
  if (byId.has(project.startNodeId)) {
    depth.set(project.startNodeId, 0);
    queue.push(project.startNodeId);
  }
  while (queue.length) {
    const id = queue.shift()!;
    for (const target of nodeTargets(byId.get(id)!))
      if (byId.has(target) && !depth.has(target)) {
        depth.set(target, depth.get(id)! + 1);
        queue.push(target);
      }
  }
  const lastColumn = Math.max(-1, ...depth.values()) + 1;
  const rows = new Map<number, number>();
  return project.nodes.map((node, index) => {
    const column = depth.get(node.id) ?? lastColumn;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return {
      node,
      index,
      column,
      row,
      x: PAD + column * (WIDTH + GAP_X),
      y: PAD + row * (HEIGHT + GAP_Y),
    };
  });
}

export function StoryMap({
  project,
  selectedId,
  issues,
  onSelect,
}: {
  project: Project;
  selectedId?: string;
  issues: ValidationIssue[];
  onSelect: (id: string) => void;
}) {
  const placed = useMemo(() => layoutStory(project), [project]);
  const byId = new Map(placed.map((item) => [item.node.id, item]));
  const troubled = new Set(
    issues
      .map((issue) => /^nodes\[(\d+)\]/.exec(issue.path)?.[1])
      .filter(Boolean)
      .map(Number),
  );
  const width = Math.max(...placed.map((item) => item.x)) + WIDTH + PAD;
  const height = Math.max(...placed.map((item) => item.y)) + HEIGHT + PAD + 40;
  const edges = placed.flatMap((from) =>
    nodeTargets(from.node).flatMap((target, k) => {
      const to = byId.get(target);
      if (!to) return [];
      const label =
        from.node.type === "choice"
          ? from.node.choices[k]?.text
          : from.node.type === "branch"
            ? k < from.node.branches.length
              ? `if #${k + 1}`
              : "else"
            : "";
      return [{ from, to, label, key: `${from.node.id}-${k}` }];
    }),
  );
  const unreachable = placed.filter(
    (item) =>
      !edges.some((edge) => edge.to === item) &&
      item.node.id !== project.startNodeId,
  );
  return (
    <div className="story-map" aria-label="Story map">
      <div className="story-map-legend">
        <span>
          <MessageSquare size={12} /> Dialogue
        </span>
        <span>
          <GitBranch size={12} /> Player choice
        </span>
        <span>
          <GitFork size={12} /> Condition branch
        </span>
        <span>
          <Flag size={12} /> Ending
        </span>
        {unreachable.length > 0 && (
          <span className="map-warning">
            <CircleAlert size={12} /> {unreachable.length} scene
            {unreachable.length === 1 ? " is" : "s are"} not reachable
          </span>
        )}
      </div>
      <div className="story-map-canvas" style={{ width, height }}>
        <svg width={width} height={height} aria-hidden="true">
          <defs>
            <marker
              id="map-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="#9aae82" />
            </marker>
          </defs>
          {edges.map(({ from, to, label, key }) => {
            const forward = to.column > from.column;
            const x1 = from.x + WIDTH;
            const y1 = from.y + HEIGHT / 2;
            const x2 = to.x;
            const y2 = to.y + HEIGHT / 2;
            // Loops and backward jumps arc beneath the scenes so they stay readable.
            const path = forward
              ? `M${x1},${y1} C${x1 + GAP_X / 2},${y1} ${x2 - GAP_X / 2},${y2} ${x2},${y2}`
              : `M${from.x + WIDTH / 2},${from.y + HEIGHT} C${from.x + WIDTH / 2},${Math.max(from.y, to.y) + HEIGHT + 60} ${to.x + WIDTH / 2},${Math.max(from.y, to.y) + HEIGHT + 60} ${to.x + WIDTH / 2},${to.y + HEIGHT}`;
            return (
              <g key={key} className={forward ? "edge" : "edge is-back"}>
                <path d={path} markerEnd="url(#map-arrow)" />
                {label && forward && (
                  <text
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 - 6}
                    textAnchor="middle"
                  >
                    {label.length > 20 ? `${label.slice(0, 19)}…` : label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {placed.map(({ node, index, x, y }) => {
          const Icon = ICONS[node.type];
          return (
            <button
              key={node.id}
              className={`map-node type-${node.type} ${node.id === selectedId ? "is-selected" : ""} ${troubled.has(index) ? "has-issue" : ""}`}
              style={{ left: x, top: y, width: WIDTH, height: HEIGHT }}
              onClick={() => onSelect(node.id)}
              aria-label={`Open scene ${index + 1}: ${node.label || "Untitled scene"}`}
            >
              <span className="map-node-top">
                <Icon size={12} />
                <span>{String(index + 1).padStart(2, "0")}</span>
                {node.id === project.startNodeId && (
                  <span className="start-label">START</span>
                )}
                {troubled.has(index) && (
                  <CircleAlert size={12} className="map-issue" />
                )}
              </span>
              <strong>{node.label || "Untitled scene"}</strong>
              <span className="map-node-text">
                {node.type === "branch"
                  ? "Routes by story state"
                  : plainText(node.text) || "—"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
