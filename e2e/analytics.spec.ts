import { test, expect, type Page } from '@playwright/test';
import { gotoHydrated } from './navigation';

/**
 * End-to-end proof that the funnel reaches PostHog in a real browser.
 *
 * The SDK is the npm posthog-js build, dynamic-imported on the visitor's first
 * interaction (see src/lib/analytics.ts), so there is no snippet queue to read
 * anymore. Instead an init script wraps the SDK instance the moment
 * initAnalytics assigns it to `window.posthog` — assignment happens before the
 * buffered calls are replayed, so this sees both replayed and live captures.
 * Off-origin requests stay blocked for the whole run, which keeps the SDK's own
 * config/flags/event requests from reaching the production project while still
 * letting the same-origin SDK chunk load.
 */

interface PostHogCall { event: string; props: Record<string, unknown> }

declare global {
  interface Window {
    __phCalls?: PostHogCall[];
  }
}

async function setUpSinks(page: Page) {
  await page.addInitScript(() => {
    let value: unknown;
    Object.defineProperty(window, 'posthog', {
      configurable: true,
      get: () => value,
      set: (ph: { capture: (event: string, props?: Record<string, unknown>) => void }) => {
        value = ph;
        const original = ph.capture.bind(ph);
        window.__phCalls = [];
        ph.capture = (event, props) => {
          window.__phCalls!.push({ event, props: props ?? {} });
          return original(event, props);
        };
      },
    });
  });
  // Block every off-origin request for the duration of the test. Matching on
  // "not localhost" rather than on PostHog's hostname keeps that guarantee when
  // PUBLIC_POSTHOG_HOST changes (e.g. to a reverse-proxy subdomain of
  // localdobe.com).
  await page.route('**/*', (route) => {
    const { hostname } = new URL(route.request().url());
    return hostname === 'localhost' || hostname === '127.0.0.1'
      ? route.continue()
      : route.abort();
  });
}

/** Every capture the wrapped SDK has seen, in order. */
async function posthogCalls(page: Page): Promise<PostHogCall[]> {
  return page.evaluate(() => window.__phCalls ?? []);
}

/** App events only — the SDK adds its own `$pageview`/`$autocapture` traffic. */
async function appCalls(page: Page): Promise<PostHogCall[]> {
  return (await posthogCalls(page)).filter((call) => !call.event.startsWith('$'));
}

/** First user input; boots the SDK and flushes anything buffered before it. */
async function startAnalytics(page: Page) {
  await page.mouse.move(5, 5);
  await expect.poll(() => page.evaluate(() => !!window.posthog)).toBe(true);
}

function eventNames(calls: PostHogCall[]): string[] {
  return calls.map((c) => c.event);
}

test('the SDK stays out of the initial load and boots on the first input', async ({ page }) => {
  await setUpSinks(page);
  await gotoHydrated(page, '/merge-pdf');

  // Well inside the 10s fallback, with no interaction: nothing should have loaded.
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => !!window.posthog)).toBe(false);
  expect(await posthogCalls(page)).toEqual([]);

  await startAnalytics(page);
});

