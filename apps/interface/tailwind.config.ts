import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        "chart-deep": "#0A1620",
        "chart-abyss": "#070E15",
        "chart-shoal": "#122333",
        "chart-shelf": "#1A3247",
        "ink-0": "#EAE6DF",
        "ink-1": "#94A3B8",
        "ink-2": "#475569",
        marker: "#FF5A00",
        flow: "#22d3ee",
        rule: "rgba(234, 230, 223, 0.12)",
        "rule-strong": "rgba(234, 230, 223, 0.24)",
      },
      fontFamily: {
        cartouche: ["var(--font-instrument)", "serif"],
        sans: ["var(--font-plex-sans)", "system-ui"],
        mono: ["var(--font-plex-mono)", "monospace"],
      },
    },
  },
};

export default config;
