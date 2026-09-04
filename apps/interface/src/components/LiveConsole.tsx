"use client";

import type { ActionEdge, AppState, RunStage, RunStatus } from "@dry-run/core";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Atlas2D from "./Atlas2D";
import Atlas3D from "./Atlas3D";

// App Flow §3 / §6 — the engine's state machine reaches `status: "DONE"`
// exactly once, at the same moment `stage` moves to "tour" (there's no
// stage actually named "done" in this implementation — see analysis.ts).
// That's the real auto-transition signal, not `stage === "done"`.
const AUTO_TRANSITION_DELAY_MS = 800;

type ScoutStepEvent = {
  index: number;
  stateId: string;
  decisionSource: "heuristic" | "model" | "fallback";
  thought: string;
};

type RunEvent =
  | { t: "stage"; stage: RunStage; pct: number; status?: RunStatus }
  | { t: "state-found"; state: AppState }
  | { t: "action-found"; edge: ActionEdge }
  | { t: "scout-start"; personaId: string; label: string }
  | { t: "scout-step"; personaId: string; step: ScoutStepEvent }
  | { t: "scout-end"; personaId: string; result: string }
  | { t: "error"; message: string; fatal: boolean };

const STAGES: RunStage[] = [
  "crawl",
  "scouts",
  "calibration",
  "chorus",
  "analysis",
  "tour",
  "done",
];

const MAX_FEED_LENGTH = 200;

function describeEvent(event: RunEvent): string {
  switch (event.t) {
    case "stage":
      return `Stage → ${event.stage} (${event.pct}%)`;
    case "state-found":
      return `State found: ${event.state.title} (${event.state.url})`;
    case "action-found":
      return `Action found: ${event.edge.action} "${event.edge.anchor.name}" (${event.edge.fromStateId} → ${event.edge.toStateId || "?"})`;
    case "scout-start":
      return `Scout started: ${event.label}`;
    case "scout-step":
      return `Scout step ${event.step.index} @ ${event.step.stateId}: ${event.step.thought}`;
    case "scout-end":
      return `Scout ended: ${event.result}`;
    case "error":
      return `Error: ${event.message}`;
  }
}

export default function LiveConsole({ runId }: { runId: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<RunStage | null>(null);
  const [progressPct, setProgressPct] = useState(0);
  const [discoveredStates, setDiscoveredStates] = useState<AppState[]>([]);
  const [edges, setEdges] = useState<ActionEdge[]>([]);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [scoutSteps, setScoutSteps] = useState<ScoutStepEvent[]>([]);
  const [viewMode, setViewMode] = useState<"3d" | "2d">("3d");

  useEffect(() => {
    const source = new EventSource(`/api/runs/${runId}/events`);
    let redirectTimeout: ReturnType<typeof setTimeout> | undefined;

    source.onmessage = (message) => {
      let event: RunEvent;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }

      setEvents((prev) => [...prev, event].slice(-MAX_FEED_LENGTH));

      if (event.t === "stage") {
        setStage(event.stage);
        setProgressPct(event.pct);
        if (event.status === "DONE") {
          // The pipeline has nothing left to run automatically — stop
          // listening immediately, then hand off to the Atlas view after a
          // brief settle so the last live update isn't cut off mid-render.
          source.close();
          redirectTimeout = setTimeout(() => {
            // `replace`, not `push`: Back from Atlas should return to
            // wherever the operator was before Live, not bounce forward
            // into this same redirect again.
            router.replace(`/runs/${runId}?view=atlas`);
          }, AUTO_TRANSITION_DELAY_MS);
        }
      } else if (event.t === "state-found") {
        setDiscoveredStates((prev) => [...prev, event.state]);
      } else if (event.t === "action-found") {
        setEdges((prev) => [...prev, event.edge]);
      } else if (event.t === "scout-step") {
        setScoutSteps((prev) => [...prev, event.step].slice(-MAX_FEED_LENGTH));
      }
    };

    return () => {
      clearTimeout(redirectTimeout);
      source.close();
    };
  }, [runId, router]);

  return (
    <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-2">
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={() => setViewMode("3d")}
            aria-pressed={viewMode === "3d"}
            className={`rounded-md border px-3 py-1 text-xs font-semibold uppercase tracking-[0.06em] ${
              viewMode === "3d"
                ? "border-marker bg-marker text-chart-deep"
                : "border-rule-strong text-ink-1 hover:text-ink-0"
            }`}
          >
            3D
          </button>
          <button
            type="button"
            onClick={() => setViewMode("2d")}
            aria-pressed={viewMode === "2d"}
            className={`rounded-md border px-3 py-1 text-xs font-semibold uppercase tracking-[0.06em] ${
              viewMode === "2d"
                ? "border-marker bg-marker text-chart-deep"
                : "border-rule-strong text-ink-1 hover:text-ink-0"
            }`}
          >
            2D
          </button>
        </div>
        {viewMode === "3d" ? (
          <Atlas3D nodes={discoveredStates} edges={edges} />
        ) : (
          <Atlas2D nodes={discoveredStates} edges={edges} />
        )}
      </div>

      <div className="flex flex-col gap-6">
        <section className="rounded-lg border border-rule bg-chart-shelf p-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-1">
            Stage
          </h2>
          <ul className="mt-3 space-y-2">
            {STAGES.map((s) => {
              const isCurrent = s === stage;
              const isPast =
                stage !== null && STAGES.indexOf(s) < STAGES.indexOf(stage);
              return (
                <li key={s} className="flex items-center gap-2 text-sm">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      isCurrent
                        ? "bg-marker"
                        : isPast
                          ? "bg-flow"
                          : "bg-chart-abyss"
                    }`}
                  />
                  <span className={isCurrent ? "text-ink-0" : "text-ink-2"}>
                    {s}
                  </span>
                  {isCurrent && (
                    <span className="ml-auto font-mono text-xs text-ink-1">
                      {progressPct}%
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-lg border border-rule bg-chart-shelf p-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-1">
            Scout feed
          </h2>
          <ul
            aria-live="polite"
            className="mt-3 max-h-[240px] space-y-2 overflow-y-auto text-sm"
          >
            {scoutSteps.length === 0 ? (
              <li className="text-ink-2">No scouts have reported in yet…</li>
            ) : (
              scoutSteps.map((step, index) => (
                <li
                  key={index}
                  className="rounded-md border-l-2 border-flow bg-chart-shoal px-3 py-2"
                >
                  <p className="text-ink-0">{step.thought}</p>
                  <p className="mt-1 font-mono text-[11px] text-ink-2">
                    {step.stateId} · {step.decisionSource}
                  </p>
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="flex-1 rounded-lg border border-rule bg-chart-shelf p-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-1">
            Event feed
          </h2>
          <ul className="mt-3 max-h-[480px] space-y-1 overflow-y-auto font-mono text-xs">
            {events.length === 0 ? (
              <li className="text-ink-2">Connecting…</li>
            ) : (
              events.map((event, index) => (
                <li
                  key={index}
                  className="border-b border-rule py-1 text-ink-1 last:border-b-0"
                >
                  {describeEvent(event)}
                </li>
              ))
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
