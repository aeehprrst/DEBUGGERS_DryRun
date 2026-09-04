import { describe, expect, it } from "vitest";
import {
  calculateBacktrack,
  calculateBlocked,
  calculateDeadClick,
  calculateDropout,
  calculateFixValue,
  calculateFrictionScore,
  calculateHesitation,
  calculateLoop,
  FRICTION_WEIGHTS,
} from "./scoring.js";

describe("PRD §8.2 — Friction Score", () => {
  it("matches a hand-computed fixture", () => {
    // Hand-computed fixture, one state, 10 personas entered:
    //   dropout    = 40/100                          = 0.40
    //   blocked    = 20/100                           = 0.20
    //   loop       = min(mean([0,0,0,0,0,0,0,0,0,2]), 5) / 5
    //              = min(0.2, 5) / 5                   = 0.04
    //   deadClick  = 15/100                            = 0.15
    //   hesitation = median([4,4,4,4]) / (4 + 4)        = 4/8 = 0.50
    //   backtrack  = 10/50                             = 0.20
    //
    // frictionScore = 100 * (0.35*0.40 + 0.20*0.20 + 0.15*0.04
    //                       + 0.12*0.15 + 0.10*0.50 + 0.08*0.20)
    //               = 100 * (0.140 + 0.040 + 0.006 + 0.018 + 0.050 + 0.016)
    //               = 100 * 0.270
    //               = 27
    const dropout = calculateDropout(100, 40);
    const blocked = calculateBlocked(100, 20);
    const loop = calculateLoop([1, 1, 1, 1, 1, 1, 1, 1, 1, 3]);
    const deadClick = calculateDeadClick(15, 100);
    const hesitation = calculateHesitation([4, 4, 4, 4]);
    const backtrack = calculateBacktrack(10, 50);

    expect(dropout).toBeCloseTo(0.4, 10);
    expect(blocked).toBeCloseTo(0.2, 10);
    expect(loop).toBeCloseTo(0.04, 10);
    expect(deadClick).toBeCloseTo(0.15, 10);
    expect(hesitation).toBeCloseTo(0.5, 10);
    expect(backtrack).toBeCloseTo(0.2, 10);

    const frictionScore = calculateFrictionScore({
      dropout,
      blocked,
      loop,
      deadClick,
      hesitation,
      backtrack,
    });

    expect(frictionScore).toBeCloseTo(27, 9);
  });

  it("weights sum to 1.00, per PRD §8.2", () => {
    const total = Object.values(FRICTION_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("returns 0 when every sub-metric is 0", () => {
    const frictionScore = calculateFrictionScore({
      dropout: 0,
      blocked: 0,
      loop: 0,
      deadClick: 0,
      hesitation: 0,
      backtrack: 0,
    });
    expect(frictionScore).toBe(0);
  });

  it("returns 100 when every sub-metric is 1", () => {
    const frictionScore = calculateFrictionScore({
      dropout: 1,
      blocked: 1,
      loop: 1,
      deadClick: 1,
      hesitation: 1,
      backtrack: 1,
    });
    expect(frictionScore).toBeCloseTo(100, 9);
  });
});

describe("PRD §8.3 — Fix Value", () => {
  it("matches a hand-computed fixture", () => {
    // impact = 0.6, reach = 0.8, confidence = 0.75
    // fixValue = 0.6 * 0.8 * 0.75 = 0.36
    const fixValue = calculateFixValue(0.6, 0.8, 0.75);
    expect(fixValue).toBeCloseTo(0.36, 10);
  });

  it("is 0 when any factor is 0", () => {
    expect(calculateFixValue(0, 0.8, 0.75)).toBe(0);
    expect(calculateFixValue(0.6, 0, 0.75)).toBe(0);
    expect(calculateFixValue(0.6, 0.8, 0)).toBe(0);
  });
});

describe("PRD §8.1 — per-state metrics", () => {
  it("dropout and blocked are 0 when nobody entered the state", () => {
    expect(calculateDropout(0, 0)).toBe(0);
    expect(calculateBlocked(0, 0)).toBe(0);
  });

  it("loop is 0 for personas who never revisit", () => {
    expect(calculateLoop([1, 1, 1, 1])).toBe(0);
  });

  it("deadClick is 0 when there were no interactions", () => {
    expect(calculateDeadClick(0, 0)).toBe(0);
  });

  it("backtrack is 0 when there were no exits", () => {
    expect(calculateBacktrack(0, 0)).toBe(0);
  });

  it("hesitation handles an even-length sample via the median of the middle pair", () => {
    // median([1,2,3,4]) = (2+3)/2 = 2.5 -> 2.5 / (2.5+4) = 2.5/6.5
    const hesitation = calculateHesitation([1, 2, 3, 4]);
    expect(hesitation).toBeCloseTo(2.5 / 6.5, 10);
  });
});
