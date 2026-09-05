/// <reference lib="dom" />
import type { Page } from "playwright";
import type { A11yNode } from "@dry-run/core";
import {
  ERROR_TEXT_PATTERN,
  WCAG_AA_NORMAL_TEXT,
  isCtaVerb,
  jargonScoreForNames,
} from "@dry-run/core";

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rl, gl, bl] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseRgb(value: string): [number, number, number] | null {
  const match = value.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

async function primaryCtaContrast(
  page: Page,
  cta: A11yNode,
): Promise<{ ratio: number; low: boolean } | null> {
  const locator = page.getByRole(cta.role as "button", { name: cta.name, exact: true }).nth(cta.ordinal);
  const colors = await locator
    .evaluate((el) => {
      let bgEl: Element | null = el;
      let bg = "";
      for (let i = 0; i < 6 && bgEl; i++) {
        bg = getComputedStyle(bgEl).backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") break;
        bgEl = bgEl.parentElement;
      }
      return { fg: getComputedStyle(el).color, bg: bg || "rgb(255, 255, 255)" };
    })
    .catch(() => null);
  if (!colors) return null;

  const fg = parseRgb(colors.fg);
  const bg = parseRgb(colors.bg);
  if (!fg || !bg) return null;

  const ratio = Math.round(contrastRatio(fg, bg) * 100) / 100;
  return { ratio, low: ratio < 4.5 };
}

/**
 * CR-12 · TRD §5.2.4 — "`competingCtas` (≥2 same-styled primary-verb buttons in
 * one landmark)". Blocks D2.
 *
 * Both halves are required. Primary-verb alone would flag every form with a
 * submit button next to a "Back"; same-styled alone would flag a toolbar of
 * identical icon buttons. Together they describe the actual failure: two
 * controls that look equally like *the* way forward, so the operator cannot
 * tell which one is.
 *
 * Prominence is read from computed style rather than class names — a class is a
 * CSS detail (§6.1) and tells us nothing about a target app we did not write.
 */
async function competingCtas(
  page: Page,
  nodes: A11yNode[],
): Promise<{ competing: boolean; names: string[] }> {
  const candidates = nodes.filter(
    (n) => n.role === "button" && n.name.trim().length > 0 && isCtaVerb(n.name),
  );
  if (candidates.length < 2) return { competing: false, names: [] };

  // landmark → style signature → button names
  const byLandmark = new Map<string, Map<string, string[]>>();

  for (const node of candidates) {
    const style = await page
      .getByRole("button", { name: node.name, exact: true })
      .nth(node.ordinal)
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return `${s.backgroundColor}|${s.color}|${s.fontSize}|${s.fontWeight}|${s.borderStyle}`;
      })
      .catch(() => null);
    if (!style) continue;

    // A transparent background is a text/link-style control, not a primary
    // call to action — two of those competing is a different (milder) problem.
    if (style.startsWith("rgba(0, 0, 0, 0)") || style.startsWith("transparent")) {
      continue;
    }

    const landmark = node.landmark ?? "(root)";
    const styles = byLandmark.get(landmark) ?? new Map<string, string[]>();
    styles.set(style, [...(styles.get(style) ?? []), node.name]);
    byLandmark.set(landmark, styles);
  }

  for (const styles of byLandmark.values()) {
    for (const names of styles.values()) {
      if (names.length >= 2) return { competing: true, names };
    }
  }
  return { competing: false, names: [] };
}

/**
 * CR-12 · TRD §5.2.4 — "`errorTextContrast` (any node with role `alert` or a
 * name matching /invalid|error|must|required/)" plus `hasAriaLive`. Blocks D3.
 *
 * Also reports whether the error text reaches the accessibility tree at all.
 * That is the stronger Observed fact: a 1.9:1 contrast ratio is bad for a
 * sighted user, but text that never enters the a11y tree and sits under no
 * live region simply *does not exist* for a screen-reader persona — the error
 * is not hard to read, it is unannounced.
 */
