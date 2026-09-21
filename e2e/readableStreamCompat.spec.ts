import { test, expect } from '@playwright/test';
import { gotoHydrated } from './navigation';

/** Safari/WebKit < 26.4 has no ReadableStream async iterator, and pdf.js's
 *  `getTextContent()` (used by the edit tool's page overlays) consumes its stream
 *  with `for await`. This simulates that browser and proves our shim — not just
 *  Chromium's built-in — makes the overlays load. */
test('edit: text overlays load when ReadableStream has no async iterator', async ({ page }) => {
  await page.addInitScript(() => {
    delete (ReadableStream.prototype as any)[Symbol.asyncIterator];
  });
  await gotoHydrated(page, '/edit-pdf');
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/edit.pdf');
  await expect(page.locator('span[contenteditable]').first()).toHaveText('Hello World from localdobe');
  // The app must have installed its own iterator after the init script removed it.
  expect(await page.evaluate(() => typeof (ReadableStream.prototype as any)[Symbol.asyncIterator])).toBe('function');
});
