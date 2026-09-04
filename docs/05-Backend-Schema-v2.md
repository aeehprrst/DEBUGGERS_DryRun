# Dry Run — Backend Schema v2

**Document:** 5 of 6 · **Version:** 2.0 · **Event:** IEEE WIE WE Hack 5.0
**Supersedes:** 05-Backend-Schema v1.0 · **Governed by:** `CLAUDE.md` · **Depends on:** 02-TRD-v2

> **`prisma/schema.prisma` is the source of truth for the data model.** This document explains
> intent, records what changes from v1, and specifies write timing and storage config. Where this
> document and the schema file disagree, **the file wins** — fix the document.

---

## 0. What changed from v1

| # | Change | Reason |
|---|---|---|
| 1 | **`ScoutTrace` → `PersonaWalk`** | Scouts are cut. Chorus walks are what we store, and they now feed persona replay (AT-09). |
| 2 | **`Run.calibration` and `Run.fitMae` dropped** | Calibration cut. Leaving them nullable-and-always-null invites a judge to ask what they are. |
| 3 | **`StateMetrics.bySegment`, `.exclusionDelta`, `.worstSegment` added** | The ExclusionDelta story needs per-segment storage |
| 4 | **`Run.exclusionIndex`, `.worstSegment`, `.worstStateId` added** | Headline number, queryable without parsing a blob |
| 5 | **`AppState.viewports` added** | Multi-viewport crawl (CR-09) stores signals per viewport |
| 6 | **`AppState.softFingerprint` added** | Drift state matching (L7) |
| 7 | **`Session` and custom `PersonaArchetype` dropped** | Auth is cut; archetypes are a declared constant in `packages/core`, not user data |
| 8 | **`DecisionCache` kept and actually used** | The cost claim needs cache hits to be real and countable |
| 9 | **`Run.replayFixtureId` added** | Replay mode must be recorded on the run, so the disclosure banner is data-driven, not a UI flag |
| 10 | **`DriftReport` simplified** | No `pHash`, no match scores — step health and proposed anchors only |

---

## 1. Storage architecture

**SQLite via Prisma, one file, `apps/engine/data/dryrun.db`.** No Postgres, no Docker, no
migrations to run at 3am. It survives a crash, copies with `cp`, and inspects with `sqlite3`.

### Two rules that prevent the classic failures

**Rule 1 — Blob what you read whole; normalise what you query.**
A 25-node graph read entirely or not at all lives in a `TEXT` column as JSON. Findings, which get
sorted, filtered and counted, are rows. Normalising the graph buys nothing at this scale and costs
hours.

| Blobbed (`TEXT`, JSON) | Rows |
|---|---|
| `Run.graph` (states + edges + signals + viewports) | `Finding` |
| `Run.metrics` (`StateMetrics[]` including `bySegment`) | `TourStep` |
| `PersonaWalk.path` (the step sequence) | `ModelCall` |
| `TourStep.anchor` | `PersonaWalk` |
| `DriftReport.steps` | `Attestation` |

**Rule 2 — Denormalise the counters you display.**
`Run.stateCount`, `.actionCount`, `.findingCount`, `.populationSize`, `.exclusionIndex` are
columns, not derived at read time. The Launchpad renders run cards without parsing a single blob.

### Prisma-on-SQLite gotchas — read before touching the schema
1. **SQLite has no enums.** Every enum is a Zod enum in `packages/core` and a `String` column in
   Prisma. This is already the imported pattern — keep it. Validate on write, parse on read.
2. **`foreign_keys` is OFF by default.** Without `PRAGMA foreign_keys = ON`, `onDelete: Cascade`
   silently does nothing and you find the orphan rows while demoing.
3. **No `Json` type on SQLite.** Blobs are `String`. Use typed `readJson`/`writeJson` helpers in
   `packages/core/json.ts` — the prototype called `JSON.parse` inline in three files, which is how
   a malformed blob becomes a 500 with no context.

---

## 2. Entity relationships

