# Dry Run — Implementation Plan v2

**Document:** 6 of 6 · **Version:** 2.0 · **Event:** IEEE WIE WE Hack 5.0
**Supersedes:** 06-Implementation-Plan v1.0 (48 h, 4 people, greenfield)
**Governed by:** `CLAUDE.md` · **Depends on:** 01-PRD-v2 · 02-TRD-v2 · 03-App-Flow-v2 · 04-UIUX-Brief-v2 · 05-Backend-Schema-v2

This is the document you keep open. `H+0` is the moment the hackathon starts.

> ⚠️ **Confirm the review times before H+0 and shift every gate to match.** This plan assumes
> **Review 1 ≈ H+4** (idea), **Review 2 ≈ H+18** (≈50% progress), **Review 3 ≈ H+34**
> (functional prototype + live demo + Q&A). If the real schedule differs, the gates move; the
> *order* of work does not.

---

## 0. What changed from v1

| # | Change |
|---|---|
| 1 | **36 hours, not 48.** Every block is compressed and two subsystems are gone. |
| 2 | **Three people, not four.** Track D (artifact & story) is absorbed into A and B. |
| 3 | **Not greenfield.** ~5,000 lines are imported and working. The first block is *repair and wiring*, not construction. |
| 4 | **Scouts and calibration cut**, so ~8 hours of v1's Track B disappears. That budget is redirected to trait modelling, segment metrics and the exclusion story. |
| 5 | **Meridian already exists** with all six defects. Only v2 needs building. |
| 6 | **Gate 0 is new** — a 90-minute repair gate before anyone splits up. |
| 7 | **Fixture capture is an early deliverable**, not a hour-40 insurance policy. |

---

## 1. How to use this

1. **Three tracks, three owners, assigned before H+0.** Every task is tagged `[A]` `[B]` `[C]`.
2. **Five gates.** At each one everyone stops feature work and merges. Non-negotiable.
3. **The cut ladder has clock triggers** (§9). When a trigger fires, cut immediately. Do not
   negotiate at hour 30.
4. **Sleep in shifts** (§8). The team that sleeps beats the team that doesn't, and it is not close.
5. **After H+26, additive changes only.** New files, new functions, nullable columns. No refactors.

---

## 2. Tracks

| Track | Owns | Load |
|---|---|---|
| **A — Engine** | Orchestrator FSM · Cartographer (fingerprint, filler, priority, multi-viewport, signals, masking, SSRF) · replay fixtures · API endpoints · Prisma/SQLite · SSE | ~22 h |
| **B — Intelligence & artifact** | Chorus traits + segments + walks · Analysis (signatures, blame, exclusion) · Usher drift · Meridian v2 · evaluation harness · deck + demo script | ~22 h |
| **C — Interface** | Everything visual, per 04-UIUX §13. Full 36 hours, never reassigned. | ~30 h |

**Give Track B to your strongest generalist.** It is front-loaded (segments unblock C's best
surface) and back-loaded (the deck and the evaluation slide), and it owns the story.

**C is never pulled off the visual layer**, not to fix a backend bug, not at hour 30. UI/UX is
separately and heavily scored, and a half-built Atlas costs more than a missing endpoint.

**Float rule:** after Gate 3 (H+26), whoever is green joins whoever is behind. Nobody polishes
while someone else is drowning.

---

## 3. 🚦 Gate 0 · H+0 → H+1.5 — Repair, together, one screen

**Nobody splits up until a run walks end to end.** All three in one room. This is the highest-value
90 minutes of the entire hackathon, because everything downstream is already written and simply
disconnected.

