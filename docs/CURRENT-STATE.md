# CURRENT-STATE — Dry Run

**Written:** 2026-09-05 · **Branch:** `main` · **Method:** read from the code, not from the
other docs. Where a doc and the code disagree, §6 lists the disagreement and the code wins.

This is a handoff for an assistant with no memory of this project. It is deliberately
unflattering. Everything claimed here was verified by running it or reading the file named.

> **This file is a record, not a spec.** `CLAUDE.md` is the constitution; the numbered docs in
> `docs/` are the specification. Read this to learn what exists. Never build from it.

---

## 1. What this project is

Dry Run crawls a SaaS onboarding flow into a semantic **State Graph** — nodes are screens,
edges are actions, both labelled from the accessibility tree rather than CSS — then walks a
weighted population of modeled **personas** across that graph and ranks every screen by the
damage it causes. The population is deliberately skewed toward the users most likely to be
locked out (low digital literacy, non-native speakers, mobile, screen-reader), so the output
is a measure of **digital exclusion**, not conversion. It then compiles the top findings into
a deployable guided **tour** whose steps bind to semantic anchors instead of selectors.

---

## 2. Status

**The whole pipeline runs end to end, unattended, and is graded by a committed answer key.**

`crawl (or replay) → chorus → analysis → tour → done`, driven by
[orchestrator.ts](../apps/engine/src/orchestrator.ts), reachable either through `POST /runs`
or through the evaluation harness in-process.

### Evaluation harness — `pnpm demo`, 2026-09-05

Cached fixture `meridian-v1`. Chorus, Analysis and Usher run for real against the replayed
crawl. 1000 personas over 10 archetypes. Run produced 7 states, 18 edges, 9 findings.

| Metric | Result | Target | |
|---|---|---|---|
| Planted defects in the top 8 | **5 of 6** | ≥ 5 | PASS |
| Planted defects found anywhere | 6 of 6 | — | |
| In the top 3 by Fix Value | 2 of 6 | ≥ 2 | PASS |
| False positives in the top 8 | 2 | ≤ 2 | PASS |
| Wall clock | **0.6 s** | < 45 s | PASS |
| Precision (top 8) | 6/8 = 0.750 | — | |
| Recall (top 8) | 5/6 = 0.833 | — | |

Exit code 0. `pnpm demo:live` runs the same grading against a real crawl of Meridian on
`:5173`; it took ~99 s when last measured, and the harness deliberately prints no wall-clock
verdict in live mode because PRD §10's 45 s budget is stated for the cached path only.

**The one defect below the line is D1** (`hidden-cta`, `/workspace`), at rank #9 with Fix Value
0.013. See §5 for exactly why, measured.

**Also true, and load-bearing: all nine findings are `observed`.** The Modeled pass of the
classifier contributed nothing to this run — see §5.

### Other verification

- `pnpm test` — **28 tests, 3 files, all passing** (`scoring`, `ramp`, `archetypes`). This is
  the entire automated test suite; the engine and interface have no tests.
- `pnpm build` — `@dry-run/core`, `@dry-run/usher-rt` and the Next.js interface all build.
- `prefers-reduced-motion` verified by DOM assertion, not by eye: transitions collapse from
  `width 0.6s` to `opacity 0.14s`, `counter-roll` from `0.6s` to `1e-05s`.

---

## 3. What is built

### Cartographer — the crawler

`apps/engine/src/` · [cartographer.ts](../apps/engine/src/cartographer.ts) **885** ·
[signals.ts](../apps/engine/src/signals.ts) **582** · [aria.ts](../apps/engine/src/aria.ts) **228** ·
[replay.ts](../apps/engine/src/replay.ts) **151** · [screenshots.ts](../apps/engine/src/screenshots.ts) **50**

**Works.** Playwright/Chromium BFS crawl to a budget of 15 states. Perception is
`ariaSnapshot({mode:"ai", boxes:true})` → `A11yNode[]` carrying `ref`, role, accessible name,
box, landmark, ordinal, `data-testid`. Refs, never selectors.

- **Composite fingerprint (CR-04)** — `sha256(urlPattern | sortedRoleNamePairs |
  primaryHeading | landmarkSkeleton)`. Viewport-independent; an added paragraph does not
  change it. Before this, `/connect` and `/invite` collapsed into one node.
- **Seeded field values (CR-07)** — four-step fill order: operator `seededValues` by accessible
  name → pattern derived from the field's own `placeholder` → type/name heuristic → generic.
  Synthetic only (`dryrun+<runId>@example.invalid`).
