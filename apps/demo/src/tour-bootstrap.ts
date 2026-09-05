// TR-06 — plays an approved Dry Run tour inside Meridian, live, with no console
// paste.
//
// This lives in the *target* app rather than in `usher-rt` on purpose
// (CLAUDE.md §9): `usher-rt` is a zero-dependency runtime under a hard 6 KB
// budget that is handed a tour object and does nothing else. Fetching, URL
// parsing and script loading are integration concerns and they belong to
// whoever embeds it — here, Meridian. A real customer would write these
// twenty lines themselves.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE NO-PARAMETER CONTRACT — read before changing anything in this file.
//
// Meridian is the evaluation fixture (CLAUDE.md §9, L4). The crawler
// fingerprints each state as
//   sha256(urlPattern | sortedRoleNamePairs | primaryHeading | landmarkSkeleton)
// so ANY element this file adds that carries a role or an accessible name —
// a banner, a button, a hidden live region, even an empty <div role="status">
// — changes those fingerprints, invalidates fixtures/meridian-v1 and breaks
// `pnpm demo`.
//
// Therefore: with no `?tour=` in the URL this module reads `location.search`
// and returns. No element is created, no listener is registered, no observer
// is constructed, no request is made. Reading the URL mutates nothing. Every
// line that touches the document is inside `boot()`, which is unreachable
// without the parameter.
// ─────────────────────────────────────────────────────────────────────────────

// Matches ENGINE_ORIGIN in apps/engine/src/server.ts. Hardcoded for the same
// reason it is hardcoded there: a target page has no way to discover where the
// engine lives, and this is a demo target on a known local port.
const ENGINE_ORIGIN = 'http://localhost:4000'

// Give React a chance to paint before anchors are resolved against the DOM.
// Capped so a page that never renders fails as "anchor did not resolve" — an
// honest outcome usher-rt already handles — instead of hanging silently.
const RENDER_TIMEOUT_MS = 3000

type TourPayload = { id: string; steps: unknown[] }

declare global {
  interface Window {
    DryRunTour?: { start: (tour: TourPayload) => void }
  }
}

function whenRendered(): Promise<void> {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const check = () => {
      const root = document.getElementById('root')
      if (root?.firstElementChild || Date.now() - startedAt > RENDER_TIMEOUT_MS) {
        resolve()
        return
      }
      requestAnimationFrame(check)
    }
    check()
  })
}

function loadUsherRuntime(): Promise<void> {
  if (window.DryRunTour) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `${ENGINE_ORIGIN}/usher-rt.js`
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('usher-rt.js did not load'))
    document.head.appendChild(script)
  })
}

async function boot(tourId: string) {
  // The approval gate is server-side (App Flow §8.2): this endpoint returns
  // only steps a human approved or edited, and 400s when there are none. The
  // page never sees a proposed or rejected step, because it is never sent one
  // — there is nothing to filter here and nothing to be tempted to override.
  //
  // It also returns the tour and nothing else: no graph, no findings, no
  // persona output, no screenshots.
  let payload: { tourJson: TourPayload }
  try {
    const res = await fetch(`${ENGINE_ORIGIN}/tours/${encodeURIComponent(tourId)}/export`)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      // Renders nothing, deliberately. "No approved steps" is a real answer and
      // Meridian is not the place to argue with it.
      console.warn('[dry-run] no tour to play:', body?.error ?? res.status)
      return
    }
    payload = await res.json()
  } catch {
    console.warn('[dry-run] could not reach the engine at', ENGINE_ORIGIN)
    return
  }

  if (!payload.tourJson?.steps?.length) return

  try {
    await loadUsherRuntime()
  } catch {
    console.warn('[dry-run] usher-rt could not be loaded from', ENGINE_ORIGIN)
    return
  }

  await whenRendered()
  // usher-rt owns everything from here: four-tier anchor resolution, and the
  // honest unresolved state when a step's anchor is gone or lives on another
  // screen. It is handed the tour and told to start; it is not told where it is
  // or what it should do about a miss.
  window.DryRunTour?.start(payload.tourJson)
}

const tourId = new URLSearchParams(window.location.search).get('tour')
if (tourId) void boot(tourId)
