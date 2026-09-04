# Dry Run — App Flow v2

**Document:** 3 of 6 · **Version:** 2.0 · **Event:** IEEE WIE WE Hack 5.0
**Supersedes:** 03-App-Flow v1.0 · **Governed by:** `CLAUDE.md` · **Depends on:** 01-PRD-v2 · 02-TRD-v2

Every screen, every route, every state the operator can be in. Visual specification lives in
04-UIUX-Brief-v2; this document owns structure and behaviour.

---

## 0. What changed from v1

| # | Change |
|---|---|
| 1 | Run state machine loses `SCOUTING` and `CALIBRATING`; gains `TOURING`. Stage percentages redistributed. |
| 2 | Live view's right column: the **scout feed becomes the signal feed** — Observed facts streaming in from the crawl instead of agent think-aloud. |
| 3 | **Exclusion panel** added to Findings and to the Atlas inspector. New in v2 and part of the demo path. |
| 4 | **Segment filter** promoted from P1 filter to a primary Atlas control — it's how the exclusion story is shown. |
| 5 | **Persona replay** added to the Atlas as an explicit surface (AT-09). |
| 6 | **Replay banner** — a persistent, undismissable disclosure whenever `DRYRUN_REPLAY` is active. |
| 7 | Drift view simplified: no side-by-side graph diff, just per-step health and re-anchor approval. |

---

## 1. Principles governing this flow

1. **Three real routes.** Everything else is a view param or a modal. Routing work stays near
   zero and the back button behaves.
2. **The console is a pure function of run state + the SSE stream.** No hidden local state that
   the server doesn't know about.
3. **No confirm dialogs on the demo path.** A modal between the presenter and the next beat is a
   liability. Destructive actions are undoable instead of confirmed.
4. **Every failure has a designed screen.** Unreachable target, zero states, degraded run,
   unknown run id, WebGL unavailable. A judge handing over a hostile URL should see a designed
   state, not a stack trace.
5. **Nothing renders a number without a provenance badge.** If the badge can't be determined,
   the number doesn't ship.
6. **The operator can always reach the ranked list in one click from anywhere.** It is the
   product's core output and it is never more than one tab away.

---

## 2. Route map

```
/                                    Launchpad — hero + URL field + run history
/new                                 Run Setup — target, tasks, population
/runs/[id]?view=live                 Console · Live       (default while running)
/runs/[id]?view=atlas                Console · Atlas      (default when done)
/runs/[id]?view=findings             Console · Findings
/runs/[id]?view=tour                 Console · Tour Builder
/runs/[id]?view=drift&base=[runId]   Console · Drift
/debug/decisions/[runId]            Dev only — escalation + cache inspector
```

### Navigation graph

```
                    ┌──────────────┐
                    │  LAUNCHPAD   │ ◄──────── logo click, from anywhere
                    └──────┬───────┘
              Dry run →    │  │   click a past run
                           ▼  └────────────────────┐
                    ┌──────────────┐               │
                    │  RUN SETUP   │               │
                    └──────┬───────┘               │
                POST /runs │                       │
                           ▼                       ▼
     ┌───────────────────────────────────────────────────────┐
     │                CONSOLE  /runs/[id]                    │
     │                                                       │
     │  LIVE ──auto on stage=done──► ATLAS ◄──► FINDINGS     │
     │                                 │           │         │
     │                                 └─────┬─────┘         │
     │                          "Generate tour"              │
     │                                       ▼               │
     │                                 TOUR BUILDER          │
     │                                       │               │
     │                        "Compare deploys"              │
     │                                       ▼               │
     │                                    DRIFT              │
     └───────────────────────────────────────────────────────┘
```

### Navigation guards

| Rule | Behaviour |
|---|---|
| `/new` with unsaved input, back pressed | No confirm. Draft persists in the store; returning restores it. |
| `/runs/[id]` while the run is in progress | Forces `view=live` regardless of the param, until `stage=done` |
| `view=tour` with no tour yet | Redirect to `view=findings` with an inline prompt: "Generate a tour from these findings" |
| `view=drift` with no `base` | Renders the run-picker state, not an error |
| `view=drift` with no second run in the project | Tab is present but disabled, tooltip: "Needs a second run to compare" |
| Unknown run id | Not-found state with a link home. Never a stack trace. |
| WebGL unavailable | Atlas silently renders 2D and shows a quiet toast once |

---

## 3. The run state machine

The console is driven entirely by this.