- **Multi-viewport (CR-09)** — after the graph closes, a mobile-390 pass replays recorded paths
  and re-measures signals. It never explores and never adds a node. Results land in
  `AppState.viewports["mobile-390"]`; the desktop record is `["laptop-1280"]`.
- **Validation probe (CR-14)** — submits one deliberately invalid value on every state with a
  form, measures the resulting error, then corrects the value and proceeds. Detection is by
  **visible-text delta** first, corroborated by `aria-describedby`/`aria-invalid`; the
  `ERROR_TEXT_PATTERN` regex is only a weak fallback when the delta is empty. Creates no node.
  Verified that Playwright's `mode:"ai"` snapshot renders `aria-hidden="true"` subtrees, so the
  "is it in the accessibility tree" answer is checked against the DOM as well.
- **Screenshot masking (CR-06)** — `input[type=password]` plus anything whose accessible name or
  label matches `key|secret|token|password|passphrase|credential` is masked by Playwright at
  capture time, before the frame is encoded. Visible in the product as a magenta box.
- **Replay (CR-13)** — `DRYRUN_REPLAY=<fixtureId>` or `runCrawl(..., { replayFixtureId })`
  short-circuits the browser entirely, parses the fixture through `StateGraphSchema`, copies
  screenshots into the new run's directory and rewrites `screenshotPath`. Fixture id is
  validated against `/^[A-Za-z0-9][A-Za-z0-9._-]*$/` (path traversal). One fixture ships:
  `apps/engine/fixtures/meridian-v1`, 345 KB, 7 states, 18 edges, 14 screenshot files.

**Partial.**

