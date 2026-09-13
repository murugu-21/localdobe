import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end proof that the funnel actually reaches PostHog in a real browser.
 *
 * PostHog is asserted through its own snippet rather than a stub: before `array.js`
 * loads, `window.posthog` IS the queue array the snippet builds, and `capture(name,
 * props)` pushes `['capture', name, props]` onto it. Blocking the PostHog host below
 * keeps that stub in place for the whole test — and guarantees the suite never sends
 * real events to the production project.
 */

interface PostHogCall { event: string; props: Record<string, unknown> }

async function setUpSinks(page: Page) {
  // Block every off-origin request for the duration of the test. The point is the
  // PostHog snippet: leaving `array.js` reachable would both replace the queue this
  // suite reads AND send real events into the production project. Matching on "not
  // localhost" rather than on PostHog's hostname keeps that guarantee when
  // PUBLIC_POSTHOG_HOST changes (e.g. to a reverse-proxy subdomain of localdobe.com).
  await page.route('**/*', (route) => {
    const { hostname } = new URL(route.request().url());
    return hostname === 'localhost' || hostname === '127.0.0.1'
      ? route.continue()
      : route.abort();
  });
}

/** Every `capture()` the PostHog snippet queued, in order. */
async function posthogCalls(page: Page): Promise<PostHogCall[]> {
  return page.evaluate(() => {
    const queue = window.posthog as unknown as unknown[][] | undefined;
    if (!Array.isArray(queue)) return [];
    return queue
      .filter((entry) => entry[0] === 'capture')
      .map((entry) => ({ event: String(entry[1]), props: (entry[2] ?? {}) as Record<string, unknown> }));
  });
}

function eventNames(calls: PostHogCall[]): string[] {
  return calls.map((c) => c.event);
}

test('merge funnel reaches PostHog in order, from page view to download', async ({ page }) => {
  await setUpSinks(page);
  await page.goto('/merge-pdf');

  // The view fires from ToolPageShell on load, before any interaction.
  await expect.poll(async () => eventNames(await posthogCalls(page))).toContain('tool_viewed');

  await page.getByTestId('file-input').setInputFiles(['e2e/.fixtures/a.pdf', 'e2e/.fixtures/b.pdf']);
  await page.getByTestId('run-tool').click();
  await expect(page.getByTestId('download-result')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('download-result').click();
  await downloadPromise;

  const calls = await posthogCalls(page);
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
  await page.goto('/jpg-to-pdf');
  // The image dropzone rejects PDFs, which is the drop-off worth seeing.
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/a.pdf');

  await expect.poll(async () => eventNames(await posthogCalls(page))).toContain('file_rejected');
  const rejected = (await posthogCalls(page)).find((c) => c.event === 'file_rejected')!;
  expect(rejected.props).toMatchObject({ tool: 'jpg-to-pdf', reason: 'wrong_type' });
  expect(eventNames(await posthogCalls(page))).not.toContain('file_selected');
});

test('an engine failure is recorded with a message that carries no file name', async ({ page }) => {
  await setUpSinks(page);
  await page.goto('/unlock-pdf');
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/a.pdf');
  // a.pdf is not encrypted, so decryption fails — a real error path, not a stub.
  await page.getByTestId('password-input').fill('not-the-password');
  await page.getByTestId('run-tool').click();
  await expect(page.getByRole('alert')).toBeVisible();

  const failed = (await posthogCalls(page)).find((c) => c.event === 'tool_failed')!;
  expect(failed.props.tool).toBe('unlock-pdf');
  expect(failed.props.has_password).toBe(true);
  expect(String(failed.props.message)).not.toContain('a.pdf');
});

test('nav clicks record the destination tool and the surface they came from', async ({ page }) => {
  await setUpSinks(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  // Suppress the navigation itself: the events are queued on the page that is about to
  // be unloaded, so letting the browser follow the link would discard them before they
  // could be read. A capture-phase preventDefault still lets the delegated listener
  // (which is on document, in the bubble phase) run exactly as it does in production.
  await page.evaluate(() => {
    document.addEventListener('click', (e) => e.preventDefault(), true);
  });

  await page.locator('aside').getByRole('link', { name: 'Compress PDF' }).click();
  await page.locator('footer').getByRole('link', { name: /sponsor localdobe/i }).click();

  const calls = await posthogCalls(page);
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
  await page.goto('/jpg-to-pdf');
  await page.getByTestId('file-input').setInputFiles(['e2e/.fixtures/photo.jpg', 'e2e/.fixtures/shot.png']);
  await page.getByTestId('run-tool').click();
  await expect(page.getByTestId('download-result')).toBeVisible();

  const posthog = await posthogCalls(page);
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
  await page.goto('/compress-pdf');
  await page.getByTestId('file-input').setInputFiles('e2e/.fixtures/a.pdf');

  await expect(page.getByRole('alert')).toContainText(/could not read that file/i);
  await expect.poll(async () => eventNames(await posthogCalls(page))).toContain('tool_failed');
  const failed = (await posthogCalls(page)).find((c) => c.event === 'tool_failed')!;
  expect(failed.props).toMatchObject({ tool: 'compress-pdf', reason: 'read_failed' });
  expect(pageErrors).toEqual([]);
});
