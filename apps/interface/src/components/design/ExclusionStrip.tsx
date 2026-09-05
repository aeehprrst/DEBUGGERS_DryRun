import type { ExclusionDelta } from "@dry-run/core";
import { SEGMENTS } from "@dry-run/core";

/**
 * UI/UX §9, "Exclusion strip" — *"One 4px row per segment, 6px gap. Baseline
 * dropout marked with a 1px `--ink-2` tick; the bar extends from the tick,
 * `--flow-dim` for ≤0 and `--marker` for >0. Worst segment named in words
 * beside it. **Never colour alone — the name is always printed.**"*
 *
 * The axis is ExclusionDelta (PRD §6.4), so the tick is where the delta is
 * zero — the point at which a segment does exactly as well as the
 * confident-desktop baseline. A bar to the right of the tick is a segment the
 * screen is disproportionately harder for.
 *
 * **An unknown segment is not a zero.** CH-04 withholds a segment's metrics
 * below its minimum sample, and AN-07 nulls the delta when either operand is
 * missing. A null rendered as a zero-length `--flow-dim` bar would say "this
 * group was fine" when what happened is that we could not tell — the exact
 * substitution CLAUDE.md §6.5 forbids. So a null gets no bar at all, a hollow
 * dashed track, an em dash where the numeral goes, and the reason in words.
 *
 * Three encodings on every row, per §10.2: the printed segment name, the
 * numeral, and the bar. Colour is never carrying anything on its own.
 */

/** §6.4's reasons, in words an operator can act on. */
const REASON_TEXT: Record<string, string> = {
  "segment-sample-too-thin": "segment sample too thin",
  "baseline-sample-too-thin": "baseline sample too thin",
  "both-samples-too-thin": "samples too thin",
  "segment-not-recorded": "segment not recorded",
  "baseline-not-recorded": "baseline not recorded",
};

function reasonWords(delta: ExclusionDelta): string {
  return delta.unavailableReason
    ? (REASON_TEXT[delta.unavailableReason] ?? delta.unavailableReason)
    : "not comparable";
}

function labelFor(segment: string): string {
  return SEGMENTS.find((s) => s.id === segment)?.label ?? segment;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(3)}`;
}

export default function ExclusionStrip({
  exclusion,
}: {
  /** This state's deltas, keyed by segment id. Undefined on a pre-AN-07 run. */
  exclusion: Record<string, ExclusionDelta> | undefined;
}) {
  if (!exclusion) return null;

  // The baseline is the tick, not a row: comparing the reference to itself is
  // always exactly zero and would read as a measured result.
  const rows = SEGMENTS.map((s) => exclusion[s.id]).filter(
    (d): d is ExclusionDelta => d !== undefined && !d.isBaseline,
  );
  if (rows.length === 0) return null;

  const known = rows.filter(
    (d): d is ExclusionDelta & { delta: number } => d.delta !== null,
  );

  // A diverging axis over the deltas actually on this card, with zero always
  // inside it so the tick has a place to stand. Per-card rather than global:
  // the strip answers "which segment is worst *here*", and a run-wide scale
  // would flatten every card that is not the run's worst into nothing. The
  // numerals are printed beside the bars, so the bar length is a comparison
  // aid and never the only reading of the number.
  const maxAbs = known.reduce((m, d) => Math.max(m, Math.abs(d.delta)), 0);
  const min = Math.min(0, ...known.map((d) => d.delta));
  const max = Math.max(0, ...known.map((d) => d.delta));
  const span = max - min;
  const zeroPct = span > 0 ? ((0 - min) / span) * 100 : 0;

  const worst = known.reduce<(ExclusionDelta & { delta: number }) | null>(
    (best, d) => (best === null || d.delta > best.delta ? d : best),
    null,
  );

  return (
    <div className="mt-s-3">
      <p className="mb-s-2 font-cond text-label font-semibold uppercase text-ink-2">
        Exclusion vs baseline
      </p>

      {/* 4px rows, 6px gaps — §9. Neither is on the space scale (§5 starts at
          4px and steps to 8px), so both are the brief's own literal values. */}
      <ul className="flex flex-col" style={{ rowGap: "6px" }}>
        {rows.map((row) => {
          const isUnknown = row.delta === null;
          const positive = !isUnknown && row.delta! > 0;
          const widthPct =
            isUnknown || maxAbs === 0 || span === 0
              ? 0
              : (Math.abs(row.delta!) / span) * 100;

          return (
            <li key={row.segment} className="flex items-center gap-s-3">
              <span className="w-[132px] shrink-0 truncate font-cond text-label font-semibold uppercase text-ink-1">
                {labelFor(row.segment)}
              </span>

              <span className="relative h-[4px] flex-1" aria-hidden="true">
                {isUnknown ? (
                  /* Hollow and dashed: visibly not a measurement. A filled
                     track at zero length is indistinguishable from a measured
                     zero, which is the whole point of this branch. */
                  <span className="absolute inset-0 rounded-full border border-dashed border-ink-2/60" />
                ) : (
                  <>
                    <span className="absolute inset-0 rounded-full bg-abyss" />
                    <span
                      className={positive ? "absolute bg-marker" : "absolute bg-flow-dim"}
                      style={{
                        height: "4px",
                        top: 0,
                        width: `${widthPct}%`,
                        left: positive ? `${zeroPct}%` : `${zeroPct - widthPct}%`,
                      }}
                    />
                    {/* §9 — the baseline tick, 1px, --ink-2. */}
                    <span
                      className="absolute top-[-2px] bg-ink-2"
                      style={{ height: "8px", width: "1px", left: `${zeroPct}%` }}
                    />
                  </>
                )}
              </span>

              {isUnknown ? (
                <span className="flex shrink-0 items-baseline gap-s-2">
                  <span
                    className="font-mono text-data tabular-nums text-ink-2"
                    title="No delta could be computed for this segment"
                  >
                    —
                  </span>
                  <span className="text-body-sm text-ink-2">
                    {reasonWords(row)} (n={row.segmentPersonas})
                  </span>
                </span>
              ) : (
                <span className="flex shrink-0 items-baseline gap-s-2">
                  <span
                    className={`font-mono text-data tabular-nums ${
                      positive ? "text-ink-0" : "text-ink-2"
                    }`}
                  >
                    {signed(row.delta!)}
                  </span>
                  <span className="text-body-sm text-ink-2">n={row.segmentPersonas}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {/* §9 — "Worst segment named in words beside it." When nothing is
          comparable the strip says so rather than leaving four dashes to be
          read as four zeroes. */}
      <p className="mt-s-2 text-body-sm text-ink-2">
        {worst ? (
          <>
            Worst on this screen:{" "}
            <span className="text-ink-1">{labelFor(worst.segment)}</span>, dropout{" "}
            <span className="font-mono text-data tabular-nums text-ink-1">
              {signed(worst.delta)}
            </span>{" "}
            against the confident-desktop baseline.
          </>
        ) : (
          "No segment could be compared against the baseline on this screen — the samples that reached it were too thin to measure."
        )}
      </p>
    </div>
  );
}
