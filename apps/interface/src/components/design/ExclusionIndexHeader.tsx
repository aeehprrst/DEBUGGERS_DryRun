import type { ExclusionDelta, RunExclusion } from "@dry-run/core";
import ProvenanceBadge from "./ProvenanceBadge";

/**
 * AN-07's surface. UI/UX §8.4 — *"The ExclusionIndex header is the first thing
 * on the page: `data-xl` numeral in `--marker`, the state and segment named in
 * `h2`, the Observed fact beneath in `body-sm`."*
 *
 * PRD §6.4 calls this "the single most important new number in v2", so three
 * things about it are load-bearing:
 *
 * 1. **It is Modeled, never Observed** (L6). The dropout figures underneath it
 *    are Chorus output. The graph they walked was measured in a real browser,
 *    and that does not make a simulated ratio a browser measurement — so the
 *    badge sits on the delta itself, not somewhere it can be read as decorating
 *    the Observed line below.
 * 2. **Both sample sizes are printed.** The number is a difference of two
 *    dropout rates, and on Meridian the baseline arm rests just above CH-04's
 *    minimum. A figure that shows its own n survives the question a bare figure
 *    invites; hiding it would be the more confident and less honest choice.
 * 3. **All three API states render differently.** Absent means analysis has not
 *    run; `{index: null}` means it ran and nothing was comparable; an index
 *    means there is a headline. None of them is ever a zero.
 *
 * Copy follows §4's L1 rule — "personas", never "users", and the sentence says
 * what was measured rather than what anyone felt.
 */

const REASON_TEXT: Record<string, string> = {
  "no-states-analysed": "No screens were analysed for this run, so no segment comparison exists.",
  "no-comparable-pairs":
    "No screen had both a segment and the baseline above the minimum sample, so no exclusion delta could be computed for this run.",
};

export default function ExclusionIndexHeader({
  exclusion,
  screenLabel,
  segmentDelta,
  observedFact,
}: {
  /** `null` when the run predates AN-07 or analysis has not run. */
  exclusion: RunExclusion | null | undefined;
  /** The disambiguated label for the index's state, from `screenLabels`. */
  screenLabel: string | null;
  /** That state's delta row, which carries the two sample counts. */
  segmentDelta: ExclusionDelta | undefined;
  /** A browser-verified fact about that state, or null when none exists. */
  observedFact: string | null;
}) {
  // Absent — analysis has not run. Render nothing rather than a placeholder:
  // the space stays empty instead of being filled with an invented number.
  if (!exclusion) return null;

  if (!exclusion.index) {
    return (
      <section
        className="surface mb-s-5 rounded-md p-s-4"
        aria-label="Exclusion index"
      >
        <h2 className="font-cond text-label font-semibold uppercase text-ink-2">
          Worst exclusion
        </h2>
        <p className="mt-s-2 text-body text-ink-1">
          {REASON_TEXT[exclusion.unavailableReason ?? ""] ??
            "No exclusion delta could be computed for this run."}
        </p>
        <p className="mt-s-2 text-body-sm text-ink-2">
          <span className="font-mono text-data tabular-nums">
            {exclusion.pairsComparable}
          </span>{" "}
          of{" "}
          <span className="font-mono text-data tabular-nums">
            {exclusion.pairsConsidered}
          </span>{" "}
          screen and segment pairs were comparable.
        </p>
      </section>
    );
  }

  const index = exclusion.index;
  const screen = screenLabel ?? index.stateName;
  const ratio =
    index.baselineDropout > 0 ? index.segmentDropout / index.baselineDropout : null;

  return (
    <section className="surface mb-s-5 rounded-md p-s-4" aria-label="Exclusion index">
      <h2 className="font-cond text-label font-semibold uppercase text-ink-2">
        Worst exclusion
      </h2>

      <div className="mt-s-2 flex flex-wrap items-center gap-s-4">
        {/* §8.4 — data-xl numeral in --marker. */}
        <p className="counter-roll font-mono text-data-xl font-medium tabular-nums text-marker">
          {`${index.delta >= 0 ? "+" : "−"}${Math.abs(index.delta).toFixed(3)}`}
        </p>
        {/* The badge is on the delta, not on the sentence: this number is the
            simulation's output (L6). */}
        <ProvenanceBadge provenance={index.provenance} className="badge-pop" />
      </div>

      {/* §8.4 — "the state and segment named in h2". L1: what was measured. */}
      <h3 className="mt-s-2 font-sans text-h2 font-semibold text-ink-0">
        {index.segmentLabel} personas dropped out of {screen} at{" "}
        <span className="font-mono tabular-nums">
          {index.segmentDropout.toFixed(3)}
        </span>{" "}
        against{" "}
        <span className="font-mono tabular-nums">
          {index.baselineDropout.toFixed(3)}
        </span>{" "}
        for the confident-desktop baseline
        {ratio !== null ? (
          <>
            {" — "}
            <span className="font-mono tabular-nums">{ratio.toFixed(1)}×</span> the
            baseline rate
          </>
        ) : null}
        .
      </h3>

      {/* Both arms of the subtraction, sized. Plex Mono, tabular. */}
      <p className="mt-s-2 font-mono text-data tabular-nums text-ink-1">
        {segmentDelta ? (
          <>
            n={segmentDelta.segmentPersonas} {index.segmentLabel.toLowerCase()} · n=
            {segmentDelta.baselinePersonas} baseline
          </>
        ) : (
          <span className="text-ink-2">
            sample sizes unavailable for this screen
          </span>
        )}
      </p>

      {/* §8.4 — "the Observed fact beneath in body-sm". Omitted entirely when
          the state carries no browser-verified finding, rather than padded with
          a restatement of the modeled number above it. */}
      {observedFact ? (
        <p className="mt-s-2 text-body-sm text-ink-1">{observedFact}</p>
      ) : null}
    </section>
  );
}
