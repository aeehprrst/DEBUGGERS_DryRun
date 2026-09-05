"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

const MERIDIAN_DEMO_URL = "http://localhost:5173";

function extractErrorMessage(value: unknown): string | null {
  if (
    value &&
    typeof value === "object" &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
  ) {
    return (value as { error: string }).error;
  }
  return null;
}

export default function NewRunPage() {
  return (
    <Suspense fallback={null}>
      <RunSetupForm />
    </Suspense>
  );
}

function RunSetupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialUrl =
    searchParams.get("preset") === "meridian"
      ? MERIDIAN_DEMO_URL
      : (searchParams.get("url") ?? "");

  const [targetUrl, setTargetUrl] = useState(initialUrl);
  const [attested, setAttested] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLaunch = async () => {
    setError(null);
    setIsLaunching(true);

    let res: Response;
    try {
      res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUrl, attestation: true }),
      });
    } catch {
      setError("Couldn't reach the engine. Check it's running and try again.");
      setIsLaunching(false);
      return;
    }

    const body: unknown = await res.json().catch(() => null);

    if (!res.ok) {
      setError(extractErrorMessage(body) ?? `Request failed (${res.status})`);
      setIsLaunching(false);
      return;
    }

    const { runId } = body as { runId: string };
    router.push(`/runs/${runId}?view=live`);
  };

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-6 bg-deep px-6 py-16 text-ink-0">
      <div>
        <a href="/" className="text-sm text-ink-1 hover:text-ink-0">
          ← Back
        </a>
        <h1 className="mt-4 text-2xl font-semibold text-ink-0">
          Dry run setup
        </h1>
      </div>

      <section className="rounded-lg border border-rule bg-shelf p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-1">
          1. Target URL
        </h2>
        <label htmlFor="target-url" className="mt-3 block text-sm text-ink-1">
          URL
        </label>
        <input
          id="target-url"
          type="url"
          required
          value={targetUrl}
          onChange={(event) => setTargetUrl(event.target.value)}
          placeholder="http://localhost:5173"
          className="mt-1 h-10 w-full rounded-md border border-rule bg-abyss px-3 font-mono text-sm text-ink-0 placeholder:text-ink-2 outline-none focus:border-marker focus:ring-3 focus:ring-marker/20"
        />
      </section>

      <section className="rounded-lg border-l-2 border-marker bg-marker/10 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-1">
          2. Attestation gate
        </h2>
        <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm text-ink-0">
          <input
            type="checkbox"
            checked={attested}
            onChange={(event) => setAttested(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-marker"
          />
          <span>
            I attest that I own or am authorized to test this target URL.
          </span>
        </label>
      </section>

      <section className="rounded-lg border border-rule bg-shelf p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-1">
          3. Preset task
        </h2>
        <div className="mt-3 rounded-md border border-rule bg-shoal px-4 py-3">
          <p className="text-sm text-ink-0">Complete initial setup</p>
          <p className="mt-1 font-mono text-xs text-ink-2">
            Start: /signup → Goal: &quot;Your workspace is ready&quot;
          </p>
        </div>
      </section>

      {error && (
        <p className="text-sm text-marker" role="alert">
          {error}
        </p>
      )}

      <div className="sticky bottom-0 -mx-6 border-t border-rule bg-deep px-6 py-4">
        <button
          type="button"
          disabled={!attested || targetUrl.length === 0 || isLaunching}
          onClick={handleLaunch}
          className="h-11 w-full rounded-md bg-marker text-sm font-medium text-deep transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-shoal disabled:text-ink-2 disabled:hover:brightness-100"
        >
          {isLaunching ? "Launching…" : "Launch Dry Run"}
        </button>
      </div>
    </div>
  );
}