```
        POST /runs
             │  attestation false · SSRF reject · URL unreachable
             ▼───────────────────────────────────────────────► FAILED
    ┌─────────────────┐
    │    CREATED      │
    └────────┬────────┘
             ▼
    ┌─────────────────┐   0 states found
    │    CRAWLING     │──────────────────────────────────────► FAILED
    │  stage: crawl   │
    │    0 → 45%      │   (replay mode: same events, ~8s)
    └────────┬────────┘
             ▼
    ┌─────────────────┐   simulation throws
    │     CHORUS      │──────────────────────────┐
    │  stage: chorus  │                          │
    │    45 → 70%     │                          ▼
    └────────┬────────┘                     DEGRADED
             ▼                          (graph + static signals only,
    ┌─────────────────┐                   every number "Predicted",
    │    ANALYSING    │ ◄──────────────── visible banner naming
    │ stage: analyse  │                   the failed stage)
    │    70 → 85%     │
    └────────┬────────┘
             ▼
    ┌─────────────────┐
    │     TOURING     │   top-3 findings → draft tour steps
    │  stage: tour    │
    │   85 → 100%     │
    └────────┬────────┘
             ▼
    ┌─────────────────┐
    │      DONE       │──► auto-transition view: live → atlas (300ms crossfade)
    └─────────────────┘
```

**`DEGRADED` is a designed state, not an accident.** If the simulation fails, the run still
completes on the crawl's Observed static signals, every modeled number is suppressed rather than
faked, and a banner says which stage failed and what remains valid. Rehearse this state — someone
on the team should hand the presenter a broken URL during a practice run.

**Cancel** is available in the top bar while running: `DELETE /runs/:id` → `CANCELLED`, partial
graph retained and viewable.

---

## 4. Screen 1 — Launchpad (`/`)

### Regions
| Region | Content |
|---|---|
| Top bar (56px, persistent) | `DRY RUN` wordmark · dotted rule · Docs · replay-mode chip if active |
| Hero (cols 1–7) | Thesis line in Instrument Serif italic, URL field directly beneath, "Dry run →" button, "Try the demo target ›" link |
| Ambient (cols 8–12) | A slowly rotating, muted, non-interactive Atlas at 40% opacity — the product, legible at a glance |
| Recent surveys | Run cards: target, relative time, state count, finding count, worst screen + its friction numeral, mini friction bar |

### Interaction contract
| Action | Result |
|---|---|
| Type a URL + Enter, or click "Dry run →" | → `/new` with the URL prefilled |
| "Try the demo target ›" | → `/new` prefilled `http://localhost:5173`, demo tasks preselected, seeded values preloaded |
| Click a run card | → `/runs/[id]?view=atlas` (or `live` if still running) |
| Empty history | The recent-surveys block is absent entirely — no empty-state illustration, no placeholder card |

### States
`default` · `url-invalid` (inline, below the field, no toast) · `engine-unreachable` (top-bar
health chip turns `--warn`, button disabled with a tooltip naming the reason).

---

## 5. Screen 2 — Run Setup (`/new`)

Single column, 720px, three numbered sections — numbered because it genuinely is a sequence.

**① Target**
- URL field (Plex Mono), validated on blur
- Viewport pass toggles: `laptop-1280` (locked on) + `mobile-390` (default on, and the copy says
  why: *"finds controls that vanish on a phone"*)
- Seeded values: key/value rows, prefilled for the demo target (`API key → mk_demo123`)
- **Attestation checkbox** in a `--marker-wash` inset with a `--marker-dim` left border. Unmissable.
  Launch is disabled until it is ticked, and the disabled tooltip says exactly why.

**② Tasks**
- Two prefilled task rows for the demo target; each is `{ name, startState, goalPredicate }`
- Goal predicate editor is a single select (`element visible` / `state reached`) plus a text field.
  Nothing more elaborate — this is not a query builder.

**③ Population**
- Size slider, 50 → 1000, default 1000, with a live estimate line in Plex Mono
- The ten archetypes as rows: label, weight, and the segments each belongs to
- **"Exclusion-weighted" is the default preset and it is labelled as such**, with a one-line
  explanation: *"weighted toward the users most likely to be locked out — see Findings for the
  exclusion breakdown"*
- Second preset: "Balanced". Two presets only; no custom archetype builder.

**Sticky launch bar:** estimate on the left ("≈ 45 s from cache · 25 screens · 1000 personas"),
"Launch survey" on the right.

