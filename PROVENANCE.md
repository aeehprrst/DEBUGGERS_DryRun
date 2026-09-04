# Provenance

Dry Run is **not** greenfield, and we would rather you read that here than discover it.

The engine, the shared core package, the tour runtime and the Meridian demo app were
imported from a prior prototype built for **DevJams'26**, at commit **`649c2fc`**. That
import is the first commit in this repository, made before the WE Hack 5.0 window opened,
and it is what the `PROVENANCE` line in the deck refers to. **Everything after that first
commit is WE Hack 5.0 work**, dated inside the window and visible in `git log`. The imported
code is roughly 5,000 lines: a working Playwright crawler that reads the accessibility tree,
a seeded Monte Carlo population simulator, a unit-tested scoring module, a semantic-anchor
tour compiler, and a deliberately mediocre demo SaaS with six planted defects. What these
36 hours build on top of it is the run orchestrator, the exclusion measurement, anchor-level
drift, the evaluation harness and the entire interface.

## Imported at `649c2fc` (DevJams'26)

| Path | What it is |
|---|---|
| `apps/engine/src/aria.ts` | Accessibility-tree extraction from `ariaSnapshot` |
| `apps/engine/src/cartographer.ts` | Playwright BFS crawler → State Graph |
| `apps/engine/src/signals.ts` | Zero-AI static signals measured in the browser |
| `apps/engine/src/screenshots.ts` | Screenshot + thumbnail capture |
| `apps/engine/src/sse.ts` | Run event bus |
| `apps/engine/src/db.ts` | Prisma client, boot PRAGMAs, row↔core mappers |
| `apps/engine/src/server.ts` | Fastify app and API surface |
| `apps/engine/src/brain/` | `adapter.ts` · `analysis.ts` · `chorus.ts` · `heuristic.ts` |
| `apps/engine/src/usher/` | `compiler.ts` · `generator.ts` |
| `apps/engine/prisma/` | `schema.prisma` · `seed.ts` |
| `packages/core/` | Zod schemas, enums, scoring (11 passing tests) |
| `packages/usher-rt/` | Embeddable tour runtime, 5,342 bytes |
| `apps/demo/` | Meridian v1 and its six planted defects |
| `apps/interface/` | Next.js shell, 2D/3D Atlas, Live Console, Tour Builder |
| `docs/reference/tour-dump-example.json` | A tour the prototype's pipeline produced end to end; kept as reference |

## Not imported

Playwright-driven Scouts (`apps/engine/src/scouts/`) and the stub graph and findings
(`apps/engine/src/stubs.ts`) existed at `649c2fc` and were deliberately left out — Scouts are
cut in v2 (PRD v2 §0, `CLAUDE.md` §5), and stub data served from live endpoints is a failure
mode that looks like success.
