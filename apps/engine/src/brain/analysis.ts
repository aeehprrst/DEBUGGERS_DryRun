import type {
  AppState,
  FindingSignature,
  Provenance,
  StateGraph,
  StateMetrics,
} from "@dry-run/core";
import { jargonLoad } from "./chorus.js";
import { prisma } from "../db.js";

// PRD §8.4 / Backend Schema §5 — cluster raw per-state Chorus metrics into
// named, human-readable findings. Zero LLM calls, deterministic thresholds —
// the same "reasonable defaults, not fitted ones" honesty as Chorus's own
// WEIGHTS (TRD §5.6): these numbers aren't calibrated against real outcomes,
// there's no calibration subsystem for Analysis yet either.
//
// FRICTION_THRESHOLD is a **declared constant, not a fitted one** (PRD §6.2 —
// the friction weights "are declared constants and are surfaced in the UI").
// Nothing has been tuned against Meridian's planted defects: if the Modeled
// pass emits nothing, that is the honest result, and the Observed pass carries
// the findings on its own. Fitting this number is what a calibration subsystem
// would do, and calibration is cut (CLAUDE.md §5).
//
// It gates the Modeled pass ONLY. Applying it to Observed findings inverted
// L6's provenance order — a browser measurement suppressed by a simulated
// score — which is the bug this two-pass split exists to fix.
const FRICTION_THRESHOLD = 40;
const DEAD_CLICK_HIGH = 0.25;
const JARGON_HIGH = 0.25;
const LOOP_HIGH = 0.25;
const BACKTRACK_HIGH = 0.25;
const BLOCKED_HIGH = 0.2;

type Classification = {
  signature: FindingSignature;
  title: string;
  explanation: string;
  // Set per finding, not copied from StateMetrics.provenance — Chorus
  // hardcodes "modeled" for every state (CH-05 is unbuilt), so taking it from
  // there would relabel a browser measurement as a simulation output.
  provenance: Provenance;
};

type StaticSignals = {
  interactiveCount?: number;
  belowFoldPrimaryCta?: boolean;
  offscreenControls?: string[];
  primaryCtaContrastRatio?: number | null;
  primaryCtaLowContrast?: boolean;
  // CR-12, added with the four missing signals.
  competingCtas?: boolean;
  competingCtaNames?: string[];
  jargonScore?: number;
  errorTextContrast?: number | null;
  errorTextLowContrast?: boolean;
  errorTextInA11yTree?: boolean | null;
  hasAriaLive?: boolean;
  deadEndControl?: boolean;
  deadEndControlNames?: string[];
};

// PRD §6.5, `jargon-gate`: "jargonScore > 0.4". Declared by the PRD, not
// fitted here — see the FRICTION_THRESHOLD note above.
const JARGON_SCORE_HIGH = 0.4;

// Only 7 of the 8 FindingSignature values are reachable here on purpose.
// "slow-response" needs real response-latency instrumentation, which nothing
// in this codebase collects yet — mapping it to some other proxy would be a
// fabricated label, so it's simply never produced until that data exists.

// ---------------------------------------------------------------------------
// PASS 1 — Observed. CLAUDE.md L6: "Observed — a fact the crawler verified in a
// real browser." These branches read only static signals the browser measured
// and are deliberately NOT gated on frictionScore: a control that is literally
// below the bottom of the viewport is a defect whether or not the simulated
// population happened to trip over it. Ranking still comes from the simulation
// via Fix Value, so a low-friction Observed finding ranks low — it is not
// suppressed, and that distinction is the whole of L6.
//
// PRD §6.5 pairs each of these rules with a modeled conjunct
// (`belowFoldPrimaryCta ∧ hesitation > 0.5`, `offscreenInteractives ∧ mobile
// dropout ≫ desktop dropout`, `interactiveCount > 12 ∧ hesitation > 0.6`). The
// conjunct is dropped here on purpose: requiring it would re-introduce exactly
// the Modeled-gates-Observed inversion this split exists to remove, so the
// modeled half governs ranking rather than admission.
// ---------------------------------------------------------------------------
const CROWDED_INTERACTIVE_COUNT = 12; // PRD §6.5, `excessive-choice`

