# Dry Run — Complete Project State & Handoff Document

**Document:** 7 of 7 · **Version:** 1.0 · **Status:** Handoff / migration reference
**Generated:** 2026-09-04
**Covers:** Everything the Dry Run project *is*, everything that was *designed*, and everything that was *actually built* as of the last commit (`649c2fc`, 2026-08-30 02:44).
**Purpose:** This is the single document you carry to the next environment. It replaces the need to re-read 01–06 plus the codebase. It is written so that a person (or an AI agent) who has never seen this project can pick it up cold, understand the full vision, know exactly what exists in code, know exactly what does not, and know where the landmines are.

**Source repo:** `https://github.com/aeehprrst/dry-run.git` (branch `main`, 18 commits, tag `checkpoint-a`)
**Local path analysed:** `DevJams'26/dry-run/`

---

## Table of Contents

**Part 0 — Executive Summary**
**Part I — The Product: what Dry Run is**
**Part II — The Intended Architecture (as designed)**
**Part III — What Is Actually Built (verified, file by file)**
**Part IV — Implementation Status Matrix (every spec requirement)**
**Part V — The Gap: what was never built**
**Part VI — Known Bugs, Deviations & Technical Debt**
**Part VII — Evidence: real runs, real data, verified behaviour**
**Part VIII — How To Run It Today**
**Part IX — Recommendations for the Rebuild / Upgrade**
**Appendix A — Full file inventory**
**Appendix B — Git history**
**Appendix C — Core type contracts (as implemented)**

---

# Part 0 — Executive Summary

## 0.1 What this project is, in one paragraph

**Dry Run** is a pre-launch onboarding-friction detector. You give it a staging URL. It crawls the app into a **semantic State Graph** (nodes = distinct screens, edges = actions, both labelled from the **accessibility tree** rather than CSS selectors). It then runs a population of AI personas through real tasks — a small number in a real browser (**Scouts**, the truth source) and a large number as a calibrated Monte Carlo simulation over the graph (**Chorus**). It ranks every screen by how much damage it causes (**Friction Score** and **Fix Value**), clusters failures into named **Findings**, and compiles a deployable **guided tour** whose steps are bound to **Semantic Anchors** instead of brittle CSS selectors — so that when you redeploy, it can diff the two graphs (**Drift**) and tell you which tour steps broke, then propose re-anchors for human approval.

The differentiator is **the graph, not the agents**. Competitors run N independent agent sessions and summarise transcripts. Dry Run builds a persistent, comparable structure, which unlocks cross-run comparison, deploy-to-deploy diffing, cheap population simulation, and self-healing tours.

## 0.2 Build status at a glance

| Layer | Status | Reality |
|---|---|---|
| **Monorepo & shared types** | ✅ Working | pnpm workspace, 4 packages, Zod-first types, `@dry-run/core` builds and is consumed by all apps |
| **Demo target app ("Meridian")** | ✅ Working | 6 screens, all **6 planted defects** present and verified in code |
| **Cartographer (crawler)** | ✅ Working (simplified) | Real Playwright BFS crawl, a11y-tree parsing with boxes, structural fingerprint dedupe, screenshots + thumbnails, destructive-action blocklist, synthetic form filling, live SSE. **Verified against a real external website.** |
| **Static signals** | 🟡 Partial | 5 of 9 planned signals (contrast, below-fold, offscreen, interactive count) |
| **Scouts (grounded agents)** | 🔴 Stub only | One hardcoded "Dummy Scout" walking the **fake stub graph**, not a real browser and not the real crawled graph |
| **Brain / decision router** | 🟡 Partial | Heuristic brain + OpenAI-compatible adapter both exist, but no router, no cache, no key pool, no escalation metric, no `ModelCall` logging |
| **Chorus (population sim)** | ✅ Working | Full Monte Carlo, deterministic PRNG, softmax policy, hop-distance goal alignment, jargon load, per-state metrics. Runs 1000 personas. |
| **Calibration** | 🔴 Not built | No fitting, no `fitMae`. Chorus weights are hand-picked constants. |
| **Analysis / Findings** | 🟡 Partial | Rule-based classifier producing 7 of 8 signatures. No trace cross-referencing, no segment breakdown, no evidence quotes. |
| **Scoring (`packages/core`)** | ✅ Working + tested | Friction Score & Fix Value exactly per spec. **11/11 unit tests pass** (verified 2026-09-04). |
| **Usher (tour compiler)** | ✅ Working | Anchor generation, template copy, tour persistence, approve/edit/reject, approval-gated export |
| **Usher runtime (`usher-rt`)** | ✅ Working | Zero-dep vanilla TS, spotlight + tooltip, 4-tier anchor resolution. **Built bundle = 5,342 bytes** (under the 6 KB budget). |
| **Drift (deploy diffing)** | 🔴 Not built | Zero code. `DriftReport` table exists and is empty. No Meridian v2. |
| **Interface — Launchpad** | 🟡 Partial | Hero + URL field + demo link only. No run history, no health check. |
| **Interface — Setup** | 🟡 Partial | URL + attestation only. No tasks editor, no persona mixer, no population slider. |
| **Interface — Live Console** | ✅ Working | SSE wired, stage rail, scout feed, event feed, live-building Atlas, auto-transition on DONE |
| **Interface — Atlas 2D** | ✅ Working (cosmetic) | d3-force layout, SVG nodes, contour rings, selection, inspector — but **no friction data drives any of it** |
| **Interface — Atlas 3D** | ✅ Working (cosmetic) | R3F canvas, screenshot-textured billboarded planes, plumb lines, Bézier edges, orbit — **elevation hardcoded to 0** |
| **Interface — Atlas / Findings / Drift views** | 🔴 Stub | Literally render the text `"Atlas view stub"` etc. |
| **Interface — Tour Builder** | ✅ Working | Full approve/edit/reject/restore, anchor resolution-ladder popover, export modal, preview |
| **Honesty Rail (provenance badges)** | 🔴 Not built | The spec's "never cut" item. Provenance is computed in data but rendered nowhere. |
| **Evaluation harness** | 🔴 Not built | The other "never cut" item. No `pnpm demo`, no precision/recall measurement. |
| **Safety (beyond attestation + blocklist)** | 🔴 Not built | No SSRF guard, no rate limit, no bot UA, no robots.txt, no secret redaction, no password masking |

## 0.3 The single most important architectural fact

**The pipeline is not chained.** In the shipped code, `POST /runs` fires the crawler *and* a dummy scout **in parallel**, and then stops. Chorus and Analysis only run if you manually `POST /runs/:id/chorus`. There is no orchestrator, no stage machine, and no automatic `crawl → scouts → calibrate → chorus → analyse → done` progression.

Everything needed to build that orchestrator exists in pieces. Nothing connects them.

## 0.4 Effort accounting

- **18 commits** spanning **2026-08-29 09:11 → 2026-08-30 02:44** (≈17.5 hours of elapsed build time)
- **~5,000 lines** of hand-written source across 4 packages (excluding lockfiles, generated code, node_modules)
- **28 runs executed** against 7 distinct target URLs, producing **44 MB of screenshots** and a **3 MB SQLite database**
- Tagged `checkpoint-a` at commit `666d139` (2026-08-29 23:57) — roughly matching the plan's Checkpoint A definition-of-done for the crawler and graph, but not for scouts or findings

---

# Part I — The Product: what Dry Run is

*(Distilled from 01-PRD. This is the conceptual core you need to carry forward.)*

## 1.1 One-liner

> **Dry Run finds where your onboarding breaks before a single real user signs up — then builds the guided tour that fixes it, and keeps that tour alive across deploys.**

## 1.2 The 30-second pitch

Most SaaS signups never reach the moment the product becomes useful. Teams find out weeks later from a churn number that never says which screen caused it. Dry Run crawls your staging app into a semantic map, runs up to 1000 AI personas through it, ranks every screen by how many task failures it causes, and auto-generates the onboarding tour that fixes the top three. When you redeploy, it diffs the map, tells you which tour steps broke, and re-anchors them — with a human approving each one.

## 1.3 The problem

A user signs up, lands in an empty app, and needs to connect a data source, invite a teammate, or configure a webhook before anything is useful. Somewhere in that sequence they stall — a label they don't understand, a button below the fold, a validation error rendered in grey-on-grey — and they close the tab.

**Nothing throws an error.** No exception is logged. No test fails. The only signal is a churn number that arrives weeks later and never names the screen.

### Why existing approaches don't close it

| Approach | Why it fails |
|---|---|
| Analytics / session replay (PostHog, FullStory, Hotjar) | Post-hoc. Requires traffic you don't have yet. Tells you *that* people left, rarely *why*. Useless pre-launch. |
| Hand-built product tours (Appcues, Pendo, Userpilot, Shepherd) | Authored manually, anchored to CSS selectors. A renamed class silently kills the tour — nothing throws, it just stops helping. |
| Human usability testing | Accurate but slow and expensive. Weeks per round. Doesn't fit a weekly deploy cadence. |
| E2E test suites (Playwright, Cypress) | Assert correctness, not comprehension. A flow can pass every test and still confuse every human. |
| AI usability tools (Swarm, Tessary, Uxia, Synthetic Users, Maze AI) | Real, growing category. They run agent sessions and summarise findings. They stop at the report, treat each run as independent, and don't produce or maintain a fix. |

### The gap being attacked

> Nobody turns the app into a **persistent, comparable structure** — so nobody can attribute friction to specific nodes, rank fixes by expected gain, ship the fix as an artifact, or tell you which fixes broke when you redeployed.

## 1.4 Target users

**Terminology (binding across all docs — never mix these):**
- **Operator** = the human using Dry Run
- **Persona** = a synthetic AI user Dry Run runs through the target app
- **Target app** = the staging application under test

| # | Persona | Job to be done |
|---|---|---|
| **P1** | Priya, Founding PM at a seed-stage B2B SaaS (12 people, no researcher). Ships weekly, activation is 19%, doesn't know which of eleven setup screens is responsible. | "When we're about to ship an onboarding change, I want to know which screen will cost us the most signups, so I can spend Monday's sprint on the right thing." |
| **P2** | Arjun, Growth Engineer, owns activation rate. Hand-built the current tour in Appcues; it breaks every other deploy and he finds out from a support ticket. | "When we deploy, I want to know within minutes which tour steps broke and get a one-click re-anchor, so I stop being the tour janitor." |
| **P3** | Meera, solo designer-founder, pre-launch, zero traffic. Can't A/B test, can't recruit, one week before Product Hunt. | "Before anyone sees this, I want a prioritised list of what will confuse people, so I don't launch with an obvious hole." |

**Secondary:** DevRel/docs teams validating quickstarts · agencies auditing client onboarding · accessibility-conscious teams.
**Explicitly not our user:** consumer apps with mature analytics · native-mobile-only products · anyone wanting security or load testing.

## 1.5 The wedge — three things that are ours

### 1.5.1 Graph-first, not session-first
Competitors run N independent agent sessions and summarise transcripts. Dry Run first crawls the target into a **persistent State Graph** — nodes are distinct application states, edges are actions, both labelled from the **accessibility tree** rather than CSS classes. Every finding is attributed to a specific node or edge. This unlocks cross-run comparability, deploy-to-deploy diffing, cheap population simulation, and semantic anchoring.

### 1.5.2 Population scale, honestly earned — the two-tier model
Nobody can run 1000 real browser agents in a hackathon, or affordably in production. So:

- **Tier 1 — Scouts (grounded).** 10–40 personas driving a real Chromium instance via Playwright, perceiving via accessibility tree + screenshot, deciding via a multimodal model. Full traces, screenshots, think-aloud rationale. **This is the truth source.**
- **Tier 2 — Chorus (modeled).** 200–1000 personas as Monte Carlo walks over the State Graph, using a transition policy **calibrated from Tier 1 observations** and modulated by persona traits. Runs in seconds, costs nothing per step.
- **The Honesty Rail.** Every number in the UI carries a badge: **Observed** (grounded evidence exists), **Modeled** (extrapolated), or **Predicted** (zero grounded support). Confidence intervals come from the Monte Carlo.

> This is the most important design decision in the product. It makes "1000 AI users" a defensible engineering claim instead of marketing. **Lead with it.** Judges who suspect the number is fake will be disarmed; judges who don't will be impressed by the rigour.

### 1.5.3 Closes the loop to a maintained artifact
Findings are not the deliverable — the **Tour** is. Dry Run compiles a `tour.json` whose steps are bound to **Semantic Anchors** (role + accessible name + landmark + ordinal + fallback chain), not brittle selectors. On the next deploy it diffs the graph, reports which steps are `intact / re-anchored / broken`, and proposes repairs for human approval.

## 1.6 The five modules

| Module | Codename | Responsibility |
|---|---|---|
| Crawler | **Cartographer** | Staging URL → State Graph of screens and actions, labelled from the a11y tree |
| Grounded agents | **Scouts** | 10–40 personas driving a real browser to attempt real tasks |
| Population sim | **Chorus** | 200–1000 modeled personas walking the graph, calibrated by Scouts |
| Visualisation + scoring | **Atlas** | 3D friction map, Friction Score, Fix Value ranking, evidence panels |
| Tour compiler + drift | **Usher** | Generates, previews, exports the tour; diffs deploys and self-heals it |

**Intended flow:**
```
URL + auth → Cartographer → Graph → Scouts (grounded) → calibration
           → Chorus (population) → Analysis → Atlas → Usher → tour.json
           → [redeploy] → Drift → re-anchor → human approval
```

## 1.7 Core concepts (normative definitions)

**State Graph.** Directed multigraph `G = (S, A)`. `S` = distinct application states (screens/modals/steps). `A` = actions (click, type, select, navigate) that transition between them.

**State Fingerprint.** A stable hash identifying a state across runs. *Designed* composition: normalised URL pattern + the multiset of accessible `(role, name)` pairs of interactive elements + primary heading text + landmark structure. Deliberately **excludes** CSS classes, DOM order, and dynamic content. Two states with the same fingerprint are the same node.

**Semantic Anchor.** How a tour step points at an element without a brittle selector:
```json
{
  "role": "button",
  "name": "Connect data source",
  "nameMatch": "exact",
  "landmark": "main > region[Setup]",
  "ordinal": 0,
  "textFingerprint": "connect data source",
  "fallbackSelectors": ["[data-testid=connect-src]"],
  "graphNodeId": "s_07"
}
```
**Resolution order:** `data-testid` → role+name exact → role+name fuzzy → landmark+ordinal → **fail and flag for human**.

**Persona.** A trait vector, not a paragraph of backstory:

| Trait | Type | Effect |
|---|---|---|
| `role` | enum | Goal selection, vocabulary comprehension |
| `domainLiteracy` | 0–1 | Probability of understanding jargon labels |
| `patience` | int | Max steps and max seconds before abandoning |
| `riskAversion` | 0–1 | Reluctance to click irreversible-looking actions |
| `readingDepth` | 0–1 | Whether helper text / tooltips are consumed |
| `priorFamiliarity` | 0–1 | Recognition of standard SaaS patterns |
| `device` | enum | Viewport: `desktop-1440 / laptop-1280 / mobile-390` |
| `inputMode` | enum | `pointer / keyboard-only / screen-reader` |
| `locale` | enum | Language comprehension modifier |
| `weight` | float | Share of the population mix |

**Ten shipped archetypes (designed):** Impatient Founder · Cautious Ops Lead · Non-technical Marketer · Jargon-Fluent Engineer · Mobile Commuter · Screen-Reader User · Distracted Multitasker · Skeptical Evaluator · Eager Beginner · Returning Power User.

**Task.** `{ id, name, goalPredicate, startState }`. The goal predicate is checkable from the graph (state fingerprint reached, or an element with accessible name matching X becomes visible).

**Run.** One execution: `{ graph, personaMix, tasks, scoutTraces, chorusResults, findings, tour }`.

**Finding.** A clustered failure mode attributed to a node/edge, with evidence, a Friction Score, and a Fix Value.

**Drift.** The diff between two graphs from different deploys, plus the resulting per-tour-step health status.

## 1.8 The scoring model

### Per-state metrics
For state `s`, over persona population `P` weighted by persona `weight`:

| Metric | Definition |
|---|---|
| `Dropout(s)` | personas whose run terminated at `s` ÷ personas who entered `s` |
| `Blocked(s)` | personas hitting a hard dead-end at `s` ÷ entered |
| `Loop(s)` | `min(mean(max(0, visits−1)), 5) ÷ 5` |
| `DeadClick(s)` | interactions producing no observable state delta ÷ total interactions on `s` |
| `Hesitation(s)` | median steps before the first goal-advancing action, squashed to 0–1 |
| `Backtrack(s)` | reverse-edge traversals ÷ total exits from `s` |

### Friction Score (0–100) — *how bad is this screen*
```
FrictionScore(s) = 100 × ( 0.35·Dropout + 0.20·Blocked + 0.15·Loop
                         + 0.12·DeadClick + 0.10·Hesitation + 0.08·Backtrack )
```
Weights sum to 1.00 and are configurable/surfaced in the UI.

### Fix Value (0–1) — *what to fix first*
```
FixValue(s) = Impact(s) × Reach(s) × Confidence(s)
```
- `Impact(s)` — share of all task failures attributed to `s`. Attribution: **1.0** to the terminal state of a failed run; **0.25** distributed across states looped through ≥2 times; normalised.
- `Reach(s)` — personas that entered `s` ÷ `|P|`
- `Confidence(s)` — `0.5 + 0.5 × min(1, groundedVisits(s) ÷ 5)`. A screen only Chorus has seen is capped at 0.5.

**The ranked list sorts by Fix Value and displays Friction Score as the headline number.**

### Findings, not raw metrics
Raw metrics are clustered into named human-readable findings by failure signature. Example of the intended output quality:

> **"Invisible validation error"** — 41% of personas re-submitted the same API-key field 3+ times. Error text exists in the DOM at contrast 1.9:1 with no `aria-live`. Screen: *Connect Source*. Friction 78 · Fix Value 0.61 · **Observed** (9 grounded traces).

**Eight failure signatures and their detection rules:**

| Signature | Detection rule |
|---|---|
| `hidden-cta` | `belowFoldPrimaryCta` ∧ `hesitation > 0.5` |
| `ambiguous-cta` | `competingCtas` ∧ `deadClick > 0.25` |
| `silent-validation` | `lowContrastText` ∧ `¬hasAriaLive` ∧ `loop > 0.3` |
| `dead-end` | `blocked > 0.2` ∧ no viable out-edge toward goal |
| `offscreen-control` | `offscreenInteractives.length > 0` ∧ mobile dropout ≫ desktop dropout |
| `jargon-gate` | `jargonScore > 0.4` ∧ dropout correlates negatively with `domainLiteracy` |
| `excessive-choice` | `interactiveCount > 12` ∧ `hesitation > 0.6` |
| `slow-response` | median action latency > 2000 ms |

## 1.9 The demo: "Meridian" and its six planted defects

A deliberately mediocre fake B2B analytics SaaS, shipped in the repo, running locally. Onboarding: *Sign up → Create workspace → Connect data source → Invite team → Configure webhook → Dashboard.*

| # | Screen | Planted defect | Expected detection signal |
|---|---|---|---|
| **D1** | Create Workspace | Primary CTA below the fold, no scroll affordance | High Hesitation, high Dropout |
| **D2** | Connect Source | Two competing CTAs; "Continue" is a no-op returning to the same state | High DeadClick, high Loop |
| **D3** | Connect Source | API-key validation error at 1.9:1 contrast, no `aria-live` | High Loop; screen-reader personas fail 100% |
| **D4** | Invite Team | No skip option, back button broken | High Blocked |
| **D5** | Configure Webhook | Modal close button offscreen at 390px | Mobile personas only |
| **D6** | Configure Webhook | Unexplained jargon ("ingestion webhook") | Low-`domainLiteracy` personas abandon |

**This is the evaluation slide:** *"We planted six. Dry Run found five, plus one we hadn't planned."*

**Meridian v2** (designed, never built): "Connect data source" renamed to "Add a source" and moved into a different card. Same app, one deploy later. This is the entire Drift demo.

## 1.10 Safety, ethics & legal (non-negotiable, and a deck slide)

1. **Attestation gate.** Operator must affirm they own or are authorised to test the target URL. Blocking, logged, timestamped.
2. **Staging-first.** Warn hard on any target resolving to a well-known production domain.
3. **Politeness.** Configurable rate limit, identifying `User-Agent: DryRun-Bot/1.0`, `X-DryRun-Run-Id` header, robots.txt respected by default.
4. **Destructive-action blocklist.** Never click actions whose accessible name matches delete / remove / pay / purchase / publish / send / cancel subscription, unless explicitly allowlisted.
5. **Synthetic data only.** Personas fill forms with clearly-marked fixture data (`dryrun+<runid>@example.invalid`). No real PII, ever.
6. **Secrets hygiene.** Seeded credentials come from environment config, never written to traces, redacted from screenshots of password/secret fields.
7. **Bias disclosure, in-product.** *"Synthetic personas encode model priors, not lived experience. Treat findings as hypotheses to prioritise, not proof."*
8. **Human in the loop.** No tour step and no re-anchor is applied without explicit operator approval.

## 1.11 Non-goals

Dry Run v1 is **not**: a load/performance testing tool · a security scanner · a WCAG certification tool (it *uses* the a11y tree; it does not certify compliance) · a production analytics product · a replacement for real user research · a native mobile app tester · an auth-bypass or CAPTCHA-solving tool.

---

# Part II — The Intended Architecture (as designed)

## 2.1 System diagram (from TRD §3.1)

```
┌───────────────────────────────────────────────────────────────────────────┐
│  apps/web  ·  Next.js 15 (React 19, TS)          http://localhost:3000    │
│  Setup Wizard │ Live Run View │ ATLAS (R3F 3D) │ Findings │ Tour Review   │
│         │              ▲ SSE                                    │         │
└─────────┼──────────────┼────────────────────────────────────────┼─────────┘
          │ REST         │ progress events                        │ REST
          ▼              │                                        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  apps/engine  ·  Fastify + TS  ·  long-lived process   http://:4000       │
│  RunOrchestrator ── stage machine: crawl→scout→calibrate→chorus→analyse   │
│      ├── CARTOGRAPHER   Playwright Chromium · a11y snapshot + boxes       │
│      ├── SCOUTS         N browser contexts · decision router · traces     │
│      ├── CHORUS         calibration fit + Monte Carlo (pure TS, no I/O)   │
│      ├── ANALYSIS       metrics → Friction Score → Fix Value → Findings   │
│      ├── USHER          anchor compiler · tour generation                 │
│      └── DRIFT          graph diff · step health · re-anchor proposals    │
│  BrainRouter → [HeuristicBrain] → [Reka] → [Gemini] → [cache]             │
└───────────────────────────────────────────────────────────────────────────┘
          │                                    │
          ▼                                    ▼
┌──────────────────────┐            ┌──────────────────────────────────┐
│ SQLite (./data/*.db) │            │ ./data/runs/<runId>/*.jpg  shots │
│ via Prisma           │            │ served static by engine          │
└──────────────────────┘            └──────────────────────────────────┘
                    │
                    ▼  (crawl + scouts target this)
┌───────────────────────────────────────────────────────────────────────────┐
│  apps/meridian  ·  Vite + React  ·  the demo target   http://:5173        │
│  v1 (6 planted defects)  ·  v2 (renamed/moved CTA, for Drift)             │
└───────────────────────────────────────────────────────────────────────────┘

  packages/core        shared types, Zod schemas, fingerprinting, scoring,
                       anchor resolution, graph algorithms  (pure, no I/O)
  packages/usher-rt    embeddable tour runtime, vanilla TS, zero deps, <6 KB
```

> **Note:** in the built repo, `apps/web` is named **`apps/interface`** and `apps/meridian` is named **`apps/demo`**. Otherwise the layout matches.

## 2.2 Why the engine is a separate process

Crawls and scout runs are long-lived (60–180 s), hold Playwright browser handles, and stream progress. Next.js route handlers are the wrong shape. A standing Fastify process keeps one Chromium instance warm across runs (saves ~800 ms per run) and owns all state machines. The web app is a thin client plus a proxy.

## 2.3 Tech stack and why (the ADR table — bring this to any review)

| # | Decision | Why | Rejected |
|---|---|---|---|
| D1 | TypeScript end-to-end | One type system across crawler, sim, and UI; no serialisation boundary | Python for simulation |
| D2 | `ariaSnapshot({ box: true })` as the perception primitive | Roles + names + geometry in one CSS-independent call; also enables static defect detection with zero AI | Raw DOM, screenshot-only, CDP |
| D3 | Two-tier Scouts + Chorus | 1000 grounded agents is impossible on cost and time; calibrated simulation is honest and 100× faster | Pure LLM at scale (bankrupt), pure heuristic (not credible) |
| D4 | Heuristic-first decision routing | Cuts model calls ~65%; makes free-tier RPM survivable; no network ⇒ still runs | LLM on every step |
| D5 | Semantic anchors, not CSS selectors | The entire self-healing premise; CSS selectors are what break competitors' tours | XPath, CSS, coordinates |
| D6 | SQLite + Prisma | Zero setup, file-based, survives crashes, one-command migrations | Postgres, in-memory |
| D7 | Graph JSON in TEXT columns | Normalising a 40-node graph buys nothing at this scale and costs hours | Full relational normalisation |
| D8 | SSE, not WebSockets | Progress is one-directional | WebSockets |
| D9 | Reka primary, Gemini fallback, Heuristic offline | Sponsor alignment + free credits + OpenAI-compatible (one adapter for all three); heuristic guarantees an offline demo | Single provider |
| D10 | 2D fallback built before 3D | Guarantees a demo on any machine; the 3D layer reuses the same layout code | 3D only |
| D11 | No agent framework | ~80 calls with a fixed schema; a framework adds abstraction and debugging cost for zero benefit | LangChain, LlamaIndex |

**Also rejected at architecture level:** Docker (one more thing to break on a laptop), any cloud deployment as P0, BullMQ/Redis (one more service for zero benefit at one concurrent run), Nx/Turborepo (setup tax).

## 2.4 The Decision Router (designed, not built) — how the cost problem was to be solved

**Observation:** most steps in an onboarding flow are not decisions. If a screen has one primary button reading "Continue" and the task is "finish setup," there is no ambiguity — a human wouldn't hesitate, and neither should we spend a model call.

```ts
interface Brain { decide(input: DecisionInput): Promise<DecisionOutput> }

class BrainRouter implements Brain {
  async decide(input) {
    const cached = cache.get(cacheKey(input));    // (fingerprint, archetype, taskId, stepBucket)
    if (cached) return { ...cached, decisionSource: 'fallback' };

    const h = heuristic.decide(input);
    if (h.confidence >= 0.85) return h;           // ~60–70% of steps

    try   { return await modelBrain.decide(input); }   // Reka → Gemini
    catch { return { ...h, decisionSource: 'fallback' }; }
  }
}
```

**HeuristicBrain scoring (designed):**
```
score(n) = 3.0 · goalKeywordMatch(n.name, task)
         + 2.0 · isPrimaryCtaVerb(n.name)
         + 1.0 · n.inViewport
         + 0.5 · isUnfilledRequiredField(n)
         - 2.0 · alreadyTriedThisState(n)
         - 3.0 · isNavigationalDistraction(n)
confidence = softmaxMargin(top1, top2)
```

**Target escalation rate: 25–40%.** *"We only spend a model call where a human would actually hesitate"* was intended as a headline demo metric, computed from `ModelCall GROUP BY source`.

### Budget arithmetic
```
12 scouts × ~18 steps            = 216 decisions
× 35% escalation                 = ~76 model calls per run
Gemini free tier ≈ 10–15 RPM     ⇒ ~6 min for one run   ✗ too slow for a 4-min demo
4 team keys, round-robin         ⇒ ~50 RPM ⇒ ~1.5 min    ✓
Reka free credits ($10/mo)       ⇒ no per-minute wall at our volume  ✓ primary
```

### Decision prompt contract
```json
{
  "thought": "one sentence, in this persona's voice, about what they see",
  "action": { "type": "click", "targetRef": "e12" },
  "confusion": 0.4,
  "confidence": 0.8
}
```
**Refs, never coordinates and never CSS.** The model picks `e12`; the harness maps `e12` to a Playwright locator. This is why a renamed CSS class cannot break the system.

## 2.5 Persona trait enforcement split (an important design decision)

Traits act in **two** places:

| Trait | Enforced in the harness (deterministic) | Passed to the model (prompt) |
|---|---|---|
| `patience` | Hard step/time cap. Run terminates. | Stated as remaining budget |
| `device` | Playwright viewport | "You're on a phone" |
| `inputMode: keyboard-only` | Action set restricted to Tab/Enter/Space | Stated |
| `inputMode: screen-reader` | Screenshot withheld — a11y tree only | Stated |
| `domainLiteracy` | — | Comprehension instruction |
| `riskAversion` | — | Hesitation instruction |
| `readingDepth` | Helper text stripped from snapshot below threshold | — |

> **Never trust the model to "be impatient."** Behavioural constraints that can be enforced mechanically are enforced mechanically. It's more reliable, free, and the correct answer when a judge asks how you know the personas are actually different from each other.

## 2.6 Chorus policy (designed and largely built)

For modeled persona `p` at state `s`, over out-edges `E(s)` plus a pseudo-edge `giveUp`:

```
utility(e) =  w_goal  · goalAlignment(e)
            + w_aff   · affordance(e)
            - w_jargon· jargonLoad(s) · (1 − p.domainLiteracy)
            - w_risk  · irreversibility(e) · p.riskAversion
            + w_fam   · patternFamiliarity(e) · p.priorFamiliarity

utility(giveUp) = giveUpBase
                + 2.0 · (stepsTaken / p.patience.maxSteps)
                + 1.5 · baseConfusion(s)
                - 1.0 · p.priorFamiliarity

P(e) = softmax(utility / τ),   τ = temperature · (1 + baseConfusion(s))
```

- `goalAlignment(e)` — reverse BFS from goal states gives every state a hop-distance; an edge that decreases it scores 1.0, decaying by `0.7^extraHops`
- `affordance(e)` — from static signals: in-viewport, non-empty accessible name, primary-CTA verb
- `jargonLoad(s)` — fraction of that state's accessible names flagged technical

### Calibration (designed, NOT built)
Six free weights, fit so Chorus reproduces what the Scouts actually observed:
```
observed = per-state dropout from scout traces (states with ≥3 grounded visits)
loss(W)  = mean(|chorusDropout(s, W) − observedDropout(s)|)
fit      = random search, 2000 samples in a bounded box,
           then coordinate descent, 50 iterations
```
Runs in under two seconds on a ≤40-node graph. **If `fitMae > 0.15`, mark the whole run's modeled numbers as low-confidence and say so.** A visible fit error is credibility, not weakness.

### Provenance assignment
Every `StateMetrics` carries `provenance`: `observed` if the state has ≥3 grounded scout visits, `modeled` if ≥1, `predicted` if zero. `ci95` comes from bootstrapping the Monte Carlo across 20 batches.

## 2.7 Drift (designed, NOT built)

Match every state in run A to a state in run B:
```
matchScore(a, b) = 0.40 · jaccard(a.roleNameSet, b.roleNameSet)
                 + 0.25 · (a.urlPattern === b.urlPattern ? 1 : 0)
                 + 0.20 · normalisedLevenshtein(a.primaryHeading, b.primaryHeading)
                 + 0.15 · (1 − hammingDistance(a.pHash, b.pHash) / 64)
```
Greedy assignment (N ≤ 40; Hungarian is unnecessary), threshold **0.55**. Below threshold ⇒ removed/added.
`pHash`: 8×8 dHash via `sharp` — grayscale, resize to 9×8, compare adjacent pixels, pack into a 64-bit hex string.

**Per tour step:** resolve the anchor against the matched state's snapshot.
`intact` → resolves at level 1–2 · `reanchored` → resolves at level 3–4, propose new anchor with `confidence = matchScore × nameSimilarity` · `broken` → no resolution.
**Nothing auto-applies.** Every re-anchor lands in the human approval queue.

## 2.8 Full designed API surface