| Min | Who | Task |
|---|---|---|
| 0–3 | **A** | `npx playwright install chromium` — start this first, longest download |
| 0–10 | **All** | New repo. First commit = `chore: import engine, core, usher-rt, demo from DevJams'26 prototype (649c2fc)`. Write `PROVENANCE.md`. Everyone clones. |
| 3–8 | **A** | **Fix the blocking bug:** `prisma/schema.prisma` line 2, `provider = "9-client-js"` → `"prisma-client-js"` |
| 8–15 | **A** | `pnpm install` · `prisma generate && db push && db seed` · `pnpm --filter @dry-run/core build` |
| 8–20 | **B** | **Delete `apps/engine/src/stubs.ts` and `runDummyScout`.** Remove every reference. Stub data served from live endpoints is the worst failure mode available. |
| 8–20 | **C** | Root `package.json` scripts (`dev`, `build`, `test`, `demo`), `.gitignore` (`data/`, `*.tsbuildinfo`, `_*_dump.json`), README skeleton |
| 20–45 | **A** | **CR-07 — the synthetic filler.** Seeded-value map + `placeholder` derivation, so `/connect` is passable. Verify the crawl reaches `/dashboard`: **6 states, not 4.** |
| 20–50 | **B** | **PL-01 — orchestrator skeleton.** `RunOrchestrator` class, sequential awaited stages, declared `pct`, real SSE stage events. Chorus and Analysis chained — no manual second HTTP call. |
| 45–70 | **C** | Tokens verbatim from 04-UIUX §12 · four fonts · contour substrate · `packages/core/ramp.ts`. Everyone inherits a styled shell. |
| 50–80 | **A + B** | Wire it: `POST /runs` → `crawl → chorus → analyse → tour → done`, with real data at every step |
| 80–90 | **All** | **Capture the first fixture.** Run the full pipeline on Meridian, commit `apps/engine/fixtures/meridian-v1/`. Demo insurance now exists. |

### Gate 0 definition of done — all must be true

```
✅ pnpm dev starts three services
✅ POST /runs on Meridian crawls SIX states (not four)
✅ The run reaches status DONE by itself, with no manual HTTP call
✅ findingCount > 0 in the database
✅ A committed fixture exists and can be replayed
✅ stubs.ts is deleted
```

**If Gate 0 is not green at H+1.5, everyone stays on it.** Splitting up before the pipeline chains
means two people building on a pipeline that stops.

---

## 4. Block 1 · H+1.5 → H+8 — Correctness

**Goal:** the numbers become real and the map stops lying.

| Track | Tasks |
|---|---|
| **A** | CR-04 composite fingerprint (**write `fingerprint.test.ts` first**) · CR-02 priority queue + depth/duration caps · CR-12 the four missing static signals, **including `errorTextContrast`** · S7 password/secret masking before screenshot write · S2 SSRF guard · CR-11 strip `a11yTree` from `state-found`, evict the SSE buffer |
| **B** | AN-05 **fix the crossed signature mapping** · AN-04 real blame attribution (not `friction/100`) · PS-01/PS-02 full trait vector + the ten archetypes as a constant · PS-04 tasks with goal predicates · CH-02 task-aware walks |
| **C** | Per 04-UIUX §13 → **H+8: 2D Atlas complete against committed fixtures** — SVG, force layout, contour circles, labels, selection, inspector. Provenance badge component built before anything renders a number. |

### 🚦 Gate 1 · H+8 — 30 minutes, everyone merges

```
✅ Renaming a Meridian button changes its fingerprint (test proves it)
✅ Every finding title matches what actually fired
✅ D1, D2, D3 all appear in the findings list with correct signatures
✅ 2D Atlas renders the fixture, nodes selectable, inspector shows real metrics
✅ No password appears in any screenshot on disk
✅ Tag gate-1
```

---

## 5. Block 2 · H+8 → H+17 — The exclusion story

**Goal:** the SDG claim becomes a measured number, and the map is driven by data.
**This block contains the two things no other team will have.**

| Track | Tasks |
|---|---|
| **A** | **CR-09 multi-viewport crawl** (desktop then mobile-390 signal pass) — this is what makes D5 detectable · **AT-02 `AtlasNode` with metrics joined on the wire** · `GET /runs/:id/exclusion` · `GET /runs/:id/walks` · CR-13 replay mode as a real code path with the banner |
| **B** | **CH-03 all ten traits affecting the walk** — `device` edge removal, `screen-reader` a11y-only perception, `locale` jargon multiplier, `riskAversion`, `readingDepth` · **CH-04 per-segment metrics** · **AN-07 ExclusionDelta + ExclusionIndex** · CH-05 provenance assignment · Chorus records walk paths for replay |
| **C** | Console shell, view tabs, stage rail, crawl/signal feed on SSE · **AT-08 the Findings view** (never-cut item) · **AT-03 friction driving elevation, ramp colour, ring count, counter rolls** |

### 🚦 Gate 2 · H+17 — Review 2 target

