import { describe, expect, it } from "vitest";
import { BASELINE_ARCHETYPE, PERSONA_ARCHETYPES } from "./archetypes.js";
import {
  SEGMENTS,
  SEGMENT_WEIGHTS,
  SegmentDescriptorSchema,
  SegmentId,
  UNSEGMENTED_ARCHETYPES,
  archetypesInSegment,
  segmentById,
  segmentWeight,
  segmentsForPersona,
} from "./segments.js";

const idsIn = (segment: Parameters<typeof archetypesInSegment>[0]) =>
  archetypesInSegment(segment).map((p) => p.archetype);

describe("PS-05 · named segments derived from traits", () => {
  it("declares exactly the five ids PRD §8.2 fixes", () => {
    expect(SEGMENTS.map((s) => s.id)).toEqual([
      "screen-reader",
      "mobile",
      "low-literacy",
      "non-native",
      "confident-desktop",
    ]);
  });

  it("segment ids are unique and parse as SegmentId", () => {
    const ids = SEGMENTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(() => SegmentId.parse(id)).not.toThrow();
    }
  });

  it("every segment satisfies the descriptor schema", () => {
    for (const s of SEGMENTS) {
      expect(() =>
        SegmentDescriptorSchema.parse({ id: s.id, label: s.label }),
      ).not.toThrow();
    }
  });

  it("no segment is empty", () => {
    for (const s of SEGMENTS) {
      expect(archetypesInSegment(s.id).length).toBeGreaterThan(0);
    }
  });

  it("puts each distinguishing archetype in the segment named for it", () => {
    expect(idsIn("screen-reader")).toContain("screen-reader-user");
    expect(idsIn("mobile")).toContain("mobile-commuter");
    expect(idsIn("non-native")).toContain("non-native-speaker");
  });

  // PRD §6.4 defines ExclusionDelta against "the `confident-desktop`
  // archetype". If this segment ever picks up a second member, every delta in
  // the product silently changes meaning, so it is pinned rather than sampled.
  it("the baseline segment is exactly BASELINE_ARCHETYPE and nothing else", () => {
    expect(idsIn("confident-desktop")).toEqual([BASELINE_ARCHETYPE]);
  });

  // Overlap is the design (a persona can be excluded on more than one axis at
  // once). This asserts the overlap is real rather than incidental, so nobody
  // "fixes" segments into a partition later.
  it("allows a persona in more than one segment", () => {
    const nonNative = PERSONA_ARCHETYPES.find(
      (p) => p.archetype === "non-native-speaker",
    )!;
    expect(segmentsForPersona(nonNative)).toEqual(
      expect.arrayContaining(["low-literacy", "non-native"]),
    );
    expect(segmentsForPersona(nonNative).length).toBeGreaterThan(1);
  });

  it("weights are computed from PERSONA_ARCHETYPES, each > 0 and none over 1.0", () => {
    for (const s of SEGMENTS) {
      const expected = archetypesInSegment(s.id).reduce(
        (sum, p) => sum + p.weight,
        0,
      );
      expect(segmentWeight(s.id)).toBeCloseTo(expected, 10);
      expect(SEGMENT_WEIGHTS[s.id]).toBeGreaterThan(0);
      expect(SEGMENT_WEIGHTS[s.id]).toBeLessThanOrEqual(1);
    }
  });

  // Segments overlap and do not cover everyone, so their weights must not be
  // read as a distribution. Asserted so that a future reader who assumes it
  // sums to 1.00 is contradicted by a test rather than by a wrong number in the
  // product.
  it("segment weights are not a distribution and do not sum to 1.00", () => {
    const total = SEGMENTS.reduce((sum, s) => sum + segmentWeight(s.id), 0);
    expect(total).not.toBeCloseTo(1, 2);
  });

  it("segmentById returns undefined for an unknown id", () => {
    expect(segmentById("keyboard-only")).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // Coverage. Read the comment before changing either of these two tests.
  //
  // PS-05 fixes five segment ids. Four archetypes fall outside all five —
  // cautious-ops-lead, distracted-multitasker, impatient-founder and
  // jargon-fluent-engineer — because none of them is excluded along any of the
  // four axes those ids name: all are desktop or laptop, native, and at or
  // above the declared literacy boundary.
  //
  // Full coverage is reachable only by widening a definition past what its own
  // name means — calling 0.8 domainLiteracy "low literacy", or folding
  // keyboard-only into a segment labelled "screen-reader". Either would make
  // CH-04 report a dropout number under a label that does not describe who it
  // measured, which CLAUDE.md §6.5 forbids. So the gap is asserted instead of
  // closed, and it is asserted exactly: widening a threshold, adding a segment
  // or adding an archetype all fail here and get looked at.
  // ------------------------------------------------------------------
  it("covers every archetype that PS-05's five ids name an axis for", () => {
    const covered = PERSONA_ARCHETYPES.filter(
      (p) => segmentsForPersona(p).length > 0,
    ).map((p) => p.archetype);
    expect(covered).toEqual([
      "eager-beginner",
      "non-technical-marketer",
      "mobile-commuter",
      "non-native-speaker",
      "screen-reader-user",
      "confident-desktop",
    ]);
  });

  it("leaves exactly four archetypes unsegmented, and says which", () => {
    expect(UNSEGMENTED_ARCHETYPES.map((p) => p.archetype)).toEqual([
      "cautious-ops-lead",
      "distracted-multitasker",
      "impatient-founder",
      "jargon-fluent-engineer",
    ]);
    const uncoveredWeight = UNSEGMENTED_ARCHETYPES.reduce(
      (sum, p) => sum + p.weight,
      0,
    );
    expect(uncoveredWeight).toBeCloseTo(0.3, 10);
  });
});
