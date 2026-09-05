import { z } from "zod";
import {
  ActionType,
  DeviceType,
  FindingSignature,
  InputMode,
  PersonaLocale,
  Provenance,
  StepStatus,
} from "./enums.js";

// ---------- Shared primitives ----------

export const BoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type Box = z.infer<typeof BoxSchema>;

export const SemanticAnchorSchema = z.object({
  role: z.string(),
  name: z.string(),
  landmark: z.string().optional(),
  ordinal: z.number(),
  dataTestId: z.string().optional(),
  selectorFallback: z.string().optional(),
});
export type SemanticAnchor = z.infer<typeof SemanticAnchorSchema>;

// ---------- Graph ----------

export const A11yNodeSchema = z.object({
  ref: z.string(),
  role: z.string(),
  name: z.string(),
  box: BoxSchema,
  landmark: z.string().optional(),
  ordinal: z.number(),
  dataTestId: z.string().optional(),
});
export type A11yNode = z.infer<typeof A11yNodeSchema>;

export const StaticSignalsSchema = z.record(z.string(), z.any());
export type StaticSignals = z.infer<typeof StaticSignalsSchema>;

// CR-09 / TRD §5.2.5 — the viewports the crawler measures at, declared once so
// the desktop pass, the mobile pass and the persona `device` trait cannot drift
// apart. Keys match the DeviceType enum.
export const CRAWL_VIEWPORTS = {
  "laptop-1280": { width: 1280, height: 720 },
  "mobile-390": { width: 390, height: 844 },
} as const;
export type CrawlViewport = keyof typeof CRAWL_VIEWPORTS;

export const AppStateSchema = z.object({
  id: z.string(),
  fingerprint: z.string(),
  url: z.string(),
  title: z.string(),
  screenshotPath: z.string(),
  a11yTree: z.array(A11yNodeSchema),
  staticSignals: z.record(z.string(), z.any()),
  // CR-09 / TRD §5.2.5 — "Store `staticSignals` per viewport". Optional because
  // the mobile pass can legitimately fail to re-reach a state; an absent entry
  // means "not measured at this width", which must stay distinguishable from
  // "measured and found nothing".
  viewports: z.record(z.string(), StaticSignalsSchema).optional(),
});
export type AppState = z.infer<typeof AppStateSchema>;

export const ActionEdgeSchema = z.object({
  fromStateId: z.string(),
  toStateId: z.string(),
  action: ActionType,
  targetRef: z.string(),
  anchor: SemanticAnchorSchema,
});
export type ActionEdge = z.infer<typeof ActionEdgeSchema>;

export const StateGraphSchema = z.object({
  nodes: z.record(z.string(), AppStateSchema),
  edges: z.array(ActionEdgeSchema),
});
export type StateGraph = z.infer<typeof StateGraphSchema>;

// CR-07 / TRD §5.2.3 — operator-supplied fill values for the crawl, keyed by
// the field's *accessible name* (not id, not selector — §6.1). This is step 1 of
// the four-step fill order; the remaining three steps are derived in the engine
// and need no contract. Lives here because the Setup screen posts it and the
// cartographer consumes it.
export const SeededValuesSchema = z.record(z.string(), z.string());
export type SeededValues = z.infer<typeof SeededValuesSchema>;

// TRD S4 / CLAUDE.md §8 — exact accessible names the attesting operator has
// explicitly permitted the crawler to activate, overriding the destructive
// blocklist for one run. Exact matches only: a substring or pattern allowlist
// would let one approval widen silently as the target's copy changes.
export const AllowActionsSchema = z.array(z.string());
export type AllowActions = z.infer<typeof AllowActionsSchema>;

// ---------- Personas & tasks ----------

// PS-01 / TRD §5.1 — patience was a bare number, which conflated two different
// budgets: how many things a persona will try, and how long they will stay.
// They are enforced differently (a step cap versus a clock) so they are stored
// separately (CLAUDE.md §6.8 — patience is a cap, never a prompt).
export const PatienceSchema = z.object({
  maxSteps: z.number().int().positive(),
  maxMs: z.number().int().positive(),
});
export type Patience = z.infer<typeof PatienceSchema>;

// PS-01 / TRD §5.1 — the full ten-trait vector.
//
// `role` stays a free string rather than becoming a closed PersonaRole enum:
// TRD §5.4 gives it exactly one job, "task/goal selection", and task selection
// is PS-04/CH-02, both unbuilt. Closing the enum now would fix a vocabulary
// against a consumer that does not exist yet.
export const PersonaTraitVectorSchema = z.object({
  /** Stable id, e.g. "screen-reader-user". Keys memoisation and segments. */
  archetype: z.string(),
  /** Display name, e.g. "Screen-Reader User". */
  label: z.string(),
  role: z.string(),
  domainLiteracy: z.number().min(0).max(1),
  patience: PatienceSchema,
  riskAversion: z.number().min(0).max(1),
  readingDepth: z.number().min(0).max(1),
  priorFamiliarity: z.number().min(0).max(1),
  device: DeviceType,
  inputMode: InputMode,
  locale: PersonaLocale,
  weight: z.number(),
});
export type PersonaTraitVector = z.infer<typeof PersonaTraitVectorSchema>;

