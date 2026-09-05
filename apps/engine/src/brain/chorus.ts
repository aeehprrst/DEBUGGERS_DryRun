// The six PRD §6.1 formulas and §6.2's friction score are still the ones in
// `@dry-run/core`; they are now reached through `buildStateMetrics`, which
// applies them in the same order, so the population and every CH-04 segment
// share one implementation instead of two copies that can drift.
import {
  SEGMENTS,
  buildSegmentStateMetrics,
  buildStateMetrics,
  jargonScoreForNames,
  segmentsForPersona,
} from "@dry-run/core";
import type {
  ActionEdge,
  AppState,
  PersonaTraitVector,
  SegmentId,
  SegmentStateMetrics,
  StateGraph,
  StateMetrics,
  StateMetricsCounters,
} from "@dry-run/core";

// TRD §5.6 — zero LLM calls, zero network, pure TypeScript, deterministic.
// Calibration (fitting the six free weights against scout-observed dropout)
// is a separate subsystem, not built yet — these are reasonable uncalibrated
// defaults, not fitted ones.
const WEIGHTS = {
  goal: 2.0,
  affordance: 1.0,
  jargon: 1.5,
  // TRD §5.4's transition policy carries `- w_risk · irreversibility(e) ·
  // p.riskAversion`. The term was in the spec and missing from the code, so
  // riskAversion was parsed and ignored (CH-03 names it). Added, not changed:
  // every pre-existing weight above and below is untouched.
  risk: 1.0,
  giveUpBase: -1.0,
  temperature: 1.0,
};

// A hard backstop against a persona wandering forever around a cyclic graph.
// The softmax giveUp term is what's *meant* to end a walk near a persona's
// own patience budget — this is just the safety net if it doesn't.
const MAX_STEP_BUFFER = 5;
const HARD_STEP_CEILING = 30;

// CH-04 — the fewest distinct personas from a segment that must have entered a
// state before that segment's metrics are reported for it. Below this the
// segment's record carries its counts and `metrics: null`, never zeros: a
// dropout ratio over a handful of walks is a rounding artifact, and printing it
// as 0.00 would claim a screen was easy for a segment we barely saw on it. Same
// instinct as `jargonScoreForNames` returning null below four names.
//
// Declared, not fitted — there is no calibration subsystem to fit it with
// (CLAUDE.md §5). 30 is the conventional floor at which a sample proportion is
// reportable at all: below it the standard error on a mid-range proportion
// exceeds ~0.09, which is the same order as the ExclusionDelta values PRD §6.4
// asks us to publish, so a thinner sample cannot support the claim the number
// would be making.
const MIN_SEGMENT_SAMPLE_PERSONAS = 30;

// Offline fallback per TRD §5.6 — a real cached jargon score (reka-edge) is
// used when a state's staticSignals already carries one; this list is only
// the fallback path, which is the only path this codebase has today.
// JARGON_WORDS moved to @dry-run/core (CR-12): the crawler's jargonScore
// signal and this walk model must score a screen identically.

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

  // null means "too few accessible names to measure" (CR-12). For the walk
  // model that is not a jargon burden, so it reads as zero load rather than
  // becoming an unmeasured state the persona cannot be simulated on.
  return jargonScoreForNames(state.a11yTree.map((n) => n.name)) ?? 0;
}

const CTA_VERB_PATTERN =
  /\b(continue|next|submit|sign up|sign in|log in|create|connect|get started|save|confirm)\b/i;

