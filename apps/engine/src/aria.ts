import { createHash } from "node:crypto";
import type { A11yNode } from "@dry-run/core";

// Playwright's ariaSnapshot({ mode: "ai", boxes: true }) renders a 2-space-indented
// YAML-ish outline, one accessible node per line, e.g.:
//   - heading "Create your account" [level=1] [ref=e7] [box=457,141,366,33]
//   - textbox "Email" [ref=e12] [box=457,251,366,37]
// Confirmed empirically against a live page — see conversation notes.

const LANDMARK_ROLES = new Set([
  "banner",
  "complementary",
  "contentinfo",
  "form",
  "main",
  "navigation",
  "region",
  "search",
]);

export const CLICKABLE_ROLES = new Set(["button", "link"]);
export const INPUT_ROLES = new Set([
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
]);

const LINE_RE =
  /^(?<role>[A-Za-z][\w-]*)(?:\s+"(?<name>(?:[^"\\]|\\.)*)")?(?<attrs>(?:\s*\[[^\]]*\])*)\s*(?::\s*(?<text>.*))?$/;
const ATTR_RE = /\[(\w+)=([^\]]*)\]/g;

export type AriaParseResult = {
  nodes: A11yNode[];
  /** sha1 over (depth, role) pairs in document order — ignores names/text/box. */
  fingerprint: string;
};

export function parseAriaSnapshot(raw: string): AriaParseResult {
  const nodes: A11yNode[] = [];
  const structuralLines: string[] = [];
  const landmarkStack: { depth: number; role: string }[] = [];
  const ordinalCounts = new Map<string, number>();

  for (const rawLine of raw.split("\n")) {
    const firstNonSpace = rawLine.search(/\S/);
    if (firstNonSpace === -1 || rawLine[firstNonSpace] !== "-") continue;

    const depth = firstNonSpace / 2;
    const content = rawLine.slice(firstNonSpace + 1).trimStart();
    const match = LINE_RE.exec(content);
    if (!match?.groups) continue;

    const role = match.groups.role;
    const name = match.groups.name ?? "";
    // "text" leaves carry literal content (e.g. a filled input's current
    // value) — excluded so the fingerprint stays content-blind, not just
    // name-blind: typing into a field must not look like a new state.
    if (role !== "text") structuralLines.push(`${depth}:${role}`);

    const attrs: Record<string, string> = {};
    for (const attrMatch of match.groups.attrs.matchAll(ATTR_RE)) {
      attrs[attrMatch[1]] = attrMatch[2];
    }

    while (
      landmarkStack.length &&
      landmarkStack[landmarkStack.length - 1].depth >= depth
    ) {
      landmarkStack.pop();
    }
    const landmark = landmarkStack.at(-1)?.role;

    const ordinalKey = `${role}::${name}`;
    const ordinal = ordinalCounts.get(ordinalKey) ?? 0;
    ordinalCounts.set(ordinalKey, ordinal + 1);

    if (LANDMARK_ROLES.has(role)) {
      landmarkStack.push({ depth, role });
    }

    const ref = attrs.ref;
    if (!ref) continue; // raw "text" leaves carry no ref/element — nothing to act on

    const [x, y, width, height] = (attrs.box ?? "0,0,0,0")
      .split(",")
      .map(Number);

    nodes.push({
      ref,
      role,
      name,
      box: { x, y, width, height },
      landmark,
      ordinal,
    });
  }

  const fingerprint = createHash("sha1")
    .update(structuralLines.join("\n"))
    .digest("hex");

  return { nodes, fingerprint };
}

export function classifyNodes(nodes: A11yNode[]): {
  clickCandidates: A11yNode[];
  inputCandidates: A11yNode[];
} {
  return {
    clickCandidates: nodes.filter((n) => CLICKABLE_ROLES.has(n.role)),
    inputCandidates: nodes.filter((n) => INPUT_ROLES.has(n.role)),
  };
}

// TRD §9 Security & Safety Implementation, item 3 — verbatim.
const DESTRUCTIVE_NAME_RE =
  /\b(delete|remove|destroy|pay|purchase|buy|checkout|subscribe|publish|send|submit payment|cancel subscription|deactivate|close account|transfer)\b/i;

export function isDestructiveName(name: string): boolean {
  return DESTRUCTIVE_NAME_RE.test(name);
}
