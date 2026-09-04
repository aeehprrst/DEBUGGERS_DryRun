import type { A11yNode, ActionEdge, AppState, TaskDefinition } from "@dry-run/core";

// Accessible names that are almost always the "keep going" affordance on a
// SaaS onboarding screen. Kept generic/task-agnostic on purpose — this is
// the cheap first line of defense before escalating to the model.
const OBVIOUS_CTA_PATTERN =
  /\b(continue|next|submit|sign up|sign in|log in|create|connect|get started|save|confirm)\b/i;

function toActionEdge(fromStateId: string, target: A11yNode): ActionEdge {
  return {
    fromStateId,
    // Unknown until the click is actually performed and the resulting page
    // is observed — a heuristic only decides *what* to click, not where it
    // leads.
    toStateId: "",
    action: "click",
    targetRef: target.ref,
    anchor: {
      role: target.role,
      name: target.name,
      landmark: target.landmark,
      ordinal: target.ordinal,
      dataTestId: target.dataTestId,
    },
  };
}

export function evaluateHeuristic(
  state: AppState,
  task: TaskDefinition,
): ActionEdge | null {
  const buttons = state.a11yTree.filter((node) => node.role === "button");

  const goalMatch = buttons.find((node) =>
    node.name.toLowerCase().includes(task.goalPredicate.target.toLowerCase()),
  );
  if (goalMatch) {
    return toActionEdge(state.id, goalMatch);
  }

  const ctaMatch = buttons.find((node) => OBVIOUS_CTA_PATTERN.test(node.name));
  if (ctaMatch) {
    return toActionEdge(state.id, ctaMatch);
  }

  return null;
}
