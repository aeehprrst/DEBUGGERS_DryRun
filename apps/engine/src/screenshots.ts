import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import sharp from "sharp";

// TRD §7 Storage: "./data/runs/<runId>/<stateId>.jpg (+ .thumb.jpg), served statically."
const DATA_ROOT = path.resolve(process.cwd(), "data", "runs");

export async function captureStateScreenshot(
  page: Page,
  runId: string,
  stateId: string,
): Promise<string> {
  const dir = path.join(DATA_ROOT, runId);
  await mkdir(dir, { recursive: true });

  const buffer = await page.screenshot({ fullPage: true, type: "jpeg", quality: 80 });
  await writeFile(path.join(dir, `${stateId}.jpg`), buffer);
  await sharp(buffer)
    .resize({ width: 320 })
    .jpeg({ quality: 70 })
    .toFile(path.join(dir, `${stateId}.thumb.jpg`));

  return `/static/runs/${runId}/${stateId}.jpg`;
}