```
✅ D5 detected (mobile-only offscreen control)
✅ ExclusionIndex reported with the segment named
✅ Screen-reader segment's dropout on Connect Source is visibly higher than baseline
✅ Every node's friction comes from real metrics — zero hardcoded scores
✅ Findings view renders ranked cards with evidence and provenance badges
✅ Cached fixture → ranked Atlas in under 45 s
✅ Tag gate-2 · back up the database
```

**H+17 → H+18: stabilise and rehearse.** No new features. Rehearse the Review 2 demo twice, out
loud, on the actual machine.

### Review 2 — what to show (5 minutes)

1. **20 s — the problem.** The churn number that never names the screen.
2. **60 s — a run, from cache, disclosed.** Crawl feed showing real measured facts: contrast
   2.49:1, a dead-click self-loop. *"No AI involved yet — that's a browser measurement."*
3. **50 s — nodes rise, ranked list appears.** Friction, Fix Value, provenance badges.
4. **60 s — the segment filter.** Switch to screen-reader. The map recolours.
   *"This screen is passable for a confident desktop user and impassable for a screen-reader
   user. That's SDG 4 and 10, measured, not asserted."*
5. **40 s — positioning, volunteered before anyone asks.** *"We don't claim our personas behave
   like humans. We claim they find properties of the interface."* (`CLAUDE.md` L1)
6. **40 s — what's next.** Tour generation and drift, honestly labelled as in progress.
7. **Hold in reserve:** the ADR table (TRD §2.1), `/debug/decisions/:runId`, the escalation rate.

---

## 6. Block 3 · H+18 → H+26 — The artifact

**Goal:** it stops being a report and becomes a product.

| Track | Tasks |
|---|---|
| **A** | `/health` · cancel endpoint · failure states (unreachable, zero-state, DEGRADED) · SSE reconnect with backoff · orphan sweep covering **every** non-terminal status · pino logging · run history endpoint |
| **B** | **TR-06 tour plays live on Meridian** (`?tour=<id>` + `usher-rt` script tag) — *the single most valuable moment in the demo, so wire it now, not at hour 30* · **Meridian v2** (rename "Connect source" → "Add a source", move to sidebar card) · **TR-07/08 drift: anchor re-resolution → intact/re-anchored/broken → approve → tour v2** · **PL-06 evaluation harness** (`pnpm demo` prints *n* of 6 and precision/recall) |
| **C** | 3D Atlas: chart plane, textured nodes, plumb lines, Bézier edges, damped orbit, 2D⇄3D toggle · contour rings · particles · **the leak** |

### 🚦 Gate 3 · H+26 — Checkpoint

```
✅ Tour generated → step approved → exported → PLAYS ON MERIDIAN, live
✅ Drift: ≥1 step re-anchored, ≥1 broken, approval creates tour v2
✅ pnpm demo prints the planted-defect score (target ≥5 of 6 in the top 8)
✅ 3D Atlas at ≥60 fps on the demo laptop, 2D toggle instant
✅ The leak is visible at Connect Source
✅ Tag gate-3 · back up database + one fixture folder to USB
```

**Float activates. Additive changes only from here.**

---

## 7. Block 4 · H+26 → H+33 — Polish, then stop

| Track | Tasks |
|---|---|
| **A** | Escalation rate surfaced in the UI · quota-exhausted → heuristic-only chip · error copy that says what to do next · a clean-clone test: `git clone && pnpm install && pnpm dev` on a second machine |
| **B** | **Deck (8 slides)** · demo script written down and timed · the evaluation slide with real numbers · rehearse hostile Q&A · bias disclosure rendered in-product |
| **C** | Segment filter + exclusion strip · survey marker · bloom + FPS guard · fly-to + selection dimming · **persona replay scrubber** · `prefers-reduced-motion` pass · **projector test at 1280×720** · replay banner |

### 🚦 Gate 4 · H+33 → freeze at H+34

```
✅ Full 4-minute demo runs clean, twice in a row
✅ Reduced-motion and 1280×720 both verified on the actual projector if possible
✅ Deck complete, evaluation slide in it
✅ Fallback ladder tested: fixture replay works, video on USB, deck exported to PDF
✅ Tag freeze
```

**H+34 is a hard code freeze. No commits after it except reverts.**

---

## 8. Sleep rotation — mandatory, three people

