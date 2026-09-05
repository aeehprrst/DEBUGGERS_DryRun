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
  AtlasNode,
  SeededValues,
  StateGraph,
  RunExclusion,
  StateMetrics,
} from "@dry-run/core";
import { runAnalysis } from "./brain/analysis.js";
import { runChorusSimulation } from "./brain/chorus.js";
import { cancelRun, startRun } from "./orchestrator.js";
// PL-06 — these moved to their own module so the evaluation harness can run the
// same population and the same Meridian defaults without importing this file,
// which listens on a port at module scope.
import {
  DEFAULT_PERSONA_MIX,
  DEFAULT_POPULATION_SIZE,
  defaultAllowActionsFor,
  defaultSeededValuesFor,
} from "./run-defaults.js";
import { createTourForRun } from "./usher/persist.js";
import { bootDatabase, prisma, toCoreFinding, toCoreTourStep } from "./db.js";
import { emitRunEvent, subscribeToRun } from "./sse.js";
// CR-10 — the SSRF guard and its escape hatch. New module; nothing existing moved.
import { checkTargetUrl, privateTargetsAllowed } from "./safety/ssrf.js";
import { checkRobots } from "./safety/robots.js";
import { replayFixtureIdFromEnv } from "./replay.js";

// TRD §5.8 — the interface's `/api/*` rewrite proxies through Next.js, so a
// request's Host header as seen here can't be trusted to reconstruct this
// engine's own reachable origin. The export snippet has to point somewhere
// a *third-party* target page (not the interface) can actually load a
// script from, so this is hardcoded the same way next.config.ts hardcodes
// the engine's address for its own rewrite destination.
const ENGINE_ORIGIN = "http://localhost:4000";

/**
 * PRESENTATION ONLY (CLAUDE.md §6.6) — `DRYRUN_REPLAY_PACE_MS` spaces a
 * replayed crawl's SSE emissions so the Live view is legibly watchable during a
 * demo instead of finishing in under a second. Default 0: off, current
 * behaviour.
 *
 * **It changes nothing about the data.** The states, edges, order, counts,
 * findings and scores are identical at any pace; every event it spaces out is a
 * real observation the fixture recorded in a real browser. Only playback speed
 * moves, which is why it is disclosed as pacing and never as a crawl setting.
 *
 * **This is the only place it is read**, deliberately. The evaluation harness
 * drives the same `RunOrchestrator`, so a variable that `replayCrawl` or the
 * orchestrator could read for itself would silently pace `pnpm demo` and move
 * the wall clock PRD §10 budgets. Reading it here, at the HTTP entry point the
 * harness never touches, is what makes that impossible rather than merely
 * unlikely.
 */
function replayPaceMsFromEnv(): number {
  const parsed = Number(process.env.DRYRUN_REPLAY_PACE_MS ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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

/**
 * TR-06 — the only cross-origin reader of this engine is Meridian's tour
 * bootstrap, which fetches one approved tour and nothing else.
 *
 * This was `{ origin: true }`, which reflects whatever `Origin` a request
 * arrives with — i.e. every site on the internet could read every endpoint
 * here from a victim's browser, including run graphs and findings. Nothing
 * needed it: the interface reaches the engine through Next's server-side
 * `/api/*` rewrite (next.config.ts), which is server-to-server and sends no
 * `Origin` at all, so CORS never applied to it. The evaluation harness and the
 * fixtures are Node processes, likewise unaffected.
 *
 * So the allowance is now exactly the one the feature needs: a GET of a single
 * tour's export, from the Meridian origin. Everything else answers with no
 * CORS headers and is therefore unreadable cross-origin, which is what §8's
 * posture requires of a tool that holds crawl output.
 */
const MERIDIAN_ORIGINS = [
  "http://localhost:5173", // Meridian v1 — see run-defaults.ts MERIDIAN_ORIGIN
  "http://127.0.0.1:5173",
  "http://localhost:5174", // Meridian v2 (TRD §5) — same bootstrap, same need
  "http://127.0.0.1:5174",
];
const TOUR_EXPORT_PATH = /^\/tours\/[^/]+\/export(\?|$)/;

const app = Fastify({ logger: true });

// @fastify/cors' dynamic delegator: it sees the request, so the allowance can
// be scoped per route rather than per server.
await app.register(cors, () => (request: { method: string; url: string }, callback: (err: Error | null, options: { origin: string[] | boolean }) => void) => {
  const isTourExport =
    (request.method === "GET" || request.method === "OPTIONS") &&
    TOUR_EXPORT_PATH.test(request.url);
  callback(null, { origin: isTourExport ? MERIDIAN_ORIGINS : false });
});

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
    // CR-13 / L5 — the fixture this run replayed, or null for a real crawl.
    // The replay-mode banner is the disclosure L5 requires and it must be
    // available on every view of the run, not only while the crawl streams.
    replayFixtureId: run.replayFixtureId ?? null,
    // CR-10 / §8 — what robots.txt said, so the claim "we respect it" can be
    // stated with the actual answer attached. `null` means the check did not
    // run (a replayed run, or a run predating CR-10); it never means "allowed".
    robots: run.robotsDecision ? JSON.parse(run.robotsDecision) : null,
    // AN-07 — the run-level ExclusionIndex, on the existing run endpoint rather
    // than a new one. Three distinct states reach the client and must stay
    // distinguishable: `null` means analysis has not run (or predates AN-07);
    // an object with `index: null` and an `unavailableReason` means it ran and
    // no (state, segment) pair was comparable; an object with `index` set is
    // the headline. A zero is never any of them (PRD §6.4, CLAUDE.md §6.5).
    exclusion: run.exclusionIndex
      ? (JSON.parse(run.exclusionIndex) as RunExclusion)
      : null,
  };
});

