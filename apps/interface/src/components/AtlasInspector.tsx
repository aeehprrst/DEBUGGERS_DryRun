"use client";

import type { AppState } from "@dry-run/core";

// Shared between Atlas2D and Atlas3D so "clicking a node opens the same
// Inspector" is literally true — one component, not a visual echo of it.
export default function AtlasInspector({
  state,
  onClose,
}: {
  state: AppState | null;
  onClose: () => void;
}) {
  if (!state) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 border-t border-rule-strong bg-chart-shoal p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-ink-0">{state.title}</p>
          <p className="font-mono text-xs text-ink-1">{state.url}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-ink-2 hover:text-ink-0"
          aria-label="Close inspector"
        >
          ✕
        </button>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 font-mono text-xs text-ink-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.08em]">Friction</p>
          <p className="text-ink-1">—</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.08em]">Fix value</p>
          <p className="text-ink-1">—</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.08em]">Dropout</p>
          <p className="text-ink-1">—</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.08em]">Provenance</p>
          <p className="text-ink-1">—</p>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-ink-2">
        Metrics land once Analysis runs — not yet available for this run.
      </p>
    </div>
  );
}
