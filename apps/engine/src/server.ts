import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import { StepStatus } from "@dry-run/core";
import type { PersonaTraitVector, StateGraph } from "@dry-run/core";
import { runAnalysis } from "./brain/analysis.js";
import { runChorusSimulation } from "./brain/chorus.js";
import { runCrawl } from "./cartographer.js";
import { bootDatabase, prisma, toCoreFinding, toCoreTourStep } from "./db.js";
import { emitRunEvent, subscribeToRun } from "./sse.js";
import { generateTourFromFindings } from "./usher/generator.js";

// TRD §5.8 — the interface's `/api/*` rewrite proxies through Next.js, so a
// request's Host header as seen here can't be trusted to reconstruct this
// engine's own reachable origin. The export snippet has to point somewhere
// a *third-party* target page (not the interface) can actually load a
// script from, so this is hardcoded the same way next.config.ts hardcodes
// the engine's address for its own rewrite destination.
const ENGINE_ORIGIN = "http://localhost:4000";
const USHER_RT_BUNDLE_PATH = path.join(
  process.cwd(),
  "..",
  "..",
  "packages",
  "usher-rt",
  "dist",
  "usher-rt.js",
);

// TRD §5.3's ten shipped archetypes, trimmed to a small default mix — no
// per-run persona configuration exists yet, so /runs/:id/chorus needs
// something reasonable to simulate against with no request body.
const DEFAULT_PERSONA_MIX: PersonaTraitVector[] = [
  {
    role: "Impatient Founder",
    domainLiteracy: 0.6,
    patience: 6,
    riskAversion: 0.3,
    readingDepth: 0.2,
    priorFamiliarity: 0.2,
    device: "desktop-1440",
    inputMode: "pointer",
    weight: 0.3,
  },
  {
    role: "Cautious Ops Lead",
    domainLiteracy: 0.8,
    patience: 14,
    riskAversion: 0.7,
    readingDepth: 0.7,
    priorFamiliarity: 0.5,
    device: "laptop-1280",
    inputMode: "pointer",
    weight: 0.25,
  },
  {
    role: "Non-technical Marketer",
    domainLiteracy: 0.3,
    patience: 8,
    riskAversion: 0.5,
    readingDepth: 0.4,
    priorFamiliarity: 0.1,
    device: "desktop-1440",
    inputMode: "pointer",
    weight: 0.25,
  },
  {
    role: "Jargon-Fluent Engineer",
    domainLiteracy: 0.95,
    patience: 12,
    riskAversion: 0.4,
    readingDepth: 0.6,
    priorFamiliarity: 0.8,
    device: "laptop-1280",
    inputMode: "keyboard-only",
    weight: 0.2,
  },
];

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

// TRD §7 / Backend Schema §7 — screenshots on disk, served statically.
// @fastify/static requires `root` to exist at registration time, so a fresh
// checkout (no crawl run yet) needs the directory created up front.
const runsDataRoot = path.join(process.cwd(), "data", "runs");
mkdirSync(runsDataRoot, { recursive: true });
await app.register(staticPlugin, {
  root: runsDataRoot,
  prefix: "/static/runs/",
});

app.get("/health", async () => ({
  status: "ok",
  engine: "fastify",
  version: "1.0.0",
}));

app.get<{ Params: { id: string } }>("/runs/:id", async (request, reply) => {
  const run = await prisma.run.findUnique({ where: { id: request.params.id } });
  if (!run) {
    return reply.status(404).send({ error: "run not found" });
  }

  const findingRows = await prisma.finding.findMany({ where: { runId: run.id } });

  return {
    id: run.id,
    status: run.status,
    stage: run.stage,
    targetUrl: run.targetUrl,
    graph: run.graph ? (JSON.parse(run.graph) as StateGraph) : null,
    findings: findingRows.map(toCoreFinding),
  };
});

// Reads the real graph. `Run.graph` is a TEXT column holding a serialised
// StateGraph (TRD §8 D7), so a run whose crawl stage hasn't persisted yet
// answers 200 with an empty graph of the same shape — never a stub, and
// never a 500 the Atlas has to special-case.
app.get<{ Params: { id: string } }>("/runs/:id/graph", async (request, reply) => {
  const run = await prisma.run.findUnique({
    where: { id: request.params.id },
    select: { graph: true },
  });
  if (!run) {
    return reply.status(404).send({ error: "run not found" });
  }

  const emptyGraph: StateGraph = { nodes: {}, edges: [] };
  return run.graph ? (JSON.parse(run.graph) as StateGraph) : emptyGraph;
});

