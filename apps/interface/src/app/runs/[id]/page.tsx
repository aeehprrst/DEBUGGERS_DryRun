import FindingsView from "@/components/FindingsView";
import LiveConsole from "@/components/LiveConsole";
import TourBuilder from "@/components/TourBuilder";

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const { view } = await searchParams;

  if (view === undefined || view === "live") {
    return <LiveConsole runId={id} />;
  }

  if (view === "findings") {
    return <FindingsView runId={id} />;
  }

  if (view === "tour") {
    return <TourBuilder runId={id} />;
  }

  // Reachable only by typing the URL — these tabs are hidden (HIDDEN_VIEWS in
  // ViewTabs). It says what is true rather than the word "stub", which reads as
  // an unfinished thought to anyone who lands on it.
  const name = view.charAt(0).toUpperCase() + view.slice(1);
  return (
    <div className="p-s-6">
      <p className="text-body text-ink-1">
        The {name} view is not built in this build. Findings and Tour are the
        finished screens.
      </p>
    </div>
  );
}
