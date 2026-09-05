import { BASELINE_SEGMENT, SEGMENTS, segmentById } from "./segments.js";
import type {
  AffectedSegment,
  ExclusionDelta,
  ExclusionUnavailableReason,
  RunExclusion,
  SegmentStateMetrics,
} from "./types.js";

/**
 * AN-07 — ExclusionDelta and ExclusionIndex (PRD §6.4).
 *
 * ```
 * ExclusionDelta(s, g) = Dropout(s | g) − Dropout(s | baseline)
 * ExclusionIndex       = max over (s, g) of ExclusionDelta(s, g)
 * ```
 *
 * **The null rule is the whole module.** CH-04 returns `metrics: null` for any
 * segment it saw fewer than the minimum number of personas from, so either
 * operand of that subtraction can be missing. When one is:
 *
 * - the delta is `null`, never `0`;
 * - the overall population dropout is **not** substituted for a missing
 *   baseline — the baseline is one specific segment (PRD §6.4) and the whole
 *   population is a different quantity;
 * - a null baseline nulls *every* segment on that state, because there is
 *   nothing to measure against, not because exclusion happens to be large.
 *
 * Getting this wrong puts a fabricated number in the product's headline, which
 * is the specific failure CLAUDE.md §6.5 exists to prevent.
 *
 * Everything here is `modeled` (L6). The dropout figures are Chorus output; the
 * graph underneath them was measured in a real browser, but a simulated ratio
 * over a real graph is still a simulated ratio.
 */

/** A segment's dropout, or null when CH-04 withheld it. Never a zero stand-in. */
function dropoutOf(record: SegmentStateMetrics | undefined): number | null {
  if (!record) return null;
  return record.metrics ? record.metrics.dropout : null;
}

function personasOf(record: SegmentStateMetrics | undefined): number {
  return record?.personas ?? 0;
}

/**
 * Which operand was missing. `undefined` (no record at all — a pre-CH-04 run)
 * is reported distinctly from a recorded-but-thin sample, because the first is
 * a pipeline gap and the second is a real property of this run's population.
 */
function unavailableReasonFor(
  segmentRecord: SegmentStateMetrics | undefined,
  baselineRecord: SegmentStateMetrics | undefined,
): ExclusionUnavailableReason | null {
  const segmentMissing = dropoutOf(segmentRecord) === null;
  const baselineMissing = dropoutOf(baselineRecord) === null;
  if (!segmentMissing && !baselineMissing) return null;

  if (!segmentRecord) return "segment-not-recorded";
  if (!baselineRecord) return "baseline-not-recorded";
  if (segmentMissing && baselineMissing) return "both-samples-too-thin";
  return segmentMissing ? "segment-sample-too-thin" : "baseline-sample-too-thin";
}

/**
 * Every segment's delta for one state, keyed by segment id, in `SEGMENTS`
 * order. The baseline gets a row too — its delta against itself is 0 by
 * definition — flagged `isBaseline` so the index can drop it without
 * string-matching. It is null like everything else when the baseline sample was
 * too thin: a reference that was not measured cannot be compared to itself.
 */
export function computeExclusionDeltas(
  stateId: string,
  segments: Record<string, SegmentStateMetrics> | undefined,
): Record<string, ExclusionDelta> {
  const baselineRecord = segments?.[BASELINE_SEGMENT];
  const baselineDropout = dropoutOf(baselineRecord);
  const baselinePersonas = personasOf(baselineRecord);

  const out: Record<string, ExclusionDelta> = {};
  for (const segment of SEGMENTS) {
    const record = segments?.[segment.id];
    const segmentDropout = dropoutOf(record);

    // The null rule, in one expression: both operands or nothing.
    const delta =
      segmentDropout !== null && baselineDropout !== null
        ? segmentDropout - baselineDropout
        : null;

    out[segment.id] = {
      stateId,
      segment: segment.id,
      delta,
      segmentDropout,
      baselineDropout,
      segmentPersonas: personasOf(record),
      baselinePersonas,
      unavailableReason: unavailableReasonFor(record, baselineRecord),
      isBaseline: segment.id === BASELINE_SEGMENT,
      provenance: "modeled",
    };
  }
  return out;
}

/** The shape `screenNameFor` reads. Any `AppState` satisfies it. */
export type NameableState = {
  id?: string;
  title?: string;
  url: string;
  a11yTree?: readonly { role: string; name: string }[];
};

