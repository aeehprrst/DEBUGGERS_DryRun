import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import type {
  Finding as PrismaFindingRow,
  Finding as PrismaFindingRelation,
  TourStep as PrismaTourStepRow,
} from "@prisma/client";
import { FindingSignature, Provenance, StepStatus } from "@dry-run/core";
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
  counters: { stateCount: number; actionCount: number; truncated: boolean },
) {
  await prisma.run.update({
    where: { id: runId },
    data: {
      graph: JSON.stringify(graph),
      stage: "scouts",
      stateCount: counters.stateCount,
      actionCount: counters.actionCount,
      truncated: counters.truncated,
    },
  });
}

export async function bootDatabase() {
  await prisma.$queryRaw`PRAGMA foreign_keys = ON;`;
  await prisma.$queryRaw`PRAGMA journal_mode = WAL;`;

  await prisma.run.updateMany({
    where: { status: { in: ["CRAWLING", "SCOUTING", "CHORUS"] } },
    data: { status: "FAILED", error: "Engine restarted during this run" },
  });
}
