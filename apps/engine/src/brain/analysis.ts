import type { AppState, FindingSignature, StateGraph, StateMetrics } from "@dry-run/core";
import { jargonLoad } from "./chorus.js";
import { prisma } from "../db.js";
import { emitRunEvent } from "../sse.js";

// PRD §8.4 / Backend Schema §5 — cluster raw per-state Chorus metrics into
// named, human-readable findings. Zero LLM calls, deterministic thresholds —
// the same "reasonable defaults, not fitted ones" honesty as Chorus's own
// WEIGHTS (TRD §5.6): these numbers aren't calibrated against real outcomes,
// there's no calibration subsystem for Analysis yet either.
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
};

// Only 7 of the 8 FindingSignature values are reachable here on purpose.
// "slow-response" needs real response-latency instrumentation, which nothing
// in this codebase collects yet — mapping it to some other proxy would be a
// fabricated label, so it's simply never produced until that data exists.
function classify(state: AppState, metrics: StateMetrics): Classification | null {
  if (metrics.frictionScore < FRICTION_THRESHOLD) return null;

  const signals = (state.staticSignals ?? {}) as Record<string, unknown>;
  const belowFold = signals.belowFoldPrimaryCta === true;
  const lowContrast = signals.primaryCtaLowContrast === true;

  if (belowFold) {
    return {
      signature: "offscreen-control",
      title: "Primary action is below the fold",
      explanation: `The main control on this screen isn't visible without scrolling. Friction score ${Math.round(metrics.frictionScore)}/100.`,
    };
  }

  if (lowContrast) {
    return {
      signature: "hidden-cta",
      title: "Primary action is hard to see",
      explanation: `The primary control on this screen has low colour contrast against its background, making it easy to overlook. Friction score ${Math.round(metrics.frictionScore)}/100.`,
    };
  }

  if (metrics.deadClick >= DEAD_CLICK_HIGH) {
    return {
      signature: "silent-validation",
      title: "Clicks that go nowhere",
      explanation: `${Math.round(metrics.deadClick * 100)}% of interactions on this screen led nowhere — consistent with a control that looks actionable but silently fails.`,
    };
  }

  const jargon = jargonLoad(state);
  if (jargon >= JARGON_HIGH) {
    return {
      signature: "jargon-gate",
      title: "Unfamiliar terminology ahead",
      explanation: `${Math.round(jargon * 100)}% of the labels on this screen use technical terms unfamiliar to less domain-literate personas.`,
    };
  }

  if (metrics.loop >= LOOP_HIGH) {
    return {
      signature: "excessive-choice",
      title: "Personas circle this screen",
      explanation: `Personas revisited this screen repeatedly rather than moving forward — consistent with too many competing options.`,
    };
  }

  if (metrics.backtrack >= BACKTRACK_HIGH) {
    return {
      signature: "ambiguous-cta",
      title: "Unclear which control moves forward",
      explanation: `Personas frequently backtracked away from this screen, suggesting the forward path wasn't obvious.`,
    };
  }

  if (metrics.blocked >= BLOCKED_HIGH) {
    return {
      signature: "dead-end",
      title: "Journeys stall here",
      explanation: `A meaningful share of personas got stuck on this screen without reaching a natural next step.`,
    };
  }

  return null; // high friction but no specific heuristic matched — a real gap, not papered over
}

export async function runAnalysis(runId: string): Promise<{ findingCount: number }> {
  // Every failure path below — missing run, missing prerequisite data, a
  // thrown error mid-classification — lands here rather than propagating to
  // the caller, matching runCrawl's contract (cartographer.ts): server.ts
  // calls this fire-and-forget (`void runAnalysis(...)`), so an uncaught
  // throw here would be an unhandled rejection, not a request-visible error.
  try {
    const run = await prisma.run.findUnique({ where: { id: runId } });
    if (!run) throw new Error(`run not found: ${runId}`);
    if (!run.graph) throw new Error(`run ${runId} has no graph yet`);
    if (!run.metrics) throw new Error(`run ${runId} has no chorus metrics yet`);

    emitRunEvent(runId, { t: "stage", stage: "analysis", pct: 0 });
    await prisma.run.update({ where: { id: runId }, data: { stage: "analysis" } });

    const graph: StateGraph = JSON.parse(run.graph);
    const metricsByState: Record<string, StateMetrics> = JSON.parse(run.metrics);

    const findings = Object.values(graph.nodes)
      .map((state) => {
        const metrics = metricsByState[state.id];
        if (!metrics) return null;
        const classification = classify(state, metrics);
        if (!classification) return null;
        return { state, metrics, classification };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null)
      // Same ordering the tour generator already sorts by (fixValue desc) —
      // gives Finding.rank a stable, meaningful display order.
      .sort((a, b) => b.metrics.fixValue - a.metrics.fixValue);

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
      provenance: metrics.provenance,
      rank: index,
      groundedTraceIds: JSON.stringify([]), // no ScoutTrace cross-referencing yet
      affectedSegments: JSON.stringify([]), // needs a per-archetype breakdown Chorus doesn't expose yet
      evidence: JSON.stringify({ screenshots: [state.screenshotPath], quotes: [] }),
    }));

    // Backend Schema §5 — "End of analysis: createMany(findings) + Run
    // counters, 1 transaction." App Flow §3's state machine has ANALYSING
    // transition straight to DONE — `stage` still moves to "tour" (the
    // stage rail's finer-grained checkpoint for "ready for human review"),
    // but `status` reaching DONE here, not later, is what the diagram means:
    // the automated pipeline has nothing left to run on its own.
    await prisma.$transaction(async (tx) => {
      if (findingsData.length > 0) {
        await tx.finding.createMany({ data: findingsData });
      }
      await tx.run.update({
        where: { id: runId },
        data: { stage: "tour", status: "DONE", findingCount: findingsData.length },
      });
    });

    emitRunEvent(runId, { t: "stage", stage: "tour", pct: 0, status: "DONE" });

    return { findingCount: findingsData.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.run.update({
      where: { id: runId },
      data: { status: "FAILED", error: message },
    });
    emitRunEvent(runId, { t: "error", message, fatal: true });
    return { findingCount: 0 };
  }
}
