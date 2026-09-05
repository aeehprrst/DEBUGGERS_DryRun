import { frictionColor, frictionRing } from "@dry-run/core";

const INK_0 = "#EDE4D3";
const SHELF = "#10202C";
/** UI/UX §10.1 — "Body text ≥ 4.5:1 … Verified with a tool, not assumed." */
const WCAG_AA_NORMAL_TEXT = 4.5;

function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => {
    const c = Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Two brief rules collide on the low half of the ramp, and §10 wins.
 *
 * §9 says the friction numeral is ramp-coloured. §10.1 says body text must
 * clear 4.5:1. Measured against the finding card's `--chart-shelf`, the lower
 * ramp stops do not come close:
 *
 *   f-0  1.11:1   f-20 1.73:1   f-40 3.19:1   f-60 6.33:1   f-80 8.17:1   f-100 6.42:1
 *
 * A friction-1 numeral rendered in `--f-00` is invisible on the card, which
 * also defeats §3.5's whole point — the numeral exists so friction survives
 * when the colour cannot be read. So the numeral keeps the ramp colour wherever
 * it passes, and falls back to `--ink-0` (13.15:1) where it does not. No new
 * colour is introduced; both values are declared tokens.
 */
function legibleNumeralColor(ramp: string): string {
  return contrastRatio(ramp, SHELF) >= WCAG_AA_NORMAL_TEXT ? ramp : INK_0;
}

/**
 * UI/UX §9 — "Friction meter: 6px bar, --chart-abyss track, fill in ramp
 * colour, --r-full. Numeral right at data-lg, ramp-coloured."
 *
 * Colour comes from `packages/core/src/ramp.ts` and nowhere else (CLAUDE.md
 * §6.3 — one implementation, imported by React and three.js alike).
 *
 * Friction is never carried by colour alone (§3.5, §10.2). Here it is carried
 * three ways: bar length, ramp colour, and the printed numeral. The ring count
 * — the fourth encoding — belongs to the Atlas, but its value is surfaced in
 * the accessible label so the DOM equivalent is not a lesser citizen (§10.5).
 *
 * `score === null` means Chorus produced no metric for this state. It renders
 * an em dash, never a zero: a zero here would read as "measured, and calm".
 */
export default function FrictionMeter({
  score,
  className = "",
}: {
  score: number | null;
  className?: string;
}) {
  if (score === null) {
    return (
      <div className={`flex items-center gap-s-3 ${className}`}>
        <div
          className="h-1.5 flex-1 rounded-full bg-abyss ring-1 ring-inset ring-rule"
          aria-hidden="true"
        />
        <span className="font-mono text-data-lg text-ink-2 tabular-nums" title="Not measured">
          —
        </span>
      </div>
    );
  }

  const clamped = Math.min(100, Math.max(0, score));
  const color = frictionColor(clamped);

  return (
    <div
      className={`flex items-center gap-s-3 ${className}`}
      role="img"
      aria-label={`Friction ${clamped.toFixed(0)} of 100, ${frictionRing(clamped)} of 5 contour rings`}
    >
      {/* A 1px --rule ring so the track's extent is legible even when the fill
          is a near-black low-ramp colour. §10.1 wants UI elements at 3:1; the
          ring is what carries that, since the fill colour is data. */}
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-abyss ring-1 ring-inset ring-rule">
        {/* Width is a transition, not a layout animation. §6 specifies the fill
            animates on counter-roll timing. */}
        <div
          className="h-full rounded-full transition-[width] duration-deliberate ease-out"
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
      <span
        className="counter-roll w-[3.25rem] shrink-0 text-right font-mono text-data-lg tabular-nums"
        style={{ color: legibleNumeralColor(color) }}
      >
        {clamped.toFixed(0)}
      </span>
    </div>
  );
}