```
User ──1:N── Project ──1:N── Run ──1:N── PersonaWalk
                │             │ │
                │             │ ├─1:N── Finding ──0:1── TourStep (sourceFindingId)
                │             │ │
                │             │ └─1:N── ModelCall
                │             │
                │             └─1:1── Attestation      (soft link, non-FK)
                │
                ├─1:N── Tour ──1:N── TourStep
                │        └─self──── parentTourId       (v1 → v2 after re-anchor)
                │
                └─1:N── DriftReport ──► baseRunId, headRunId, appliedTourId

DecisionCache — standalone, keyed by (archetype, stateFingerprint, taskId)
Setting       — standalone key/value, non-secret config only
```

**One seeded `User` and one seeded `Project`.** Auth is cut, but every table still carries
`userId` or reaches it through a relation, so enabling auth later is a middleware swap rather than
a migration. Do not remove the columns to save time — they cost nothing and removing them is the
kind of decision that reads as short-sighted in a technical Q&A.

---

## 3. Models — the deltas to implement

The imported `schema.prisma` has ten models and a good shape. Apply exactly these changes.

### 3.1 `Run` — modify
```prisma
model Run {
  id              String   @id @default(cuid())
  projectId       String
  targetUrl       String
  status          String                    // RunStatus (Zod)
  stage           String                    // RunStage (Zod)
  progressPct     Int      @default(0)

  // config
  config          String                    // JSON: tasks, personaMix, size, seededValues, viewports
  replayFixtureId String?                   // NEW — non-null ⇒ crawl came from cache

  // results
  graph           String?                   // JSON: AppState[] + Action[]
  metrics         String?                   // JSON: StateMetrics[] with bySegment
  truncated       Boolean  @default(false)

  // denormalised counters
  stateCount      Int      @default(0)
  actionCount     Int      @default(0)
  findingCount    Int      @default(0)
  populationSize  Int      @default(0)
  escalationRate  Float?                    // NEW — model ÷ all decisions
  exclusionIndex  Float?                    // NEW
  worstSegment    String?                   // NEW
  worstStateId    String?                   // NEW

  error           String?
  startedAt       DateTime @default(now())
  finishedAt      DateTime?

  project   Project       @relation(fields: [projectId], references: [id], onDelete: Cascade)
  walks     PersonaWalk[]
  findings  Finding[]
  calls     ModelCall[]

  @@index([projectId, startedAt])
}
```
**Removed:** `calibration`, `fitMae`, `scoutCount`.

### 3.2 `PersonaWalk` — replaces `ScoutTrace`
```prisma
model PersonaWalk {
  id              String   @id @default(cuid())
  runId           String
  archetype       String                    // stable id, e.g. 'screen-reader-user'
  label           String                    // 'Screen-Reader User #412'
  segments        String                    // JSON: SegmentId[]
  taskId          String
  result          String                    // 'success' | 'abandoned' | 'blocked'
  reason          String?                   // 'patience' | 'confusion' | 'dead-end'
  stepCount       Int
  terminalStateId String
  path            String                    // JSON: [{ stateId, edgeId, ms }]
  createdAt       DateTime @default(now())

  run  Run @relation(fields: [runId], references: [id], onDelete: Cascade)
  @@index([runId, archetype])
  @@index([runId, result])
}
```
**Do not persist all 1000 walks.** Store a **stratified sample: 20 per archetype, 200 total**,
guaranteeing at least one of every result type per archetype where one exists. That's enough for
persona replay and it keeps the DB small. The full population stays in memory and its aggregate
lands in `Run.metrics`.

### 3.3 `Finding` — modify
```prisma
model Finding {
  id            String  @id @default(cuid())
  runId         String
  stateId       String
  signature     String                      // 8 signatures | 'unclassified'
  title         String
  explanation   String
  frictionScore Float
  fixValue      Float
  provenance    String                      // observed | modeled | predicted
  observedFact  String?                     // NEW — plain-language browser measurement
  evidence      String                      // JSON: { screenshot, metrics, a11ySnippet }
  segments      String                      // NEW — JSON: [{ segment, delta }]
  rank          Int
  createdAt     DateTime @default(now())

  run       Run        @relation(fields: [runId], references: [id], onDelete: Cascade)
  tourSteps TourStep[]

  @@index([runId, rank])
  @@index([runId, fixValue])
}
```
`observedFact` is what makes the Explainable AI claim concrete: *"error text measured at 1.9:1
against its background; no aria-live region present."* A finding whose `provenance` is `observed`
**must** have it.