| Window | Sleeping | Working |
|---|---|---|
| H+8 → H+13 | One person (5 h) | Two |
| H+13 → H+18 | The second person | Two |
| H+18 → H+23 | The third person | Two |
| H+30 → H+31.5 | All three, 90-minute nap in turns | — |

Five hours each, minimum, staggered so two people are always awake. Track C sleeps in the
H+13 → H+18 window, after the 2D Atlas is safe and before the 3D block.

**After H+26, nobody refactors.** A 4 a.m. refactor by a sleep-deprived person is the single most
common way a working hackathon project stops working.

---

## 9. Cut ladder — clock triggers, no debate

| Trigger | Cut, in this order |
|---|---|
| **Gate 0 not green at H+2** | Multi-viewport (loses D5) · persona replay · run history. All three stay on the pipeline. |
| **Gate 1 not green at H+9** | CI95 · keyboard-only trait · escalation-rate UI · `/debug/decisions` |
| **Gate 2 not green at H+18** | **3D Atlas entirely — ship 2D as the design, it is genuinely handsome** · contour rings · survey marker |
| **Gate 3 not green at H+27** | Particles and the leak · live tour injection (fall back to a recorded GIF) · drift (TR-07/08) · bloom |
| **H+30, anything still broken** | Stop building. Every remaining hour goes to rehearsal and the deck. |

**Never cut, under any circumstance:**
the ranked findings list · the tour export · the provenance badges · the ExclusionIndex ·
the evaluation slide. **Those five are the project.**

---

## 10. Meridian — verify, don't rebuild

All six defects are already present in code. Track B's job is to **verify each one is still
present and detectable**, not to rebuild them. Never "fix" a Meridian defect — if the crawler
can't get past one, fix the crawler.

| # | Screen | Defect | Verify |
|---|---|---|---|
| D1 | `/workspace` | CTA below the fold | `belowFoldPrimaryCta === true` at 1280 |
| D2 | `/connect` | "Continue" is a no-op | self-loop edge exists in the graph |
| D3 | `/connect` | Error at 1.9:1, no `aria-live` | `errorTextContrast < 4.5` **and** `hasAriaLive === false` |
| D4 | `/invite` | No skip, dead back button | reachable after CR-07; `blocked > 0.2` |
| D5 | `/webhook` | Close control offscreen at 390px | in `viewports['mobile-390'].offscreenInteractives` |
| D6 | `/webhook` | Unexplained jargon | `jargonScore > 0.4` |

**Meridian v2 — one change only:** `/connect`'s "Connect source" renamed **"Add a source"** and
moved from the main card to a right-hand sidebar card. Everything else byte-identical. Runs on
port 5174. That is the entire drift demo.

**Demo run config:**
- Task 1 — *Complete initial setup*: start `/signup`, goal = heading visible "Your workspace is ready"
- Task 2 — *Connect a data source*: start `/signup`, goal = text visible "Source connected"

---

## 11. Git discipline

- **`main` is always runnable.** Break it, fix or revert within 15 minutes.
- Short-lived branches `a/*`, `b/*`, `c/*`. **Merge to main every 2 hours minimum.** A branch that
  lives 8 hours is a merge conflict at hour 30.
- No PR reviews — too slow. Announce every merge out loud in the room.
- **Never force-push to `main`.** Not once, not at 4 a.m., not "just to clean up".
- Commit format `[A] crawl: composite state fingerprint`. Track tag first makes the log a status report.
- Tag `gate-1` … `freeze`. If everything breaks you can demo from a tag.
- **First commit is the disclosed import.** Everything after it is dated inside the window, which
  is what makes the provenance story an asset rather than a discovery.

---

## 12. The stuck protocol

**The 20-minute rule.** Stuck for 20 minutes with no progress? Say it out loud, in the room. Not
in chat. Not after another hour.

At 20 minutes: describe the problem to another person, out loud. At 40: swap the task or stub it
and move on. At 60: it goes on the cut ladder.

The most expensive thing at a hackathon is one person silently debugging for three hours while
two people assume that module is fine.

---

## 13. Rehearsal

| When | What |
|---|---|
| H+17.5 | Review 2 version, twice |
| H+31 | Full 4-minute demo, once — expect it to go badly |
| H+32 | Fix what broke, run it again |
| H+33.5 | Twice more, back to back, one person playing hostile judge |

**One presenter, one driver.** The presenter talks and never touches the keyboard; the driver
clicks and never talks.

