import { test, expect, type Download, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile, stat } from 'node:fs/promises';

async function downloadBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  return readFile(path!);
}

/** Extracts each page's text via pdf.js — independent of pdf-lib, and (unlike a visual
 *  cover box) unable to see anything but what's actually still in the content stream. */
async function extractPageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    out.push(content.items.map((it: any) => ('str' in it ? it.str : '')).join(''));
  }
  // @ts-ignore pdfjs v6 removed PDFDocumentProxy#destroy(); destroy via the loading task.
  if (typeof doc.loadingTask?.destroy === 'function') await doc.loadingTask.destroy();
  return out;
}

/** Renders page 1 to RGBA pixels — for asserting a watermark is actually VISIBLE.
 *  (Text extraction can't catch invisibility: a watermark drawn behind an opaque
 *  page background still extracts fine while showing nothing.) */
async function renderPagePixels(bytes: Uint8Array): Promise<Uint8ClampedArray> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const pdfPage = await doc.getPage(1);
  const viewport = pdfPage.getViewport({ scale: 1 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await pdfPage.render({ canvasContext: ctx, viewport }).promise;
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  // @ts-ignore pdfjs v6 removed PDFDocumentProxy#destroy(); destroy via the loading task.
  if (typeof doc.loadingTask?.destroy === 'function') await doc.loadingTask.destroy();
  return pixels;
}

function countDifferingPixels(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 4) {
    if (Math.abs(a[i] - b[i]) > 8 || Math.abs(a[i + 1] - b[i + 1]) > 8 || Math.abs(a[i + 2] - b[i + 2]) > 8) n++;
  }
  return n;
}

async function runAndDownload(page: Page): Promise<Download> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('download-result').click();
  return downloadPromise;
}

test('merge: 2+1 pages -> 3-page pdf', async ({ page }) => {
  await page.goto('/merge-pdf');
  await page.getByTestId('file-input').setInputFiles(['e2e/.fixtures/a.pdf', 'e2e/.fixtures/b.pdf']);
  await page.getByTestId('run-tool').click();
  await expect(page.getByTestId('download-result')).toBeVisible();
  const bytes = await downloadBytes(await runAndDownload(page));
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
});

test('split: extract pages 1-2 of big.pdf', async ({ page }) => {
  await page.goto('/split-pdf');
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/big.pdf');
  // "Select pages" is the default tab; typed ranges live behind "Type ranges".
  await page.getByRole('tab', { name: 'Type ranges' }).click();
  await page.getByTestId('range-input').fill('1-2');
  await page.getByTestId('run-tool').click();
  await expect(page.getByTestId('download-result')).toBeVisible({ timeout: 60_000 });
  const bytes = await downloadBytes(await runAndDownload(page));
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
});

test('compress: output smaller than input', async ({ page }) => {
  await page.goto('/compress-pdf');
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/big.pdf');
  await page.getByTestId('run-tool').click();
  await expect(page.getByTestId('download-result')).toBeVisible({ timeout: 90_000 });
  const bytes = await downloadBytes(await runAndDownload(page));
  const original = await stat('e2e/.fixtures/big.pdf');
  expect(bytes.length).toBeLessThan(original.size);
  await PDFDocument.load(new Uint8Array(bytes)); // still a valid pdf
});

test('edit: replace text, rotate page, and export', async ({ page }) => {
  await page.goto('/edit-pdf');
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/edit.pdf');
  const span = page.locator('span[contenteditable]').first();
  await expect(span).toBeVisible({ timeout: 30_000 });
  await span.click();
  await span.press('ControlOrMeta+a');
  await span.pressSequentially('Edited by e2e');
  await page.getByRole('button', { name: 'Rotate page 1 right' }).click();
  await page.getByTestId('run-tool').click();
  await expect(page.getByTestId('download-result')).toBeVisible({ timeout: 60_000 });
  const bytes = await downloadBytes(await runAndDownload(page));
  const doc = await PDFDocument.load(new Uint8Array(bytes));
  expect(doc.getPageCount()).toBe(1);
  expect(doc.getPage(0).getRotation().angle).toBe(90);
  expect(bytes.length).toBeGreaterThan((await stat('e2e/.fixtures/edit.pdf')).size); // embedded font present

  // True removal, not cover-and-redraw: the original fixture text ("Hello World from
  // localdobe") must be genuinely gone from the content stream, not just painted over.
  const [text] = await extractPageTexts(new Uint8Array(bytes));
  expect(text).toContain('Edited by e2e');
  expect(text).not.toContain('Hello World from localdobe');
});

