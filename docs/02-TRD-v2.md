# Dry Run — Technical Requirements Document (TRD) v2

**Document:** 2 of 6 · **Version:** 2.0 · **Event:** IEEE WIE WE Hack 5.0
**Supersedes:** 02-TRD v1.0 · **Governed by:** `CLAUDE.md` · **Depends on:** 01-PRD-v2

This document is normative for architecture, contracts and algorithms. Where it gives a formula
or a schema, implement it as written. Where it is silent, ask.

---

## 0. What changed from v1

| # | Change |
|---|---|
| 1 | **Scouts subsystem removed** (§5.4 of v1 is void). No grounded-agent loop, no multimodal perception, no parallel scout workers. |
| 2 | **Calibration removed** (§5.6.1 of v1 is void). No fitting, no `fitMae`, no low-confidence banner tied to fit. |
| 3 | **Decision Router simplified.** Single provider behind the OpenAI-compatible adapter, heuristic-first, memoised. No key pool, no failover chain. |
| 4 | **Run Orchestrator added** (§4) — the largest new component, and the reason the imported modules become a product. |
| 5 | **Multi-viewport crawl added** (§5.2.5) — required for the mobile segment and D5. |
| 6 | **Chorus trait enforcement completed** (§5.4) — all ten traits, plus per-segment metrics. |
| 7 | **Drift reduced to anchor re-resolution** (§5.7). No pHash, no node-matching score, no Hungarian assignment. |
| 8 | **Replay mode added** (§5.8) — `DRYRUN_REPLAY`, a P0 demo dependency. |
| 9 | **Safety implementations promoted from "designed" to P0** (§9). |

---

## 1. Constraints that shape every decision

1. **36 hours, 3 people, one of whom is on the visual layer full-time.** ~70 person-hours of
   engineering. Every design must be buildable by one person in one sitting.
2. **A significant codebase is inherited.** Extending beats rewriting. Any proposal to rewrite an
   imported module needs a reason stronger than taste.
3. **Venue network is untrusted.** The whole pipeline must complete with zero model calls
   (heuristic-only path). Model calls are an enhancement, never a dependency.
4. **The demo runs from cache.** Live crawling on stage is forbidden (L5), so the replay path is a
   first-class code path, not a debug flag.
5. **One demo laptop, one projector, possibly integrated graphics.** 2D before 3D, always.
6. **UI/UX is separately and heavily scored.** The visual layer gets a dedicated owner for the
   full 36 hours and is never blocked on the engine — it develops against fixtures.

---

## 2. Tech stack

| Layer | Choice | Version |
|---|---|---|
| Language | TypeScript, `strict` | 5.x |
| Monorepo | pnpm workspaces (no Nx, no Turborepo) | — |
| Engine | Fastify | 5.x |
| Browser automation | Playwright, Chromium only | 1.6x |
| DB | SQLite via Prisma | Prisma 6.x |
| Images | sharp | 0.35 |
| Model access | `openai` SDK against an OpenAI-compatible endpoint | 7.x |
| Frontend | Next.js App Router, React 19 | 15.x |
| 3D | three.js + `@react-three/fiber` + `drei` + `d3-force-3d` | r15x |
| Motion | Framer Motion | 11.x |
| Styling | Tailwind + CSS variables from the UI/UX brief | 3.x |
| Validation | Zod | 4.x |
| Tests | Vitest | 4.x |
| Demo app | Vite + React + react-router-dom | — |

### 2.1 Architecture decision log — bring this to every review

