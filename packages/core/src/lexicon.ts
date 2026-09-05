// CR-12 / TRD §5.2.4 — "jargonScore (fraction of accessible names flagged
// technical against a declared word list)". Declared here, in the one package
// everything imports, because two consumers need the identical list: the
// crawler computes the static signal, and Chorus reads it to model how a
// low-`domainLiteracy` persona fares. Two copies drifting apart would make the
// Observed signal and the Modeled walk disagree about the same screen.
//
// A declared list, not a fitted one. It is deliberately conservative: every
// entry is a word a competent non-specialist could plausibly stumble on in an
// onboarding flow, and nothing here is scored or weighted.
export const JARGON_WORDS: ReadonlySet<string> = new Set([
  "api", "webhook", "webhooks", "endpoint", "payload", "idempotency",
  "idempotent", "backfill", "ingestion", "oauth", "sso", "sdk", "cli",
  "token", "credential", "credentials", "provisioning", "namespace",
  "schema", "instance", "cluster", "deploy", "sandbox", "environment",
  "middleware", "authentication", "authorization", "encryption",
  "certificate", "dns", "cname", "callback", "async", "queue", "cache",
  "index", "migration", "regex", "json", "xml", "rest", "graphql",
  "latency", "throughput", "workspace", "envelope",
]);

/**
 * Fraction of the supplied accessible names that contain at least one flagged
 * word. Names, not raw page text: a screen reader announces names, and a name
 * is what a persona has to act on.
 */
export function jargonScoreForNames(names: readonly string[]): number {
  const usable = names.filter((n) => n.trim().length > 0);
  if (usable.length === 0) return 0;

  const flagged = usable.filter((name) =>
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .some((word) => JARGON_WORDS.has(word)),
  ).length;

  return flagged / usable.length;
}

// TRD §5.2.4 — `competingCtas` is "≥2 same-styled **primary-verb** buttons in
// one landmark". This is the primary-verb half; the same-styled half needs
// computed styles and so lives in the engine, which has a browser.
export const CTA_VERB_PATTERN =
  /\b(continue|next|submit|sign up|sign in|log in|create|connect|get started|save|confirm|finish|add|start)\b/i;

export function isCtaVerb(accessibleName: string): boolean {
  return CTA_VERB_PATTERN.test(accessibleName);
}

// TRD §5.2.4 — errorTextContrast applies to "any node with role `alert` or a
// name matching /invalid|error|must|required/".
export const ERROR_TEXT_PATTERN = /invalid|error|must|required/i;

// WCAG 2.1 AA minimum for normal-size body text.
export const WCAG_AA_NORMAL_TEXT = 4.5;
