# CLAUDE.md — Dry Run · WE Hack 5.0

Read this file before every task. It is the constitution of this repo.

---

## 1. What this project is

**Dry Run finds where SaaS onboarding breaks — before real users do.**

Give it a staging URL. It crawls the app into a semantic **State Graph** (nodes =
screens, edges = actions, both labelled from the **accessibility tree**, never CSS).
It then runs a weighted population of modeled personas over that graph, ranks every
screen by the damage it causes, and compiles a deployable **guided tour** whose steps
are bound to **Semantic Anchors** instead of selectors — so when the UI changes, it can
tell you which steps broke and propose repairs for a human to approve.

**Context:** IEEE WIE WE Hack 5.0. 36 hours. 3-person team. Track: Intelligent Digital
Solutions. Software only. Three judged reviews (idea · ~50% progress · live prototype).
UI/UX is separately scored and heavily weighted.

**Provenance:** the engine, core package, tour runtime and demo app were imported from a
prior prototype (DevJams'26, commit `649c2fc`). That import is the first commit in this
repo and is disclosed in `PROVENANCE.md`. Everything after it is hackathon work.

---

## 2. Document authority — resolve conflicts in this order

| Rank | Source | Authority |
|---|---|---|
| 1 | **CLAUDE.md** (this file) | Locked decisions, rules, terminology. Overrides everything. |
| 2 | **docs/01-PRD-v2.md** | What we build, feature IDs, scope, cut list |
| 3 | **docs/02-TRD-v2.md** | Architecture, contracts, algorithms |
| 4 | **docs/04-UIUX-Brief-v2.md** | Every colour, font, duration, easing. Normative. |
| 5 | **docs/03-App-Flow-v2.md** · **05-Backend-Schema-v2.md** | Screens, routes, data |
| 6 | **docs/06-Implementation-Plan-v2.md** | Order of work, gates |
| — | **docs/CURRENT-STATE.md** | **Historical record, NOT a spec.** Describes the old prototype, including subsystems we have deliberately cut. Read it to learn what code exists. Never build from it. |
| — | `prisma/schema.prisma` | The schema is the schema. No prose copy overrides the file. |

**If a document contradicts this file, this file wins. If two documents contradict each
other and this file is silent, stop and ask — do not pick one.**

---

## 3. Terminology — never mix these

- **Operator** — the human using Dry Run
- **Persona** — a synthetic user Dry Run runs through the target app
- **Target app** — the staging application under test
- **Meridian** — our bundled demo target app, `apps/demo`
- **State / node** — one distinct screen in the State Graph
- **Action / edge** — one interaction that transitions between states
- **Finding** — a named failure mode attributed to a state, with evidence and scores
- **Tour** — the exported artifact of onboarding steps
- **Segment** — a named slice of the persona population (e.g. `screen-reader`, `mobile`)

Do not introduce synonyms. Do not call a state a "page" or a persona an "agent" in code,
comments, or UI copy.

---

## 4. Locked decisions — do not relitigate, do not silently work around

**L1 · Positioning: structural discovery, not behavioural realism.**
We never claim personas behave like real humans. We claim the swarm finds *properties of
the interface*: loops, dead ends, unreachable states, ambiguous choices, and screens that
are reachable for one segment and not another. A screen where 40% of personas cannot
determine what to click is ambiguous regardless of persona fidelity. Never write UI copy,
comments, or docs that assert behavioural realism.

**L2 · Cost architecture.** The graph is crawled once and shared. Persona diversity is
parameters over the same graph. Traversal is a stochastic walk; model calls happen only at
genuinely ambiguous decision nodes and are memoised per `(archetype, stateFingerprint)`.
1000 personas must cost far less than 1000 sessions, and the cost must be *measurable* —
log every `ModelCall`.

**L3 · Exclusion-weighted population.** The population is deliberately weighted toward low
digital literacy, non-native language speakers, mobile and low-bandwidth devices, and
screen-reader users. We measure **digital exclusion** — who gets locked out of a service by
interface design — not conversion. This is the SDG 4 / SDG 10 story and it must be backed by
real segment-differential numbers, not framing. See PRD §6 (`ExclusionDelta`).

**L4 · Victim app with planted defects.** Meridian ships with six deliberate defects. We
report how many Dry Run caught and how it ranked them. The evaluation harness is a build
target, not a slide claim.

**L5 · Never crawl live on stage.** All demo crawls run from cached fixtures via
`DRYRUN_REPLAY`. We disclose this openly on the slide. Building the replay path is P0.

**L6 · Provenance reframe (supersedes the old two-tier model).** Real Playwright "Scouts"
are **cut**. The crawler is itself a real browser making real observations, so:
- **Observed** — a fact the crawler verified in a real browser (a state exists, an edge
  self-loops, contrast is 1.9:1, a control is offscreen at 390px)
- **Modeled** — output of the Chorus population simulation over the graph
- **Predicted** — a state the crawler never reached; no support at all

Every number rendered in the UI carries one of these three badges. This is a never-cut item.

**L7 · Drift is anchor-level.** Meridian v2 renames and moves one control. `usher-rt`
already fails cleanly when role+name stops matching, so step health comes from re-resolving
anchors against the v2 graph. No pHash, no Hungarian matching, no full node-matching engine.

---

## 5. Cut — do not build these, do not reference them as existing

Playwright-driven Scouts · calibration and `fitMae` · the multi-provider key pool ·
operator auth · projects API · Persona Studio as a UI · custom persona builder ·
ICP-text persona generation · auth-recipe recorder · shareable report links · CI webhook ·
`pHash` / full node matching · think-aloud transcripts.

`CURRENT-STATE.md` describes several of these as "designed". They are cut. If a task seems
to require one, stop and ask.

---

## 6. Engineering rules

1. **Refs, never selectors.** Perception yields `ref` ids from `ariaSnapshot`. The model
   picks a `ref`; the harness maps it to a locator. Never let a model emit CSS or coordinates.
   Never trust a model to echo back anchor fields — look them up from ground truth by `ref`.
2. **Zod first.** Every cross-package type is a Zod schema in `packages/core`. Types are
   inferred from schemas, never hand-declared alongside them.
3. **One friction ramp.** `packages/core/ramp.ts` exports `frictionColor(score)` and
   `frictionRing(score)`. React and three.js both import it. Two implementations is a bug.
4. **Metrics reach the visual layer or the visual is a lie.** `GET /runs/:id/graph` serves
   `AtlasNode = AppState & { metrics?: StateMetrics }`. Never render a node whose friction is
   a hardcoded constant.
5. **Never fabricate a number. Annotate instead.** If a heuristic doesn't match, return "no
   heuristic matched" and say so in the UI. If a metric is a proxy, name it a proxy in the
   comment. If confidence is low, show the low-confidence state. The prior codebase did this
   well — preserve the instinct.
6. **Every shortcut carries a comment saying why it's a shortcut and what would replace it.**
7. **Deterministic where possible.** Seeded PRNG for all simulation. The same run id must
   produce the same Chorus output.
8. **Behavioural constraints are enforced mechanically, not by asking a model to role-play.**
   Patience is a step/time cap. `device` is a viewport. `screen-reader` means the screenshot
   is withheld and only the a11y tree is perceived. Never prompt a model to "be impatient".
9. **Additive changes only after H+26.** New files, new functions, nullable columns. No
   refactors, no renames, no signature changes.
10. **`main` is always runnable.** Break it, fix or revert within 15 minutes.

---

## 7. Design rules

The UI/UX brief is normative down to the hex value. Derive nothing. If a value isn't in
`docs/04-UIUX-Brief-v2.md`, ask before inventing it.

**Banned outright:** near-black `#0A0A0A` + acid accent · purple/indigo gradient hero ·
glassmorphism · neon wireframe / Tron grid · animated gradient mesh · emoji in product UI ·
more than one accent hue · centered marketing layout on a tool screen · bloom strong enough
to hurt text legibility.

**The 3D rule: every 3D element encodes data.** Node elevation is friction. Ring count is
friction. Particles are persona walks. Vanishing particles are real dropout events. A
decorative floating polyhedron or an imported character model is a subtraction, not an
addition. There is exactly one object in the scene that is an object rather than data — the
survey marker, which earns its place by being the selection indicator.

**Colour is never the only encoding.** Friction carries colour + elevation + ring count +
printed numeral. Provenance carries glyph shape + word + colour. We ship a screen-reader
segment and rank apps on accessibility signals; failing our own audit is indefensible.

**`prefers-reduced-motion` is wired on day one**, not as polish.

---

## 8. Safety — implement, don't just claim

The deck claims these. They must exist in code.

- **Attestation gate** — `POST /runs` returns 400 unless `attestation === true`. Logged with
  timestamp and user agent.
- **SSRF guard** — resolve the target host; reject private and loopback ranges unless
  `ALLOW_PRIVATE_TARGETS=1` (set locally for Meridian, never in a shipped default).
- **Destructive-action blocklist** — never click an accessible name matching delete / remove /
  pay / purchase / publish / send / cancel.
- **Identify ourselves** — `User-Agent: DryRun-Bot/1.0` and an `X-DryRun-Run-Id` header on
  every request. Respect `robots.txt` by default.
- **Synthetic data only** — form fills use `dryrun+<runId>@example.invalid` and clearly
  fixture values.
- **Mask before you screenshot** — every `input[type=password]` and any field whose label
  matches key / secret / token is blanked before the screenshot is written to disk. The old
  prototype typed real-looking passwords and screenshotted them. Do not repeat that.
- **Bias disclosure in-product** — "Synthetic personas encode model priors, not lived
  experience. Treat findings as hypotheses to prioritise, not proof."
- **No demo crawls of third-party or institutional sites.** Meridian and cached fixtures only.

---

## 9. Repo layout and boundaries

```
packages/core       Zod schemas, enums, scoring, ramp. NO I/O, NO Playwright, NO React.
packages/usher-rt   Embeddable tour runtime. Zero dependencies. Hard budget < 6 KB.
apps/engine         Fastify + Playwright + Prisma. All long-lived work. Owns the orchestrator.
apps/interface      Next.js. Thin client. NEVER imports Playwright or Prisma.
apps/demo           Meridian v1 + v2. Deliberately mediocre SaaS. Never "fix" its defects.
```

`packages/core` is imported by everything and imports nothing. If a type is needed in two
packages, it belongs there.

---

## 10. Before you write code for any task

1. Have I read the PRD section for this feature ID?
2. Does `CURRENT-STATE.md` say this already exists? If yes, extend it — do not rewrite it.
3. Does it touch a locked decision (§4) or a cut item (§5)?
4. Does it render a number? Then it needs a provenance badge.
5. Does it introduce a colour, font, or duration? Then it must come from the UI/UX brief.
6. Will `main` still run after this?

---

## 11. Git

Branches: `a/*`, `b/*`, `c/*` by owner. Merge to `main` every 2 hours minimum.
Commit format: `[A] crawl: composite state fingerprint`. Never force-push to `main`.
Tag `gate-1`, `gate-2`, `gate-3`, `freeze`.