export const TaskDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  startUrl: z.string(),
  goalPredicate: z.object({
    type: z.string(),
    target: z.string(),
  }),
});
export type TaskDefinition = z.infer<typeof TaskDefinitionSchema>;

// ---------- Metrics ----------

// The metric fields themselves, split out from `StateMetricsSchema` so that a
// per-segment record (CH-04, below) can reuse the identical shape without the
// two schemas referring to each other in a cycle. Segments do not nest inside
// segments, so the base is exactly the right shape for one.
export const StateMetricsBaseSchema = z.object({
  frictionScore: z.number().min(0).max(100),
  fixValue: z.number().min(0).max(1),
  dropout: z.number(),
  blocked: z.number(),
  loop: z.number(),
  deadClick: z.number(),
  hesitation: z.number(),
  backtrack: z.number(),
  // Chorus already derives these three to compute fixValue (TRD §5.6) but
  // previously discarded them — Analysis (Backend Schema §5) needs the same
  // real numbers for Finding.impact/.reach/.confidence, not a re-fabricated
  // proxy, so they're carried through here instead of being recomputed.
  impact: z.number().min(0).max(1),
  reach: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  provenance: Provenance,
});
export type StateMetricsBase = z.infer<typeof StateMetricsBaseSchema>;

/**
 * CH-04 — one segment's slice of a state's metrics (PRD §6.1 computed over a
 * subset of the population rather than all of it). PRD §6.4's `ExclusionDelta`
 * is the difference between one of these and the baseline segment's, and is
 * **not** computed here (AN-07).
 *
 * `metrics` is nullable for the same reason `AtlasNode.metrics` is: below the
 * caller's minimum sample this segment did not produce a measurement, and a
 * zero-filled object would read as "this segment sailed through" when what
 * happened is that almost none of them got here. The counts are recorded either
 * way so a consumer can say *why* it is null rather than just showing an em
 * dash (CLAUDE.md §6.5).
 */
export const SegmentStateMetricsSchema = z.object({
  /**
   * Distinct personas from this segment that entered the state — the sample
   * size, and what the minimum-sample gate is applied to.
   */
  personas: z.number().int().min(0),
  /**
   * Arrival *events*, which is what `reach` and `confidence` are derived from.
   * A looping state can be arrived at more than once by the same persona, so
   * this is >= `personas` and is not a headcount.
   */
  entered: z.number().int().min(0),
  /** Personas from this segment simulated at all — the denominator of `reach`. */
  simulated: z.number().int().min(0),
  metrics: StateMetricsBaseSchema.nullable(),
});
export type SegmentStateMetrics = z.infer<typeof SegmentStateMetricsSchema>;

/**
 * Why an `ExclusionDelta` could not be computed. PRD §6.4's delta is a
 * subtraction of two dropout figures, and CH-04 returns `null` rather than a
 * zero for any segment it saw too few personas from — so either operand can be
 * missing, and which one it was is the difference between "this segment barely
 * reached the screen" and "we have no reference to compare anything against".
 * A consumer must be able to say which; an unexplained em dash is not enough.
 */
export const ExclusionUnavailableReason = z.enum([
  "segment-sample-too-thin",
  "baseline-sample-too-thin",
  "both-samples-too-thin",
  "segment-not-recorded",
  "baseline-not-recorded",
]);
export type ExclusionUnavailableReason = z.infer<typeof ExclusionUnavailableReason>;

/**
 * AN-07 / PRD §6.4 — `ExclusionDelta(s, g) = Dropout(s | g) − Dropout(s | baseline)`.
 *
 * **`delta` is null whenever either operand is null, and that is the point of
 * this type.** A null baseline does not mean exclusion is zero and does not
 * mean it is large: it means the question is unanswerable for that state. The
 * dropout figures and both sample counts are carried either way so the null can
 * be explained rather than rendered as a bare dash (CLAUDE.md §6.5).
 *
 * Always `modeled` (L6): the dropout figures underneath are Chorus output, and
 * the fact that the graph they walked was measured in a real browser does not
 * make a simulated ratio Observed.
 */
export const ExclusionDeltaSchema = z.object({
  stateId: z.string(),
  /** `SegmentId`; a plain string here for the same acyclic reason as below. */
  segment: z.string(),
  /** Null iff either dropout is null. Never coerced to 0. */
  delta: z.number().nullable(),
  segmentDropout: z.number().nullable(),
  baselineDropout: z.number().nullable(),
  /** Sample sizes, recorded even when the delta is null — they explain it. */
  segmentPersonas: z.number().int().min(0),
  baselinePersonas: z.number().int().min(0),
  unavailableReason: ExclusionUnavailableReason.nullable(),
  /**
   * True for the baseline segment's own row, whose delta is 0 by definition.
   * Flagged rather than string-compared so the index cannot accidentally let
   * the reference win its own comparison (PRD §6.4).
   */
  isBaseline: z.boolean(),
  provenance: Provenance,
});
export type ExclusionDelta = z.infer<typeof ExclusionDeltaSchema>;

