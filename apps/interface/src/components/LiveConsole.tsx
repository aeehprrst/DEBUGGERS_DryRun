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

// The scout-start / scout-step / scout-end members of the engine's RunEvent
// union are deliberately absent here. Scouts are cut (CLAUDE.md §5) and nothing
// in the engine emits one, so carrying them in the client type only kept a
// panel and three feed strings alive that advertised a removed subsystem.
type RunEvent =
  | { t: "stage"; stage: RunStage; pct: number; status?: RunStatus }
  | { t: "state-found"; state: AppState }
  | { t: "action-found"; edge: ActionEdge }
  | { t: "error"; message: string; fatal: boolean };

// App Flow §3 — the statuses a run can be left in for good. A run already in
// one of these when the operator opens Live has nothing left to stream, and
// must not be bounced off the view it was asked for.
const TERMINAL_STATUSES: RunStatus[] = ["DONE", "FAILED", "DEGRADED", "CANCELLED"];

// The rail shows the four stages that do work; "done" is a terminal marker,
// not a row. Derived from the enum so a new stage cannot be added to the
// pipeline without appearing here.
const STAGES: RunStage[] = ["crawl", "chorus", "analysis", "tour"];

const MAX_FEED_LENGTH = 200;

function describeEvent(event: RunEvent): string {
  switch (event.t) {
    case "stage":
      return `Stage → ${event.stage} (${event.pct}%)`;
    case "state-found":
      return `State found: ${event.state.title} (${event.state.url})`;
    case "action-found":
      return `Action found: ${event.edge.action} "${event.edge.anchor.name}" (${event.edge.fromStateId} → ${event.edge.toStateId || "?"})`;
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
  const [viewMode, setViewMode] = useState<"3d" | "2d">("3d");

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | undefined;
    let redirectTimeout: ReturnType<typeof setTimeout> | undefined;

    // The auto-transition fires on the TRANSITION into a terminal status during
    // this mount, never on merely observing one. The SSE stream replays its
    // whole buffer to a late subscriber (sse.ts), so opening Live on a finished
    // run delivers the original DONE event again — which used to bounce the
    // operator straight back to Findings and made Live unreachable on any
    // completed run. So the run's status is read once before subscribing, and
    // the redirect is armed only if there was still something left to watch.
    let armed = false;

    const startStream = () => {
      source = new EventSource(`/api/runs/${runId}/events`);
      source.onmessage = onMessage;
    };

    const onMessage = (message: MessageEvent) => {
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
        if (event.status && TERMINAL_STATUSES.includes(event.status)) {
          // Nothing further will be emitted for this run, so stop listening
          // either way. Only the arming decides whether we also navigate.
          source?.close();

          // DONE only: Findings is where a finished run belongs, and a FAILED
          // or CANCELLED run has nothing to show there. Those stay on Live with
          // the partial graph, which is what App Flow §3 promises.
          if (armed && event.status === "DONE") {
            redirectTimeout = setTimeout(() => {
              // SHORTCUT (CLAUDE.md §6.6): this should land on the Atlas, which
              // is the run's natural resting screen. AT-01 is unbuilt, so
              // `?view=atlas` renders a stub string and the happy path would
              // dead-end on an empty view. Findings is the finished screen, so
              // it stands in. Point this back at `?view=atlas` as soon as the
              // Atlas renders real `AtlasNode` data from `GET /runs/:id/graph`;
              // nothing else in this file needs to change.
              //
              // `replace`, not `push`: Back from here should return to wherever
              // the operator was before Live, not bounce forward into this same
              // redirect again.
              router.replace(`/runs/${runId}?view=findings`);
            }, AUTO_TRANSITION_DELAY_MS);
          }
        }
      } else if (event.t === "state-found") {
        setDiscoveredStates((prev) => [...prev, event.state]);
      } else if (event.t === "action-found") {
        setEdges((prev) => [...prev, event.edge]);
      }
    };

    void (async () => {
      // Read the status before subscribing, so the buffered replay of a
      // finished run cannot be mistaken for a live transition. A failure here
      // leaves the redirect disarmed: staying on Live is the safe wrong answer,
      // because the operator can always click Findings, whereas a wrong
      // redirect takes the view away from them.
      try {
        const res = await fetch(`/api/runs/${runId}`);
        if (res.ok) {
          const run = (await res.json()) as { status?: RunStatus };
          armed = !!run.status && !TERMINAL_STATUSES.includes(run.status);
        }
      } catch {
        armed = false;
      }
      if (cancelled) return;
      startStream();
    })();

    return () => {
      cancelled = true;
      clearTimeout(redirectTimeout);
      source?.close();
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
                ? "border-marker bg-marker text-deep"
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
                ? "border-marker bg-marker text-deep"
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
        <section className="rounded-lg border border-rule bg-shelf p-5">
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
                          : "bg-abyss"
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

        {/* The "Scout feed" panel that used to sit here is deleted. Scouts are
            cut (CLAUDE.md §5, first item) and nothing emits a scout event, so
            the panel could only ever render "No scouts have reported in yet…" —
            dead UI advertising a removed subsystem. */}

        <section className="flex-1 rounded-lg border border-rule bg-shelf p-5">
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
