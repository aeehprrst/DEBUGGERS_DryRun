import {
  calculateBacktrack,
  calculateBlocked,
  calculateDeadClick,
  calculateDropout,
  calculateFixValue,
  calculateFrictionScore,
  calculateHesitation,
  calculateLoop,
} from "@dry-run/core";
import type { ActionEdge, AppState, PersonaTraitVector, StateGraph, StateMetrics } from "@dry-run/core";

// TRD §5.6 — zero LLM calls, zero network, pure TypeScript, deterministic.
// Calibration (fitting the six free weights against scout-observed dropout)
// is a separate subsystem, not built yet — these are reasonable uncalibrated
// defaults, not fitted ones.
const WEIGHTS = {
  goal: 2.0,
  affordance: 1.0,
  jargon: 1.5,
  giveUpBase: -1.0,
  temperature: 1.0,
};

// A hard backstop against a persona wandering forever around a cyclic graph.
// The softmax giveUp term is what's *meant* to end a walk near a persona's
// own patience budget — this is just the safety net if it doesn't.
const MAX_STEP_BUFFER = 5;
const HARD_STEP_CEILING = 30;

// Offline fallback per TRD §5.6 — a real cached jargon score (reka-edge) is
// used when a state's staticSignals already carries one; this list is only
// the fallback path, which is the only path this codebase has today.
const JARGON_WORDS = new Set([
  "api", "webhook", "endpoint", "payload", "idempotency", "backfill",
  "oauth", "sso", "sdk", "cli", "token", "credential", "provisioning",
  "namespace", "schema", "instance", "cluster", "deploy", "sandbox",
  "environment", "middleware", "authentication", "authorization",
  "encryption", "certificate", "dns", "cname", "callback", "async",
  "queue", "cache", "index", "migration", "regex", "json", "xml",
  "rest", "graphql", "latency", "throughput", "rate limit", "workspace",
]);

export type ChorusResults = {
  metrics: Record<string, StateMetrics>;
  populationSize: number;
  /** Fraction of personas that reached a real terminal state (success,
   * dropout, or blocked) without being cut off by the hard step ceiling. */
  completionRate: number;
};

