"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

const VIEWS = [
  { key: "live", label: "Live" },
  { key: "atlas", label: "Atlas" },
  { key: "findings", label: "Findings" },
  { key: "tour", label: "Tour" },
  { key: "drift", label: "Drift" },
] as const;

/**
 * Views whose route exists but which render nothing built yet. A tab that leads
 * to a stub is worse than no tab: it invites a click during a demo and answers
 * with an empty screen.
 *
 * Re-enabling is deleting one entry from this set — the routes, the components
 * and the tab definitions above are all still here. Drop "atlas" when AT-01
 * wires `Atlas2D`/`Atlas3D` to `GET /runs/:id/graph`; drop "drift" when TR-07
 * lands.
 */
export const HIDDEN_VIEWS: ReadonlySet<string> = new Set(["atlas", "drift"]);

export default function ViewTabs({ runId }: { runId: string }) {
  const searchParams = useSearchParams();
  const activeView = searchParams.get("view") ?? "live";

  return (
    <nav className="flex items-center gap-1">
      {VIEWS.filter((view) => !HIDDEN_VIEWS.has(view.key)).map((view) => {
        const isActive = activeView === view.key;
        return (
          <Link
            key={view.key}
            href={`/runs/${runId}?view=${view.key}`}
            className={`border-b-2 px-3 py-1.5 text-sm transition ${
              isActive
                ? "border-marker text-ink-0"
                : "border-transparent text-ink-1 hover:text-ink-0"
            }`}
          >
            {view.label}
          </Link>
        );
      })}
    </nav>
  );
}