/**
 * A screen name a person can read, for PRD §6.4's headline — *"Worst exclusion:
 * Configure Webhook, screen-reader, +0.62."*
 *
 * `AppState.title` alone is not enough: it is the page's own `<title>`, and
 * Meridian's is the literal string "Meridian" on all seven states, so a label
 * built from it names nothing. The pathname helps, but Meridian's `/webhook`
 * page and the modal above it share that too — and two rows naming the same
 * screen with different numbers reads as a bug rather than as two states.
 *
 * So the state's primary heading is appended, but **only when it adds
 * information**: a heading that merely repeats the title or restates the
 * pathname makes the label longer without making it more distinct.
 *
 * Shortcut, named: CR-04's fingerprint uses "first h1, else first heading",
 * but `A11yNode` does not persist a heading's `level` — `aria.ts` reads the
 * level, folds it into the hash and discards it. So this takes the first
 * heading in document order, which agrees with the fingerprint's choice on
 * every state that leads with its h1. Persisting `level` on `A11yNode` is what
 * would replace this, and that is a schema plus crawler change.
 *
 * Collisions that survive all of the above are resolved by `screenLabels`,
 * which is the only caller that can see the whole set.
 */
export function screenNameFor(state: NameableState): string {
  const pathname = pathnameOf(state.url);
  const title = state.title?.trim();
  const base = title ? `${title} · ${pathname}` : pathname;

  const heading = primaryHeadingOf(state);
  return heading && headingAddsInformation(heading, title, pathname)
    ? `${base} · ${heading}`
    : base;
}

function primaryHeadingOf(state: NameableState): string | null {
  const heading = state.a11yTree?.find((n) => n.role === "heading");
  const name = heading?.name.trim();
  return name && name.length > 0 ? name : null;
}

/**
 * A heading earns its place only if it is not already being said. Compared
 * case- and separator-insensitively, so "Connect a data source" is recognised
 * as a restatement of `/connect-a-data-source` and of the title that repeats
 * it, rather than being appended to itself.
 */
function headingAddsInformation(
  heading: string,
  title: string | undefined,
  pathname: string,
): boolean {
  const flatten = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const flat = flatten(heading);
  if (flat.length === 0) return false;
  if (title && flatten(title) === flat) return false;
  return flatten(pathname) !== flat;
}

/**
 * Labels for a whole set of states, guaranteed distinct.
 *
 * Two states rendered with an identical label is a correctness bug in a view
 * whose entire job is attributing numbers to screens — Meridian's `/webhook`
 * page and its modal share a title, a pathname *and* a primary heading, so
 * `screenNameFor` alone cannot separate them. Where that happens the state id
 * is appended: it is short, stable across a re-run, and already the vocabulary
 * the evaluation harness prints, so an operator comparing the two surfaces sees
 * the same token in both.
 *
 * The suffix is added only to the states that actually collide, so a graph with
 * no ambiguity carries no ids at all.
 */
export function screenLabels(
  states: readonly NameableState[],
): Map<string, string> {
  const counts = new Map<string, number>();
  for (const state of states) {
    const base = screenNameFor(state);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }

  const out = new Map<string, string>();
  for (const state of states) {
    const base = screenNameFor(state);
    const id = state.id ?? base;
    out.set(id, (counts.get(base) ?? 0) > 1 ? `${base} · ${id}` : base);
  }
  return out;
}

/**
 * The path part of a url, by string surgery rather than `new URL()`.
 *
 * `packages/core` compiles with no DOM and no Node lib (§9 — it imports
 * nothing and does no I/O), so the `URL` global is genuinely not in scope here
 * rather than merely unfashionable. A malformed or relative url falls through
 * to itself: a worse name still beats an unnamed headline.
 */
function pathnameOf(url: string): string {
  const afterScheme = url.indexOf("://");
  const start = afterScheme === -1 ? 0 : url.indexOf("/", afterScheme + 3);
  if (start === -1) return "/";
  const rest = url.slice(start);
  const end = Math.min(
    rest.indexOf("?") === -1 ? rest.length : rest.indexOf("?"),
    rest.indexOf("#") === -1 ? rest.length : rest.indexOf("#"),
  );
  return rest.slice(0, end) || "/";
}