async function errorTextSignals(page: Page, nodes: A11yNode[]) {
  const found = await page
    .evaluate((source) => {
      // No named inner functions in here. esbuild's keepNames wraps every
      // named function in a `__name()` helper, Playwright serialises this
      // callback with Function.toString() and evals it in the page, and
      // `__name` does not exist there — the whole evaluate throws
      // ReferenceError. Keep every helper inline.
      const pattern = new RegExp(source, "i");

      // Array.from, not spread: this tsconfig has `dom` but not `dom.iterable`,
      // so a NodeList is not typed as iterable here.
      const leaves = Array.from(document.querySelectorAll("body *")).filter(
        (el) => el.children.length === 0 && (el.textContent ?? "").trim().length > 0,
      );
      const el = leaves.find((candidate) => {
        const r = candidate.getBoundingClientRect();
        const cs = getComputedStyle(candidate);
        const visible =
          r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
        return (
          visible &&
          (candidate.getAttribute("role") === "alert" ||
            pattern.test((candidate.textContent ?? "").trim()))
        );
      });

      const hasAriaLive =
        document.querySelector("[aria-live], [role=alert], [role=status]") !== null;
      if (!el) return { text: null as string | null, fg: null, bg: null, hasAriaLive };

      let bgEl: Element | null = el;
      let bg = "";
      for (let i = 0; i < 6 && bgEl; i++) {
        bg = getComputedStyle(bgEl).backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") break;
        bgEl = bgEl.parentElement;
      }
      return {
        text: (el.textContent ?? "").trim(),
        fg: getComputedStyle(el).color,
        bg: bg || "rgb(255, 255, 255)",
        hasAriaLive,
      };
    }, ERROR_TEXT_PATTERN.source)
    .catch(() => null);

  if (!found || !found.text) {
    // Null, not 0 — "this screen showed no error text" and "the error text
    // measured 0 contrast" must never look the same to the classifier.
    return {
      errorTextContrast: null,
      errorTextLowContrast: false,
      errorTextInA11yTree: null,
      hasAriaLive: found?.hasAriaLive ?? false,
    };
  }

  const fg = found.fg ? parseRgb(found.fg) : null;
  const bg = found.bg ? parseRgb(found.bg) : null;
  const ratio = fg && bg ? Math.round(contrastRatio(fg, bg) * 100) / 100 : null;

  // Does that same text reach the accessibility tree? Compared on the
  // *accessible name*, which is what a screen reader would announce.
  const needle = found.text.toLowerCase().slice(0, 40);
  const inTree = nodes.some((n) => n.name.toLowerCase().includes(needle));

  return {
    errorTextContrast: ratio,
    errorTextLowContrast: ratio !== null && ratio < WCAG_AA_NORMAL_TEXT,
    errorTextInA11yTree: inTree,
    hasAriaLive: found.hasAriaLive,
  };
}

export async function computeStaticSignals(
  page: Page,
  nodes: A11yNode[],
): Promise<Record<string, unknown>> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };

  const interactiveRoles = new Set(["button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox"]);
  const interactiveCount = nodes.filter((n) => interactiveRoles.has(n.role)).length;

  const offscreenControls = nodes
    .filter(
      (n) =>
        interactiveRoles.has(n.role) &&
        (n.box.x + n.box.width <= 0 ||
          n.box.x >= viewport.width ||
          n.box.y + n.box.height <= 0),
    )
    .map((n) => n.name);

  const primaryCta = nodes.find((n) => n.role === "button");
  const belowFoldPrimaryCta = primaryCta ? primaryCta.box.y > viewport.height : false;

  const contrast = primaryCta ? await primaryCtaContrast(page, primaryCta) : null;

  const cta = await competingCtas(page, nodes);
  const errorText = await errorTextSignals(page, nodes);

  // TRD §5.2.4 — "jargonScore (fraction of accessible names flagged technical
  // against a declared word list)". Computed over accessible names because a
  // name is what a persona has to act on and what a screen reader announces.
  const jargonScore = jargonScoreForNames(nodes.map((n) => n.name));

  return {
    interactiveCount,
    belowFoldPrimaryCta,
    offscreenControls,
    primaryCtaContrastRatio: contrast?.ratio ?? null,
    primaryCtaLowContrast: contrast?.low ?? false,
    competingCtas: cta.competing,
    competingCtaNames: cta.names,
    jargonScore,
    ...errorText,
    // `deadEndControl` cannot be measured here: it is a property of a state's
    // out-edges, and at the moment a state is first discovered none have been
    // explored. The cartographer fills it in as a post-crawl pass over the
    // graph (see annotateDeadEndControls).
    deadEndControl: false,
    deadEndControlNames: [] as string[],
    // The ninth signal, `medianActionLatencyMs`, is still missing: nothing
    // records per-action latency yet (the same gap that makes the
    // `slow-response` signature unreachable). Absent rather than proxied.
  };
}
