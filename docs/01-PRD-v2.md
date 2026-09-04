# Dry Run — Product Requirements Document (PRD) v2

**Document:** 1 of 6 · **Version:** 2.0 · **Event:** IEEE WIE WE Hack 5.0
**Supersedes:** 01-PRD v1.0 (DevJams'26)
**Governed by:** `CLAUDE.md` · **Feeds:** 02-TRD · 03-App-Flow · 04-UIUX · 06-Implementation-Plan

---

## 0. What changed from v1 — read this first

| # | v1 | v2 | Why |
|---|---|---|---|
| 1 | "Are the personas realistic?" answered with calibration | **Realism is not claimed at all.** We claim structural discovery. | Defensible in Q&A; a hackathon cannot validate persona realism |
| 2 | Two tiers: grounded **Scouts** + modeled **Chorus** | **Scouts cut.** One tier: the crawler observes, Chorus models. | Scouts never existed in code; the crawler is already a real browser and a valid "Observed" source |
| 3 | Calibration fits Chorus weights to Scout traces | **Calibration cut.** Weights are declared constants, surfaced in the UI. | Nothing left to calibrate against; hiding the constants would be dishonest, showing them is fine |
| 4 | Population framed as conversion testing | **Population is exclusion-weighted and measured** via `ExclusionDelta` | L3. This is the SDG 4/10 story and it now has a metric |
| 5 | Drift via node matching + pHash | **Drift is anchor-level only** | Same demo beat, a fraction of the build |
| 6 | 5 modules | **4 modules** (Cartographer, Chorus, Atlas, Usher) | Scouts removed |
| 7 | 48h, 4 people, Dev Tools track | **36h, 3 people, Intelligent Digital Solutions** | New event |
| 8 | Everything greenfield | **Engine, core, usher-rt, Meridian imported** | Prior prototype; disclosed in `PROVENANCE.md` |

Everything not listed here carries forward from v1 unchanged.

---

## 1. One-liner

> **Dry Run finds where your onboarding breaks before a single real user signs up — then
> builds the guided tour that fixes it, and tells you which steps broke on your next deploy.**

### 60-second judge pitch

Most signups never reach the moment a product becomes useful. Nothing throws an error — no
exception, no failing test. The only signal is a churn number that arrives weeks later and
never names the screen.

Dry Run crawls your staging app into a semantic map of every screen and action, labelled from
the accessibility tree so a renamed CSS class doesn't break the map. It then walks a weighted
population of personas across that map — deliberately weighted toward the users most likely to
be locked out: low digital literacy, non-native speakers, mobile, screen-reader. Every loop,
dead click and drop-off is attributed to a specific screen. It ranks screens by damage, and for
the worst ones it compiles a guided tour bound to semantic anchors rather than selectors. On the
next deploy it re-resolves those anchors and tells you which steps broke.

**We do not claim our personas behave like humans.** We claim they find properties of the
*interface* — loops, dead ends, unreachable states, ambiguous choices, and screens that work for
one kind of user and not another. That claim survives scrutiny; behavioural realism would not.

---

## 2. Problem

A user signs up, lands in an empty app, and must connect a data source, invite a teammate or
configure a webhook before anything is useful. Somewhere in that sequence they stall — a label
they don't understand, a button below the fold, a validation error rendered grey-on-grey — and
they close the tab. **Nothing throws an error.**

### Why existing approaches don't close it

| Approach | Why it fails |
|---|---|
| Analytics / session replay | Post-hoc, needs traffic you don't have yet, tells you *that* people left |
| Hand-built tours (Appcues, Pendo, Userpilot) | Authored manually, anchored to CSS. A renamed class silently kills the tour. |
| Human usability testing | Accurate, slow, expensive. Weeks per round. |
| E2E tests (Playwright, Cypress) | Assert correctness, not comprehension. A flow can pass every test and confuse every human. |
| AI usability tools (Swarm, Maze AI, Synthetic Users) | Run agent sessions and summarise transcripts. Stop at the report; each run independent; no maintained fix. |
| Accessibility scanners (axe, Lighthouse) | Check rule compliance on a page. Cannot tell you a *flow* is impassable for a screen-reader user. |

### The gap

> Nobody turns the app into a **persistent, comparable structure**. So nobody can attribute
> friction to a specific screen, rank fixes by expected gain, ship the fix as an artifact, or
> tell you which fixes broke when you redeployed — and nobody can say *which segment of users*
> the interface excludes.

---

## 3. Target users

| # | Persona | Job to be done |
|---|---|---|
| **P1** | Priya, founding PM at a seed-stage B2B SaaS. Ships weekly, activation 19%, eleven setup screens, no researcher. | "Before we ship an onboarding change, tell me which screen will cost us the most signups." |
| **P2** | Arjun, growth engineer. Hand-built the current tour; it breaks every other deploy and he finds out from a support ticket. | "When we deploy, tell me within minutes which tour steps broke and re-anchor them." |
| **P3** | Meera, solo designer-founder, pre-launch, zero traffic, one week from launch. | "Before anyone sees this, give me a prioritised list of what will confuse people." |
| **P4** | Ravi, public-service digital team shipping a citizen-facing portal with an accessibility mandate. | "Show me which parts of this flow a screen-reader user or a low-literacy user cannot complete." |

P4 is new in v2 and is the SDG-facing user. Secondary: DevRel validating quickstarts · agencies
auditing client onboarding.
**Not our user:** consumer apps with mature analytics · native-mobile-only products · anyone
wanting security or load testing.

---

## 4. Positioning — the claim we defend (L1)

**What we claim:** Dry Run discovers structural properties of an interface at population scale
and attributes them to specific screens.

| We claim | We do not claim |
|---|---|
| This screen has a control that produces no state change | Real users feel frustrated here |
| This screen is unreachable at a 390px viewport | 23% of real mobile users churn here |
| 41% of personas could not determine which control advances the task | 41% of humans would fail |
| This flow cannot be completed with the accessibility tree alone | Our screen-reader persona is a real screen-reader user |
| These are hypotheses ranked by expected value | These are measurements of human behaviour |

**The Q&A answer, verbatim:** *"We don't claim persona realism. The population finds loops, dead
ends, unreachable states and ambiguous choices — those are properties of the interface, not of
human psychology. A screen where 40% of agents can't determine what to click is ambiguous
whether or not the agents are human-like. And where we have a browser-verified fact, we label it
Observed and show you the evidence."*

---

## 5. The wedge

**5.1 Graph-first, not session-first.** Competitors run N independent sessions and summarise
transcripts. We build a persistent State Graph first, so every finding is attributed to a node
or edge. That unlocks cross-run comparability, deploy diffing, cheap population simulation, and
semantic anchoring.

**5.2 Population scale, honestly earned.** The graph is crawled once and shared. Persona
diversity is parameters over one graph, not N browser sessions. Model calls occur only at
ambiguous decision nodes and are memoised per `(archetype, stateFingerprint)`. The escalation
rate is a displayed metric: *we spend a model call only where a person would actually hesitate.*

**5.3 Exclusion, not conversion.** The population is weighted toward the users most likely to be
locked out. The headline output is not "activation would rise 4%" but *"this screen is passable
for a confident desktop user and impassable for a screen-reader user."* No competitor in that
room will be measuring that.

**5.4 It closes the loop to a maintained artifact.** Findings are not the deliverable; the tour
is. Steps bind to semantic anchors, so on redeploy we re-resolve and report
`intact / re-anchored / broken`, with a human approving each repair.

---

## 6. Scoring model

### 6.1 Per-state metrics
For state `s`, over population `P` weighted by persona `weight`:

| Metric | Definition |
|---|---|
| `Dropout(s)` | personas terminating at `s` ÷ personas entering `s` |
| `Blocked(s)` | personas hitting a hard dead-end at `s` ÷ entered |
| `Loop(s)` | `min(mean(max(0, visits − 1)), 5) ÷ 5` |
| `DeadClick(s)` | interactions producing no observable state delta ÷ interactions on `s` |
| `Hesitation(s)` | median steps before the first goal-advancing action, squashed to 0–1 |
| `Backtrack(s)` | reverse-edge traversals ÷ total exits from `s` |

### 6.2 Friction Score (0–100)
```
FrictionScore(s) = 100 × ( 0.35·Dropout + 0.20·Blocked + 0.15·Loop
                         + 0.12·DeadClick + 0.10·Hesitation + 0.08·Backtrack )
```
Weights sum to 1.00, are declared constants, and are **surfaced in the UI** — the operator can
see exactly what produced the number. Implemented and unit-tested in `packages/core/scoring.ts`;
do not reimplement.

### 6.3 Fix Value (0–1)
```
FixValue(s) = Impact(s) × Reach(s) × Confidence(s)
```
- `Impact(s)` — share of all task failures attributed to `s`. **1.0** to the terminal state of a
  failed walk; **0.25** distributed across states looped through ≥2 times; then normalised.
  *(v1 note: the prototype used `friction/100` as a proxy. That is a P0 correctness fix — AN-04.)*
- `Reach(s)` — personas entering `s` ÷ `|P|`
- `Confidence(s)` — **redefined in v2**, since there are no grounded scout visits:
  ```
  Confidence(s) = 0.5
                + 0.3 × (crawler reached s in a real browser ? 1 : 0)
                + 0.2 × (s has ≥1 Observed static signal ? 1 : 0)
  ```
  A state the crawler never reached is capped at 0.5 and badged **Predicted**.

The ranked list sorts by **Fix Value** and headlines **Friction Score**.

### 6.4 ExclusionDelta — new in v2, and the SDG metric
For state `s` and segment `g`:
```
ExclusionDelta(s, g) = Dropout(s | g) − Dropout(s | baseline)
```
`baseline` = the `confident-desktop` archetype. A positive delta means the screen is
disproportionately harder for that segment.

Per run:
```
ExclusionIndex = max over (s, g) of ExclusionDelta(s, g)
```
surfaced as one headline number with the segment named: *"Worst exclusion: Configure Webhook,
screen-reader, +0.62."* This is the Review 1 framing made measurable, and it is the single most
important new number in v2.

### 6.5 Findings, not raw metrics
Raw metrics cluster into named findings by signature. Target output quality:

> **Invisible validation error** — 41% of personas re-submitted the same API-key field 3+ times.
> Error text exists in the DOM at contrast 1.9:1 with no `aria-live`. Screen: *Connect Source*.
> Friction 78 · Fix Value 0.61 · **Observed** (browser-verified contrast).

**Eight signatures and their detection rules:**

| Signature | Rule |
|---|---|
| `hidden-cta` | `belowFoldPrimaryCta` ∧ `hesitation > 0.5` |
| `ambiguous-cta` | `competingCtas` ∧ `deadClick > 0.25` |
| `silent-validation` | `lowContrastText` ∧ `¬hasAriaLive` ∧ `loop > 0.3` |
| `dead-end` | `blocked > 0.2` ∧ no viable out-edge toward goal |
| `offscreen-control` | `offscreenInteractives.length > 0` ∧ mobile dropout ≫ desktop dropout |
| `jargon-gate` | `jargonScore > 0.4` ∧ dropout correlates negatively with `domainLiteracy` |
| `excessive-choice` | `interactiveCount > 12` ∧ `hesitation > 0.6` |
| `slow-response` | median action latency > 2000 ms |

⚠️ **The imported code maps three of these wrongly** (below-fold → `offscreen-control`,
low-contrast → `hidden-cta`, dead-click → `silent-validation`). Fixing this table is P0 —
without it every finding title is misleading and the evaluation harness scores nonsense.

---

## 7. Modules

| Module | Codename | Responsibility | State |
|---|---|---|---|
| Crawler | **Cartographer** | URL → State Graph, a11y-labelled, multi-viewport | Imported, works on real sites. Extend. |
| Population | **Chorus** | 50–1000 modeled personas walking the graph | Imported, complete core. Extend traits. |
| Scoring + visual | **Atlas** | Friction map, ranked list, evidence | Scoring done. Visual layer needs data + rebuild. |
| Tour compiler | **Usher** | Generate → approve → export → drift check | Imported, works end to end. Extend for drift. |

**Pipeline:**
```
URL → Cartographer → State Graph (desktop + mobile pass)
    → Chorus (weighted population, per-segment) → Analysis (findings + exclusion)
    → Atlas (ranked, visualised) → Usher (tour.json)
    → [Meridian v2] → Drift (re-resolve anchors) → approve → tour v2
```

---

## 8. Feature requirements

Priority: **P0** = demo dies without it · **P1** = differentiation · **P2** = only if ahead.
State: `HAVE` = imported and working · `FIX` = imported but wrong · `EXTEND` = imported, needs
more · `NEW` = does not exist.

### 8.1 Cartographer

| ID | Feature | Pri | State |
|---|---|---|---|
| CR-01 | Target intake: URL + attestation gate | P0 | HAVE |
| CR-02 | Playwright BFS crawl with priority queue (favour `continue\|next\|create\|connect\|invite\|setup`, penalise `help\|docs\|pricing\|blog\|terms\|logout`, decay by depth) | P0 | EXTEND — currently plain FIFO, explores footers as eagerly as the funnel |
| CR-03 | Accessibility-tree extraction per state (`ariaSnapshot({mode:"ai", boxes:true})`) | P0 | HAVE — the technical keystone, works on real websites |
| CR-04 | **Composite state fingerprint** — `sha256(urlPattern \| sortedRoleNamePairs \| primaryHeading \| landmarkSkeleton)` | P0 | FIX — current version is structure-only, so different screens collapse into one node and renames are invisible |
| CR-05 | Action-edge extraction with `observedDelta`, `irreversible`, `latencyMs` | P0 | EXTEND |
| CR-06 | Screenshots + 512×320 q70 thumbnails, **password/secret fields masked before write** | P0 | EXTEND |
| CR-07 | Seeded field values per run (`{"API key": "mk_demo123"}`) or `placeholder`-derived fill | **P0** | **NEW — highest-leverage single change in the project.** Without it the crawler stops at `/connect` and defects D4, D5, D6 are undetectable. |
| CR-08 | Graph persistence per run | P0 | HAVE |
| CR-09 | **Multi-viewport crawl** — desktop 1280 + mobile 390, per-viewport static signals | P0 | NEW — this is what makes D5 detectable and the mobile segment real |
| CR-10 | Safety: blocklist, budget, SSRF guard, bot UA, run-id header, robots.txt | P0 | EXTEND — only blocklist and budget exist |
| CR-11 | Live crawl SSE (`state-found`, `edge-found`) with buffer eviction | P0 | EXTEND |
| CR-12 | Static signals: below-fold CTA, offscreen interactives, WCAG contrast, `aria-live` presence, competing CTAs, jargon score, interactive count, **error-text contrast** | P0 | EXTEND — 5 of 9; error-text contrast is what classifies D3 |
| CR-13 | `DRYRUN_REPLAY=<fixtureId>` — serve a cached crawl instead of crawling (L5) | **P0** | NEW |

### 8.2 Personas

| ID | Feature | Pri | State |
|---|---|---|---|
| PS-01 | Trait vector: `role, domainLiteracy, patience{maxSteps,maxMs}, riskAversion, readingDepth, priorFamiliarity, device, inputMode, locale, weight` | P0 | EXTEND — `patience` is a bare number; `locale`, `archetype`, `label` missing |
| PS-02 | **Ten archetypes as a declared constant array**, exclusion-weighted per L3 | P0 | EXTEND — 4 hardcoded in `server.ts` |
| PS-03 | Population size 50–1000 with weights, exposed on Setup | P0 | NEW — hardcoded 1000 |
| PS-04 | Task definition with a graph-checkable goal predicate | P0 | NEW — one `DUMMY_TASK`; Chorus takes no task at all |
| PS-05 | Named segments derived from traits (`screen-reader`, `mobile`, `low-literacy`, `non-native`, `confident-desktop`) | P0 | NEW — required for ExclusionDelta |

**The ten archetypes and their weights** (sum = 1.00; deliberately not a conversion mix):

| Archetype | Weight | Distinguishing traits |
|---|---|---|
| Eager Beginner | 0.14 | low `domainLiteracy`, high `patience` |
| Non-technical Marketer | 0.13 | low `domainLiteracy`, mid `patience` |
| Mobile Commuter | 0.13 | `device: mobile-390`, low `patience` |
| Non-native Speaker | 0.12 | `locale: non-native`, low `readingDepth` |
| Screen-Reader User | 0.11 | `inputMode: screen-reader` |
| Cautious Ops Lead | 0.09 | high `riskAversion`, high `readingDepth` |
| Distracted Multitasker | 0.08 | very low `patience` |
| Impatient Founder | 0.07 | low `patience`, high `priorFamiliarity` |
| Confident Desktop *(baseline)* | 0.07 | high everything — the ExclusionDelta reference |
| Jargon-Fluent Engineer | 0.06 | high `domainLiteracy`, high `priorFamiliarity` |

### 8.3 Chorus

| ID | Feature | Pri | State |
|---|---|---|---|
| CH-01 | Monte Carlo walker, 1000 personas × 2 tasks < 30 s, seeded PRNG | P0 | HAVE — the most complete imported module |
| CH-02 | Task-aware walks with goal predicates | P0 | EXTEND — tasks not modelled at all |
| CH-03 | **All ten traits affect the walk** | P0 | EXTEND — only 3 of 10 do; `device`, `inputMode`, `locale`, `riskAversion`, `readingDepth` are parsed then ignored |
| CH-04 | **Per-segment metrics** — every `StateMetrics` computed per segment as well as overall | P0 | NEW — required for ExclusionDelta |
| CH-05 | Provenance assignment per L6 | P0 | NEW — currently hardcoded `"modeled"` |
| CH-06 | Bootstrap CI95 across 20 batches | P1 | NEW |

### 8.4 Analysis

| ID | Feature | Pri | State |
|---|---|---|---|
| AN-01 | Per-state metrics | P0 | HAVE |
| AN-02 | Friction Score | P0 | HAVE + tested |
| AN-03 | Fix Value | P0 | EXTEND |
| AN-04 | Failure-blame attribution per §6.3 | P0 | FIX — currently `impact = friction/100` |
| AN-05 | Signature classifier, all 8, **mapping corrected** | P0 | FIX |
| AN-06 | Evidence bundle: screenshot + the Observed fact + affected segments | P0 | EXTEND |
| AN-07 | ExclusionDelta + ExclusionIndex | **P0** | NEW |

### 8.5 Atlas

| ID | Feature | Pri | State |
|---|---|---|---|
| AT-01 | 2D Atlas: SVG, force layout, contour circles, selection, inspector | P0 | EXTEND — exists but no data drives it |
| AT-02 | **`StateMetrics` joined onto graph nodes on the wire** | **P0** | NEW — the single reason the map is currently cosmetic |
| AT-03 | Friction in ramp colour + node elevation + ring count + numeral | P0 | FIX — `frictionScore` hardcoded 0, elevation 0, no ramp |
| AT-04 | 3D Atlas: chart plane, textured nodes, plumb lines, Bézier edges, orbit | P0 | HAVE (cosmetic) |
| AT-05 | Contour rings driven by friction | P1 | NEW |
| AT-06 | Persona-flow particles + **the leak** | P1 | NEW — the best visual argument in the product |
| AT-07 | Node inspector with real metrics, provenance badge, segment bar | P0 | EXTEND — every metric renders `—` |
| AT-08 | **Ranked Findings view** | P0 | NEW — currently renders the string `"Findings view stub"` |
| AT-09 | Persona replay — follow one named persona's walk through the map | P1 | NEW — the emotional hook; feasible because Chorus already produces walk paths |
| AT-10 | Segment filter (view the map as one segment) | P1 | NEW — the exclusion story, visualised |
| AT-11 | 2D fallback toggle, canvas never unmounted | P0 | HAVE |

### 8.6 Usher

| ID | Feature | Pri | State |
|---|---|---|---|
| TR-01 | Generate steps from top-3 findings by Fix Value | P0 | HAVE |
| TR-02 | Semantic anchor compiler + 4-tier runtime resolution | P0 | HAVE — `usher-rt` is 5,342 bytes, keep verbatim |
| TR-03 | Copy grounded in the observed failure | P0 | HAVE (templates) |
| TR-04 | Approve / edit / reject / restore queue | P0 | HAVE — most complete UI in the imported code |
| TR-05 | Export `tour.json` + embed snippet, approval-gated server-side | P0 | HAVE |
| TR-06 | **Tour plays live on Meridian** | P0 | EXTEND — snippet exists, injection does not |
| TR-07 | **Drift: re-resolve every anchor against the v2 graph → `intact / re-anchored / broken`** | P0 | NEW |
| TR-08 | Re-anchor proposal + human approval → tour v2 | P0 | NEW |

### 8.7 Platform

| ID | Feature | Pri | State |
|---|---|---|---|
| PL-01 | **Run orchestrator state machine** `crawl → chorus → analyse → tour → done`, with `pct`, `DEGRADED` and cancel | **P0** | NEW — everything needed exists in pieces; nothing connects them |
| PL-02 | Attestation gate + audit log | P0 | HAVE |
| PL-03 | Run history on Launchpad | P1 | NEW |
| PL-04 | Live stage rail via SSE | P0 | HAVE — genuinely good, keep |
| PL-05 | `/health`: engine, browser, provider, replay mode | P1 | EXTEND |
| PL-06 | **Evaluation harness** — `pnpm demo` asserts *n* of 6 planted defects in the top 8 findings and prints precision/recall | **P0** | NEW |
| PL-07 | Root scripts (`dev`, `build`, `demo`), README, `.env.example` | P0 | NEW — the old repo had no scripts at all |

---

## 9. The demo

### 9.1 Meridian and its six planted defects
A deliberately mediocre fake B2B analytics SaaS in `apps/demo`. Flow: *Sign up → Create
workspace → Connect data source → Invite team → Configure webhook → Dashboard.*

| # | Screen | Defect | Expected signal | Detectable today? |
|---|---|---|---|---|
| D1 | Create Workspace | Primary CTA below the fold, no scroll cue | `belowFoldPrimaryCta`, high Hesitation | ✅ already proven |
| D2 | Connect Source | Two competing CTAs; "Continue" is a no-op | self-loop edge → DeadClick | ✅ already proven |
| D3 | Connect Source | Validation error at 1.9:1 contrast, no `aria-live` | error-text contrast + Loop; screen-reader segment fails | ⚠️ state is reached, never classified — needs CR-12 |
| D4 | Invite Team | No skip, broken back button | high Blocked | ❌ blocked by CR-07 |
| D5 | Configure Webhook | Modal close button offscreen at 390px | mobile-only dropout | ❌ needs CR-07 **and** CR-09 |
| D6 | Configure Webhook | Unexplained jargon | low-`domainLiteracy` abandon | ❌ blocked by CR-07 |

**Never "fix" Meridian's defects.** They are the test fixture. If the crawler can't get past a
defect, fix the *crawler* (CR-07), not the app.

**Meridian v2 — one change only:** on `/connect`, "Connect source" is renamed **"Add a source"**
and moved from the main card to a right-hand sidebar card. Everything else byte-identical. This
is the entire Drift demo.

### 9.2 Demo script — 4 minutes
| Time | Beat |
|---|---|
| 0:00–0:25 | The problem: the churn number that never names the screen |
| 0:25–1:10 | Run on Meridian from cached fixtures (**disclosed**): crawl streams into the Atlas, nodes rise as friction resolves, particles flow, a quarter of the current falls through the floor at Connect Source |
| 1:10–1:50 | Ranked findings. Open the worst: evidence screenshot, the Observed contrast fact, provenance badge |
| 1:50–2:20 | **Segment filter → screen-reader.** ExclusionIndex. *"This screen is passable for a confident desktop user and impassable for a screen-reader user."* |
| 2:20–2:50 | Generate tour → approve a step → **it plays live on Meridian** |
| 2:50–3:20 | Deploy v2 → Drift → one step re-anchored, one broken → approve the repair |
| 3:20–3:50 | **Evaluation slide:** we planted six, it found *n*, ranked *m* in the top three |
| 3:50–4:00 | Safety and ethics: attestation, blocklist, synthetic data, bias disclosure |

### 9.3 Risk controls
1. All demo crawls from cached fixtures. Say so (L5).
2. Two tasks only, both pre-defined.
3. Fallback ladder: cached run → recorded 90 s capture on USB → deck.
4. Rehearse with someone playing hostile judge.

---

## 10. Success metrics

### Hackathon
| Metric | Target |
|---|---|
| Planted defects surfaced in the top 8 findings | **≥ 5 of 6** |
| Planted defects in the top 3 by Fix Value | ≥ 2 |
| Full pipeline, cached fixture → ranked Atlas | < 45 s |
| Chorus 1000 × 2 tasks | < 30 s |
| Atlas frame rate on the demo laptop at 1280×720 | ≥ 60 fps, never below 40 |
| Tour plays on Meridian, live, unrehearsed | Yes / no — **the single most valuable moment in the demo** |
| Drift: ≥1 step re-anchored, ≥1 broken, approval works | Yes / no |
| ExclusionIndex reported with the segment named | Yes / no |
| False positives in the top 8 | ≤ 2, and disclosed |

### Judging criteria → what serves them
| Criterion | Our evidence |
|---|---|
| Innovation | Graph-first structural discovery; semantic anchors; self-healing tours |
| Scalability | One crawl, N personas; documented cost architecture; escalation rate |
| Track alignment (Intelligent Digital Solutions) | Digital Twins (the State Graph *is* a twin), Collective Intelligence (population), Behavioral Design (tours), Explainable AI (every finding traces to an Observed fact) |
| SDG impact | SDG 4 and 10 via ExclusionDelta — measured, not asserted |
| Technical depth | a11y-tree perception, composite fingerprinting, seeded Monte Carlo, 4-tier anchor resolution |
| Feasibility | Real crawler working on real websites; 5.3 KB embeddable runtime; unit-tested scoring |
| Presentation / UI-UX | The Atlas, and the fact that every visual property encodes data |

**Not claiming:** Affective Computing. Persona patience is not affect, and claiming it invites a
question we would lose.

---

## 11. Non-goals

Not a load or performance tester · not a security scanner · not a WCAG certification tool (we
*use* the a11y tree, we do not certify) · not a production analytics product · not a replacement
for real user research · not a native-mobile tester · not an auth-bypass or CAPTCHA solver.

---

## 12. Cut ladder — fire on the clock, don't negotiate at hour 30

| Trigger | Cut in this order |
|---|---|
| H+8 gate not green | Persona replay (AT-09) · CI95 (CH-06) · run history (PL-03) |
| H+16 gate not green | 3D Atlas — **ship 2D as the design, it is genuinely handsome** · contour rings · segment filter |
| H+24 gate not green | Particles and the leak · survey marker · bloom · live tour injection (fall back to a recorded GIF) · Drift (TR-07/08) |
| H+30 anything broken | Stop building. All remaining hours to rehearsal and the deck. |

**Never cut:** the ranked findings list · the tour export · the provenance badges ·
the ExclusionIndex · the evaluation slide. **Those five are the project.**

---

## 13. Open questions

1. Which two tasks go in the demo? Proposal: *Complete initial setup* (goal: heading "Your
   workspace is ready") and *Connect a data source* (goal: text "Source connected").
2. Model provider for the ambiguity escalation — inherit the OpenAI-compatible adapter and
   whichever single key works from the venue network. Heuristic-only must remain a valid path.
3. Do we show the weight constants in the UI (§6.2)? Recommended yes — it converts "magic
   numbers" from a weakness into a transparency feature.