| Action | Result |
|---|---|
| Launch | `POST /runs` → immediate redirect to `/runs/[id]?view=live` on receiving `{runId}` |
| 400 attestation | Should be impossible from the UI; if it happens, inline error at the checkbox |
| 400 SSRF | Inline error at the URL field: "That address resolves to a private network. Set `ALLOW_PRIVATE_TARGETS` to test locally." |
| Back | Draft preserved |

---

## 6. Screen 3a — Console · Live (`?view=live`)

```
┌──────────────────────────────────────────────────────────────────┐
│ DRY RUN · meridian     [live][atlas][findings][tour][drift]  ⏹  │ 56px
├───────────────────────────────────────────┬──────────────────────┤
│                                           │ STAGE RAIL   200px   │
│   Atlas, building live                    │ ◉ crawl      18/25   │
│   nodes appear as state-found arrives     │ ○ chorus         —   │
│   edges draw as edge-found arrives        │ ○ analyse        —   │
│                                           │ ○ tour           —   │
│                                           ├──────────────────────┤
│                                           │ SIGNAL FEED          │
│                                           │ ▪ /workspace         │
│                                           │   CTA below fold     │
│                                           │ ▪ /connect           │
│                                           │   error text 1.9:1   │
│                                           │ ▪ /connect           │
│                                           │   "Continue" no-op   │
└───────────────────────────────────────────┴──────────────────────┘
```

**The signal feed replaces v1's scout feed.** Each row is an **Observed** fact the browser just
measured, badged `▪ Observed`, with the screen name and the measurement. This is a better feed
than agent think-aloud ever was: it streams *evidence*, and it makes the Explainable AI claim
visible before the run even finishes.

| Behaviour | Spec |
|---|---|
| SSE `state-found` | `node-birth` animation, stagger 40 ms; stage rail counter increments |
| SSE `edge-found` | `edge-draw` |
| SSE `signal` | New signal-feed row, `badge-pop`; `aria-live="polite"` announces it |
| SSE `metrics` | Nodes rise to their friction elevation, contour rings bloom, counters roll |
| SSE `stage` | Rail row fills left→right; previous row's dot goes `--ok` |
| SSE `error` fatal | Failure state replaces the canvas; partial graph stays visible below |
| SSE disconnect | Reconnect with backoff (1s, 2s, 4s, 8s); a chip reads "reconnecting"; on resume, replay buffer catches up |
| `stage=done` | 300 ms crossfade to `?view=atlas`. No layout shift. |
| Replay active | Undismissable banner: **"Crawl replayed from cached fixture — simulation is live."** |

---

## 7. Screen 3b — Console · Atlas (`?view=atlas`)

The hero surface. Full visual spec in 04-UIUX §7.

### Controls (top-left of the canvas, one row)
| Control | Behaviour |
|---|---|
| `2D / 3D` toggle | Same layout positions; canvas never unmounts |
| **Segment filter** | `All · confident-desktop · mobile · screen-reader · low-literacy · non-native`. Selecting a segment recolours every node by that segment's dropout and shows `ExclusionDelta` on each node label. **This is the demo's exclusion beat.** |
| **Persona replay** | Opens the replay scrubber (§7.2) |
| Reset view | Fly back to the framing camera, 600 ms |

### 7.1 Selection
Click a node → `marker-plant` (the survey beacon drops on it), camera fly-to 600 ms, all other
nodes drop to 55% opacity, unrelated edges to 20%, and the **inspector** rises from the bottom.

**Inspector contents:**
- Screenshot thumbnail (click → evidence lightbox)
- Six metrics in a 4-up Plex Mono grid, each with its own provenance badge
- Friction meter + numeral, ramp-coloured
- **Exclusion strip:** one horizontal bar per segment, baseline marked, positive deltas in
  `--marker`. The worst segment is named in words.
- Findings on this screen as chips → click jumps to Findings, that card expanded

### 7.2 Persona replay
A named persona (e.g. *"Screen-Reader User #412"*) is selected from a list; her walk is replayed
as a single travelling particle with a step counter and the reason she stopped
(`goal reached` / `patience exhausted` / `blocked`). The path highlights; everything else dims.

**Copy discipline:** the header reads *"Modeled walk · Screen-Reader User #412"* and the badge is
`◪ Modeled`. Never "watch a real user" — we do not claim realism (L1). The emotional force comes
from watching a walk stop dead at a screen, not from pretending it's a person.

