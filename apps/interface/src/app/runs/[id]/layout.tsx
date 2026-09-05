import Link from "next/link";
import ReplayBanner from "@/components/design/ReplayBanner";
import ViewTabs from "./ViewTabs";

export default async function RunLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="min-h-full bg-deep text-ink-0">
      <header className="fixed inset-x-0 top-0 z-10 flex h-14 items-center justify-between border-b border-rule bg-deep px-6">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="font-mono text-sm tracking-[0.08em] text-ink-0"
          >
            DRY RUN
          </Link>
          <span className="text-sm text-ink-2">·</span>
          <span className="text-sm text-ink-1">Project · run {id}</span>
        </div>
        <ViewTabs runId={id} />
      </header>

      {/* L5's disclosure sits in the layout, not in a view, so it is present on
          Live, Findings, Tour and anything added later — a replayed run is
          replayed everywhere, not only while the crawl streams. */}
      <div className="pt-14">
        <ReplayBanner runId={id} />
      </div>

      <main>{children}</main>
    </div>
  );
}
