"use client";

import type { ActionEdge, AppState } from "@dry-run/core";
import { Component, Suspense, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Line, OrbitControls, QuadraticBezierLine, useTexture } from "@react-three/drei";
import * as THREE from "three";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from "d3-force-3d";
import AtlasInspector from "./AtlasInspector";

const NODE_WIDTH = 2.4;
const NODE_HEIGHT = 1.5;

// d3-force-3d has no published types (see src/types.d.ts) — same convention
// as Atlas2D: this is the shape *we* give the simulation, never mutating the
// caller's AppState objects directly.
type SimNode = {
  id: string;
  x: number;
  y: number;
  z: number;
};

type SimLink = {
  source: string | SimNode;
  target: string | SimNode;
};

function layoutIn3D(nodes: AppState[], edges: ActionEdge[]) {
  if (nodes.length === 0) {
    return { positionedNodes: [] as SimNode[], positionedLinks: [] as SimLink[] };
  }

  const simNodes: SimNode[] = nodes.map((state) => ({ id: state.id, x: 0, y: 0, z: 0 }));
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

  const simulation = forceSimulation(simNodes, 3) // 3D this time, unlike Atlas2D's 2
    .force("charge", forceManyBody().strength(-30))
    .force("link", forceLink(simLinks).id((d: SimNode) => d.id).distance(6))
    .force("center", forceCenter(0, 0, 0))
    .force("collide", forceCollide(2))
    .stop();

  simulation.tick(300);

  return { positionedNodes: simNodes, positionedLinks: simLinks };
}

// Textures load from disk and can 404 (a state discovered moments ago, or a
// screenshot path from a different run) — this is what keeps that from
// taking the whole canvas down.
class TextureErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function ScreenshotMaterial({ path }: { path: string }) {
  const texture = useTexture(path);
  return <meshBasicMaterial map={texture} toneMapped={false} side={THREE.DoubleSide} />;
}

function PlaceholderMaterial() {
  return <meshBasicMaterial color="#17303E" side={THREE.DoubleSide} />;
}

function Node3D({
  state,
  position,
  isSelected,
  onSelect,
}: {
  state: AppState;
  position: [number, number, number];
  isSelected: boolean;
  onSelect: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  // "Billboarded on the Y axis only" (UI/UX §7.3) — face the camera's
  // horizontal direction every frame, but never tilt up/down, so the chart
  // layout stays readable rather than every node facing straight at you.
  useFrame(({ camera }) => {
    if (!meshRef.current) return;
    const dx = camera.position.x - meshRef.current.position.x;
    const dz = camera.position.z - meshRef.current.position.z;
    meshRef.current.rotation.y = Math.atan2(dx, dz);
  });

  const ringColor = isSelected ? "#FF7A45" : "#8FC7D6";

  return (
    <group position={position}>
      {/* plumb line down to the chart plane — makes elevation legible */}
      <Line points={[[0, 0, 0], [0, -position[1], 0]]} color="#6E7A80" lineWidth={1} transparent opacity={0.35} />

      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        <planeGeometry args={[NODE_WIDTH, NODE_HEIGHT]} />
        {state.screenshotPath ? (
          <TextureErrorBoundary fallback={<PlaceholderMaterial />}>
            <Suspense fallback={<PlaceholderMaterial />}>
              <ScreenshotMaterial path={state.screenshotPath} />
            </Suspense>
          </TextureErrorBoundary>
        ) : (
          <PlaceholderMaterial />
        )}
      </mesh>

      {/* emissive-ish border in the friction ramp colour, per TRD §5.10 —
          a plain outline since bloom/emissive materials are out of scope here */}
      <lineSegments position={[0, 0, 0.01]}>
        <edgesGeometry args={[new THREE.PlaneGeometry(NODE_WIDTH, NODE_HEIGHT)]} />
        <lineBasicMaterial color={ringColor} linewidth={isSelected ? 2 : 1} />
      </lineSegments>
    </group>
  );
}

export default function Atlas3D({
  nodes,
  edges,
}: {
  nodes: AppState[];
  edges: ActionEdge[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { positionedNodes, positionedLinks } = useMemo(() => layoutIn3D(nodes, edges), [nodes, edges]);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const selectedState = nodes.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="relative h-full min-h-[440px] overflow-hidden rounded-lg border border-rule bg-shelf">
      {nodes.length === 0 ? (
        <div className="flex h-full min-h-[440px] items-center justify-center text-sm text-ink-2">
          Waiting for the crawler to find the first screen…
        </div>
      ) : (
        <Canvas camera={{ position: [0, 6, 16], fov: 45 }}>
          <ambientLight intensity={0.6} color="#4E7E8C" />
          <directionalLight position={[4, 8, 6]} intensity={0.7} color="#EDE4D3" />
          <gridHelper args={[40, 40, "#1F3D4D", "#0A1620"]} />

          {positionedNodes.map((simNode) => {
            const state = nodeById.get(simNode.id);
            if (!state) return null;
            // AppState carries no frictionScore yet — that lives on
            // StateMetrics, produced by Chorus/Analysis, not threaded
            // through the live SSE graph state. Elevation defaults to 0
            // until that wiring exists, same honesty as Atlas2D's metrics.
            const frictionScore = 0;
            const elevation = (frictionScore / 100) * 6;
            return (
              <Node3D
                key={simNode.id}
                state={state}
                position={[simNode.x, elevation, simNode.z]}
                isSelected={simNode.id === selectedId}
                onSelect={() => setSelectedId((prev) => (prev === simNode.id ? null : simNode.id))}
              />
            );
          })}

          {positionedLinks.map((link, i) => {
            const source = link.source as SimNode;
            const target = link.target as SimNode;
            const mid: [number, number, number] = [
              (source.x + target.x) / 2,
              Math.max(source.y, target.y) + 1,
              (source.z + target.z) / 2,
            ];
            return (
              <QuadraticBezierLine
                key={i}
                start={[source.x, source.y, source.z]}
                end={[target.x, target.y, target.z]}
                mid={mid}
                color="#8FC7D6"
                lineWidth={1}
                transparent
                opacity={0.3}
              />
            );
          })}

          <OrbitControls enableDamping dampingFactor={0.08} minDistance={8} maxDistance={60} />
        </Canvas>
      )}

      <AtlasInspector state={selectedState} onClose={() => setSelectedId(null)} />
    </div>
  );
}
