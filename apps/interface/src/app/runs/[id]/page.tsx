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

  if (view === "tour") {
    return <TourBuilder runId={id} />;
  }

  return (
    <div className="p-6 text-ink-1">
      {view.charAt(0).toUpperCase() + view.slice(1)} view stub
    </div>
  );
}
