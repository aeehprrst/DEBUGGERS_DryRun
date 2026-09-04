/// <reference lib="dom" />
import type { Page } from "playwright";
import type { A11yNode } from "@dry-run/core";

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rl, gl, bl] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseRgb(value: string): [number, number, number] | null {
  const match = value.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

async function primaryCtaContrast(
  page: Page,
  cta: A11yNode,
): Promise<{ ratio: number; low: boolean } | null> {
  const locator = page.getByRole(cta.role as "button", { name: cta.name, exact: true }).nth(cta.ordinal);
  const colors = await locator
    .evaluate((el) => {
      let bgEl: Element | null = el;
      let bg = "";
      for (let i = 0; i < 6 && bgEl; i++) {
        bg = getComputedStyle(bgEl).backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") break;
        bgEl = bgEl.parentElement;
      }
      return { fg: getComputedStyle(el).color, bg: bg || "rgb(255, 255, 255)" };
    })
    .catch(() => null);
  if (!colors) return null;

  const fg = parseRgb(colors.fg);
  const bg = parseRgb(colors.bg);
  if (!fg || !bg) return null;

  const ratio = Math.round(contrastRatio(fg, bg) * 100) / 100;
  return { ratio, low: ratio < 4.5 };
}

export async function computeStaticSignals(
  page: Page,
  nodes: A11yNode[],
): Promise<Record<string, unknown>> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };

  const interactiveRoles = new Set(["button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox"]);
  const interactiveCount = nodes.filter((n) => interactiveRoles.has(n.role)).length;

  const offscreenControls = nodes
    .filter(
      (n) =>
        interactiveRoles.has(n.role) &&
        (n.box.x + n.box.width <= 0 ||
          n.box.x >= viewport.width ||
          n.box.y + n.box.height <= 0),
    )
    .map((n) => n.name);

  const primaryCta = nodes.find((n) => n.role === "button");
  const belowFoldPrimaryCta = primaryCta ? primaryCta.box.y > viewport.height : false;

  const contrast = primaryCta ? await primaryCtaContrast(page, primaryCta) : null;

  return {
    interactiveCount,
    belowFoldPrimaryCta,
    offscreenControls,
    primaryCtaContrastRatio: contrast?.ratio ?? null,
    primaryCtaLowContrast: contrast?.low ?? false,
  };
}
