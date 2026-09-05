/// <reference lib="dom" />
import type { Page } from "playwright";
import type { A11yNode } from "@dry-run/core";
import {
  ERROR_TEXT_PATTERN,
  WCAG_AA_NORMAL_TEXT,
  isCtaVerb,
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
 * name matching /invalid|error|must|required/)" plus `hasAriaLive`.
 *
 * This is the passive scan: it reports whatever error-shaped text happens to be
 * on the screen as the crawler found it. On a crawl that submits valid input it
 * finds nothing, which is why it never produced a single measurement on
 * Meridian — the error was never on screen to be measured. CR-14's probe is
 * what provokes the error and takes the measurement that classifies D3; this
 * function is kept for the case where a target renders an error unprompted, and
 * it no longer admits a finding on its own (see the note at its return).
 */
async function errorTextSignals(page: Page) {
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

  // `errorTextInA11yTree` is deliberately null here, not a boolean. This
  // function has no view of the accessibility tree it could answer against:
  // parseAriaSnapshot keeps a line only if it carries a `ref`, so a paragraph's
  // text payload is dropped, and matching on accessible names would report
  // every plain-paragraph error as absent from the tree. That is a far stronger
  // claim than the evidence supports. CR-14's probe answers the question
  // properly, against the raw snapshot plus an aria-hidden check.
  //
  // This scan also no longer admits a finding on its own: `silent-validation`
  // now requires `errorTextSource`, which only the probe sets. That is
  // intentional — ERROR_TEXT_PATTERN is a weak signal, and "All fields are
  // required" rendered in grey is a form hint, not a validation failure.
  return {
    errorTextContrast: ratio,
    errorTextLowContrast: ratio !== null && ratio < WCAG_AA_NORMAL_TEXT,
    errorTextInA11yTree: null,
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

  // A control the page can be scrolled sideways to reach is not offscreen, it
  // is just off-view — so horizontal overflow only counts when the document
  // cannot scroll to it at all.
  const canScrollHorizontally = await page
    .evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    )
    .catch(() => false);

  // Offscreen means "cannot be reached", which is not the same as "does not
  // start inside the viewport". The old rule required a control to begin past
  // the edge (`box.x >= viewport.width`), so a control straddling the boundary
  // counted as on-screen no matter how little of it was reachable — Meridian's
  // modal close button sits at x=386..414 in a 390px viewport, 4px of 28
  // visible, and was missed entirely.
  //
  // The rule is the control's *centre*: if the midpoint of a control lies
  // outside the viewport, it cannot be reliably pointed at or tapped. That is
  // a geometric statement, not a tunable fraction — it introduces no threshold.
  const offscreenInteractives = nodes
    .filter((n) => {
      if (!interactiveRoles.has(n.role)) return false;
      // A zero-size box is an unrendered element, a different problem entirely.
      if (n.box.width === 0 && n.box.height === 0) return false;

      // Above the top of the document: scrolling down cannot bring it back.
      if (n.box.y + n.box.height <= 0) return true;

      if (canScrollHorizontally) return false;
      const centreX = n.box.x + n.box.width / 2;
      return centreX < 0 || centreX > viewport.width;
    })
    .map((n) => n.name);

  const primaryCta = nodes.find((n) => n.role === "button");
  const belowFoldPrimaryCta = primaryCta ? primaryCta.box.y > viewport.height : false;

  // CH-03 — `belowFoldPrimaryCta` is a single boolean about one control, which
  // is enough to raise a finding but not enough to model a walk: the simulation
  // needs to know *which* edges start below the fold so it can discount those
  // specific affordances. Same measurement, per control.
  const belowFoldInteractives = nodes
    .filter(
      (n) =>
        interactiveRoles.has(n.role) &&
        !(n.box.width === 0 && n.box.height === 0) &&
        n.box.y >= viewport.height,
    )
    .map((n) => n.name);

  // CH-03 / TRD §5.4 — "Edges not reachable in tab order get affordance × 0.5."
  //
  // Measured, not guessed: the DOM is asked which elements are focusable, and
  // those boxes are matched back to accessibility-tree nodes. Matching on
  // geometry rather than recomputing accessible names in the page — the
  // accname algorithm is subtle and we already have the browser's answer for
  // every node; reimplementing it here would be a second, worse copy.
  const tabbableBoxes = await page
    .evaluate(() => {
      // Inline helpers only — see the keepNames/`__name` note in errorTextSignals.
      const selector =
        "a[href], button, input, select, textarea, summary, [tabindex], [contenteditable=true]";
      const out: { x: number; y: number; width: number; height: number }[] = [];
      for (const el of Array.from(document.querySelectorAll(selector))) {
        const tabindex = el.getAttribute("tabindex");
        if (tabindex !== null && Number(tabindex) < 0) continue;
        if ((el as HTMLButtonElement).disabled) continue;
        if (el.getAttribute("aria-hidden") === "true") continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none") continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        out.push({
          x: r.x + window.scrollX,
          y: r.y + window.scrollY,
          width: r.width,
          height: r.height,
        });
      }
      return out;
    })
    .catch(() => null);

  // null, not [] — "the browser could not tell us" and "nothing is focusable"
  // are different facts, and the walk treats an absent list as unknown rather
  // than as a screen where every control fails the keyboard test (§6.5).
  const tabbableNames =
    tabbableBoxes === null
      ? null
      : nodes
          .filter(
            (n) =>
              interactiveRoles.has(n.role) &&
              tabbableBoxes.some(
                (b) =>
                  Math.abs(b.x - n.box.x) <= 1 &&
                  Math.abs(b.y - n.box.y) <= 1 &&
                  Math.abs(b.width - n.box.width) <= 1 &&
                  Math.abs(b.height - n.box.height) <= 1,
              ),
          )
          .map((n) => n.name);

  const contrast = primaryCta ? await primaryCtaContrast(page, primaryCta) : null;

  const cta = await competingCtas(page, nodes);
  const errorText = await errorTextSignals(page);

  // `jargonScore` is deliberately NOT computed here. Its product-vocabulary
  // exclusion needs to know which words recur across *other* states, which no
  // single-state measurement can see, so the cartographer derives it in one
  // post-crawl pass (annotateJargonScores) and writes it at state level. It is
  // viewport-independent, so it does not belong in a per-viewport record.

  return {
    interactiveCount,
    belowFoldPrimaryCta,
    belowFoldInteractives,
    tabbableNames,
    offscreenInteractives,
    primaryCtaContrastRatio: contrast?.ratio ?? null,
    primaryCtaLowContrast: contrast?.low ?? false,
    competingCtas: cta.competing,
    competingCtaNames: cta.names,
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

// ---------------------------------------------------------------------------
// CR-14 · the validation probe's measurement half.
//
// `errorTextSignals` above scans a screen as the crawler found it, and on a
// well-behaved crawl that screen has no error on it — which is why every state
// in a Meridian run reported `errorTextContrast: null`. CR-07 seeds a *valid*
// key, so the validation error never renders and D3 is unobservable.
//
// This pair is what the probe uses instead: capture the visible text before a
// deliberately-invalid submit, capture it after, and the difference IS the
// error text by construction. That holds for any phrasing in any language,
// which a word list never can.
// ---------------------------------------------------------------------------

/**
 * Every visible leaf's trimmed text, in document order. Leaves only: an
 * ancestor's textContent is the concatenation of its children's, so counting
 * ancestors would report a whole card as "new" the moment one line inside it
 * changed.
 */
export async function visibleTextSnapshot(page: Page): Promise<string[]> {
  return page
    .evaluate(() => {
      // Inline helpers only — see the note in errorTextSignals about esbuild's
      // keepNames and `__name` not existing in the page.
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        if (el.children.length !== 0) continue;
        const text = (el.textContent ?? "").trim();
        if (!text) continue;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width <= 0 || r.height <= 0) continue;
        if (cs.visibility === "hidden" || cs.display === "none") continue;
        out.push(text);
      }
      return out;
    })
    .catch(() => [] as string[]);
}

