import { describe, expect, it } from "vitest";
import {
  buildSegmentStateMetrics,
  buildStateMetrics,
  calculateFrictionScore,
} from "./scoring.js";
import type { StateMetricsCounters } from "./scoring.js";
import { SegmentStateMetricsSchema, StateMetricsSchema } from "./types.js";

/**
 * CH-04 — the reduction half of per-segment metrics. Chorus owns the bucketing
 * (which walk lands in which segment) and there is no test runner in
 * `apps/engine`, so what is covered here is everything that is pure: the
 * formulas, the thin-sample gate, and the guarantee that a segment's numbers
 * come from the same code as the population's.
 */

// A state entered by 100 personas: 20 gave up, 5 were blocked, some looping.
const counters = (over: Partial<StateMetricsCounters> = {}): StateMetricsCounters => ({
  entered: 120,
  terminated: 20,
  blocked: 5,
  visitsPerPersona: Array.from({ length: 100 }, (_, i) => (i % 5 === 0 ? 2 : 1)),
  deadInteractions: 12,
  totalInteractions: 140,
  stepsBeforeGoalAction: [0, 1, 1, 2, 3],
  reverseEdgeTraversals: 9,
  totalExits: 140,
  ...over,
});

describe("CH-04 · buildStateMetrics", () => {
  it("produces a value that satisfies the StateMetrics schema", () => {
    const m = buildStateMetrics(counters(), 1000, "modeled");
    expect(() => StateMetricsSchema.parse(m)).not.toThrow();
  });

  it("applies PRD §6.1 exactly — dropout is terminated ÷ entered", () => {
    const m = buildStateMetrics(counters(), 1000, "modeled");
    expect(m.dropout).toBeCloseTo(20 / 120, 12);
    expect(m.blocked).toBeCloseTo(5 / 120, 12);
    expect(m.deadClick).toBeCloseTo(12 / 140, 12);
    expect(m.backtrack).toBeCloseTo(9 / 140, 12);
  });

  // §6.3's one-ramp rule applied to scoring: the friction score must be the
  // existing function over the six metrics, never a second formula.
  it("takes frictionScore from calculateFrictionScore and nowhere else", () => {
    const m = buildStateMetrics(counters(), 1000, "modeled");
    expect(m.frictionScore).toBe(
      calculateFrictionScore({
        dropout: m.dropout,
        blocked: m.blocked,
        loop: m.loop,
        deadClick: m.deadClick,
        hesitation: m.hesitation,
        backtrack: m.backtrack,
      }),
    );
    expect(m.fixValue).toBeCloseTo(m.impact * m.reach * m.confidence, 12);
  });

  // Provenance is a parameter so CH-05 changes Chorus, not this function.
  it("carries the provenance it was given rather than assuming one", () => {
    expect(buildStateMetrics(counters(), 1000, "modeled").provenance).toBe("modeled");
    expect(buildStateMetrics(counters(), 1000, "observed").provenance).toBe("observed");
  });

  it("reach is a fraction even when a looping state logs more arrivals than personas", () => {
    const m = buildStateMetrics(counters({ entered: 4000 }), 1000, "modeled");
    expect(m.reach).toBe(1);
  });
});

describe("CH-04 · buildSegmentStateMetrics", () => {
  const MIN = 30;

  it("computes the same numbers as the population reduction for the same counters", () => {
    // The statement, at the reduction level, of "a segment with a single member
    // archetype reports what that archetype alone produced": given the same
    // bucket of walks and the same denominator, the segment record and the
    // overall record are the same numbers, because they are the same code.
    const c = counters();
    const overall = buildStateMetrics(c, 400, "modeled");
    const segment = buildSegmentStateMetrics(c, 400, "modeled", MIN);
    expect(segment.metrics).toEqual(overall);
    expect(segment.metrics!.dropout).toBe(overall.dropout);
  });

  it("satisfies the SegmentStateMetrics schema", () => {
    const s = buildSegmentStateMetrics(counters(), 400, "modeled", MIN);
    expect(() => SegmentStateMetricsSchema.parse(s)).not.toThrow();
  });

  it("records the sample as distinct personas, not arrival events", () => {
    const s = buildSegmentStateMetrics(counters(), 400, "modeled", MIN);
    expect(s.personas).toBe(100); // visitsPerPersona.length
    expect(s.entered).toBe(120); // arrivals, higher because the state loops
    expect(s.simulated).toBe(400);
  });

  // The heart of it (CLAUDE.md §6.5): a thin sample must never read as a
  // measured result. Zeros here would say the screen was easy for a segment we
  // barely saw on it.
  it("returns null metrics below the minimum sample, never zeros", () => {
    const thin = buildSegmentStateMetrics(
      counters({
        entered: 3,
        terminated: 0,
        blocked: 0,
        visitsPerPersona: [1, 1, 1],
        deadInteractions: 0,
        totalInteractions: 3,
        stepsBeforeGoalAction: [0],
        reverseEdgeTraversals: 0,
        totalExits: 3,
      }),
      400,
      "modeled",
      MIN,
    );
    expect(thin.metrics).toBeNull();
    expect(thin.metrics).not.toEqual(expect.objectContaining({ dropout: 0 }));
  });

  it("still records the counts when metrics is null, so the null can be explained", () => {
    const thin = buildSegmentStateMetrics(
      counters({ visitsPerPersona: [1, 1, 1], entered: 3 }),
      400,
      "modeled",
      MIN,
    );
    expect(thin.metrics).toBeNull();
    expect(thin.personas).toBe(3);
    expect(thin.entered).toBe(3);
    expect(thin.simulated).toBe(400);
  });

  it("reports at exactly the minimum and withholds one persona below it", () => {
    const at = buildSegmentStateMetrics(
      counters({ visitsPerPersona: Array(MIN).fill(1) }),
      400,
      "modeled",
      MIN,
    );
    const below = buildSegmentStateMetrics(
      counters({ visitsPerPersona: Array(MIN - 1).fill(1) }),
      400,
      "modeled",
      MIN,
    );
    expect(at.metrics).not.toBeNull();
    expect(below.metrics).toBeNull();
  });

  // A segment nobody from it ever reached is null, not a zero-dropout success.
  it("returns null for a segment that never entered the state at all", () => {
    const none = buildSegmentStateMetrics(
      {
        entered: 0,
        terminated: 0,
        blocked: 0,
        visitsPerPersona: [],
        deadInteractions: 0,
        totalInteractions: 0,
        stepsBeforeGoalAction: [],
        reverseEdgeTraversals: 0,
        totalExits: 0,
      },
      400,
      "modeled",
      MIN,
    );
    expect(none.metrics).toBeNull();
    expect(none.personas).toBe(0);
  });
});

describe("CH-04 · StateMetrics stays additive", () => {
  it("parses a pre-CH-04 metrics object that has no segments key", () => {
    const legacy = buildStateMetrics(counters(), 1000, "modeled");
    const parsed = StateMetricsSchema.parse(legacy);
    expect(parsed.segments).toBeUndefined();
  });

  it("absent segments stays distinguishable from an empty segments record", () => {
    const withSegments = StateMetricsSchema.parse({
      ...buildStateMetrics(counters(), 1000, "modeled"),
      segments: {},
    });
    expect(withSegments.segments).toEqual({});
    expect(withSegments.segments).not.toBeUndefined();
  });
});
