"use client";

import type { TourStep } from "@dry-run/core";
import { useEffect, useMemo, useState } from "react";

type Tour = {
  id: string;
  runId: string;
  version: number;
  name: string;
  status: string;
  steps: TourStep[];
};

type ExportPayload = {
  // TR-06 — `route` is filled in by the export endpoint from the run's graph,
  // so it exists here and not on the steps `POST /runs/:id/tour` returns.
  tourJson: { steps: (TourStep & { route?: string })[] };
  embedSnippet: string;
};

const PLACEMENTS = ["top", "bottom", "left", "right", "center"] as const;

const APPROVED_STATUSES = new Set(["approved", "edited"]);

async function readJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function AnchorChip({ anchor }: { anchor: TourStep["anchor"] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-sm border border-dashed border-rule-strong bg-abyss px-2 py-0.5 font-mono text-xs text-ink-1"
      >
        {anchor.role} &quot;{anchor.name}&quot;
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-72 rounded-md border border-rule-strong bg-abyss p-3 text-xs shadow-lg">
          <p className="mb-2 text-[10px] uppercase tracking-[0.08em] text-ink-2">
            Resolution ladder
          </p>
          <ol className="space-y-1 font-mono text-ink-1">
            <li>
              1. data-testid —{" "}
              <span className={anchor.dataTestId ? "text-ink-0" : "text-ink-2"}>
                {anchor.dataTestId ?? "none"}
              </span>
            </li>
            <li>
              2. role+name exact — {anchor.role} &quot;{anchor.name}&quot;
            </li>
            <li>3. role+name fuzzy (≥ 0.8 similarity)</li>
            <li>
              4. landmark+ordinal —{" "}
              <span className="text-ink-0">
                {anchor.landmark ?? "?"} [{anchor.ordinal}]
              </span>
            </li>
            <li className="text-ink-2">5. → null: step marked BROKEN</li>
          </ol>
        </div>
      )}
    </div>
  );
}

