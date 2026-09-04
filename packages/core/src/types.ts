import { z } from "zod";
import {
  ActionType,
  DeviceType,
  FindingSignature,
  InputMode,
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

export const AppStateSchema = z.object({
  id: z.string(),
  fingerprint: z.string(),
  url: z.string(),
  title: z.string(),
  screenshotPath: z.string(),
  a11yTree: z.array(A11yNodeSchema),
  staticSignals: z.record(z.string(), z.any()),
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

// ---------- Personas & tasks ----------

export const PersonaTraitVectorSchema = z.object({
  role: z.string(),
  domainLiteracy: z.number().min(0).max(1),
  patience: z.number(),
  riskAversion: z.number().min(0).max(1),
  readingDepth: z.number().min(0).max(1),
  priorFamiliarity: z.number().min(0).max(1),
  device: DeviceType,
  inputMode: InputMode,
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