| # | Decision | Why | Rejected |
|---|---|---|---|
| D1 | TypeScript end to end | One type system across crawler, simulation and UI; no serialisation boundary | Python for the simulation |
| D2 | `ariaSnapshot({mode:"ai", boxes:true})` as the perception primitive | Roles, names and geometry in one CSS-independent call; enables defect detection with zero AI | Raw DOM, screenshot-only, CDP |
| D3 | **Crawler-observed + modeled population** (v2, replaces two-tier Scouts) | The crawler is already a real browser, so "Observed" has a real source without a second agent subsystem. Population scale stays honest because we never claim realism (L1). | 1000 grounded agents (impossible), Scouts + calibration (no time, and the claim it supports is one we no longer make) |
| D4 | Heuristic-first decision routing, memoised per `(archetype, fingerprint)` | Cuts model calls ~65%; survives a blocked network; makes the cost claim measurable | A model call on every step |
| D5 | Semantic anchors, not CSS selectors | The entire self-healing premise. CSS selectors are exactly what breaks competitors' tours. | XPath, CSS, coordinates |
| D6 | SQLite + Prisma | Zero setup, file-based, survives a crash, one-command migrations | Postgres, in-memory |
| D7 | Graph as JSON in TEXT columns | Normalising a 40-node graph buys nothing at this scale and costs hours | Full relational normalisation |
| D8 | SSE, not WebSockets | Progress is one-directional | WebSockets |
| D9 | Single provider + heuristic fallback | One adapter, one key. The heuristic path guarantees an offline demo. | Multi-provider key pool (v1) — cut for time |
| D10 | 2D Atlas before 3D | Guarantees a demo on any machine; 3D reuses the same layout code | 3D only |
| D11 | No agent framework | ~100 calls with a fixed schema; a framework adds abstraction and debugging cost for zero benefit | LangChain, LlamaIndex |
| D12 | Engine as a separate long-lived process | Crawls hold browser handles for 60–180 s and stream progress; Next.js route handlers are the wrong shape. One warm Chromium across runs saves ~800 ms each. | Everything in Next.js |
| D13 | Import the prior prototype, disclosed | The crawler and a11y parser are the hardest parts and already work on real websites | Greenfield rewrite (would consume a third of the budget) |

Also rejected: Docker · any cloud deploy as P0 · Redis/BullMQ · shadcn defaults as the design system.

---

## 3. Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│ apps/interface · Next.js 15         http://localhost:3000              │
│ Launchpad │ Setup │ Console(Live · Atlas · Findings · Tour · Drift)    │
└───────────────┬───────────────────────────────┬────────────────────────┘
                │ REST (proxied /api → :4000)   │ SSE /runs/:id/events
