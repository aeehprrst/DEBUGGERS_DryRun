/**
 * PL-06 · the evaluation harness.
 *
 *   pnpm demo            cached fixture (the stage path — L5, never crawl live)
 *   pnpm demo:live       real crawl against a local Meridian on :5173
 *
 * Runs the whole pipeline — crawl (or replay) → Chorus → Analysis → Usher —
 * then grades the ranked findings against the six defects planted in Meridian
 * and declared in `apps/demo/planted-defects.json`.
 *
 * Two rules make the score mean something:
 *
 *  1. **The answer key is a committed file, not code here.** The harness reads
 *     it; it does not contain it. A score you can only reproduce by trusting the
 *     grader is not a measurement.
 *  2. **A defect matches a finding by (expected signature + route), never by
 *     the finding's wording.** Text matching would let a reworded explanation
 *     move the score, which is grading the prose rather than the detector.
 *
 * Exits non-zero when the score falls below the PRD §10 target, so a detection
 * regression is loud rather than a number nobody re-read.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { RunOrchestrator } from "../orchestrator.js";
import { bootDatabase, prisma } from "../db.js";
import { readFixtureProvenance, replayFixtureIdFromEnv } from "../replay.js";
import {
  DEFAULT_PERSONA_MIX,
  DEFAULT_POPULATION_SIZE,
  MERIDIAN_ORIGIN,
  defaultAllowActionsFor,
  defaultSeededValuesFor,
} from "../run-defaults.js";
import type { StateGraph } from "@dry-run/core";

// PRD §10 / PL-06 — "asserts n of 6 planted defects in the top 8 findings".
const TOP_N = 8;
// PRD §10 — "Planted defects in the top 3 by Fix Value ≥ 2".
const TOP_BY_FIXVALUE = 3;

// PRD §10 hackathon targets. Declared here so the harness prints what it is
// grading against rather than an unexplained verdict.
const TARGET_SCORE = 5; // "Planted defects surfaced in the top 8 findings ≥ 5 of 6"
const TARGET_TOP3 = 2; // "Planted defects in the top 3 by Fix Value ≥ 2"
const TARGET_FALSE_POSITIVES = 2; // "False positives in the top 8 ≤ 2, and disclosed"
const TARGET_WALL_CLOCK_MS = 45_000; // "Full pipeline, cached fixture → ranked Atlas < 45 s"

// The answer key ships with the app that carries the defects, not with the
// grader. `--ground-truth <path>` overrides it, which is what makes the failure
// gate testable without editing the committed key.
const DEFAULT_GROUND_TRUTH_PATH = path.resolve(
  process.cwd(),
  "..",
  "demo",
  "planted-defects.json",
);

type PlantedDefect = {
  id: string;
  screen: string;
  route: string;
  expectedSignature: string;
  description: string;
};

type GradedFinding = {
  /** 1-indexed for display; the DB stores rank 0-indexed. */
  position: number;
  signature: string;
  stateId: string;
  route: string;
  title: string;
  fixValue: number;
  matchedDefectId: string | null;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) {
    return process.argv[i + 1];
  }
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}

function routeOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function pad(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : s + " ".repeat(width - s.length);
}

function verdict(ok: boolean): string {
  return ok ? "PASS" : "FAIL";
}

function row(cells: string[], widths: number[]): string {
  return `│ ${cells.map((c, i) => pad(c, widths[i])).join(" │ ")} │`;
}

function rule(widths: number[], l: string, m: string, r: string): string {
  return l + widths.map((w) => "─".repeat(w + 2)).join(m) + r;
}

