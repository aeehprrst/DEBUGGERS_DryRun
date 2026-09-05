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
  /** CR-04 composite fingerprint — see TRD §5.2.1 and `compositeFingerprint`. */
  fingerprint: string;
};

// Tracking parameters carry no state identity — the same screen arrived at from
// a campaign link is the same screen. Everything else in the query string is
// kept (sorted, so order can't fork a node) because it frequently *is* state:
// ?step=2 and ?step=3 are different screens.
const TRACKING_PARAM_RE = /^(utm_|_ga$|_gl$)|^(fbclid|gclid|msclkid|mc_cid|mc_eid|igshid|ref_src)$/i;
const UUID_SEGMENT_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_SEGMENT_RE = /^\d+$/;

// TRD §5.2.1 — "/\d/ and UUID segments → :id; tracking params dropped".
export function urlPattern(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  const segments = parsed.pathname
    .split("/")
    .map((seg) =>
      NUMERIC_SEGMENT_RE.test(seg) || UUID_SEGMENT_RE.test(seg) ? ":id" : seg,
    );

  const kept = [...parsed.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAM_RE.test(key))
    .map(([key, value]) => `${key}=${value}`)
    .sort();

  const query = kept.length ? `?${kept.join("&")}` : "";
  return `${parsed.origin}${segments.join("/")}${query}`;
}

// The four-part composite hash, TRD §5.2.1. Replaces the old depth:role hash,
// under which two screens with the same DOM shape collapsed into one node
// (Meridian's /connect and /invite did exactly that) and a renamed control did
// not change identity at all — which would have made Drift (L7) blind.
export function compositeFingerprint(input: {
  url: string;
  interactivePairs: string[];
  primaryHeading: string;
  landmarkSkeleton: string;
}): string {
  return createHash("sha256")
    .update(
      [
        urlPattern(input.url),
        // Sorted, so DOM reordering alone is not a new state.
        [...input.interactivePairs].sort().join("|"),
        input.primaryHeading,
        input.landmarkSkeleton,
      ].join("\u0000"),
    )
    .digest("hex");
}

// `url` is optional so the parser stays usable without a page (tests, fixtures);
// omitting it simply drops the urlPattern term.
export function parseAriaSnapshot(raw: string, url = ""): AriaParseResult {
  const nodes: A11yNode[] = [];
  const landmarkStack: { depth: number; role: string; path: string }[] = [];
  const ordinalCounts = new Map<string, number>();

  // CR-04 fingerprint terms, accumulated in document order.
  const interactivePairs: string[] = [];
  const landmarkPaths: string[] = [];
  let primaryHeading = "";
  let primaryHeadingLevel = Number.POSITIVE_INFINITY;

  for (const rawLine of raw.split("\n")) {
    const firstNonSpace = rawLine.search(/\S/);
    if (firstNonSpace === -1 || rawLine[firstNonSpace] !== "-") continue;

    const depth = firstNonSpace / 2;
    const content = rawLine.slice(firstNonSpace + 1).trimStart();
    const match = LINE_RE.exec(content);
    if (!match?.groups) continue;

    const role = match.groups.role;
    const name = match.groups.name ?? "";

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

    // "first h1, else first heading, lowercased and trimmed"
    if (role === "heading") {
      const level = Number(attrs.level ?? Number.POSITIVE_INFINITY);
      if (level < primaryHeadingLevel) {
        primaryHeadingLevel = level;
        primaryHeading = name.toLowerCase().trim();
      }
    }

    // "interactive elements only: `button:connect data source`". Lowercased so
    // a copy-case change is not a new state, but the *name* is in — which is
    // what makes a renamed control visible to Drift (L7).
    if (CLICKABLE_ROLES.has(role) || INPUT_ROLES.has(role)) {
      interactivePairs.push(`${role}:${name.toLowerCase().trim()}`);
    }

    if (LANDMARK_ROLES.has(role)) {
      const parent = landmarkStack.at(-1);
      const label = name ? `${role}:${name}` : role;
      const path = parent ? `${parent.path}>${label}` : label;
      // Only leaf landmarks survive in the skeleton: a landmark that turns out
      // to have a landmark child gives up its own entry to the deeper path, so
      // the term reads "main>region:Setup>form" and not every prefix of it.
      if (parent) {
        const parentIdx = landmarkPaths.indexOf(parent.path);
        if (parentIdx >= 0) landmarkPaths.splice(parentIdx, 1);
      }
      landmarkPaths.push(path);
      landmarkStack.push({ depth, role, path });
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

  const fingerprint = compositeFingerprint({
    url,
    interactivePairs,
    primaryHeading,
    landmarkSkeleton: landmarkPaths.join(","),
  });

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

// TRD S4 / CLAUDE.md §8 — verbatim. The bare word "send" is deliberately NOT
// here: invite and submit actions are part of normal onboarding funnels, and
// blocking them makes most real apps unmappable. Meridian is the proof — "Send
// invite" is the only path off /invite, so blocking it hid two planted defects.
// Payment-shaped sends are still blocked by their full phrase.
const DESTRUCTIVE_NAME_RE =
  /\b(delete|remove|destroy|pay|purchase|checkout|subscribe|publish|cancel subscription|transfer|send payment|send money|wire)\b/i;

export function isDestructiveName(name: string): boolean {
  return DESTRUCTIVE_NAME_RE.test(name);
}

// The question the crawler actually asks before activating a control: is this
// blocked *and* not explicitly permitted for this run? Exact, case-sensitive
// match against the operator's list — the accessible name is what they saw and
// approved, so a fuzzy match would let one approval widen on its own.
export function isActionBlocked(
  name: string,
  allowActions: readonly string[] = [],
): boolean {
  if (allowActions.includes(name)) return false;
  return isDestructiveName(name);
}
