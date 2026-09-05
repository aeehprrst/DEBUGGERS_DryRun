import type { Provenance } from "./enums.js";
import type {
  SegmentStateMetrics,
  StateMetrics,
  StateMetricsBase,
} from "./types.js";

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

// ---------- 8.1b Assembling a StateMetrics from raw counters ----------

/**
 * The raw per-state tallies a walk produces. Chorus's accumulator maps onto
 * this one-for-one; it lives here so that the population as a whole and each
 * segment (CH-04) are reduced by the *same* code rather than by two copies of
 * the same six formulas that can drift apart (CLAUDE.md §6.3's one-ramp rule,
 * applied to scoring).
 */
export type StateMetricsCounters = {
  /** Arrival events, not distinct personas. */
  entered: number;
  /** Personas that gave up here. */
  terminated: number;
  blocked: number;
  /** One entry per distinct persona that visited, so `.length` is the sample. */
  visitsPerPersona: number[];
  deadInteractions: number;
  totalInteractions: number;
  stepsBeforeGoalAction: number[];
  reverseEdgeTraversals: number;
  totalExits: number;
};

/**
 * PRD §6.1 + §6.2 over one set of counters. Extracted verbatim from Chorus so
 * per-segment metrics reuse it; the arithmetic and its order are unchanged.
 *
 * `provenance` is a parameter rather than a literal so that CH-05 (provenance
 * per L6) changes its caller and not this function. Chorus passes "modeled".
 */
export function buildStateMetrics(
  counters: StateMetricsCounters,
  simulated: number,
  provenance: Provenance,
): StateMetricsBase {
  const dropout = calculateDropout(counters.entered, counters.terminated);
  const blocked = calculateBlocked(counters.entered, counters.blocked);
  const loop = calculateLoop(counters.visitsPerPersona);
  const deadClick = calculateDeadClick(
    counters.deadInteractions,
    counters.totalInteractions,
  );
  const hesitation = calculateHesitation(counters.stepsBeforeGoalAction);
  const backtrack = calculateBacktrack(
    counters.reverseEdgeTraversals,
    counters.totalExits,
  );

  const frictionScore = calculateFrictionScore({
    dropout,
    blocked,
    loop,
    deadClick,
    hesitation,
    backtrack,
  });

  // No Analysis stage yet to supply real impact/reach/confidence — reach
  // is share of population that arrived here, impact is normalised
  // friction, confidence scales with sample size. A defensible proxy, not
  // a faked constant. `entered` counts arrival *events*, not unique
  // personas — a heavily-looped state can rack up more arrivals than
  // there are personas, so this must be clamped to stay a fraction.
  const reach = simulated > 0 ? Math.min(1, counters.entered / simulated) : 0;
  const impact = frictionScore / 100;
  const confidence = Math.min(1, counters.entered / 50);
  const fixValue = calculateFixValue(impact, reach, confidence);

  return {
    frictionScore,
    fixValue,
    dropout,
    blocked,
    loop,
    deadClick,
    hesitation,
    backtrack,
    impact,
    reach,
    confidence,
    provenance,
  };
}

/**
 * CH-04 — one segment's record for one state.
 *
 * Below `minSamplePersonas` distinct personas this returns `metrics: null`, not
 * a zero-filled object. This is the same instinct as `jargonScoreForNames`
 * returning null below four names: a ratio over three walks is a rounding
 * artifact, and rendering it as a measured 0.00 dropout would say the screen
 * was easy for a segment we barely observed on it (CLAUDE.md §6.5). The counts
 * are returned either way so the consumer can state the reason.
 *
 * `minSamplePersonas` is a parameter, not a constant here, because the caller
 * that owns the population owns the threshold — Chorus declares it alongside
 * its other declared-not-fitted constants.
 */
export function buildSegmentStateMetrics(
  counters: StateMetricsCounters,
  simulated: number,
  provenance: Provenance,
  minSamplePersonas: number,
): SegmentStateMetrics {
  const personas = counters.visitsPerPersona.length;
  return {
    personas,
    entered: counters.entered,
    simulated,
    metrics:
      personas >= minSamplePersonas
        ? buildStateMetrics(counters, simulated, provenance)
        : null,
  };
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