function classifyObserved(state: AppState): Classification[] {
  const signals = (state.staticSignals ?? {}) as StaticSignals;
  const found: Classification[] = [];

  // PRD §6.5 row 1: `hidden-cta` ← belowFoldPrimaryCta. The imported code sent
  // this to `offscreen-control`, which PRD §6.5 names as one of three wrong
  // mappings (AN-05) and which also stole D5's signature.
  //
  // A primary CTA below 4.5:1 lands here too: PRD §6.5's table has no signature
  // of its own for it, and "the primary action cannot be seen" is the same
  // finding whether the cause is position or contrast. The explanation always
  // names which measurement fired, so the two never blur together in the UI.
  const belowFold = signals.belowFoldPrimaryCta === true;
  const lowContrast = signals.primaryCtaLowContrast === true;
  if (belowFold || lowContrast) {
    found.push({
      signature: "hidden-cta",
      title: belowFold
        ? "Primary action is below the fold"
        : "Primary action is hard to see",
      explanation: belowFold
        ? `The primary control is positioned below the fold, so it is not visible without scrolling and the layout gives no scroll cue. Measured in the browser at ${state.url}.`
        : `The primary control's contrast against its background measured ${signals.primaryCtaContrastRatio}:1, below the 4.5:1 WCAG AA minimum. Measured in the browser at ${state.url}.`,
      provenance: "observed",
    });
  }

  // PRD §6.5 row 5: `offscreen-control` ← offscreenInteractives.length > 0.
  // The mobile-vs-desktop dropout comparison the rule also asks for needs
  // CR-09's second viewport pass, which does not exist yet — so this fires only
  // on controls already offscreen at 1280, and D5's 390px-only breakage stays
  // invisible. Named here rather than approximated with a proxy.
  const offscreen = signals.offscreenControls ?? [];
  if (offscreen.length > 0) {
    found.push({
      signature: "offscreen-control",
      title: "A control is positioned offscreen",
      explanation: `${offscreen.length} interactive control(s) measured outside the viewport: ${offscreen.join(", ")}.`,
      provenance: "observed",
    });
  }

  // PRD §6.5 row 7: `excessive-choice` ← interactiveCount > 12.
  const interactiveCount = signals.interactiveCount ?? 0;
  if (interactiveCount > CROWDED_INTERACTIVE_COUNT) {
    found.push({
      signature: "excessive-choice",
      title: "Too many competing controls",
      explanation: `${interactiveCount} interactive elements were counted on this screen, above the ${CROWDED_INTERACTIVE_COUNT} at which choice costs more than it offers.`,
      provenance: "observed",
    });
  }

  // PRD §6.5 row 2: `ambiguous-cta` ← competingCtas. The rule's second conjunct
  // is `deadClick > 0.25`; dropped here for the same reason as the others —
  // two identically-styled primary actions are ambiguous by construction,
  // whether or not the population happened to misclick on this run. (D2)
  if (signals.competingCtas === true) {
    const names = signals.competingCtaNames ?? [];
    found.push({
      signature: "ambiguous-cta",
      title: "Two controls compete to be the primary action",
      explanation: `${names.map((n) => `"${n}"`).join(" and ")} are rendered with identical styling inside the same landmark, so neither reads as the way forward. Measured from computed style in the browser.`,
      provenance: "observed",
    });
  }

  // PRD §6.5 row 6: `jargon-gate` ← jargonScore > 0.4. The rule's second
  // conjunct correlates dropout against `domainLiteracy`, which needs CH-04's
  // per-segment metrics — unbuilt, so the Observed half stands alone. (D6)
  const jargonScore = signals.jargonScore ?? 0;
  if (jargonScore > JARGON_SCORE_HIGH) {
    found.push({
      signature: "jargon-gate",
      title: "Unexplained technical terms gate this screen",
      explanation: `${Math.round(jargonScore * 100)}% of the accessible names on this screen contain technical vocabulary from the declared jargon list, above the ${Math.round(JARGON_SCORE_HIGH * 100)}% threshold.`,
      provenance: "observed",
    });
  }

  // PRD §6.5 row 3: `silent-validation` ← lowContrastText ∧ ¬hasAriaLive.
  // Two independent ways to be silent, and the second is the more damning:
  // error text absent from the accessibility tree does not exist at all for a
  // screen-reader persona — it is unannounced, not merely hard to read. (D3)
  const errorMissingFromTree = signals.errorTextInA11yTree === false;
  const errorUnannounced = signals.errorTextContrast !== null && signals.hasAriaLive === false;
  if (errorMissingFromTree || signals.errorTextLowContrast === true) {
    const parts: string[] = [];
    if (errorMissingFromTree) {
      parts.push(
        "the error text never enters the accessibility tree, so a screen-reader persona is never told the submission failed",
      );
    }
    if (signals.errorTextLowContrast === true) {
      parts.push(
        `its contrast measures ${signals.errorTextContrast}:1, below the 4.5:1 WCAG AA minimum`,
      );
    }
    if (errorUnannounced) parts.push("and no aria-live region announces it");
    found.push({
      signature: "silent-validation",
      title: "Validation fails without telling the user",
      explanation: `This screen rejects input, but ${parts.join(", ")}.`,
      provenance: "observed",
    });
  }

  // PRD §6.5 row 4: `dead-end` ← no viable out-edge toward the goal. Measured
  // structurally: a control that was clicked and left the state unchanged
  // (CR-04 fingerprint identical), which is a self-loop in the graph. (D4)
  if (signals.deadEndControl === true) {
    const names = signals.deadEndControlNames ?? [];
    found.push({
      signature: "dead-end",
      title: "A control on this screen does nothing",
      explanation: `Activating ${names.map((n) => `"${n}"`).join(", ")} left the screen in an identical state — same URL, same heading, same controls. The affordance is there; the behaviour is not.`,
      provenance: "observed",
    });
  }

  return found;
}

