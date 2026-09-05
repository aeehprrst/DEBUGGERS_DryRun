import { chromium, type Page } from "playwright";
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
import { classifyNodes, isActionBlocked, parseAriaSnapshot } from "./aria.js";
import { captureStateScreenshot } from "./screenshots.js";
import { computeStaticSignals } from "./signals.js";
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

export type CrawlResult = {
  graph: StateGraph;
  stateCount: number;
  actionCount: number;
  truncated: boolean;
};

export type CrawlOptions = {
  seededValues?: SeededValues;
  allowActions?: AllowActions;
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
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    const fillValue = makeSyntheticFiller(runId, options.seededValues);
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
          queue.push({
            stateId: newId,
            path: [...front.path, { inputCandidates: front.inputCandidates, anchor }],
            ...candidates,
          });
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
