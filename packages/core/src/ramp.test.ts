import { describe, expect, it } from "vitest";
import {
  FRICTION_STOPS,
  frictionColor,
  frictionElevation,
  frictionLightness,
  frictionRing,
} from "./ramp.js";

describe("friction ramp · UI/UX §3.5 and §7.2", () => {
  it("maps 0 and 100 to the end stops exactly", () => {
    expect(frictionColor(0)).toBe(FRICTION_STOPS[0].toUpperCase());
    expect(frictionColor(100)).toBe(FRICTION_STOPS[5].toUpperCase());
  });

  it("lands on every declared stop at its own score", () => {
    for (let i = 0; i < FRICTION_STOPS.length; i++) {
      expect(frictionColor(i * 20)).toBe(FRICTION_STOPS[i].toUpperCase());
    }
  });

  // §3.5 claims "Lightness rises monotonically" across the whole ramp. It does
  // not, and this test asserts what the declared hex values actually do rather
  // than what the prose says. Measured OKLab L at the six stops:
  //
  //   0 → 0.2710   20 → 0.3866   40 → 0.5282
  //   60 → 0.7016  80 → 0.7780  100 → 0.7266
  //
  // `--f-80` (#D8B06A, sand) is LIGHTER than `--f-100` (#FF7A45, the marker).
  // The stops are normative (CLAUDE.md §7) and #FF7A45 is also `--marker`, so
  // the values are kept exactly as written and the shortfall is recorded here
  // instead of being smoothed away. See the greyscale test below for what it
  // costs.
  it("rises monotonically in lightness from 0 to 80", () => {
    let previous = -Infinity;
    for (let score = 0; score <= 80; score += 1) {
      const l = frictionLightness(score);
      expect(l).toBeGreaterThan(previous);
      previous = l;
    }
  });

  it("descends over the last band — a known property of the declared stops", () => {
    // Pinned deliberately. If someone later corrects the brief and the stop
    // values change, this fails and forces the decision to be made explicitly
    // rather than discovered on a projector.
    expect(frictionLightness(100)).toBeLessThan(frictionLightness(80));
  });

  // The consequence, stated as a test rather than left implicit: in pure
  // greyscale a high-but-not-maximal score is indistinguishable from 100.
  // This is precisely why §3.5 mandates redundant encoding — ring count and
  // the printed numeral carry friction when the colour cannot.
  it("has a greyscale collision that redundant encoding must cover", () => {
    // Exact, no tolerance: L(100) is bracketed by lightnesses the ramp already
    // passed through below 90, so some earlier score renders at the same grey.
    const atFull = frictionLightness(100);
    const earlier = Array.from({ length: 90 }, (_, s) => frictionLightness(s));
    expect(Math.min(...earlier)).toBeLessThan(atFull);
    expect(Math.max(...earlier)).toBeGreaterThan(atFull);

    // ...and the redundant encoding does separate them: the closest collision
    // draws a different number of contour rings.
    const closest = earlier.reduce(
      (best, l, s) => (Math.abs(l - atFull) < Math.abs(earlier[best] - atFull) ? s : best),
      0,
    );
    expect(frictionRing(closest)).not.toBe(frictionRing(100));
  });

  it("clamps out-of-range and non-finite scores instead of throwing", () => {
    expect(frictionColor(-40)).toBe(FRICTION_STOPS[0].toUpperCase());
    expect(frictionColor(400)).toBe(FRICTION_STOPS[5].toUpperCase());
    expect(frictionColor(Number.NaN)).toBe(FRICTION_STOPS[0].toUpperCase());
    expect(frictionRing(Number.NaN)).toBe(0);
    expect(frictionElevation(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("always returns a parseable 7-character hex", () => {
    for (let score = 0; score <= 100; score += 0.5) {
      expect(frictionColor(score)).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("counts rings as floor(score / 20), 0 to 5", () => {
    expect(frictionRing(0)).toBe(0);
    expect(frictionRing(19.9)).toBe(0);
    expect(frictionRing(20)).toBe(1);
    expect(frictionRing(79)).toBe(3);
    expect(frictionRing(80)).toBe(4);
    expect(frictionRing(100)).toBe(5);
  });

  it("elevates as score/100 x 6 world units", () => {
    expect(frictionElevation(0)).toBe(0);
    expect(frictionElevation(50)).toBe(3);
    expect(frictionElevation(100)).toBe(6);
  });

  // The midtone the brief warns about: sRGB interpolation between the shoal
  // stops goes grey through the middle. OKLab must not.
  it("keeps the 50-60 midtones off the grey axis", () => {
    for (const score of [50, 55, 60]) {
      const hex = frictionColor(score);
      const r = Number.parseInt(hex.slice(1, 3), 16);
      const g = Number.parseInt(hex.slice(3, 5), 16);
      const b = Number.parseInt(hex.slice(5, 7), 16);
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(8);
    }
  });
});