test('watermark: added text watermark is visibly rendered', async ({ page }) => {
  await page.goto('/watermark-pdf');
  // opaque.pdf paints its own full-page background (like scans and Word/browser
  // exports); a watermark drawn beneath it renders as a no-op. Real-world docs
  // are the norm here, so visibility must be asserted against this fixture.
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/opaque.pdf');
  await page.getByTestId('wm-text').fill('E2E DRAFT');
  await page.getByTestId('run-tool').click();
  await expect(page.getByTestId('download-result')).toBeVisible({ timeout: 90_000 });
  const bytes = new Uint8Array(await downloadBytes(await runAndDownload(page)));
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  // The watermark must change what the page LOOKS like, not just what it contains.
  const before = await renderPagePixels(new Uint8Array(await readFile('e2e/.fixtures/opaque.pdf')));
  const after = await renderPagePixels(bytes);
  expect(countDifferingPixels(before, after)).toBeGreaterThan(1000);
});

test('signatures: signed pdf reports signature evidence, not an engine error', async ({ page }) => {
  await page.goto('/validate-pdf-signature');
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/signed.pdf');
  // The trust-pool + signature-parse path only runs for signed PDFs; it must produce
  // a report (even for an unverifiable signature), never an error.
  await expect(page.getByTestId('sig-report')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('sig-report')).toContainText(/signature/i);
  await expect(page.getByTestId('sig-report')).not.toContainText(/no digital signatures/i);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('edit: corrupt file shows a visible error', async ({ page }) => {
  await page.goto('/edit-pdf');
  await page.getByTestId('file-input').setInputFiles({
    name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 not really a pdf'),
  });
  // The open failure leaves doc null — the error must render anyway (regression:
  // it used to be inside the doc-only block and never appeared).
  await expect(page.getByRole('alert')).toContainText(/could not open/i, { timeout: 30_000 });
});

test('split: multiple typed ranges default to one file per range (zip)', async ({ page }) => {
  await page.goto('/split-pdf');
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/big.pdf');
  await page.getByRole('tab', { name: 'Type ranges' }).click();
  await page.getByTestId('range-input').fill('2-3, 5');
  await page.getByTestId('run-tool').click();
  await expect(page.getByTestId('download-result')).toBeVisible({ timeout: 90_000 });
  const download = await runAndDownload(page);
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
});

test('split: merge toggle combines typed ranges into ONE pdf', async ({ page }) => {
  await page.goto('/split-pdf');
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/big.pdf');
  await page.getByRole('tab', { name: 'Type ranges' }).click();
  await page.getByTestId('range-input').fill('2-3, 5');
  await page.getByTestId('merge-toggle').click();
  await page.getByTestId('run-tool').click();
  await expect(page.getByTestId('download-result')).toBeVisible({ timeout: 90_000 });
  const download = await runAndDownload(page);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const bytes = new Uint8Array(await downloadBytes(download));
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
});

test('watermark: unsupported characters are rejected with a clear message', async ({ page }) => {
  await page.goto('/watermark-pdf');
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/a.pdf');
  await page.getByTestId('wm-text').fill('机密');
  await page.getByTestId('run-tool').click();
  // Regression: the engine silently drops undrawable characters, producing a
  // "successful" download with no watermark — the UI must reject the text instead.
  await expect(page.getByRole('alert')).toContainText(/can't draw/i, { timeout: 30_000 });
  await expect(page.getByTestId('download-result')).not.toBeVisible();
});

test('signatures: unsigned pdf reports no signatures', async ({ page }) => {
  await page.goto('/validate-pdf-signature');
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/a.pdf');
  await expect(page.getByTestId('sig-report')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('sig-report')).toContainText(/no digital signatures/i);
});

test('protect then unlock round-trips', async ({ page }) => {
  await page.goto('/protect-pdf');
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/a.pdf');
  await page.getByTestId('password-input').fill('e2e-secret');
  await page.getByTestId('password-confirm').fill('e2e-secret');
  await page.getByTestId('run-tool').click();
  await expect(page.getByTestId('download-result')).toBeVisible({ timeout: 90_000 });
  const protectedDownload = await runAndDownload(page);
  // Playwright's download.path() points at a temp file with no .pdf extension, which
  // FileDropzone's isPdf() (name/type sniff) correctly rejects — save it under a real
  // .pdf name so it round-trips through the unlock tool's own file input.
  const protectedPath = 'e2e/.fixtures/protected.pdf';
  await protectedDownload.saveAs(protectedPath);
  // Encrypted output must refuse a normal (passwordless) load.
  await expect(PDFDocument.load(await readFile(protectedPath))).rejects.toThrow();

  await page.goto('/unlock-pdf');
  await page.getByTestId('file-input').setInputFiles(protectedPath);
  await page.getByTestId('password-input').fill('e2e-secret');
  await page.getByTestId('run-tool').click();
  await expect(page.getByTestId('download-result')).toBeVisible({ timeout: 90_000 });
  const bytes = await downloadBytes(await runAndDownload(page));
  expect((await PDFDocument.load(new Uint8Array(bytes))).getPageCount()).toBe(2); // loads without password again
});

test('rotate: manual tap rotates one page 90°', async ({ page }) => {
  await page.goto('/rotate-pdf');
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/a.pdf');
  await expect(page.getByTestId('rotate-thumb-0')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('rotate-thumb-0').click();
  await page.getByTestId('run-tool').click();
  await expect(page.getByTestId('download-result')).toBeVisible({ timeout: 60_000 });
  const bytes = await downloadBytes(await runAndDownload(page));
  const doc = await PDFDocument.load(new Uint8Array(bytes));
  expect(doc.getPage(0).getRotation().angle).toBe(90);
  expect(doc.getPage(1).getRotation().angle).toBe(0); // untouched
});

test('rotate: sideways page is auto-detected and corrected to upright', async ({ page }) => {
  await page.goto('/rotate-pdf');
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/rotated.pdf');
  // First run downloads the 7MB model into the worker — give it time.
  await expect(page.getByTestId('auto-badge-1')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('auto-badge-0')).not.toBeVisible(); // upright page left alone
  await page.getByTestId('run-tool').click();
  await expect(page.getByTestId('download-result')).toBeVisible({ timeout: 60_000 });
  const bytes = await downloadBytes(await runAndDownload(page));
  const doc = await PDFDocument.load(new Uint8Array(bytes));
  // The fixture's /Rotate 90 plus the suggested correction must land upright.
  expect(doc.getPage(1).getRotation().angle).toBe(0);
  expect(doc.getPage(0).getRotation().angle).toBe(0);
});

test('rotate: detection finishing with no rotated pages reports upright', async ({ page }) => {
  await page.goto('/rotate-pdf');
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/a.pdf');
  await expect(page.getByTestId('detect-status')).toContainText(/look upright|unavailable/i, { timeout: 120_000 });
  // Whichever way detection resolves, the CTA must stay disabled with no deltas.
  await expect(page.getByTestId('run-tool')).toBeDisabled();
});

test('rotate: starting over mid-detection does not leak stale auto-fixes into the new file', async ({ page }) => {
  await page.goto('/rotate-pdf');
  // big.pdf (40 pages) keeps detection running long enough to click "Start over" mid-flight.
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/big.pdf');
  // Thumbnail + detect-input rendering for all 40 pages happens before detect() starts,
  // so give that its own generous budget before the progress note is expected to appear.
  await expect(page.getByTestId('detect-status')).toContainText(/Checking page orientation/, { timeout: 60_000 });
  await page.getByTestId('clear-file').click();
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/rotated.pdf');
  // First run downloads the 7MB model into the worker — give it time.
  await expect(page.getByTestId('auto-badge-1')).toBeVisible({ timeout: 120_000 });
  // Regression: a still-running detect() for the discarded 40-page file used to keep
  // writing into this file's state — asserting exactly one badge (rotated.pdf's own
  // page 2) rules out any leftover auto-fixes from the aborted 40-page run.
  await expect(page.getByTestId(/auto-badge-/)).toHaveCount(1);
  await expect(page.getByTestId('auto-badge-0')).not.toBeVisible();
  await expect(page.getByTestId('detect-status')).toContainText(/1 page/);
});

test('rotate: fully unavailable detector on a small doc shows the degraded notice, not false success', async ({ page }) => {
  // Force every detection call to fail by blocking the orientation model fetch —
  // simulates total model failure on a 2-page document (a.pdf), which can never
  // reach the 3-strikes early-bail threshold.
  await page.route('**/models/doc-ori.onnx', (route) => route.abort());
  await page.goto('/rotate-pdf');
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/a.pdf');
  // Regression: without the fix this settles on "All pages look upright" instead.
  await expect(page.getByTestId('detect-status')).toContainText(/unavailable/i, { timeout: 120_000 });
  await expect(page.getByTestId('detect-status')).not.toContainText(/look upright/i);
  await expect(page.getByTestId('run-tool')).toBeDisabled();
});
