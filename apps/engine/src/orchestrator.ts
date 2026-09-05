import type {
  AllowActions,
  PersonaTraitVector,
  RunStage,
  RunStatus,
  SeededValues,
  StateGraph,
} from "@dry-run/core";
import { runAnalysis } from "./brain/analysis.js";
import { runChorusSimulation } from "./brain/chorus.js";
import { CRAWL_BUDGET, runCrawl } from "./cartographer.js";
import { prisma, saveCrawlResult } from "./db.js";
import { emitRunEvent } from "./sse.js";
import { createTourForRun } from "./usher/persist.js";

export type RunConfig = {
  targetUrl: string;
  seededValues: SeededValues;
  allowActions: AllowActions;
  personaMix: PersonaTraitVector[];
  populationSize: number;
};

export class RunCancelledError extends Error {
  constructor() {
    super("Run cancelled by operator");
    this.name = "RunCancelledError";
  }
}

/** The stage a failure happened in, carried out of the pipeline for `degradedFor`. */
class StageError extends Error {
  constructor(
    readonly stage: RunStage,
    readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "StageError";
  }
}

// TRD §4.1 rule 3 — "Percentage is monotonic and declared, not guessed."
// These bands are the declaration; nothing may report a number outside its own
// band, and `emitStage` enforces that the sequence never goes backwards.
const STAGE_BANDS = {
  crawl: [0, 45],
  chorus: [45, 70],
  analysis: [70, 85],
  tour: [85, 100],
} as const satisfies Partial<Record<RunStage, readonly [number, number]>>;

// App Flow §3's state machine, stage → the status held while it runs.
const STAGE_STATUS: Record<keyof typeof STAGE_BANDS, RunStatus> = {
  crawl: "CRAWLING",
  chorus: "CHORUS",
  analysis: "ANALYZING",
  tour: "TOURING",
};

export class RunOrchestrator {
  private cancelled = false;
  private lastPct = -1;

  constructor(
    private readonly runId: string,
    private readonly cfg: RunConfig,
  ) {}

  /** TRD §4.1 — sets a flag every stage checks between units of work. */
  cancel(): void {
    this.cancelled = true;
  }

  private checkCancel(): void {
    if (this.cancelled) throw new RunCancelledError();
  }

  /**
   * Monotonic by construction: a stage that computes a lower number than one
   * already reported (a shrinking denominator, a retried unit) reports the
   * previous number instead of visibly rewinding the operator's progress bar.
   */
  private async emitStage(stage: RunStage, pct: number, status?: RunStatus) {
    const monotonic = Math.max(Math.round(pct), this.lastPct);
    this.lastPct = monotonic;
    emitRunEvent(this.runId, { t: "stage", stage, pct: monotonic, ...(status ? { status } : {}) });
    await prisma.run.update({
      where: { id: this.runId },
      data: { stage, progressPct: monotonic, ...(status ? { status } : {}) },
    });
  }

  private async enterStage(stage: keyof typeof STAGE_BANDS) {
    this.checkCancel();
    await this.emitStage(stage, STAGE_BANDS[stage][0], STAGE_STATUS[stage]);
  }

  private async completeStage(stage: keyof typeof STAGE_BANDS) {
    await this.emitStage(stage, STAGE_BANDS[stage][1]);
  }