| Method | Path | Purpose | Built? |
|---|---|---|---|
| `POST` | `/runs` | Create + start a run. Rejects 400 if `attestation !== true` | ✅ |
| `GET` | `/runs/:id` | Full run record: graph, traces, chorus, findings, tour | 🟡 partial |
| `GET` | `/runs/:id/events` | **SSE** progress stream | ✅ |
| `GET` | `/runs/:id/graph` | Graph only (Atlas hot path) | 🔴 returns stub |
| `GET` | `/runs/:id/findings` | Ranked findings | 🔴 returns stub |
| `POST` | `/runs/:id/tour` | Generate tour from top-N findings | ✅ |
| `PATCH` | `/tours/:id/steps/:stepId` | Approve / reject / edit a step | ✅ |
| `GET` | `/tours/:id/export` | `tour.json` + embed snippet | ✅ |
| `POST` | `/drift` | `{ baseRunId, headRunId }` → `DriftReport` | 🔴 |
| `POST` | `/drift/:id/apply` | Apply approved re-anchors → new tour version | 🔴 |
| `GET` | `/projects`, `/projects/:id/runs` | Project + run history | 🔴 |
| `GET` | `/health` | Engine + browser + provider status | 🟡 trivial |
| `GET` | `/static/runs/:runId/*` | Screenshots | ✅ |
| `DELETE` | `/runs/:id` | Cancel a run | 🔴 |
| `GET` | `/personas/archetypes` | Archetype library for Setup | 🔴 |
| `GET` | `/debug/decisions/:runId` | Decision cache inspector | 🔴 |
| `POST` | `/runs/:id/chorus` | *(not in spec — added during build)* | ✅ |

### SSE event contract (designed)
```ts
type RunEvent =
  | { t: 'stage';        stage: 'crawl'|'scout'|'calibrate'|'chorus'|'analyse'|'done'; pct: number }
  | { t: 'state-found';  state: AppState }
  | { t: 'action-found'; action: Action }
  | { t: 'scout-start';  personaId: string; label: string }
  | { t: 'scout-step';   personaId: string; step: ScoutStep }
  | { t: 'scout-end';    personaId: string; result: ScoutTrace['result'] }
  | { t: 'calibrated';   fitMae: number }
  | { t: 'chorus-done';  populationSize: number; completionRate: number }
  | { t: 'finding';      finding: Finding }
  | { t: 'error';        message: string; fatal: boolean };
```
**Built:** all except `calibrated` and `finding`. The built version adds an optional `status` field on `stage` and replaces `action` with `edge`.

## 2.9 Performance budgets (designed)

| Operation | Budget |
|---|---|
| Crawl, 15-state target | < 90 s |
| 12 scouts (2 waves of 6) | < 120 s |
| Calibration fit | < 2 s |
| Chorus, 1000 × 2 tasks | < 30 s |
| Analysis + findings | < 5 s |
| **URL → ranked Atlas, total** | **< 4 min** |
| Atlas first paint after data | < 1.5 s |
| Atlas steady state | ≥ 60 fps @ 40 nodes |
| Graph API payload | < 2 MB |

## 2.10 The design system (04-UIUX Brief)

### Design thesis
**The app is terrain. Users are water. Friction is where the flow pools and drains away.** The interface is a **bathymetric chart** — a depth survey of unknown water. Ink on deep water. Contour lines. Condensed chart labels. Survey-orange markers on a blue-black ground. A **survey instrument**, not a dashboard.

### Explicitly banned (the "we've stopped designing" list)
Near-black `#0A0A0A` + acid-green/violet accent · purple/indigo gradient hero · glassmorphism everywhere · Tron grid / neon wireframe / cyberpunk · animated gradient mesh backgrounds · emoji in product UI · decorative 3D shapes (**rule: every 3D element encodes data**) · more than one accent hue · centered marketing layout on a tool screen · bloom so strong text stops being readable.

### Colour tokens (normative)
```css
/* Substrate — deep water */
--chart-abyss:   #060D14;   --chart-deep:    #0A1620;
--chart-shelf:   #10202C;   --chart-shoal:   #17303E;
--rule:          #1F3D4D;   --rule-strong:   #2E5468;

/* Ink — warm bone on cold water (14.8:1 on --chart-deep) */
--ink-0:  #EDE4D3;   --ink-1:  #A8A395;   --ink-2:  #6E7A80;

/* Accent — the survey marker (ONE accent, nothing else) */
--marker: #FF7A45;   --marker-dim: #B8532C;
--marker-wash: rgba(255, 122, 69, 0.12);

/* Flow — persona current */
--flow: #8FC7D6;     --flow-dim: #4E7E8C;

/* Friction ramp — bathymetric, colorblind-safe, monotonic lightness */
--f-00: #12293A;  --f-20: #1E4A5C;  --f-40: #3E7484;
--f-60: #96A48F;  --f-80: #D8B06A;  --f-100: #FF7A45;

/* Semantic */
--ok: #8AA98C;  --warn: #E0A03C;  --danger: #FF7A45;  --info: #8FC7D6;
```
Interpolate the ramp in **OKLab**, not sRGB. **Colour is never the only encoding** — friction carries ramp colour **+** node elevation **+** contour ring count **+** the printed numeral.

### Provenance badges — shape first, colour second
| Badge | Glyph | Fill | Text |
|---|---|---|---|
| Observed | `▪` filled square | `--marker` | `--ink-0` |
| Modeled | `◪` half square | `--flow-dim` | `--ink-1` |
| Predicted | `▫` hollow, 1px dashed | none | `--ink-2` |

### Typography
| Role | Face | Used for |
|---|---|---|
| **Cartouche** | Instrument Serif 400/400i | Hero line and section cartouches **only** |
| **UI** | IBM Plex Sans 400/500/600 | All interface text |
| **Chart label** | IBM Plex Sans Condensed 500/600 | Atlas node labels, micro-labels, table headers |
| **Data** | IBM Plex Mono 400/500 | Every numeral, element ref, anchor, score, code |

Scale: `cartouche-1 48/1.05` · `cartouche-2 30/1.15` · `h1 22/1.25` · `h2 17/1.35` · `body 14/1.55` · `body-sm 12.5/1.5` · `label 11/1.35 uppercase +0.08em` · `data-xl 34/1.0` · `data-lg 20/1.1` · `data 13/1.35`.
**`font-variant-numeric: tabular-nums` on every element whose number can change.** Not optional.

### Space, shape, surface
```css
--s-1:4px --s-2:8px --s-3:12px --s-4:16px --s-5:24px --s-6:32px --s-7:48px --s-8:64px
--r-sm:3px --r-md:6px --r-lg:10px --r-full:999px
```
**Elevation on dark is border-lightness, not shadow.** Contour substrate at 3% opacity, `background-size: 420px`.

### Motion
```css
--t-instant:80ms --t-fast:140ms --t-base:220ms --t-slow:380ms --t-deliberate:600ms
--ease-out: cubic-bezier(0.16, 1, 0.30, 1);
```
Framer Motion springs: `{ stiffness: 260, damping: 28, mass: 0.9 }`.
Named animations: `node-birth` · `edge-draw` · `plumb-drop` · `contour-bloom` · `counter-roll` (**600 ms floor**) · `inspector-rise` · `view-crossfade` · `stage-advance` · `badge-pop` · `leak` · `marker-plant`.
**`prefers-reduced-motion`** kills particles, camera fly-to, contour bloom, and pulses; keeps opacity fades and counter rolls.

### The Atlas — the signature element
- **Chart plane** at `y = 0`, `--rule` at 12%, 1-unit spacing, fog to `--chart-abyss` (near 30, far 90)
- **Plumb lines** — 1px vertical line from node to plane, `--ink-2` at 35%. *Without these the graph is just floating cards.*
- **Contour rings** — concentric rings around each node's plumb point:
  ```
  ringCount  = floor(frictionScore / 20)     // 0–5
  ringRadius = 1.2 + i * 0.55
  ringColor  = frictionRamp(frictionScore)
  ringOpacity= 0.30 − i * 0.045
  ```
  Top-3 `fixValue` nodes get one additional **dashed** ring rotating at 0.08 rad/s.
- **Nodes** — `2.4 × 1.5` unit plane, screenshot texture (512×320 JPEG q70), emissive border in ramp colour, `Y = frictionScore/100 × 6`, billboarded on Y axis only
- **Edges** — quadratic Bézier tubes, radius `0.02 + traversalShare × 0.06`
- **Particles** — one `InstancedMesh`, 0.06-unit spheres, `--flow`, count `min(400, edges × 4)`
- **The leak** — at each node, a fraction of arriving particles equal to `dropout(s)` fades and drifts downward through the chart plane. *"Tune this carefully — it is the best visual argument in the product."*
- **Survey marker** — a small tripod beacon that plants on the selected node; the only element that is an object rather than data
- **Lighting** — ambient 0.38 `#4E7E8C`, key `[4,8,6]` 0.7 `#EDE4D3`, rim `[-6,2,-4]` 0.35 `--marker`, no shadows
- **Selection state** — selected node scale 1.06 full opacity; all others 55%; untouched edges 20%

---

# Part III — What Is Actually Built (verified, file by file)

## 3.1 Repository layout

```
dry-run/
├── package.json                 { "name": "dry-run", "private": true }   ← no scripts at all
├── pnpm-workspace.yaml          apps/* + packages/*
├── pnpm-lock.yaml               240 KB
├── .gitignore                   node_modules/ dist/ *.log .env .env.* data/
│
├── packages/
│   ├── core/                    @dry-run/core — shared types, enums, scoring  (Zod 4)
│   │   ├── src/index.ts         3 lines: re-exports enums, types, scoring
│   │   ├── src/enums.ts         64 lines — 8 Zod enums
│   │   ├── src/types.ts         149 lines — 13 Zod schemas + inferred types
│   │   ├── src/scoring.ts       99 lines — PRD §8 pure functions
│   │   ├── src/scoring.test.ts  124 lines — 11 tests, ALL PASSING
│   │   └── dist/                built output present
│   │
│   └── usher-rt/                @dry-run/usher-rt — embeddable tour runtime
│       ├── src/index.ts         357 lines — zero-dep vanilla TS
│       └── dist/usher-rt.js     5,342 bytes  ← under the 6 KB budget ✓
│
└── apps/
    ├── engine/                  Fastify + Playwright + Prisma  :4000
    │   ├── prisma/schema.prisma 281 lines — 10 models
    │   ├── prisma/seed.ts       32 lines — usr_local + proj_meridian
    │   ├── prisma.config.ts
    │   ├── .env                 DATABASE_URL only (NO LLM keys)
    │   ├── .env.example         DATABASE_URL only
    │   ├── _tour_dump.json      debug artifact
    │   ├── data/dryrun.db       3.0 MB, 28 runs
    │   ├── data/runs/           44 MB, 18 run folders of screenshots
    │   └── src/
    │       ├── server.ts        402 lines — Fastify app, all routes
    │       ├── cartographer.ts  249 lines — the BFS crawler
    │       ├── aria.ts          123 lines — ariaSnapshot parser + fingerprint
    │       ├── signals.ts       82 lines  — static signal computation
    │       ├── screenshots.ts   25 lines  — capture + sharp thumbnail
    │       ├── db.ts            93 lines  — Prisma client, mappers, boot pragmas
    │       ├── sse.ts           62 lines  — event emitter + replay buffer
    │       ├── stubs.ts         169 lines — hardcoded fake graph + findings
    │       ├── brain/
    │       │   ├── heuristic.ts 47 lines  — keyword CTA matcher
    │       │   ├── adapter.ts   148 lines — OpenAI-compatible LLM adapter
    │       │   ├── chorus.ts    446 lines — Monte Carlo simulation
    │       │   └── analysis.ts  173 lines — rule-based finding classifier
    │       ├── scouts/runner.ts 155 lines — the DUMMY scout
    │       └── usher/
    │           ├── compiler.ts  26 lines  — anchor generation
    │           └── generator.ts 98 lines  — tour step generation
    │
    ├── interface/               Next.js 16 (App Router) + React 19 + Tailwind 4  :3000
    │   ├── next.config.ts       proxy rewrites + compress:false
    │   ├── tailwind.config.ts   design tokens (DEVIATED — see §6.6)
    │   ├── AGENTS.md/CLAUDE.md  Next.js-generated agent notes
    │   ├── _run_dump.json       debug artifact
    │   └── src/
    │       ├── app/layout.tsx           43 lines — fonts + contour bg
    │       ├── app/globals.css          contour SVG substrate
    │       ├── app/page.tsx             66 lines — Launchpad
    │       ├── app/new/page.tsx         148 lines — Run Setup
    │       ├── app/runs/[id]/layout.tsx 38 lines — console shell
    │       ├── app/runs/[id]/ViewTabs.tsx 42 lines — 5 view tabs
    │       ├── app/runs/[id]/page.tsx   30 lines — view router (3 of 5 are stubs)
    │       └── components/
    │           ├── LiveConsole.tsx      235 lines — SSE console
    │           ├── Atlas2D.tsx          178 lines — SVG force graph
    │           ├── Atlas3D.tsx          223 lines — R3F 3D graph
    │           ├── AtlasInspector.tsx   55 lines  — shared bottom sheet
    │           └── TourBuilder.tsx      433 lines — approve/edit/export
    │
    └── demo/                    Vite + React — "Meridian" target app  :5173
        └── src/
            ├── App.tsx          26 lines — 6 routes
            ├── App.css          the planted-defect CSS lives here
            ├── components/Shell.tsx
            └── pages/           Signup, Workspace, Connect, Invite, Webhook, Dashboard
```

## 3.2 `packages/core` — shared contracts

### `enums.ts` — 8 Zod enums (the single source of truth, since Prisma/SQLite has no enums)

```ts
RunStatus       = CREATED | CRAWLING | SCOUTING | CALIBRATING | CHORUS
                | ANALYZING | TOURING | DONE | FAILED | DEGRADED
RunStage        = crawl | scouts | calibration | chorus | analysis | tour | done
FindingSignature= hidden-cta | ambiguous-cta | silent-validation | dead-end
                | offscreen-control | jargon-gate | excessive-choice | slow-response
Provenance      = observed | modeled | predicted
StepStatus      = proposed | approved | edited | rejected
ActionType      = click | type | select | navigate | wait
DeviceType      = desktop-1440 | laptop-1280 | mobile-390
InputMode       = pointer | keyboard-only | screen-reader
DecisionSource  = heuristic | model | fallback
```

> **⚠️ Only `CRAWLING`, `DONE`, and `FAILED` are ever written by any code.** `SCOUTING`, `CALIBRATING`, `CHORUS`, `ANALYZING`, `TOURING`, and `DEGRADED` exist in the enum but are dead. `CREATED` only appears as a schema default.

### `types.ts` — 13 schemas (see Appendix C for the full listing)

Implemented: `Box`, `SemanticAnchor`, `A11yNode`, `AppState`, `ActionEdge`, `StateGraph`, `PersonaTraitVector`, `TaskDefinition`, `StateMetrics`, `Finding`, `TourStep`.

**Missing versus the TRD contract:** `StaticSignals` (typed), `SoftFingerprint`, `ScoutStep`, `ScoutTrace`, `CalibrationParams`, `Tour`, `DriftReport`, `Persona` (only the trait vector exists), `Viewport`.

### `scoring.ts` — PRD §8, verbatim, and the only tested module

```ts
FRICTION_WEIGHTS = { dropout:0.35, blocked:0.20, loop:0.15,
                     deadClick:0.12, hesitation:0.10, backtrack:0.08 }  // sums to 1.00

calculateDropout(entered, terminated)        → terminated / entered
calculateBlocked(entered, blocked)           → blocked / entered
calculateLoop(visitsPerPersona[])            → min(mean(visits−1), 5) / 5
calculateDeadClick(dead, total)              → dead / total
calculateHesitation(stepsBeforeGoalAction[]) → median / (median + 4)   ← see note
calculateBacktrack(reverseTraversals, exits) → reverse / exits
calculateFrictionScore(metrics)              → 100 × Σ(weight × metric)
calculateFixValue(impact, reach, confidence) → impact × reach × confidence
```

> **Documented interpretation:** the PRD specified "median steps before the first goal-advancing action, **squashed to 0-1**" without giving a formula. The implementation chose `x/(x+k)` with `k = 4` — a monotonic saturating curve where hesitation = 0.5 at 4 steps. This is annotated in the source. **Keep this note when migrating** — it's a judgement call, not a spec value.

**Test status (verified 2026-09-04): 11/11 passing, 598 ms.** Covers the hand-computed fixture (friction = 27.0), weight-sum invariant, all-zero and all-one boundaries, Fix Value fixture (0.36), zero-denominator guards, and even-length median.

## 3.3 `apps/engine` — the backend

### 3.3.1 `server.ts` — Fastify app

