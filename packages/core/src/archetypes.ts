import type { PersonaTraitVector } from "./types.js";

/**
 * PS-02 — the ten archetypes, declared once in the package everything imports.
 *
 * The population is **deliberately weighted toward digital exclusion** (L3):
 * low digital literacy, non-native readers, mobile, low patience and
 * screen-reader users together carry 0.63 of it, and the fully-capable
 * `confident-desktop` baseline carries 0.07. This is not a conversion mix and
 * must never be described as one — it is the population whose exclusion we are
 * trying to measure, and the baseline exists to measure the others against.
 *
 * **What is fixed and what is declared.** PRD §8.2 fixes each archetype's
 * weight and its *distinguishing* traits — the two or three the table names.
 * Every other value here is a declared default chosen to be internally
 * consistent, and nothing in this file has been fitted against Meridian or
 * against any observed outcome. There is no calibration subsystem (CLAUDE.md
 * §5) and these numbers are not calibrated; they are the population we say we
 * are simulating, stated openly so it can be argued with.
 *
 * L1 applies to every value here: none of this claims behavioural realism. A
 * trait is a mechanical parameter over the graph walk (CLAUDE.md §6.8) — a step
 * cap, a viewport, a withheld screenshot — never an instruction to a model to
 * act a certain way.
 *
 * `maxMs` is carried because PS-01 specifies it, but the walk cannot enforce it
 * yet: nothing measures per-action latency (`medianActionLatencyMs` is the one
 * static signal still missing), so there is no clock for it to run against.
 * Chorus enforces `maxSteps` and says so rather than pretending otherwise.
 */
