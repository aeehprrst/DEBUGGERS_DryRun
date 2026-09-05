import { describe, expect, it } from "vitest";
import {
  ARCHETYPE_WEIGHT_TOTAL,
  BASELINE_ARCHETYPE,
  PERSONA_ARCHETYPES,
  archetypeById,
} from "./archetypes.js";
import { PersonaTraitVectorSchema } from "./types.js";

describe("PS-02 · the ten declared archetypes", () => {
  it("has exactly ten", () => {
    expect(PERSONA_ARCHETYPES).toHaveLength(10);
  });

  it("weights sum to 1.00 as PRD §8.2 specifies", () => {
    expect(ARCHETYPE_WEIGHT_TOTAL).toBeCloseTo(1, 10);
  });

  it("every archetype satisfies the PS-01 schema", () => {
    for (const p of PERSONA_ARCHETYPES) {
      expect(() => PersonaTraitVectorSchema.parse(p)).not.toThrow();
    }
  });

  it("archetype ids are unique", () => {
    const ids = PERSONA_ARCHETYPES.map((p) => p.archetype);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries the baseline the ExclusionDelta is measured against", () => {
    expect(archetypeById(BASELINE_ARCHETYPE)).toBeDefined();
  });

  // L3 — the population is deliberately exclusion-weighted. If someone
  // rebalances it toward a conversion mix, this fails loudly rather than
  // quietly turning the SDG claim into marketing.
  it("weights the excluded majority over the fully-capable baseline", () => {
    const baseline = archetypeById(BASELINE_ARCHETYPE)!.weight;
    const excluded = PERSONA_ARCHETYPES.filter(
      (p) =>
        p.device === "mobile-390" ||
        p.inputMode !== "pointer" ||
        p.locale === "non-native" ||
        p.domainLiteracy < 0.5 ||
        p.patience.maxSteps <= 7,
    ).reduce((sum, p) => sum + p.weight, 0);
    expect(excluded).toBeGreaterThan(0.5);
    expect(baseline).toBeLessThan(0.15);
  });

  // TRD §5.4 needs a population that actually exercises each mechanical rule;
  // an archetype set with no mobile or no screen-reader persona would make
  // those code paths permanently dead.
  it("exercises every device and input mode the walk branches on", () => {
    const devices = new Set(PERSONA_ARCHETYPES.map((p) => p.device));
    const inputModes = new Set(PERSONA_ARCHETYPES.map((p) => p.inputMode));
    const locales = new Set(PERSONA_ARCHETYPES.map((p) => p.locale));
    expect(devices).toContain("mobile-390");
    expect(inputModes).toContain("screen-reader");
    expect(inputModes).toContain("keyboard-only");
    expect(locales).toContain("non-native");
  });
});
