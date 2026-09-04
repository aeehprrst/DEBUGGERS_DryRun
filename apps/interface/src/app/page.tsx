"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export default function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    router.push(`/new?url=${encodeURIComponent(url)}`);
  };

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col px-8">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-rule">
        <span className="font-mono text-sm tracking-[0.08em] text-ink-0">
          DRY RUN
        </span>
        <nav className="flex items-center gap-6 text-sm text-ink-1">
          <span className="cursor-default">Settings</span>
          <span className="cursor-default">Docs</span>
        </nav>
      </header>

      <main className="grid flex-1 grid-cols-12 gap-8 py-16">
        <div className="col-span-12 flex flex-col md:col-span-7">
          <h1 className="font-cartouche text-5xl italic leading-[1.05] tracking-[-0.02em] text-ink-0">
            Find where onboarding breaks.
            <br />
            Before anyone signs up.
          </h1>

          <form
            onSubmit={handleSubmit}
            className="mt-8 flex flex-col gap-3 sm:flex-row"
          >
            <input
              type="url"
              required
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://staging.yourapp.com"
              className="h-12 flex-1 rounded-md border border-rule bg-chart-abyss px-4 font-mono text-sm text-ink-0 placeholder:text-ink-2 outline-none focus:border-marker focus:ring-3 focus:ring-marker/20"
            />
            <button
              type="submit"
              className="h-12 shrink-0 rounded-md bg-marker px-5 text-sm font-medium text-chart-deep transition hover:brightness-110 active:scale-[0.98]"
            >
              Launch Dry Run →
            </button>
          </form>

          <Link
            href="/new?preset=meridian"
            className="mt-3 w-fit text-sm text-ink-1 underline decoration-rule underline-offset-4 hover:text-ink-0"
          >
            Try the demo target ›
          </Link>
        </div>
      </main>
    </div>
  );
}
