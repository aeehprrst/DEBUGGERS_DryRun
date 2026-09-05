import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import type {
  Finding as PrismaFindingRow,
  Finding as PrismaFindingRelation,
  TourStep as PrismaTourStepRow,
} from "@prisma/client";
import {
  FindingSignature,
  NON_TERMINAL_RUN_STATUSES,
  Provenance,
  StepStatus,
} from "@dry-run/core";
import type {
  Finding as CoreFinding,
  SemanticAnchor,
  StateGraph,
  TourStep as CoreTourStep,
} from "@dry-run/core";

export const prisma = new PrismaClient();

// Finding is normalised into its own table (Backend Schema §"Findings"), but
// with more operational columns (rank, impact, reach, confidence,
// groundedTraceIds...) than @dry-run/core's Finding — the domain shape used
// by the tour generator. This is the one place that gap is bridged.
export function toCoreFinding(row: PrismaFindingRow): CoreFinding {
  const evidence = JSON.parse(row.evidence) as {
    screenshots?: string[];
    quotes?: string[];
  };

  return {
    id: row.id,
    runId: row.runId,
    stateId: row.stateId,
    signature: FindingSignature.parse(row.signature),
    title: row.title,
    explanation: row.explanation,
    frictionScore: row.frictionScore,
    fixValue: row.fixValue,
    provenance: Provenance.parse(row.provenance),
    evidenceBundle: {
      screenshotPath: evidence.screenshots?.[0] ?? "",
      thinkAloud: evidence.quotes ?? [],
    },
  };
}

// TourStep is normalised (Backend Schema §"TOURS" — steps are PATCHed
// individually, so they must be rows), but `anchor`/`advanceOn` are TEXT
// columns holding JSON, and `stateId` isn't a column at all — it only exists
// via the sourceFindingId → Finding relation. This is the one place that
// gap is bridged back into @dry-run/core's TourStep shape.
export function toCoreTourStep(
  row: PrismaTourStepRow & { finding: PrismaFindingRelation | null },
): CoreTourStep {
  return {
    id: row.id,
    order: row.order,
    stateId: row.finding?.stateId ?? "",
    anchor: JSON.parse(row.anchor) as SemanticAnchor,
    title: row.title,
    body: row.body,
    placement: row.placement,
    status: StepStatus.parse(row.status),
  };
}

// StateGraph has no relational home (Backend Schema §"results") — it's a
// String column holding JSON, never a native Json column, since SQLite/Prisma
// has none. This is the one place that serialization contract is enforced.
export async function saveCrawlResult(
  runId: string,
  graph: StateGraph,
  counters: {
    stateCount: number;
    actionCount: number;
    truncated: boolean;
    // CR-13 / L5 — the crawl already knew it had replayed a fixture and threw
    // the fact away here. Recorded at the crawl boundary, which is the only
    // moment anything knows it, so the replay-mode banner has something to
    // disclose on every later view of the run.
    replayedFrom?: { fixtureId: string };
  },
) {
  // No `stage` write here. Scouts are cut (CLAUDE.md §5), so the old
  // `stage: "scouts"` set every run to a stage that no longer exists in the
  // RunStage enum and stranded it there forever. The orchestrator owns stage
  // transitions now (TRD §4.1 rule 2).
  await prisma.run.update({
    where: { id: runId },
    data: {
      graph: JSON.stringify(graph),
      stateCount: counters.stateCount,
      actionCount: counters.actionCount,
      truncated: counters.truncated,
      // null, not undefined: a re-run of a run that previously replayed must
      // clear the flag rather than inherit it.
      replayFixtureId: counters.replayedFrom?.fixtureId ?? null,
    },
  });
}

export async function bootDatabase() {
  // Backend Schema §5 — all four are required before the first query. The
  // imported code set only the first two; `busy_timeout` in particular matters
  // now that the orchestrator writes at every stage boundary while SSE
  // subscribers read concurrently, which is exactly when SQLITE_BUSY appears.
  await prisma.$queryRaw`PRAGMA foreign_keys = ON;`;
  await prisma.$queryRaw`PRAGMA journal_mode = WAL;`;
  await prisma.$queryRaw`PRAGMA synchronous = NORMAL;`;
  await prisma.$queryRaw`PRAGMA busy_timeout = 5000;`;

  // Backend Schema §5 orphan sweep. The imported version listed only
  // CRAWLING | SCOUTING | CHORUS, so a run killed during analysis or tour
  // stayed non-terminal forever and the UI waited on it indefinitely. The list
  // is derived from the RunStatus enum rather than written out here, so a new
  // status cannot be added without being classified terminal or not.
  const orphaned = await prisma.run.updateMany({
    where: { status: { in: [...NON_TERMINAL_RUN_STATUSES] } },
    data: {
      status: "FAILED",
      stage: "done",
      error: "Engine restarted during this run",
      finishedAt: new Date(),
    },
  });

  return { orphanedRuns: orphaned.count };
}
