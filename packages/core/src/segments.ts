import { z } from "zod";
import { BASELINE_ARCHETYPE, PERSONA_ARCHETYPES } from "./archetypes.js";
import type { PersonaTraitVector } from "./types.js";

/**
 * PS-05 — named segments derived from traits.
 *
 * A **segment** is a named slice of the persona population (CLAUDE.md §3). It
 * is derived, never declared per archetype: a segment is a predicate over the
 * PS-01 trait vector, so adding an archetype puts it in the right segments
 * automatically and no archetype carries a hand-maintained segment list that
 * could drift from its own traits.
 *
 * This file is the gate for the exclusion story (L3). CH-04 computes
 * `StateMetrics` per segment, AN-07 turns the difference between a segment and
 * the baseline into `ExclusionDelta`, and PRD §6.4 defines that delta as
 * `Dropout(s | g) − Dropout(s | baseline)`. Nothing consumes any of this yet.
 *
 * **Segments are not a partition and must not be forced into one.** They
 * overlap by design — `non-native-speaker` is in both `non-native` and
 * `low-literacy` — because a persona can be excluded along more than one axis
 * at once, and collapsing that into a single label would hide exactly the
 * compounding this metric exists to find. For the same reason a persona may
 * belong to no segment at all: see `UNSEGMENTED_ARCHETYPES` below.
 *
 * L1 applies here as it does to the archetypes: a segment is a mechanical
 * filter over declared parameters, not a claim that real screen-reader users
 * behave the way this population does.
 */

// Declared, not fitted. There is no calibration subsystem to fit it with
// (CLAUDE.md §5), so this boundary is an argued choice rather than a measured
// one, and it is stated here so it can be argued with.
//
// 0.5 is not a fresh invention: `archetypes.test.ts` already uses
// `domainLiteracy < 0.5` as the low-literacy edge of the exclusion-weighted
// majority it asserts (L3). Reusing that exact boundary keeps one definition of
// "low literacy" in the package instead of two that can drift apart. It is also
// the midpoint of the trait's declared 0–1 range, so it does not quietly encode
// a judgement about where competence begins.
const LOW_LITERACY_MAX = 0.5;

/**
 * The five segment ids, fixed by PRD §8.2's PS-05 row. Zod first (§6.2): this
 * is the cross-package type, and CH-04's per-segment metrics and AN-07's
 * `ExclusionDelta` will both key on it.
 */
export const SegmentId = z.enum([
  "screen-reader",
  "mobile",
  "low-literacy",
  "non-native",
  "confident-desktop",
]);
export type SegmentId = z.infer<typeof SegmentId>;

/**
 * The part of a segment that crosses a package boundary — id and human label.
 * The predicate is deliberately not in the schema: it is code, not data, and
 * Zod's job here is to validate what travels the wire to the interface, not to
 * wrap a function in a `z.custom` that validates nothing.
 */
export const SegmentDescriptorSchema = z.object({
  id: SegmentId,
  label: z.string(),
});
export type SegmentDescriptor = z.infer<typeof SegmentDescriptorSchema>;

/** Reads the PS-01 trait vector only. No segment may introduce a trait. */
export type SegmentPredicate = (persona: PersonaTraitVector) => boolean;

export type Segment = SegmentDescriptor & {
  readonly predicate: SegmentPredicate;
};

/**
 * The five segments as a declared constant array, in the order PRD §8.2 lists
 * them. Every predicate reads only traits that already exist on
 * `PersonaTraitVectorSchema`.
 */