export type ErrorProbeSignals = {
  /** How the error text was identified. null = none found. */
  errorTextSource: "delta" | "aria-describedby" | "pattern" | null;
  errorText: string | null;
  errorTextContrast: number | null;
  errorTextLowContrast: boolean;
  /** Does the text reach the accessibility tree at all? null = no error found. */
  errorTextInA11yTree: boolean | null;
  errorRoleAlert: boolean;
  errorInLiveRegion: boolean;
  hasAriaLive: boolean;
  errorAriaInvalid: boolean;
  errorAriaDescribedby: boolean;
  /**
   * Would a screen reader ever say this out loud? True only through a route
   * that actually announces: role="alert", an aria-live region, or the standard
   * aria-invalid + aria-describedby pairing (read when focus returns to the
   * offending field). Sighted-only text in a plain paragraph is not announced.
   */
  errorAnnounced: boolean | null;
};

const NO_ERROR_FOUND: ErrorProbeSignals = {
  errorTextSource: null,
  errorText: null,
  errorTextContrast: null,
  errorTextLowContrast: false,
  errorTextInA11yTree: null,
  errorRoleAlert: false,
  errorInLiveRegion: false,
  hasAriaLive: false,
  errorAriaInvalid: false,
  errorAriaDescribedby: false,
  errorAnnounced: null,
};

/**
 * Identifies and measures the error text on a screen that has just rejected a
 * submission.
 *
 * Priority, per CR-14: the text delta is the evidence; `aria-invalid` +
 * `aria-describedby` corroborate it and break ties when several strings
 * appeared; ERROR_TEXT_PATTERN is a weak last resort used only when the delta
 * is empty (an app that pre-renders its error hidden and merely unhides it adds
 * no new text node, so an empty delta does not prove there was no error).
 *
 * @param newTexts  visible strings present after the submit and not before
 * @param rawSnapshot  the raw ariaSnapshot taken after the submit, used to
 *   answer "is this text in the accessibility tree" against the tree itself
 *   rather than against our parsed nodes — parseAriaSnapshot keeps only lines
 *   carrying a `ref`, so a paragraph's text payload is dropped, and asking it
 *   would report every plain-paragraph error as absent from the tree. That is a
 *   far stronger claim than the evidence supports.
 */
