"use client";

import type { AtlasNode, Finding, RunStatus } from "@dry-run/core";
import { frictionColor } from "@dry-run/core";
import { useCallback, useEffect, useState } from "react";
import FrictionMeter from "./design/FrictionMeter";
import ProvenanceBadge from "./design/ProvenanceBadge";

/**
 * AT-08 — the Findings view. App Flow §8: "The never-cut surface. If everything
 * else fails, this plus the tour export is the product. It is also the
 * keyboard-navigable equivalent of the Atlas, and it is not a second-class
 * citizen."
 *
 * Everything on this page is real. There is no placeholder number anywhere in
 * it: a metric Chorus did not produce renders an em dash and badges Predicted
 * (CLAUDE.md §6.5), never a zero standing in for missing data.
 *
 * NOT built here, deliberately: App Flow §8's ExclusionIndex header and the
 * per-finding segment deltas. Those need CH-04 (per-segment metrics) and AN-07,
 * neither of which exists in the engine yet. The layout leaves the space; it
 * does not fill it with an invented number.
 */

// App Flow §8 — "Generate tour from top 3".
const TOUR_TOP_N = 3;

// UI/UX §8.4 — "Single column 880px."
const COLUMN = "mx-auto w-full max-w-findings px-s-6";

type RunSummary = {
  id: string;
  status: RunStatus;
  stage: string;
  targetUrl: string;
};

type GraphResponse = {
  nodes: AtlasNode[];
  edges: unknown[];
  truncated: boolean;
};

type FailureKind = "not-found" | "engine";

/** A run id that does not exist is an operator mistake, not an outage — the
 *  recovery advice differs, so the two are distinguishable at the throw site. */
class NotFound extends Error {}

type Loaded = {
  run: RunSummary;
  findings: Finding[];
  nodesById: Map<string, AtlasNode>;
};

