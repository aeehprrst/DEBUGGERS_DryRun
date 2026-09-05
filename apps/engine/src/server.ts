import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import {
  AllowActionsSchema,
  SeededValuesSchema,
  StepStatus,
} from "@dry-run/core";
import type {
  AllowActions,
  PersonaTraitVector,
  SeededValues,
  StateGraph,
} from "@dry-run/core";
import { runAnalysis } from "./brain/analysis.js";
import { runChorusSimulation } from "./brain/chorus.js";
import { cancelRun, startRun } from "./orchestrator.js";
import { createTourForRun } from "./usher/persist.js";
import { bootDatabase, prisma, toCoreFinding, toCoreTourStep } from "./db.js";
import { emitRunEvent, subscribeToRun } from "./sse.js";

// TRD §5.8 — the interface's `/api/*` rewrite proxies through Next.js, so a
// request's Host header as seen here can't be trusted to reconstruct this
// engine's own reachable origin. The export snippet has to point somewhere
// a *third-party* target page (not the interface) can actually load a
// script from, so this is hardcoded the same way next.config.ts hardcodes
// the engine's address for its own rewrite destination.
const ENGINE_ORIGIN = "http://localhost:4000";

// CR-07 — Meridian's /connect rejects any API key that doesn't start with
// "mk_" (PRD §9.1), which is what stops the crawl short of /invite, /webhook
// and /dashboard. A real operator types their own seeded values on Setup; this
// is the bundled demo target's default so the demo run needs no request body.
// Scoped to Meridian's dev origin so it can never leak onto a third-party
// target — there it would just be a wrong value typed into someone's form.
const MERIDIAN_ORIGIN = "http://localhost:5173";
const MERIDIAN_SEEDED_VALUES: SeededValues = { "API key": "mk_demo123" };

function defaultSeededValuesFor(targetUrl: string): SeededValues {
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
const MERIDIAN_ALLOW_ACTIONS: AllowActions = ["Send invite"];

function defaultAllowActionsFor(targetUrl: string): AllowActions {
  try {
    return new URL(targetUrl).origin === MERIDIAN_ORIGIN
      ? MERIDIAN_ALLOW_ACTIONS
      : [];
  } catch {
    return [];
  }
}
const USHER_RT_BUNDLE_PATH = path.join(
  process.cwd(),
  "..",
  "..",
  "packages",
  "usher-rt",
  "dist",
  "usher-rt.js",
);

// PS-03 is unbuilt (population size is not yet operator-configurable), so the
// orchestrator needs a declared default rather than a literal buried in a
// route handler.
const DEFAULT_POPULATION_SIZE = 1000;

// TRD §5.3's ten shipped archetypes, trimmed to a small default mix — no
// per-run persona configuration exists yet, so the orchestrator's chorus stage
// needs something reasonable to simulate against with no request body.
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

app.post<{
  Body: {
    targetUrl?: string;
    attestation?: boolean;
    seededValues?: unknown;
    allowActions?: unknown;
  };
}>(
  "/runs",
  async (request, reply) => {
    const { targetUrl, attestation, seededValues, allowActions } =
      request.body ?? {};

    if (attestation !== true) {
      return reply.status(400).send({ error: "attestation must be true" });
    }
    if (typeof targetUrl !== "string" || targetUrl.length === 0) {
      return reply.status(400).send({ error: "targetUrl is required" });
    }

    // CR-07 step 1. An operator-supplied map replaces the target default
    // outright rather than merging — a partial merge would silently reinstate a
    // value the operator had deliberately removed.
    let resolvedSeededValues: SeededValues;
    if (seededValues === undefined) {
      resolvedSeededValues = defaultSeededValuesFor(targetUrl);
    } else {
      const parsed = SeededValuesSchema.safeParse(seededValues);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "seededValues must be an object of string to string" });
      }
      resolvedSeededValues = parsed.data;
    }

    // TRD S4. The attestation gate above is what authorises an allowlist at
    // all — CLAUDE.md §8: "exceptions are named explicitly by the attesting
    // operator" — so this deliberately sits after that check and never before.
    let resolvedAllowActions: AllowActions;
    if (allowActions === undefined) {
      resolvedAllowActions = defaultAllowActionsFor(targetUrl);
    } else {
      const parsed = AllowActionsSchema.safeParse(allowActions);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "allowActions must be an array of strings" });
      }
      resolvedAllowActions = parsed.data;
    }

    const run = await prisma.run.create({
      data: {
        projectId: "proj_meridian",
        userId: "usr_local",
        targetUrl,
        // App Flow §3 — the run enters CREATED; the orchestrator is what moves
        // it to CRAWLING, so the status always reflects a stage that is
        // actually running rather than one that is merely intended.
        status: "CREATED",
        stage: "crawl",
        config: JSON.stringify({
          targetUrl,
          hasTargetCredentials: false,
          seededValues: resolvedSeededValues,
          allowActions: resolvedAllowActions,
        }),
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
        // Null, not "[]", when nothing was permitted — "no exceptions granted"
        // and "an empty exception list was submitted" must stay distinguishable
        // in an audit record.
        allowActions: resolvedAllowActions.length
          ? JSON.stringify(resolvedAllowActions)
          : null,
      },
    });

    // PL-01 / TRD §4.2 — "return { runId } immediately, never block the HTTP
    // response". The pipeline runs crawl → chorus → analysis → tour → done
    // sequentially and awaited inside the orchestrator; this call is the only
    // detachment, and it cannot reject (startRun installs its own catch).
    startRun(run.id, {
      targetUrl,
      seededValues: resolvedSeededValues,
      allowActions: resolvedAllowActions,
      personaMix: DEFAULT_PERSONA_MIX,
      populationSize: DEFAULT_POPULATION_SIZE,
    });

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
  if (!run.graph) {
    return reply.status(400).send({ error: "run has no graph yet" });
  }

  // The orchestrator's tour stage already created this during the run;
  // createTourForRun is idempotent and returns the existing rows rather than
  // regenerating over the human approval decisions they carry.
  const tour = await createTourForRun(runId);
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

  // A manual re-run hook, not part of the pipeline — the orchestrator already
  // ran chorus → analysis → tour on its own (PL-01). Awaited and guarded
  // rather than `void`-called: runAnalysis now throws instead of swallowing,
  // so detaching it here would surface as an unhandled rejection.
  try {
    await runAnalysis(runId);
    await createTourForRun(runId);
  } catch (err) {
    request.log.error({ err, runId }, "manual chorus re-run: analysis failed");
    return reply.status(500).send({
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return result;
});

// App Flow §3 — "Cancel is available in the top bar while running:
// DELETE /runs/:id → CANCELLED, partial graph retained and viewable."
app.delete<{ Params: { id: string } }>("/runs/:id", async (request, reply) => {
  const runId = request.params.id;
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: { id: true, status: true },
  });
  if (!run) {
    return reply.status(404).send({ error: "run not found" });
  }

  // The orchestrator sets the terminal status itself once the flag is seen at
  // the next unit boundary, so this does not write the status directly — doing
  // both would race the pipeline's own final write.
  if (!cancelRun(runId)) {
    return reply
      .status(409)
      .send({ error: `run is not in progress (status ${run.status})` });
  }

  return { runId, cancelling: true };
});

try {
  await bootDatabase();
  await app.listen({ port: 4000, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