// The trait-independent half of affordance: how much this control looks like a
// way forward at all. `perceiveEdges` applies the per-persona multipliers on
// top of it (CH-03), and takes the offscreen set from the persona's own
// measured viewport rather than always the desktop one.
function baseAffordance(edge: ActionEdge, offscreen: ReadonlySet<string>): number {
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

// ---------- CH-03 · trait enforcement (TRD §5.4) ----------
//
// Every trait below changes the walk *mechanically* — an edge removed from the
// set, a multiplier on an affordance, a cap on the step count (CLAUDE.md §6.8).
// Nothing here prompts a model to behave a certain way, and nothing here is a
// role-play instruction. That is the whole point: a screen-reader persona does
// worse on Meridian's /connect because the error text is genuinely unreachable
// through the accessibility tree, not because a model was told to struggle.
//
// Values marked TRD are stated verbatim in §5.4's trait-enforcement table. The
// rest are declared constants — not fitted, and there is no calibration
// subsystem to fit them with (CLAUDE.md §5).
const TRAIT = {
  /** TRD: "Below-fold controls get affordance × 0.35" on mobile-390. */
  mobileBelowFoldAffordance: 0.35,
  /** TRD: "Edges not reachable in tab order get affordance × 0.5." */
  keyboardUnreachableAffordance: 0.5,
  /** TRD: "`jargonLoad` effect multiplied by 1.6" for a non-native reader. */
  nonNativeJargonMultiplier: 1.6,
  /** TRD: "`readingDepth` effect halved" for a non-native reader. */
  nonNativeReadingDepthMultiplier: 0.5,
  /** TRD: an unannounced error sets baseConfusion to this for a screen reader. */
  screenReaderUnannouncedConfusion: 1.0,
  /** TRD: "Below `0.4`, helper-text and tooltip nodes are stripped." */
  readingDepthHintThreshold: 0.4,

  // Declared, not stated by the TRD:
  /** How much perceived helper text calms a fork. */
  hintRelief: 0.3,
  /** Nobody scrolls never: the floor a below-fold control keeps even for the
   *  least patient skimmer. */
  belowFoldFloor: 0.15,
  /** Split of the scroll tendency between reading depth and patience. */
  belowFoldReadingWeight: 0.6,
  /** maxSteps at which patience stops adding to scroll tendency — the most
   *  patient declared archetype (PERSONA_ARCHETYPES: confident-desktop, 24). */
  patienceScrollReference: 24,
} as const;

/** Which measured viewport a persona's device reads from. */
function viewportKeyFor(device: PersonaTraitVector["device"]): string {
  // desktop-1440 is not crawled — a control that fits at 1280 fits at 1440, so
  // the laptop measurement is the conservative stand-in. Named here rather than
  // silently defaulting, because reading a missing key as "nothing offscreen"
  // is exactly the kind of quiet zero §6.5 forbids.
  return device === "mobile-390" ? "mobile-390" : "laptop-1280";
}

function signalsFor(state: AppState, device: PersonaTraitVector["device"]): Record<string, unknown> {
  const key = viewportKeyFor(device);
  const perViewport = (state.viewports as Record<string, Record<string, unknown>> | undefined)?.[key];
  return perViewport ?? (state.staticSignals as Record<string, unknown>) ?? {};
}

function namesFrom(signals: Record<string, unknown>, key: string): string[] | null {
  const value = signals[key];
  if (Array.isArray(value)) return value as string[];
  // Absent means "this crawl did not measure it" — for tabbableNames that has
  // to stay distinguishable from "measured, nothing is focusable".
  return null;
}

/**
 * TRD §5.4 — `readingDepth`, and the non-native halving that applies to it.
 * Below the threshold, helper text is not perceived at all.
 */
function effectiveReadingDepth(persona: PersonaTraitVector): number {
  return persona.locale === "non-native"
    ? persona.readingDepth * TRAIT.nonNativeReadingDepthMultiplier
    : persona.readingDepth;
}

/**
 * Helper-text and tooltip nodes on a screen. Presence only: parseAriaSnapshot
 * keeps a node's role but drops a paragraph's text payload, so the walk can
 * know a hint is *there* and not what it says. That is enough for the
 * mechanical rule and the comment is here so nobody later reads this as
 * comprehension.
 */
const HINT_ROLES = new Set(["paragraph", "note", "tooltip", "definition"]);

function hasHintText(state: AppState): boolean {
  return state.a11yTree.some((n) => HINT_ROLES.has(n.role));
}

/**
 * CR-14's signal, read by the walk. An error the app renders but never
 * announces does not exist for a screen-reader persona — no role="alert", no
 * aria-live, no aria-invalid/aria-describedby pairing.
 */
function hasUnannouncedError(state: AppState): boolean {
  const s = (state.staticSignals as Record<string, unknown>) ?? {};
  return s.errorText != null && s.errorAnnounced === false;
}

/**
 * TRD §5.4's `baseConfusion(s)` — how hard this screen is to make sense of for
 * *this* persona. Feeds both the give-up term and the softmax temperature.
 */
function baseConfusion(persona: PersonaTraitVector, state: AppState, isFork: boolean): number {
  // The strongest case first: for a screen-reader persona a silently-rejected
  // submission is total confusion, because nothing announced that anything
  // happened. TRD §5.4 sets this to 1.0 outright.
  if (persona.inputMode === "screen-reader" && hasUnannouncedError(state)) {
    return TRAIT.screenReaderUnannouncedConfusion;
  }

  let confusion = jargonLoad(state);
  if (persona.locale === "non-native") {
    confusion = Math.min(1, confusion * TRAIT.nonNativeJargonMultiplier);
  }

  // A hint only helps at a fork — there is nothing to disambiguate on a screen
  // with one way forward — and only if this persona reads to that depth.
  if (
    isFork &&
    hasHintText(state) &&
    effectiveReadingDepth(persona) >= TRAIT.readingDepthHintThreshold
  ) {
    confusion *= 1 - TRAIT.hintRelief;
  }

  return Math.min(1, Math.max(0, confusion));
}

/**
 * How likely this persona is to scroll to something below the fold.
 *
 * CH-03 item 4 — the modelling gap the harness exposed. A below-fold primary
 * CTA used to be penalised only on mobile, so D1 (Meridian's /workspace, whose
 * "Create workspace" button sits under six paragraphs of filler) barely moved
 * the simulation and ranked below the top 8. People do not scroll: a
 * below-fold control is discounted for *every* persona, scaled by how deeply
 * they read and how long they are willing to stay.
 */
function scrollTendency(persona: PersonaTraitVector): number {
  const patienceFrac = Math.min(
    1,
    persona.patience.maxSteps / TRAIT.patienceScrollReference,
  );
  const willingness =
    TRAIT.belowFoldReadingWeight * effectiveReadingDepth(persona) +
    (1 - TRAIT.belowFoldReadingWeight) * patienceFrac;
  return TRAIT.belowFoldFloor + (1 - TRAIT.belowFoldFloor) * willingness;
}

/**
 * TRD §5.4 — `riskAversion` finally wired.
 *
 * Irreversibility is derived structurally from the crawled graph: an edge is
 * irreversible when, having taken it, no sequence of navigable edges returns
 * you to where you were. That is a real property of the interface and the
 * crawler already recorded everything needed to compute it.
 *
 * Shortcut, named: CR-05 specifies a per-edge `irreversible` flag observed in
 * the browser (a confirmation dialog, a POST with no undo). That is unbuilt, so
 * this stands in for it. Where CR-05 lands, this becomes the fallback for edges
 * the browser could not judge.
 */
function computeIrreversibility(
  graph: StateGraph,
  navigableByFrom: Map<string, ActionEdge[]>,
): Map<string, number> {
  const reachable = new Map<string, Set<string>>();
  for (const startId of Object.keys(graph.nodes)) {
    const seen = new Set<string>();
    const queue = [startId];
    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];
      for (const edge of navigableByFrom.get(current) ?? []) {
        if (seen.has(edge.toStateId)) continue;
        seen.add(edge.toStateId);
        queue.push(edge.toStateId);
      }
    }
    reachable.set(startId, seen);
  }

  const out = new Map<string, number>();
  for (const edge of graph.edges) {
    if (!isNavigable(edge)) continue;
    const key = edgeKey(edge);
    if (edge.fromStateId === edge.toStateId) {
      out.set(key, 0); // a self-loop changes nothing, so nothing is lost
      continue;
    }
    const canReturn = reachable.get(edge.toStateId)?.has(edge.fromStateId) ?? false;
    out.set(key, canReturn ? 0 : 1);
  }
  return out;
}