async function main() {
  // `--replay <id>` is the same switch as the env var; the flag exists because
  // package.json scripts have to set it identically on Windows and POSIX and
  // this repo does not carry cross-env.
  const replayFlag = arg("replay");
  if (replayFlag && !process.env.DRYRUN_REPLAY) {
    process.env.DRYRUN_REPLAY = replayFlag;
  }
  const fixtureId = replayFixtureIdFromEnv();
  const targetUrl = arg("target") ?? MERIDIAN_ORIGIN;

  const groundTruthPath = arg("ground-truth")
    ? path.resolve(arg("ground-truth")!)
    : DEFAULT_GROUND_TRUTH_PATH;
  const groundTruth = JSON.parse(await readFile(groundTruthPath, "utf8")) as {
    target: string;
    source: string;
    defects: PlantedDefect[];
  };

  // Live mode needs Meridian actually running; failing here with an instruction
  // beats failing four minutes later with an empty graph.
  if (!fixtureId) {
    const reachable = await fetch(targetUrl, { method: "GET" })
      .then((r) => r.ok)
      .catch(() => false);
    if (!reachable) {
      console.error(
        `\n  Live mode: ${targetUrl} is not reachable.\n  Start Meridian with \`pnpm dev:demo\`, or run \`pnpm demo\` to use the cached fixture.\n`,
      );
      process.exit(2);
    }
  }

  await bootDatabase();

  const seededValues = defaultSeededValuesFor(targetUrl);
  const allowActions = defaultAllowActionsFor(targetUrl);

  const run = await prisma.run.create({
    data: {
      projectId: "proj_meridian",
      userId: "usr_eval",
      targetUrl,
      status: "CREATED",
      stage: "crawl",
      config: JSON.stringify({
        targetUrl,
        hasTargetCredentials: false,
        seededValues,
        allowActions,
      }),
    },
  });

  // S1 — the attestation record exists for a harness run too. The HTTP gate in
  // server.ts is what refuses an unattested *request*; this is not an HTTP
  // client, so it records the operator's attestation directly. Invoking the
  // harness against the bundled demo target is the attestation.
  await prisma.attestation.create({
    data: {
      runId: run.id,
      userId: "usr_eval",
      targetUrl,
      attested: true,
      userAgent: "DryRun-Eval-Harness/1.0",
      allowActions: allowActions.length ? JSON.stringify(allowActions) : null,
    },
  });

  const startedAt = Date.now();
  await new RunOrchestrator(run.id, {
    targetUrl,
    seededValues,
    allowActions,
    personaMix: DEFAULT_PERSONA_MIX,
    populationSize: DEFAULT_POPULATION_SIZE,
  }).start();
  const wallClockMs = Date.now() - startedAt;

  const finished = await prisma.run.findUniqueOrThrow({ where: { id: run.id } });
  const graph: StateGraph = finished.graph ? JSON.parse(finished.graph) : { nodes: {}, edges: [] };
  const findings = await prisma.finding.findMany({
    where: { runId: run.id },
    orderBy: { rank: "asc" },
  });

  // ── grade ────────────────────────────────────────────────────────────────
  const graded: GradedFinding[] = findings.map((f, i) => {
    const route = routeOf(graph.nodes[f.stateId]?.url ?? "");
    const match = groundTruth.defects.find(
      (d) => d.expectedSignature === f.signature && d.route === route,
    );
    return {
      position: i + 1,
      signature: f.signature,
      stateId: f.stateId,
      route,
      title: f.title,
      fixValue: f.fixValue,
      matchedDefectId: match?.id ?? null,
    };
  });

  const bestFor = new Map<string, GradedFinding>();
  for (const g of graded) {
    if (!g.matchedDefectId) continue;
    if (!bestFor.has(g.matchedDefectId)) bestFor.set(g.matchedDefectId, g);
  }

  const topN = graded.filter((g) => g.position <= TOP_N);
  const falsePositives = topN.filter((g) => g.matchedDefectId === null);
  const foundAnywhere = groundTruth.defects.filter((d) => bestFor.has(d.id));
  const foundInTopN = groundTruth.defects.filter(
    (d) => (bestFor.get(d.id)?.position ?? Infinity) <= TOP_N,
  );
  const foundInTop3 = groundTruth.defects.filter(
    (d) => (bestFor.get(d.id)?.position ?? Infinity) <= TOP_BY_FIXVALUE,
  );

  const matchedInTopN = topN.length - falsePositives.length;
  const precision = topN.length > 0 ? matchedInTopN / topN.length : 0;
  const recall = foundInTopN.length / groundTruth.defects.length;

  // ── report ───────────────────────────────────────────────────────────────
  const W = 80;
  const line = "═".repeat(W);
  const out: string[] = [];
  out.push("");
  out.push(line);
  out.push("  Dry Run · evaluation harness (PL-06)");
  out.push(line);
  out.push(`  target         ${targetUrl}`);

  if (fixtureId) {
    const prov = await readFixtureProvenance(fixtureId);
    out.push(`  crawl source   CACHED FIXTURE "${fixtureId}"  — crawl replayed, not run`);
    if (prov.capturedFromRunId) {
      out.push(`                 captured ${prov.capturedAt ?? "?"} from run ${prov.capturedFromRunId}`);
    }
    out.push("                 Chorus, Analysis and Usher ran for real against it.");
  } else {
    out.push("  crawl source   LIVE CRAWL — a real browser drove the target");
  }

  out.push(
    `  population     ${finished.populationSize ?? DEFAULT_POPULATION_SIZE} personas over ${DEFAULT_PERSONA_MIX.length} archetypes`,
  );
  out.push(
    `  run            ${run.id}   ${finished.status}   ${finished.stateCount} states · ${finished.actionCount} edges · ${findings.length} findings`,
  );
  if (finished.error) out.push(`  error          ${finished.error}`);
  out.push("");

  // Planted defects
  const dw = [4, 20, 19, 7, 6, 5];
  const groundTruthLabel = path
    .relative(path.resolve(process.cwd(), "..", ".."), groundTruthPath)
    .replace(/\\/g, "/");
  out.push(`  PLANTED DEFECTS — ground truth: ${groundTruthLabel}`);
  out.push("  " + rule(dw, "┌", "┬", "┐"));
  out.push("  " + row(["id", "screen", "expected signature", "result", "rank", "state"], dw));
  out.push("  " + rule(dw, "├", "┼", "┤"));
  for (const d of groundTruth.defects) {
    const hit = bestFor.get(d.id);
    out.push(
      "  " +
        row(
          [
            d.id,
            d.screen,
            d.expectedSignature,
            hit ? "FOUND" : "MISSED",
            hit ? `#${hit.position}` : "—",
            hit?.stateId ?? "—",
          ],
          dw,
        ),
    );
  }
  out.push("  " + rule(dw, "└", "┴", "┘"));
  out.push("");

  // Ranked findings
  const fw = [4, 19, 5, 11, 8, 6];
  out.push(`  RANKED FINDINGS — top ${TOP_N} is what the score is taken over`);
  out.push("  " + rule(fw, "┌", "┬", "┐"));
  out.push("  " + row(["rank", "signature", "state", "route", "fixValue", "match"], fw));
  out.push("  " + rule(fw, "├", "┼", "┤"));
  for (const g of graded) {
    out.push(
      "  " +
        row(
          [
            `#${g.position}${g.position > TOP_N ? "*" : ""}`,
            g.signature,
            g.stateId,
            g.route,
            g.fixValue.toFixed(3),
            g.matchedDefectId ?? "FP",
          ],
          fw,
        ),
    );
  }
  out.push("  " + rule(fw, "└", "┴", "┘"));
  if (graded.some((g) => g.position > TOP_N)) {
    out.push(`  * below the top ${TOP_N}, so it does not count toward the score.`);
  }
  out.push("");

  // Scorecard
  const total = groundTruth.defects.length;
  const scorePass = foundInTopN.length >= TARGET_SCORE;
  const top3Pass = foundInTop3.length >= TARGET_TOP3;
  const fpPass = falsePositives.length <= TARGET_FALSE_POSITIVES;
  // PRD §10's budget is stated for the *cached fixture* path ("Full pipeline,
  // cached fixture → ranked Atlas < 45 s"), which is the one that runs on
  // stage. A live crawl drives a real browser through every state twice over
  // and is not what that target was written about, so it is timed and printed
  // but not graded — holding it to a budget it was never given would be a
  // fabricated verdict.
  const timePass = fixtureId ? wallClockMs < TARGET_WALL_CLOCK_MS : undefined;

  const score = (
    label: string,
    value: string,
    target: string,
    ok?: boolean,
    note = "",
  ) =>
    `    ${pad(label, 18)}${pad(value, 26)}${pad(target, 15)}${
      ok === undefined ? pad("", 4) : pad(verdict(ok), 4)
    }  ${note}`.trimEnd();

  out.push("  SCORECARD");
  out.push(
    score(
      "score",
      `${foundInTopN.length} of ${total} in the top ${TOP_N}`,
      `target >= ${TARGET_SCORE}`,
      scorePass,
    ),
  );
  out.push(score("", `${foundAnywhere.length} of ${total} found anywhere`, ""));
  out.push(
    score(
      `top ${TOP_BY_FIXVALUE} by fixValue`,
      `${foundInTop3.length} of ${total}`,
      `target >= ${TARGET_TOP3}`,
      top3Pass,
    ),
  );
  out.push(
    score(
      "false positives",
      `${falsePositives.length} in the top ${TOP_N}`,
      `target <= ${TARGET_FALSE_POSITIVES}`,
      fpPass,
    ),
  );
  out.push(
    score(
      "wall clock",
      `${(wallClockMs / 1000).toFixed(1)} s`,
      fixtureId ? `target <  ${TARGET_WALL_CLOCK_MS / 1000} s` : "",
      timePass,
      fixtureId ? "" : `the < ${TARGET_WALL_CLOCK_MS / 1000} s target is stated for the cached path`,
    ),
  );
  out.push(
    score(
      "precision",
      `${matchedInTopN}/${topN.length} = ${precision.toFixed(3)}`,
      "",
      undefined,
      `of the top ${TOP_N}, this many hit a planted defect`,
    ),
  );
  out.push(
    score(
      "recall",
      `${foundInTopN.length}/${total} = ${recall.toFixed(3)}`,
      "",
      undefined,
      `planted defects surfaced in the top ${TOP_N}`,
    ),
  );
  out.push("");

  if (falsePositives.length > 0) {
    // PRD §10 — "False positives in the top 8: ≤ 2, and disclosed." Printed in
    // full, with their wording, so a human can judge whether each one is noise
    // or a real defect nobody planted.
    out.push("  FALSE POSITIVES — disclosed, not suppressed");
    for (const fp of falsePositives) {
      out.push(`    #${fp.position}  ${fp.signature} @ ${fp.route} (${fp.stateId})`);
      out.push(`        ${fp.title}`);
    }
    out.push("");
  }

  const missed = groundTruth.defects.filter((d) => !bestFor.has(d.id));
  if (missed.length > 0) {
    out.push("  MISSED");
    for (const d of missed) {
      out.push(`    ${d.id}  ${d.screen} — ${d.description}`);
      out.push(`        expected signature "${d.expectedSignature}" on ${d.route}; no finding matched`);
    }
    out.push("");
  }

  out.push(line);
  out.push(
    `  ${verdict(scorePass)} — score ${foundInTopN.length}/${total} in the top ${TOP_N} (gate: >= ${TARGET_SCORE}). Exit ${scorePass ? 0 : 1}.`,
  );
  out.push(line);
  out.push("");
  console.log(out.join("\n"));

  await prisma.$disconnect();
  process.exit(scorePass ? 0 : 1);
}

await main();