export const PERSONA_ARCHETYPES: readonly PersonaTraitVector[] = [
  {
    archetype: "eager-beginner",
    label: "Eager Beginner",
    role: "New user setting up their first workspace",
    // PRD: low domainLiteracy, high patience.
    domainLiteracy: 0.25,
    patience: { maxSteps: 22, maxMs: 240_000 },
    riskAversion: 0.45,
    readingDepth: 0.7,
    priorFamiliarity: 0.1,
    device: "laptop-1280",
    inputMode: "pointer",
    locale: "native",
    weight: 0.14,
  },
  {
    archetype: "non-technical-marketer",
    label: "Non-technical Marketer",
    role: "Marketer connecting a data source without engineering help",
    // PRD: low domainLiteracy, mid patience.
    domainLiteracy: 0.3,
    patience: { maxSteps: 12, maxMs: 150_000 },
    riskAversion: 0.5,
    readingDepth: 0.45,
    priorFamiliarity: 0.15,
    device: "desktop-1440",
    inputMode: "pointer",
    locale: "native",
    weight: 0.13,
  },
  {
    archetype: "mobile-commuter",
    label: "Mobile Commuter",
    role: "Operator finishing setup on a phone between stops",
    // PRD: device mobile-390, low patience.
    domainLiteracy: 0.55,
    patience: { maxSteps: 7, maxMs: 70_000 },
    riskAversion: 0.35,
    readingDepth: 0.25,
    priorFamiliarity: 0.3,
    device: "mobile-390",
    inputMode: "pointer",
    locale: "native",
    weight: 0.13,
  },
  {
    archetype: "non-native-speaker",
    label: "Non-native Speaker",
    role: "Operator working through the product in a second language",
    // PRD: locale non-native, low readingDepth.
    domainLiteracy: 0.4,
    patience: { maxSteps: 14, maxMs: 200_000 },
    riskAversion: 0.5,
    readingDepth: 0.3,
    priorFamiliarity: 0.2,
    device: "laptop-1280",
    inputMode: "pointer",
    locale: "non-native",
    weight: 0.12,
  },
  {
    archetype: "screen-reader-user",
    label: "Screen-Reader User",
    role: "Operator navigating the product with a screen reader",
    // PRD: inputMode screen-reader. Note the domainLiteracy and readingDepth
    // here are mid-to-high on purpose — a screen-reader user is not a novice,
    // and modelling them as one would make the exclusion result a statement
    // about competence instead of about the interface.
    domainLiteracy: 0.6,
    patience: { maxSteps: 18, maxMs: 300_000 },
    riskAversion: 0.4,
    readingDepth: 0.6,
    priorFamiliarity: 0.35,
    device: "laptop-1280",
    inputMode: "screen-reader",
    locale: "native",
    weight: 0.11,
  },
  {
    archetype: "cautious-ops-lead",
    label: "Cautious Ops Lead",
    role: "Ops lead evaluating the product before committing the team",
    // PRD: high riskAversion, high readingDepth.
    domainLiteracy: 0.8,
    patience: { maxSteps: 20, maxMs: 260_000 },
    riskAversion: 0.8,
    readingDepth: 0.85,
    priorFamiliarity: 0.5,
    device: "laptop-1280",
    inputMode: "pointer",
    locale: "native",
    weight: 0.09,
  },
  {
    archetype: "distracted-multitasker",
    label: "Distracted Multitasker",
    role: "Operator setting up between two other things",
    // PRD: very low patience.
    domainLiteracy: 0.55,
    patience: { maxSteps: 5, maxMs: 45_000 },
    riskAversion: 0.3,
    readingDepth: 0.15,
    priorFamiliarity: 0.25,
    device: "laptop-1280",
    inputMode: "pointer",
    locale: "native",
    weight: 0.08,
  },
  {
    archetype: "impatient-founder",
    label: "Impatient Founder",
    role: "Founder wiring up analytics as fast as possible",
    // PRD: low patience, high priorFamiliarity.
    domainLiteracy: 0.65,
    patience: { maxSteps: 6, maxMs: 55_000 },
    riskAversion: 0.25,
    readingDepth: 0.2,
    priorFamiliarity: 0.75,
    device: "desktop-1440",
    inputMode: "pointer",
    locale: "native",
    weight: 0.07,
  },
  {
    archetype: "confident-desktop",
    label: "Confident Desktop",
    role: "Experienced operator on a large screen — the ExclusionDelta baseline",
    // PRD: high everything. This is the reference every other segment's
    // exclusion is measured against, so it is deliberately the easiest case.
    domainLiteracy: 0.85,
    patience: { maxSteps: 24, maxMs: 300_000 },
    riskAversion: 0.3,
    readingDepth: 0.8,
    priorFamiliarity: 0.8,
    device: "desktop-1440",
    inputMode: "pointer",
    locale: "native",
    weight: 0.07,
  },
  {
    archetype: "jargon-fluent-engineer",
    label: "Jargon-Fluent Engineer",
    role: "Engineer configuring the webhook endpoint",
    // PRD: high domainLiteracy, high priorFamiliarity. Keyboard-only is a
    // declared choice, not a PRD one — it is the archetype where it is most
    // plausible, and TRD §5.4's keyboard rule needs a population that
    // exercises it.
    domainLiteracy: 0.95,
    patience: { maxSteps: 18, maxMs: 220_000 },
    riskAversion: 0.4,
    readingDepth: 0.65,
    priorFamiliarity: 0.85,
    device: "laptop-1280",
    inputMode: "keyboard-only",
    locale: "native",
    weight: 0.06,
  },
];

/** Weights are specified to sum to 1.00 (PRD §8.2); asserted in archetypes.test.ts. */
export const ARCHETYPE_WEIGHT_TOTAL = PERSONA_ARCHETYPES.reduce(
  (sum, p) => sum + p.weight,
  0,
);

export function archetypeById(id: string): PersonaTraitVector | undefined {
  return PERSONA_ARCHETYPES.find((p) => p.archetype === id);
}

/** TRD §5.1 — the ExclusionDelta reference. */
export const BASELINE_ARCHETYPE = "confident-desktop";
