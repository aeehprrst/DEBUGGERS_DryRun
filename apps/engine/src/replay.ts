import { cp, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { StateGraphSchema, type StateGraph } from "@dry-run/core";
import { emitRunEvent } from "./sse.js";

/**
 * CR-13 · TRD §5.8 — replay mode.
 *
 * `DRYRUN_REPLAY=<fixtureId>` loads a stored graph instead of driving a browser.
 * CLAUDE.md L5: the stage demo never crawls live, so this is a first-class code
 * path, not a debug flag — and it is never hidden. The fixture's provenance is
 * returned so every caller can print where the cached data came from.
 *
 * TRD §4.1 rule 6: replay short-circuits **the crawl stage only**. Chorus,
 * Analysis and Usher then run for real against the replayed graph. The
 * simulation is never faked; only the browser work is cached.
 */

// TRD §5.8 — "Fixtures live in apps/engine/fixtures/<fixtureId>/{graph.json,
// shots/} and are committed to the repo — they are demo insurance and must
// survive a laptop wipe."
export const FIXTURES_ROOT = path.resolve(process.cwd(), "fixtures");

// TRD §4.1 rule 6 — "emits the same state-found / edge-found events on a 60 ms
// timer so the Live view animates identically".
const REPLAY_EVENT_INTERVAL_MS = 60;

// A fixture id names a directory, and it arrives from the environment. Anything
// outside this alphabet is refused rather than sanitised, so no value of
// DRYRUN_REPLAY can ever escape the fixtures root.
const FIXTURE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type FixtureProvenance = {
  fixtureId: string;
  /** Free-form metadata from fixture.json — absent on a hand-built fixture. */
  capturedFromRunId?: string;
  capturedAt?: string;
  targetUrl?: string;
  note?: string;
};

export function replayFixtureIdFromEnv(): string | undefined {
  const id = process.env.DRYRUN_REPLAY?.trim();
  return id && id.length > 0 ? id : undefined;
}

export function fixtureDir(fixtureId: string): string {
  if (!FIXTURE_ID_RE.test(fixtureId)) {
    throw new Error(`invalid DRYRUN_REPLAY fixture id: ${JSON.stringify(fixtureId)}`);
  }
  return path.join(FIXTURES_ROOT, fixtureId);
}

export async function readFixtureProvenance(
  fixtureId: string,
): Promise<FixtureProvenance> {
  const file = path.join(fixtureDir(fixtureId), "fixture.json");
  if (!existsSync(file)) return { fixtureId };
  try {
    return { fixtureId, ...JSON.parse(await readFile(file, "utf8")) };
  } catch {
    // A malformed sidecar must not take the demo down; the graph is the
    // load-bearing half and the disclosure degrades to just the id.
    return { fixtureId };
  }
}

export type ReplayResult = {
  graph: StateGraph;
  stateCount: number;
  actionCount: number;
  truncated: boolean;
  provenance: FixtureProvenance;
};

/**
 * Loads a fixture and re-emits its states and edges through the normal SSE bus,
 * paced so the Live view animates as it would during a real crawl.
 *
 * Screenshots are copied into this run's own `data/runs/<runId>/` and the paths
 * rewritten, so every downstream consumer — the Atlas, the findings evidence
 * bundle — reads them exactly as it reads a live run's. Pointing at the
 * original run's directory instead would make a replayed run's evidence vanish
 * the moment that run was deleted.
 */
export async function replayCrawl(
  runId: string,
  fixtureId: string,
  options: {
    checkCancel?: () => void;
    onStateFound?: (statesFound: number) => void;
    /**
     * PRESENTATION ONLY (CLAUDE.md §6.6) — milliseconds to wait after each SSE
     * emission so a replayed crawl is legibly watchable on a projector. 0, the
     * default, is the pre-existing behaviour exactly.
     *
     * **This changes nothing about the data.** Same states, same edges, same
     * order, same counts; every event emitted is a real observation this
     * fixture recorded in a real browser, and only the playback speed differs.
     * It is a sleep between emits and nothing else.
     *
     * It is a parameter rather than an env read *inside this function* on
     * purpose: the evaluation harness drives the same orchestrator, and a
     * variable this path could read for itself would silently pace `pnpm demo`
     * and move its wall clock. Only the server entry point supplies it.
     */
    paceMs?: number;
  } = {},
): Promise<ReplayResult> {
  const dir = fixtureDir(fixtureId);
  const graphFile = path.join(dir, "graph.json");
  if (!existsSync(graphFile)) {
    throw new Error(
      `DRYRUN_REPLAY=${fixtureId} but no fixture at ${graphFile}. Fixtures are committed to the repo; run scripts/capture-fixture.ts to rebuild one.`,
    );
  }

  // Parsed through the Zod schema, not JSON.parse alone: a fixture is a file on
  // disk that can drift behind the contract, and a silently-wrong graph would
  // surface as nonsense findings rather than as a load error (§6.2).
  const graph = StateGraphSchema.parse(JSON.parse(await readFile(graphFile, "utf8")));
  const provenance = await readFixtureProvenance(fixtureId);

  const shots = path.join(dir, "shots");
  const runShots = path.resolve(process.cwd(), "data", "runs", runId);
  if (existsSync(shots)) {
    await mkdir(runShots, { recursive: true });
    await cp(shots, runShots, { recursive: true });
  }

  const checkCancel = options.checkCancel ?? (() => {});
  // Guarded so a negative or non-finite value cannot stall the pipeline.
  const paceMs =
    Number.isFinite(options.paceMs) && (options.paceMs as number) > 0
      ? (options.paceMs as number)
      : 0;
  const paced = paceMs > 0;

  const states = Object.values(graph.nodes);
  const edgesByFrom = new Map<string, typeof graph.edges>();
  for (const edge of graph.edges) {
    edgesByFrom.set(edge.fromStateId, [...(edgesByFrom.get(edge.fromStateId) ?? []), edge]);
  }

  let found = 0;
  for (const state of states) {
    // Rule 5 — cancellation is checked between units of work, and a replayed
    // state is the same unit a crawled state is.
    checkCancel();

    // Rewrite before emitting, so a live subscriber and the persisted graph
    // never disagree about where a screenshot lives.
    state.screenshotPath = `/static/runs/${runId}/${state.id}.jpg`;

    emitRunEvent(runId, { t: "state-found", state });
    found += 1;
    options.onStateFound?.(found);
    if (paced) await sleep(paceMs);

    for (const edge of edgesByFrom.get(state.id) ?? []) {
      emitRunEvent(runId, { t: "action-found", edge });
      if (paced) await sleep(paceMs);
    }

    // Unpaced, the per-state interval is the only wait, exactly as before.
    if (!paced) await sleep(REPLAY_EVENT_INTERVAL_MS);
  }

  return {
    graph,
    stateCount: states.length,
    actionCount: graph.edges.length,
    // A fixture records what the crawl found, budget included. Nothing here
    // re-derives it — replaying cannot discover a state the capture did not.
    truncated: false,
    provenance,
  };
}
