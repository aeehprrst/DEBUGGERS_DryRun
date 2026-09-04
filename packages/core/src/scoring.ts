import type { StateMetrics } from "./types.js";

// ---------- 8.1 Per-state metrics ----------

export function calculateDropout(entered: number, terminated: number): number {
  if (entered === 0) return 0;
  return terminated / entered;
}

export function calculateBlocked(entered: number, blocked: number): number {
  if (entered === 0) return 0;
  return blocked / entered;
}

export function calculateLoop(visitsPerPersona: number[]): number {
  if (visitsPerPersona.length === 0) return 0;
  const revisits = visitsPerPersona.map((visits) => Math.max(0, visits - 1));
  const meanRevisits = mean(revisits);
  return Math.min(meanRevisits, 5) / 5;
}

export function calculateDeadClick(
  deadInteractions: number,
  totalInteractions: number,
): number {
  if (totalInteractions === 0) return 0;
  return deadInteractions / totalInteractions;
}

// PRD §8.1 specifies "median steps before the first goal-advancing action,
// squashed to 0-1" without a formula. We use x/(x+k), a simple monotonic
// saturating curve where hesitation = 0.5 at the k-step mark.
const HESITATION_HALF_SATURATION_STEPS = 4;

export function calculateHesitation(stepsBeforeGoalAction: number[]): number {
  if (stepsBeforeGoalAction.length === 0) return 0;
  const medianSteps = median(stepsBeforeGoalAction);
  return medianSteps / (medianSteps + HESITATION_HALF_SATURATION_STEPS);
}

export function calculateBacktrack(
  reverseEdgeTraversals: number,
  totalExits: number,
): number {
  if (totalExits === 0) return 0;
  return reverseEdgeTraversals / totalExits;
}

// ---------- 8.2 Friction Score ----------

export const FRICTION_WEIGHTS = {
  dropout: 0.35,
  blocked: 0.2,
  loop: 0.15,
  deadClick: 0.12,
  hesitation: 0.1,
  backtrack: 0.08,
} as const;

export type FrictionMetrics = Pick<
  StateMetrics,
  "dropout" | "blocked" | "loop" | "deadClick" | "hesitation" | "backtrack"
>;

export function calculateFrictionScore(metrics: FrictionMetrics): number {
  return (
    100 *
    (FRICTION_WEIGHTS.dropout * metrics.dropout +
      FRICTION_WEIGHTS.blocked * metrics.blocked +
      FRICTION_WEIGHTS.loop * metrics.loop +
      FRICTION_WEIGHTS.deadClick * metrics.deadClick +
      FRICTION_WEIGHTS.hesitation * metrics.hesitation +
      FRICTION_WEIGHTS.backtrack * metrics.backtrack)
  );
}

// ---------- 8.3 Fix Value ----------

export function calculateFixValue(
  impact: number,
  reach: number,
  confidence: number,
): number {
  return impact * reach * confidence;
}

// ---------- internal helpers ----------

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
