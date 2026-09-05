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
  // App Flow §3 — `DELETE /runs/:id` while running. Terminal, and the partial
  // graph is retained and viewable rather than discarded.
  "CANCELLED",
]);
export type RunStatus = z.infer<typeof RunStatus>;

// The statuses a run can be left in by a process that died mid-pipeline.
// Backend Schema §5's orphan sweep must cover every one of them — a run killed
// during analysis previously stayed non-terminal forever and the UI waited on
// it indefinitely. Derived from the enum rather than hand-listed so a new
// status cannot be added without appearing here or in TERMINAL_RUN_STATUSES.
export const TERMINAL_RUN_STATUSES = [
  "DONE",
  "FAILED",
  "DEGRADED",
  "CANCELLED",
] as const satisfies readonly RunStatus[];

export const NON_TERMINAL_RUN_STATUSES = RunStatus.options.filter(
  (s): s is Exclude<RunStatus, (typeof TERMINAL_RUN_STATUSES)[number]> =>
    !(TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(s),
);

// The five stages the orchestrator actually runs, plus the terminal one.
// "scouts" and "calibration" are cut (CLAUDE.md §5) and are gone from here:
// they were kept alive only by LiveConsole's stage rail typing itself as
// RunStage[], which meant a dead subsystem was still shaping the operator's
// progress display and a run could be persisted into a stage nothing advances.
export const RunStage = z.enum([
  "crawl",
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

// PS-01 / TRD §5.1 — the tenth trait. Not a language tag: the walk model does
// not know what language the target is in, only whether the persona is reading
// it as a second language, which is what changes the jargon and reading-depth
// terms (TRD §5.4).
export const PersonaLocale = z.enum(["native", "non-native"]);
export type PersonaLocale = z.infer<typeof PersonaLocale>;

export const DecisionSource = z.enum(["heuristic", "model", "fallback"]);
export type DecisionSource = z.infer<typeof DecisionSource>;