// ---------------------------------------------------------------------------
// PASS 2 — Modeled. Behaviour-driven signatures, still gated on
// FRICTION_THRESHOLD: unlike a browser measurement these describe what the
// simulated population did, so a state the population barely struggled on has
// nothing to report. First match wins, as before.
//
// AN-05 mapping, now corrected: dead-click used to emit `silent-validation`,
// the third of the three crossings PRD §6.5 flags. By that table dead-click is
// the modeled half of `ambiguous-cta` (`competingCtas ∧ deadClick > 0.25`),
// and `silent-validation` belongs to error text — which CR-12 now measures, so
// it is an Observed signature in Pass 1 and no longer produced here at all.
// ---------------------------------------------------------------------------
function classifyModeled(
  state: AppState,
  metrics: StateMetrics,
): Classification | null {
  if (metrics.frictionScore < FRICTION_THRESHOLD) return null;

  if (metrics.deadClick >= DEAD_CLICK_HIGH) {
    return {
      signature: "ambiguous-cta",
      title: "Clicks that go nowhere",
      explanation: `${Math.round(metrics.deadClick * 100)}% of interactions on this screen led nowhere — consistent with a control that looks actionable but silently fails.`,
      provenance: "modeled",
    };
  }

  const jargon = jargonLoad(state);
  if (jargon >= JARGON_HIGH) {
    return {
      signature: "jargon-gate",
      title: "Unfamiliar terminology ahead",
      explanation: `${Math.round(jargon * 100)}% of the labels on this screen use technical terms unfamiliar to less domain-literate personas.`,
      provenance: "modeled",
    };
  }

  if (metrics.loop >= LOOP_HIGH) {
    return {
      signature: "excessive-choice",
      title: "Personas circle this screen",
      explanation: `Personas revisited this screen repeatedly rather than moving forward — consistent with too many competing options.`,
      provenance: "modeled",
    };
  }

  if (metrics.backtrack >= BACKTRACK_HIGH) {
    return {
      signature: "ambiguous-cta",
      title: "Unclear which control moves forward",
      explanation: `Personas frequently backtracked away from this screen, suggesting the forward path wasn't obvious.`,
      provenance: "modeled",
    };
  }

  if (metrics.blocked >= BLOCKED_HIGH) {
    return {
      signature: "dead-end",
      title: "Journeys stall here",
      explanation: `A meaningful share of personas got stuck on this screen without reaching a natural next step.`,
      provenance: "modeled",
    };
  }

  return null; // high friction but no specific heuristic matched — a real gap, not papered over
}

