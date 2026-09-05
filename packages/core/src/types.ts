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

export const StateMetricsSchema = z.object({
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