### 3.4 `AppState` — inside the `graph` blob, not a table
```ts
AppState = {
  id: string;
  fingerprint: string;            // composite (TRD §5.2.1)
  softFingerprint: string;        // NEW — url pattern + landmark skeleton, for drift matching
  urlPattern: string;
  primaryHeading: string | null;
  a11yTree: A11yNode[];
  screenshot: string;
  thumbnail: string;
  viewports: {                    // NEW — CR-09
    'laptop-1280': StaticSignals;
    'mobile-390':  StaticSignals;
  };
  depth: number;
}
```

### 3.5 `DriftReport` — simplify
```prisma
model DriftReport {
  id            String   @id @default(cuid())
  projectId     String
  baseRunId     String
  headRunId     String
  baseTourId    String
  steps         String                      // JSON: [{ stepId, health, oldAnchor, newAnchor, confidence, approved }]
  appliedTourId String?
  createdAt     DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@index([projectId, createdAt])
}
```
**Removed:** `pHash`, `nodeMatches`, `matchScores`.

### 3.6 `DecisionCache` — keep and use
```prisma
model DecisionCache {
  key       String   @id                    // sha1(archetype :: stateFingerprint :: taskId)
  output    String                          // JSON: DecisionOutput
  hits      Int      @default(0)
  createdAt DateTime @default(now())
}
```
Increment `hits` on every read. `SELECT sum(hits)` is the evidence behind L2, and the prototype's
`ModelCall` table having zero rows is exactly why the cost claim had nothing behind it.

### 3.7 Unchanged
`User` · `Project` · `Attestation` (non-FK `runId` on purpose, so the audit row survives a run
delete) · `Tour` (keep `parentTourId` self-relation) · `TourStep` · `ModelCall` · `Setting`.

**Dropped entirely:** `Session`, `PersonaArchetype`.

---

## 4. What gets written, and when

SSE streams from memory; SQLite is written at stage boundaries. Writing per event would mean
thousands of transactions and a stuttering UI.

| Moment | Writes |
|---|---|
| `POST /runs` | `Run` + `Attestation` (+ `Project` if new) — one transaction, after validation, before any work |
| Stage transition | `Run.status`, `.stage`, `.progressPct` — ~5 tiny writes per run |
| During crawl | **none.** States accumulate in memory; SSE emits each one live |
| End of crawl | `Run.graph`, `.stateCount`, `.actionCount`, `.truncated` — one write |
| Each decision | `ModelCall` buffered, flushed every 25; `DecisionCache` upsert on miss, `hits++` on hit |
| End of chorus | `Run.metrics`, `.populationSize` + `createMany(PersonaWalk)` for the 200-walk sample |
| End of analysis | `createMany(findings)` + `Run.findingCount`, `.exclusionIndex`, `.worstSegment`, `.worstStateId`, `.escalationRate` — one transaction |
| Tour generation | `Tour` + `createMany(TourStep)` — one transaction |
| Step approve/edit | one `TourStep` update per click |
| Drift | `DriftReport` upsert; apply writes a new `Tour` + steps |

**≈ 260 writes per run** (the walk sample dominates). SQLite does not notice.

---

## 5. SQLite configuration

Run at engine boot, before the first query:
```sql
PRAGMA journal_mode = WAL;      -- readers don't block the writer
PRAGMA synchronous  = NORMAL;   -- fsync at checkpoint, not every commit
PRAGMA busy_timeout = 5000;     -- wait under contention, don't throw
PRAGMA foreign_keys = ON;       -- Prisma does not enable this
```
The imported `db.ts` sets WAL and `foreign_keys` but **misses `synchronous` and `busy_timeout`** —
add both.

