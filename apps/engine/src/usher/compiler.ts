import type { A11yNode, SemanticAnchor } from "@dry-run/core";

// TRD §5.8 — the anchor is generated with exactly the fields a resolver
// needs to walk this same four-tier order later, in priority: dataTestId
// (tier 1, most durable) → role+name (tiers 2/3, exact then fuzzy against
// `name`) → landmark+ordinal (tier 4, structural fallback after a redesign
// moves or renames the element). Tiers 5–6 (fallbackSelectors, BROKEN) are
// runtime resolution concerns, not something generated here.
export function generateSemanticAnchor(node: A11yNode): SemanticAnchor {
  return {
    role: node.role,
    name: node.name,
    landmark: node.landmark,
    ordinal: node.ordinal,
    dataTestId: node.dataTestId,
    selectorFallback: describeForDebugging(node),
  };
}

function describeForDebugging(node: A11yNode): string {
  const parts = [`role=${node.role}`, `name="${node.name}"`];
  if (node.landmark) parts.push(`landmark=${node.landmark}`);
  parts.push(`ordinal=${node.ordinal}`);
  if (node.dataTestId) parts.push(`data-testid=${node.dataTestId}`);
  return parts.join(" ");
}