**Rehearse the failure paths.** Someone hands the driver a broken URL mid-rehearsal, so you have
seen your own DEGRADED state before a judge does.

**Fallback ladder:** cached fixture replay (primary — this *is* the demo) → a second fixture →
recorded 90-second capture on USB → the deck.

---

## 14. Deck — 8 slides `[B]`

1. **Dry Run** — "Find where onboarding breaks. Before anyone signs up."
2. **The problem** — the churn number that never names the screen
3. **The loop** — crawl → population → rank → tour → drift. One diagram.
4. **[LIVE DEMO]** — most of your time lives here
5. **How 1000 personas works, honestly** — one graph, parameters not sessions, memoised model
   calls at ambiguous nodes only, escalation rate. **And the positioning: we don't claim realism.**
6. **Digital exclusion** — the weighted population, ExclusionDelta, SDG 4 and 10. The segment
   recolour screenshot.
7. **Evaluation** — *we planted six defects; it found n, ranked m in the top three, with k false
   positives.* **The slide almost nobody else in that room will have.**
8. **Stack, safety, team** — attestation gate, destructive blocklist, synthetic data, secret
   masking, human-in-the-loop, bias disclosure. Plus the disclosed provenance of the imported code.

---

## 15. Submission checklist `[B, H+34]`

- [ ] Repo public, `main` runnable from a clean clone on a *different* machine
- [ ] `README.md`: one-line pitch, screenshot, `pnpm install && pnpm dev`, architecture diagram, all six docs linked
- [ ] `PROVENANCE.md` — what was imported, from which commit, what these 36 hours produced
- [ ] `.env.example` with every key documented, **no real keys committed** — check `git log -p`
- [ ] 90-second demo video uploaded
- [ ] Deck exported to PDF
- [ ] `pnpm demo` output pasted into the README — the evaluation numbers, in writing
- [ ] Open-source credits: Playwright, three.js, Prisma, Zod, IBM Plex, Instrument Serif
- [ ] Track declared: **Intelligent Digital Solutions**. Keywords: Digital Twins, Collective
      Intelligence, Behavioral Design, Explainable AI. **Not** Affective Computing.
- [ ] All six documents in `/docs` — they are evidence of how you worked, and reviewers notice

---

## 16. Risk triggers

| If | Then |
|---|---|
| Venue network blocks the model provider | Heuristic-only path — built at Gate 0 precisely for this. Nothing in the demo depends on a model call. |
| Crawl exceeds budget on Meridian | `CRAWL_MAX_STATES` 25 → 15. The demo needs six screens. |
| Multi-viewport doubles crawl time | Mobile pass re-measures signals only; it does not re-explore |
| Atlas below 40 fps on the demo laptop | FPS guard decides: bloom off → particles 150 → 2D. Not a person at hour 30. |
| Composite fingerprint breaks dedupe | `fingerprint.test.ts` was written first; revert the hash, keep the test |
| A judge asks "did you build this in 36 hours?" | Answer plainly: the crawler and tour runtime were imported from a prior prototype, disclosed in the first commit and in `PROVENANCE.md`; the 36 hours built the orchestrator, the exclusion measurement, drift and the interface. **Prepared honesty reads as maturity; a discovered omission does not.** |
| A judge hands you a hostile URL | Run it. DEGRADED is designed. *"It couldn't get past the login — here's what it did map, and here's what we'd need."* |
| Someone is unwell or vanishes | Their track's cut-ladder items go first; float covers the rest. C's work is never reassigned. |

---

## 17. The five things that actually decide this

Everything above is scaffolding for these.

1. **Gate 0 by H+1.5.** Nothing else in this plan is reachable through a pipeline that doesn't
   chain. Protect that 90 minutes above all other hours.
2. **The segment recolour.** Switching the filter to `screen-reader` and watching the map turn
   orange is your SDG story told in one interaction and zero slides. No competing team will have
   a measured exclusion number.
3. **The tour must play on Meridian, live.** Findings are a report. An artifact running inside
   someone else's app is a product. That single moment outweighs the entire 3D layer.
4. **Volunteer the positioning before anyone asks.** "We don't claim persona realism" converts
   the sharpest question in the room into credit for rigour. Said second, it sounds like a retreat.
5. **Bring the evaluation slide.** Almost nobody measures their own system. It is the cheapest
   credibility available to you.

Build the boring parts first.