### 7.3 States
`loading` (skeleton chart plane, no spinner) · `ready` · `selected` · `segment-filtered` ·
`replaying` · `degraded` (nodes render grey at zero elevation, banner explains, ring count 0) ·
`webgl-unavailable` (2D, one quiet toast).

---

## 8. Screen 3c — Findings (`?view=findings`)

**The never-cut surface.** If everything else fails, this plus the tour export is the product.
It is also the keyboard-navigable equivalent of the Atlas, and it is not a second-class citizen.

```
┌──────────────────────────────────────────────────────────────┐
│ EXCLUSION INDEX   +0.62   Configure Webhook · screen-reader  │  ← headline
│ ▪ Observed: modal close control offscreen at 390px           │
├──────────────────────────────────────────────────────────────┤
│ 1 ▎ Invisible validation error          Friction 78  ▪ Obs.  │
│     silent-validation · Connect Source · Fix Value 0.61      │
│     ████████░░  41% of personas resubmitted 3+ times         │
│     Segments: screen-reader +0.58 · non-native +0.21         │
│     [ evidence ]  [ show on map ]                            │
├──────────────────────────────────────────────────────────────┤
│ 2 ▎ ...                                                      │
└──────────────────────────────────────────────────────────────┘
                          [ Generate tour from top 3 → ]
```

| Element | Spec |
|---|---|
| Header | ExclusionIndex, the state, the segment, and the Observed fact behind it |
| Sort | Fix Value (default) · Friction · Exclusion delta |
| Card | Rank numeral, title, signature chip, screen name, friction meter, provenance badge, segment deltas, metric row |
| `evidence` | Lightbox: full screenshot, the measurement in plain language, the metrics that fired the rule, the a11y snippet |
| `show on map` | → `?view=atlas` with that node selected and the camera flown to it |
| `unclassified` findings | Render last, labelled "no signature matched", metrics shown. **Do not hide these.** |
| Bias disclosure | One line, always present at the foot of the list: *"Synthetic personas encode model priors, not lived experience. Treat findings as hypotheses to prioritise, not proof."* |
| Empty | "No findings above threshold. The crawl reached N screens." — never a blank page |

---

## 9. Screen 3d — Tour Builder (`?view=tour`)

Single column, 820px. Imported and working; extend only where noted.

| Element | Spec |
|---|---|
| Step card | Order numeral (Plex Mono 34px, `--ink-2`) on a left rail · anchor chip · generated title and body, both editable inline · the finding it came from, as a chip |
| Anchor chip | `button "Connect data source"`. Click → resolution-ladder popover showing which tier resolves and what the fallbacks are |
| Actions | Approve · Edit · Reject · (after action) Restore |
| Approved card | `--ok` left border, button row collapses |
| Sticky footer | `2 of 3 approved` · Preview · **Export** |
| Export | Disabled until ≥1 step approved, **enforced server-side too**. Modal: `tour.json` download + a copyable `<script>` snippet |
| **Preview (TR-06)** | Opens Meridian in a new tab with `?tour=<id>`; `usher-rt` loads the exported tour and plays it live. **This is the single most valuable moment in the demo — wire it early and test it on the demo laptop.** |

---

## 10. Screen 3e — Drift (`?view=drift&base=`)

```
┌──────────────────────────────────────────────────────────────┐
│ Comparing   run #12 (v1)  →  run #14 (v2)      [ change ]    │
├──────────────────────────────────────────────────────────────┤
│ ● intact       Step 1 · "Scroll down for the next step"      │
│ ◐ re-anchored  Step 2 · button "Connect source"              │
│                        → button "Add a source"   conf 0.82   │
│                        [ approve ]  [ reject ]               │
│ ○ broken       Step 3 · button "Continue"                    │
│                        no element resolved · needs a human   │
├──────────────────────────────────────────────────────────────┤
│ 1 of 2 repairs approved          [ Apply → tour v2 ]         │
└──────────────────────────────────────────────────────────────┘
```

| Element | Spec |
|---|---|
| Base picker | Run cards from the same project; if only one run exists, the tab is disabled with a tooltip |
| Step row | Health glyph (shape first, then colour: `●` intact `◐` re-anchored `○` broken), old anchor, proposed anchor, confidence |
| Approve/reject | Per repair. Nothing auto-applies — ever (L7, S9) |
| Apply | Creates tour **v2** with `parentTourId` set; approved repairs only; jumps to Tour Builder on the new version |
| No drift | "Nothing moved. All 3 steps resolve at tier 1." A clean diff is a valid, good result — say so plainly |