/** The single (state, segment) pair with the largest non-null delta in a run. */
export const ExclusionIndexSchema = z.object({
  stateId: z.string(),
  /** Human-readable screen name, so the headline reads as PRD §6.4 writes it. */
  stateName: z.string(),
  segment: z.string(),
  segmentLabel: z.string(),
  delta: z.number(),
  segmentDropout: z.number(),
  baselineDropout: z.number(),
  provenance: Provenance,
});
export type ExclusionIndex = z.infer<typeof ExclusionIndexSchema>;

export const ExclusionIndexUnavailableReason = z.enum([
  "no-states-analysed",
  "no-comparable-pairs",
]);
export type ExclusionIndexUnavailableReason = z.infer<
  typeof ExclusionIndexUnavailableReason
>;

/**
 * The run-level exclusion result. `index` is nullable and a null carries a
 * reason: a run where every pair was too thin to compare has no worst case, and
 * emitting a zero or falling back to some arbitrary state would invent the most
 * important number in v2 (PRD §6.4).
 */
export const RunExclusionSchema = z.object({
  index: ExclusionIndexSchema.nullable(),
  unavailableReason: ExclusionIndexUnavailableReason.nullable(),
  /** Non-baseline (state, segment) pairs examined. */
  pairsConsidered: z.number().int().min(0),
  /** How many of those yielded a non-null delta. */
  pairsComparable: z.number().int().min(0),
  provenance: Provenance,
});
export type RunExclusion = z.infer<typeof RunExclusionSchema>;

/**
 * AN-06's segments half. A segment with a null delta is **unknown**, not
 * unaffected — the two must never collapse, because "we could not tell" and
 * "this group was fine" are opposite claims about an accessibility result.
 */
export const AffectedSegmentSchema = z.object({
  segment: z.string(),
  label: z.string(),
  delta: z.number().nullable(),
  segmentDropout: z.number().nullable(),
  baselineDropout: z.number().nullable(),
  status: z.enum(["affected", "unknown"]),
  unavailableReason: ExclusionUnavailableReason.nullable(),
});
export type AffectedSegment = z.infer<typeof AffectedSegmentSchema>;

export const StateMetricsSchema = StateMetricsBaseSchema.extend({
  /**
   * CH-04 — the same metrics recomputed over each named segment (`segments.ts`).
   * Keyed by `SegmentId`, typed here as a plain string only because `types.ts`
   * must not import `segments.ts`, which imports this file. The producer
   * (Chorus) keys it from `SEGMENTS`, so the keys are always `SegmentId`.
   *
   * Optional, not nullable: a run recorded before CH-04 has no key here at all,
   * and absent must stay distinguishable from "computed, and empty".
   */
  segments: z.record(z.string(), SegmentStateMetricsSchema).optional(),
  /**
   * AN-07 — this state's `ExclusionDelta` per segment, keyed by `SegmentId`.
   * Written by Analysis into the same `Run.metrics` blob Chorus produced, so
   * `GET /runs/:id/graph` serves it on every `AtlasNode` without a new endpoint
   * and the Atlas inherits per-state deltas when AT-01 lands.
   *
   * Optional for the same reason `segments` is: a pre-AN-07 run has no key.
   */
  exclusion: z.record(z.string(), ExclusionDeltaSchema).optional(),
});
export type StateMetrics = z.infer<typeof StateMetricsSchema>;

// AT-02 / TRD §5.1 — "The Atlas contract — this type existing is what stops the
// map being cosmetic." `GET /runs/:id/graph` serves these, and `metrics` is
// nullable rather than optional on purpose: an explicit null on the wire says
// "Chorus produced nothing for this state", which the UI must render as an em
// dash badged Predicted. An absent key would let a consumer quietly read it as
// zero (CLAUDE.md §6.4, §6.5).
export const AtlasNodeSchema = AppStateSchema.extend({
  metrics: StateMetricsSchema.nullable(),
});
export type AtlasNode = z.infer<typeof AtlasNodeSchema>;

// ---------- Findings ----------

export const FindingSchema = z.object({
  id: z.string(),
  runId: z.string(),
  stateId: z.string(),
  signature: FindingSignature,
  title: z.string(),
  explanation: z.string(),
  frictionScore: z.number(),
  fixValue: z.number(),
  provenance: Provenance,
  evidenceBundle: z.object({
    screenshotPath: z.string(),
    thinkAloud: z.array(z.string()),
  }),
});
export type Finding = z.infer<typeof FindingSchema>;

// ---------- Tours ----------

export const TourStepSchema = z.object({
  id: z.string(),
  order: z.number(),
  stateId: z.string(),
  anchor: SemanticAnchorSchema,
  title: z.string(),
  body: z.string(),
  placement: z.string(),
  status: StepStatus,
});
export type TourStep = z.infer<typeof TourStepSchema>;