export const SEGMENTS: readonly Segment[] = [
  {
    id: "screen-reader",
    label: "Screen-reader",
    // `inputMode` exactly, never "assistive input in general". Folding
    // keyboard-only in here would put `jargon-fluent-engineer` into a segment
    // named for a different assistive technology, and CH-04's per-segment
    // dropout would then be reported under a label that does not describe who
    // it measured. Keyboard-only is a real exclusion axis and it is not one of
    // PS-05's five ids, so it stays unsegmented rather than mislabelled.
    predicate: (p) => p.inputMode === "screen-reader",
  },
  {
    id: "mobile",
    label: "Mobile",
    // The viewport, which is what the walk mechanically branches on: a control
    // offscreen at 390px is removed from the edge set (CLAUDE.md §6.8).
    predicate: (p) => p.device === "mobile-390",
  },
  {
    id: "low-literacy",
    label: "Low digital literacy",
    // Strictly below the declared boundary, so an archetype sitting exactly on
    // it is excluded rather than swept in by a `<=` nobody chose deliberately.
    predicate: (p) => p.domainLiteracy < LOW_LITERACY_MAX,
  },
  {
    id: "non-native",
    label: "Non-native reader",
    // `locale` is not a language tag (see `PersonaLocale`) — it records only
    // whether the persona reads the product as a second language.
    predicate: (p) => p.locale === "non-native",
  },
  {
    id: "confident-desktop",
    label: "Confident desktop (baseline)",
    // Membership in the baseline archetype, deliberately NOT a trait threshold.
    // PRD §6.4 defines `ExclusionDelta` against "the `confident-desktop`
    // archetype"; if this segment were instead "high literacy and a large
    // viewport and native locale", then a later archetype that happened to
    // clear those thresholds would silently join the baseline and shift every
    // delta in the product without anyone editing this file. One definition,
    // one place: `BASELINE_ARCHETYPE`.
    predicate: (p) => p.archetype === BASELINE_ARCHETYPE,
  },
];

/**
 * PRD §6.4 — the segment every `ExclusionDelta` is measured against.
 *
 * Named here, once, so AN-07 never re-derives "which one is the baseline" from
 * a trait threshold or a string literal of its own. It is the id of the segment
 * whose sole member is `BASELINE_ARCHETYPE`; `segments.test.ts` pins that
 * membership, so this constant and the archetype definition cannot drift apart.
 */
export const BASELINE_SEGMENT = "confident-desktop" as const satisfies SegmentId;

/**
 * The segments a persona belongs to, in `SEGMENTS` order. Pure, and returns a
 * possibly-empty array — membership is not exhaustive (see
 * `UNSEGMENTED_ARCHETYPES`), so callers must handle a persona in no segment
 * rather than assuming a partition.
 */
export function segmentsForPersona(persona: PersonaTraitVector): SegmentId[] {
  return SEGMENTS.filter((s) => s.predicate(persona)).map((s) => s.id);
}

export function segmentById(id: string): Segment | undefined {
  return SEGMENTS.find((s) => s.id === id);
}

/** The declared archetypes that fall in a segment, in `PERSONA_ARCHETYPES` order. */
export function archetypesInSegment(id: SegmentId): readonly PersonaTraitVector[] {
  const segment = segmentById(id);
  if (!segment) return [];
  return PERSONA_ARCHETYPES.filter((p) => segment.predicate(p));
}

/**
 * Summed archetype weight per segment, computed from `PERSONA_ARCHETYPES` —
 * never a second hand-written table. These do **not** sum to 1.00 and are not
 * meant to: segments overlap, and four archetypes are in none of them.
 *
 * This is the share of the population a segment speaks for, which is what makes
 * a per-segment dropout number weighable against the baseline's 0.07.
 */
export const SEGMENT_WEIGHTS: Readonly<Record<SegmentId, number>> =
  Object.fromEntries(
    SEGMENTS.map((s) => [
      s.id,
      PERSONA_ARCHETYPES.filter((p) => s.predicate(p)).reduce(
        (sum, p) => sum + p.weight,
        0,
      ),
    ]),
  ) as Record<SegmentId, number>;

export function segmentWeight(id: SegmentId): number {
  return SEGMENT_WEIGHTS[id];
}

/**
 * The archetypes PS-05's five ids do not cover, computed rather than listed.
 *
 * Today this is `cautious-ops-lead`, `distracted-multitasker`,
 * `impatient-founder` and `jargon-fluent-engineer` — 0.30 of the population.
 * None of them is excluded along any of the four axes PS-05 names: all are
 * desktop or laptop, native, and at or above the literacy boundary. Two of them
 * are distinguished by very low patience and one by keyboard-only input, and
 * neither is one of the five ids PRD §8.2 fixes.
 *
 * It is exported because a silent gap is worse than a stated one: CH-04 will
 * compute per-segment metrics over these segments, and whoever reads that
 * output needs to know it does not account for the whole population. If a sixth
 * segment is ever added, this shrinks on its own.
 */
export const UNSEGMENTED_ARCHETYPES: readonly PersonaTraitVector[] =
  PERSONA_ARCHETYPES.filter((p) => segmentsForPersona(p).length === 0);
