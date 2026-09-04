import { chromium, type Page } from "playwright";
import type { A11yNode, ActionEdge, ActionType, AppState, SemanticAnchor, StateGraph } from "@dry-run/core";
import { classifyNodes, isDestructiveName, parseAriaSnapshot } from "./aria.js";
import { saveCrawlResult, prisma } from "./db.js";
import { captureStateScreenshot } from "./screenshots.js";
import { computeStaticSignals } from "./signals.js";
import { emitRunEvent } from "./sse.js";

const CRAWL_BUDGET = 15;
const SETTLE_MS = 300;
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

// Fixture generator, TRD §9.5 — synthetic data only, never real-looking PII.
function makeSyntheticFiller(runId: string) {
  let nameIdx = 0;
  return (type: string, accessibleName: string): string => {
    const label = accessibleName.toLowerCase();
    switch (type) {
      case "email":
        return `dryrun+${runId}@example.invalid`;
      case "password":
        return "Dryrun!Synthetic1";
      case "url":
        return "https://example.invalid/dryrun";
      case "tel":
        return "+15555550100";
      case "number":
        return "1";
      default:
        if (/name/.test(label)) return FIXED_NAMES[nameIdx++ % FIXED_NAMES.length];
        return "Dry Run sample text";
    }
  };
}

async function gotoAndReplay(
  page: Page,
  url: string,
  path: PathStep[],
  fill: (type: string, name: string) => string,
) {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(SETTLE_MS);
  for (const step of path) {
    await fillInputs(page, step.inputCandidates, fill);
    const locator = page
      .getByRole(step.anchor.role as "button", { name: step.anchor.name, exact: true })
      .nth(step.anchor.ordinal);
    await locator.click({ timeout: 5000 }).catch(() => {});
    await page.waitForLoadState("load").catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
  }
}

async function fillInputs(
  page: Page,
  inputCandidates: A11yNode[],
  fill: (type: string, name: string) => string,
) {
  for (const node of inputCandidates) {
    if (node.role !== "textbox" && node.role !== "searchbox") continue;
    const locator = page.getByRole(node.role as "textbox", { name: node.name, exact: true }).nth(node.ordinal);
    const current = await locator.inputValue().catch(() => "");
    if (current) continue;
    const type = (await locator.getAttribute("type").catch(() => null)) ?? "text";
    await locator.fill(fill(type, node.name)).catch(() => {});
  }
}

async function snapshotNow(page: Page) {
  const raw = await page.locator("body").ariaSnapshot({ mode: "ai", boxes: true });
  return parseAriaSnapshot(raw);
}

export async function runCrawl(runId: string, url: string): Promise<void> {
  emitRunEvent(runId, { t: "stage", stage: "crawl", pct: 0 });

  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    const fillValue = makeSyntheticFiller(runId);
    const graph: StateGraph = { nodes: {}, edges: [] };
    const fingerprintToStateId = new Map<string, string>();
    const queue: Frontier[] = [];
    let stateSeq = 0;
    let truncated = false;

    const nodeCount = () => Object.keys(graph.nodes).length;

    const emitProgress = () => {
      emitRunEvent(runId, {
        t: "stage",
        stage: "crawl",
        pct: Math.min(99, Math.round((nodeCount() / CRAWL_BUDGET) * 100)),
      });
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
    queue.push({ stateId: rootId, path: [], ...rootCandidates });

    outer: while (queue.length > 0) {
      if (nodeCount() >= CRAWL_BUDGET) {
        truncated = true;
        break;
      }
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
        if (isDestructiveName(clickNode.name)) continue; // TRD §9.3 — never activate

        // Fresh arrival per candidate: earlier clicks/fills in this loop may
        // have navigated or mutated the DOM.
        await gotoAndReplay(page, url, front.path, fillValue);
        await fillInputs(page, front.inputCandidates, fillValue);

        const locator = page
          .getByRole(clickNode.role as "button", { name: clickNode.name, exact: true })
          .nth(clickNode.ordinal);
        await locator.click({ timeout: 5000 }).catch(() => {});
        await page.waitForLoadState("load").catch(() => {});
        await page.waitForTimeout(SETTLE_MS);

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

    await saveCrawlResult(runId, graph, {
      stateCount: nodeCount(),
      actionCount: graph.edges.length,
      truncated,
    });

    emitRunEvent(runId, { t: "stage", stage: "scouts", pct: 0 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await prisma.run.update({
      where: { id: runId },
      data: { status: "FAILED", error: message },
    });

    emitRunEvent(runId, { t: "error", message, fatal: true });
  } finally {
    await browser.close();
  }
}
