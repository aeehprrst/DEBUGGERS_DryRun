import type {
  A11yNode,
  AppState,
  Finding,
  FindingSignature,
  StateGraph,
  TourStep,
} from "@dry-run/core";
import { generateSemanticAnchor } from "./compiler.js";

// Template-based copy per signature — no LLM yet, per the plan. Each
// template gets the finding so it can fold in the grounded explanation
// rather than reading as generic boilerplate.
const TEMPLATES: Record<FindingSignature, (finding: Finding) => { title: string; body: string }> = {
  "hidden-cta": (f) => ({
    title: "Look here first",
    body: `The way forward is easy to miss on this screen. ${f.explanation}`,
  }),
  "ambiguous-cta": (f) => ({
    title: "This is the button to click",
    body: `It isn't obvious which control actually moves you forward. ${f.explanation}`,
  }),
  "silent-validation": (f) => ({
    title: "Double-check this field",
    body: `If something's wrong here, you may not get a clear error. ${f.explanation}`,
  }),
  "dead-end": (f) => ({
    title: "Heads up — this can be a dead end",
    body: f.explanation,
  }),
  "offscreen-control": (f) => ({
    title: "Scroll down for the next step",
    body: `The control you need isn't visible without scrolling. ${f.explanation}`,
  }),
  "jargon-gate": (f) => ({
    title: "Unfamiliar term ahead",
    body: f.explanation,
  }),
  "excessive-choice": (f) => ({
    title: "Take a moment here",
    body: `There's a lot to weigh on this screen. ${f.explanation}`,
  }),
  "slow-response": (f) => ({
    title: "Give it a second",
    body: `This step can take a moment to respond. ${f.explanation}`,
  }),
};

// Findings don't (yet) carry a specific element ref — only a stateId — so
// the "implicated node" is a heuristic: the most likely interactive element
// a person would act on for this screen, in the same priority a persona
// would scan a screen in.
function pickImplicatedNode(state: AppState): A11yNode | null {
  return (
    state.a11yTree.find((n) => n.role === "button") ??
    state.a11yTree.find((n) => n.role === "link") ??
    state.a11yTree.find((n) => n.role === "textbox") ??
    state.a11yTree[0] ??
    null
  );
}

export function generateTourFromFindings(
  runId: string,
  findings: Finding[],
  graph: StateGraph,
): Omit<TourStep, "id">[] {
  const topFindings = [...findings]
    .sort((a, b) => b.fixValue - a.fixValue)
    .slice(0, 3);

  const steps: Omit<TourStep, "id">[] = [];

  topFindings.forEach((finding, index) => {
    const state = graph.nodes[finding.stateId];
    if (!state) return; // finding references a state no longer in the graph

    const node = pickImplicatedNode(state);
    if (!node) return; // nothing on this screen to anchor a step to

    const copy = TEMPLATES[finding.signature]?.(finding) ?? {
      title: finding.title,
      body: finding.explanation,
    };

    steps.push({
      order: index,
      stateId: finding.stateId,
      anchor: generateSemanticAnchor(node),
      title: copy.title,
      body: copy.body,
      placement: "bottom",
      status: "proposed",
    });
  });

  return steps;
}
