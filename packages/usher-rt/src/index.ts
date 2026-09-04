// Usher runtime — TRD §5.8. Zero-dependency, vanilla TS, bundled+minified to
// a single IIFE (see package.json's esbuild `build` script) so the shipped
// artifact stays under the 6 KB budget. No imports from @dry-run/core on
// purpose: that package pulls in zod, which alone blows past the budget —
// these types are a hand-copied structural subset of the real ones.

type SemanticAnchor = {
  role: string;
  name: string;
  landmark?: string;
  ordinal: number;
  dataTestId?: string;
  selectorFallback?: string;
};

type AdvanceOn = { type: string; condition?: string };

type TourStep = {
  id: string;
  order: number;
  anchor: SemanticAnchor;
  title: string;
  body: string;
  placement: "top" | "bottom" | "left" | "right" | "center" | string;
  advanceOn?: AdvanceOn;
};

type Tour = {
  id: string;
  steps: TourStep[];
};

// ---------- Accessible name (hand-rolled subset, TRD §5.8) ----------
// aria-label → aria-labelledby → text content → title → placeholder.
function accessibleName(el: Element): string {
  const label = el.getAttribute("aria-label");
  if (label) return label.trim();

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
    if (text) return text;
  }

  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text) return text;

  const title = el.getAttribute("title");
  if (title) return title.trim();

  const placeholder = (el as HTMLInputElement).placeholder;
  if (placeholder) return placeholder.trim();

  return "";
}

// ---------- Role (hand-rolled subset — enough for interactive elements) ----------
const IMPLICIT_INPUT_ROLES: Record<string, string> = {
  checkbox: "checkbox",
  radio: "radio",
  submit: "button",
  button: "button",
  reset: "button",
  search: "searchbox",
};

function role(el: Element): string {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;

  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "button":
    case "summary":
      return "button";
    case "a":
      return el.hasAttribute("href") ? "link" : "generic";
    case "select":
      return "combobox";
    case "textarea":
      return "textbox";
    case "input":
      return IMPLICIT_INPUT_ROLES[(el as HTMLInputElement).type] ?? "textbox";
    case "main":
      return "main";
    case "nav":
      return "navigation";
    case "header":
      return "banner";
    case "footer":
      return "contentinfo";
    case "aside":
      return "complementary";
    case "form":
      return "form";
    default:
      return "generic";
  }
}

const LANDMARK_ROLES = new Set([
  "main",
  "navigation",
  "banner",
  "contentinfo",
  "complementary",
  "form",
  "search",
  "region",
]);

function isLandmark(el: Element): boolean {
  return LANDMARK_ROLES.has(role(el));
}

function findLandmarkRoot(landmark: string | undefined): Element | null {
  if (!landmark) return null;
  const all = document.querySelectorAll<HTMLElement>("*");
  for (const el of all) {
    if (isLandmark(el) && role(el) === landmark) return el;
  }
  return null;
}

// ---------- Fuzzy match (normalised Levenshtein, TRD §5.8 tier 3) ----------
function levenshtein(a: string, b: string): number {
  const dp: number[] = Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) dp[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] =
        a[i - 1] === b[j - 1]
          ? prev
          : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// ---------- Anchor resolution ladder (TRD §5.8) ----------
// Tiers 1–4 only: `selectorFallback` (would-be tier 5) is a human-readable
// debug string on the engine side, not a CSS selector — using it as one
// would never match and would silently mask a real BROKEN step. Tier 6
// (BROKEN → null) is what actually follows a tier-4 miss.
function resolveAnchor(anchor: SemanticAnchor): HTMLElement | null {
  if (anchor.dataTestId) {
    const byTestId = document.querySelector<HTMLElement>(
      `[data-testid="${CSS.escape(anchor.dataTestId)}"]`,
    );
    if (byTestId) return byTestId;
  }

  const scope = findLandmarkRoot(anchor.landmark) ?? document.body;
  const candidates = Array.from(
    scope.querySelectorAll<HTMLElement>(
      "button,a,input,select,textarea,summary,[role]",
    ),
  );

  for (const el of candidates) {
    if (role(el) === anchor.role && accessibleName(el) === anchor.name) {
      return el;
    }
  }

  let best: { el: HTMLElement; score: number } | null = null;
  for (const el of candidates) {
    if (role(el) !== anchor.role) continue;
    const score = similarity(accessibleName(el), anchor.name);
    if (score >= 0.8 && (!best || score > best.score)) best = { el, score };
  }
  if (best) return best.el;

  const sameRole = candidates.filter((el) => role(el) === anchor.role);
  if (sameRole[anchor.ordinal]) return sameRole[anchor.ordinal];

  return null;
}

// ---------- Overlay + tooltip ----------
let overlay: HTMLDivElement | null = null;
let spotlight: HTMLDivElement | null = null;
let tooltip: HTMLDivElement | null = null;
let cleanupTargetListener: (() => void) | null = null;
let reposition: (() => void) | null = null;

function teardown() {
  overlay?.remove();
  overlay = spotlight = tooltip = null;
  cleanupTargetListener?.();
  cleanupTargetListener = null;
  if (reposition) {
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
    reposition = null;
  }
}