  /**
   * TRD §4.1 rule 1: sequential and awaited. Stage n+1 starts only when stage n
   * resolves. Nothing here is `void`-called.
   */
  async start(): Promise<void> {
    const startedAt = Date.now();
    let graph: StateGraph;

    // ── crawl ──────────────────────────────────────────────────────────────
    // Rule 4 splits here: the crawl is the one stage whose failure is fatal,
    // because every later stage reads the graph it produces. Everything after
    // it degrades instead.
    try {
      graph = await this.runCrawlStage();
    } catch (err) {
      if (err instanceof RunCancelledError) {
        await this.finish("CANCELLED", { startedAt });
        return;
      }
      await this.finish("FAILED", {
        startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    // ── chorus → analysis → tour ───────────────────────────────────────────
    try {
      await this.runChorusStage(graph);
      await this.runAnalysisStage();
      await this.runTourStage();
    } catch (err) {
      if (err instanceof RunCancelledError) {
        await this.finish("CANCELLED", { startedAt });
        return;
      }
      // Rule 4 — "Partial failure degrades, it does not abort." The graph and
      // its Observed static signals stay intact and viewable; the UI names the
      // stage that failed and suppresses the modeled numbers rather than
      // faking them (App Flow §3).
      const stage = err instanceof StageError ? err.stage : "chorus";
      await this.finish("DEGRADED", {
        startedAt,
        error: err instanceof Error ? err.message : String(err),
        degradedFor: stage,
      });
      return;
    }

    await this.finish("DONE", { startedAt });
  }

  private async runCrawlStage(): Promise<StateGraph> {
    await this.enterStage("crawl");

    const [from, to] = STAGE_BANDS.crawl;
    const result = await runCrawl(this.runId, this.cfg.targetUrl, {
      seededValues: this.cfg.seededValues,
      allowActions: this.cfg.allowActions,
      // Rule 5 — cancellation is checked between units of work; for the crawl
      // a unit is one state.
      checkCancel: () => this.checkCancel(),
      // Rule 3 — "Within crawl, pct = 45 × statesFound / crawlBudget."
      onStateFound: (statesFound) => {
        void this.emitStage(
          "crawl",
          Math.min(to, from + (to * statesFound) / CRAWL_BUDGET),
        );
      },
    });

    // Rule 2 — persist this stage's blob at its boundary, before the next
    // stage starts (Backend Schema §4: "End of crawl: one write").
    await saveCrawlResult(this.runId, result.graph, result);

    // Rule 4 — "A crawl that reaches zero states is FAILED." Thrown rather
    // than degraded: there is nothing for Chorus to walk.
    if (result.stateCount === 0) {
      throw new Error("Crawl reached zero states");
    }

    await this.completeStage("crawl");
    return result.graph;
  }

  private async runChorusStage(graph: StateGraph): Promise<void> {
    await this.enterStage("chorus");
    try {
      // runChorusSimulation is synchronous and seeded (§6.7), so there is no
      // await point inside it to check cancellation at. Cancelling mid-chorus
      // would need the simulation loop itself to poll the flag every 100
      // personas; that is a change to Chorus internals, deliberately not made
      // here. Cancel is honoured on either side of this call.
      const result = runChorusSimulation(
        graph,
        this.cfg.personaMix,
        this.cfg.populationSize,
      );

      await prisma.run.update({
        where: { id: this.runId },
        data: {
          metrics: JSON.stringify(result.metrics),
          populationSize: result.populationSize,
        },
      });

      emitRunEvent(this.runId, {
        t: "chorus-done",
        populationSize: result.populationSize,
        completionRate: result.completionRate,
      });
    } catch (err) {
      throw new StageError("chorus", err);
    }
    await this.completeStage("chorus");
  }

  private async runAnalysisStage(): Promise<void> {
    await this.enterStage("analysis");
    try {
      const { findingCount } = await runAnalysis(this.runId);
      await prisma.run.update({
        where: { id: this.runId },
        data: { findingCount },
      });
    } catch (err) {
      throw new StageError("analysis", err);
    }
    await this.completeStage("analysis");
  }

  private async runTourStage(): Promise<void> {
    await this.enterStage("tour");
    try {
      await createTourForRun(this.runId);
    } catch (err) {
      throw new StageError("tour", err);
    }
    await this.completeStage("tour");
  }

  private async finish(
    status: RunStatus,
    opts: { startedAt: number; error?: string; degradedFor?: string },
  ) {
    await prisma.run.update({
      where: { id: this.runId },
      data: {
        status,
        stage: "done",
        progressPct: status === "DONE" || status === "DEGRADED" ? 100 : this.lastPct,
        error: opts.error ?? null,
        degradedFor: opts.degradedFor ?? null,
        finishedAt: new Date(),
        durationMs: Date.now() - opts.startedAt,
      },
    });

    if (opts.error) {
      emitRunEvent(this.runId, {
        t: "error",
        message: opts.error,
        // Not fatal when the graph survived: DEGRADED is a designed state
        // (App Flow §3), and the Atlas still has something real to render.
        fatal: status === "FAILED",
      });
    }

    this.lastPct = Math.max(this.lastPct, status === "DONE" || status === "DEGRADED" ? 100 : 0);
    emitRunEvent(this.runId, { t: "stage", stage: "done", pct: this.lastPct, status });
  }
}

// Cancellation needs a handle on the live instance, and the pipeline
// deliberately outlives the HTTP request that started it (TRD §4.2 — "return
// { runId } immediately, never block the HTTP response"). Process-local by
// design: a restart clears it, and the orphan sweep is what covers those runs.
const active = new Map<string, RunOrchestrator>();

export function startRun(runId: string, cfg: RunConfig): RunOrchestrator {
  const orchestrator = new RunOrchestrator(runId, cfg);
  active.set(runId, orchestrator);

  // Not awaited — this is the one intentional detachment, and it is the
  // pipeline's *entry*, not a stage boundary. Everything inside start() is
  // sequential and awaited. `.catch` guarantees a stage bug surfaces as a
  // FAILED run rather than an unhandled rejection that kills the process.
  void orchestrator
    .start()
    .catch(async (err) => {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.run
        .update({
          where: { id: runId },
          data: { status: "FAILED", stage: "done", error: message, finishedAt: new Date() },
        })
        .catch(() => {});
      emitRunEvent(runId, { t: "error", message, fatal: true });
    })
    .finally(() => {
      active.delete(runId);
    });

  return orchestrator;
}

export function cancelRun(runId: string): boolean {
  const orchestrator = active.get(runId);
  if (!orchestrator) return false;
  orchestrator.cancel();
  return true;
}