export async function probeErrorSignals(
  page: Page,
  newTexts: string[],
  rawSnapshot: string,
): Promise<ErrorProbeSignals> {
  const found = await page
    .evaluate(
      ({ texts, patternSource }) => {
        const pattern = new RegExp(patternSource, "i");

        const leaves = Array.from(document.querySelectorAll("body *")).filter((el) => {
          if (el.children.length !== 0) return false;
          if ((el.textContent ?? "").trim().length === 0) return false;
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return (
            r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"
          );
        });

        const fields = Array.from(document.querySelectorAll("input, textarea, select"));
        const invalidField =
          fields.find((f) => f.getAttribute("aria-invalid") === "true") ?? null;
        const describedIds = (invalidField?.getAttribute("aria-describedby") ?? "")
          .split(/\s+/)
          .filter((id) => id.length > 0);

        const isNew = new Set(texts);
        const deltaEls = leaves.filter((el) => isNew.has((el.textContent ?? "").trim()));

        let el: Element | null = null;
        let source: string | null = null;
        const described =
          deltaEls.find((e) => describedIds.includes(e.id)) ??
          leaves.find((e) => describedIds.includes(e.id));
        if (described) {
          el = described;
          source = "aria-describedby";
        } else if (deltaEls.length > 0) {
          el = deltaEls[0];
          source = "delta";
        } else {
          const byPattern = leaves.find(
            (c) =>
              c.getAttribute("role") === "alert" ||
              pattern.test((c.textContent ?? "").trim()),
          );
          if (byPattern) {
            el = byPattern;
            source = "pattern";
          }
        }

        const hasAriaLive =
          document.querySelector("[aria-live], [role=alert], [role=status]") !== null;
        const errorAriaInvalid = invalidField !== null;

        if (!el) {
          return {
            text: null as string | null,
            source: null as string | null,
            fg: null as string | null,
            bg: null as string | null,
            hasAriaLive,
            errorAriaInvalid,
            errorAriaDescribedby: false,
            roleAlert: false,
            inLiveRegion: false,
            ariaHidden: false,
          };
        }

        let bgEl: Element | null = el;
        let bg = "";
        for (let i = 0; i < 6 && bgEl; i++) {
          bg = getComputedStyle(bgEl).backgroundColor;
          if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") break;
          bgEl = bgEl.parentElement;
        }

        return {
          text: (el.textContent ?? "").trim(),
          source,
          fg: getComputedStyle(el).color,
          bg: bg || "rgb(255, 255, 255)",
          hasAriaLive,
          errorAriaInvalid,
          errorAriaDescribedby: describedIds.includes(el.id),
          roleAlert:
            el.getAttribute("role") === "alert" || el.closest("[role=alert]") !== null,
          inLiveRegion: el.closest("[aria-live], [role=alert], [role=status]") !== null,
          ariaHidden: el.closest('[aria-hidden="true"]') !== null,
        };
      },
      { texts: newTexts, patternSource: ERROR_TEXT_PATTERN.source },
    )
    .catch(() => null);

  if (!found || !found.text || !found.source) {
    return { ...NO_ERROR_FOUND, hasAriaLive: found?.hasAriaLive ?? false };
  }

  const fg = found.fg ? parseRgb(found.fg) : null;
  const bg = found.bg ? parseRgb(found.bg) : null;
  const ratio = fg && bg ? Math.round(contrastRatio(fg, bg) * 100) / 100 : null;

  // Whitespace-normalised on both sides: the snapshot renders a text payload on
  // one line, the DOM may hold it across several.
  //
  // The aria-hidden term is not redundant. Playwright's `mode: "ai"` snapshot
  // renders an `aria-hidden="true"` subtree like any other — verified against a
  // live page — so the snapshot alone would report text a screen reader can
  // never reach as present in the tree. That is the one claim in this finding
  // that must not be overstated, so it is checked against the DOM as well.
  const flat = (s: string) => s.replace(/\s+/g, " ").trim();
  const inTree = !found.ariaHidden && flat(rawSnapshot).includes(flat(found.text));

  return {
    errorTextSource: found.source as ErrorProbeSignals["errorTextSource"],
    errorText: found.text,
    errorTextContrast: ratio,
    errorTextLowContrast: ratio !== null && ratio < WCAG_AA_NORMAL_TEXT,
    errorTextInA11yTree: inTree,
    errorRoleAlert: found.roleAlert,
    errorInLiveRegion: found.inLiveRegion,
    hasAriaLive: found.hasAriaLive,
    errorAriaInvalid: found.errorAriaInvalid,
    errorAriaDescribedby: found.errorAriaDescribedby,
    errorAnnounced:
      found.roleAlert ||
      found.inLiveRegion ||
      (found.errorAriaInvalid && found.errorAriaDescribedby),
  };
}
