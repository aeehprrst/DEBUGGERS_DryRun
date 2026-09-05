import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Locator, Page } from "playwright";
import sharp from "sharp";

// TRD §7 Storage: "./data/runs/<runId>/<stateId>.jpg (+ .thumb.jpg), served statically."
const DATA_ROOT = path.resolve(process.cwd(), "data", "runs");

// CLAUDE.md §8 / CR-06 — "every input[type=password] and any field whose label
// matches key / secret / token is blanked before the screenshot is written to
// disk." The crawler types synthetic values (§9.5) and CR-07 now types a real
// *shaped* credential into "API key", so the value that reaches the JPEG has to
// be covered even though it is a fixture.
export const SECRET_FIELD_NAME_RE =
  /\b(key|keys|secret|secrets|token|tokens|password|passphrase|credential|credentials)\b/i;

// Covered at capture time rather than by clearing the field first: clearing
// would re-trigger the target's validation and undo the fill that CR-07 exists
// to make stick. Playwright paints an opaque box over each element's box
// before the frame is encoded, so no plaintext ever reaches the encoder.
function secretLocators(page: Page): Locator[] {
  return [
    page.locator('input[type="password"]'),
    page.getByRole("textbox", { name: SECRET_FIELD_NAME_RE }),
    page.getByLabel(SECRET_FIELD_NAME_RE),
  ];
}

export async function captureStateScreenshot(
  page: Page,
  runId: string,
  stateId: string,
): Promise<string> {
  const dir = path.join(DATA_ROOT, runId);
  await mkdir(dir, { recursive: true });

  const buffer = await page.screenshot({
    fullPage: true,
    type: "jpeg",
    quality: 80,
    mask: secretLocators(page),
  });
  await writeFile(path.join(dir, `${stateId}.jpg`), buffer);
  await sharp(buffer)
    .resize({ width: 320 })
    .jpeg({ quality: 70 })
    .toFile(path.join(dir, `${stateId}.thumb.jpg`));

  return `/static/runs/${runId}/${stateId}.jpg`;
}
