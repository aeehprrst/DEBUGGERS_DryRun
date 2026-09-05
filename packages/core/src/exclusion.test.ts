import { describe, expect, it } from "vitest";
import {
  affectedSegmentsFor,
  computeExclusionDeltas,
  computeExclusionIndex,
  screenNameFor,
} from "./exclusion.js";
import { BASELINE_SEGMENT, SEGMENTS } from "./segments.js";
import {
  ExclusionDeltaSchema,
  RunExclusionSchema,
  type SegmentStateMetrics,
  type StateMetricsBase,
} from "./types.js";

/** A segment record whose dropout is `dropout`, or null for a thin sample. */
const seg = (
  dropout: number | null,
  personas = 100,
): SegmentStateMetrics => ({
  personas,
  entered: personas,
  simulated: 200,
  metrics:
    dropout === null
      ? null
      : ({
          frictionScore: dropout * 100,
          fixValue: 0.1,
          dropout,
          blocked: 0,
          loop: 0,
          deadClick: 0,
          hesitation: 0,
          backtrack: 0,
          impact: dropout,
          reach: 0.5,
          confidence: 1,
          provenance: "modeled",
        } satisfies StateMetricsBase),
});

/** A full five-segment map. Baseline last, matching SEGMENTS order. */
const segments = (
  over: Partial<Record<string, SegmentStateMetrics>> = {},
): Record<string, SegmentStateMetrics> => ({
  "screen-reader": seg(0.4),
  mobile: seg(0.3),
  "low-literacy": seg(0.2),
  "non-native": seg(0.05),
  [BASELINE_SEGMENT]: seg(0.1),
  ...over,
});

describe("AN-07 · computeExclusionDeltas", () => {
  it("subtracts the baseline dropout, per PRD §6.4", () => {
    const d = computeExclusionDeltas("s2", segments());
    expect(d["screen-reader"].delta).toBeCloseTo(0.4 - 0.1, 12);
    expect(d.mobile.delta).toBeCloseTo(0.3 - 0.1, 12);
    // A segment that does better than the baseline gets a negative delta, not
    // a clamp to zero — the sign is the information.
    expect(d["non-native"].delta).toBeCloseTo(0.05 - 0.1, 12);
  });

  it("gives every segment a row and satisfies the schema", () => {
    const d = computeExclusionDeltas("s2", segments());
    expect(Object.keys(d)).toEqual(SEGMENTS.map((s) => s.id));
    for (const row of Object.values(d)) {
      expect(() => ExclusionDeltaSchema.parse(row)).not.toThrow();
    }
  });

  it("the baseline's delta against itself is 0 and is flagged", () => {
    const d = computeExclusionDeltas("s2", segments());
    expect(d[BASELINE_SEGMENT].delta).toBe(0);
    expect(d[BASELINE_SEGMENT].isBaseline).toBe(true);
    expect(d["screen-reader"].isBaseline).toBe(false);
  });

  // The core of the null rule.
  it("a null segment dropout yields a null delta, never a zero", () => {
    const d = computeExclusionDeltas(
      "s5",
      segments({ "screen-reader": seg(null, 17) }),
    );
    expect(d["screen-reader"].delta).toBeNull();
    expect(d["screen-reader"].delta).not.toBe(0);
    expect(d["screen-reader"].unavailableReason).toBe("segment-sample-too-thin");
    // The other segments are unaffected — one thin segment is not contagious.
    expect(d.mobile.delta).toBeCloseTo(0.2, 12);
  });

  // The one that matters most: a missing reference nulls the whole state.
  it("a null baseline yields a null delta for EVERY segment on that state", () => {
    const d = computeExclusionDeltas(
      "s5",
      segments({ [BASELINE_SEGMENT]: seg(null, 21) }),
    );
    for (const segment of SEGMENTS) {
      expect(d[segment.id].delta).toBeNull();
    }
    expect(d["screen-reader"].unavailableReason).toBe("baseline-sample-too-thin");
    expect(d[BASELINE_SEGMENT].unavailableReason).toBe("both-samples-too-thin");
  });

  it("never substitutes anything for a missing baseline", () => {
    const d = computeExclusionDeltas(
      "s5",
      segments({ [BASELINE_SEGMENT]: seg(null, 21) }),
    );
    // The segment's own dropout survives for display, but no delta is invented
    // from it — a lone dropout is not an exclusion measurement.
    expect(d["screen-reader"].segmentDropout).toBeCloseTo(0.4, 12);
    expect(d["screen-reader"].baselineDropout).toBeNull();
    expect(d["screen-reader"].delta).toBeNull();
  });

  it("records both sample counts so a null can be explained", () => {
    const d = computeExclusionDeltas(
      "s5",
      segments({ "screen-reader": seg(null, 17), [BASELINE_SEGMENT]: seg(0.1, 21) }),
    );
    expect(d["screen-reader"].segmentPersonas).toBe(17);
    expect(d["screen-reader"].baselinePersonas).toBe(21);
  });

  it("distinguishes a segment never recorded from one recorded but thin", () => {
    const withoutKey = computeExclusionDeltas("s0", { [BASELINE_SEGMENT]: seg(0.1) });
    expect(withoutKey.mobile.unavailableReason).toBe("segment-not-recorded");
    expect(withoutKey.mobile.segmentPersonas).toBe(0);

    const noSegmentsAtAll = computeExclusionDeltas("s0", undefined);
    expect(noSegmentsAtAll.mobile.delta).toBeNull();
    expect(noSegmentsAtAll.mobile.unavailableReason).toBe("segment-not-recorded");
  });

  it("is modeled, not observed (L6)", () => {
    const d = computeExclusionDeltas("s2", segments());
    for (const row of Object.values(d)) {
      expect(row.provenance).toBe("modeled");
    }
  });
});

