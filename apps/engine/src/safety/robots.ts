// CR-10 / CLAUDE.md §8 — "Respect `robots.txt` by default."
//
// DELIBERATELY MINIMAL (CLAUDE.md §6.6). This is a disallow check, not a
// robots.txt parser. It reads `User-agent` groups, collects `Disallow` and
// `Allow` prefixes for the group that applies to us, and does longest-match
// prefix comparison — the rule every crawler agrees on. What it does NOT
// implement, so nobody mistakes it for compliance with the full spec:
//
//   * `$` and `*` wildcards in paths — a `Disallow: /*.pdf$` is read as a
//     literal prefix and will therefore match nothing, which fails **open**.
//   * `Crawl-delay`, `Sitemap`, `Host`.
//   * Multiple user-agent tokens sharing one group beyond simple listing.
//
// Replacing it means a real parser (`robots-parser` on npm). It is a shortcut
// because the honest alternative inside the time available was to claim
// robots.txt support in a deck and not check anything at all.
//
// Failing open on a wildcard is a genuine limitation and it is the reason this
// records what it decided on the run: the operator can see "allowed" and also
// see that the file had rules we understood, rather than trusting a silent OK.

import { CRAWLER_USER_AGENT } from "../cartographer.js";

export type RobotsDecision = {
  /** False only when a rule we understood actually matched the target path. */
  allowed: boolean;
  /** What happened, in words, for the run record and the UI. */
  status: "absent" | "unfetchable" | "allowed" | "disallowed";
  detail: string;
  /** The matching rule, when one matched. */
  rule?: string;
  checkedAt: string;
};

const FETCH_TIMEOUT_MS = 5000;

type Group = { agents: string[]; allow: string[]; disallow: string[] };

export function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastLineWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      // Consecutive User-agent lines share one group; a User-agent after a
      // rule starts a new one.
      if (!current || !lastLineWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastLineWasAgent = true;
      continue;
    }

    lastLineWasAgent = false;
    if (!current) continue;
    if (field === "disallow") current.disallow.push(value);
    else if (field === "allow") current.allow.push(value);
  }
  return groups;
}

/**
 * Picks the group that applies to us: an exact match on our token beats `*`,
 * which is what the convention requires — a site that names DryRun-Bot
 * specifically has said something more deliberate than its catch-all rule.
 */
function groupFor(groups: Group[], token: string): Group | null {
  const named = groups.find((g) =>
    g.agents.some((a) => a !== "*" && token.startsWith(a)),
  );
  if (named) return named;
  return groups.find((g) => g.agents.includes("*")) ?? null;
}

function longestMatch(rules: string[], pathname: string): string | null {
  let best: string | null = null;
  for (const rule of rules) {
    if (rule === "") continue; // `Disallow:` with an empty value means "allow all"
    if (pathname.startsWith(rule) && (best === null || rule.length > best.length)) {
      best = rule;
    }
  }
  return best;
}

export function evaluateRobots(text: string, pathname: string): RobotsDecision {
  const token = CRAWLER_USER_AGENT.toLowerCase();
  const group = groupFor(parseRobots(text), token);
  const checkedAt = new Date().toISOString();

  if (!group) {
    return {
      allowed: true,
      status: "allowed",
      detail: "robots.txt has no group matching DryRun-Bot/1.0 or *",
      checkedAt,
    };
  }

  const disallow = longestMatch(group.disallow, pathname);
  const allow = longestMatch(group.allow, pathname);

  // Longest match wins; an Allow of equal length beats a Disallow, which is the
  // conventional tiebreak and the one that keeps a site's explicit carve-out
  // working.
  if (disallow && (!allow || allow.length < disallow.length)) {
    return {
      allowed: false,
      status: "disallowed",
      detail: `robots.txt disallows ${pathname} for ${CRAWLER_USER_AGENT}`,
      rule: `Disallow: ${disallow}`,
      checkedAt,
    };
  }

  return {
    allowed: true,
    status: "allowed",
    detail: `robots.txt has no rule disallowing ${pathname}`,
    ...(allow ? { rule: `Allow: ${allow}` } : {}),
    checkedAt,
  };
}

/**
 * Fetches and evaluates the target origin's robots.txt.
 *
 * **A missing file is not a disallow.** 404, connection refused, timeout and
 * malformed content all proceed, and all record *which* of those happened —
 * CLAUDE.md §6.5: the absence is annotated, never quietly turned into either a
 * green light or a block. Treating an unreachable robots.txt as "disallow"
 * would make the crawler refuse most staging environments; treating it as a
 * silent "allow" would let a fetch bug read as consent.
 */
export async function checkRobots(
  targetUrl: string,
  runId: string,
): Promise<RobotsDecision> {
  const checkedAt = new Date().toISOString();
  let robotsUrl: URL;
  let pathname: string;
  try {
    const parsed = new URL(targetUrl);
    robotsUrl = new URL("/robots.txt", parsed.origin);
    pathname = parsed.pathname || "/";
  } catch {
    return {
      allowed: true,
      status: "unfetchable",
      detail: "target url could not be parsed, so no robots.txt was fetched",
      checkedAt,
    };
  }

  try {
    const response = await fetch(robotsUrl, {
      // We identify ourselves to robots.txt with the same headers we crawl
      // with (§8), so a target's log shows one consistent agent throughout.
      headers: {
        "User-Agent": CRAWLER_USER_AGENT,
        "X-DryRun-Run-Id": runId,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (response.status === 404 || response.status === 410) {
      return {
        allowed: true,
        status: "absent",
        detail: `no robots.txt at ${robotsUrl.href} (${response.status})`,
        checkedAt,
      };
    }
    if (!response.ok) {
      return {
        allowed: true,
        status: "unfetchable",
        detail: `robots.txt returned ${response.status}; proceeding, not treating it as a disallow`,
        checkedAt,
      };
    }

    return evaluateRobots(await response.text(), pathname);
  } catch (error) {
    return {
      allowed: true,
      status: "unfetchable",
      detail: `robots.txt could not be fetched (${
        error instanceof Error ? error.message : "unknown error"
      }); proceeding, not treating it as a disallow`,
      checkedAt,
    };
  }
}
