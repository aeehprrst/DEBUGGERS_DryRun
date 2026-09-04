import { z } from "zod";

// Prisma enums are not supported on SQLite — these Zod enums are the single
// source of truth, enforced at the application layer (Backend Schema §2).

export const RunStatus = z.enum([
  "CREATED",
  "CRAWLING",
  "SCOUTING",
  "CALIBRATING",
  "CHORUS",
  "ANALYZING",
  "TOURING",
  "DONE",
  "FAILED",
  "DEGRADED",
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunStage = z.enum([
  "crawl",
  "scouts",
  "calibration",
  "chorus",
  "analysis",
  "tour",
  "done",
]);
export type RunStage = z.infer<typeof RunStage>;

export const FindingSignature = z.enum([
  "hidden-cta",
  "ambiguous-cta",
  "silent-validation",
  "dead-end",
  "offscreen-control",
  "jargon-gate",
  "excessive-choice",
  "slow-response",
]);
export type FindingSignature = z.infer<typeof FindingSignature>;

export const Provenance = z.enum(["observed", "modeled", "predicted"]);
export type Provenance = z.infer<typeof Provenance>;

export const StepStatus = z.enum([
  "proposed",
  "approved",
  "edited",
  "rejected",
]);
export type StepStatus = z.infer<typeof StepStatus>;

export const ActionType = z.enum(["click", "type", "select", "navigate", "wait"]);
export type ActionType = z.infer<typeof ActionType>;

export const DeviceType = z.enum(["desktop-1440", "laptop-1280", "mobile-390"]);
export type DeviceType = z.infer<typeof DeviceType>;

export const InputMode = z.enum(["pointer", "keyboard-only", "screen-reader"]);
export type InputMode = z.infer<typeof InputMode>;

export const DecisionSource = z.enum(["heuristic", "model", "fallback"]);
export type DecisionSource = z.infer<typeof DecisionSource>;
