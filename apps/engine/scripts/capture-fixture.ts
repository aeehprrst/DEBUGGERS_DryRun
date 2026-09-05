/**
 * CR-13 · TRD §5.8 — rebuild a committed replay fixture from a completed run.
 *
 *   pnpm --filter engine exec tsx scripts/capture-fixture.ts <runId> <fixtureId>
 *
 * Writes `fixtures/<fixtureId>/{graph.json, shots/, fixture.json}`. These files
 * are committed: they are the demo's insurance policy and must survive a laptop
 * wipe (L5). `fixture.json` records where the cached data came from, because
 * replay is disclosed openly and a fixture with no provenance cannot be.
 */
import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { StateGraphSchema } from "@dry-run/core";
import { prisma } from "../src/db.js";
import { fixtureDir } from "../src/replay.js";

const [runId, fixtureId] = process.argv.slice(2);
if (!runId || !fixtureId) {
  console.error("usage: capture-fixture.ts <runId> <fixtureId>");
  process.exit(2);
}

const run = await prisma.run.findUnique({ where: { id: runId } });
if (!run) throw new Error(`run not found: ${runId}`);
if (!run.graph) throw new Error(`run ${runId} has no graph`);
if (run.status !== "DONE") {
  // A DEGRADED or FAILED run is not what the demo should replay, and baking one
  // into a fixture would hide the failure behind a cache.
  throw new Error(`run ${runId} is ${run.status}, refusing to capture a fixture from it`);
}

const graph = StateGraphSchema.parse(JSON.parse(run.graph));
const dir = fixtureDir(fixtureId);
await mkdir(path.join(dir, "shots"), { recursive: true });

const sourceShots = path.resolve(process.cwd(), "data", "runs", runId);
if (existsSync(sourceShots)) {
  await cp(sourceShots, path.join(dir, "shots"), { recursive: true });
}

await writeFile(path.join(dir, "graph.json"), `${JSON.stringify(graph, null, 2)}\n`);
await writeFile(
  path.join(dir, "fixture.json"),
  `${JSON.stringify(
    {
      capturedFromRunId: runId,
      capturedAt: new Date().toISOString(),
      targetUrl: run.targetUrl,
      note: "Crawl replayed from cached fixture. Chorus, Analysis and Usher still run for real.",
    },
    null,
    2,
  )}\n`,
);

const shotCount = existsSync(path.join(dir, "shots"))
  ? (await readdir(path.join(dir, "shots"))).length
  : 0;
console.log(
  `fixture ${fixtureId}: ${Object.keys(graph.nodes).length} states, ${graph.edges.length} edges, ${shotCount} screenshot files -> ${dir}`,
);
await prisma.$disconnect();