function edgeKey(edge: ActionEdge): string {
  return `${edge.fromStateId} ${edge.anchor.role} ${edge.anchor.name} ${edge.anchor.ordinal} ${edge.toStateId}`;
}

/**
 * The edge set as *this* persona can perceive and reach it, with each surviving
 * edge's affordance already adjusted for their traits.
 *
 * Removal, not discounting, for the two cases where the control is genuinely
 * not there: a control off the side of a 390px viewport cannot be tapped, and a
 * control with no accessible name is not announced to a screen reader at all.
 * TRD §5.4: "`device` and `inputMode` are the two that make the exclusion claim
 * real."
 */
function perceiveEdges(
  persona: PersonaTraitVector,
  state: AppState,
  edges: ActionEdge[],
): { edge: ActionEdge; affordance: number }[] {
  const signals = signalsFor(state, persona.device);
  const offscreen = new Set(namesFrom(signals, "offscreenInteractives") ?? []);
  const belowFold = new Set(namesFrom(signals, "belowFoldInteractives") ?? []);
  const tabbable = namesFrom(signals, "tabbableNames");

  const perceived: { edge: ActionEdge; affordance: number }[] = [];

  for (const edge of edges) {
    const name = edge.anchor.name;

    // device: mobile-390 — offscreen at this width means gone, not faint.
    if (persona.device === "mobile-390" && offscreen.has(name)) continue;

    // inputMode: screen-reader — perception is the accessibility tree, and an
    // unnamed control is not in it in any actionable form.
    if (persona.inputMode === "screen-reader" && name.trim().length === 0) continue;

    let value = baseAffordance(edge, offscreen);

    if (belowFold.has(name)) {
      value *= scrollTendency(persona);
      if (persona.device === "mobile-390") value *= TRAIT.mobileBelowFoldAffordance;
    }

    // inputMode: keyboard-only. `tabbable === null` means this crawl never
    // measured focusability, so no multiplier is applied — an unmeasured
    // screen must not read as a screen that failed.
    if (persona.inputMode === "keyboard-only" && tabbable !== null && !tabbable.includes(name)) {
      value *= TRAIT.keyboardUnreachableAffordance;
    }

    perceived.push({ edge, affordance: value });
  }

  return perceived;
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

/** The accumulator as `@dry-run/core` reduces it. Field names only. */
function countersOf(acc: StateAccumulator): StateMetricsCounters {
  return {
    entered: acc.entered,
    terminated: acc.dropout,
    blocked: acc.blocked,
    visitsPerPersona: acc.visitCounts,
    deadInteractions: acc.deadInteractions,
    totalInteractions: acc.totalInteractions,
    stepsBeforeGoalAction: acc.stepsBeforeAdvance,
    reverseEdgeTraversals: acc.reverseEdgeTraversals,
    totalExits: acc.totalExits,
  };
}

function newAccumulatorMap(graph: StateGraph): Map<string, StateAccumulator> {
  const map = new Map<string, StateAccumulator>();
  for (const stateId of Object.keys(graph.nodes)) {
    map.set(stateId, newAccumulator());
  }
  return map;
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

  // CH-03 — irreversibility is a property of the graph, not of a persona, so
  // it is computed once and read by every walk.
  const irreversibility = computeIrreversibility(graph, navigableByFrom);

  const counts = allocatePersonaCounts(personaMix, totalPersonas);
  const random = mulberry32(0xc0ffee);

  // CH-04 — one accumulator map per named segment, filled in the *same* pass as
  // the overall one. Per L2 the simulation is not re-run per segment: each walk
  // already happened, and a walk simply lands in the overall bucket plus every
  // segment bucket its archetype qualifies for. Membership is a property of the
  // archetype, so it is resolved once here rather than per persona.
  const segmentIds = SEGMENTS.map((s) => s.id);
  const segmentAccumulators = new Map<SegmentId, Map<string, StateAccumulator>>(
    segmentIds.map((id) => [id, newAccumulatorMap(graph)]),
  );
  const segmentSimulated = new Map<SegmentId, number>(
    segmentIds.map((id) => [id, 0]),
  );

  let completed = 0;
  let simulatedTotal = 0;

  personaMix.forEach((persona, archetypeIndex) => {
    const personaCount = counts[archetypeIndex] ?? 0;

    // Overall first, then this archetype's segments. `targets[0]` is the
    // overall map and the walk gates on it exactly as it used to gate on the
    // single map, so the overall tallies are untouched by anything here.
    const memberOf = segmentsForPersona(persona);
    const targets: Map<string, StateAccumulator>[] = [
      accumulators,
      ...memberOf.map((id) => segmentAccumulators.get(id)!),
    ];
    for (const id of memberOf) {
      segmentSimulated.set(id, (segmentSimulated.get(id) ?? 0) + personaCount);
    }

    for (let i = 0; i < personaCount; i++) {
      simulatedTotal += 1;
      const outcome = simulateOnePersona(
        persona,
        startStateId,
        graph,
        navigableByFrom,
        hopDistances,
        irreversibility,
        targets,
        random,
      );
      if (outcome !== "blocked") completed += 1;
    }
  });

  const metrics: Record<string, StateMetrics> = {};
  for (const [stateId, acc] of accumulators) {
    // The six PRD §6.1 formulas and the §6.2 friction score now live in
    // `buildStateMetrics` (@dry-run/core) so the population and every segment
    // are reduced by one implementation. The arithmetic is unchanged.
    //
    // Provenance stays "modeled" for both: CH-05 is a separate item, and this
    // task must not quietly start assigning it (L6).
    const base = buildStateMetrics(countersOf(acc), simulatedTotal, "modeled");

    // CH-04 — the same reduction over each segment's bucket. Every segment gets
    // a record even when it is null, so a consumer can distinguish "this
    // segment barely reached this screen" from "we never looked".
    const segments: Record<string, SegmentStateMetrics> = {};
    for (const id of segmentIds) {
      const segmentAcc = segmentAccumulators.get(id)?.get(stateId);
      if (!segmentAcc) continue;
      segments[id] = buildSegmentStateMetrics(
        countersOf(segmentAcc),
        segmentSimulated.get(id) ?? 0,
        "modeled",
        MIN_SEGMENT_SAMPLE_PERSONAS,
      );
    }

    metrics[stateId] = { ...base, segments };
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
  irreversibility: Map<string, number>,
  // CH-04 — every accumulator map this walk contributes to. `targets[0]` is the
  // overall population; the rest are the segments this persona's archetype
  // belongs to, and a persona may belong to none or several (segments.ts
  // overlaps deliberately). Bucketing only: the walk below is untouched, no
  // draw is added, removed or reordered, and `targets[0]` receives exactly the
  // sequence of mutations the single map used to receive.
  targets: readonly Map<string, StateAccumulator>[],
  random: () => number,
): "success" | "dropout" | "blocked" {
  // PS-01 — patience is now two budgets. `maxSteps` is enforced here as a hard
  // cap (TRD §5.4). `maxMs` is NOT enforced and is not silently approximated:
  // the walk has no clock, because nothing measures per-action latency yet
  // (`medianActionLatencyMs` is the one static signal still missing, the same
  // gap that makes `slow-response` unreachable). Faking a duration from step
  // count would be a fabricated number (CLAUDE.md §6.5).
  const patience = Math.max(1, Math.round(persona.patience.maxSteps));
  const stepCeiling = Math.min(HARD_STEP_CEILING, patience + MAX_STEP_BUFFER);

  const visited = new Map<string, number>();
  let currentId = startStateId;
  let steps = 0;
  let hesitationCounter = 0;

  // Every accumulator for a state, across the overall map and this persona's
  // segment maps. The overall map is the gate — it holds a key for every node,
  // and a state absent from it is absent from all of them — so the early return
  // below is the same one the single-map version made.
  const accsAt = (stateId: string): StateAccumulator[] => {
    const out: StateAccumulator[] = [];
    for (const target of targets) {
      const acc = target.get(stateId);
      if (acc) out.push(acc);
    }
    return out;
  };

  const enter = (stateId: string) => {
    const accs = accsAt(stateId);
    if (accs.length === 0) return;
    for (const acc of accs) acc.entered += 1;
    visited.set(stateId, (visited.get(stateId) ?? 0) + 1);
  };

  enter(currentId);

  while (steps < stepCeiling) {
    const accs = accsAt(currentId);
    const state = graph.nodes[currentId];
    const edges = navigableByFrom.get(currentId) ?? [];

    if (!state || edges.length === 0) {
      // A true sink — this is a completed journey, not a failure.
      recordVisitCounts(targets, visited);
      return "success";
    }

    // CH-03 — the edge set this persona can actually perceive and reach.
    // Filtering happens before anything else, because an edge that is removed
    // must not contribute to the softmax at all.
    const perceived = perceiveEdges(persona, state, edges);
    if (perceived.length === 0) {
      // Every way forward is unreachable for this persona even though the
      // screen has out-edges. That is being blocked by the interface, not
      // arriving at the end of the flow, and the two must not be conflated.
      for (const acc of accs) acc.blocked += 1;
      recordVisitCounts(targets, visited);
      return "blocked";
    }

    const dCurrent = hopDistances.get(currentId) ?? Infinity;
    const confusion = baseConfusion(persona, state, perceived.length > 1);
    // TRD §5.4 — the jargon term is multiplied by 1.6 for a non-native reader.
    // Applied to the term, not to `confusion`, so the give-up and temperature
    // terms are not double-counted.
    const jargonPenalty =
      WEIGHTS.jargon *
      jargonLoad(state) *
      (1 - persona.domainLiteracy) *
      (persona.locale === "non-native" ? TRAIT.nonNativeJargonMultiplier : 1);

    const utilities = perceived.map(({ edge, affordance }) => {
      const dTo = hopDistances.get(edge.toStateId) ?? Infinity;
      return (
        WEIGHTS.goal * goalAlignment(dCurrent, dTo) +
        WEIGHTS.affordance * affordance -
        jargonPenalty -
        WEIGHTS.risk * (irreversibility.get(edgeKey(edge)) ?? 0) * persona.riskAversion
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

    if (choice === perceived.length) {
      for (const acc of accs) {
        acc.dropout += 1;
        acc.stepsBeforeAdvance.push(hesitationCounter);
      }
      recordVisitCounts(targets, visited);
      return "dropout";
    }

    const chosenEdge = perceived[choice].edge;
    const dTo = hopDistances.get(chosenEdge.toStateId) ?? Infinity;
    const isAdvancing = Number.isFinite(dTo) && dTo < dCurrent;
    const isSelfLoop = chosenEdge.toStateId === currentId;

    for (const acc of accs) {
      acc.totalInteractions += 1;
      if (isSelfLoop) acc.deadInteractions += 1;
      acc.totalExits += 1;
      if (visited.has(chosenEdge.toStateId)) acc.reverseEdgeTraversals += 1;
    }

    if (isAdvancing) {
      for (const acc of accs) acc.stepsBeforeAdvance.push(hesitationCounter);
      hesitationCounter = 0;
    } else {
      hesitationCounter += 1;
    }

    currentId = chosenEdge.toStateId;
    steps += 1;
    enter(currentId);
  }

  for (const acc of accsAt(currentId)) acc.blocked += 1;
  recordVisitCounts(targets, visited);
  return "blocked";
}

function recordVisitCounts(
  targets: readonly Map<string, StateAccumulator>[],
  visited: Map<string, number>,
) {
  for (const target of targets) {
    for (const [stateId, count] of visited) {
      target.get(stateId)?.visitCounts.push(count);
    }
  }
}
