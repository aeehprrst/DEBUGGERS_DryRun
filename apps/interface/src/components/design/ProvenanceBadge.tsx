import type { Provenance } from "@dry-run/core";

/**
 * UI/UX §3.7 — provenance, shape first, colour second.
 *
 * CLAUDE.md L6 makes this a never-cut item, and the brief says to build it
 * before anything that displays a number. Every rendered number in this product
 * carries one.
 *
 * Three encodings, always: glyph shape, the word, and colour. A colourblind
 * judge, a greyscale printout and a washed-out projector all still work
 * (§10.2 — "No information encoded by colour alone, anywhere").
 */
const BADGE = {
  observed: {
    glyph: "▪",
    word: "Observed",
    // §3.7: fill --marker, text --ink-0
    className: "border-marker/40 bg-marker/12 text-ink-0",
    title: "The browser measured this in a real page.",
  },
  modeled: {
    glyph: "◪",
    word: "Modeled",
    // §3.7: fill --flow-dim, text --ink-1
    className: "border-flow-dim/50 bg-flow-dim/15 text-ink-1",
    title: "The persona simulation produced this number.",
  },
  predicted: {
    glyph: "▫",
    word: "Predicted",
    // §3.7: no fill, 1px dashed, text --ink-2
    className: "border-dashed border-ink-2/60 bg-transparent text-ink-2",
    title: "Never crawled. No supporting measurement.",
  },
} as const satisfies Record<Provenance, unknown>;

export default function ProvenanceBadge({
  provenance,
  className = "",
}: {
  provenance: Provenance;
  className?: string;
}) {
  const badge = BADGE[provenance];

  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border px-2 font-cond text-label font-semibold uppercase ${badge.className} ${className}`}
      title={badge.title}
    >
      {/* aria-hidden: the glyph is a redundant visual encoding of the word that
          follows it, so a screen reader announcing "black small square
          Observed" would be reading the same fact twice. */}
      <span aria-hidden="true" className="text-[13px] leading-none">
        {badge.glyph}
      </span>
      {badge.word}
    </span>
  );
}
