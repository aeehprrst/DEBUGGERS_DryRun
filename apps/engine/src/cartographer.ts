import { chromium, type Browser, type Page } from "playwright";
import type {
  A11yNode,
  ActionEdge,
  ActionType,
  AllowActions,
  AppState,
  SeededValues,
  SemanticAnchor,
  StateGraph,
} from "@dry-run/core";
import {
  CRAWL_VIEWPORTS,
  MIN_NAMES_FOR_JARGON_SCORE,
  PRODUCT_VOCABULARY_MIN_STATES,
  isCtaVerb,
  jargonScoreForNames,
  wordsIn,
} from "@dry-run/core";
import { classifyNodes, isActionBlocked, parseAriaSnapshot } from "./aria.js";
import {
  replayCrawl,
  replayFixtureIdFromEnv,
  type FixtureProvenance,
} from "./replay.js";
import { captureStateScreenshot } from "./screenshots.js";
import {
  computeStaticSignals,
  probeErrorSignals,
  visibleTextSnapshot,
} from "./signals.js";
import { emitRunEvent } from "./sse.js";

// Exported: the orchestrator's crawl-band progress is `45 × statesFound /
// CRAWL_BUDGET` (TRD §4.1 rule 3), so it must be the same number, not a copy.
export const CRAWL_BUDGET = 15;
const SETTLE_MS = 300;
// A single-page target can schedule its route change on a timer instead of
// doing it in the click handler — Meridian's /connect navigates 700 ms after a
// successful submit — and a client-side route change fires no `load` event at
// all, so waiting on `load` + SETTLE_MS alone snapshots the *old* view and the
// crawl never records the transition. Poll for the URL to move instead, capped
// so that a genuine no-op click (D2's "Continue") still resolves as a self-loop.
const POST_CLICK_URL_WAIT_MS = 1200;
const POST_CLICK_POLL_MS = 100;
const FIXED_NAMES = ["Alex Rivera", "Jordan Lee", "Sam Patel", "Riley Chen"];

// Replaying a path means re-fetching every intermediate state from scratch,
// so each hop must refill that state's own inputs before clicking through —
// a fresh reload always starts with empty (browser-validated) form fields.
type PathStep = { inputCandidates: A11yNode[]; anchor: SemanticAnchor };

type Frontier = {
  stateId: string;
  path: PathStep[];
  clickCandidates: A11yNode[];
  inputCandidates: A11yNode[];
};

function toAnchor(node: A11yNode): SemanticAnchor {
  return {
    role: node.role,
    name: node.name,
    landmark: node.landmark,
    ordinal: node.ordinal,
  };
}

function actionTypeFor(role: string): ActionType {
  if (role === "link") return "navigate";
  if (role === "textbox" || role === "searchbox") return "type";
  if (role === "checkbox" || role === "radio" || role === "combobox") return "select";
  return "click";
}

// Everything the fill order (TRD §5.2.3) is allowed to look at. `name` is the
// *accessible* name, never an id or a selector (§6.1).
export type FieldContext = {
  type: string;
  name: string;
  placeholder: string | null;
};

export type FillValue = {
  value: string;
  /** Which of the four TRD §5.2.3 steps produced it — logged, never guessed. */
  source: "seeded" | "placeholder" | "heuristic" | "generic";
};