**Registered:** `@fastify/cors` (origin: true), `@fastify/static` at `/static/runs/` (creates `data/runs` at boot so a fresh checkout doesn't crash).

**Routes as built:**

| Route | Behaviour |
|---|---|
| `GET /health` | Returns `{status:"ok", engine:"fastify", version:"1.0.0"}` — no browser/provider status |
| `GET /runs/:id` | **Real.** Returns `{id, status, stage, targetUrl, graph, findings}` |
| `GET /runs/:id/graph` | **Returns `stubGraph`** — ignores the id entirely |
| `GET /runs/:id/findings` | **Returns `stubFindings`** — ignores the id entirely |
| `POST /runs` | **Real.** Validates `attestation === true` (400 otherwise) and `targetUrl` non-empty. Creates `Run` (hardcoded `projectId: "proj_meridian"`, `userId: "usr_local"`) + `Attestation`. Then fires `void runCrawl(...)` **and** `void runDummyScout(...)` — both fire-and-forget, in parallel. Returns `{runId}` immediately. |
| `GET /runs/:id/events` | **Real SSE.** `reply.hijack()`, writes `text/event-stream`, subscribes with replay of buffered events, unsubscribes on close. |
| `POST /runs/:id/tour` | **Real and idempotent** — returns the existing latest-version tour if one exists rather than regenerating (preserves human approval decisions). Otherwise reads the graph + findings, generates steps, and creates `Tour` + `TourStep` rows in one transaction. |
| `PATCH /tours/:id/steps/:stepId` | **Real.** Any title/body/placement edit forces `status: "edited"` (which counts as approved). Validates status against the Zod enum. Stamps `approvedBy`/`approvedAt`. Preserves `originalTitle`/`originalBody` on first edit. |
| `GET /tours/:id/export` | **Real, approval-gated.** Filters to `approved` \| `edited` steps only; 400 if none. Returns `{tourJson, embedSnippet}`. |
| `GET /usher-rt.js` | Serves the built IIFE bundle from `packages/usher-rt/dist/`; 503 with a build hint if missing. |
| `POST /runs/:id/chorus` | **Real, and the only way to advance the pipeline.** Runs `runChorusSimulation(graph, DEFAULT_PERSONA_MIX, 1000)`, writes `metrics` + `populationSize`, emits `chorus-done`, then fires `void runAnalysis(runId)`. |

**`DEFAULT_PERSONA_MIX`** — hardcoded in `server.ts`, **4 archetypes** (not the designed 10):

| Role | domainLiteracy | patience | riskAversion | readingDepth | priorFamiliarity | device | inputMode | weight |
|---|---|---|---|---|---|---|---|---|
| Impatient Founder | 0.6 | 6 | 0.3 | 0.2 | 0.2 | desktop-1440 | pointer | 0.30 |
| Cautious Ops Lead | 0.8 | 14 | 0.7 | 0.7 | 0.5 | laptop-1280 | pointer | 0.25 |
| Non-technical Marketer | 0.3 | 8 | 0.5 | 0.4 | 0.1 | desktop-1440 | pointer | 0.25 |
| Jargon-Fluent Engineer | 0.95 | 12 | 0.4 | 0.6 | 0.8 | laptop-1280 | keyboard-only | 0.20 |

**`ENGINE_ORIGIN`** is hardcoded to `http://localhost:4000` — annotated in source: the Next.js `/api/*` rewrite means the incoming `Host` header can't be trusted to reconstruct the engine's reachable origin, and the export snippet must point somewhere a *third-party* page can load a script from.

### 3.3.2 `cartographer.ts` — the crawler (the strongest module)

**Algorithm as built:**

```
1. Launch chromium (fresh browser per run — NOT kept warm across runs)
2. goto(url), settle 300ms
3. Snapshot root: ariaSnapshot({ mode:"ai", boxes:true }) → parse → fingerprint
4. Capture screenshot + thumbnail; compute static signals; emit state-found
5. Push root onto a plain FIFO queue
6. while queue not empty AND nodeCount < 15:
     a. pop front
     b. gotoAndReplay(root → front) — replays the whole path from root
     c. fill all input candidates with synthetic data
     d. for each input node: record a SELF-LOOP edge (from=to=front)
     e. for each click candidate:
          - skip if isDestructiveName(name)
          - REPLAY THE PATH AGAIN (fresh arrival per candidate)
          - refill inputs
          - getByRole(role, {name, exact}).nth(ordinal).click()
          - wait for load + 300ms
          - snapshot → fingerprint
          - if fingerprint unseen: create new state, screenshot, signals,
            push to queue with path = [...front.path, {inputs, anchor}]
          - record the edge (to = existing or new state id)
7. saveCrawlResult(graph, {stateCount, actionCount, truncated})
8. emit stage: "scouts", pct: 0     ← and then STOPS. Nothing calls scouts.
```

**Key constants:** `CRAWL_BUDGET = 15` states (hardcoded) · `SETTLE_MS = 300` · fixed synthetic names `["Alex Rivera","Jordan Lee","Sam Patel","Riley Chen"]`.

**Synthetic form filler (safety-compliant):**
```
email    → dryrun+<runId>@example.invalid
password → Dryrun!Synthetic1
url      → https://example.invalid/dryrun
tel      → +15555550100
number   → 1
*name*   → one of the four fixed names
default  → "Dry Run sample text"
```

**Path replay strategy:** the crawler never uses `goBack()`. It always re-navigates from the root and replays the whole action path, refilling inputs at every hop (because a fresh reload starts with empty, browser-validated fields). This is O(depth) navigations per candidate — correct, and slow. On the demo app it is fine.

**Error handling:** any throw sets `Run.status = FAILED` with the message and emits a fatal SSE error. The browser is always closed in `finally`.

### 3.3.3 `aria.ts` — the a11y snapshot parser (the technical keystone)

Parses Playwright's `ariaSnapshot({ mode:"ai", boxes:true })` YAML-ish outline:
```
- heading "Create your account" [level=1] [ref=e7] [box=457,141,366,33]
- textbox "Email" [ref=e12] [box=457,251,366,37]
```

**Regex-driven line parser** extracting `role`, quoted `name`, bracketed attrs (`ref`, `box`, `level`, …), computing depth from indentation (`indent / 2`).

**Landmark tracking:** maintains a stack of `{depth, role}` for the 8 landmark roles (`banner`, `complementary`, `contentinfo`, `form`, `main`, `navigation`, `region`, `search`). Each node gets the nearest ancestor landmark's **role string** (not a path).

**Ordinal:** a counter keyed on `` `${role}::${name}` `` — global across the document, **not** scoped to the landmark.

**Fingerprint:**
```
sha1( join("\n", ["<depth>:<role>", ...]) )   // document order, "text" roles excluded
```
This is **purely structural** — it ignores names, text content, and boxes. The `text` role is skipped specifically so that typing into a field (which changes a text leaf's literal value) does not look like a new state.

**Classification:**
```
CLICKABLE_ROLES = { button, link }
INPUT_ROLES     = { textbox, searchbox, checkbox, radio, combobox }
```

**Destructive blocklist (verbatim from TRD §9.3):**
```regex
/\b(delete|remove|destroy|pay|purchase|buy|checkout|subscribe|publish|send|
    submit payment|cancel subscription|deactivate|close account|transfer)\b/i
```

### 3.3.4 `signals.ts` — static signals (zero AI)

Implements a real **WCAG relative-luminance contrast calculation** (sRGB linearisation, 0.2126/0.7152/0.0722 coefficients, `(L1+0.05)/(L2+0.05)`), walking up to 6 ancestors to find a non-transparent background.

**Signals produced:**
```ts
{
  interactiveCount: number,          // count of 7 interactive roles
  belowFoldPrimaryCta: boolean,      // first button's box.y > viewport.height
  offscreenControls: string[],       // names of interactives fully outside viewport bounds
  primaryCtaContrastRatio: number|null,
  primaryCtaLowContrast: boolean     // ratio < 4.5
}
```

**Designed but missing:** `unlabeledInteractives`, `competingCtas`, `lowContrastText` (near form fields — only the primary CTA is measured), `hasAriaLive`, `jargonScore`, `formFieldCount`.

### 3.3.5 `screenshots.ts`

`page.screenshot({fullPage:true, type:"jpeg", quality:80})` → `data/runs/<runId>/<stateId>.jpg`, plus a `sharp` resize to **320w q70** → `.thumb.jpg`. Returns the relative URL `/static/runs/<runId>/<stateId>.jpg`.
*Spec wanted 512×320 thumbnails and both full + viewport captures.* Measured output: full ≈ 19–110 KB, thumb ≈ 2–8 KB.

### 3.3.6 `db.ts`

- Exports the singleton `PrismaClient`
- `toCoreFinding(row)` — bridges the DB's operational `Finding` (rank, impact, reach, confidence, groundedTraceIds…) to `@dry-run/core`'s domain `Finding`
- `toCoreTourStep(row)` — parses the `anchor` TEXT column and recovers `stateId` via the `sourceFindingId → Finding` relation (there is no `stateId` column on `TourStep`)
- `saveCrawlResult(...)` — the one place `StateGraph` JSON serialisation is enforced
- `bootDatabase()` — sets `PRAGMA foreign_keys = ON` and `journal_mode = WAL`, then sweeps orphaned runs

> **⚠️ The orphan sweep only covers `CRAWLING`, `SCOUTING`, `CHORUS`** — it misses `CALIBRATING`, `ANALYZING`, `TOURING`, and `CREATED`. And `PRAGMA synchronous = NORMAL` / `busy_timeout = 5000` are **not set** (both were specified).

### 3.3.7 `sse.ts` — the event bus

A Node `EventEmitter` with `setMaxListeners(0)`, plus a **replay buffer**: `Map<runId, RunEvent[]>`. Every emitted event is appended; every new subscriber is first replayed the whole log.

> **Why the replay buffer exists (annotated in source):** a fast local crawl can finish and emit every event *before* the browser's `EventSource` finishes connecting through the Next.js rewrite. Without replay, a late subscriber sees silence even though the run produced real data. **This buffer is never evicted** — a long-lived engine leaks memory proportional to total events across all runs.

**Event union as built:** `stage` (with optional `status`) · `state-found` · `action-found` (carries `edge`, not `action`) · `scout-start` · `scout-step` · `scout-end` · `chorus-done` · `error`. **Missing:** `calibrated`, `finding`.

### 3.3.8 `stubs.ts` — the fake graph (still load-bearing)

A hardcoded 3-node graph (`s_signup` → `s_connect` → `s_dashboard`) with 2 edges and 2 hardcoded findings. It is served by `GET /runs/:id/graph` and `GET /runs/:id/findings`, **and it is what the dummy scout actually walks**. This was a Hour-0 walking-skeleton artifact that never got removed from the live paths.

### 3.3.9 `brain/heuristic.ts` — the heuristic brain (simplified)

```ts
evaluateHeuristic(state, task):
  buttons = a11yTree.filter(role === "button")
  1. if a button's name contains task.goalPredicate.target → click it
  2. else if a button matches /continue|next|submit|sign up|sign in|log in|
                              create|connect|get started|save|confirm/i → click it
  3. else return null
```

Returns a partial `ActionEdge` with `toStateId: ""` (unknown until executed).

**Missing versus design:** no weighted scoring, no `confidence` output, no softmax margin, no in-viewport bonus, no unfilled-required-field bonus, no already-tried penalty, no navigational-distraction penalty, and **no persona `inputMode` filtering**.

### 3.3.10 `brain/adapter.ts` — the LLM adapter

- Two providers configured, both OpenAI-compatible: **Reka** (`https://api.reka.ai/v1`, `reka-flash`) and **Gemini** (`https://generativelanguage.googleapis.com/v1beta/openai`, `gemini-2.0-flash`). Selected by `LLM_PROVIDER` env, default `reka`.
- **If no API key is configured, `client` stays `null` and `evaluateWithLLM` is a no-op returning `null`.** This is the deliberate offline path — annotated as such.
- Zod **discriminated union** on `giveUp` validates the model response.
- **`hydrateActionEdge`** looks up ground-truth anchor fields by `ref` from the real a11y tree — it *never trusts the model to echo them back*. A hallucinated ref returns `null`. This is the correct and important design.
- The user prompt sends **only** `{ref, role, name}` per node — no coordinates, no CSS.
- `temperature: 0.2`, `response_format: {type:"json_object"}`.

**Missing:** no key pool / round-robin, no 429 cooldown, no provider failover chain, no retry-with-parse-error, no screenshot/multimodal content block, no persona-trait behavioural system prompt beyond the raw trait JSON, no caching, no `ModelCall` logging.

> **⚠️ The `.env` file contains only `DATABASE_URL`. No `REKA_API_KEY` or `GEMINI_API_KEY` is set, so in the current checkout the LLM path is completely inert.**

### 3.3.11 `brain/chorus.ts` — the Monte Carlo simulator (446 lines, the most complete module)

**Weights (hand-picked, NOT calibrated — annotated as such):**
```ts
WEIGHTS = { goal: 2.0, affordance: 1.0, jargon: 1.5, giveUpBase: -1.0, temperature: 1.0 }
MAX_STEP_BUFFER = 5;  HARD_STEP_CEILING = 30;
```

**Components implemented:**

| Piece | Implementation |
|---|---|
| PRNG | `mulberry32(0xC0FFEE)` — fixed seed, fully deterministic |
| Softmax | Numerically stable (max-subtraction), with a uniform fallback on non-finite sums |
| `jargonLoad(state)` | Uses `staticSignals.jargonScore` if cached, else falls back to a **41-word built-in jargon list** (`api`, `webhook`, `idempotency`, `backfill`, `payload`, `oauth`, `sso`, …). Returns flagged-names ÷ total-names. |
| `affordance(edge, state)` | `(inViewport + hasName + isPrimaryCtaVerb) / 3` |
| `goalAlignment(from, to)` | `0.7^max(0, toDist − (fromDist − 1))`; returns 0 for unreachable |
| `computeHopDistances` | **Reverse multi-source BFS from every sink state.** Since the function takes no task/goal predicate, "reaching a natural endpoint of the flow" is the only goal definition available. |
| `pickStartStateId` | First state with no incoming non-self edge, else the first state |
| `allocatePersonaCounts` | Weight-proportional with **largest-remainder** distribution — exact totals |
| Per-persona walk | Enter → compute utilities for all navigable out-edges + a `giveUp` pseudo-edge → softmax with `τ = temperature × (1 + confusion)` → weighted pick → record interaction/self-loop/backtrack/hesitation → advance |
| Termination | Sink reached = `success` · giveUp chosen = `dropout` · step ceiling hit = `blocked` |
| Metrics | All six sub-metrics via `@dry-run/core`, then `frictionScore`, then `fixValue` |

**`impact` / `reach` / `confidence` proxies (annotated as proxies, not spec values):**
```
reach      = min(1, entered / simulatedTotal)   // clamped: `entered` counts arrivals, not unique personas
impact     = frictionScore / 100                // NOT the spec's failure-attribution share
confidence = min(1, entered / 50)               // NOT the spec's 0.5 + 0.5·min(1, groundedVisits/5)
provenance = "modeled"                          // hardcoded — no observed/predicted assignment
```

**Missing:** calibration fitting, `riskAversion`/`irreversibility` term, `priorFamiliarity`/`patternFamiliarity` term, per-task simulation (no task is passed in at all), confidence intervals / bootstrapping, per-archetype metric breakdown.

### 3.3.12 `brain/analysis.ts` — the finding classifier

Reads `Run.graph` and `Run.metrics` back out of SQLite, classifies each state, writes `Finding` rows, and sets `stage: "tour", status: "DONE"` in one transaction.

**Thresholds (hand-picked, annotated as uncalibrated):**
```
FRICTION_THRESHOLD = 40   // below this, no finding at all
DEAD_CLICK_HIGH    = 0.25
JARGON_HIGH        = 0.25
LOOP_HIGH          = 0.25
BACKTRACK_HIGH     = 0.25
BLOCKED_HIGH       = 0.20
```

**Ordered classification rules (first match wins):**

| Order | Condition | Signature emitted |
|---|---|---|
| 1 | `staticSignals.belowFoldPrimaryCta` | `offscreen-control` |
| 2 | `staticSignals.primaryCtaLowContrast` | `hidden-cta` |
| 3 | `deadClick ≥ 0.25` | `silent-validation` |
| 4 | `jargonLoad ≥ 0.25` | `jargon-gate` |
| 5 | `loop ≥ 0.25` | `excessive-choice` |
| 6 | `backtrack ≥ 0.25` | `ambiguous-cta` |
| 7 | `blocked ≥ 0.20` | `dead-end` |
| — | none matched | `null` (annotated: "a real gap, not papered over") |

> **⚠️ Signature semantics are crossed versus the spec.** Below-the-fold CTA is the textbook definition of **`hidden-cta`**, but the implementation labels it `offscreen-control`; low contrast is labelled `hidden-cta` where the spec's `silent-validation` (low contrast + no aria-live) fits better; dead clicks are labelled `silent-validation` where the spec's `ambiguous-cta` (competing CTAs + dead clicks) fits better. **This mapping must be corrected on migration** — it will produce misleading finding titles and will break any evaluation harness measuring recall against the six planted defects.

**`slow-response` is deliberately never emitted** — nothing collects response latency, and the source annotates that mapping it to a proxy would be a fabricated label.

**Also empty by design-gap:** `groundedTraceIds: []` (no ScoutTrace cross-referencing) and `affectedSegments: []` (Chorus exposes no per-archetype breakdown). Evidence carries only the state screenshot, never quotes.

### 3.3.13 `usher/compiler.ts` + `usher/generator.ts`

**`generateSemanticAnchor(node)`** produces `{role, name, landmark, ordinal, dataTestId, selectorFallback}`. `selectorFallback` is a **human-readable debug string**, explicitly *not* a CSS selector.

**`generateTourFromFindings(runId, findings, graph)`**:
1. Sort findings by `fixValue` desc, take **top 3**
2. For each: look up the state; if missing, skip
3. Pick the "implicated node" heuristically: first `button` → first `link` → first `textbox` → first node
4. Apply the per-signature copy template
5. Emit `{order, stateId, anchor, title, body, placement:"bottom", status:"proposed"}`

**All 8 signature templates exist**, each folding the finding's own `explanation` into the body so copy isn't generic boilerplate.

> **Known limitation, annotated in source:** findings carry only a `stateId`, never a specific element ref — so "which element does this step point at" is a heuristic guess, not grounded evidence.

`server.ts` compensates for skipped findings with a one-cursor walk over the same `fixValue` sort to recover which finding produced each surviving step.

### 3.3.14 `prisma/schema.prisma` — 10 models

**Implemented:** `User`, `Project`, `Run`, `ScoutTrace`, `Finding`, `Tour`, `TourStep`, `DriftReport`, `Attestation`, `ModelCall`.

**Missing versus Backend Schema §4:** `Session` (P1), `PersonaArchetype`, `DecisionCache`, `Setting`.

All the good decisions from the spec survived:
- `Attestation.runId` is a **plain String, not a foreign key** — deliberately, so an audit record doesn't vanish when the run it audits is deleted
- Big structures (`graph`, `calibration`, `chorus`, `metrics`, `config`) are `String` columns holding JSON
- Denormalised counters on `Run` (`stateCount`, `actionCount`, `findingCount`, `topFrictionScore`, `fitMae`, `truncated`) so list views don't parse blobs
- `TourStep` is normalised because steps are PATCHed individually
- `Tour.parentTourId` self-relation for v1 → v2 versioning
- `@@unique([baseRunId, headRunId])` on `DriftReport`

> **🔴 BLOCKING BUG (uncommitted):** the working-tree `schema.prisma` has `generator client { provider = "9-client-js" }`. The committed value is `"prisma-client-js"`. `9-client-js` is not a valid Prisma generator — **`prisma generate` will fail on a fresh checkout of the working tree.** Fix this first.

**`ModelCall` has zero writes anywhere in the codebase** — the table exists, the escalation-rate demo metric it was built for was never wired up.

### 3.3.15 `prisma/seed.ts`

Upserts exactly two rows: `User { id:"usr_local", email:"local@dryrun.dev" }` and `Project { id:"proj_meridian", targetUrl:"http://localhost:5173" }`.
**Missing:** the ten built-in `PersonaArchetype` rows (there is no such table).

## 3.4 `packages/usher-rt` — the embeddable tour runtime

**357 lines of zero-dependency vanilla TS**, bundled by esbuild to a minified IIFE. **Built size: 5,342 bytes** — comfortably under the 6 KB budget. Exposes `window.DryRunTour.start(tourJson)`.

**Hand-rolled accessible-name computation** (the spec's ~60-line subset):
`aria-label` → `aria-labelledby` (resolved through `getElementById`) → `textContent` → `title` → `placeholder`.

**Hand-rolled role computation:** explicit `role` attr → tag mapping (`button`/`summary`→button, `a[href]`→link, `select`→combobox, `textarea`→textbox, `input`→by type, plus the 6 landmark tags).

**Anchor resolution ladder (tiers 1–4 + null):**
1. `[data-testid="…"]` via `CSS.escape`
2. Exact `role` + exact accessible name, scoped to the landmark root (or `document.body`)
3. Fuzzy: same role, **normalised Levenshtein similarity ≥ 0.8**, best match wins
4. Same role, `ordinal`-th match
5. → `null` (step is BROKEN)

> **Deliberately skipped:** tier 5 (`fallbackSelectors`). Annotated in source: `selectorFallback` is a human-readable debug string on the engine side, not a CSS selector — using it as one would never match and would silently mask a real BROKEN step.

**Levenshtein is implemented with a single rolling row** — O(min(a,b)) space.

**UI:** a fixed full-viewport overlay (`z-index: 2147483000`, `pointer-events:none`) containing a spotlight `div` (a `box-shadow: 0 0 0 9999px rgba(7,14,21,.72)` cutout) and a tooltip. Placement supports `top`/`bottom`/`left`/`right`/`center`. Repositions on `scroll` (capture) and `resize`. If the anchor doesn't resolve, the tooltip **centres itself and the spotlight hides** — graceful, not broken.

**Tooltip content:** "Step N of M" eyebrow, title, body, `Skip tour` and `Next`/`Done` buttons. Supports `advanceOn: {type:"click"}` by attaching a one-shot listener to the target.

**Styling is inline** and roughly matches the brief (`#1A3247` panel, `#EAE6DF` text, `#FF5A00` button) — though those are the drifted tokens, not the spec's.

## 3.5 `apps/interface` — the Next.js frontend

**Stack:** Next.js **16.3.3**, React **19.2.8**, Tailwind **v4** (`@tailwindcss/postcss`), `@react-three/fiber` 9, `@react-three/drei` 10, `three` 0.185, `d3-force-3d` 3.
**Notably absent:** `framer-motion`, `lucide-react`, `clsx`, `@react-three/postprocessing` — all specified, none installed.

### 3.5.1 `next.config.ts` — two proxy rewrites plus one hard-won fix

```ts
compress: false,        // ← the important one
rewrites: [
  { source: "/api/:path*",    destination: "http://localhost:4000/:path*" },
  { source: "/static/:path*", destination: "http://localhost:4000/static/:path*" },
]
```

> **Carry this forward.** The annotation records a real debugging session: gzip buffers output until a flush threshold that an SSE stream may never reach, so a real browser (which always sends `Accept-Encoding: gzip`) hangs indefinitely waiting for events that already arrived at the Next.js server. `curl` doesn't send that header by default, which is why it was invisible to every curl-based check.

### 3.5.2 `layout.tsx` + `globals.css`

Loads **Instrument Serif** (400 + italic), **IBM Plex Sans** (400/500/600), **IBM Plex Mono** (400/500) via `next/font/google` with `display: swap`. Sets `font-variant-numeric: tabular-nums` globally on `body`.

**IBM Plex Sans Condensed is not loaded** — the brief's chart-label face is missing.

The **contour substrate** is implemented properly: a `.contour-bg::before` pseudo-element with an inline data-URI SVG of four concentric irregular closed curves, `background-size: 420px`, **stroke opacity baked at 0.03 inside the SVG** (not a CSS opacity on the element) so it never dims real content. Content is lifted to `z-index: 1`.

### 3.5.3 Launchpad (`app/page.tsx`) — 66 lines

Top bar (logo + non-functional "Settings"/"Docs" spans), the Instrument Serif italic hero line, a URL input + "Launch Dry Run →" button that navigates to `/new?url=…`, and a "Try the demo target ›" link to `/new?preset=meridian`.

**Missing:** Recent Runs / run history, `GET /health` check + engine-unreachable banner, the ambient rotating Atlas preview, per-run "Compare" action, Settings drawer.

### 3.5.4 Run Setup (`app/new/page.tsx`) — 148 lines

Three sections: **1. Target URL** (prefilled from `?url=` or `?preset=meridian` → `http://localhost:5173`), **2. Attestation gate** (a `--marker-wash` inset block with a left border, exactly as specified), **3. Preset task** (a read-only display of "Complete initial setup").

Launch button is disabled until attested + URL non-empty; posts `{targetUrl, attestation: true}`; distinguishes network failure from a 4xx/5xx body error; preserves form state on error; navigates to `/runs/:id?view=live` on success.

**Missing:** task editor (add/edit/delete, goal-predicate picker), population slider, archetype chips + weight mixer, Advanced disclosure (seeded login, crawl budget, allowlist), debounced reachability probe, cost/time estimate line.

### 3.5.5 Run Console (`app/runs/[id]/`)

- **`layout.tsx`** — fixed 56px top bar with logo, breadcrumb (`Project · run <id>` — the raw cuid, no project name), and `ViewTabs`
- **`ViewTabs.tsx`** — five tabs (Live / Atlas / Findings / Tour / Drift) with a `--marker` underline on the active one, driven by `?view=`
- **`page.tsx`** — the router: `live` (or undefined) → `<LiveConsole>`, `tour` → `<TourBuilder>`, **everything else → the literal string `"<View> view stub"`**

> **Atlas, Findings, and Drift views do not exist.** Three of the five tabs render a placeholder sentence.

### 3.5.6 `LiveConsole.tsx` — 235 lines, and genuinely good

Opens an `EventSource` on `/api/runs/:id/events`, accumulates `discoveredStates`, `edges`, `scoutSteps`, and a raw `events` log (each capped at 200 entries).

**Auto-transition:** on a `stage` event carrying `status === "DONE"`, it closes the EventSource immediately, then `router.replace(...?view=atlas)` after 800 ms. Annotated: `replace` not `push`, so Back from Atlas doesn't bounce forward into the redirect again. Also annotated that the real signal is `status === "DONE"`, **not** `stage === "done"` — because there is no stage literally named `done` in this implementation.

**Three panels on the right:** a **Stage rail** (7 rows, dot coloured current/past/pending, percentage on the active row), a **Scout feed** (`aria-live="polite"`, think-aloud text + `stateId · decisionSource`), and a raw **Event feed** (monospace, `describeEvent()` formatted).

**Left:** a 3D/2D toggle above a live-building Atlas that receives `discoveredStates` and `edges` as they stream in.

**Missing:** stage percentages driving a top progress bar, scout cards with terminal states (green check / amber gave-up / red blocked), `calibrated` fit display, population counter animation, findings badge, toasts, cancel-run, "Stay on Live" escape.

### 3.5.7 `Atlas2D.tsx` — 178 lines

`d3-force-3d` in 2D mode (`forceSimulation(nodes, 2)`) with charge (−260), link (distance 130), center, and collide forces; `.stop()` then `.tick(300)` — precomputed, frozen, no continuous simulation. Renders as SVG in a 760×440 viewBox.

**Nodes:** three concentric circles (r+16, r+8, r) — the contour-ring motif — with the title truncated to 18 chars below. Selection swaps the ring colour to `--marker` and thickens the stroke.

**Accessibility done right:** `role="img"` with a live `aria-label` summary on the SVG; each node group is `role="button"`, `tabIndex={0}`, `aria-pressed`, with Enter/Space keyboard activation.

**A real bug fixed, with a comment:** `forceLink` throws on an unresolvable id, and an `action-found` edge can legitimately race ahead of its target's `state-found` event over SSE — so links are filtered to those whose both endpoints are already known.

> **The contour rings are annotated as "decorative until real friction metrics exist."** Ring count is fixed at 2, not `floor(friction/20)`. There is no friction ramp, no elevation, no score numeral.

### 3.5.8 `Atlas3D.tsx` — 223 lines

Same `d3-force-3d` layout in 3D (charge −30, link distance 6, collide 2, 300 ticks). R3F `<Canvas camera={{position:[0,6,16], fov:45}}>` with ambient (`#4E7E8C` @ 0.6), a key directional light (`[4,8,6]`, `#EDE4D3` @ 0.7), a `gridHelper` chart plane, and damped `OrbitControls` (dampingFactor 0.08, min 8 / max 60).

**Nodes:** `planeGeometry(2.4, 1.5)` textured with the state screenshot, wrapped in **both** a `Suspense` boundary and a custom `TextureErrorBoundary` class component so a 404'd texture can't take down the whole canvas. **Y-axis-only billboarding** via `useFrame` computing `rotation.y = atan2(dx, dz)` — the layout stays readable rather than every node facing the camera. A `<Line>` plumb line drops from each node to the plane. An `edgesGeometry` outline provides the friction-coloured border.

**Edges:** `QuadraticBezierLine` with a midpoint lifted above the higher endpoint.

> **`const frictionScore = 0;`** — annotated: `AppState` carries no friction score (that lives on `StateMetrics`, produced by Chorus/Analysis, never threaded through the live SSE graph). **Elevation is therefore always 0 and every node sits flat on the plane.** The single most visually important feature of the Atlas is inert.

**Missing:** contour rings, particles, the leak, survey marker, bloom/postprocessing, fly-to camera, selection dimming, node labels/score text, fog, rim light, FPS guard, reduced-motion.

### 3.5.9 `AtlasInspector.tsx` — 55 lines

Shared by both Atlas components ("clicking a node opens the same Inspector" is literally true — one component, not a visual echo). Shows title, URL, a close button, and a 4-up metric grid: **Friction / Fix value / Dropout / Provenance — all rendering `—`**, with the honest footer *"Metrics land once Analysis runs — not yet available for this run."*

### 3.5.10 `TourBuilder.tsx` — 433 lines, the most complete UI

On mount, fires `GET /api/runs/:id` and `POST /api/runs/:id/tour` in parallel (the POST being idempotent makes this safe).

**`AnchorChip`** renders `role "name"` in a dashed mono chip; clicking opens a popover showing the **full 5-tier resolution ladder** with the actual `dataTestId`, role, name, landmark, and ordinal filled in. *This is the component that makes the technical differentiation legible — it was called out in the demo script as the thing to open on stage, and it exists.*

**`StepCard`** handles four visual states: proposed (Edit/Reject/Approve row), editing (title input, body textarea, placement select, Cancel/Save), approved (green left border, **button row removed entirely** per UI/UX §8.4), and rejected (collapsed one-liner with a "restore" link).

**Sticky footer:** `N of M approved`, plus **Preview on target** and **Export**, both hard-disabled until ≥1 step is approved, with `title` attributes stating why.

**Export modal:** shows the embed snippet and pretty-printed `tour.json`, each with a copy button.

**Preview** is honest about a real constraint: it copies the embed snippet to the clipboard and opens the target in a new tab, with the note *"Cross-origin pages can't be scripted from here directly — paste it into the new tab's console to preview."* Clipboard failure is handled with an alternative instruction.

**Missing:** drag-to-reorder, source-finding attribution display, before/after diff on edited steps, real injected preview.

## 3.6 `apps/demo` — "Meridian", the target app

Vite 8 + React 19 + `react-router-dom` 7. Routes: `/` → redirect to `/signup`, then `/signup`, `/workspace`, `/connect`, `/invite`, `/webhook`, `/dashboard`. A shared `<Shell>` with a "Meridian" top bar. Deliberately plain CSS — white cards, `#2f6fed` primary buttons, 480px column. **It reads as a real mediocre SaaS, exactly as specified.**

### All six planted defects — verified present in code

| # | Where | Implementation | Verified |
|---|---|---|---|
| **D1** hidden-cta | `Workspace.tsx` + `.filler { min-height: 700px }` | Six paragraphs of "Why workspaces matter" filler sit between the name field and the "Create workspace" button. No sticky footer, no scroll cue. | ✅ |
| **D2** ambiguous-cta | `Connect.tsx` | Two identically-styled `.btn-primary` buttons. "Continue" is `onClick={() => setTick(t => t+1)}` — a pure no-op that re-renders the same state. | ✅ |
| **D3** silent-validation | `Connect.tsx` + `.key-error` | Key must start with `mk_`. On failure: `color: #3a3a3a` on `background: #333333` (**≈1.06:1**, even worse than the specified 1.9:1). No red border, no icon, **no `aria-live`**. | ✅ |
| **D4** dead-end | `Invite.tsx` | No skip option. "Back" is `onClick={() => {}}`. The only exit is entering an email and sending. | ✅ |
| **D5** offscreen-control | `Webhook.tsx` + `.modal-close` | `position: absolute; top: -12px; right: -40px` inside a `.modal { overflow: visible }`. Invisible at 390px. | ✅ |
| **D6** jargon-gate | `Webhook.tsx` | Body copy uses "payload envelope", "backfill window", "idempotency key" with no explanation and no help link. | ✅ |

### 🔴 Meridian v2 does not exist
The Drift demo requires a second build with "Connect source" renamed to "Add a source" and moved into a sidebar card. **This was never built.** Without it, Drift cannot be demonstrated even if the Drift subsystem were implemented.

---

# Part IV — Implementation Status Matrix

Every requirement ID from PRD §9, with verified status.
**Legend:** ✅ done · 🟡 partial · 🔴 not built · ⬜ P2/out of scope

## 4.1 Cartographer — Crawler & Graph

| ID | Feature | Pri | Status | Notes |
|---|---|---|---|---|
| CR-01 | Target intake: URL, creds, attestation | P0 | 🟡 | URL + attestation ✅; **no seeded credentials** |
| CR-02 | Headless Playwright crawl, BFS + priority queue | P0 | 🟡 | BFS ✅; **plain FIFO, no priority heuristic** |
| CR-03 | Accessibility-tree extraction per state | P0 | ✅ | `ariaSnapshot({mode:"ai", boxes:true})`, full parse |
| CR-04 | State fingerprinting and dedupe | P0 | 🟡 | Works, but **structural-only** (depth:role) — not the spec's composition |
| CR-05 | Action-edge extraction | P0 | 🟡 | Edges + anchors ✅; **no `observedDelta`, no `irreversible`, no `latencyMs`** |
| CR-06 | Screenshot capture (full + viewport) | P0 | 🟡 | Full + 320w thumb; **no viewport-only capture; thumb is 320w not 512×320** |
| CR-07 | Safety: blocklist, budget, rate limit, bot UA | P0 | 🟡 | Blocklist ✅, budget ✅ (hardcoded 15); **no rate limit, no bot UA, no run-id header, no robots.txt** |
| CR-08 | Graph persistence + versioning by run | P0 | ✅ | JSON blob per run, independently retrievable |
| CR-09 | Auth recipe recorder | P1 | 🔴 | — |
| CR-10 | Multi-viewport crawl | P1 | 🔴 | **This is what makes D5 detectable** |
| CR-11 | Live crawl progress stream | P0 | ✅ | `state-found` / `action-found` over SSE, with replay buffer |

## 4.2 Persona Studio

| ID | Feature | Pri | Status | Notes |
|---|---|---|---|---|
| PS-01 | Persona trait schema | P0 | 🟡 | `PersonaTraitVector` exists; **`patience` is a plain number, not `{maxSteps, maxMs}`; no `locale`, `archetype`, `label`** |
| PS-02 | Preset archetype library (≥10) | P0 | 🔴 | **4 hardcoded in `server.ts`**, no `PersonaArchetype` table, no API |
| PS-03 | Population mixer (50–1000, weights) | P0 | 🔴 | Hardcoded 1000 |
| PS-04 | Task definition with goal predicate | P0 | 🔴 | One hardcoded `DUMMY_TASK`; Chorus takes no task at all |
| PS-05 | Custom persona builder UI | P1 | 🔴 | — |
| PS-06 | Generate persona mix from ICP text | P1 | 🔴 | — |

## 4.3 Scouts — Grounded Agents

| ID | Feature | Pri | Status | Notes |
|---|---|---|---|---|
| SC-01 | Agent loop perceive→decide→act→observe | P0 | 🔴 | **Walks the fake `stubGraph`, never a browser** |
| SC-02 | Multimodal perception (a11y + screenshot) | P0 | 🔴 | Text-only a11y tree; no image content block |
| SC-03 | Action selection with recorded rationale | P0 | 🟡 | `thought` is a **template string**, not the model's own reasoning |
| SC-04 | Patience / confusion abandonment | P0 | 🟡 | Step cap ✅ (`MAX_STEPS = 10`); **no time budget** |
| SC-05 | Full step trace (state, action, delta, shot, latency) | P0 | 🟡 | Steps persisted; **no screenshots, no latency, no delta** |
| SC-06 | Think-aloud transcript | P1 | 🔴 | — |
| SC-07 | Parallel workers with concurrency cap | P0 | 🔴 | **Exactly one scout, single persona** |
| SC-08 | Trace replay viewer | P1 | 🔴 | — |

## 4.4 Chorus — Modeled Population

| ID | Feature | Pri | Status | Notes |
|---|---|---|---|---|
| CH-01 | Calibration from Scout traces | P0 | 🔴 | **Not built.** Weights are constants; `fitMae` always null |
| CH-02 | Monte Carlo walker (1000 × 2 tasks < 30 s) | P0 | 🟡 | 1000 personas ✅, fast ✅; **tasks not modelled** |
| CH-03 | Trait modifiers on transition probabilities | P0 | 🟡 | `domainLiteracy`, `patience`, `priorFamiliarity` ✅; **`riskAversion`, `readingDepth`, `device`, `inputMode` unused** |
| CH-04 | Confidence intervals | P1 | 🔴 | No bootstrapping |
| CH-05 | Grounded/modeled provenance on every metric | P0 | 🔴 | **Hardcoded `"modeled"` for everything** |

## 4.5 Analysis

| ID | Feature | Pri | Status | Notes |
|---|---|---|---|---|
| AN-01 | Per-state metric computation | P0 | ✅ | All six, via `@dry-run/core` |
| AN-02 | Friction Score | P0 | ✅ | Deterministic, unit-tested |
| AN-03 | Fix Value ranking | P0 | 🟡 | Formula ✅; **inputs are proxies, not spec definitions** |
| AN-04 | Failure blame attribution | P0 | 🔴 | **`impact = friction/100`, not attribution share** |
| AN-05 | Clustering into named findings | P0 | 🟡 | 7 of 8 signatures; **mapping is crossed (see §6.4)** |
| AN-06 | Evidence bundle per finding | P0 | 🟡 | Screenshot only; **no trace excerpts, no quotes** |
| AN-07 | Persona-segment breakdown | P1 | 🔴 | `affectedSegments` always `[]` |

## 4.6 Atlas — Visualisation

| ID | Feature | Pri | Status | Notes |
|---|---|---|---|---|
| AT-01 | 3D force-directed graph | P0 | ✅ | R3F + d3-force-3d, 300 frozen ticks |
| AT-02 | Screenshot-textured node plates | P0 | ✅ | With Suspense + error boundary |
| AT-03 | Friction in colour + elevation | P0 | 🔴 | **`frictionScore` hardcoded 0; no ramp** |
| AT-04 | Persona-flow particles | P1 | 🔴 | — |
| AT-05 | Dropout "leak" VFX | P1 | 🔴 | — |
| AT-06 | Node inspector panel | P0 | 🟡 | Opens ✅; **every metric renders `—`** |
| AT-07 | Persona path replay scrubber | P1 | 🔴 | — |
| AT-08 | 2D fallback | P0 | ✅ | Toggle works, shared inspector |
| AT-09 | Filter by persona segment | P1 | 🔴 | — |

## 4.7 Usher — Tour Compiler

| ID | Feature | Pri | Status | Notes |
|---|---|---|---|---|
| TR-01 | Generate steps from top-N findings | P0 | ✅ | Top 3 by Fix Value |
| TR-02 | Semantic Anchor compiler | P0 | 🟡 | Generation ✅, runtime resolution ✅ (tiers 1–4); **no `nameMatch`, `textFingerprint`, `fallbackSelectors[]`, `graphStateId`** |
| TR-03 | Copy grounded in the observed failure | P0 | 🟡 | Templates fold in the explanation; **no LLM polish pass** |
| TR-04 | Human review queue (approve/edit/reject) | P0 | ✅ | Full, plus restore |
| TR-05 | Live preview overlay on target | P1 | 🟡 | Snippet + new tab + honest instruction; **no injection** |
| TR-06 | Export `tour.json` + embed snippet | P0 | ✅ | Approval-gated **server-side**, not just in the UI |
| TR-07 | Per-step success condition | P1 | 🟡 | Runtime supports `advanceOn.click`; **generator always writes `{type:"click"}`; no UI to set it** |

## 4.8 Drift

| ID | Feature | Pri | Status |
|---|---|---|---|
| DR-01 | Graph diff between two runs | P1 | 🔴 |
| DR-02 | Node matching (name + heading + pHash) | P1 | 🔴 |
| DR-03 | Step health `intact/reanchored/broken` | P1 | 🔴 |
| DR-04 | Auto re-anchor proposal | P1 | 🔴 |
| DR-05 | Human approval queue for re-anchors | P1 | 🔴 |
| DR-06 | Side-by-side before/after graph | P2 | ⬜ |

**The entire Drift subsystem is unimplemented.** `DriftReport` exists as a table with 0 rows and no code path that writes it. No `softFingerprint`, no `pHash`, no matching algorithm, no endpoints, no UI.

## 4.9 Platform

| ID | Feature | Pri | Status | Notes |
|---|---|---|---|---|
| PL-01 | Operator auth | P1 | 🔴 | Hardcoded `usr_local`; no `currentUser()` middleware seam |
| PL-02 | Projects | P0 | 🟡 | Table + seed row; **every run hardcodes `proj_meridian`; no API** |
| PL-03 | Run history list | P0 | 🔴 | No endpoint, no UI |
| PL-04 | Live run progress with stage indicators | P0 | ✅ | SSE + stage rail |
| PL-05 | Shareable read-only report link | P1 | 🔴 | — |
| PL-06 | Attestation gate + audit log | P0 | ✅ | 400 without it; `Attestation` row with timestamp + UA; **33 rows in the DB** |
| PL-07 | CI webhook | P2 | ⬜ | — |

## 4.10 The four "never cut" items

The Implementation Plan named four things that must survive any cut:

| # | Item | Status |
|---|---|---|
| 1 | The ranked findings list | 🔴 **No Findings view exists.** Findings are computed and stored but never rendered. |
| 2 | The tour export | ✅ **Built and approval-gated.** |
| 3 | The provenance badges (Honesty Rail) | 🔴 **Not rendered anywhere.** Provenance is a column and a field; no UI. |
| 4 | The evaluation slide | 🔴 **No harness, no measurement.** |

---

# Part V — The Gap: what was never built

Ranked by how much each blocks the product's core claim.

## Tier 1 — Blocks the central thesis

1. **The run orchestrator / stage machine.** `POST /runs` fires crawl and a dummy scout in parallel and stops. Chorus/Analysis need a manual second HTTP call. There is no `crawl → scouts → calibrate → chorus → analyse → done` progression, no stage-percentage mapping, no `DEGRADED` path, no cancel.
2. **Real Scouts.** The entire Tier-1 "truth source" does not exist. `runDummyScout` walks a hardcoded 3-node fake graph with one persona and never opens a browser. Without this: no grounded evidence, no calibration input, no provenance, no think-aloud, no evidence quotes, and the two-tier claim is unsupported.
3. **Calibration.** No fitting loop, no `fitMae`, no low-confidence banner. Chorus's weights are five hand-picked constants. **This is the difference between "a simulation" and "a random number generator"** — and it was explicitly the thing to *show* judges, not hide.
4. **The Findings view.** Findings are computed, ranked, and persisted — and rendered nowhere. `?view=findings` prints `"Findings view stub"`.
5. **The Atlas view.** `?view=atlas` prints `"Atlas view stub"`. The Atlas components exist but are only mounted inside the *Live* console, where they receive streaming states with no metrics attached. The auto-transition on DONE navigates the operator to a stub page.
6. **Friction data reaching the Atlas.** `StateMetrics` never joins `AppState` on the wire. Elevation is 0, colour is fixed, rings are decorative.
7. **The Honesty Rail.** Zero provenance badges rendered. This was the pitch's centrepiece and a never-cut item.

## Tier 2 — Blocks the differentiation

8. **Drift, in full.** No graph diff, no node matching, no pHash, no `softFingerprint`, no step-health check, no re-anchor proposals, no approval queue, no endpoints, no UI, **and no Meridian v2 to diff against.**
9. **The Decision Router.** No routing, no confidence scoring, no `DecisionCache` table, no key pool, no 429 cooldown, no provider failover, no `ModelCall` logging → **no escalation-rate metric**, which was a headline talking point.
10. **The evaluation harness.** No `pnpm demo`, no precision/recall measurement against the six planted defects.
11. **Multi-viewport crawl.** Without it, D5 (offscreen modal close at 390px) is undetectable.

## Tier 3 — Blocks the product feel

12. **Persona Studio** — no archetype library table/API, no mixer, no population slider, no task editor, no custom personas.
13. **Run history / Launchpad list** — no `GET /projects`, no run cards, no health banner.
14. **Evidence lightbox and trace drawer** — the "show me why you believe this" surfaces.
15. **Failure states** — no unreachable-target screen, no zero-states screen, no quota banner, no SSE reconnect-with-backoff, no WebGL fallback toast.
16. **Keyboard shortcuts, toasts, segment filter, `prefers-reduced-motion`.**
17. **The Atlas signature visuals** — contour rings driven by data, particles, the leak, survey marker, bloom, fly-to, selection dimming, node labels.

## Tier 4 — Safety and hygiene gaps

18. **SSRF guard / `ALLOW_PRIVATE_TARGETS`** — the crawler will navigate to any URL, including private ranges, with no gate. (It has already been pointed at `vtop.vit.ac.in`, `google.com`, and `youtube.com`.)
19. **Politeness** — no rate limit, no `User-Agent: DryRun-Bot/1.0`, no `X-DryRun-Run-Id` header, no robots.txt handling.
20. **Secrets hygiene** — no trace redaction by key name, **no password-field masking before screenshots are written to disk.** The crawler types `Dryrun!Synthetic1` into password fields and screenshots the page.
21. **Seeded target credentials** — no in-memory-only credential path, no `storageState` reuse.
22. **`pino` structured logging** — not installed. The engine uses Fastify's default logger plus a raw `console.log` in the scout runner.
23. **`DRYRUN_REPLAY` offline mode** — the demo insurance policy, never built.

---

# Part VI — Known Bugs, Deviations & Technical Debt

## 6.1 🔴 Blocking: corrupted Prisma generator

`apps/engine/prisma/schema.prisma` line 2, **uncommitted working-tree change**:
```prisma
generator client { provider = "9-client-js" }   // ← invalid; committed value is "prisma-client-js"
```
`prisma generate` / `db push` will fail. **Fix before anything else.** (`git checkout -- apps/engine/prisma/schema.prisma` would also revert it, but that loses nothing else — the file has no other working-tree change.)

## 6.2 🔴 The pipeline does not chain

`POST /runs` → `void runCrawl(...)` **and** `void runDummyScout(...)` fire simultaneously. The scout doesn't wait for the crawl (and wouldn't use its output anyway — it walks `stubGraph`). Chorus runs only on an explicit `POST /runs/:id/chorus`. Analysis is chained off Chorus. So a fresh run ends at `status: "CRAWLING", stage: "scouts"` and sits there forever.

**Confirmed in the database:** the best real crawl (15 states, 51 edges, run `cmtittbom0001rfs4l92mjtsl`) is still `status: CRAWLING, stage: scouts` with `findingCount: 0`.

## 6.3 🟡 Stub data served from live endpoints

`GET /runs/:id/graph` and `GET /runs/:id/findings` return `stubGraph` / `stubFindings` regardless of the run id. The current UI doesn't call them, so this is latent — but it will silently mislead anyone who integrates against the API.

## 6.4 🟡 Finding signature mapping is crossed

As detailed in §3.3.12: below-fold → `offscreen-control` (should be `hidden-cta`), low-contrast → `hidden-cta` (should be `silent-validation`), dead-click → `silent-validation` (should be `ambiguous-cta`). Any recall measurement against the six planted defects will score wrongly until this is fixed.

## 6.5 🟡 Fingerprint deviates from spec

Implemented: `sha1(join("\n", ["<depth>:<role>", …]))` — **structure only**.
Specified: `sha256(urlPattern | sortedRoleNamePairs | primaryHeading | landmarkSkeleton)`.

**Consequences:**
- Two structurally identical screens with completely different content collapse into one node (e.g. `/roadmap/beginner` vs `/roadmap/intermediate` would collide if their DOM shapes matched)
- A renamed button does **not** change the fingerprint — but the spec requires it to (there's an explicit test for this in TRD §11)
- There is no `urlPattern` normalisation (`/\d+/` and UUIDs → `:id`, tracking params dropped)
- There is no `softFingerprint`, which Drift's node matching depends on

**This is the highest-value correctness fix in the crawler.**

## 6.6 🟡 Design tokens drifted toward default Tailwind

| Token | Spec (04-UIUX §3) | Implemented | Note |
|---|---|---|---|
| `chart-deep` | `#0A1620` | `#0A1620` | ✅ |
| `chart-abyss` | `#060D14` | `#070E15` | close |
| `chart-shelf` | `#10202C` | `#1A3247` | **shelf/shoal swapped** |
| `chart-shoal` | `#17303E` | `#122333` | **shelf/shoal swapped** |
| `ink-0` | `#EDE4D3` warm bone | `#EAE6DF` | close |
| `ink-1` | `#A8A395` warm | `#94A3B8` | **Tailwind slate-400 — cold** |
| `ink-2` | `#6E7A80` | `#475569` | **Tailwind slate-600 — cold** |
| `marker` | `#FF7A45` | `#FF5A00` | more saturated |
| `flow` | `#8FC7D6` chalky | `#22d3ee` | **Tailwind cyan-400 — neon** |
| `rule` / `rule-strong` | `#1F3D4D` / `#2E5468` | `rgba(...)` | different model |
| **friction ramp `f-00…f-100`** | 6 stops | **absent** | never added |
| `ok` / `warn` / `danger` / `info` | 4 semantic | **absent** | `emerald-500`/`red-400` used ad hoc in TourBuilder |
| `marker-dim`, `flow-dim` | present | **absent** | |

> The brief's central instruction was *"warm bone on cold water, one accent hue, never the default AI dashboard look."* The implementation replaced the warm ink and chalky flow with Tailwind's stock slate and cyan, and introduced a second and third accent (emerald, red). **If you rebuild the UI, restore the palette from the brief first** — it's the cheapest way to get the intended feel back.

Also missing from `tailwind.config.ts`: the `cond` (Plex Sans Condensed) font family, `borderRadius` scale, and `transitionTimingFunction`. `packages/core/ramp.ts` (`frictionColor` / `frictionRing`, the single source of truth shared by React and three.js) was never written.

## 6.7 🟡 SSE replay buffer never evicts

`eventLog: Map<runId, RunEvent[]>` grows without bound for the process lifetime. Every `state-found` event carries a full `AppState` including the entire `a11yTree` — on the dsasimulator crawl that's 432 nodes per state × 15 states. A long-running engine will accumulate hundreds of MB.

## 6.8 🟡 Ordinal is global, landmark is a bare role

`aria.ts` counts ordinals on `` `${role}::${name}` `` across the whole document; the spec says "index among same role **and landmark**". And `landmark` is the nearest ancestor landmark's *role string* (`"main"`), not the spec's `landmarkPath: string[]` with region names (`["main", "region:Setup"]`). Both weaken anchor resolution tier 4 and Drift matching.

## 6.9 🟡 Orphan sweep and pragmas incomplete

`bootDatabase()` sweeps only `CRAWLING | SCOUTING | CHORUS` — a run killed during `ANALYZING` or `TOURING` stays stuck. `PRAGMA synchronous = NORMAL` and `PRAGMA busy_timeout = 5000` are missing.

## 6.10 🟡 Chromium relaunched per run

`runCrawl` calls `chromium.launch()` and closes it in `finally`. TRD §3.2's stated reason for a standing engine process was to keep **one Chromium warm across runs** (~800 ms saved per run). That optimisation was never taken.

## 6.11 🟡 Crawl budget hardcoded; no depth cap; no priority

`CRAWL_BUDGET = 15` is a module constant. There's no `maxDepth`, no `maxActionsPerState`, no `maxDurationMs`, and the queue is a plain FIFO — the spec's priority heuristic (favouring `continue|next|create|connect|invite|finish|setup`, penalising `help|docs|pricing|blog|terms|logout`, decaying by depth) was never implemented. **On a real site this means the crawler explores the footer as eagerly as the funnel** — visible in the dsasimulator run, where 4 of 15 discovered states are `/about`, `/contact`, `/privacy-policy`, `/terms-and-conditions`.

## 6.12 🟡 Path replay is O(n²)-ish

Every click candidate triggers a full replay from the root. For a state at depth `d` with `k` candidates, that's `k × d` navigations. Fine locally, but it's why crawls of real sites are slow and why `page.waitForTimeout: Page crashed` shows up in the run history.

## 6.13 🟢 Minor

- `RunStage` includes `"done"` but nothing emits it — the last stage rail row never activates
- `DEGRADED`, `SCOUTING`, `CALIBRATING`, `CHORUS`, `ANALYZING`, `TOURING`, `CREATED` are dead enum values
- `_run_dump.json` and `_tour_dump.json` are debug artifacts committed alongside source
- Root `package.json` has **no scripts** — there is no `pnpm dev`, `pnpm build`, or `pnpm demo` at the workspace root
- No root `README.md`
- `apps/demo/README.md` is the untouched Vite template; `apps/interface/README.md` is the untouched `create-next-app` template
- `AGENTS.md`/`CLAUDE.md` in `apps/interface` are auto-generated by `next dev`, not authored
- `apps/interface/tsconfig.tsbuildinfo` is committed
- TRD §11 required three test files (`scoring`, `fingerprint`, `anchor`); only `scoring.test.ts` exists
- `packages/core/json.ts` (`readJson`/`writeJson` typed helpers, Backend Schema §2) was never written — `JSON.parse` is called inline in `server.ts`, `analysis.ts`, and `db.ts`

---

# Part VII — Evidence: real runs, real data, verified behaviour

All figures below were read directly from `apps/engine/data/dryrun.db` on 2026-09-04.

## 7.1 Database contents

| Table | Rows |
|---|---|
| `Run` | **28** |
| `Attestation` | **33** |
| `ScoutTrace` | **25** |
| `Tour` | **3** |
| `TourStep` | **0** |
| `Finding` | **0** |
| `ModelCall` | **0** |
| `DriftReport` | **0** |
| `Project` | 1 |
| `User` | 1 |

**DB file: 3.0 MB · screenshots: 44 MB across 18 run folders.**

## 7.2 Run outcomes

| Status | Stage | Count |
|---|---|---|
| `DONE` | `done` | 7 |
| `FAILED` | `scouts` | 13 |
| `FAILED` | `crawl` | 7 |
| `CRAWLING` | `scouts` | 1 |

All 7 `DONE` runs have `stateCount: 0` and no graph — they are early walking-skeleton runs from before the real crawler landed. **Most `FAILED` runs failed with `"Engine restarted during this run"`** — the orphan sweep doing its job during dev iteration, not real crawl failures.

## 7.3 Targets actually crawled

| Target URL | Runs | Max states |
|---|---|---|
| `http://localhost:5173` (the demo app) | 11 | **4** |
| `http://localhost:5173/signup` | 6 | 0 |
| `https://www.dsasimulator.com/` | 5 | **15** (budget-truncated) |
| `https://vtop.vit.ac.in/vtop/open/page` | 3 | **15** (budget-truncated) |
| `https://www.google.com/` | 1 | 0 |
| `https://www.youtube.com/` | 1 | 0 |
| `http://localhost:9999/nope` (failure test) | 1 | 0 |

> **This is the crawler's strongest proof point.** It was pointed at two real, unrelated production websites and successfully produced 15-node semantic graphs with working static signals — including real contrast measurements. Whatever else is incomplete, **the Cartographer genuinely works on the open web.**

## 7.4 The real external crawl (dsasimulator.com, 15 states / 23 edges)

| State | Path | a11y nodes | interactive | belowFold | contrast |
|---|---|---|---|---|---|
| s0 | `/` | 432 | 116 | false | **2.49 — LOW** |
| s1 | `/about` | 164 | 48 | false | — |
| s2 | `/contact` | 136 | 52 | **true** | 7.17 |
| s3 | `/privacy-policy` | 174 | 51 | false | — |
| s4 | `/terms-and-conditions` | 198 | 48 | false | — |
| s5–s7 | `/roadmap/{beginner,intermediate,advanced}` | 206–212 | 66–68 | false | — |
| s8, s10, s13 | `/{bubble,selection,heap}-sort` | 165–173 | 53 | false | 7.17 |
| s9, s11, s12, s14 | `/*-sort-theory` | 269–282 | 57–59 | **true** | 11.74 |

Real findings the static-signal layer surfaced with **zero AI**: a low-contrast primary CTA on the homepage (2.49:1, below the 4.5:1 threshold) and below-the-fold primary CTAs on five pages.

## 7.5 The demo-app crawl (4 states / 11 edges) — and why it stops

```
s0  /signup    14 a11y nodes  · belowFold: false · contrast 4.55
s1  /workspace 18 a11y nodes  · belowFold: TRUE   ← D1 DETECTED STATICALLY ✓
s2  /connect   13 a11y nodes  · belowFold: false
s3  /connect   14 a11y nodes  · belowFold: false  ← the post-invalid-key error state

EDGES:
  s0 → s0  type  "Email"
  s0 → s0  type  "Password"
  s0 → s1  click "Sign up"
  s1 → s1  type  "Workspace name"
  s1 → s2  click "Create workspace"
  s2 → s2  type  "API key"
  s2 → s2  click "Continue"        ← D2 DETECTED STRUCTURALLY (self-loop = dead click) ✓
  s2 → s3  click "Connect source"  ← lands on the D3 error state ✓
  s3 → s3  type  "API key"
  s3 → s3  click "Continue"
  s3 → s3  click "Connect source"
```

**Two of the six planted defects are provably detected today, with no AI at all:**
- **D1** via `staticSignals.belowFoldPrimaryCta = true` on `/workspace`
- **D2** via the `s2 → s2 click "Continue"` self-loop (the "Continue" no-op produces no fingerprint change)
- **D3** is *reached* (s3 is the error state) but not *classified*, because nothing measures the error text's contrast — only the primary CTA's

**🔴 The crawler is hard-blocked at `/connect`.** The synthetic filler writes `"Dry Run sample text"` into the API key field (the label "API key" matches neither `/name/` nor a typed input), but the demo app requires a value starting with `mk_`. So `/invite`, `/webhook`, and `/dashboard` are **never reached** — which makes **D4, D5, and D6 permanently undetectable** in the current setup.

**This is the single highest-leverage fix for the demo.** Options: (a) add a per-run seeded-value map (`{"API key": "mk_demo123"}`), (b) teach the filler to read `placeholder` (`"mk_..."`) and derive a conforming value, (c) let the LLM/heuristic brain propose field values, or (d) relax the demo app's validation. Option (b) is elegant and generalises; option (a) is the spec's intended `Advanced → seeded login` path.

## 7.6 Scout traces — the fake ones

25 rows, **all `personaLabel: "Dummy Scout"`**:

| Result | Reason | Count |
|---|---|---|
| `abandoned` | `confusion` | 18 |
| `success` | — | 7 |

Every trace has `terminalStateId: "s_dashboard"` — a node id from `stubGraph`, **not from any real crawl**. `stepCount: 3`, `durationMs: 0–25 ms` (no browser involved). `decisionStats: {heuristic: 2, model: 0, fallback: 1}` — the model was never reached, because no API key is configured.

## 7.7 Tours

3 `Tour` rows exist with **0 `TourStep` rows** in the current DB — the steps were created and later cleared during iteration. `_tour_dump.json` preserves one complete generated tour:

```json
{
  "id": "cmteu40hn0006rfukhiezqi39",
  "runId": "cmteu27ub0001rfukjo89shxg",
  "version": 1,
  "name": "Tour for http://localhost:5173",
  "status": "DRAFT",
  "steps": [{
    "order": 0,
    "stateId": "s1",
    "anchor": {
      "role": "button", "name": "Create workspace",
      "landmark": "main", "ordinal": 0,
      "selectorFallback": "role=button name=\"Create workspace\" landmark=main ordinal=0"
    },
    "title": "Scroll down for the next step",
    "body": "The control you need isn't visible without scrolling. The Connect data source button sits below the fold on a 1280x800 viewport; several personas never scrolled to find it.",
    "placement": "bottom",
    "status": "proposed"
  }]
}
```

> **This proves the full Usher path worked end to end at least once:** crawl → metrics → finding → template copy → semantic anchor → persisted tour step. That is the product's core loop, demonstrated.

## 7.8 Verified test run

```
$ npx vitest run   (packages/core, 2026-09-04)

 Test Files  1 passed (1)
      Tests  11 passed (11)
   Duration  598ms
```

## 7.9 Verified bundle size

```
packages/usher-rt/dist/usher-rt.js  =  5,342 bytes   (budget: < 6 KB)  ✓
```

---

# Part VIII — How To Run It Today

## 8.1 Prerequisites

- Node.js **22+** (verified on v24.13.0)
- pnpm **9+** (lockfile declares `pnpm@11.24.0`)
- Chromium via Playwright (`npx playwright install chromium`, ~150 MB)

## 8.2 First-run sequence

```bash
# 0. FIX THE BLOCKING BUG FIRST
#    apps/engine/prisma/schema.prisma line 2:
#    provider = "9-client-js"  →  provider = "prisma-client-js"

# 1. Install
pnpm install

# 2. Playwright browser
npx playwright install chromium

# 3. Build the shared packages (nothing does this automatically)
pnpm --filter @dry-run/core build
pnpm --filter @dry-run/usher-rt build

# 4. Engine env
#    apps/engine/.env  →  DATABASE_URL="file:../data/dryrun.db"
#    Optionally add:      REKA_API_KEY=...   or   GEMINI_API_KEY=... + LLM_PROVIDER=gemini

# 5. Database
pnpm --filter engine db:push
pnpm --filter engine db:seed
```

## 8.3 Running (three terminals — there is no root orchestration script)

```bash
# Terminal 1 — the demo target app
pnpm --filter demo dev              # → http://localhost:5173

# Terminal 2 — the engine
pnpm --filter engine dev            # → http://localhost:4000

# Terminal 3 — the interface
pnpm --filter interface dev         # → http://localhost:3000
```

## 8.4 The working demo path

1. Open `http://localhost:3000`
2. Click **"Try the demo target ›"** → Setup prefills `http://localhost:5173`
3. Tick the attestation checkbox → **Launch Dry Run**
4. Watch the **Live console**: the Atlas builds node by node, the event feed streams `state-found` / `action-found`
5. The crawl finishes at 4 states and **stops** — status stays `CRAWLING`, stage `scouts`
6. **Manually advance the pipeline:**
   ```bash
   curl -X POST http://localhost:4000/runs/<runId>/chorus
   ```
   This runs Chorus (1000 personas), writes metrics, then runs Analysis and sets the run to `DONE`
7. The Live console receives `status: "DONE"` and auto-navigates to `?view=atlas` — **which is a stub page.** Manually change the URL to `?view=tour`
8. **Tour Builder** loads: generates 3 steps from the top findings, shows anchor chips with the resolution ladder, allows approve / edit / reject
9. Approve ≥1 step → **Export** shows the embed snippet and `tour.json`
10. Paste the snippet into the demo app's browser console to see the tour actually render

## 8.5 Useful direct API calls

```bash
curl http://localhost:4000/health
curl http://localhost:4000/runs/<runId>
curl -N http://localhost:4000/runs/<runId>/events        # SSE stream
curl -X POST http://localhost:4000/runs -H 'Content-Type: application/json' \
     -d '{"targetUrl":"http://localhost:5173","attestation":true}'
curl -X POST http://localhost:4000/runs/<runId>/chorus
curl -X POST http://localhost:4000/runs/<runId>/tour
curl http://localhost:4000/tours/<tourId>/export
```

## 8.6 Inspecting the database

There's no `sqlite3` CLI in this environment, but Node 22+ has a built-in driver:

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('apps/engine/data/dryrun.db', { readOnly: true });
console.log(db.prepare('SELECT id,status,stage,stateCount,findingCount FROM Run ORDER BY startedAt DESC LIMIT 5').all());
"
```
`pnpm --filter engine exec prisma studio` also works once the generator provider is fixed.

---

# Part IX — Recommendations for the Rebuild / Upgrade

## 9.1 What to keep, unchanged

These are genuinely good and should be carried across verbatim:

1. **`packages/core/scoring.ts` + its test file.** Correct, tested, spec-faithful. Keep the `hesitation` half-saturation note.
2. **`aria.ts`'s snapshot parser.** The `ariaSnapshot({mode:"ai", boxes:true})` → `A11yNode[]` pipeline is the technical keystone and it works on real websites.
3. **`signals.ts`'s contrast calculation.** A correct WCAG implementation with sensible ancestor-walking for background colour.
4. **`packages/usher-rt` in its entirety.** 5.3 KB, zero deps, correct 4-tier resolution ladder, graceful when the anchor misses. The decision to *skip* tier 5 rather than fake it is exactly right.
5. **`adapter.ts`'s `hydrateActionEdge`.** Never trusting the model to echo back anchor fields — look them up by `ref` from ground truth — is the pattern that makes the whole "refs, never selectors" claim real.
6. **`chorus.ts`'s simulation core.** Deterministic PRNG, numerically-stable softmax, reverse-BFS hop distances, largest-remainder persona allocation. Only the *inputs* (uncalibrated weights, proxy impact/reach/confidence) need work.
7. **The SSE replay buffer concept** (add eviction).
8. **`next.config.ts`'s `compress: false`.** A real bug, found the hard way, documented in place.
9. **The Prisma schema's shape** — blob-vs-normalise split, denormalised counters, non-FK `Attestation.runId`, `Tour.parentTourId`.
10. **Every explanatory comment in the codebase.** This code is unusually well-annotated: each shortcut says *why* it's a shortcut and what would replace it. That's the most valuable thing in the repo for a handoff.
11. **The demo app with its six planted defects.** Faithful to spec and ready to use.

## 9.2 Fix-first list, in order

| # | Fix | Why first |
|---|---|---|
| 1 | Prisma generator `"9-client-js"` → `"prisma-client-js"` | Nothing runs otherwise |
| 2 | Fix the synthetic filler so `/connect` is passable (read `placeholder`, or add a seeded-values map) | Unblocks D4/D5/D6 and the whole funnel — **highest leverage single change** |
| 3 | Build the run orchestrator: `crawl → scouts → calibrate → chorus → analyse → done` | Everything else is already written and just isn't connected |
| 4 | Replace `runDummyScout` with real Playwright-driven scouts against the real graph | Unblocks grounded evidence, calibration, provenance, and the two-tier claim |
| 5 | Correct the finding-signature mapping (§6.4) | Otherwise every finding title is misleading and recall can't be measured |
| 6 | Thread `StateMetrics` into the Atlas payload; add the friction ramp | Turns a pretty graph into the product's centrepiece |
| 7 | Build the Findings view and the Atlas view | Three of five tabs currently print a placeholder sentence |
| 8 | Render provenance badges everywhere a number appears | The never-cut item, and the pitch's whole credibility argument |
| 9 | Replace the structural fingerprint with the spec's composite; add `softFingerprint` | Prerequisite for Drift, and a correctness fix in its own right |
| 10 | Add `ModelCall` logging + the escalation-rate metric | Cheap, and it's a headline talking point |

## 9.3 Architectural advice for the next version

**Keep the two-process split.** Fastify for long-lived browser work, Next.js as a thin client, SSE between them. It was the right call and it held up.

**Build the orchestrator as an explicit state machine**, not as chained `void` calls. A single `RunOrchestrator` class owning `{runId, stage, pct}` with one `advance()` per stage — every stage writes its blob, emits its SSE event, and hands off. That one file is the difference between "a pile of working modules" and "a product."

**Make the graph payload metrics-aware from the start.** The Atlas's biggest single failure is that `AppState` and `StateMetrics` never meet on the wire. Define an `AtlasNode = AppState & { metrics?: StateMetrics }` and serve that from `/runs/:id/graph`.

**Write `packages/core/ramp.ts` before touching any visual.** The brief warns that two implementations of the friction ramp will drift; the built version has *zero* implementations, which is worse. One `frictionColor(score)` / `frictionRing(score)` imported by both React and three.js.

**Keep the honesty machinery, even when it's inconvenient.** The `fitMae > 0.15` low-confidence banner, the `truncated` crawl chip, the `Predicted` badge on unvisited screens, the "no specific heuristic matched — a real gap, not papered over" return. The existing code's instinct to annotate rather than fabricate (see the `slow-response` comment, the proxy-metric comments, the `selectorFallback` tier-5 skip) is the project's best quality. **Preserve it.**

**Before scaling anything, restore the seeded-credentials path.** It's the difference between crawling 4 screens and crawling all 6 of the demo app — and on any real target it's the difference between mapping a login page and mapping a product.

## 9.4 If you're rebuilding the UI

Start from the design brief's tokens verbatim (§2.10 above), not from the current `tailwind.config.ts`. The drift toward Tailwind slate/cyan is the specific failure mode the brief was written to prevent. Add the six-stop friction ramp and the four semantic colours on day one, load IBM Plex Sans Condensed, and build the provenance badge component before building anything that displays a number.

The **2D Atlas before the 3D Atlas** rule held up well and should hold again — the 2D version is genuinely usable and was built first, exactly as planned.

---

# Appendix A — Full file inventory

```
dry-run/
├── .gitignore
├── package.json                                     (2 lines, no scripts)
├── pnpm-workspace.yaml
├── pnpm-lock.yaml                                   240 KB
│
├── packages/core/
│   ├── package.json                                 @dry-run/core, zod ^4.4.3, vitest ^4.1.11
│   ├── tsconfig.json                                ES2022 / NodeNext / strict, excludes *.test.ts
│   ├── src/index.ts                                 3
│   ├── src/enums.ts                                 64
│   ├── src/types.ts                                 149
│   ├── src/scoring.ts                               99
│   └── src/scoring.test.ts                          124      ← 11 tests, all passing
│
├── packages/usher-rt/
│   ├── package.json                                 esbuild IIFE build
│   ├── tsconfig.json                                ES2020 / DOM / noEmit
│   ├── src/index.ts                                 357
│   └── dist/usher-rt.js                             5,342 bytes
│
├── apps/engine/                                     Fastify 5 · Playwright 1.62 · Prisma 6.19 · openai 7.8 · sharp 0.35
│   ├── package.json
│   ├── tsconfig.json                                ESNext / NodeNext / strict
│   ├── prisma.config.ts
│   ├── prisma/schema.prisma                         281      ← generator provider CORRUPTED in working tree
│   ├── prisma/seed.ts                               32
│   ├── .env / .env.example                          DATABASE_URL only
│   ├── _tour_dump.json                              debug artifact
│   ├── data/dryrun.db                               3.0 MB
│   ├── data/runs/**                                 44 MB, 18 folders
│   └── src/
│       ├── server.ts                                402
│       ├── cartographer.ts                          249
│       ├── aria.ts                                  123
│       ├── signals.ts                               82
│       ├── screenshots.ts                           25
│       ├── db.ts                                    93
│       ├── sse.ts                                   62
│       ├── stubs.ts                                 169
│       ├── brain/heuristic.ts                       47
│       ├── brain/adapter.ts                         148
│       ├── brain/chorus.ts                          446
│       ├── brain/analysis.ts                        173
│       ├── scouts/runner.ts                         155
│       ├── usher/compiler.ts                        26
│       └── usher/generator.ts                       98
│
├── apps/interface/                                  Next 16.3.3 · React 19.2.8 · Tailwind 4 · R3F 9 · drei 10 · three 0.185
│   ├── package.json / tsconfig.json / eslint.config.mjs / postcss.config.mjs
│   ├── next.config.ts                               proxy rewrites + compress:false
│   ├── tailwind.config.ts                           design tokens (drifted)
│   ├── AGENTS.md / CLAUDE.md                        auto-generated by next dev
│   ├── README.md                                    untouched create-next-app template
│   ├── _run_dump.json                               debug artifact
│   ├── tsconfig.tsbuildinfo                         committed build artifact
│   ├── public/{file,globe,next,vercel,window}.svg   untouched template assets
│   └── src/
│       ├── types.d.ts                               1  (declare module "d3-force-3d")
│       ├── app/layout.tsx                           43
│       ├── app/globals.css                          contour substrate
│       ├── app/page.tsx                             66
│       ├── app/new/page.tsx                         148
│       ├── app/runs/[id]/layout.tsx                 38
│       ├── app/runs/[id]/ViewTabs.tsx               42
│       ├── app/runs/[id]/page.tsx                   30
│       ├── components/LiveConsole.tsx               235
│       ├── components/Atlas2D.tsx                   178
│       ├── components/Atlas3D.tsx                   223
│       ├── components/AtlasInspector.tsx            55
│       └── components/TourBuilder.tsx               433
│
└── apps/demo/                                       Vite 8 · React 19 · react-router-dom 7
    ├── package.json / vite.config.ts / index.html / tsconfig*.json / eslint.config.js
    ├── README.md                                    untouched Vite template
    ├── public/{favicon,icons}.svg
    └── src/
        ├── main.tsx                                 10
        ├── App.tsx                                  26
        ├── App.css                                  the planted-defect CSS
        ├── index.css
        ├── components/Shell.tsx                     12
        ├── pages/Signup.tsx                         48
        ├── pages/Workspace.tsx                      86   ← D1
        ├── pages/Connect.tsx                        66   ← D2, D3
        ├── pages/Invite.tsx                         46   ← D4
        ├── pages/Webhook.tsx                        73   ← D5, D6
        └── pages/Dashboard.tsx                      14
```

**Total hand-written source: ≈5,000 lines** across 40 files.

---

# Appendix B — Git history

**Remote:** `https://github.com/aeehprrst/dry-run.git` · **Branch:** `main` · **Tag:** `checkpoint-a` → `666d139`

| # | Hash | When | Message |
|---|---|---|---|
| 1 | `0275289` | 08-29 09:11 | `chore: initialize pnpm workspace and folder skeleton` |
| 2 | `cbeedb4` | 08-29 09:43 | `feat(core): generate shared type contracts and zod schemas` |
| 3 | `b129597` | 08-29 10:34 | `feat(scaffold): setup apps/demo, apps/interface, and apps/engine` |
| 4 | `cfa7a88` | 08-29 11:14 | `feat(demo): build Meridian v1 with 6 planted defects` |
| 5 | `e4419b2` | 08-29 16:15 | `feat(engine): setup sqlite database, schema, and seed` |
| 6 | `9ad5b4d` | 08-29 16:46 | `feat(engine): walking skeleton crawler v0 and sse endpoints` |
| 7 | `e728a8d` | 08-29 17:00 | `feat(core): implement scoring pure functions and unit tests` |
| 8 | `ac384c6` | 08-29 17:14 | `feat(engine): implement heuristic brain and dummy scout runner` |
| 9 | `9e9365f` | 08-29 22:25 | `feat(engine): upgrade cartographer to full BFS crawler v1` |
| 10 | `5f2737a` | 08-29 22:36 | `fix(engine): serve screenshot directory via fastify static` |
| 11 | `2cd6af8` | 08-29 22:57 | `feat(engine): implement real AI scouts and OpenAI adapter` |
| 12 | `e3ee2c6` | 08-29 23:33 | `feat(interface): implement 2D Atlas, contour rings, and Live Console feed` |
| 13 | `666d139` | 08-29 23:57 | `feat(engine): implement semantic anchor compiler and tour generator` ← **`checkpoint-a`** |
| 14 | `a226b12` | 08-30 00:26 | `feat(engine): implement chorus monte carlo simulation` |
| 15 | `0c4b727` | 08-30 00:51 | `feat(interface): implement 3D Atlas with d3-force-3d and React Three Fiber` |
| 16 | `c6272e2` | 08-30 02:13 | `feat(interface/engine): implement tour builder, usher runtime, and endpoints` |
| 17 | `4e32022` | 08-30 02:27 | `feat(engine): implement analysis engine and heuristic finding generation` |
| 18 | `649c2fc` | 08-30 02:44 | `fix(engine): sync run status to DONE at end of analysis and emit via SSE` |

**Note on commit 11** (`implement real AI scouts and OpenAI adapter`): the *adapter* is real; the *scout* remained the dummy walking `stubGraph`. The message overstates what landed.

**Uncommitted working-tree changes (3 files):**
- `apps/engine/prisma/schema.prisma` — **the generator-provider corruption (must fix)**
- `apps/interface/next.config.ts` — the `compress: false` SSE fix (**keep — commit this**)
- `apps/interface/src/components/LiveConsole.tsx` — auto-transition on `status === "DONE"` (**keep — commit this**)

---

# Appendix C — Core type contracts (as implemented)

```ts
// packages/core/src/types.ts — the actual contract every app compiles against

Box                = { x, y, width, height: number }

SemanticAnchor     = { role: string; name: string; landmark?: string;
                       ordinal: number; dataTestId?: string;
                       selectorFallback?: string }

A11yNode           = { ref: string; role: string; name: string; box: Box;
                       landmark?: string; ordinal: number; dataTestId?: string }

AppState           = { id: string; fingerprint: string; url: string; title: string;
                       screenshotPath: string; a11yTree: A11yNode[];
                       staticSignals: Record<string, any> }        // ← untyped bag

ActionEdge         = { fromStateId: string; toStateId: string;
                       action: ActionType; targetRef: string; anchor: SemanticAnchor }

StateGraph         = { nodes: Record<string, AppState>; edges: ActionEdge[] }

PersonaTraitVector = { role: string; domainLiteracy: 0..1; patience: number;
                       riskAversion: 0..1; readingDepth: 0..1;
                       priorFamiliarity: 0..1; device: DeviceType;
                       inputMode: InputMode; weight: number }

TaskDefinition     = { id: string; name: string; startUrl: string;
                       goalPredicate: { type: string; target: string } }

StateMetrics       = { frictionScore: 0..100; fixValue: 0..1;
                       dropout, blocked, loop, deadClick, hesitation, backtrack: number;
                       impact, reach, confidence: 0..1; provenance: Provenance }

Finding            = { id, runId, stateId: string; signature: FindingSignature;
                       title, explanation: string;
                       frictionScore, fixValue: number; provenance: Provenance;
                       evidenceBundle: { screenshotPath: string; thinkAloud: string[] } }

TourStep           = { id: string; order: number; stateId: string;
                       anchor: SemanticAnchor; title, body, placement: string;
                       status: StepStatus }
```

### Types specified in TRD §5.1 but never written

`StaticSignals` (typed, 9 fields) · `SoftFingerprint` · `Viewport` · `Persona` (full, with `archetype`/`label`/`locale`/`patience:{maxSteps,maxMs}`) · `Task.goal` (discriminated union of `state-reached` / `element-visible` / `url-matches`) · `Action.observedDelta` / `.irreversible` / `.latencyMs` · `StateGraph.budget` · `ScoutStep` · `ScoutTrace` · `CalibrationParams` · `Tour` · `DriftReport` · `SemanticAnchor.nameMatch` / `.textFingerprint` / `.fallbackSelectors[]` / `.graphStateId` / `.landmarkPath[]` · `StateMetrics.entered` / `.abandoned` / `.blocked` counts / `.ci95` · `Finding.groundedTraceIds` / `.affectedSegments` / `.proposedStep` · `TourStep.advanceOn` / `.sourceFindingId`.

---

## Closing note

The project got roughly **60% of the way to Checkpoint B** in about 17.5 hours. What exists is real: a working accessibility-tree crawler that has been proven against live production websites, a complete and correct scoring implementation with passing tests, a genuine Monte Carlo simulator, an under-budget zero-dependency tour runtime, a full human-in-the-loop approval flow with server-enforced gating, and a demo target with all six planted defects intact.

What is missing is mostly **connective tissue and the two things that made the pitch distinctive**: real grounded Scouts (which unlock calibration, provenance, and the Honesty Rail) and Drift (which needs both a diff engine and a Meridian v2). Neither is conceptually hard — the designs are complete and written down in Part II above. Both were simply out of hours.

The codebase's best property is that it is **honest about its own gaps**. Almost every shortcut carries a comment explaining what it is standing in for and what would replace it. That is what makes this handoff possible, and it is worth protecting in whatever comes next.

---

*End of Handoff Document v1.0 — companion to 01-PRD · 02-TRD · 03-App-Flow · 04-UIUX-Brief · 05-Backend-Schema · 06-Implementation-Plan*