// Reads the real Finding rows for this run, ordered by `rank` (the stable
// display order written by analysis; `@@index([runId, rank])` covers it).
// Empty array when analysis hasn't run yet.
app.get<{ Params: { id: string } }>(
  "/runs/:id/findings",
  async (request, reply) => {
    const run = await prisma.run.findUnique({
      where: { id: request.params.id },
      select: { id: true },
    });
    if (!run) {
      return reply.status(404).send({ error: "run not found" });
    }

    const rows = await prisma.finding.findMany({
      where: { runId: run.id },
      orderBy: { rank: "asc" },
    });
    return rows.map(toCoreFinding);
  },
);

app.post<{ Body: { targetUrl?: string; attestation?: boolean } }>(
  "/runs",
  async (request, reply) => {
    const { targetUrl, attestation } = request.body ?? {};

    if (attestation !== true) {
      return reply.status(400).send({ error: "attestation must be true" });
    }
    if (typeof targetUrl !== "string" || targetUrl.length === 0) {
      return reply.status(400).send({ error: "targetUrl is required" });
    }

    const run = await prisma.run.create({
      data: {
        projectId: "proj_meridian",
        userId: "usr_local",
        targetUrl,
        status: "CRAWLING",
        stage: "crawl",
        config: JSON.stringify({ targetUrl, hasTargetCredentials: false }),
      },
    });

    const userAgentHeader = request.headers["user-agent"];
    await prisma.attestation.create({
      data: {
        runId: run.id,
        userId: "usr_local",
        targetUrl,
        attested: true,
        userAgent:
          typeof userAgentHeader === "string" ? userAgentHeader : null,
      },
    });

    // PRD v2 §0 / CLAUDE.md §5 — Scouts are cut, so the dummy scout that used
    // to run alongside the crawl is gone. Nothing chains the stages yet; the
    // orchestrator (PL-01) is what replaces it.
    void runCrawl(run.id, targetUrl);

    return { runId: run.id };
  },
);