// A credential-shaped placeholder is a prefix, a separator, then an elision
// marker standing in for the secret part: "mk_...", "sk-XXXXXXXX", "tok_…".
// The elision marker is what makes it a *template* rather than prose — without
// it, "Acme-Corp" would read as a prefix and get mangled.
const PLACEHOLDER_ELIDED_RE =
  /(^|[\s(])([A-Za-z][A-Za-z0-9]{0,15}[_-])(?:\.{2,}|…|[xX]{3,}|_{3,}|<[^>]*>)/;
// ...and the same shape written out in full as a fake example value, which has
// no elision marker but is still a single credential-ish token: "mk_1234abcd".
// Deliberately lowercase-initial and separator-bearing so ordinary capitalised
// prose ("Acme-Corp") does not match.
const PLACEHOLDER_EXAMPLE_RE = /^([a-z][a-z0-9]{0,9}[_-])[A-Za-z0-9]{3,}$/;

// Types whose value the browser itself validates. Deriving a made-up string
// from a placeholder here would *fail* that validation, which is the exact
// failure CR-07 exists to remove — so step 2 is skipped for them and step 3's
// type heuristic (which already emits a conforming value) runs instead.
const BROWSER_VALIDATED_TYPES = new Set(["email", "url", "tel", "number"]);

// Step 2 of the fill order — derive a conforming value from the placeholder.
// Returns null when the placeholder carries no usable pattern.
export function deriveFromPlaceholder(field: FieldContext): string | null {
  const placeholder = field.placeholder?.trim();
  if (!placeholder) return null;
  if (BROWSER_VALIDATED_TYPES.has(field.type)) return null;

  const elided = PLACEHOLDER_ELIDED_RE.exec(placeholder);
  if (elided) return `${elided[2]}demo123`;

  const example = PLACEHOLDER_EXAMPLE_RE.exec(placeholder);
  if (example) return `${example[1]}demo123`;

  return null;
}

// Fixture generator, TRD §9.5 — synthetic data only, never real-looking PII.
// Fill order is CR-07 / TRD §5.2.3, in this exact priority:
//   1. RunConfig.seededValues[accessibleName]
//   2. a pattern derived from the field's own placeholder
//   3. type / accessible-name heuristics
//   4. a generic string
function makeSyntheticFiller(runId: string, seededValues: SeededValues = {}) {
  let nameIdx = 0;

  // Accessible names are authored copy, so an operator typing "API Key" into
  // the Setup form should still hit a field labelled "API key". Exact match
  // wins; the case-insensitive index is only a fallback.
  const seededByLowerKey = new Map<string, string>();
  for (const [key, value] of Object.entries(seededValues)) {
    seededByLowerKey.set(key.toLowerCase(), value);
  }

  return (field: FieldContext): FillValue => {
    // 1 — seeded
    const seeded =
      Object.prototype.hasOwnProperty.call(seededValues, field.name)
        ? seededValues[field.name]
        : seededByLowerKey.get(field.name.toLowerCase());
    if (typeof seeded === "string" && seeded.length > 0) {
      return { value: seeded, source: "seeded" };
    }

    // 2 — placeholder-derived
    const derived = deriveFromPlaceholder(field);
    if (derived) return { value: derived, source: "placeholder" };

    // 3 — type / name heuristics
    const label = field.name.toLowerCase();
    switch (field.type) {
      case "email":
        return { value: `dryrun+${runId}@example.invalid`, source: "heuristic" };
      case "password":
        return { value: "Dryrun!Synthetic1", source: "heuristic" };
      case "url":
        return { value: "https://example.invalid/dryrun", source: "heuristic" };
      case "tel":
        return { value: "+15555550100", source: "heuristic" };
      case "number":
        return { value: "1", source: "heuristic" };
      default:
        if (/name/.test(label)) {
          return {
            value: FIXED_NAMES[nameIdx++ % FIXED_NAMES.length],
            source: "heuristic",
          };
        }
        // 4 — generic
        return { value: "Dry Run sample text", source: "generic" };
    }
  };
}

type Filler = ReturnType<typeof makeSyntheticFiller>;

// Waits out a click's consequences, including a client-side route change that
// the target scheduled on a timer. See POST_CLICK_URL_WAIT_MS.
async function settleAfterClick(page: Page, urlBeforeClick: string) {
  await page.waitForLoadState("load").catch(() => {});
  const deadline = Date.now() + POST_CLICK_URL_WAIT_MS;
  while (Date.now() < deadline && page.url() === urlBeforeClick) {
    await page.waitForTimeout(POST_CLICK_POLL_MS);
  }
  await page.waitForTimeout(SETTLE_MS);
}

async function gotoAndReplay(
  page: Page,
  url: string,
  path: PathStep[],
  fill: Filler,
) {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(SETTLE_MS);
  for (const step of path) {
    await fillInputs(page, step.inputCandidates, fill);
    const locator = page
      .getByRole(step.anchor.role as "button", { name: step.anchor.name, exact: true })
      .nth(step.anchor.ordinal);
    const urlBeforeClick = page.url();
    await locator.click({ timeout: 5000 }).catch(() => {});
    await settleAfterClick(page, urlBeforeClick);
  }
}

async function fillInputs(page: Page, inputCandidates: A11yNode[], fill: Filler) {
  for (const node of inputCandidates) {
    if (node.role !== "textbox" && node.role !== "searchbox") continue;
    const locator = page.getByRole(node.role as "textbox", { name: node.name, exact: true }).nth(node.ordinal);
    const current = await locator.inputValue().catch(() => "");
    if (current) continue;
    const type = (await locator.getAttribute("type").catch(() => null)) ?? "text";
    const placeholder = await locator.getAttribute("placeholder").catch(() => null);
    const { value } = fill({ type, name: node.name, placeholder });
    await locator.fill(value).catch(() => {});
  }
}

async function snapshotNow(page: Page) {
  const raw = await page.locator("body").ariaSnapshot({ mode: "ai", boxes: true });
  // The URL is one of the four CR-04 fingerprint terms (TRD §5.2.1).
  return parseAriaSnapshot(raw, page.url());
}

/**
 * CR-12 · `deadEndControl` — an interactive control whose activation produced
 * no observable state change. Blocks D4.
 *
 * The self-loop edge is already recorded during the crawl; this promotes it to
 * a state-level static signal the classifier can read, which is the only form
 * Pass 1 of `classifyObserved` can consume.
 *
 * A self-loop *is* "no URL change and no DOM delta" by construction: state
 * identity is the CR-04 composite fingerprint over url + interactive
 * role/name pairs + primary heading + landmark skeleton, so an edge landing
 * back on its own source means every one of those was unchanged after the
 * click. Nothing extra needs measuring.
 *
 * `type` edges are excluded: the cartographer records those as self-loops by
 * construction (typing into a field is not meant to navigate), so counting
 * them would mark every form on earth a dead end.
 */
function annotateDeadEndControls(graph: StateGraph): void {
  const namesByState = new Map<string, string[]>();

  for (const edge of graph.edges) {
    if (edge.action !== "click" && edge.action !== "navigate") continue;
    if (edge.fromStateId !== edge.toStateId) continue;
    const names = namesByState.get(edge.fromStateId) ?? [];
    if (!names.includes(edge.anchor.name)) names.push(edge.anchor.name);
    namesByState.set(edge.fromStateId, names);
  }

  for (const [stateId, state] of Object.entries(graph.nodes)) {
    const names = namesByState.get(stateId) ?? [];
    // The `state-found` SSE event for this state was emitted before its
    // out-edges existed, so a live subscriber saw `deadEndControl: false`.
    // The persisted graph is the authoritative copy and analysis reads that.
    state.staticSignals = {
      ...(state.staticSignals ?? {}),
      deadEndControl: names.length > 0,
      deadEndControlNames: names,
    };
  }
}

/**
 * CR-12 · `jargonScore`, computed once across the whole graph because its two
 * mechanism guards need more than one state to evaluate:
 *
 *  1. **Minimum name count.** A state with fewer than
 *     MIN_NAMES_FOR_JARGON_SCORE accessible names is not scored at all. One
 *     flagged word on a sparse screen reads as 100% jargon, which is a
 *     rounding artifact, not a measurement.
 *  2. **Product-vocabulary exclusion.** A word the product repeats in its own
 *     headings or navigation across PRODUCT_VOCABULARY_MIN_STATES or more
 *     states is vocabulary that product teaches; it is not a term the product
 *     failed to explain. Derived from the crawled graph, so it generalises to
 *     any target rather than encoding anything about one app.
 */
function annotateJargonScores(graph: StateGraph): void {
  // Which words does this product put in its own chrome, and on how many
  // distinct states? Headings and navigation landmarks only — body copy is
  // where jargon hides, chrome is where a product names itself.
  const statesPerWord = new Map<string, Set<string>>();
  for (const [stateId, state] of Object.entries(graph.nodes)) {
    for (const node of state.a11yTree) {
      const isChrome =
        node.role === "heading" ||
        node.landmark === "navigation" ||
        node.landmark === "banner";
      if (!isChrome) continue;
      for (const word of wordsIn(node.name)) {
        const seen = statesPerWord.get(word) ?? new Set<string>();
        seen.add(stateId);
        statesPerWord.set(word, seen);
      }
    }
  }

  const productVocabulary = new Set(
    [...statesPerWord.entries()]
      .filter(([, states]) => states.size >= PRODUCT_VOCABULARY_MIN_STATES)
      .map(([word]) => word),
  );

  for (const state of Object.values(graph.nodes)) {
    const names = state.a11yTree.map((n) => n.name);
    const score = jargonScoreForNames(names, productVocabulary);
    state.staticSignals = {
      ...(state.staticSignals ?? {}),
      // null, never 0 — "too few names to measure" and "measured, no jargon"
      // are different facts and the classifier must be able to tell them apart.
      jargonScore: score,
      jargonUnmeasuredReason:
        score === null
          ? `only ${names.filter((n) => n.trim()).length} accessible names, below the ${MIN_NAMES_FOR_JARGON_SCORE} needed to measure`
          : null,
      jargonProductVocabulary: [...productVocabulary].sort(),
    };
  }
}

/**
 * CR-09 · TRD §5.2.5 — the mobile pass. Re-measures static signals on states
 * the desktop pass already found, at 390px.
 *
 * It re-measures only: it never adds a node and never follows an edge the
 * desktop pass did not already record ("mobile pass reuses the desktop pass's
 * edge list and only re-measures signals — it does not re-explore").
 *
 * Reaching a state means replaying its recorded path, not navigating to its
 * URL. Meridian's modal state — where D5 actually lives — shares a URL with the
 * screen behind it and is only reachable by clicking, so a URL-based shortcut
 * would silently skip the one state this pass exists to measure.
 */
async function measureMobileViewport(
  browser: Browser,
  runId: string,
  url: string,
  graph: StateGraph,
  pathByStateId: Map<string, PathStep[]>,
  fill: Filler,
): Promise<{ measured: number; skipped: string[] }> {
  const page = await browser.newPage({ viewport: CRAWL_VIEWPORTS["mobile-390"] });
  const skipped: string[] = [];
  let measured = 0;

  try {
    for (const [stateId, state] of Object.entries(graph.nodes)) {
      const path = pathByStateId.get(stateId);
      if (!path) {
        skipped.push(`${stateId} (no recorded path)`);
        continue;
      }

      await gotoAndReplay(page, url, path, fill);
      const parsed = await snapshotNow(page);

      // The CR-04 fingerprint is viewport-independent by construction (url,
      // interactive role/name pairs, primary heading, landmark skeleton — no
      // geometry), so a replay that lands on the right screen must produce the
      // same hash. A mismatch means the replay went somewhere else, and
      // attributing these numbers to this state would be a fabrication.
      if (parsed.fingerprint !== state.fingerprint) {
        skipped.push(`${stateId} (fingerprint changed on replay)`);
        continue;
      }

      state.viewports = {
        ...(state.viewports ?? {}),
        "mobile-390": await computeStaticSignals(page, parsed.nodes),
      };
      measured += 1;
    }
  } finally {
    await page.close();
  }

  // Deliberately emits no stage event: the orchestrator owns the crawl band and
  // its progress is monotonic (TRD §4.1 rule 3), so a raw pct from here would
  // rewind the operator's bar.
  return { measured, skipped };
}

/**
 * CR-14 · the validation probe. Submits one deliberately invalid value on every
 * state that has a form, measures the error the app renders, then corrects the
 * value and proceeds.
 *
 * Why it has to exist: CR-07 seeds a *valid* API key so the crawler can get
 * past /connect, and a crawler that always submits valid input never sees a
 * validation error. Every state in every Meridian run therefore reported
 * `errorTextContrast: null` — not because the error is fine, but because it was
 * never rendered. D3 is unobservable without deliberately provoking it.
 *
 * Like the mobile pass, this **never creates a node**. It runs after the graph
 * is closed, writes only into an existing state's `staticSignals`, and refuses
 * to attribute anything if the invalid submit moved the app somewhere else —
 * a separate error screen would be a state the crawler never discovered, and
 * this pass has no mandate to add one.
 */

// A single punctuation character. It is non-empty, so it satisfies the
// browser's own `required` gate and actually reaches the application's
// validator; and it conforms to no prefix, format, length or vocabulary in any
// language, so any app-level validation that exists will reject it.
const INVALID_PROBE_VALUE = "!";

// Types the browser validates itself. "!" in a type=email field never reaches
// the app at all — the browser blocks submission with its own (already
// announced) bubble, which is a different mechanism and not a defect of the
// app. So these get a value that satisfies the browser and is still obviously
// not a real account.
//
// Shortcut, and an honest one: this cannot provoke a *semantic* rejection on a
// browser-validated field ("that email is already taken"), because nothing here
// can know what value such an app would reject. Replacing it properly would
// mean an operator-supplied invalid value per field, the mirror of CR-07's
// seededValues.
const CONFORMING_BUT_IMPLAUSIBLE: Record<string, string> = {
  email: "dryrun-invalid@example.invalid",
  url: "https://example.invalid/dryrun-invalid",
  tel: "+15555550199",
  number: "0",
};

function invalidValueFor(type: string): string {
  return CONFORMING_BUT_IMPLAUSIBLE[type] ?? INVALID_PROBE_VALUE;
}

// Timeouts are explicit and short here. The probe deliberately activates
// controls that may be unreachable (a form behind a modal overlay), and the
// right answer to "this control could not be activated" is to record that in
// seconds, not to stall the crawl on Playwright's 30 s default.
const PROBE_ACTION_TIMEOUT_MS = 3000;

/**
 * Overwrites every text input on the current screen, unlike `fillInputs` which
 * leaves a populated field alone. Returns what it actually typed, keyed by
 * accessible name, so the finding can quote its own evidence.
 */
async function overwriteInputs(
  page: Page,
  inputCandidates: A11yNode[],
  choose: (field: FieldContext) => string,
): Promise<Record<string, string>> {
  const typed: Record<string, string> = {};
  for (const node of inputCandidates) {
    if (node.role !== "textbox" && node.role !== "searchbox") continue;
    const locator = page
      .getByRole(node.role as "textbox", { name: node.name, exact: true })
      .nth(node.ordinal);
    const type =
      (await locator
        .getAttribute("type", { timeout: PROBE_ACTION_TIMEOUT_MS })
        .catch(() => null)) ?? "text";
    const placeholder = await locator
      .getAttribute("placeholder", { timeout: PROBE_ACTION_TIMEOUT_MS })
      .catch(() => null);
    const value = choose({ type, name: node.name, placeholder });
    const ok = await locator
      .fill(value, { timeout: PROBE_ACTION_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (ok) typed[node.name] = value;
  }
  return typed;
}

/**
 * The control that submits the form. Read from the DOM (`type="submit"`) first,
 * because that is what the browser itself will act on; a CTA verb is only the
 * fallback for a form wired entirely in JavaScript. Meridian's /connect is the
 * case that needs the distinction — "Continue" and "Connect source" look
 * identical (that is D2), and only the second submits.
 */
async function findSubmitControl(
  page: Page,
  clickCandidates: A11yNode[],
  allowActions: AllowActions,
): Promise<A11yNode | null> {
  // TRD S4 — the probe activates controls, so it obeys the same blocklist the
  // crawl does. An unattested destructive name is not probed.
  const buttons = clickCandidates.filter(
    (n) => n.role === "button" && !isActionBlocked(n.name, allowActions),
  );
  for (const node of buttons) {
    const isSubmit = await page
      .getByRole("button", { name: node.name, exact: true })
      .nth(node.ordinal)
      .evaluate((el) => (el as HTMLButtonElement).type === "submit")
      .catch(() => false);
    if (isSubmit) return node;
  }
  return buttons.find((n) => isCtaVerb(n.name)) ?? null;
}

async function probeValidation(
  browser: Browser,
  url: string,
  graph: StateGraph,
  pathByStateId: Map<string, PathStep[]>,
  fill: Filler,
  allowActions: AllowActions,
): Promise<{ probed: number; rejected: number }> {
  const page = await browser.newPage({ viewport: CRAWL_VIEWPORTS["laptop-1280"] });
  let probed = 0;
  let rejected = 0;

  // Every state gets an entry, probed or not: "we tried and it did not reject"
  // and "we never tried" are different facts and the UI must be able to say
  // which one it is (CLAUDE.md §6.5).
  const record = (state: AppState, fields: Record<string, unknown>) => {
    state.staticSignals = { ...(state.staticSignals ?? {}), ...fields };
  };
  const skip = (reason: string) => ({
    validationProbed: false,
    validationRejected: null,
    validationProbeSkippedReason: reason,
  });

  try {
    for (const [stateId, state] of Object.entries(graph.nodes)) {
      const inputs = state.a11yTree.filter(
        (n) => n.role === "textbox" || n.role === "searchbox",
      );
      const path = pathByStateId.get(stateId);

      if (!path) {
        record(state, skip("no recorded path back to this state"));
        continue;
      }
      if (inputs.length === 0) {
        record(state, skip("no text input on this screen to submit"));
        continue;
      }

      await gotoAndReplay(page, url, path, fill);
      const arrival = await snapshotNow(page);
      if (arrival.fingerprint !== state.fingerprint) {
        record(state, skip("replay landed on a different state"));
        continue;
      }

      const submit = await findSubmitControl(
        page,
        classifyNodes(arrival.nodes).clickCandidates,
        allowActions,
      );
      if (!submit) {
        record(state, skip("no submit control to activate"));
        continue;
      }

      const textsBefore = await visibleTextSnapshot(page);
      const typed = await overwriteInputs(page, inputs, (f) => invalidValueFor(f.type));
      if (Object.keys(typed).length === 0) {
        record(state, skip("no text input could be filled"));
        continue;
      }

      const submitLocator = page
        .getByRole("button", { name: submit.name, exact: true })
        .nth(submit.ordinal);
      const urlBeforeSubmit = page.url();
      const clicked = await submitLocator
        .click({ timeout: PROBE_ACTION_TIMEOUT_MS })
        .then(() => true)
        .catch(() => false);
      if (!clicked) {
        record(state, skip(`submit control "${submit.name}" was not actionable`));
        continue;
      }
      await settleAfterClick(page, urlBeforeSubmit);
      probed += 1;

      const afterSubmit = await snapshotNow(page);
      if (afterSubmit.fingerprint !== state.fingerprint) {
        // Nothing on this screen rejected the value. Either the app does not
        // validate this form, or it renders its error on a screen of its own —
        // which would be a node, and creating one is exactly what this pass is
        // forbidden to do. Either way the error signals stay null rather than
        // being attributed to the wrong screen.
        record(state, {
          validationProbed: true,
          validationRejected: false,
          validationProbeSkippedReason: null,
          validationProbeValues: typed,
          validationProbeNote: `submitting via "${submit.name}" advanced to a different state, so this screen did not reject the value`,
        });
        continue;
      }
      rejected += 1;

      // Same screen, so whatever text appeared is this screen's response to
      // being given something it would not accept. That is the error text, by
      // construction rather than by vocabulary.
      const textsAfter = await visibleTextSnapshot(page);
      const seen = new Set(textsBefore);
      const newTexts = textsAfter.filter((t) => !seen.has(t));
      const rawSnapshot = await page
        .locator("body")
        .ariaSnapshot({ mode: "ai", boxes: true });
      const errorSignals = await probeErrorSignals(page, newTexts, rawSnapshot);

      // "...then correct the value and proceed normally." The graph is already
      // closed, so this changes nothing structural — it is here because leaving
      // a target sitting in a rejected state is not what a well-behaved bot
      // does, and because whether the form recovers at all is itself worth
      // observing: an app that latches its error is a worse defect than one
      // that clears.
      await overwriteInputs(page, inputs, (f) => fill(f).value);
      const urlBeforeRetry = page.url();
      await submitLocator.click({ timeout: PROBE_ACTION_TIMEOUT_MS }).catch(() => {});
      await settleAfterClick(page, urlBeforeRetry);
      const recovered = (await snapshotNow(page)).fingerprint !== state.fingerprint;

      record(state, {
        validationProbed: true,
        validationRejected: true,
        validationProbeSkippedReason: null,
        validationProbeValues: typed,
        validationProbeNote: null,
        validationRecovers: recovered,
        ...errorSignals,
      });
    }
  } finally {
    await page.close();
  }

  return { probed, rejected };
}

export type CrawlResult = {
  graph: StateGraph;
  stateCount: number;
  actionCount: number;
  truncated: boolean;
  /**
   * CR-13 — present only when the crawl was served from a cached fixture.
   * Its absence is what says "a browser really did this", so nothing may
   * default it to a value (L5: the disclosure is part of the pitch).
   */
  replayedFrom?: FixtureProvenance;
};

export type CrawlOptions = {
  seededValues?: SeededValues;
  allowActions?: AllowActions;
  /**
   * CR-13 / TRD §4.1 rule 6 — when set, the crawl stage is served from a
   * committed fixture instead of a browser. Defaults to `DRYRUN_REPLAY`.
   * Everything downstream still runs for real.
   */
  replayFixtureId?: string;
  /**
   * PRESENTATION ONLY — playback pacing for the replay path, in ms. 0/absent
   * is the existing behaviour. Never read from the environment here or below:
   * only the server entry point supplies it, so the evaluation harness (which
   * drives the same orchestrator) cannot be paced and its wall clock cannot
   * move. Affects emission timing only, never the graph.
   */
  replayPaceMs?: number;
  /** Throws to abort the crawl; called once per state (TRD §4.1 rule 5). */
  checkCancel?: () => void;
  /** Reports states found so the orchestrator can map them onto its band. */
  onStateFound?: (statesFound: number) => void;
};

/**
 * Crawls the target and returns the graph. It does NOT emit stage events,
 * persist anything, or set a run status: PL-01 made the orchestrator the single
 * owner of run lifecycle (TRD §4.1 rule 2), and a stage that also wrote its own
 * status was how the pipeline used to strand runs on a stage that no longer
 * exists. Failures throw so the orchestrator can decide FAILED vs DEGRADED.
 */
export async function runCrawl(
  runId: string,
  url: string,
  options: CrawlOptions = {},
): Promise<CrawlResult> {
  // CR-13 — checked before the browser launches, because the whole point of
  // replay is that no browser is needed (L5: never crawl live on stage).
  const replayFixtureId = options.replayFixtureId ?? replayFixtureIdFromEnv();
  if (replayFixtureId) {
    const replayed = await replayCrawl(runId, replayFixtureId, {
      checkCancel: options.checkCancel,
      onStateFound: options.onStateFound,
      paceMs: options.replayPaceMs,
    });
    return {
      graph: replayed.graph,
      stateCount: replayed.stateCount,
      actionCount: replayed.actionCount,
      truncated: replayed.truncated,
      replayedFrom: replayed.provenance,
    };
  }

  const browser = await chromium.launch();

  try {
    // CR-09 — the desktop pass viewport is now declared, not inherited from
    // Playwright's default, so both passes read from one source.
    const page = await browser.newPage({ viewport: CRAWL_VIEWPORTS["laptop-1280"] });
    const fillValue = makeSyntheticFiller(runId, options.seededValues);
    // The replay path per state, retained so the mobile pass can re-reach each
    // state. A state whose only route is a click (Meridian's modal, where D5
    // lives) has no addressable URL, so this is the only way back to it.
    const pathByStateId = new Map<string, PathStep[]>();
    const allowActions = options.allowActions ?? [];
    const checkCancel = options.checkCancel ?? (() => {});
    const graph: StateGraph = { nodes: {}, edges: [] };
    const fingerprintToStateId = new Map<string, string>();
    const queue: Frontier[] = [];
    let stateSeq = 0;
    let truncated = false;

    const nodeCount = () => Object.keys(graph.nodes).length;

    const emitProgress = () => {
      options.onStateFound?.(nodeCount());
    };

    // Root state
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(SETTLE_MS);
    const rootParsed = await snapshotNow(page);
    const rootId = `s${stateSeq++}`;
    const rootState: AppState = {
      id: rootId,
      fingerprint: rootParsed.fingerprint,
      url: page.url(),
      title: await page.title(),
      screenshotPath: await captureStateScreenshot(page, runId, rootId),
      a11yTree: rootParsed.nodes,
      staticSignals: await computeStaticSignals(page, rootParsed.nodes),
    };
    const rootCandidates = classifyNodes(rootParsed.nodes);
    graph.nodes[rootId] = rootState;
    fingerprintToStateId.set(rootState.fingerprint, rootId);
    emitRunEvent(runId, { t: "state-found", state: rootState });
    emitProgress();
    pathByStateId.set(rootId, []);
    queue.push({ stateId: rootId, path: [], ...rootCandidates });

    outer: while (queue.length > 0) {
      if (nodeCount() >= CRAWL_BUDGET) {
        truncated = true;
        break;
      }
      // One dequeued frontier state is the crawl's unit of work.
      checkCancel();
      const front = queue.shift()!;

      // Land on `front` once to fill+record its input edges (self-loops).
      await gotoAndReplay(page, url, front.path, fillValue);
      await fillInputs(page, front.inputCandidates, fillValue);
      for (const inputNode of front.inputCandidates) {
        const edge: ActionEdge = {
          fromStateId: front.stateId,
          toStateId: front.stateId,
          action: actionTypeFor(inputNode.role),
          targetRef: inputNode.ref,
          anchor: toAnchor(inputNode),
        };
        graph.edges.push(edge);
        emitRunEvent(runId, { t: "action-found", edge });
      }

      for (const clickNode of front.clickCandidates) {
        if (nodeCount() >= CRAWL_BUDGET) {
          truncated = true;
          break outer;
        }
        // TRD S4 — blocked by default; the operator's attested allowlist is the
        // only thing that permits one of these names.
        if (isActionBlocked(clickNode.name, allowActions)) continue;

        // Fresh arrival per candidate: earlier clicks/fills in this loop may
        // have navigated or mutated the DOM.
        await gotoAndReplay(page, url, front.path, fillValue);
        await fillInputs(page, front.inputCandidates, fillValue);

        const locator = page
          .getByRole(clickNode.role as "button", { name: clickNode.name, exact: true })
          .nth(clickNode.ordinal);
        const urlBeforeClick = page.url();
        await locator.click({ timeout: 5000 }).catch(() => {});
        await settleAfterClick(page, urlBeforeClick);

        const parsed = await snapshotNow(page);
        const anchor = toAnchor(clickNode);
        let toStateId = fingerprintToStateId.get(parsed.fingerprint);

        if (!toStateId) {
          const newId = `s${stateSeq++}`;
          const candidates = classifyNodes(parsed.nodes);
          const newState: AppState = {
            id: newId,
            fingerprint: parsed.fingerprint,
            url: page.url(),
            title: await page.title(),
            screenshotPath: await captureStateScreenshot(page, runId, newId),
            a11yTree: parsed.nodes,
            staticSignals: await computeStaticSignals(page, parsed.nodes),
          };
          graph.nodes[newId] = newState;
          fingerprintToStateId.set(parsed.fingerprint, newId);
          const newPath = [
            ...front.path,
            { inputCandidates: front.inputCandidates, anchor },
          ];
          pathByStateId.set(newId, newPath);
          queue.push({ stateId: newId, path: newPath, ...candidates });
          emitRunEvent(runId, { t: "state-found", state: newState });
          emitProgress();
          toStateId = newId;
        }

        const edge: ActionEdge = {
          fromStateId: front.stateId,
          toStateId,
          action: actionTypeFor(clickNode.role),
          targetRef: clickNode.ref,
          anchor,
        };
        graph.edges.push(edge);
        emitRunEvent(runId, { t: "action-found", edge });
      }
    }

    if (queue.length > 0) truncated = true;

    annotateDeadEndControls(graph);
    annotateJargonScores(graph);

    // CR-14 — must run before the viewport snapshot below, which aliases
    // `viewports["laptop-1280"]` to this same object.
    // Emits no SSE event of its own: every state it touched carries
    // `validationProbed` / `validationProbeSkippedReason` in its own signals,
    // which is a durable record rather than a line that scrolls past, and the
    // event union has no non-error informational variant to widen without
    // touching the interface's contract.
    await probeValidation(browser, url, graph, pathByStateId, fillValue, allowActions);

    // CR-09 — every state now carries its desktop measurement under its own
    // viewport key as well, so the two passes are read the same way.
    for (const state of Object.values(graph.nodes)) {
      state.viewports = {
        ...(state.viewports ?? {}),
        "laptop-1280": state.staticSignals,
      };
    }

    const mobile = await measureMobileViewport(
      browser,
      runId,
      url,
      graph,
      pathByStateId,
      fillValue,
    );
    if (mobile.skipped.length > 0) {
      // Annotated, not silent: a state without a mobile measurement must not
      // look like a state measured and found clean (CLAUDE.md §6.5).
      emitRunEvent(runId, {
        t: "error",
        message: `mobile-390 pass could not re-reach ${mobile.skipped.length} state(s): ${mobile.skipped.join(", ")}`,
        fatal: false,
      });
    }

    // Persisting and status-setting belong to the orchestrator (TRD §4.1
    // rule 2 — "persist its blob" happens at the stage boundary it owns).
    return {
      graph,
      stateCount: nodeCount(),
      actionCount: graph.edges.length,
      truncated,
    };
  } finally {
    await browser.close();
  }
}