function ensureOverlay() {
  if (overlay) return;
  overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:system-ui,sans-serif";
  spotlight = document.createElement("div");
  spotlight.style.cssText =
    "position:fixed;border-radius:8px;box-shadow:0 0 0 9999px rgba(7,14,21,.72);transition:all .18s ease;pointer-events:none";
  tooltip = document.createElement("div");
  tooltip.style.cssText =
    "position:fixed;max-width:320px;background:#1A3247;color:#EAE6DF;border:1px solid rgba(234,230,223,.24);border-radius:8px;padding:14px 16px;box-shadow:0 8px 24px rgba(0,0,0,.4);pointer-events:auto";
  overlay.appendChild(spotlight);
  overlay.appendChild(tooltip);
  document.body.appendChild(overlay);
}

function positionAround(target: HTMLElement | null, placement: string) {
  if (!spotlight || !tooltip) return;
  if (!target) {
    spotlight.style.display = "none";
    tooltip.style.left = "50%";
    tooltip.style.top = "50%";
    tooltip.style.transform = "translate(-50%,-50%)";
    return;
  }
  spotlight.style.display = "block";
  const rect = target.getBoundingClientRect();
  const pad = 6;
  spotlight.style.left = `${rect.left - pad}px`;
  spotlight.style.top = `${rect.top - pad}px`;
  spotlight.style.width = `${rect.width + pad * 2}px`;
  spotlight.style.height = `${rect.height + pad * 2}px`;

  tooltip.style.transform = "none";
  const gap = 12;
  switch (placement) {
    case "top":
      tooltip.style.left = `${rect.left}px`;
      tooltip.style.top = `${rect.top - gap}px`;
      tooltip.style.transform = "translateY(-100%)";
      break;
    case "left":
      tooltip.style.left = `${rect.left - gap}px`;
      tooltip.style.top = `${rect.top}px`;
      tooltip.style.transform = "translateX(-100%)";
      break;
    case "right":
      tooltip.style.left = `${rect.right + gap}px`;
      tooltip.style.top = `${rect.top}px`;
      break;
    case "center":
      tooltip.style.left = `${rect.left + rect.width / 2}px`;
      tooltip.style.top = `${rect.top + rect.height / 2}px`;
      tooltip.style.transform = "translate(-50%,-50%)";
      break;
    case "bottom":
    default:
      tooltip.style.left = `${rect.left}px`;
      tooltip.style.top = `${rect.bottom + gap}px`;
  }
}

function renderStep(
  tour: Tour,
  index: number,
  onNext: () => void,
  onSkip: () => void,
) {
  ensureOverlay();
  cleanupTargetListener?.();
  cleanupTargetListener = null;

  const step = tour.steps[index];
  const target = resolveAnchor(step.anchor);

  positionAround(target, step.placement);
  reposition = () => positionAround(target, step.placement);
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);

  if (target && step.advanceOn?.type === "click") {
    const handler = () => onNext();
    target.addEventListener("click", handler, { once: true });
    cleanupTargetListener = () => target.removeEventListener("click", handler);
  }

  if (!tooltip) return;
  const isLast = index === tour.steps.length - 1;
  tooltip.innerHTML = "";

  const eyebrow = document.createElement("div");
  eyebrow.textContent = `Step ${index + 1} of ${tour.steps.length}`;
  eyebrow.style.cssText =
    "font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#94A3B8;margin-bottom:6px";

  const title = document.createElement("div");
  title.textContent = step.title;
  title.style.cssText = "font-weight:600;font-size:15px;margin-bottom:4px";

  const body = document.createElement("div");
  body.textContent = step.body;
  body.style.cssText = "font-size:13px;color:#94A3B8;line-height:1.4;margin-bottom:12px";

  const controls = document.createElement("div");
  controls.style.cssText = "display:flex;justify-content:flex-end;gap:8px";

  const skipBtn = document.createElement("button");
  skipBtn.textContent = "Skip tour";
  skipBtn.style.cssText =
    "background:transparent;border:none;color:#94A3B8;font-size:12px;cursor:pointer;padding:6px 8px";
  skipBtn.onclick = onSkip;

  const nextBtn = document.createElement("button");
  nextBtn.textContent = isLast ? "Done" : "Next";
  nextBtn.style.cssText =
    "background:#FF5A00;border:none;color:#0A1620;font-weight:600;font-size:12px;border-radius:6px;cursor:pointer;padding:6px 12px";
  nextBtn.onclick = onNext;

  controls.appendChild(skipBtn);
  controls.appendChild(nextBtn);
  tooltip.appendChild(eyebrow);
  tooltip.appendChild(title);
  tooltip.appendChild(body);
  tooltip.appendChild(controls);
}

function start(tour: Tour) {
  teardown();
  if (!tour.steps.length) return;

  let index = 0;
  const advance = () => {
    index += 1;
    if (index >= tour.steps.length) {
      teardown();
      return;
    }
    renderStep(tour, index, advance, teardown);
  };
  renderStep(tour, index, advance, teardown);
}

(window as unknown as { DryRunTour: { start: (tour: Tour) => void } }).DryRunTour = {
  start,
};