/**
 * AT-02 — `AtlasNode[]` with metrics joined (TRD §5.9, §6; CLAUDE.md §6.4).
 *
 * "If this endpoint returns nodes without metrics, the visual layer is a lie."
 * It used to return the raw graph blob and nothing else, so every visual
 * property downstream had to invent its own friction — which is exactly the
 * hardcoded-constant failure §6.4 forbids.
 *
 * `metrics` is `null`, never a zero-filled object, when Chorus has not run or
 * did not reach this state. The UI renders an em dash and badges it Predicted;
 * a zero here would be indistinguishable from a genuinely calm screen.
 *
 * Edges ride alongside the nodes array rather than in a second request: the
 * Atlas cannot lay out a graph without them, and Backend Schema §8's Atlas hot
 * path is one `findUnique` selecting the whole blob anyway.
 */
app.get<{ Params: { id: string } }>("/runs/:id/graph", async (request, reply) => {
  const run = await prisma.run.findUnique({
    where: { id: request.params.id },
    // Backend Schema §8 "Atlas hot path" — one query, no blob parsing beyond
    // the two TEXT columns it actually needs.
    select: { graph: true, metrics: true, truncated: true },
  });
  if (!run) {
    return reply.status(404).send({ error: "run not found" });
  }

  // A run whose crawl has not persisted yet answers 200 with an empty graph of
  // the same shape — never a stub, never a 500 the Atlas has to special-case.
  const graph: StateGraph = run.graph
    ? (JSON.parse(run.graph) as StateGraph)
    : { nodes: {}, edges: [] };
  const metricsByState: Record<string, StateMetrics> = run.metrics
    ? (JSON.parse(run.metrics) as Record<string, StateMetrics>)
    : {};

  const nodes: AtlasNode[] = Object.values(graph.nodes).map((state) => ({
    ...state,
    metrics: metricsByState[state.id] ?? null,
  }));

  return { nodes, edges: graph.edges, truncated: run.truncated };
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

    // CR-10 / CLAUDE.md §8 — the SSRF guard runs here, before the run row
    // exists, so a rejected target leaves nothing behind and the operator is
    // told at submission rather than by a run that dies mid-crawl.
    //
    // L5 — a replayed run is exempt, and this is a statement about the network
    // rather than a convenience: `runCrawl` returns from the fixture before
    // `chromium.launch()` is ever called, so a replay issues no request to the
    // target at all. There is no host to guard. Guarding it anyway would mean
    // the stage demo — a replay of Meridian on localhost — could be refused by
    // a check protecting against traffic that provably never happens.
    const replayFixtureId = replayFixtureIdFromEnv();
    if (!replayFixtureId && !privateTargetsAllowed()) {
      const check = await checkTargetUrl(targetUrl);
      if (!check.ok) {
        request.log.warn(
          { targetUrl, reason: check.reason },
          "CR-10 SSRF guard rejected a target",
        );
        return reply.status(400).send({
          error: "target rejected by the SSRF guard",
          reason: check.reason,
          // Named explicitly: the operator running Meridian locally hits this
          // on their first run and the fix should not require reading source.
          hint: "Set ALLOW_PRIVATE_TARGETS=1 to crawl a private or loopback address. Never set it in a shipped default.",
        });
      }
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

    // CR-10 / CLAUDE.md §8 — "Respect robots.txt by default."
    //
    // After the run row exists, because the request carries `X-DryRun-Run-Id`
    // (§8 again) and there is no id to send before this point. That ordering
    // means a disallowed target still leaves a run behind — deliberately: it is
    // the audit record showing we asked and were told no, which is worth more
    // than a clean database.
    //
    // Skipped on replay for the same reason as the SSRF guard: no request is
    // made to the target, so there is nothing to ask permission for. The column
    // stays NULL and the absence is readable rather than implied.
    if (!replayFixtureId) {
      const robots = await checkRobots(targetUrl, run.id);
      await prisma.run.update({
        where: { id: run.id },
        data: { robotsDecision: JSON.stringify(robots) },
      });

      if (!robots.allowed) {
        await prisma.run.update({
          where: { id: run.id },
          data: { status: "FAILED", stage: "crawl" },
        });
        request.log.warn({ targetUrl, robots }, "CR-10 robots.txt disallowed the target");
        return reply.status(403).send({
          runId: run.id,
          error: "target disallows crawling in robots.txt",
          reason: robots.detail,
          rule: robots.rule,
        });
      }
    }

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
      replayPaceMs: replayPaceMsFromEnv(),
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

  // TR-06 — a step knows its `stateId`; only the run's graph knows that state's
  // url. Resolved here because this is the one place both are in scope, and a
  // step whose state is not in the graph is left without a `route` rather than
  // given a plausible-looking default (CLAUDE.md §6.5).
  const run = await prisma.run.findUnique({ where: { id: tour.runId } });
  const routeByStateId = new Map<string, string>();
  if (run?.graph) {
    const graph: StateGraph = JSON.parse(run.graph);
    for (const [stateId, state] of Object.entries(graph.nodes)) {
      try {
        routeByStateId.set(stateId, new URL(state.url).pathname);
      } catch {
        // A state whose url will not parse gets no route, and the runtime then
        // treats the step as route-unknown rather than route-mismatched.
      }
    }
  }

  const tourJson = {
    id: tour.id,
    runId: tour.runId,
    version: tour.version,
    steps: shippable.map((s) => {
      const step = toCoreTourStep(s);
      const route = routeByStateId.get(step.stateId);
      return route ? { ...step, route } : step;
    }),
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