export type ExclusionStateInput = {
  stateId: string;
  /** Human-readable screen name for the headline. */
  stateName: string;
  deltas: Record<string, ExclusionDelta>;
};

/**
 * The largest non-null delta across a run, or null with a reason.
 *
 * The baseline is excluded from the candidates: its delta is 0 by construction,
 * so on a run where every real segment was too thin to compare, leaving it in
 * would let the reference win its own comparison and report "worst exclusion:
 * confident-desktop, +0.00" — a number that is arithmetically true and
 * completely meaningless.
 *
 * `max` is taken over non-null deltas of any sign, exactly as PRD §6.4 states.
 * If every comparable pair is negative the maximum is negative, and that is the
 * honest answer — no screen was harder for any segment than for the baseline —
 * rather than a null dressed up as an absence of data.
 *
 * Deterministic: ties break by state id then `SEGMENTS` order, so the same
 * metrics always yield the same headline (CLAUDE.md §6.7).
 */
export function computeExclusionIndex(
  states: readonly ExclusionStateInput[],
): RunExclusion {
  if (states.length === 0) {
    return {
      index: null,
      unavailableReason: "no-states-analysed",
      pairsConsidered: 0,
      pairsComparable: 0,
      provenance: "modeled",
    };
  }

  let pairsConsidered = 0;
  let pairsComparable = 0;
  let best: { state: ExclusionStateInput; delta: ExclusionDelta } | null = null;

  const ordered = [...states].sort((a, b) => a.stateId.localeCompare(b.stateId));
  for (const state of ordered) {
    for (const segment of SEGMENTS) {
      const delta = state.deltas[segment.id];
      if (!delta || delta.isBaseline) continue;
      pairsConsidered += 1;
      if (delta.delta === null) continue;
      pairsComparable += 1;
      if (best === null || delta.delta > best.delta.delta!) {
        best = { state, delta };
      }
    }
  }

  if (!best) {
    return {
      index: null,
      unavailableReason: "no-comparable-pairs",
      pairsConsidered,
      pairsComparable,
      provenance: "modeled",
    };
  }

  return {
    index: {
      stateId: best.delta.stateId,
      stateName: best.state.stateName,
      segment: best.delta.segment,
      segmentLabel: segmentById(best.delta.segment)?.label ?? best.delta.segment,
      delta: best.delta.delta!,
      // Non-null by construction: a delta only exists when both operands did.
      segmentDropout: best.delta.segmentDropout!,
      baselineDropout: best.delta.baselineDropout!,
      provenance: "modeled",
    },
    unavailableReason: null,
    pairsConsidered,
    pairsComparable,
  provenance: "modeled",
  };
}

/**
 * AN-06's segments half, for one finding's state.
 *
 * Positive non-null deltas first, largest first — a positive delta means the
 * screen is disproportionately harder for that segment (PRD §6.4), and there is
 * no threshold: any positive amount qualifies.
 *
 * Segments whose delta is null follow, marked `unknown`. They are deliberately
 * **not** omitted and deliberately not called unaffected: "we could not tell"
 * and "this group was fine" are opposite claims, and silently dropping the
 * unmeasurable ones would make every finding look better evidenced than it is.
 *
 * Segments with a measured delta of zero or less are absent, because that
 * question *was* answered — they were not disproportionately affected. The
 * baseline is absent too: it is the reference, not an affected group.
 */
export function affectedSegmentsFor(
  deltas: Record<string, ExclusionDelta>,
): AffectedSegment[] {
  const describe = (delta: ExclusionDelta): AffectedSegment => ({
    segment: delta.segment,
    label: segmentById(delta.segment)?.label ?? delta.segment,
    delta: delta.delta,
    segmentDropout: delta.segmentDropout,
    baselineDropout: delta.baselineDropout,
    status: delta.delta === null ? "unknown" : "affected",
    unavailableReason: delta.unavailableReason,
  });

  const rows = SEGMENTS.map((s) => deltas[s.id]).filter(
    (d): d is ExclusionDelta => d !== undefined && !d.isBaseline,
  );

  const affected = rows
    .filter((d) => d.delta !== null && d.delta > 0)
    .sort((a, b) => b.delta! - a.delta! || a.segment.localeCompare(b.segment))
    .map(describe);

  const unknown = rows.filter((d) => d.delta === null).map(describe);

  return [...affected, ...unknown];
}
