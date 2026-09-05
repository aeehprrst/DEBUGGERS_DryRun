"use client";

import { useEffect, useState } from "react";

/**
 * UI/UX §9, "Replay-mode banner" — *"Full-width, `--chart-shelf`, 1px `--warn`
 * bottom border, `--warn` glyph, text in `--ink-0`. **Undismissable.**"*
 *
 * CLAUDE.md L5: the stage demo never crawls live, and the substitution is
 * disclosed openly rather than glossed over. That disclosure is this banner. It
 * carries no dismiss control by design — a replayed run is replayed on every
 * view of it, so the operator (and anyone reading over their shoulder) is told
 * on Live, on Findings and on Tour, not only while the crawl streams past.
 *
 * It names the fixture id, because "cached" without saying *which* cache is a
 * weaker claim than the one we can actually make.
 */
const POLL_MS = 1000;
const TERMINAL = ["DONE", "FAILED", "DEGRADED", "CANCELLED"];

export default function ReplayBanner({ runId }: { runId: string }) {
  const [fixtureId, setFixtureId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // `Run.replayFixtureId` is written at the crawl boundary, so a run opened
    // while it is still crawling has not recorded it yet — and this component
    // lives in the layout, which does NOT remount when `?view=` changes. A
    // single fetch on mount therefore missed the fact permanently and the
    // disclosure never appeared. So it is re-read until the answer is known:
    // a fixture id (replayed) or a terminal status with none (a real crawl).
    const poll = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}`);
        if (res.ok) {
          const run = (await res.json()) as {
            replayFixtureId?: string | null;
            status?: string;
          };
          if (cancelled) return;
          if (run.replayFixtureId) {
            setFixtureId(run.replayFixtureId);
            return; // Settled. L5's disclosure stays up for the rest of the run.
          }
          if (run.status && TERMINAL.includes(run.status)) return;
        }
      } catch {
        // A run whose replay status cannot be read renders no banner rather
        // than a guess. Claiming "live" would be the dangerous default here, so
        // nothing is claimed at all — and the poll keeps trying.
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runId]);

  if (!fixtureId) return null;

  return (
    <div
      // Full-width, --chart-shelf, 1px --warn bottom border. No dismiss.
      className="flex w-full items-center gap-s-3 border-b border-warn bg-shelf px-s-6 py-s-2"
      role="note"
    >
      {/* The glyph is a redundant encoding of the words beside it (§10.2), so
          it is hidden from assistive tech rather than read out twice. */}
      <span aria-hidden="true" className="font-mono text-data leading-none text-warn">
        ▲
      </span>
      <p className="text-body-sm text-ink-0">
        Replay mode — this run did not crawl a live target. The crawl was served
        from the cached fixture{" "}
        <span className="font-mono text-data text-ink-0">{fixtureId}</span>. Chorus,
        Analysis and Usher ran for real against it.
      </p>
    </div>
  );
}
