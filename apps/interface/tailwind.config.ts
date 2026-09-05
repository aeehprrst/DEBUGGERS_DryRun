import type { Config } from "tailwindcss";

/**
 * Tokens transcribed verbatim from UI/UX §12. Derive nothing (§0, CLAUDE.md §7).
 *
 * §0 of the brief names the drift this file had accumulated as "the single
 * biggest visual regression to undo": `--ink-1`/`--ink-2` had become Tailwind
 * slate-400/slate-600, `--flow` had become cyan-400, the shelf/shoal surfaces
 * were swapped and wrong, the six-stop friction ramp was absent entirely, and
 * the four semantic colours were missing so emerald and red were being used ad
 * hoc — three accent hues in a palette that allows exactly one.
 *
 * Warm bone on cold water. One accent: survey orange.
 */
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // §3.1 substrate — deep water. Blue-black, never neutral black.
        abyss: "#060D14",
        deep: "#0A1620",
        shelf: "#10202C",
        shoal: "#17303E",
        rule: "#1F3D4D",
        "rule-strong": "#2E5468",

        // §3.2 ink — warm bone. #EDE4D3 on #0A1620 is 14.8:1.
        ink: { 0: "#EDE4D3", 1: "#A8A395", 2: "#6E7A80" },

        // §3.3 accent — the survey marker. The only accent hue in the product.
        marker: { DEFAULT: "#FF7A45", dim: "#B8532C" },

        // §3.4 flow — persona current, deliberately desaturated so it never
        // competes with the marker.
        flow: { DEFAULT: "#8FC7D6", dim: "#4E7E8C" },

        // §3.5 friction ramp. These are the same six stops as
        // packages/core/src/ramp.ts FRICTION_STOPS — that module is the source
        // of truth for anything computed; these exist for static classes only.
        f: {
          0: "#12293A",
          20: "#1E4A5C",
          40: "#3E7484",
          60: "#96A48F",
          80: "#D8B06A",
          100: "#FF7A45",
        },

        // §3.6 semantic. `--danger` is deliberately the marker value: orange is
        // our alarm, and a second alarm hue would break the one-accent rule.
        ok: "#8AA98C",
        warn: "#E0A03C",
        info: "#8FC7D6",
      },

      // §4 — three faces plus the condensed cut for chart labels. Inter is the
      // default default; Plex carries the drafting lineage this instrument wants.
      fontFamily: {
        cartouche: ["var(--font-instrument)", "serif"],
        sans: ["var(--font-plex-sans)", "system-ui"],
        cond: ["var(--font-plex-cond)", "system-ui"],
        mono: ["var(--font-plex-mono)", "monospace"],
      },

      // §4 type scale at the 1280px baseline.
      fontSize: {
        "cartouche-1": ["48px", { lineHeight: "1.05", letterSpacing: "-0.02em" }],
        "cartouche-2": ["30px", { lineHeight: "1.15", letterSpacing: "-0.01em" }],
        h1: ["22px", { lineHeight: "1.25", letterSpacing: "-0.01em" }],
        h2: ["17px", { lineHeight: "1.35" }],
        body: ["14px", { lineHeight: "1.55" }],
        "body-sm": ["12.5px", { lineHeight: "1.5" }],
        label: ["11px", { lineHeight: "1.35", letterSpacing: "0.08em" }],
        "data-xl": ["34px", { lineHeight: "1.0" }],
        "data-lg": ["20px", { lineHeight: "1.1" }],
        data: ["13px", { lineHeight: "1.35" }],
      },

      // §5 space scale.
      spacing: {
        "s-1": "4px",
        "s-2": "8px",
        "s-3": "12px",
        "s-4": "16px",
        "s-5": "24px",
        "s-6": "32px",
        "s-7": "48px",
        "s-8": "64px",
      },

      // §5 — radii stay tight. Soft 16px corners read as consumer app.
      borderRadius: { sm: "3px", md: "6px", lg: "10px", full: "999px" },

      // §6 motion.
      transitionDuration: {
        instant: "80ms",
        fast: "140ms",
        base: "220ms",
        slow: "380ms",
        deliberate: "600ms",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(.16,1,.3,1)",
        "in-out": "cubic-bezier(.65,0,.35,1)",
      },

      // §5 — the widths the layouts are specified at.
      maxWidth: {
        findings: "880px", // §8.4
        column: "820px", // §8.5, §8.6
        setup: "720px", // §8.2
        shell: "1280px", // §8.1
      },
    },
  },
};

export default config;