- The frontier is a **plain FIFO** (`queue.shift()`, [cartographer.ts:754](../apps/engine/src/cartographer.ts#L754)).
  CR-02's priority queue does not exist; footers are explored as eagerly as the funnel.
- `ActionEdge` carries `fromStateId, toStateId, action, targetRef, anchor` and **nothing else**.
  CR-05's `observedDelta`, `irreversible` and `latencyMs` are absent from the schema. Chorus
  derives irreversibility structurally (can you get back?) instead.
- 8 of CR-12's 9 static signals exist. The ninth, `medianActionLatencyMs`, is missing because
  nothing records per-action latency — which is also why `slow-response` is unreachable.
- Thumbnails are 320 px wide at q70; the TRD says 512×320.

### Chorus — the population simulation

[brain/chorus.ts](../apps/engine/src/brain/chorus.ts) **720** ·
[packages/core/src/archetypes.ts](../packages/core/src/archetypes.ts) **202**

**Works.** Monte Carlo walk over the crawled graph. Zero LLM calls, zero network, pure
TypeScript, seeded `mulberry32`. Softmax over per-edge utility: goal alignment (hop distance to
a sink), affordance, jargon penalty, irreversibility × riskAversion, and a give-up term.

**Ten archetypes as a declared constant array** (PS-02), weights summing to 1.00 and
deliberately exclusion-weighted: eager-beginner 0.14, non-technical-marketer 0.13,
mobile-commuter 0.13, non-native-speaker 0.12, screen-reader-user 0.11, cautious-ops-lead 0.09,
distracted-multitasker 0.08, impatient-founder 0.07, confident-desktop 0.07 (the baseline),
jargon-fluent-engineer 0.06.

**All ten traits change the walk mechanically** (CH-03) — nothing is prompted, everything is
enforced. From `perceiveEdges` and the `TRAIT` block:

| Trait | Mechanism |
|---|---|
| `device: mobile-390` | Reads the mobile viewport record. An offscreen control is **removed** from the edge set, not discounted. Below-fold affordance × 0.35 on top of the scroll term. |
| `inputMode: screen-reader` | An unnamed control is **removed**. An unannounced validation error sets `baseConfusion = 1.0` on that state. |
| `inputMode: keyboard-only` | A control outside the measured tab order gets affordance × 0.5. `tabbableNames === null` (not measured) applies no multiplier — an unmeasured screen must not read as a failed one. |
| `locale: non-native` | `jargonLoad` × 1.6, `readingDepth` × 0.5. |
| `readingDepth` | Below 0.4, helper-text and tooltip nodes are stripped from perception. Also drives the scroll term. |
| `riskAversion` | Multiplies the irreversibility penalty (`WEIGHTS.risk`, a new key; no pre-existing weight was changed). |
| `patience.maxSteps` | A hard step cap plus the give-up term. |
| `domainLiteracy` | Scales the jargon penalty. |
| `priorFamiliarity`, `role` | Carried in the vector; enter the walk only through the archetype's other values. |

Below-fold controls are penalised for **every** persona, scaled by reading depth and patience
with a floor of 0.15 — people don't scroll — not only on mobile.

**Partial / not done.**

- `patience.maxMs` is **not enforced**, and deliberately not approximated from step count.
  Nothing instruments latency.
- **Per-segment metrics (CH-04) do not exist.** `StateMetrics` is computed for the population as
  a whole only. There is no way to ask the product what the screen-reader segment did versus the
  baseline — which is the SDG story's core number.
- **Provenance (CH-05) is hardcoded `"modeled"`** on every `StateMetrics`. Analysis therefore sets
  each finding's provenance itself rather than reading it from there.
- Tasks (CH-02) are not modelled at all. `computeHopDistances` treats "any state with no forward
  edge" as the goal.
- No bootstrap CI (CH-06).

### Analysis — the classifier

[brain/analysis.ts](../apps/engine/src/brain/analysis.ts) **417** ·
[packages/core/src/scoring.ts](../packages/core/src/scoring.ts) **99**

**Works.** Two passes, and the split is the point (L6):

- **Pass 1 · Observed** reads only browser measurements and is **not** gated on friction. A
  control below the fold is a defect whether or not the simulation tripped over it.
- **Pass 2 · Modeled** is gated on `FRICTION_THRESHOLD = 40` and reads Chorus metrics.
- Deduped by signature with Observed winning. Ranked by Fix Value, ties broken toward Observed.

`AN-05`'s wrong mappings are fixed: `belowFoldPrimaryCta → hidden-cta` (it used to steal D5's
`offscreen-control`), and the mobile/desktop offscreen comparison is what raises
`offscreen-control`.

**Partial / not done.**

- **`AN-04` is not done.** `impact` is still `frictionScore / 100`
  ([chorus.ts:561](../apps/engine/src/brain/chorus.ts#L561)) — the failure-blame attribution PRD
  §6.3 specifies does not exist. `reach` (share of population that arrived) and `confidence`
  (sample size) are honest, and `fixValue = impact × reach × confidence`.
- **7 of 8 signatures are reachable.** `slow-response` is never produced, by choice: mapping it
  onto some other proxy would be a fabricated label.
- **`AN-06` evidence bundles are half-built.** `evidence` carries the screenshot; `affectedSegments`
  and `groundedTraceIds` are written as empty arrays because CH-04 does not exist.
- **`AN-07` ExclusionDelta / ExclusionIndex does not exist at all.** Blocked on CH-04.

### Usher — the tour

[usher/generator.ts](../apps/engine/src/usher/generator.ts) **98** ·
[usher/persist.ts](../apps/engine/src/usher/persist.ts) **91** ·
[usher/compiler.ts](../apps/engine/src/usher/compiler.ts) **26** ·
[packages/usher-rt/src/index.ts](../packages/usher-rt/src/index.ts) **357**

**Works.** Steps generated from the top 3 findings by Fix Value, with templated copy grounded in
the observed failure. Anchors compiled with role, name, landmark, ordinal, `data-testid`.
`usher-rt` resolves through four tiers (testid → role+name exact → role+name fuzzy →
landmark+ordinal) and **fails cleanly** rather than guessing — which is what makes L7's
anchor-level drift possible later. The built bundle is **5,342 bytes**, under the 6 KB budget.
Approve/edit/reject/restore queue and `tour.json` + snippet export are wired, approval-gated
server-side.

**Partial / not done.** TR-06's live preview is a copyable snippet the operator pastes into the
target page's console — there is no injection. TR-07 (drift) and TR-08 (re-anchor approval) do
not exist; `?view=drift` renders `"Drift view stub"`.

### Orchestrator and platform

[orchestrator.ts](../apps/engine/src/orchestrator.ts) **314** ·
[server.ts](../apps/engine/src/server.ts) **459** · [db.ts](../apps/engine/src/db.ts) **119** ·
[sse.ts](../apps/engine/src/sse.ts) **62** · [eval/harness.ts](../apps/engine/src/eval/harness.ts) **435**

**Works.** `PL-01` is complete: sequential, awaited stages with declared monotonic percentage
bands (`crawl 0–45, chorus 45–70, analysis 70–85, tour 85–100`), cancellation checked between
units of work, and the crawl as the one fatal stage — everything after it produces `DEGRADED`
with `degradedFor` naming the stage, and the Observed graph stays viewable.

- Attestation gate (`400` unless `attestation === true`) writing an `Attestation` row with
  timestamp, user agent and the granted `allowActions`.
- Destructive-action blocklist in [aria.ts:212](../apps/engine/src/aria.ts#L212), matching
  CLAUDE.md §8 and TRD S4 exactly, with the per-run allowlist overriding it.
- SSE with a replay buffer, so a subscriber that connects after a fast crawl still sees
  everything.
- Orphan sweep on boot, derived from the enum so no status can be missed.
- **`PL-06`** — the harness. Ground truth is a committed file
  ([apps/demo/planted-defects.json](../apps/demo/planted-defects.json)), read not embedded;
  matching is by (expected signature + route), never by finding text; exits non-zero below 5 of 6.

**Partial / not done.**

- **`/health` returns `{status, engine, version}` only.** No browser, provider or replay-mode
  reporting (PL-05).
- **No run history / `GET /runs` list** (PL-03).
- The SSE event log **never evicts** — `eventLog` in `sse.ts` grows for the process lifetime.
- **No README** (PL-07 otherwise done: root `dev`/`build`/`demo`/`test`/`db:*` scripts and a
  complete `.env.example` exist).
- The port is **hardcoded 4000** at [server.ts:455](../apps/engine/src/server.ts#L455); the
  `PORT` in `.env` is never read.

### Interface

[FindingsView.tsx](../apps/interface/src/components/FindingsView.tsx) **532** ·
[TourBuilder.tsx](../apps/interface/src/components/TourBuilder.tsx) **433** ·
[LiveConsole.tsx](../apps/interface/src/components/LiveConsole.tsx) **230** ·
[Atlas3D.tsx](../apps/interface/src/components/Atlas3D.tsx) **223** ·
[Atlas2D.tsx](../apps/interface/src/components/Atlas2D.tsx) **178** ·
[design/FrictionMeter.tsx](../apps/interface/src/components/design/FrictionMeter.tsx) **105** ·
[design/ProvenanceBadge.tsx](../apps/interface/src/components/design/ProvenanceBadge.tsx) **61** ·
[tailwind.config.ts](../apps/interface/tailwind.config.ts) **119**

**Works.**

- **Design tokens (§12 of the UI/UX brief) are transcribed verbatim** — all 20 colour tokens,
  four font families including the condensed cut, the full type scale, space scale, radii,
  durations and easings. Audited: **zero hexes in the config that are not in the brief**, and no
  stock slate/cyan/emerald/red/violet/indigo anywhere in `apps/interface/src`.
- **`packages/core/src/ramp.ts`** is the single friction ramp — OKLab interpolation,
  `frictionColor` / `frictionRing` / `frictionElevation` / `frictionLightness`. React imports it;
  three.js will import the same module.
- **`ProvenanceBadge`** — glyph + word + colour, three encodings, never colour alone.
- **`FrictionMeter`** — bar + ramp colour + numeral; `score === null` renders an **em dash**, never
  a zero.
- **`FindingsView` (AT-08)** is the real thing: fetches `/runs/:id`, `/runs/:id/findings` and
  `/runs/:id/graph` in parallel, joins findings to `AtlasNode` for screen name and metrics,
  renders ranked cards with evidence lightboxes, the bias disclosure, "Generate tour from top 3",
  a zero state and a failure state that distinguishes a 404 from an unreachable engine.
- **`prefers-reduced-motion` is wired**, and asserted.
- Live crawl view with the stage rail, SSE feed, and a 2D/3D Atlas toggle that never unmounts the
  canvas.

**Partial / not done.**

- **The Atlas is not wired to data.** `?view=atlas` renders `"Atlas view stub"`. `Atlas2D`/`Atlas3D`
  are rendered only inside `LiveConsole`, fed raw `AppState[]` from SSE with no metrics — contour
  rings are commented "decorative until real friction metrics exist". `AtlasInspector` renders
  four em dashes. AT-01, AT-03, AT-05, AT-06, AT-07, AT-09, AT-10 are all unbuilt. **`AT-02`, the
  endpoint, is done** — nothing consumes it except `FindingsView`.
- **The brief's type scale is applied only in `FindingsView` and the two `design/` components.**
  Launchpad, Setup, `LiveConsole`, `TourBuilder` and `AtlasInspector` still use stock Tailwind
  sizes (`text-sm`, `text-5xl`, …) — 60+ occurrences.
- No ExclusionIndex header (blocked on AN-07). No segment filter.

---

## 4. What is not built — P0 and P1 by feature ID

Every ID from PRD §8 that is not DONE, with what blocks it.

### P0

| ID | Feature | State | Blocked by |
|---|---|---|---|
| CR-02 | Priority frontier queue | PARTIAL | Nothing. Plain FIFO today; ~30 lines to score and sort the frontier. |
| CR-05 | `observedDelta` / `irreversible` / `latencyMs` on edges | PARTIAL | Schema change in `packages/core` + capture in the crawl loop. `latencyMs` also unblocks `slow-response` and `medianActionLatencyMs`. |
| CR-10 | SSRF guard, bot UA, run-id header, robots.txt | PARTIAL | Nothing. Blocklist, budget and allowlist exist; the other four are unwritten. `ALLOW_PRIVATE_TARGETS` is in `.env` but no code reads it. |
| CR-11 | SSE buffer eviction | PARTIAL | Nothing. ~5 lines. |
| CR-12 | Ninth static signal | PARTIAL | CR-05's `latencyMs`. |
| PS-03 | Population size 50–1000, exposed on Setup | NEW | Nothing. Hardcoded 1000 in `run-defaults.ts`; Setup has no control. |
| PS-04 | Task definition with a graph-checkable goal predicate | NEW | Nothing. Chorus takes no task; "any sink is the goal". |
| PS-05 | Named segments derived from traits | NEW | Nothing, and **this is the gate for the whole exclusion story**. |
| CH-02 | Task-aware walks | NEW | PS-04. |
| CH-04 | Per-segment metrics | NEW | PS-05. **The single highest-value unbuilt item.** |
| CH-05 | Provenance assignment per L6 | NEW | Nothing. Hardcoded `"modeled"`. |
| AN-03 | Fix Value | PARTIAL | AN-04. |
| AN-04 | Failure-blame attribution | **NOT DONE** | Nothing. `impact = friction/100` today. |
| AN-06 | Evidence bundle with affected segments | PARTIAL | CH-04 for the segments half. |
| AN-07 | ExclusionDelta + ExclusionIndex | NEW | CH-04. |
| AT-01 | 2D Atlas driven by data | PARTIAL | Nothing — AT-02 shipped. Route `?view=atlas` to `Atlas2D`/`Atlas3D` fed from `GET /runs/:id/graph`. |
| AT-03 | Friction as colour + elevation + rings + numeral | PARTIAL | AT-01. `ramp.ts` and `FrictionMeter` already exist. |
| AT-07 | Node inspector with real metrics | PARTIAL | AT-01. |
| TR-06 | Tour plays live on Meridian | PARTIAL | Cross-origin injection. Snippet + `usher-rt` both work. |
| TR-07 | Drift — re-resolve anchors against the v2 graph | NEW | A Meridian v2 with the renamed control, and a second crawl to compare against. |
| TR-08 | Re-anchor proposal + approval | NEW | TR-07. |
| PL-05 | `/health` reporting browser, provider, replay mode | PARTIAL | Nothing. |
| PL-07 | README | PARTIAL | Nothing. Scripts and `.env.example` are done. |

### P1

| ID | Feature | State | Blocked by |
|---|---|---|---|
| CH-06 | Bootstrap CI95 across 20 batches | NEW | Nothing. |
| AT-05 | Contour rings driven by friction | NEW | AT-01. `frictionRing` exists. |
| AT-06 | Persona-flow particles and the leak | NEW | AT-01 + walk paths exposed on the wire. |
| AT-09 | Persona replay | NEW | AT-01 + `GET /runs/:id/walks`. Chorus already produces walk paths internally. |
| AT-10 | Segment filter | NEW | CH-04. |
| PL-03 | Run history on Launchpad | NEW | A `GET /runs` list endpoint. |

---

## 5. Known limitations and shortcuts

**The Modeled pass produced zero findings in the graded run.** All nine findings are `observed`.
`FRICTION_THRESHOLD = 40` gates Pass 2, and the highest friction any state reached was **29.56**
(`s5`, the webhook modal). So Chorus currently contributes **ranking only** — Fix Value orders the
list — and never admits a finding of its own. This is a real gap, not a tuning opportunity: the
threshold is a declared constant and lowering it to make the Modeled pass fire would be fitting a
number to a demo. Say this plainly rather than implying the simulation is finding defects.

**D1 ranks #9 and does not make the top 8. Measured, here is why.** `/workspace` (`s1`) has
**2 outgoing edges, 1 of them forward**. The below-fold penalty is applied to every persona —
`"Create workspace"` is in `belowFoldInteractives` and its affordance is multiplied by each
persona's scroll tendency — but a softmax over a set with one viable forward option still sends
nearly everyone through it. The result: friction **1.33**, dropout **3.8%**, hesitation **0**,
`fixValue = 0.013 × 0.974 × 1.0 = 0.0129`. Fix Value is what ranks the list, so a real, correctly
detected, browser-verified defect sits at #9. Making it move requires either a modelled task with
a goal predicate (PS-04) — so that failing to find the CTA is failing the task rather than taking
the only path — or AN-04's real blame attribution. It does **not** require touching a threshold.

**The two "false positives" are more interesting than the label.** Both are `dead-end` findings
raised by `annotateDeadEndControls`, which flags any click edge that self-loops:

- `#6 dead-end @ /connect` fires on `"Continue"` — and the answer key's own description of **D2**
  says *"Two competing CTAs; `Continue` is a no-op"*. The detector found the second half of a real
  planted defect and the grader scores it as a miss, because matching is one signature per defect.
- `#3 dead-end @ /webhook` fires on `"Learn about webhooks"` and `"Save webhook"` self-looping in
  the modal.

Neither is a hallucination. Both are counted against us anyway, which is the honest way to run it.

**No model is ever called.** `brain/adapter.ts` (148 lines) and `brain/heuristic.ts` (47 lines)
are **dead code — nothing imports them**. Chorus is pure TypeScript. So: cost is genuinely zero,
but the L2 "measurable cost" claim currently has nothing to measure, the `ModelCall` table is
never written, and `DECISION_CACHE` does nothing. Note also that `adapter.ts`'s `SYSTEM_PROMPT`
opens *"You are role-playing a real user"*, which contradicts CLAUDE.md §6.8 and L1 — if that
path is ever revived, the prompt has to be rewritten first.

**Dead schema.** `ScoutTrace`, `ModelCall` and `DriftReport` tables and the `Run.calibration`,
`Run.chorus`, `Run.scoutCount`, `Run.fitMae`, `Run.topFrictionScore` and `Run.topStateName`
columns are never written. `RunStatus` still carries `SCOUTING` and `CALIBRATING` even though
both subsystems are cut; `RunStage` was narrowed to five and no longer does.

**Declared-not-fitted constants.** None of these is calibrated against anything, and there is no
calibration subsystem to calibrate them with — that is cut. Every one is commented as such where
it is declared.

- `WEIGHTS` in Chorus: `goal 2.0, affordance 1.0, jargon 1.5, risk 1.0, giveUpBase -1.0,
  temperature 1.0`.
- `FRICTION_THRESHOLD 40`, `DEAD_CLICK_HIGH .25`, `JARGON_HIGH .25`, `LOOP_HIGH .25`,
  `BACKTRACK_HIGH .25`, `BLOCKED_HIGH .2`, `JARGON_SCORE_HIGH .4`, `CROWDED_INTERACTIVE_COUNT 12`.
- `TRAIT` values marked TRD are stated in the spec; `hintRelief .3`, `belowFoldFloor .15`,
  `belowFoldReadingWeight .6`, `patienceScrollReference 24` are declared here and nowhere else.
- `CRAWL_BUDGET 15`, `HARD_STEP_CEILING 30`, `MAX_STEP_BUFFER 5`.
- `MIN_NAMES_FOR_JARGON_SCORE 4`, `PRODUCT_VOCABULARY_MIN_STATES 3`, `JARGON_WORDS` (a
  hand-written list, conservative by design).

**Deliberate honesty behaviours, do not "fix" these into numbers.**

- `jargonScore` returns **null** below 4 accessible names — a 1-of-1 ratio is a rounding artifact.
- `tabbableNames === null` means "focusability was not measured" and applies **no** keyboard
  penalty. Not measured must never read as failed.
- `viewports` has no `desktop-1440` key; the laptop measurement stands in, named explicitly.
- Chorus's Modeled pass returns `null` — "high friction, no heuristic matched" — rather than
  inventing a signature.
- `metrics: null` on the wire, an em dash in the UI. Never a zero standing in for missing data.

**Claims we deliberately do not make.**

- Never that personas behave like real humans (L1). The claim is structural discovery.
- Never that Meridian's validation error is *absent* from the accessibility tree. It **is** in the
  tree; it is **never announced** — no `role=alert`, no `aria-live`. Measured. The stronger claim
  is false and must not be written.
- Never that `slow-response` was ruled out. It cannot be produced at all.
- Never that the demo crawls live. It replays a fixture, and the slide says so (L5).

**Determinism.** The seed is the fixed constant `mulberry32(0xc0ffee)`, not `runId` — deliberate,
and commented: reproducible given the same inputs is what determinism means here. The same graph
therefore always yields the same Chorus output.

**Environment shortcuts.** `.env.example` declares `PORT`, `ALLOW_PRIVATE_TARGETS`,
`MODEL_API_KEY`, `MODEL_BASE_URL`, `MODEL_NAME`, `DECISION_CACHE`, `CRAWL_MAX_STATES` and
`CRAWL_MAX_DEPTH`. **None of them is read by any code.** The only env vars with effect are
`DATABASE_URL` (Prisma) and `DRYRUN_REPLAY`.

**Two UI/UX brief conflicts, resolved and recorded.**

- The brief's own friction ramp is **not monotonic in lightness**, though §3.5 says it is. OKLab L
  at the six declared stops: `0→0.271, 20→0.387, 40→0.528, 60→0.702, 80→0.778, 100→0.727`. `--f-80`
  is lighter than `--f-100`, so in greyscale a score near 73 collides with 100. The hexes are
  normative and `#FF7A45` is also `--marker`, so nothing was changed; `ramp.test.ts` asserts
  monotonicity 0→80, **pins the 80→100 descent** so a future correction fails loudly, and proves
  ring count still separates the colliding pair.
- §9 says the friction numeral is ramp-coloured; §10.1 requires 4.5:1. Measured against the card's
  `--chart-shelf`: `f-0 1.11:1`, `f-20 1.73:1`, `f-40 3.19:1`, `f-60 6.33:1`, `f-80 8.17:1`,
  `f-100 6.42:1`. The numeral keeps the ramp colour where it passes and falls back to `--ink-0`
  (13.15:1) where it does not. No new colour; both are declared tokens.

---

## 6. Doc corrections outstanding

Verified against the code on 2026-09-05. The code is correct in every row below.

| # | Where | Says | Actually |
|---|---|---|---|
| 1 | `02-TRD-v2.md:129`, `:96`; `01-PRD-v2.md:346` | `RunStage = 'analyse'` | `'analysis'` — `packages/core/src/enums.ts:46`. `RunStage` is also now narrowed to five values; `scouts` and `calibration` are gone. |
| 2 | `02-TRD-v2.md:431` | "Seeded by `runId` so a demo replays" | Fixed constant `mulberry32(0xc0ffee)` — `chorus.ts:513`. Deliberate, and commented. |
| 3 | `02-TRD-v2.md:640` | `DATABASE_URL="file:./data/dryrun.db"` | `file:../data/dryrun.db`. Prisma resolves a relative SQLite URL against the **schema's** directory (`apps/engine/prisma/`), so `./data` would land inside `prisma/`. |
| 4 | `02-TRD-v2.md:663`, `06-Implementation-Plan-v2.md:68` | `npx playwright install chromium` | Installs a fresh Playwright outside the workspace. Use `pnpm --filter engine exec playwright install chromium`. |
| 5 | `02-TRD-v2.md:665` | `pnpm --filter engine exec prisma generate && prisma db push && prisma db seed` | The bare `prisma` after `&&` does not resolve — binaries are not hoisted. Use the root scripts `pnpm db:push` / `pnpm db:seed`. |
| 6 | `02-TRD-v2.md:453`; `03-App-Flow-v2.md:227`; `05-Backend-Schema-v2.md:189`; `06-Implementation-Plan-v2.md:251` | D3's error text is at **1.9:1** | Measured **1.11:1** (`#3a3a3a` on `#333333`). PRD §9.1 and §6.5 already carry the corrected figure. |
| 7 | Everywhere the old prototype's D3 copy survives | The error is missing from the accessibility tree | It **is** in the accessibility tree. It is never *announced* — no `role=alert`, no `aria-live`. Do not write the stronger claim. |
| 8 | `01-PRD-v2.md:199` | `"1.11:1with no aria-live"` | Missing space — typo introduced with the contrast correction. |
| 9 | `02-TRD-v2.md:525` | `GET /runs/:id/graph` — "FIX — returns stubs today" | AT-02 shipped. Returns `{nodes: AtlasNode[], edges, truncated}` with metrics joined. |
| 10 | `02-TRD-v2.md:525` | `GET /runs/:id/findings` — "FIX — returns stubs today" | Returns real `Finding` rows ordered by rank. |
| 11 | `02-TRD-v2.md:540` | "Delete `GET /runs/:id/graph`'s stub path and `stubs.ts` entirely" | There is no `stubs.ts` in the repo. |
| 12 | `02-TRD-v2.md:525` | `DELETE /runs/:id` — NEW | Exists — `server.ts:431`. |
| 13 | `02-TRD-v2.md:512` | Textures "server-pre-resized 512×320 JPEG q70" | `screenshots.ts` writes thumbnails at width **320**, q70. Either the code or the spec should move. |
| 14 | `02-TRD-v2.md:§11` / `.env.example` | `MODEL_API_KEY` / `MODEL_BASE_URL` / `MODEL_NAME` | `brain/adapter.ts:18–31` reads `REKA_*`, `GEMINI_*` and `LLM_PROVIDER`. Moot while the adapter is unimported, but the names disagree. |
| 15 | `.env.example` | `PORT`, `ALLOW_PRIVATE_TARGETS`, `DECISION_CACHE`, `CRAWL_MAX_STATES`, `CRAWL_MAX_DEPTH` | None is read by any code. Port is hardcoded 4000. |
| 16 | `03-App-Flow-v2.md:§8` vs `04-UIUX-Brief-v2.md:391` | App-Flow states no width for Findings; the brief says **880px** | Implemented at 880px, per the brief's higher authority on measurements. (App-Flow:328's 820px belongs to §9, the Tour Builder.) |
| 17 | `01-PRD-v2.md:§8.4` AN-04 | listed FIX | Still accurate — this one is **not** done. Do not mark it. |

---

## 7. How to run it

Prerequisites: Node 24, pnpm, and Chromium for Playwright.

```bash
pnpm install
pnpm --filter engine exec playwright install chromium   # ~150 MB, start it first
cp apps/engine/.env.example apps/engine/.env            # then set DATABASE_URL, PORT=4000,
                                                        # ALLOW_PRIVATE_TARGETS=1
pnpm --filter @dry-run/core build                       # engine resolves core from dist/
pnpm db:push && pnpm db:seed
```

| Command | What it does |
|---|---|
| `pnpm dev` | All three at once: Meridian on **:5173**, engine on **:4000**, interface on **:3000**. |
| `pnpm dev:demo` / `dev:engine` / `dev:web` | The same three, individually. |
| **`pnpm demo`** | **The stage path.** Full pipeline from the cached `meridian-v1` fixture, then the planted-defect scorecard. Needs no browser and no running services. Exits non-zero below 5 of 6. |
| `pnpm demo:live` | Same grading against a live crawl. Meridian must be running on :5173. |
| `pnpm test` | 28 tests in `packages/core`. |
| `pnpm build` | core → usher-rt → interface. |
| `pnpm db:studio` | Prisma Studio against the SQLite file. |

**After every change to `packages/core`, run `pnpm --filter @dry-run/core build`.** The engine
imports the built `dist/`, so an unbuilt core produces confusing "property does not exist" errors
from `tsc` in the engine.

**A full manual pass:** `pnpm dev`, open `http://localhost:3000`, click *Try the demo target*,
attest, launch. The run streams into the Live view and lands on Findings. `?view=findings` is the
finished screen; `?view=tour` works; `?view=atlas` and `?view=drift` are stubs.

Screenshots are written to `apps/engine/data/runs/<runId>/` and served from the engine at
`/static/runs/...`, proxied through Next.

**Windows note:** `tsx` is not installed in `packages/core`, so ad-hoc scripts there have to run
through vitest. Bash heredocs in this environment intermittently fail to parse; write files with
the editor and append with `cat`.

---

## 8. What comes next, in dependency order

1. **PS-05 named segments → CH-04 per-segment metrics → AN-07 ExclusionDelta / ExclusionIndex.**
   This chain is the SDG 4/10 story, L3, and the ExclusionIndex header the Findings view was
   built with room for. Nothing else unblocks as much. It also fills `AN-06`'s
   `affectedSegments`, and it is the only way to state the screen-reader-versus-baseline
   number the deck wants.
2. **AT-01 / AT-03 / AT-07 — wire the Atlas to `GET /runs/:id/graph`.** The endpoint, the ramp and
   the friction meter all exist; the Atlas is the last place still rendering constants. Route
   `?view=atlas`, feed `AtlasNode[]`, drive elevation and rings from `ramp.ts`, fill the inspector.
3. **CH-05 provenance, then AN-04 blame attribution.** CH-05 is small. AN-04 is the honest fix for
   D1's ranking and removes the `impact = friction/100` proxy — do it before claiming Fix Value
   means what §6.3 says it means.
4. **PS-04 tasks + CH-02 task-aware walks.** Gives the walk a goal predicate, which is the other
   half of D1's ranking problem and makes "dropout" mean "failed the task" rather than "stopped".
5. **TR-07 / TR-08 drift.** Needs a Meridian v2 with the renamed and moved control, plus a second
   crawl. `usher-rt` already fails cleanly, so this is re-resolution and a diff, not a matcher.
6. **CR-10 safety completion** — SSRF guard, `User-Agent: DryRun-Bot/1.0`, `X-DryRun-Run-Id`,
   `robots.txt`. The deck claims these; CLAUDE.md §8 says they must exist in code. Cheap, and
   currently a claim without an implementation.
7. **Housekeeping, any time:** README (PL-07), `/health` detail (PL-05), SSE buffer eviction,
   `PORT` from env, and applying the brief's type scale to Launchpad, Setup, `LiveConsole` and
   `TourBuilder`.

Under CLAUDE.md §6.9, everything after H+26 must be additive — new files, new functions, nullable
columns. Items 1, 2, 5 and 6 are all additive. Items 3 and 4 change existing signatures; do them
before that gate or not at all.