---

## 11. Modals, overlays, global elements

| Element | Spec |
|---|---|
| Evidence lightbox | Full screenshot, measurement in words, metrics, a11y snippet. `Esc` closes. |
| Export modal | JSON download + snippet, copy button, one-line install note |
| Replay banner | Persistent, undismissable, top of the console whenever replay is active |
| Degraded banner | Names the failed stage and what is still valid |
| Toasts | Bottom-right, 5 s, `--chart-shoal`. Used for: exported, approved, bloom disabled, reconnecting. |
| Keyboard | `1–5` switch views · `f` fit view · `2`/`3` dimension toggle · `s` cycle segment · `/` focus search · `Esc` close overlay · `?` shortcut sheet |
| Top bar | Wordmark → home · run target + status pill · view tabs (underline slides in `--marker`) · health chip · cancel while running |
| Focus ring | `2px solid --marker`, 2px offset, on every interactive element, never removed |

### Failure states — all designed, none generic
| State | Screen |
|---|---|
| Target unreachable | "Couldn't reach that address." What was tried, and a retry button |
| Zero states crawled | "Reached the page but found no interactive screens." Suggests seeded credentials |
| SSRF rejected | Explains the private-range guard and the env flag |
| Degraded | Banner + the graph and Observed signals still fully usable |
| Cancelled | Partial graph viewable, "resume" is not offered (it doesn't exist — don't imply it) |
| Unknown run | Not-found with a link home |
| Engine down | Health chip `--warn`, launch disabled, tooltip names the port |

---

## 12. The demo path — exact click sequence

Rehearse this until it is muscle memory. Driver clicks; presenter never touches the keyboard.

```
1.  /                        "Try the demo target ›"
2.  /new                     already prefilled → tick attestation → Launch survey
3.  ?view=live               (replay: ~8s) nodes appear, signals stream, stage rail advances
4.  auto → ?view=atlas       nodes rise, rings bloom, particles flow, the leak at Connect Source
5.  click Connect Source     marker plants, inspector rises, metrics + provenance
6.  segment filter →         screen-reader — the map recolours; exclusion deltas appear
    screen-reader
7.  ?view=findings           ExclusionIndex headline; open finding 1 → evidence lightbox
8.  Generate tour from top 3
9.  ?view=tour               approve step 1 → Preview → Meridian opens, the tour plays live
10. ?view=drift&base=…       one re-anchored, one broken → approve → Apply → tour v2
11. evaluation slide         "we planted six, it found N, and ranked M in the top three"
```

Steps 6, 9 and 11 are the three beats that differentiate this project. If time forces a shorter
demo, cut 10 before 6, and never cut 9.

---

## 13. Data dependency map

| Surface | Needs | Degrades to |
|---|---|---|
| Live | SSE stream | Poll `GET /runs/:id` every 2 s |
| Atlas | `GET /runs/:id/graph` with `metrics` joined | Nodes at zero elevation, grey, banner |
| Segment filter | `metrics.bySegment` | Control hidden entirely if absent — never render an empty filter |
| Persona replay | `GET /runs/:id/walks` | Control hidden |
| Findings | `GET /runs/:id/findings` | "Analysis incomplete" state |
| Exclusion header | `GET /runs/:id/exclusion` | Header omitted, list still renders |
| Tour Builder | `GET /runs/:id` tour + steps | Redirect to findings |
| Drift | `POST /drift` | Tab disabled |

**Rule:** a surface that loses its data hides itself or degrades visibly. Nothing renders a
plausible-looking zero.

---

## 14. Responsive and display

Built for **1280×720 minimum** — assume the projector. Layouts at 1280 and 1440+.
Below 1024: the console shows a single message asking for a wider window; this is a desktop tool
and pretending otherwise costs hours for zero marks. Meridian itself must work at 390px — that's
the point of D5, and it's the target app, not our UI.

---

## 15. Anti-friction rules

1. Never block the whole screen on one slow request. Surfaces load independently.
2. Never show a spinner where a skeleton will do.
3. Never animate layout during a demo beat — crossfade inside a fixed frame.
4. Never require two clicks where one will do, on the demo path.
5. Never lose operator input. Drafts persist.
6. Every disabled control has a tooltip naming the reason.
7. Errors say what happened and what to do next, and never apologise.
