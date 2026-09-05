import { PERSONA_ARCHETYPES } from "@dry-run/core";
import type { AllowActions, PersonaTraitVector, SeededValues } from "@dry-run/core";

// PL-06 — the run-config defaults, extracted from server.ts so the evaluation
// harness runs the *same* population the product runs. A second copy in the
// harness would mean the score measured a population no operator ever sees,
// which is the same class of bug as two friction ramps (CLAUDE.md §6.3).
// Importing server.ts is not an option: it calls app.listen() at module scope.

// CR-07 — Meridian's /connect rejects any API key that doesn't start with
// "mk_" (PRD §9.1), which is what stops the crawl short of /invite, /webhook
// and /dashboard. A real operator types their own seeded values on Setup; this
// is the bundled demo target's default so the demo run needs no request body.
// Scoped to Meridian's dev origin so it can never leak onto a third-party
// target — there it would just be a wrong value typed into someone's form.
export const MERIDIAN_ORIGIN = "http://localhost:5173";
export const MERIDIAN_SEEDED_VALUES: SeededValues = { "API key": "mk_demo123" };

export function defaultSeededValuesFor(targetUrl: string): SeededValues {
  try {
    return new URL(targetUrl).origin === MERIDIAN_ORIGIN
      ? MERIDIAN_SEEDED_VALUES
      : {};
  } catch {
    return {};
  }
}

// TRD S4 — the demo target's standing exception, scoped to Meridian's dev
// origin exactly as the seeded values are, so it can never authorise clicking
// a blocked control on a third-party app. Every other target starts with no
// exceptions and must name them explicitly on the request.
//
// Note this is belt-and-braces rather than load-bearing today: the amended S4
// blocklist no longer matches bare "send", so "Send invite" is permitted
// outright and Meridian maps fully with an empty allowlist (verified). It
// keeps the funnel reachable if `send` is ever restored to the blocklist.
export const MERIDIAN_ALLOW_ACTIONS: AllowActions = ["Send invite"];

export function defaultAllowActionsFor(targetUrl: string): AllowActions {
  try {
    return new URL(targetUrl).origin === MERIDIAN_ORIGIN
      ? MERIDIAN_ALLOW_ACTIONS
      : [];
  } catch {
    return [];
  }
}


// PS-03 is unbuilt (population size is not yet operator-configurable), so the
// orchestrator needs a declared default rather than a literal buried in a
// route handler.
export const DEFAULT_POPULATION_SIZE = 1000;

// PS-02 — the ten declared archetypes, exclusion-weighted per L3. They live in
// packages/core because the population is a contract, not an engine detail: the
// Setup screen will show it, the ExclusionDelta is computed against its
// baseline, and a second copy here would let the product simulate a population
// nobody could read off the spec.
//
// No per-run persona configuration exists yet (PS-03), so the orchestrator uses
// the full declared mix.
export const DEFAULT_PERSONA_MIX: PersonaTraitVector[] = [...PERSONA_ARCHETYPES];