app.get<{ Params: { id: string } }>("/runs/:id/events", (request, reply) => {
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  reply.raw.write(":ok\n\n");

  const unsubscribe = subscribeToRun(request.params.id, (event) => {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  request.raw.on("close", () => {
    unsubscribe();
    reply.raw.end();
  });
});

app.post<{ Params: { id: string } }>("/runs/:id/tour", async (request, reply) => {
  const runId = request.params.id;

  const run = await prisma.run.findUnique({ where: { id: runId } });
  if (!run) {
    return reply.status(404).send({ error: "run not found" });
  }

  // Idempotent by design: TourStep rows carry human approval decisions
  // (Backend Schema §"TOURS" — "steps are PATCHed individually ⇒ must be
  // rows"). Re-generating on every visit to `?view=tour` would silently
  // discard those decisions behind a fresh Tour row each time.
  const existingTour = await prisma.tour.findFirst({
    where: { runId },
    orderBy: { version: "desc" },
    include: { steps: { include: { finding: true }, orderBy: { order: "asc" } } },
  });
  if (existingTour) {
    return { ...existingTour, steps: existingTour.steps.map(toCoreTourStep) };
  }

  if (!run.graph) {
    return reply.status(400).send({ error: "run has no graph yet" });
  }

  const graph: StateGraph = JSON.parse(run.graph);
  const findingRows = await prisma.finding.findMany({ where: { runId } });
  const findings = findingRows.map(toCoreFinding);

  const steps = generateTourFromFindings(runId, findings, graph);

  // generateTourFromFindings can skip a top finding it couldn't anchor, so
  // `steps` is an order-preserving subsequence of this same sort — walk both
  // with one cursor to recover which finding produced each surviving step.
  const topFindings = [...findings].sort((a, b) => b.fixValue - a.fixValue).slice(0, 3);
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

  const tour = await prisma.$transaction(async (tx) => {
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

  return { ...tour, steps: tour.steps.map(toCoreTourStep) };
});

app.patch<{
  Params: { id: string; stepId: string };
  Body: { status?: string; title?: string; body?: string; placement?: string };
}>("/tours/:id/steps/:stepId", async (request, reply) => {
  const { id: tourId, stepId } = request.params;
  const { status, title, body, placement } = request.body ?? {};

  const step = await prisma.tourStep.findUnique({ where: { id: stepId } });
  if (!step || step.tourId !== tourId) {
    return reply.status(404).send({ error: "tour step not found" });
  }

  // App Flow §8.2 — editing title/body/placement always sets `status:
  // 'edited'` regardless of what the request also asked for; that status
  // "counts as approved" downstream (export/preview gating).
  const isEdit = title !== undefined || body !== undefined || placement !== undefined;
  const nextStatus = isEdit ? "edited" : status;

  if (nextStatus !== undefined && !StepStatus.safeParse(nextStatus).success) {
    return reply.status(400).send({ error: "invalid status" });
  }

  const updated = await prisma.tourStep.update({
    where: { id: stepId },
    data: {
      ...(title !== undefined
        ? { title, originalTitle: step.originalTitle ?? step.title }
        : {}),
      ...(body !== undefined
        ? { body, originalBody: step.originalBody ?? step.body }
        : {}),
      ...(placement !== undefined ? { placement } : {}),
      ...(nextStatus !== undefined ? { status: nextStatus } : {}),
      ...(nextStatus === "approved" || nextStatus === "edited"
        ? { approvedBy: "usr_local", approvedAt: new Date() }
        : {}),
    },
    include: { finding: true },
  });

  return toCoreTourStep(updated);
});

app.get<{ Params: { id: string } }>("/tours/:id/export", async (request, reply) => {
  const tour = await prisma.tour.findUnique({
    where: { id: request.params.id },
    include: { steps: { include: { finding: true }, orderBy: { order: "asc" } } },
  });
  if (!tour) {
    return reply.status(404).send({ error: "tour not found" });
  }

  // App Flow §8.2 guard: "Nothing ships that a human didn't approve —
  // enforced in the API, not just the UI." Proposed/rejected steps never
  // leave this endpoint.
  const shippable = tour.steps.filter(
    (s) => s.status === "approved" || s.status === "edited",
  );
  if (shippable.length === 0) {
    return reply.status(400).send({ error: "no approved steps to export" });
  }

  const tourJson = {
    id: tour.id,
    runId: tour.runId,
    version: tour.version,
    steps: shippable.map((s) => toCoreTourStep(s)),
  };

  const embedSnippet = `<script src="${ENGINE_ORIGIN}/usher-rt.js"></script>\n<script>DryRunTour.start(${JSON.stringify(tourJson)});</script>`;

  return { tourJson, embedSnippet };
});

app.get("/usher-rt.js", async (request, reply) => {
  try {
    const bundle = readFileSync(USHER_RT_BUNDLE_PATH, "utf8");
    reply.header("Content-Type", "application/javascript; charset=utf-8");
    return bundle;
  } catch {
    return reply
      .status(503)
      .send({ error: "usher-rt bundle not built — run `pnpm build` in packages/usher-rt" });
  }
});

app.post<{ Params: { id: string } }>("/runs/:id/chorus", async (request, reply) => {
  const runId = request.params.id;

  const run = await prisma.run.findUnique({ where: { id: runId } });
  if (!run) {
    return reply.status(404).send({ error: "run not found" });
  }
  if (!run.graph) {
    return reply.status(400).send({ error: "run has no graph yet" });
  }

  const graph: StateGraph = JSON.parse(run.graph);
  const result = runChorusSimulation(graph, DEFAULT_PERSONA_MIX, 1000);

  await prisma.run.update({
    where: { id: runId },
    data: {
      metrics: JSON.stringify(result.metrics),
      populationSize: result.populationSize,
    },
  });

  emitRunEvent(runId, {
    t: "chorus-done",
    populationSize: result.populationSize,
    completionRate: result.completionRate,
  });

  // Analysis reads Run.metrics back out of SQLite (not `result` directly),
  // so it must run after the update above has committed — fire-and-forget,
  // same contract as runCrawl in POST /runs: self-contained error handling,
  // progress observable only via SSE, not via this response.
  void runAnalysis(runId);

  return result;
});

try {
  await bootDatabase();
  await app.listen({ port: 4000, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