┌───────────────▼───────────────────────────────▼────────────────────────┐
│ apps/engine · Fastify 5              http://localhost:4000            │
│                                                                        │
│   ┌──────────────────────── RunOrchestrator ────────────────────────┐  │
│   │  crawl → chorus → analyse → tour → done   (explicit FSM)        │  │
│   └───┬─────────────┬──────────────┬──────────────┬────────────────┘  │
│       │             │              │              │                    │
│  Cartographer    Chorus        Analysis        Usher                   │
│  Playwright      Monte Carlo   signatures      anchors + tour          │
│  aria.ts         seeded PRNG   exclusion       drift                   │
│  signals.ts      segments      scoring↓        compiler                │
│       │             │              │              │                    │
│  ┌────▼─────────────▼──────────────▼──────────────▼────┐               │
│  │ Prisma / SQLite  ·  data/runs/<id>/*.jpg  ·  SSE bus │              │
│  └──────────────────────────────────────────────────────┘              │
└────────────────────────────────────────────────────────────────────────┘
        ▲                                    ▲
        │ imports                            │ embeds
  packages/core (Zod, scoring, ramp)   packages/usher-rt (< 6 KB)
        ▲
  apps/demo · Meridian v1/v2 · Vite · :5173 / :5174
```

**Boundaries:** `packages/core` imports nothing and is imported by everything.
`apps/interface` never imports Playwright or Prisma. All long-lived work lives in the engine.

---

## 4. The Run Orchestrator — the central new component

The imported code fires `runCrawl()` and a dummy scout in parallel and then stops; Chorus needs a
manual second HTTP call. **Fix this first after the blocking bug.** Everything downstream depends
on a run reaching `done` by itself.

### 4.1 Contract

```ts
type RunStage = 'crawl' | 'chorus' | 'analyse' | 'tour' | 'done';
type RunStatus = 'CREATED' | 'RUNNING' | 'DONE' | 'FAILED' | 'DEGRADED' | 'CANCELLED';

class RunOrchestrator {
  constructor(private runId: string, private cfg: RunConfig) {}

  async start(): Promise<void>;      // sequential, awaited, one stage at a time
  cancel(): void;                    // sets a flag every stage checks between units of work
}
```

**Rules:**
1. **Sequential and awaited.** No `void` calls. Stage `n+1` starts only when stage `n` resolves.
2. Every stage: `emit({t:'stage', stage, pct})` on entry → do work → persist its blob → emit
   completion. A stage that writes nothing is a bug.
3. **Percentage is monotonic and declared**, not guessed:
   `crawl 0–45 · chorus 45–70 · analyse 70–85 · tour 85–100`.
   Within `crawl`, `pct = 45 × statesFound / crawlBudget`.
4. **Partial failure degrades, it does not abort.** If Chorus throws, the run is `DEGRADED` with
   the graph intact and the UI says which stage failed and what is still valid. A crawl that
   reaches zero states is `FAILED`.
5. **Cancellation** is checked between units of work (each state crawled, each 100 personas).
6. **Replay short-circuits the crawl stage only.** `DRYRUN_REPLAY=<fixtureId>` loads a stored
   graph, emits the same `state-found` / `edge-found` events on a 60 ms timer so the Live view
   animates identically, then proceeds through the real Chorus, Analysis and Usher stages. The
   simulation is never faked — only the browser work is cached.

### 4.2 Sequence

```
POST /runs
  → validate URL, attestation, SSRF guard        → 400 on failure
  → create Run row (status CREATED)
  → return { runId } immediately                  ← never block the HTTP response
  → orchestrator.start() in the background

stage crawl     Cartographer → AppState[] + Action[] → persist graph blob
                (desktop pass, then mobile pass — see §5.2.5)
stage chorus    Chorus over the graph × persona mix × tasks
                → StateMetrics per state, and per (state, segment)
stage analyse   scoring → findings → ExclusionDelta/Index → persist
stage tour      Usher: top-3 findings by Fix Value → anchors → copy → TourStep rows (DRAFT)
stage done      status DONE, emit final stage event
```

---

## 5. Subsystem specifications

### 5.1 `packages/core` — shared contracts

Zod-first. Types are inferred (`z.infer`), never declared twice. Keep the imported
`enums.ts`, `types.ts` and `scoring.ts`; add the following.

```ts
// ramp.ts — the single source of truth for friction colour, used by React AND three.js
export const FRICTION_STOPS = ['#12293A','#1E4A5C','#3E7484','#96A48F','#D8B06A','#FF7A45'];
export function frictionColor(score: number): string;   // OKLab lerp across the 6 stops
export function frictionRing(score: number): number;    // floor(score / 20) → 0..5
export function frictionElevation(score: number): number; // score / 100 * 6 (world units)
```

```ts
// segments.ts
export type SegmentId = 'screen-reader' | 'mobile' | 'low-literacy' | 'non-native' | 'confident-desktop';
export function segmentsOf(p: PersonaTraitVector): SegmentId[];  // a persona may be in several
export const BASELINE_SEGMENT: SegmentId = 'confident-desktop';
```

```ts
// exclusion.ts
export function exclusionDelta(bySegment: Record<SegmentId, number>, baseline: number): number;
export function exclusionIndex(states: StateMetricsBySegment[]):
  { stateId: string; segment: SegmentId; delta: number };
```

**New/changed schemas:**

```ts
const PersonaTraitVector = z.object({
  archetype: z.string(),                    // stable id, e.g. 'screen-reader-user'
  label: z.string(),                        // display name
  role: PersonaRole,
  domainLiteracy: z.number().min(0).max(1),
  patience: z.object({ maxSteps: z.number().int(), maxMs: z.number().int() }),  // was a bare number
  riskAversion: z.number().min(0).max(1),
  readingDepth: z.number().min(0).max(1),
  priorFamiliarity: z.number().min(0).max(1),
  device: z.enum(['desktop-1440','laptop-1280','mobile-390']),
  inputMode: z.enum(['pointer','keyboard-only','screen-reader']),
  locale: z.enum(['native','non-native']),
  weight: z.number(),
});

const Provenance = z.enum(['observed','modeled','predicted']);

const StateMetrics = z.object({
  stateId: z.string(),
  dropout: z.number(), blocked: z.number(), loop: z.number(),
  deadClick: z.number(), hesitation: z.number(), backtrack: z.number(),
  frictionScore: z.number(), fixValue: z.number(),
  provenance: Provenance,
  bySegment: z.record(z.object({ dropout: z.number(), blocked: z.number(), n: z.number() })),
  exclusionDelta: z.number(),               // worst positive delta on this state
  worstSegment: z.string().nullable(),
  ci95: z.tuple([z.number(), z.number()]).nullable(),
});

// The Atlas contract — this type existing is what stops the map being cosmetic
const AtlasNode = AppState.extend({ metrics: StateMetrics.nullable() });
```

**Tests required** (`packages/core`, Vitest): `scoring.test.ts` (imported, 11 passing — keep),
`fingerprint.test.ts` (renaming a button changes the fingerprint; reordering DOM does not),
`ramp.test.ts` (monotonic lightness, 0 and 100 map to the end stops),
`exclusion.test.ts` (delta sign and index selection).

### 5.2 Cartographer

Keep `cartographer.ts`, `aria.ts`, `signals.ts`, `screenshots.ts`. Apply these changes.

**5.2.1 Composite fingerprint (CR-04) — replaces the structural hash**
```ts
fingerprint = sha256([
  urlPattern,                       // /\d+/ and UUID segments → :id; tracking params dropped
  sortedRoleNamePairs.join('|'),    // interactive elements only: `button:connect data source`
  primaryHeading,                   // first h1, else first heading, lowercased and trimmed
  landmarkSkeleton,                 // e.g. main>region:Setup>form
].join('\u0000'));

softFingerprint = sha256([urlPattern, landmarkSkeleton].join('\u0000'));
```
The current implementation hashes `depth:role` only, which means different screens with the same
DOM shape collapse into one node and **a renamed button does not change the fingerprint.** Both
are correctness bugs; the second also makes Drift blind.

**5.2.2 Crawl priority (CR-02)**
```
priority(edge) = 3.0 · matches(/continue|next|create|connect|invite|finish|setup|add/)
               - 3.0 · matches(/help|docs|pricing|blog|terms|privacy|logout|about|contact/)
               + 1.0 · isInViewport
               - 0.4 · depth
```
Max-priority queue. Budget: `maxStates` (default 25), `maxDepth` 6, `maxActionsPerState` 12,
`maxDurationMs` 120000, and a `truncated` flag on the graph when any cap is hit.

**5.2.3 Seeded field values (CR-07) — highest-leverage change in the project**
Fill order for every input:
1. `RunConfig.seededValues[accessibleName]` if present — e.g. `{"API key": "mk_demo123"}`
2. else derive from `placeholder`: if it contains a token like `mk_...`, emit `mk_demo123`
3. else derive from `type` / `inputmode` / name heuristics (email → `dryrun+<runId>@example.invalid`)
4. else `"Dry Run sample text"`

Without this the crawl stops at `/connect` and D4, D5 and D6 can never be found.

**5.2.4 Static signals (CR-12) — nine, all zero-AI**
`belowFoldPrimaryCta` · `offscreenInteractives[]` · `primaryCtaContrast` ·
**`errorTextContrast`** (any node with role `alert` or a name matching `/invalid|error|must|required/`)
· `hasAriaLive` · `competingCtas` (≥2 same-styled primary-verb buttons in one landmark) ·
`interactiveCount` · `jargonScore` (fraction of accessible names flagged technical against a
declared word list) · `medianActionLatencyMs`.

Every signal is `Observed` — the browser measured it. This is what makes Explainable AI a real
claim rather than a keyword: every finding traces to a browser-verified fact.

**5.2.5 Multi-viewport crawl (CR-09)**
Crawl twice: `laptop-1280` then `mobile-390`. Same fingerprint algorithm, so states match across
passes. Store `staticSignals` per viewport:
```ts
AppState.viewports: { 'laptop-1280': StaticSignals; 'mobile-390': StaticSignals }
```
A state present at 1280 but with an interactive element offscreen at 390 is exactly D5, and it is
what makes the `mobile` segment's ExclusionDelta real rather than a prompt instruction.
For Meridian (6 screens, local) the second pass costs seconds. Cap it: mobile pass reuses the
desktop pass's edge list and only re-measures signals — it does not re-explore.

**5.2.6 Perception hygiene**
Mask before screenshot: `input[type=password]`, and any input whose accessible name matches
`/key|secret|token|password/`, are blanked via `page.addStyleTag` before capture. Non-negotiable
(§9).

### 5.3 The decision brain

```ts
interface Brain { decide(input: DecisionInput): Promise<DecisionOutput> }
```

Used only at **ambiguous decision nodes** during crawl-time action choice and Chorus tie-breaks —
never once per persona per step.

```ts
class BrainRouter implements Brain {
  async decide(input) {
    const key = `${input.archetype}::${input.stateFingerprint}::${input.taskId}`;
    const hit = await cache.get(key);              // DecisionCache table
    if (hit) return { ...hit, decisionSource: 'cache' };

    const h = heuristic.decide(input);
    if (h.confidence >= 0.85) return h;            // ~60–70% of nodes

    try { const m = await model.decide(input); await cache.set(key, m); return m; }
    catch { return { ...h, decisionSource: 'fallback' }; }
  }
}
```

**Heuristic scoring** (keep the imported version, extend to the full form):
```
score(n) = 3.0 · goalKeywordMatch(n.name, task)
         + 2.0 · isPrimaryCtaVerb(n.name)
         + 1.0 · n.inViewport
         + 0.5 · isUnfilledRequiredField(n)
         - 2.0 · alreadyTriedThisState(n)
         - 3.0 · isNavigationalDistraction(n)
confidence = softmaxMargin(top1, top2)
```

**Model output contract — refs, never selectors, never coordinates:**
```json
{ "thought": "one sentence in this persona's voice",
  "action": { "type": "click", "targetRef": "e12" },
  "confusion": 0.4, "confidence": 0.8 }
```
The harness maps `e12` to a locator from ground truth. Never trust the model to echo anchor
fields — look them up by `ref`. This is why a renamed CSS class cannot break the system.

**Every call is logged** to `ModelCall { runId, source, promptTokens, completionTokens, ms }`.
`escalationRate = model ÷ (model + heuristic + cache)`, displayed in the UI. Target 25–40%.
The `ModelCall` table had zero rows in the prototype, which meant the cost claim had no evidence.

### 5.4 Chorus

Keep the imported simulation core — deterministic PRNG, numerically stable softmax, reverse-BFS
hop distances, largest-remainder persona allocation. Extend the inputs.

**Transition policy** (unchanged in form):
```
utility(e) =  w_goal   · goalAlignment(e)
            + w_aff    · affordance(e)
            - w_jargon · jargonLoad(s) · (1 − p.domainLiteracy)
            - w_risk   · irreversibility(e) · p.riskAversion
            + w_fam    · patternFamiliarity(e) · p.priorFamiliarity

utility(giveUp) = giveUpBase
                + 2.0 · (stepsTaken / p.patience.maxSteps)
                + 1.5 · baseConfusion(s)
                - 1.0 · p.priorFamiliarity

P(e) = softmax(utility / τ),  τ = temperature · (1 + baseConfusion(s))
```
Weights are **declared constants exported from `packages/core`** and rendered in the UI (PRD §6.2).
No calibration. Do not describe them as fitted anywhere in code, UI or deck.

**Trait enforcement — all ten (CH-03).** Mechanical wherever possible (CLAUDE.md §6.8):

| Trait | Effect on the walk |
|---|---|
| `patience.maxSteps/maxMs` | Hard cap. Walk terminates as `abandoned:patience`. |
| `device: mobile-390` | Edges whose target control is in `viewports['mobile-390'].offscreenInteractives` are **removed from the edge set**. Below-fold controls get `affordance × 0.35`. |
| `inputMode: screen-reader` | Perception is a11y-only: edges whose control has an empty accessible name are removed. A state with `errorTextContrast` failing **and** `hasAriaLive === false` sets `baseConfusion = 1.0` — the error is literally unavailable. |
| `inputMode: keyboard-only` | Edges not reachable in tab order get `affordance × 0.5`. |
| `locale: non-native` | `jargonLoad` effect multiplied by 1.6; `readingDepth` effect halved. |
| `domainLiteracy` | Jargon penalty term (as now) |
| `riskAversion` | Irreversibility penalty term (**currently ignored — wire it**) |
| `readingDepth` | Below `0.4`, helper-text and tooltip nodes are stripped from the perceived state, so hints that would disambiguate a fork are not seen (**currently ignored — wire it**) |
| `priorFamiliarity` | Pattern-familiarity bonus and give-up resistance (as now) |
| `role` | Task/goal selection |

`device` and `inputMode` are the two that make the exclusion claim real. If time forces a cut,
cut `keyboard-only` before `screen-reader`.

**Per-segment metrics (CH-04).** Accumulate every counter per `SegmentId` alongside the overall
figure, then compute `ExclusionDelta` per state against `confident-desktop`. Minimum 30 personas
per segment for a delta to be reported; below that, report `null` and badge `Predicted`.

**Provenance (CH-05):**
```
observed  → the state was reached by the crawler in a real browser AND the finding on it rests
            on a static signal the browser measured
modeled   → the state was crawled; the number comes from the simulation
predicted → the state was inferred but never crawled (rare; e.g. a target of an edge the crawl
            budget cut off)
```

**Budget:** 1000 personas × 2 tasks < 30 s single-threaded. Seeded by `runId` so a demo replays
identically.

### 5.5 Analysis

1. Compute `StateMetrics` via `packages/core/scoring.ts` (do not reimplement).
2. **Fix the signature mapping.** Correct table:

| Signature | Inputs |
|---|---|
| `hidden-cta` | `belowFoldPrimaryCta` ∧ `hesitation > 0.5` |
| `ambiguous-cta` | `competingCtas` ∧ `deadClick > 0.25` |
| `silent-validation` | `errorTextContrast < 4.5` ∧ `¬hasAriaLive` ∧ `loop > 0.3` |
| `dead-end` | `blocked > 0.2` ∧ no out-edge decreasing goal hop-distance |
| `offscreen-control` | `viewports['mobile-390'].offscreenInteractives.length > 0` ∧ `dropout(mobile) − dropout(baseline) > 0.15` |
| `jargon-gate` | `jargonScore > 0.4` ∧ `dropout(low-literacy) > dropout(baseline)` |
| `excessive-choice` | `interactiveCount > 12` ∧ `hesitation > 0.6` |
| `slow-response` | `medianActionLatencyMs > 2000` |

3. **Blame attribution (AN-04):** 1.0 to the terminal state of each failed walk, 0.25 spread
   across states visited ≥2 times, normalise over all failures. Not `friction/100`.
4. **Evidence bundle:** screenshot path + the Observed fact in plain language ("error text
   measured at 1.9:1 against its background") + affected segments + the metric values that fired
   the rule. A finding with no evidence bundle must not render.
5. If no rule fires on a high-friction state, emit `signature: 'unclassified'` with the metrics.
   **Never invent a signature to fill the slot** — an honest gap is a feature (CLAUDE.md §6.5).

### 5.6 Usher

Keep the compiler, generator and `packages/usher-rt` verbatim. Extend:

- Anchor gains `nameMatch`, `textFingerprint`, `fallbackSelectors[]`, `graphStateId`.
- **Live injection (TR-06):** Meridian loads `usher-rt` from a script tag and reads `?tour=<id>`,
  fetching the exported JSON from the engine. This is the demo's most valuable single moment, so
  it is wired early and tested on the demo laptop, not at hour 30.
- Resolution ladder stays four tiers: `data-testid` → role+name exact → role+name fuzzy →
  landmark+ordinal → fail and flag. **Do not add a tier 5.** Failing visibly is the honest
  behaviour and it is what makes the Drift demo legible.
- Ordinal is scoped to `(role, landmark)`, not global. Landmark is a path array
  (`["main","region:Setup"]`), not a bare role string.

### 5.7 Drift — anchor-level (L7)

```
POST /drift { baseRunId, headRunId } → DriftReport
```
1. Match states between graphs on `softFingerprint`, then `urlPattern`. No pHash, no scoring
   function, no Hungarian assignment.
2. For each step in the base tour, re-resolve its anchor against the matched head state's a11y
   snapshot using the same four-tier ladder as `usher-rt`:
   - resolves at tier 1–2 → **`intact`**
   - resolves at tier 3–4 → **`re-anchored`**, propose the new anchor with
     `confidence = nameSimilarity × (matched ? 1 : 0.6)`
   - no resolution → **`broken`**
3. Nothing auto-applies. `POST /drift/:id/apply` writes a **new tour version** from approved
   re-anchors only, with `parentTourId` set.

Meridian v2's single change (rename + move "Connect source") produces exactly one `re-anchored`
and one `broken` step. That is the demo.

### 5.8 Replay mode (CR-13)

```
DRYRUN_REPLAY=<fixtureId>     # engine env, or ?replay= on POST /runs
```
Fixtures live in `apps/engine/fixtures/<fixtureId>/{graph.json,shots/}` and are **committed to
the repo** — they are demo insurance and must survive a laptop wipe. The crawl stage replays
stored states on a 60 ms timer through the normal SSE bus; Chorus, Analysis and Usher then run
for real. A banner in the UI reads *"Crawl replayed from cached fixture"* whenever it is active.
Never hide replay mode; the disclosure is part of the pitch (L5).

### 5.9 Atlas rendering

Full visual spec is in 04-UIUX-Brief-v2. Technical constraints only, here:

- `GET /runs/:id/graph` returns `AtlasNode[]` with `metrics` joined. **If this endpoint returns
  nodes without metrics, the visual layer is a lie** — this is the single most important
  data-plumbing task in the project.
- `d3-force-3d`, 300 ticks up front, then frozen. No continuous simulation.
- One `InstancedMesh` for all particles. Never a mesh per particle.
- Canvas mounted once, hidden with CSS on view switch. Remounting costs ~800 ms and reads as a hang.
- Textures are server-pre-resized 512×320 JPEG q70. Never full-resolution screenshots in the scene.
- Bloom auto-disables below 40 fps for 2 s, with a quiet toast.
- Every visual property reads from `packages/core/ramp.ts`.

---

## 6. API surface

| Method | Path | Purpose | State |
|---|---|---|---|
| `POST` | `/runs` | Create + start. 400 unless `attestation === true`. SSRF-checked. | HAVE, extend |
| `GET` | `/runs/:id` | Full record: graph, metrics, findings, tour, exclusion | EXTEND |
| `GET` | `/runs/:id/events` | SSE progress | HAVE |
| `GET` | `/runs/:id/graph` | **`AtlasNode[]` with metrics joined** | FIX — returns stubs today |
| `GET` | `/runs/:id/findings` | Ranked findings with evidence | FIX — returns stubs today |
| `GET` | `/runs/:id/exclusion` | ExclusionIndex + per-segment table | NEW |
| `GET` | `/runs/:id/walks?segment=&limit=` | Sampled persona walks for replay (AT-09) | NEW |
| `POST` | `/runs/:id/tour` | Generate from top-N findings | HAVE |
| `PATCH` | `/tours/:id/steps/:stepId` | Approve / reject / edit | HAVE |
| `GET` | `/tours/:id/export` | `tour.json` + snippet, approval-gated server-side | HAVE |
| `POST` | `/drift` | `{baseRunId, headRunId}` → report | NEW |
| `POST` | `/drift/:id/apply` | Approved re-anchors → tour v2 | NEW |
| `DELETE` | `/runs/:id` | Cancel | NEW |
| `GET` | `/personas/archetypes` | The ten archetypes for Setup | NEW |
| `GET` | `/health` | Engine, browser, provider, replay mode | EXTEND |
| `GET` | `/debug/decisions/:runId` | Cache + escalation inspector — **hold in reserve for "how does this actually work?"** | NEW |
| `GET` | `/static/runs/:runId/*` | Screenshots | HAVE |

**Delete `GET /runs/:id/graph`'s stub path and `stubs.ts` entirely** before building anything on
these endpoints. Stub data served from live endpoints is the worst failure mode available here:
it looks like it works.

### 6.1 SSE contract

```ts
type RunEvent =
  | { t:'stage';        stage: RunStage; pct: number; status?: RunStatus }
  | { t:'state-found';  state: AppState }          // a11yTree stripped — see below
  | { t:'edge-found';   edge: Action }
  | { t:'signal';       stateId: string; signal: string; value: number|boolean }
  | { t:'chorus-done';  populationSize: number; completionRate: number }
  | { t:'metrics';      metrics: StateMetrics[] }  // one batch, drives the Atlas
  | { t:'finding';      finding: Finding }
  | { t:'exclusion';    stateId: string; segment: SegmentId; delta: number }
  | { t:'error';        message: string; fatal: boolean };
```

Two fixes to the imported bus: **strip `a11yTree` from `state-found`** (432 nodes × 15 states of
payload is why a long-running engine leaks hundreds of MB), and **evict the replay buffer** —
cap at 500 events per run, drop oldest.

---

## 7. Performance budgets

| Operation | Budget |
|---|---|
| Crawl, 25-state target, desktop pass | < 90 s |
| Mobile signal pass | < 20 s |
| Replay of a cached crawl | < 10 s |
| Chorus, 1000 personas × 2 tasks | < 30 s |
| Analysis + findings + exclusion | < 5 s |
| Tour generation | < 5 s |
| **Cached fixture → ranked Atlas, total** | **< 45 s** |
| Live crawl → ranked Atlas, total | < 3 min |
| Atlas first paint after data | < 1.5 s |
| Atlas steady state | ≥ 60 fps @ 40 nodes / 120 edges / 400 particles, 1280×720, integrated graphics |
| Graph API payload | < 2 MB |
| `usher-rt` bundle | **< 6 KB** (currently 5,342 bytes — a hard gate) |

Path replay during crawl is `O(k·d)` navigations per state in the imported code, which is why
real-site crawls are slow. If the crawl budget is missed, cap `maxStates` before optimising —
optimisation is not a hackathon activity.

---

## 8. Storage

SQLite at `apps/engine/data/dryrun.db`. Prisma is the source of truth
(`prisma/schema.prisma`); 05-Backend-Schema-v2 documents intent and deltas only.

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
```

**Orphan sweep on boot** must cover every non-terminal status — the imported version misses
`ANALYZING` and `TOURING`, so a run killed in those stages stays stuck forever.

Screenshots: `data/runs/<runId>/<stateId>.jpg` + `.thumb.jpg`. `data/` is gitignored.
Fixtures under `apps/engine/fixtures/` **are** committed.

---

## 9. Safety implementation — P0, not aspirational

| # | Control | Implementation |
|---|---|---|
| S1 | Attestation gate | 400 unless `attestation === true`; `Attestation` row with timestamp + UA |
| S2 | SSRF guard | `dns.lookup` the host; reject `127/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `::1` unless `ALLOW_PRIVATE_TARGETS=1` |
| S3 | Production warning | Warn hard if the host resolves to a well-known production domain |
| S4 | Destructive blocklist | Never click names matching `/delete|remove|pay|purchase|publish|send|cancel subscription/` |
| S5 | Politeness | `User-Agent: DryRun-Bot/1.0`, `X-DryRun-Run-Id`, configurable rate limit, `robots.txt` respected by default |
| S6 | Synthetic data | `dryrun+<runId>@example.invalid`; fixture values only |
| S7 | **Secrets hygiene** | Mask password/key/secret/token fields before every screenshot write; redact matching values from traces |
| S8 | Bias disclosure | Rendered in-product on the Findings view, not only in the deck |
| S9 | Human in the loop | No tour step and no re-anchor applies without explicit approval |

S2 and S7 are the two the prototype lacked and the two most likely to be asked about, given it
was pointed at a university portal and typed passwords into screenshotted forms. Implement them
before any external URL is ever entered again.

---

## 10. Observability

- `pino` structured logs, one line per stage transition with `{runId, stage, ms}`.
- `GET /health` → `{ engine, chromium, provider, replayMode, uptime }`.
- `GET /debug/decisions/:runId` → cache hits, escalation rate, per-source counts.
- Every crawl writes `data/runs/<id>/run.json` — the whole graph, replayable and diffable.

---

## 11. Environment

```bash
DATABASE_URL="file:./data/dryrun.db"
PORT=4000
ALLOW_PRIVATE_TARGETS=1          # local Meridian only; never a shipped default
MODEL_API_KEY=...                # single provider; absent ⇒ heuristic-only, which must work
MODEL_BASE_URL=...
MODEL_NAME=...
DECISION_CACHE=1
DRYRUN_REPLAY=                   # set to a fixture id for the stage demo
CRAWL_MAX_STATES=25
CRAWL_MAX_DEPTH=6
```

`.env.example` documents every key. Check `git log -p` for an accidentally committed real key
before the repo goes public.

---

## 12. Hour-0 bootstrap

```bash
# 0. THE BLOCKING BUG — prisma/schema.prisma line 2
#    provider = "9-client-js"  →  provider = "prisma-client-js"
pnpm install
npx playwright install chromium        # start this first, longest download
pnpm --filter @dry-run/core build      # nothing does this automatically
pnpm --filter engine exec prisma generate && prisma db push && prisma db seed
# three terminals, or the new root script:
pnpm dev                               # demo :5173 · engine :4000 · interface :3000
```

Root `package.json` gets `dev`, `build`, `test`, `demo` scripts on day one. The imported repo had
none, which is why it needed three terminals and a paragraph of instructions to start.

---

## 13. Open technical risks

| Risk | Mitigation |
|---|---|
| Venue network blocks the model provider | Heuristic-only path is a first-class code path, built at hour 1 |
| Crawl exceeds budget on Meridian | `CRAWL_MAX_STATES` down to 15; the demo needs 6 screens, not 25 |
| Atlas below 40 fps on the demo laptop | Bloom off → particles to 150 → 2D. Decided by the FPS guard, not by a person at hour 30. |
| Composite fingerprint change breaks dedupe | `fingerprint.test.ts` is written **before** the change, not after |
| Multi-viewport doubles crawl time | Mobile pass re-measures signals only; it does not re-explore |
| Prisma + SQLite enum absence | Enums live in Zod in `packages/core`; DB columns are TEXT. Already the imported pattern — keep it. |
