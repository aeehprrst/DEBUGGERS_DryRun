/**
 * The friction ramp — UI/UX §3.5 and §12.
 *
 * One implementation, imported by React and by three.js. CLAUDE.md §6.3: "Two
 * implementations is a bug." The prototype had zero, which the brief calls out
 * as worse than two that drift — friction had no colour at all.
 *
 * The ramp is bathymetric and colourblind-safe: deep water → shoal → sand →
 * marker. It never passes through red-vs-green, and lightness rises
 * monotonically so it survives greyscale, protanopia, deuteranopia and a bad
 * projector (asserted in ramp.test.ts, not assumed).
 *
 * Colour is never the only encoding (§3.5 / §10.2). Friction is carried
 * redundantly by ramp colour + node elevation + contour ring count + the
 * printed numeral, which is why all three of the functions below exist rather
 * than just the colour one.
 */

/** UI/UX §3.5, verbatim. Six stops at 0, 20, 40, 60, 80, 100. */
export const FRICTION_STOPS = [
  "#12293A", // 0–20   calm
  "#1E4A5C",
  "#3E7484",
  "#96A48F", // shoal
  "#D8B06A", // sand
  "#FF7A45", // hot — same value as --marker
] as const;

/** UI/UX §7.2 — `frictionElevation` = score/100 × 6 world units. */
const ELEVATION_UNITS = 6;
/** UI/UX §7.2 — `frictionRing` = floor(score / 20), 0–5. */
const RING_BAND = 20;

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, score));
}

// ---------- colour space ----------
// The brief is explicit: "Interpolate in OKLab, not sRGB, or the midtones go
// muddy." sRGB interpolation between #3E7484 and #96A48F in particular goes
// grey through the middle, which is exactly where the shoal band lives.

type Triplet = [number, number, number];

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

function hexToRgb(hex: string): Triplet {
  const h = hex.replace("#", "");
  return [
    Number.parseInt(h.slice(0, 2), 16) / 255,
    Number.parseInt(h.slice(2, 4), 16) / 255,
    Number.parseInt(h.slice(4, 6), 16) / 255,
  ];
}

function rgbToHex([r, g, b]: Triplet): string {
  const channel = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

/** Björn Ottosson's OKLab, forward transform. */
export function rgbToOklab(rgb: Triplet): Triplet {
  const [r, g, b] = rgb.map(srgbToLinear) as Triplet;

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab, inverse transform. */
export function oklabToRgb([L, A, B]: Triplet): Triplet {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;

  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const STOPS_OKLAB: Triplet[] = FRICTION_STOPS.map((hex) => rgbToOklab(hexToRgb(hex)));

/**
 * Friction score → ramp colour, interpolated in OKLab.
 *
 * @param score 0–100. Out-of-range and non-finite values clamp rather than
 *   throw: this runs inside a render loop, and a NaN reaching three.js is a
 *   black screen with no error.
 */
export function frictionColor(score: number): string {
  const s = clampScore(score);
  const span = 100 / (FRICTION_STOPS.length - 1); // 20
  const index = Math.min(FRICTION_STOPS.length - 2, Math.floor(s / span));
  const t = (s - index * span) / span;

  const a = STOPS_OKLAB[index];
  const b = STOPS_OKLAB[index + 1];
  return rgbToHex(
    oklabToRgb([
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ]),
  );
}

/**
 * UI/UX §7.2 — how many contour rings this node draws. The second, redundant
 * encoding of friction: countable in greyscale, and countable by someone who
 * cannot distinguish the ramp colours at all.
 */
export function frictionRing(score: number): number {
  return Math.floor(clampScore(score) / RING_BAND);
}

/** UI/UX §7.2 — node height above the chart plane, in world units. */
export function frictionElevation(score: number): number {
  return (clampScore(score) / 100) * ELEVATION_UNITS;
}

/** OKLab L of a ramp colour. Exported so the greyscale-safety test is a real
 *  assertion about the ramp and not a restatement of the stop list. */
export function frictionLightness(score: number): number {
  return rgbToOklab(hexToRgb(frictionColor(score)))[0];
}
