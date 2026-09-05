import type { StateGraph } from "@dry-run/core";
import { prisma, toCoreFinding, toCoreTourStep } from "../db.js";
import { generateTourFromFindings } from "./generator.js";

export type PersistedTour = Awaited<ReturnType<typeof loadLatestTour>>;

function loadLatestTour(runId: string) {
  return prisma.tour.findFirst({
    where: { runId },
    orderBy: { version: "desc" },
    include: { steps: { include: { finding: true }, orderBy: { order: "asc" } } },
  });
}

/**
 * Backend Schema §4 — "Tour generation: `Tour` + `createMany(TourStep)`, one
 * transaction." Shared by the orchestrator's tour stage and `POST
 * /runs/:id/tour` so both produce byte-identical rows; before PL-01 only the
 * endpoint could create a tour, which is why a run never reached one on its own.
 *
 * Idempotent: TourStep rows carry human approval decisions, so an existing tour
 * is returned untouched rather than regenerated over the top of them.
 */
export async function createTourForRun(runId: string) {
  const existing = await loadLatestTour(runId);
  if (existing) return existing;

  const run = await prisma.run.findUnique({ where: { id: runId } });
  if (!run) throw new Error(`run not found: ${runId}`);
  if (!run.graph) throw new Error(`run ${runId} has no graph yet`);

  const graph: StateGraph = JSON.parse(run.graph);
  const findings = (await prisma.finding.findMany({ where: { runId } })).map(
    toCoreFinding,
  );

  const steps = generateTourFromFindings(runId, findings, graph);

  // generateTourFromFindings can skip a top finding it couldn't anchor, so
  // `steps` is an order-preserving subsequence of this same sort — walk both
  // with one cursor to recover which finding produced each surviving step.
  const topFindings = [...findings]
    .sort((a, b) => b.fixValue - a.fixValue)
    .slice(0, 3);
  let findingCursor = 0;
  const stepsWithSourceFinding = steps.map((step) => {
    while (
      findingCursor < topFindings.length &&
      topFindings[findingCursor].stateId !== step.stateId
    ) {
      findingCursor += 1;
    }
    const sourceFindingId = topFindings[findingCursor]?.id ?? null;
    findingCursor += 1;
    return { ...step, sourceFindingId };
  });

  return prisma.$transaction(async (tx) => {
    const createdTour = await tx.tour.create({
      data: {
        runId: run.id,
        projectId: run.projectId,
        name: `Tour for ${run.label ?? run.targetUrl}`,
        status: "DRAFT",
      },
    });

    for (const step of stepsWithSourceFinding) {
      await tx.tourStep.create({
        data: {
          tourId: createdTour.id,
          order: step.order,
          sourceFindingId: step.sourceFindingId,
          anchor: JSON.stringify(step.anchor),
          title: step.title,
          body: step.body,
          placement: step.placement,
          advanceOn: JSON.stringify({ type: "click" }),
          status: step.status,
        },
      });
    }

    return tx.tour.findUniqueOrThrow({
      where: { id: createdTour.id },
      include: { steps: { include: { finding: true }, orderBy: { order: "asc" } } },
    });
  });
}

export { toCoreTourStep };