// ---------- deterministic PRNG ----------
// mulberry32 — tiny, well-known, seeded. "100% deterministic" means
// reproducible given the same inputs, not that it needs to vary run to run,
// so one fixed seed is correct, not a shortcut.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- softmax ----------
function softmax(utilities: number[], temperature: number): number[] {
  const t = temperature > 1e-6 ? temperature : 1e-6;
  const scaled = utilities.map((u) => u / t);
  const max = Math.max(...scaled);
  const exps = scaled.map((u) => Math.exp(u - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(sum) || sum <= 0) {
    return utilities.map(() => 1 / utilities.length);
  }
  return exps.map((e) => e / sum);
}

function weightedPick(probs: number[], draw: number): number {
  let cumulative = 0;
  for (let i = 0; i < probs.length; i++) {
    cumulative += probs[i];
    if (draw < cumulative) return i;
  }
  return probs.length - 1; // floating-point rounding safety net
}

// ---------- policy sub-terms (TRD §5.6) ----------

export function jargonLoad(state: AppState): number {
  const cached = (state.staticSignals as Record<string, unknown> | undefined)?.jargonScore;
  if (typeof cached === "number" && Number.isFinite(cached)) {
    return Math.min(1, Math.max(0, cached));
  }

  const names = state.a11yTree.map((n) => n.name).filter((n) => n.trim().length > 0);
  if (names.length === 0) return 0;

  const flagged = names.filter((name) =>
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .some((word) => JARGON_WORDS.has(word)),
  ).length;

  return flagged / names.length;
}

const CTA_VERB_PATTERN =
  /\b(continue|next|submit|sign up|sign in|log in|create|connect|get started|save|confirm)\b/i;

function affordance(edge: ActionEdge, fromState: AppState): number {
  const offscreen = new Set(
    ((fromState.staticSignals as Record<string, unknown> | undefined)?.offscreenControls as
      | string[]
      | undefined) ?? [],
  );
  const inViewport = offscreen.has(edge.anchor.name) ? 0 : 1;
  const hasName = edge.anchor.name.trim().length > 0 ? 1 : 0;
  const isPrimaryCta = CTA_VERB_PATTERN.test(edge.anchor.name) ? 1 : 0;
  return (inViewport + hasName + isPrimaryCta) / 3;
}

// An edge that reaches the theoretical minimum hop-distance scores 1.0;
// every extra hop beyond that decays the score by 0.7^extraHops. Unreachable
// distances score a neutral 0 rather than propagating Infinity/NaN.
function goalAlignment(fromDist: number, toDist: number): number {
  if (!Number.isFinite(fromDist) || !Number.isFinite(toDist)) return 0;
  const extraHops = Math.max(0, toDist - (fromDist - 1));
  return Math.pow(0.7, extraHops);
}

// ---------- graph structure helpers ----------

function isNavigable(edge: ActionEdge): boolean {
  return (edge.action === "click" || edge.action === "navigate") && edge.toStateId.length > 0;
}

function pickStartStateId(graph: StateGraph): string | null {
  const ids = Object.keys(graph.nodes);
  if (ids.length === 0) return null;

  const hasIncoming = new Set(
    graph.edges
      .filter((e) => isNavigable(e) && e.toStateId !== e.fromStateId)
      .map((e) => e.toStateId),
  );
  return ids.find((id) => !hasIncoming.has(id)) ?? ids[0];
}

// Reverse multi-source BFS from every sink state (a state with no forward
// edge is treated as a goal — this function takes no task/goalPredicate, so
// "reaching a natural endpoint of the flow" is the only goal definition
// available to it).
function computeHopDistances(graph: StateGraph): Map<string, number> {
  const forwardByFrom = new Map<string, string[]>();
  const hasForward = new Set<string>();

  for (const edge of graph.edges) {
    if (!isNavigable(edge) || edge.toStateId === edge.fromStateId) continue;
    hasForward.add(edge.fromStateId);
    const list = forwardByFrom.get(edge.toStateId) ?? []; // reverse adjacency
    list.push(edge.fromStateId);
    forwardByFrom.set(edge.toStateId, list);
  }

  const allIds = Object.keys(graph.nodes);
  const goalIds = allIds.filter((id) => !hasForward.has(id));
  const seeds = goalIds.length > 0 ? goalIds : allIds.slice(-1); // degenerate: no sink at all

  const dist = new Map<string, number>();
  const queue: string[] = [];
  for (const id of seeds) {
    dist.set(id, 0);
    queue.push(id);
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const currentDist = dist.get(current)!;
    for (const prev of forwardByFrom.get(current) ?? []) {
      if (dist.has(prev)) continue;
      dist.set(prev, currentDist + 1);
      queue.push(prev);
    }
  }

  return dist;
}

function allocatePersonaCounts(personaMix: PersonaTraitVector[], totalPersonas: number): number[] {
  if (personaMix.length === 0) return [];

  const totalWeight = personaMix.reduce((sum, p) => sum + Math.max(0, p.weight), 0);
  if (totalWeight <= 0) {
    const even = Math.floor(totalPersonas / personaMix.length);
    const counts = personaMix.map(() => even);
    counts[0] += totalPersonas - even * personaMix.length;
    return counts;
  }

  const raw = personaMix.map((p) => (Math.max(0, p.weight) / totalWeight) * totalPersonas);
  const counts = raw.map(Math.floor);
  const remainder = totalPersonas - counts.reduce((a, b) => a + b, 0);

  const byFractionDesc = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remainder; k++) {
    counts[byFractionDesc[k % byFractionDesc.length].i] += 1;
  }
  return counts;
}

// ---------- per-state accumulator ----------

type StateAccumulator = {
  entered: number;
  dropout: number;
  blocked: number;
  visitCounts: number[];
  deadInteractions: number;
  totalInteractions: number;
  stepsBeforeAdvance: number[];
  reverseEdgeTraversals: number;
  totalExits: number;
};

function newAccumulator(): StateAccumulator {
  return {
    entered: 0,
    dropout: 0,
    blocked: 0,
    visitCounts: [],
    deadInteractions: 0,
    totalInteractions: 0,
    stepsBeforeAdvance: [],
    reverseEdgeTraversals: 0,
    totalExits: 0,
  };
}

