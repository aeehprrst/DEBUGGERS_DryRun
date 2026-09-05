"use client";

import type { ActionEdge, AppState } from "@dry-run/core";
import { useMemo, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from "d3-force-3d";
import AtlasInspector from "./AtlasInspector";

const WIDTH = 760;
const HEIGHT = 440;
const NODE_RADIUS = 20;

// d3-force-3d has no published types (see src/types.d.ts) — this is the
// shape *we* give every simulated node/link; the library only ever sees it
// through untyped calls, so these fields are what keep the rest of this
// file honest.
type SimNode = {
  id: string;
  title: string;
  url: string;
  x: number;
  y: number;
};

type SimLink = {
  source: string | SimNode;
  target: string | SimNode;
};

function truncate(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

export default function Atlas2D({
  nodes,
  edges,
}: {
  nodes: AppState[];
  edges: ActionEdge[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { positionedNodes, positionedLinks } = useMemo(() => {
    if (nodes.length === 0) {
      return { positionedNodes: [] as SimNode[], positionedLinks: [] as SimLink[] };
    }

    const simNodes: SimNode[] = nodes.map((state) => ({
      id: state.id,
      title: state.title,
      url: state.url,
      x: 0,
      y: 0,
    }));

    const knownIds = new Set(simNodes.map((n) => n.id));
    // forceLink throws on an id it can't resolve — an action-found edge can
    // legitimately race ahead of its target's state-found event over SSE.
    const simLinks: SimLink[] = edges
      .filter(
        (edge) =>
          edge.toStateId &&
          edge.toStateId !== edge.fromStateId &&
          knownIds.has(edge.fromStateId) &&
          knownIds.has(edge.toStateId),
      )
      .map((edge) => ({ source: edge.fromStateId, target: edge.toStateId }));

    const simulation = forceSimulation(simNodes, 2)
      .force("charge", forceManyBody().strength(-260))
      .force(
        "link",
        forceLink(simLinks)
          .id((d: SimNode) => d.id)
          .distance(130),
      )
      .force("center", forceCenter(WIDTH / 2, HEIGHT / 2))
      .force("collide", forceCollide(NODE_RADIUS + 14))
      .stop();

    simulation.tick(300);

    return { positionedNodes: simNodes, positionedLinks: simLinks };
  }, [nodes, edges]);

  const selectedState = nodes.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="relative h-full min-h-[440px] overflow-hidden rounded-lg border border-rule bg-shelf">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-full w-full"
        role="img"
        aria-label={
          nodes.length === 0
            ? "Atlas: no screens discovered yet"
            : `Atlas: ${nodes.length} screens discovered, ${positionedLinks.length} transitions mapped`
        }
      >
        {nodes.length === 0 ? (
          <text
            x={WIDTH / 2}
            y={HEIGHT / 2}
            textAnchor="middle"
            className="fill-ink-2 text-sm"
          >
            Waiting for the crawler to find the first screen…
          </text>
        ) : (
          <>
            {positionedLinks.map((link, i) => {
              const source = link.source as SimNode;
              const target = link.target as SimNode;
              return (
                <line
                  key={i}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke="rgba(234, 230, 223, 0.24)"
                  strokeWidth={1.5}
                />
              );
            })}

            {positionedNodes.map((node) => {
              const isSelected = node.id === selectedId;
              const ringColor = isSelected ? "#FF7A45" : "#8FC7D6";
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`${node.title} — ${node.url}`}
                  className="cursor-pointer outline-none"
                  onClick={() => setSelectedId((prev) => (prev === node.id ? null : node.id))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedId((prev) => (prev === node.id ? null : node.id));
                    }
                  }}
                >
                  {/* contour rings — decorative until real friction metrics exist */}
                  <circle r={NODE_RADIUS + 16} fill="none" stroke={ringColor} strokeOpacity={0.15} />
                  <circle r={NODE_RADIUS + 8} fill="none" stroke={ringColor} strokeOpacity={0.25} />
                  <circle
                    r={NODE_RADIUS}
                    fill="#17303E"
                    stroke={ringColor}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                  />
                  <text
                    y={NODE_RADIUS + 16}
                    textAnchor="middle"
                    className="select-none fill-ink-0 font-sans text-[10px] font-semibold uppercase tracking-[0.06em]"
                  >
                    {truncate(node.title || node.url, 18)}
                  </text>
                </g>
              );
            })}
          </>
        )}
      </svg>

      <AtlasInspector state={selectedState} onClose={() => setSelectedId(null)} />
    </div>
  );
}