function StepCard({
  step,
  onApprove,
  onReject,
  onRestore,
  onSaveEdit,
}: {
  step: TourStep;
  onApprove: () => void;
  onReject: () => void;
  onRestore: () => void;
  onSaveEdit: (patch: { title: string; body: string; placement: string }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(step.title);
  const [body, setBody] = useState(step.body);
  const [placement, setPlacement] = useState(step.placement);

  useEffect(() => {
    if (!editing) {
      setTitle(step.title);
      setBody(step.body);
      setPlacement(step.placement);
    }
  }, [editing, step.title, step.body, step.placement]);

  const isApproved = APPROVED_STATUSES.has(step.status);
  const isRejected = step.status === "rejected";

  if (isRejected) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-rule bg-shelf px-4 py-2 text-sm text-ink-2">
        <span>
          {step.order + 1}. {step.title} — rejected
        </span>
        <button
          type="button"
          onClick={onRestore}
          className="text-xs text-ink-1 underline hover:text-ink-0"
        >
          restore
        </button>
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border bg-shelf p-4 ${
        // UI/UX §8.5 — "Approved cards get an --ok left border."
        isApproved ? "border-l-4 border-l-ok border-y-rule border-r-rule" : "border-rule"
      }`}
    >
      <div className="flex gap-3">
        <span className="font-mono text-2xl text-ink-2">{step.order + 1}</span>
        <div className="flex-1">
          {editing ? (
            <div className="space-y-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border border-rule bg-abyss px-2 py-1 text-sm text-ink-0"
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-rule bg-abyss px-2 py-1 text-sm text-ink-0"
              />
              <select
                value={placement}
                onChange={(e) => setPlacement(e.target.value)}
                className="rounded-md border border-rule bg-abyss px-2 py-1 text-xs text-ink-1"
              >
                {PLACEMENTS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <p className="text-sm font-semibold text-ink-0">{step.title}</p>
              <p className="mt-1 text-sm text-ink-1">{step.body}</p>
            </>
          )}
          <div className="mt-2">
            <AnchorChip anchor={step.anchor} />
          </div>
        </div>
      </div>

      {editing && (
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-md border border-rule-strong px-3 py-1 text-xs text-ink-1 hover:text-ink-0"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onSaveEdit({ title, body, placement });
              setEditing(false);
            }}
            className="rounded-md border border-marker bg-marker px-3 py-1 text-xs font-semibold text-deep"
          >
            Save
          </button>
        </div>
      )}

      {/* UI/UX §8.4 — approved cards drop their button row entirely */}
      {!editing && !isApproved && (
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-rule-strong px-3 py-1 text-xs text-ink-1 hover:text-ink-0"
          >
            ✎ Edit
          </button>
          {/* UI/UX §9 "Button · secondary" — transparent, 1px --rule-strong,
              --ink-0, hover bg --chart-shoal. Reject is destructive but it does
              not get its own hue: §2 allows exactly one accent, and §3.6 makes
              --danger the marker value, which is reserved for selection and
              primary action. */}
          <button
            type="button"
            onClick={onReject}
            className="rounded-md border border-rule-strong bg-transparent px-3 py-1 text-xs text-ink-0 hover:bg-shoal"
          >
            ✕ Reject
          </button>
          {/* --ok is §3.6's declared token for "intact, approved, success", and
              §8.5 already spends it on this card's approved state. Reusing it
              on the action keeps the affirmative signal on one declared colour
              instead of introducing a second accent. Not a spec'd button
              variant — the brief names only primary and secondary in §9. */}
          <button
            type="button"
            onClick={onApprove}
            className="rounded-md border border-ok/40 px-3 py-1 text-xs text-ok hover:border-ok"
          >
            ✓ Approve
          </button>
        </div>
      )}
    </div>
  );
}

export default function TourBuilder({ runId }: { runId: string }) {
  const [tour, setTour] = useState<Tour | null>(null);
  const [targetUrl, setTargetUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportData, setExportData] = useState<ExportPayload | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [runRes, tourRes] = await Promise.all([
          fetch(`/api/runs/${runId}`),
          fetch(`/api/runs/${runId}/tour`, { method: "POST" }),
        ]);

        const runBody = await readJson(runRes);
        if (!cancelled && runRes.ok) {
          setTargetUrl(runBody?.targetUrl ?? null);
        }

        const tourBody = await readJson(tourRes);
        if (cancelled) return;
        if (!tourRes.ok) {
          setError(tourBody?.error ?? "Could not generate a tour for this run yet.");
          return;
        }
        setTour(tourBody as Tour);
      } catch {
        if (!cancelled) setError("Could not reach the engine.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const approvedCount = useMemo(
    () => tour?.steps.filter((s) => APPROVED_STATUSES.has(s.status)).length ?? 0,
    [tour],
  );
  const canShip = approvedCount >= 1;

  async function patchStep(stepId: string, body: Record<string, unknown>) {
    if (!tour) return;
    const res = await fetch(`/api/tours/${tour.id}/steps/${stepId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const updated = await readJson(res);
    if (!res.ok || !updated) return;
    setTour((prev) =>
      prev
        ? { ...prev, steps: prev.steps.map((s) => (s.id === stepId ? (updated as TourStep) : s)) }
        : prev,
    );
  }

  async function fetchExport(): Promise<ExportPayload | null> {
    if (!tour) return null;
    const res = await fetch(`/api/tours/${tour.id}/export`);
    const body = await readJson(res);
    if (!res.ok) {
      setExportError(body?.error ?? "Export failed.");
      return null;
    }
    setExportError(null);
    return body as ExportPayload;
  }

  async function handleExport() {
    setExportOpen(true);
    const data = await fetchExport();
    if (data) setExportData(data);
  }

  /**
   * TR-06 — opens the target app at the first approved step's own route with
   * `?tour=<id>`, and the target's bootstrap does the rest. This replaces the
   * console-paste preview that stood here: that flow existed only because
   * nothing on the target could fetch a tour, and leaving its button in place
   * would leave UI copy instructing the operator to do something we no longer
   * need them to do.
   *
   * Note what is *not* sent: this hands over a tour id in a query string.
   * The page fetches the tour itself, through the same server-side approval
   * gate the Export button uses, so an unapproved step cannot reach the target
   * by this path any more than by that one.
   */
  async function handlePlayOnTarget() {
    setPreviewNote(null);
    const data = await fetchExport();
    if (!data || !tour) return;
    if (!targetUrl) {
      setPreviewNote("This run recorded no target url, so there is nowhere to open.");
      return;
    }

    // The first approved step is where the tour begins, so that is the screen
    // to land on. A step whose state carried no parsable url in the graph has
    // no `route`; the target's own entry point is the honest fallback, and it
    // is named as a fallback rather than passed off as the step's screen.
    const firstRoute = data.tourJson.steps[0]?.route;
    let url: URL;
    try {
      url = new URL(firstRoute ?? "/", targetUrl);
    } catch {
      setPreviewNote("Could not build a target url from this run's target and the step's route.");
      return;
    }
    url.searchParams.set("tour", tour.id);

    if (!firstRoute) {
      setPreviewNote(
        "The first approved step has no recorded route, so the target opened at its entry point. The step may report that its anchor did not resolve there.",
      );
    }
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  }

  if (loading) {
    return <div className="p-6 text-sm text-ink-2">Building tour…</div>;
  }
  if (error) {
    return <div className="p-6 text-sm text-ink-2">{error}</div>;
  }
  if (!tour) {
    return null;
  }

  return (
    <div className="mx-auto max-w-[820px] p-6 pb-24">
      <h1 className="text-sm font-semibold uppercase tracking-[0.08em] text-ink-1">
        Proposed tour — {tour.steps.length} step{tour.steps.length === 1 ? "" : "s"}
      </h1>

      <div className="mt-4 space-y-3">
        {tour.steps.map((step) => (
          <StepCard
            key={step.id}
            step={step}
            onApprove={() => patchStep(step.id, { status: "approved" })}
            onReject={() => patchStep(step.id, { status: "rejected" })}
            onRestore={() => patchStep(step.id, { status: "proposed" })}
            onSaveEdit={(patch) => patchStep(step.id, patch)}
          />
        ))}
      </div>

      <div className="fixed inset-x-0 bottom-0 flex items-center justify-between border-t border-rule-strong bg-deep px-6 py-3">
        <span className="text-sm text-ink-1">
          {approvedCount} of {tour.steps.length} approved
        </span>
        <div className="flex gap-2">
          {/* Brief §9 "Button · secondary": transparent, 1px --rule-strong,
              --ink-0, hover bg --chart-shoal. Disabled follows §9's stated
              disabled treatment — --chart-shoal bg, --ink-2 text, and a tooltip
              that states the reason, which the "N of M approved" count beside
              it also states in text so the reason is never tooltip-only. */}
          <button
            type="button"
            disabled={!canShip}
            onClick={handlePlayOnTarget}
            title={
              canShip
                ? "Opens the target app at the first approved step with ?tour="
                : "Approve at least one step first"
            }
            className="rounded-md border border-rule-strong bg-transparent px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-ink-0 transition-colors duration-fast ease-out hover:bg-shoal disabled:cursor-not-allowed disabled:border-rule disabled:bg-shoal disabled:text-ink-2 disabled:hover:bg-shoal"
          >
            Play on target
          </button>
          <button
            type="button"
            disabled={!canShip}
            onClick={handleExport}
            title={canShip ? undefined : "Approve at least one step first"}
            className="rounded-md border border-marker bg-marker px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-deep disabled:cursor-not-allowed disabled:border-rule disabled:bg-shoal disabled:text-ink-2"
          >
            Export
          </button>
        </div>
      </div>

      {previewNote && (
        <div className="fixed bottom-16 right-6 max-w-xs rounded-md border border-rule-strong bg-shoal p-3 text-xs text-ink-1 shadow-lg">
          {previewNote}
        </div>
      )}

      {exportOpen && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-abyss/85 p-6">
          <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-rule-strong bg-shelf p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-ink-1">
                Export tour
              </h2>
              <button
                type="button"
                onClick={() => setExportOpen(false)}
                className="text-ink-2 hover:text-ink-0"
                aria-label="Close export modal"
              >
                ✕
              </button>
            </div>

            {exportError ? (
              <p className="mt-4 text-sm text-ink-2">{exportError}</p>
            ) : exportData ? (
              <>
                <p className="mt-4 text-xs uppercase tracking-[0.08em] text-ink-2">
                  Embed snippet
                </p>
                <pre className="mt-1 overflow-x-auto rounded-md border border-rule bg-abyss p-3 font-mono text-xs text-ink-0">
                  {exportData.embedSnippet}
                </pre>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(exportData.embedSnippet)}
                  className="mt-2 rounded-md border border-rule-strong px-3 py-1 text-xs text-ink-1 hover:text-ink-0"
                >
                  Copy snippet
                </button>

                <p className="mt-4 text-xs uppercase tracking-[0.08em] text-ink-2">
                  tour.json
                </p>
                <pre className="mt-1 max-h-64 overflow-auto rounded-md border border-rule bg-abyss p-3 font-mono text-xs text-ink-1">
                  {JSON.stringify(exportData.tourJson, null, 2)}
                </pre>
              </>
            ) : (
              <p className="mt-4 text-sm text-ink-2">Loading…</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
