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
  "latency", "throughput", "envelope",
  // "workspace" was here and has been removed. It is ordinary English that
  // happens to be common in SaaS, not technical vocabulary a non-specialist
  // would stumble on — a list error, independent of any one target app.
]);

/**
 * A state carrying fewer accessible names than this is not measured at all.
 * A 1-of-1 or 2-of-3 ratio is not a measurement, it is a rounding artifact:
 * one flagged word on a sparse screen reads as 100% jargon. Returning null
 * says "not enough to measure" rather than fabricating a confident number
 * (CLAUDE.md §6.5).
 */
export const MIN_NAMES_FOR_JARGON_SCORE = 4;

/**
 * A word appearing in the headings or navigation of at least this many distinct
 * states is that product's own vocabulary, not unexplained jargon. Every app
 * repeats its core nouns in its own chrome; a term the product itself teaches
 * on every screen is not a term the product failed to explain.
 */
export const PRODUCT_VOCABULARY_MIN_STATES = 3;

export function wordsIn(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

/**
 * Fraction of the supplied accessible names that contain at least one flagged
 * word. Names, not raw page text: a screen reader announces names, and a name
 * is what a persona has to act on.
 *
 * Returns null when there are too few names to measure — see
 * MIN_NAMES_FOR_JARGON_SCORE. `productVocabulary` holds words the caller has
 * determined the product teaches itself; they are excluded from the count.
 */
export function jargonScoreForNames(
  names: readonly string[],
  productVocabulary: ReadonlySet<string> = new Set(),
): number | null {
  const usable = names.filter((n) => n.trim().length > 0);
  if (usable.length < MIN_NAMES_FOR_JARGON_SCORE) return null;

  const flagged = usable.filter((name) =>
    wordsIn(name).some(
      (word) => JARGON_WORDS.has(word) && !productVocabulary.has(word),
    ),
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