### Orphan sweep on boot
Any run left in a non-terminal status when the process died is marked
`FAILED` with `error: "Engine restarted during this run"`.

**The imported sweep only covers `CRAWLING | SCOUTING | CHORUS`.** It must cover **every**
non-terminal status: `CREATED`, `CRAWLING`, `CHORUS`, `ANALYZING`, `TOURING`. A run killed during
analysis currently stays `RUNNING` forever and the UI waits on it indefinitely.

---

## 6. Filesystem

```
apps/engine/
├── data/                          ← GITIGNORED, never committed
│   ├── dryrun.db  dryrun.db-wal  dryrun.db-shm
│   └── runs/<runId>/
│       ├── <stateId>.jpg          full screenshot (password fields masked)
│       ├── <stateId>.thumb.jpg    512×320 q70, for Atlas textures
│       └── run.json               whole graph, replayable and diffable
└── fixtures/                      ← COMMITTED, this is demo insurance
    └── meridian/
        ├── graph.json             a known-good 6-state crawl
        └── shots/*.jpg            its screenshots
```

**Fixtures are committed on purpose.** They are the L5 replay path and they must survive a laptop
wipe, a network failure, and a Chromium that won't launch at the venue. Generate them at H+10 and
regenerate whenever Meridian or the fingerprint changes.

Screenshots are ~200 KB each; a 25-state run is ~6 MB. `data/` grew to 44 MB across 18 runs in the
prototype. Delete it between demo rehearsals.

---

## 7. Authentication

**Operator auth: cut.** One seeded user (`usr_local`), one seeded project. Every query goes
through a single `currentUser()` seam that returns the seeded user, so enabling real auth later
touches one function.

**Target auth (logging personas into the app under test): out of scope**, with one exception —
`config.seededValues` supplies form field values (CR-07), including a demo credential if needed.
Those values are **run config, held in memory and in the `Run.config` blob**, and are redacted
from screenshots and traces by the S7 masking rule. Never persist a real credential to
`Setting` or to a fixture.

---

## 8. Query patterns

The five queries that matter, all indexed:
```ts
// Launchpad run cards — no blob parsing
run.findMany({ where:{ projectId }, orderBy:{ startedAt:'desc' }, take:10,
  select:{ id:true, targetUrl:true, status:true, stateCount:true,
           findingCount:true, exclusionIndex:true, worstSegment:true, startedAt:true }});

// Findings view
finding.findMany({ where:{ runId }, orderBy:{ fixValue:'desc' }});

// Atlas hot path — graph + metrics joined in the handler into AtlasNode[]
run.findUnique({ where:{ id }, select:{ graph:true, metrics:true, truncated:true, replayFixtureId:true }});

// Persona replay list
personaWalk.findMany({ where:{ runId, ...(segment && { segments:{ contains: segment }}) }, take:50 });

// Escalation rate
modelCall.groupBy({ by:['source'], where:{ runId }, _count:true });
```

---

## 9. Migrations, seed, backup

**Use `prisma db push`, not `migrate dev`.** No migration history in a 36-hour build; the schema
is the truth and the DB is disposable.

**Seed** (`prisma/seed.ts`): one `User`, one `Project` (`proj_meridian`). Nothing else — no seeded
runs, no seeded findings. A seeded finding that reaches the UI during a demo is indistinguishable
from a real one, which is the same class of mistake as `stubs.ts`.

**Backup at every gate:**
```bash
sqlite3 apps/engine/data/dryrun.db ".backup backups/gate-N.db"
cp -r apps/engine/fixtures backups/fixtures-gate-N
```
Onto a USB drive before the final review. A tagged commit plus a database backup means any gate
is demoable even if `main` breaks.

---

## 10. Schema change discipline

**After H+26, additive only.** New nullable columns, new tables, new blob keys. No renames, no
type changes, no dropped columns, no relation changes. A schema rename at hour 30 breaks the
frontend of a sleeping teammate, and you will not find out until the demo.
