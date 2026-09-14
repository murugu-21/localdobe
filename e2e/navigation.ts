import type { Page } from '@playwright/test';

/**
 * Navigates to `path` and waits for every island on the page to finish hydrating.
 *
 * Tool islands hydrate on `client:idle` (after the `load` event via
 * `requestIdleCallback`), so interaction helpers like `setInputFiles` can otherwise
 * fire before React attaches its handlers and the event is silently lost. Astro's
 * runtime removes the `ssr` attribute from `<astro-island>` once hydration
 * completes, which is the readiness signal used here. Pages without islands
 * resolve immediately.
 */
export async function gotoHydrated(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => !document.querySelector('astro-island[ssr]'));
}