test('merge funnel reaches PostHog in order, from page view to download', async ({ page }) => {
  await setUpSinks(page);
  await gotoHydrated(page, '/merge-pdf');

  // No interaction yet, so tool_viewed must be buffered until the click below
  // boots the SDK — the point of the whole deferral.
  await page.getByTestId('file-input').setInputFiles(['e2e/.fixtures/a.pdf', 'e2e/.fixtures/b.pdf']);
  await page.getByTestId('run-tool').click();
  await expect(page.getByTestId('download-result')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('download-result').click();
  await downloadPromise;

  const calls = await appCalls(page);
  expect(eventNames(calls)).toEqual([
    'tool_viewed',
    'file_selected',
    'tool_run_started',
    'pdfs_merged',
    'result_downloaded',
  ]);

  // Every event carries the tool derived from the URL, so they can be grouped
  // regardless of the inconsistent legacy success-event names.
  for (const call of calls) expect(call.props.tool).toBe('merge-pdf');

  const selected = calls.find((c) => c.event === 'file_selected')!;
  expect(selected.props.file_count).toBe(2);
  expect(selected.props.total_bytes).toBeGreaterThan(0);

  const merged = calls.find((c) => c.event === 'pdfs_merged')!;
  expect(merged.props.source_file_count).toBe(2);
  expect(merged.props.output_bytes).toBeGreaterThan(0);
  expect(merged.props.duration_ms).toBeGreaterThanOrEqual(0);

  const downloaded = calls.find((c) => c.event === 'result_downloaded')!;
  expect(downloaded.props.output_type).toBe('pdf');
});

test('a rejected file is recorded instead of vanishing', async ({ page }) => {
  await setUpSinks(page);
  await gotoHydrated(page, '/jpg-to-pdf');
  // The image dropzone rejects PDFs, which is the drop-off worth seeing.
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/a.pdf');
  await startAnalytics(page);

  await expect.poll(async () => eventNames(await appCalls(page))).toContain('file_rejected');
  const rejected = (await appCalls(page)).find((c) => c.event === 'file_rejected')!;
  expect(rejected.props).toMatchObject({ tool: 'jpg-to-pdf', reason: 'wrong_type' });
  expect(eventNames(await appCalls(page))).not.toContain('file_selected');
});

test('an engine failure is recorded with a message that carries no file name', async ({ page }) => {
  await setUpSinks(page);
  await gotoHydrated(page, '/unlock-pdf');
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/a.pdf');
  // a.pdf is not encrypted, so decryption fails — a real error path, not a stub.
  await page.getByTestId('password-input').fill('not-the-password');
  await page.getByTestId('run-tool').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await startAnalytics(page);

  await expect.poll(async () => eventNames(await appCalls(page))).toContain('tool_failed');
  const failed = (await appCalls(page)).find((c) => c.event === 'tool_failed')!;
  expect(failed.props.tool).toBe('unlock-pdf');
  expect(failed.props.has_password).toBe(true);
  expect(String(failed.props.message)).not.toContain('a.pdf');
});

test('nav clicks record the destination tool and the surface they came from', async ({ page }) => {
  await setUpSinks(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoHydrated(page, '/');

  // Suppress the navigation itself: the events are captured on the page that is
  // about to be unloaded. A capture-phase preventDefault still lets the
  // delegated listener (which is on document, in the bubble phase) run exactly
  // as it does in production.
  await page.evaluate(() => {
    document.addEventListener('click', (e) => e.preventDefault(), true);
  });

  await page.locator('aside').getByRole('link', { name: 'Compress PDF' }).click();
  await page.locator('footer').getByRole('link', { name: /sponsor localdobe/i }).click();
  await startAnalytics(page);

  const calls = await appCalls(page);
  const nav = calls.find((c) => c.event === 'nav_tool_clicked')!;
  // The click happened on '/', which is not a tool page, so the event names its
  // destination rather than carrying a `tool` of its own.
  expect(nav.props).toMatchObject({ target_tool: 'compress-pdf', location: 'sidebar' });
  expect(nav.props.tool).toBeUndefined();

  const sponsor = calls.find((c) => c.event === 'sponsor_clicked')!;
  expect(sponsor.props).toMatchObject({ location: 'footer' });
});

test('no event ever carries a file name', async ({ page }) => {
  await setUpSinks(page);
  await gotoHydrated(page, '/jpg-to-pdf');
  await page.getByTestId('file-input').setInputFiles(['e2e/.fixtures/photo.jpg', 'e2e/.fixtures/shot.png']);
  await page.getByTestId('run-tool').click();
  await expect(page.getByTestId('download-result')).toBeVisible();
  await startAnalytics(page);

  const posthog = await appCalls(page);
  // Guard against passing vacuously: this assertion is only meaningful if events
  // actually fired, so prove the funnel ran before asserting what it did not contain.
  expect(eventNames(posthog)).toContain('images_converted_to_pdf');

  const serialized = JSON.stringify(posthog);
  for (const name of ['photo.jpg', 'shot.png', 'photo', 'shot']) {
    expect(serialized).not.toContain(name);
  }
});

test('an unreadable file is a handled failure, not an unhandled rejection', async ({ page }) => {
  await setUpSinks(page);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  // Reproduce a browser losing access to the selected file (cloud placeholder,
  // moved/deleted file, expired picker grant) — the DOMException that used to
  // escape `onFile` as an unhandled rejection and land in error tracking.
  await page.addInitScript(() => {
    File.prototype.arrayBuffer = () =>
      Promise.reject(new DOMException('The requested file could not be read', 'NotReadableError'));
  });
  await gotoHydrated(page, '/compress-pdf');
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/a.pdf');
  await startAnalytics(page);

  await expect(page.getByRole('alert')).toContainText(/could not read that file/i);
  await expect.poll(async () => eventNames(await appCalls(page))).toContain('tool_failed');
  const failed = (await appCalls(page)).find((c) => c.event === 'tool_failed')!;
  expect(failed.props).toMatchObject({ tool: 'compress-pdf', reason: 'read_failed' });
  expect(pageErrors).toEqual([]);
});