describe("AN-07 · computeExclusionIndex", () => {
  const stateWith = (
    stateId: string,
    stateName: string,
    over: Partial<Record<string, SegmentStateMetrics>> = {},
  ) => ({
    stateId,
    stateName,
    deltas: computeExclusionDeltas(stateId, segments(over)),
  });

  it("picks the largest non-null delta and names it", () => {
    const run = computeExclusionIndex([
      stateWith("s2", "Connect Source"),
      stateWith("s3", "Invite Team", { "screen-reader": seg(0.15) }),
    ]);
    expect(run.index).not.toBeNull();
    expect(run.index!.stateId).toBe("s2");
    expect(run.index!.stateName).toBe("Connect Source");
    expect(run.index!.segment).toBe("screen-reader");
    expect(run.index!.segmentLabel).toBe("Screen-reader");
    expect(run.index!.delta).toBeCloseTo(0.3, 12);
    expect(run.index!.segmentDropout).toBeCloseTo(0.4, 12);
    expect(run.index!.baselineDropout).toBeCloseTo(0.1, 12);
    expect(() => RunExclusionSchema.parse(run)).not.toThrow();
  });

  // The baseline's delta is 0 by construction. On a run where every real
  // segment is unmeasurable it would otherwise be the only candidate left and
  // would report "worst exclusion: confident-desktop, +0.00".
  it("never lets the baseline win the index", () => {
    const allSegmentsThin = {
      "screen-reader": seg(null, 3),
      mobile: seg(null, 3),
      "low-literacy": seg(null, 3),
      "non-native": seg(null, 3),
    };
    const run = computeExclusionIndex([
      stateWith("s5", "Configure Webhook", allSegmentsThin),
    ]);
    expect(run.index).toBeNull();
    expect(run.unavailableReason).toBe("no-comparable-pairs");
  });

  it("excludes the baseline from the candidate count entirely", () => {
    const run = computeExclusionIndex([stateWith("s2", "Connect Source")]);
    expect(run.pairsConsidered).toBe(SEGMENTS.length - 1);
    expect(run.index!.segment).not.toBe(BASELINE_SEGMENT);
  });

  it("a run with no non-null deltas yields a null index with a reason", () => {
    const run = computeExclusionIndex([
      stateWith("s5", "Configure Webhook", { [BASELINE_SEGMENT]: seg(null, 21) }),
    ]);
    expect(run.index).toBeNull();
    expect(run.unavailableReason).toBe("no-comparable-pairs");
    expect(run.pairsComparable).toBe(0);
    expect(run.pairsConsidered).toBeGreaterThan(0);
  });

  it("a run with no analysed states says so distinctly", () => {
    const run = computeExclusionIndex([]);
    expect(run.index).toBeNull();
    expect(run.unavailableReason).toBe("no-states-analysed");
    expect(run.pairsConsidered).toBe(0);
  });

  it("is deterministic across ties", () => {
    const states = [
      stateWith("s3", "Invite Team"),
      stateWith("s2", "Connect Source"),
    ];
    const a = computeExclusionIndex(states);
    const b = computeExclusionIndex([...states].reverse());
    expect(a.index!.stateId).toBe(b.index!.stateId);
    expect(a.index!.segment).toBe(b.index!.segment);
  });

  it("is modeled (L6)", () => {
    const run = computeExclusionIndex([stateWith("s2", "Connect Source")]);
    expect(run.provenance).toBe("modeled");
    expect(run.index!.provenance).toBe("modeled");
  });
});

