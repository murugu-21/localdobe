import { test, expect, type Download, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile, stat } from 'node:fs/promises';

async function downloadBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  return readFile(path!);
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
});

test('watermark: add text watermark produces valid pdf with same page count', async ({ page }) => {
  await page.goto('/watermark-pdf');
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/a.pdf');
  await page.getByTestId('wm-text').fill('E2E DRAFT');
  await page.getByTestId('run-tool').click();
  await expect(page.getByTestId('download-result')).toBeVisible({ timeout: 90_000 });
  const bytes = await downloadBytes(await runAndDownload(page));
  expect((await PDFDocument.load(new Uint8Array(bytes))).getPageCount()).toBe(2);
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