export function runChorusSimulation(
  graph: StateGraph,
  personaMix: PersonaTraitVector[],
  totalPersonas = 1000,
): ChorusResults {
  const accumulators = new Map<string, StateAccumulator>();
  for (const stateId of Object.keys(graph.nodes)) {
    accumulators.set(stateId, newAccumulator());
  }

  const startStateId = pickStartStateId(graph);
  if (!startStateId || accumulators.size === 0) {
    return { metrics: {}, populationSize: 0, completionRate: 0 };
  }

  const hopDistances = computeHopDistances(graph);
  const navigableByFrom = new Map<string, ActionEdge[]>();
  for (const edge of graph.edges) {
    if (!isNavigable(edge)) continue;
    const list = navigableByFrom.get(edge.fromStateId) ?? [];
    list.push(edge);
    navigableByFrom.set(edge.fromStateId, list);
  }

  const counts = allocatePersonaCounts(personaMix, totalPersonas);
  const random = mulberry32(0xc0ffee);

  let completed = 0;
  let simulatedTotal = 0;

  personaMix.forEach((persona, archetypeIndex) => {
    const personaCount = counts[archetypeIndex] ?? 0;
    for (let i = 0; i < personaCount; i++) {
      simulatedTotal += 1;
      const outcome = simulateOnePersona(
        persona,
        startStateId,
        graph,
        navigableByFrom,
        hopDistances,
        accumulators,
        random,
      );
      if (outcome !== "blocked") completed += 1;
    }
  });

  const metrics: Record<string, StateMetrics> = {};
  for (const [stateId, acc] of accumulators) {
    const dropout = calculateDropout(acc.entered, acc.dropout);
    const blocked = calculateBlocked(acc.entered, acc.blocked);
    const loop = calculateLoop(acc.visitCounts);
    const deadClick = calculateDeadClick(acc.deadInteractions, acc.totalInteractions);
    const hesitation = calculateHesitation(acc.stepsBeforeAdvance);
    const backtrack = calculateBacktrack(acc.reverseEdgeTraversals, acc.totalExits);

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
    const reach = simulatedTotal > 0 ? Math.min(1, acc.entered / simulatedTotal) : 0;
    const impact = frictionScore / 100;
    const confidence = Math.min(1, acc.entered / 50);
    const fixValue = calculateFixValue(impact, reach, confidence);

    metrics[stateId] = {
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
      provenance: "modeled",
    };
  }

  return {
    metrics,
    populationSize: simulatedTotal,
    completionRate: simulatedTotal > 0 ? completed / simulatedTotal : 0,
  };
}

function simulateOnePersona(
  persona: PersonaTraitVector,
  startStateId: string,
  graph: StateGraph,
  navigableByFrom: Map<string, ActionEdge[]>,
  hopDistances: Map<string, number>,
  accumulators: Map<string, StateAccumulator>,
  random: () => number,
): "success" | "dropout" | "blocked" {
  const patience = Math.max(1, Math.round(persona.patience));
  const stepCeiling = Math.min(HARD_STEP_CEILING, patience + MAX_STEP_BUFFER);

  const visited = new Map<string, number>();
  let currentId = startStateId;
  let steps = 0;
  let hesitationCounter = 0;

  const enter = (stateId: string) => {
    const acc = accumulators.get(stateId);
    if (!acc) return;
    acc.entered += 1;
    visited.set(stateId, (visited.get(stateId) ?? 0) + 1);
  };

  enter(currentId);

  while (steps < stepCeiling) {
    const acc = accumulators.get(currentId);
    const state = graph.nodes[currentId];
    const edges = navigableByFrom.get(currentId) ?? [];

    if (!state || edges.length === 0) {
      // A true sink — this is a completed journey, not a failure.
      recordVisitCounts(accumulators, visited);
      return "success";
    }

    const dCurrent = hopDistances.get(currentId) ?? Infinity;
    const confusion = jargonLoad(state);

    const utilities = edges.map((edge) => {
      const dTo = hopDistances.get(edge.toStateId) ?? Infinity;
      return (
        WEIGHTS.goal * goalAlignment(dCurrent, dTo) +
        WEIGHTS.affordance * affordance(edge, state) -
        WEIGHTS.jargon * confusion * (1 - persona.domainLiteracy)
      );
    });

    const giveUpUtility =
      WEIGHTS.giveUpBase +
      2.0 * (steps / patience) +
      1.5 * confusion -
      1.0 * persona.priorFamiliarity;
    utilities.push(giveUpUtility);

    const temperature = WEIGHTS.temperature * (1 + confusion);
    const probs = softmax(utilities, temperature);
    const choice = weightedPick(probs, random());

    if (choice === edges.length) {
      if (acc) {
        acc.dropout += 1;
        acc.stepsBeforeAdvance.push(hesitationCounter);
      }
      recordVisitCounts(accumulators, visited);
      return "dropout";
    }

    const chosenEdge = edges[choice];
    const dTo = hopDistances.get(chosenEdge.toStateId) ?? Infinity;
    const isAdvancing = Number.isFinite(dTo) && dTo < dCurrent;
    const isSelfLoop = chosenEdge.toStateId === currentId;

    if (acc) {
      acc.totalInteractions += 1;
      if (isSelfLoop) acc.deadInteractions += 1;
      acc.totalExits += 1;
      if (visited.has(chosenEdge.toStateId)) acc.reverseEdgeTraversals += 1;
    }

    if (isAdvancing) {
      if (acc) acc.stepsBeforeAdvance.push(hesitationCounter);
      hesitationCounter = 0;
    } else {
      hesitationCounter += 1;
    }

    currentId = chosenEdge.toStateId;
    steps += 1;
    enter(currentId);
  }

  const finalAcc = accumulators.get(currentId);
  if (finalAcc) finalAcc.blocked += 1;
  recordVisitCounts(accumulators, visited);
  return "blocked";
}

function recordVisitCounts(accumulators: Map<string, StateAccumulator>, visited: Map<string, number>) {
  for (const [stateId, count] of visited) {
    accumulators.get(stateId)?.visitCounts.push(count);
  }
}