/**
 * Both passes for one state, deduped by signature with Observed winning: the
 * same defect described once by a browser measurement and once by the
 * simulation is one finding, and L6 says the browser's account is the one to
 * keep. A state can carry more than one finding when the signatures differ.
 */
function classifyState(state: AppState, metrics: StateMetrics): Classification[] {
  const observed = classifyObserved(state);
  const modeled = classifyModeled(state, metrics);
  if (!modeled) return observed;
  if (observed.some((o) => o.signature === modeled.signature)) return observed;
  return [...observed, modeled];
}

/**
 * Classifies the crawl + chorus output into ranked Finding rows.
 *
 * Throws on failure and sets no run status of its own: PL-01 made the
 * orchestrator the single owner of lifecycle (TRD §4.1 rule 2), and it needs a
 * real rejection to decide DEGRADED vs DONE. The previous version swallowed
 * every error and set `status: "DONE"` itself, which meant a failed analysis
 * still reported success.
 */
export async function runAnalysis(runId: string): Promise<{ findingCount: number }> {
  const run = await prisma.run.findUnique({ where: { id: runId } });
  if (!run) throw new Error(`run not found: ${runId}`);
  if (!run.graph) throw new Error(`run ${runId} has no graph yet`);
  if (!run.metrics) throw new Error(`run ${runId} has no chorus metrics yet`);

  const graph: StateGraph = JSON.parse(run.graph);
  const metricsByState: Record<string, StateMetrics> = JSON.parse(run.metrics);

  const findings = Object.values(graph.nodes)
    .flatMap((state) => {
      const metrics = metricsByState[state.id];
      if (!metrics) return [];
      return classifyState(state, metrics).map((classification) => ({
        state,
        metrics,
        classification,
      }));
    })
    // Same ordering the tour generator already sorts by (fixValue desc) —
    // gives Finding.rank a stable, meaningful display order. An Observed
    // finding on a low-friction state therefore ranks last rather than being
    // dropped: L6 governs whether it exists, Fix Value governs where it sits.
    // Ties break toward Observed so a browser-verified fact outranks a
    // simulated one at equal value, and by state id so the order is stable.
    .sort(
      (a, b) =>
        b.metrics.fixValue - a.metrics.fixValue ||
        Number(b.classification.provenance === "observed") -
          Number(a.classification.provenance === "observed") ||
        a.state.id.localeCompare(b.state.id),
    );

  const findingsData = findings.map(({ state, metrics, classification }, index) => ({
    runId,
    stateId: state.id,
    stateName: state.title,
    signature: classification.signature,
    title: classification.title,
    explanation: classification.explanation,
    frictionScore: metrics.frictionScore,
    fixValue: metrics.fixValue,
    impact: metrics.impact,
    reach: metrics.reach,
    confidence: metrics.confidence,
    provenance: classification.provenance,
    rank: index,
    groundedTraceIds: JSON.stringify([]), // no ScoutTrace cross-referencing yet
    affectedSegments: JSON.stringify([]), // needs a per-archetype breakdown Chorus doesn't expose yet
    evidence: JSON.stringify({ screenshots: [state.screenshotPath], quotes: [] }),
  }));

  // Backend Schema §4 — "End of analysis: createMany(findings) + Run
  // counters, one transaction." Findings are re-created rather than appended
  // so a re-run cannot double them up. No status or stage write: those are
  // the orchestrator's, and this stage is not the end of the pipeline —
  // `tour` still runs after it.
  await prisma.$transaction(async (tx) => {
    await tx.finding.deleteMany({ where: { runId } });
    if (findingsData.length > 0) {
      await tx.finding.createMany({ data: findingsData });
    }
    await tx.run.update({
      where: { id: runId },
      data: { findingCount: findingsData.length },
    });
  });

  return { findingCount: findingsData.length };
}