describe("AN-06 · affectedSegmentsFor", () => {
  const deltas = (over: Partial<Record<string, SegmentStateMetrics>> = {}) =>
    computeExclusionDeltas("s2", segments(over));

  it("lists positive deltas largest first, with no threshold", () => {
    const rows = affectedSegmentsFor(deltas());
    expect(rows.map((r) => r.segment)).toEqual([
      "screen-reader", // +0.30
      "mobile", // +0.20
      "low-literacy", // +0.10
    ]);
    expect(rows.every((r) => r.status === "affected")).toBe(true);
  });

  it("omits segments measured as not disproportionately affected", () => {
    // non-native is 0.05 against a 0.1 baseline — answered, and negative.
    expect(affectedSegmentsFor(deltas()).map((r) => r.segment)).not.toContain(
      "non-native",
    );
  });

  it("omits the baseline — it is the reference, not an affected group", () => {
    expect(affectedSegmentsFor(deltas()).map((r) => r.segment)).not.toContain(
      BASELINE_SEGMENT,
    );
  });

  // "we could not tell" and "this group was fine" are opposite claims.
  it("carries a null delta as unknown rather than dropping it", () => {
    const rows = affectedSegmentsFor(deltas({ mobile: seg(null, 12) }));
    const mobile = rows.find((r) => r.segment === "mobile");
    expect(mobile).toBeDefined();
    expect(mobile!.status).toBe("unknown");
    expect(mobile!.delta).toBeNull();
    expect(mobile!.unavailableReason).toBe("segment-sample-too-thin");
  });

  it("puts unknowns after the affected, so ranking still reads top-down", () => {
    const rows = affectedSegmentsFor(deltas({ "screen-reader": seg(null, 4) }));
    expect(rows.map((r) => r.status)).toEqual(["affected", "affected", "unknown"]);
  });

  it("a null baseline makes every segment unknown, none affected", () => {
    const rows = affectedSegmentsFor(deltas({ [BASELINE_SEGMENT]: seg(null, 21) }));
    expect(rows).toHaveLength(SEGMENTS.length - 1);
    expect(rows.every((r) => r.status === "unknown")).toBe(true);
    expect(rows.every((r) => r.delta === null)).toBe(true);
  });
});

describe("AN-07 · screenNameFor", () => {
  it("disambiguates two states that share a title", () => {
    const page = screenNameFor({ title: "Meridian", url: "http://localhost:5173/webhook" });
    const modal = screenNameFor({ title: "Meridian", url: "http://localhost:5173/invite" });
    expect(page).toBe("Meridian · /webhook");
    expect(page).not.toBe(modal);
  });

  it("drops query and hash, and survives a url it cannot parse", () => {
    expect(screenNameFor({ title: "M", url: "https://x.test/a/b?q=1#f" })).toBe("M · /a/b");
    expect(screenNameFor({ title: "M", url: "https://x.test" })).toBe("M · /");
    expect(screenNameFor({ title: "", url: "/relative/path" })).toBe("/relative/path");
  });
});
