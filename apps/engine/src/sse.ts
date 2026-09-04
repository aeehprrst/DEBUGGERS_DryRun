import { EventEmitter } from "node:events";
import type {
  ActionEdge,
  AppState,
  DecisionSource,
  RunStage,
  RunStatus,
} from "@dry-run/core";

export type ScoutStepEvent = {
  index: number;
  stateId: string;
  decisionSource: DecisionSource;
  action: ActionEdge | null;
  thought: string;
};

export type RunEvent =
  // `status` is optional and only set at the one transition where it
  // actually changes alongside `stage` (end of analysis, App Flow §3's
  // ANALYSING → DONE) — every other stage transition leaves Run.status
  // untouched, so this stays absent there rather than repeating a stale value.
  | { t: "stage"; stage: RunStage; pct: number; status?: RunStatus }
  | { t: "state-found"; state: AppState }
  | { t: "action-found"; edge: ActionEdge }
  | { t: "scout-start"; personaId: string; label: string }
  | { t: "scout-step"; personaId: string; step: ScoutStepEvent }
  | { t: "scout-end"; personaId: string; result: string }
  | { t: "chorus-done"; populationSize: number; completionRate: number }
  | { t: "error"; message: string; fatal: boolean };

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

// A fast/small crawl (e.g. the local demo app) can finish — and emit every
// event — before a browser's EventSource has finished connecting through the
// Next.js rewrite. Without a replay buffer, a subscriber that arrives late
// sees nothing but silence, even though the run genuinely produced data.
const eventLog = new Map<string, RunEvent[]>();

export function emitRunEvent(runId: string, event: RunEvent) {
  const log = eventLog.get(runId);
  if (log) {
    log.push(event);
  } else {
    eventLog.set(runId, [event]);
  }
  emitter.emit(runId, event);
}

export function subscribeToRun(
  runId: string,
  onEvent: (event: RunEvent) => void,
) {
  for (const event of eventLog.get(runId) ?? []) {
    onEvent(event);
  }
  emitter.on(runId, onEvent);
  return () => {
    emitter.off(runId, onEvent);
  };
}
