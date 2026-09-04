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

export default function ViewTabs({ runId }: { runId: string }) {
  const searchParams = useSearchParams();
  const activeView = searchParams.get("view") ?? "live";

  return (
    <nav className="flex items-center gap-1">
      {VIEWS.map((view) => {
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