export default function FindingsView({ runId }: { runId: string }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; kind: FailureKind } | null>(
    null,
  );
  const [lightbox, setLightbox] = useState<Finding | null>(null);
  const [tourState, setTourState] = useState<"idle" | "working" | "error">("idle");
  const [tourError, setTourError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [runRes, findingsRes, graphRes] = await Promise.all([
        fetch(`/api/runs/${runId}`),
        fetch(`/api/runs/${runId}/findings`),
        fetch(`/api/runs/${runId}/graph`),
      ]);
      if (runRes.status === 404) throw new NotFound(`There is no run with the id ${runId}.`);
      if (!runRes.ok) throw new Error(`The engine answered ${runRes.status} for this run.`);
      if (!findingsRes.ok) throw new Error(`Findings could not be read (${findingsRes.status}).`);
      if (!graphRes.ok) throw new Error(`Graph could not be read (${graphRes.status}).`);

      const run = (await runRes.json()) as RunSummary;
      const findings = (await findingsRes.json()) as Finding[];
      const graph = (await graphRes.json()) as GraphResponse;

      setData({
        run,
        findings,
        nodesById: new Map(graph.nodes.map((n) => [n.id, n])),
      });
    } catch (err) {
      // §4 copy rules — say what happened and what to do next, never apologise,
      // and never show a stack trace to an operator. The two failures have
      // different remedies, so they are not collapsed into one message.
      if (err instanceof NotFound) {
        setLoadError({ message: err.message, kind: "not-found" });
      } else {
        setLoadError({
          message: err instanceof Error ? err.message : "The engine did not respond.",
          kind: "engine",
        });
      }
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Escape closes the lightbox — §10.3, everything keyboard-reachable.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  async function generateTour() {
    setTourState("working");
    setTourError(null);
    const res = await fetch(`/api/runs/${runId}/tour`, { method: "POST" }).catch(() => null);
    if (!res || !res.ok) {
      setTourState("error");
      setTourError(
        res
          ? `The engine refused to build a tour (${res.status}). The findings above are unaffected.`
          : "The engine did not respond. The findings above are unaffected.",
      );
      return;
    }
    window.location.href = `/runs/${runId}?view=tour`;
  }

  if (loadError) {
    return <FailureState message={loadError.message} kind={loadError.kind} onRetry={load} />;
  }
  if (!data) return <LoadingState />;

  const { run, findings, nodesById } = data;

  if (findings.length === 0) {
    return <ZeroState run={run} stateCount={nodesById.size} />;
  }

  return (
    <div className="flex-1 py-s-6">
      <div className={COLUMN}>
        <header className="mb-s-5">
          <h1 className="font-sans text-h1 font-semibold text-ink-0">Findings</h1>
          <p className="mt-s-1 text-body-sm text-ink-1">
            {findings.length} ranked by Fix Value across {nodesById.size} screens of{" "}
            <span className="font-mono text-data text-ink-1">{run.targetUrl}</span>.
          </p>
        </header>

        {/* App Flow §8 — the list is aria-live so a screen-reader operator is
            told when findings arrive, per UI/UX §10.4. */}
        <ol className="flex flex-col gap-s-3" aria-live="polite">
          {findings.map((finding, index) => (
            <li key={finding.id}>
              <FindingCard
                finding={finding}
                rank={index + 1}
                node={nodesById.get(finding.stateId)}
                onEvidence={() => setLightbox(finding)}
              />
            </li>
          ))}
        </ol>

        <div className="mt-s-5 flex flex-wrap items-center justify-end gap-s-4">
          {tourError ? (
            <p className="text-body-sm text-warn" role="status">
              {tourError}
            </p>
          ) : null}
          <button
            type="button"
            onClick={generateTour}
            disabled={tourState === "working"}
            className="h-9 rounded-md bg-marker px-s-4 font-sans text-body font-medium text-deep transition-[filter,transform] duration-instant ease-out hover:brightness-110 active:scale-[0.98] disabled:bg-shoal disabled:text-ink-2"
          >
            {tourState === "working"
              ? "Generating tour…"
              : `Generate tour from top ${TOUR_TOP_N} →`}
          </button>
        </div>

        <BiasDisclosure />
      </div>

      {lightbox ? (
        <EvidenceLightbox
          finding={lightbox}
          node={data.nodesById.get(lightbox.stateId)}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * UI/UX §9 — "Finding card: --chart-shelf, 3px left border in ramp colour.
 * Title h2, signature as a mono chip, friction meter, provenance badge."
 */
function FindingCard({
  finding,
  rank,
  node,
  onEvidence,
}: {
  finding: Finding;
  rank: number;
  node: AtlasNode | undefined;
  onEvidence: () => void;
}) {
  // The metric on the wire, not a recomputation. AT-02 guarantees `metrics` is
  // null rather than zero-filled when Chorus produced nothing for this state.
  const metrics = node?.metrics ?? null;
  const friction = metrics ? metrics.frictionScore : null;

  // A finding whose state carries no modeled metric is unsupported by the
  // simulation, whatever the classifier said — so the numbers on this card are
  // Predicted regardless of the finding's own provenance (L6).
  const numberProvenance = metrics ? finding.provenance : "predicted";

  const screen = node ? screenNameOf(node) : finding.stateId;
  const rampColour = friction === null ? "#1F3D4D" : frictionColor(friction);

  return (
    <article
      className="surface flex gap-s-4 rounded-md p-s-4"
      style={{ borderLeft: `3px solid ${rampColour}` }}
    >
      <span
        className="w-6 shrink-0 pt-0.5 text-right font-mono text-data text-ink-2 tabular-nums"
        aria-label={`Rank ${rank}`}
      >
        {rank}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-s-3">
          <h2 className="font-sans text-h2 font-semibold text-ink-0">{finding.title}</h2>
          <ProvenanceBadge provenance={numberProvenance} className="badge-pop mt-0.5" />
        </div>

        <div className="mt-s-2 flex flex-wrap items-center gap-s-2">
          <span className="rounded-sm border border-rule-strong bg-abyss px-1.5 py-0.5 font-mono text-[12px] text-ink-1">
            {finding.signature}
          </span>
          <span className="font-cond text-label font-semibold uppercase text-ink-2">
            {screen}
          </span>
        </div>

        <div className="mt-s-3 flex flex-wrap items-center gap-s-5">
          <div className="min-w-[220px] flex-1">
            <FrictionLabel />
            <FrictionMeter score={friction} />
          </div>
          <div>
            <FixValueLabel />
            <p
              className="counter-roll font-mono text-data-lg tabular-nums text-ink-0"
              title={metrics ? undefined : "Chorus produced no metric for this screen"}
            >
              {metrics ? metrics.fixValue.toFixed(3) : "—"}
            </p>
          </div>
        </div>

        {/* App Flow §8 — the Observed fact, in one sentence. This is the
            explanation the classifier wrote from a browser measurement; it is
            never generated here. */}
        <p className="mt-s-3 text-body-sm text-ink-1">{finding.explanation}</p>

        <div className="mt-s-3 flex items-center gap-s-3">
          <button
            type="button"
            onClick={onEvidence}
            disabled={!finding.evidenceBundle.screenshotPath}
            className="rounded-md border border-rule-strong px-s-3 py-1 font-sans text-body-sm text-ink-0 transition-colors duration-fast ease-out hover:bg-shoal disabled:border-rule disabled:text-ink-2"
          >
            {finding.evidenceBundle.screenshotPath ? "Evidence" : "No screenshot captured"}
          </button>
        </div>
      </div>

      {finding.evidenceBundle.screenshotPath ? (
        <button
          type="button"
          onClick={onEvidence}
          className="hidden h-[74px] w-[118px] shrink-0 overflow-hidden rounded-sm border border-rule transition-colors duration-fast ease-out hover:border-rule-strong sm:block"
          aria-label={`Open the screenshot of ${screen}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={finding.evidenceBundle.screenshotPath}
            alt={`Screenshot of ${screen}, the screen this finding was measured on`}
            className="h-full w-full object-cover object-top"
          />
        </button>
      ) : null}
    </article>
  );
}

function FrictionLabel() {
  return (
    <p className="mb-1 font-cond text-label font-semibold uppercase text-ink-2">Friction</p>
  );
}

function FixValueLabel() {
  return (
    <p className="mb-1 font-cond text-label font-semibold uppercase text-ink-2">Fix value</p>
  );
}

/**
 * App Flow §8 — "evidence → Lightbox: full screenshot, the measurement in plain
 * language, the metrics that fired the rule."
 */
function EvidenceLightbox({
  finding,
  node,
  onClose,
}: {
  finding: Finding;
  node: AtlasNode | undefined;
  onClose: () => void;
}) {
  const metrics = node?.metrics ?? null;
  const screen = node ? screenNameOf(node) : finding.stateId;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-abyss/85 p-s-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Evidence for ${finding.title}`}
      onClick={onClose}
    >
      <div
        className="surface-raised max-h-full w-full max-w-[900px] overflow-auto rounded-lg p-s-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-s-4">
          <div>
            <h2 className="font-sans text-h2 font-semibold text-ink-0">{finding.title}</h2>
            <p className="mt-1 font-cond text-label font-semibold uppercase text-ink-2">
              {screen} · {finding.signature}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="rounded-md border border-rule-strong px-s-3 py-1 text-body-sm text-ink-0 hover:bg-shelf"
          >
            Close
          </button>
        </div>

        <p className="mt-s-4 text-body text-ink-1">{finding.explanation}</p>

        {metrics ? (
          <dl className="mt-s-4 grid grid-cols-2 gap-s-3 sm:grid-cols-4">
            <Metric label="Friction" value={metrics.frictionScore.toFixed(1)} />
            <Metric label="Fix value" value={metrics.fixValue.toFixed(3)} />
            <Metric label="Dropout" value={metrics.dropout.toFixed(3)} />
            <Metric label="Dead click" value={metrics.deadClick.toFixed(3)} />
            <Metric label="Blocked" value={metrics.blocked.toFixed(3)} />
            <Metric label="Loop" value={metrics.loop.toFixed(3)} />
            <Metric label="Hesitation" value={metrics.hesitation.toFixed(3)} />
            <Metric label="Backtrack" value={metrics.backtrack.toFixed(3)} />
          </dl>
        ) : (
          <p className="mt-s-4 text-body-sm text-ink-2">
            No simulation metrics were produced for this screen, so none are shown.
          </p>
        )}

        <div className="mt-s-4 flex items-center gap-s-3">
          <ProvenanceBadge provenance={metrics ? finding.provenance : "predicted"} />
          <span className="text-body-sm text-ink-2">
            {metrics
              ? "Measured in a real browser during the crawl."
              : "No supporting measurement for the numbers on this screen."}
          </span>
        </div>

        {finding.evidenceBundle.screenshotPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={finding.evidenceBundle.screenshotPath}
            alt={`Full screenshot of ${screen}. Password and secret fields are masked before capture.`}
            className="mt-s-4 w-full rounded-md border border-rule"
          />
        ) : null}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-cond text-label font-semibold uppercase text-ink-2">{label}</dt>
      <dd className="font-mono text-data-lg tabular-nums text-ink-0">{value}</dd>
    </div>
  );
}

/** App Flow §8 — "Bias disclosure: one line, always present at the foot." */
function BiasDisclosure() {
  return (
    <footer className="mt-s-6 border-t border-rule pt-s-4">
      <p className="text-body-sm text-ink-2">
        Synthetic personas encode model priors, not lived experience. Treat findings as
        hypotheses to prioritise, not proof.
      </p>
    </footer>
  );
}

/** App Flow §8 — "Empty: never a blank page." */
function ZeroState({ run, stateCount }: { run: RunSummary; stateCount: number }) {
  const finished = run.status === "DONE" || run.status === "DEGRADED";
  return (
    <div className="flex-1 py-s-7">
      <div className={COLUMN}>
        <h1 className="font-sans text-h1 font-semibold text-ink-0">
          {finished ? "No findings above threshold." : "No findings yet."}
        </h1>
        <p className="mt-s-2 text-body text-ink-1">
          {finished
            ? stateCount === 1
              ? "The crawl reached 1 screen and it cleared every detection rule."
              : `The crawl reached ${stateCount} screens and every one of them cleared the detection rules.`
            : `This run is at stage ${run.stage}. Findings appear once analysis completes.`}
        </p>
        <BiasDisclosure />
      </div>
    </div>
  );
}

/**
 * §4 copy rules — "Errors say what happened and what to do next, and never
 * apologise." No stack trace reaches this surface.
 */
function FailureState({
  message,
  kind,
  onRetry,
}: {
  message: string;
  kind: FailureKind;
  onRetry: () => void;
}) {
  return (
    <div className="flex-1 py-s-7">
      <div className={COLUMN}>
        <h1 className="font-sans text-h1 font-semibold text-ink-0">
          Findings could not be loaded.
        </h1>
        <p className="mt-s-2 text-body text-ink-1">{message}</p>
        <p className="mt-s-2 text-body-sm text-ink-2">
          {kind === "not-found" ? (
            <>
              Check the run id in the address bar, or start a new survey from the{" "}
              <a href="/" className="text-ink-1 underline underline-offset-2">
                launchpad
              </a>
              .
            </>
          ) : (
            <>
              The engine runs on port 4000. Start it with{" "}
              <span className="font-mono text-data">pnpm dev:engine</span>, then try again.
            </>
          )}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-s-4 h-9 rounded-md bg-marker px-s-4 font-sans text-body font-medium text-deep transition-[filter] duration-instant ease-out hover:brightness-110"
        >
          Try again
        </button>
        <BiasDisclosure />
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex-1 py-s-6">
      <div className={COLUMN}>
        <div className="h-6 w-40 rounded-sm bg-shelf" />
        {/* Skeletons, not a spinner (§2). */}
        <div className="mt-s-5 flex flex-col gap-s-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="surface h-[150px] rounded-md" />
          ))}
        </div>
        <p className="sr-only" role="status">
          Loading findings.
        </p>
      </div>
    </div>
  );
}

/**
 * The screen a finding sits on. Taken from the crawled state, never from the
 * finding's own text: `AppState.title` is the page's own <title>, and the
 * pathname disambiguates two states that share it — Meridian's /webhook screen
 * and the modal above it have identical titles.
 */
function screenNameOf(node: AtlasNode): string {
  let pathname = "";
  try {
    pathname = new URL(node.url).pathname;
  } catch {
    pathname = node.url;
  }
  const title = node.title?.trim();
  return title ? `${title} · ${pathname}` : pathname;
}
