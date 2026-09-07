import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end proof that the funnel actually reaches both sinks in a real browser.
 *
 * PostHog is asserted through its own snippet rather than a stub: before `array.js`
 * loads, `window.posthog` IS the queue array the snippet builds, and `capture(name,
 * props)` pushes `['capture', name, props]` onto it. Blocking the PostHog host below
 * keeps that stub in place for the whole test — and guarantees the suite never sends
 * real events to the production project.
 *
 * Clarity emits no snippet locally (PUBLIC_CLARITY_PROJECT_ID is unset in dev), and
 * its snippet is written `w.clarity = w.clarity || ...`, so the recorder installed in
 * `addInitScript` survives either way.
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
  await page.addInitScript(() => {
    const calls: unknown[][] = [];
    (window as unknown as { __clarity: unknown[][] }).__clarity = calls;
    window.clarity = (...args: unknown[]) => { calls.push(args); };
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

async function clarityCalls(page: Page): Promise<unknown[][]> {
  return page.evaluate(() => (window as unknown as { __clarity: unknown[][] }).__clarity ?? []);
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

test('the same funnel reaches Clarity, with numbers bucketed into string tags', async ({ page }) => {
  await setUpSinks(page);
  await page.goto('/merge-pdf');
  await page.getByTestId('file-input').setInputFiles(['e2e/.fixtures/a.pdf', 'e2e/.fixtures/b.pdf']);
  await page.getByTestId('run-tool').click();
  await expect(page.getByTestId('download-result')).toBeVisible();

  const calls = await clarityCalls(page);
  const events = calls.filter((c) => c[0] === 'event').map((c) => String(c[1]));
  expect(events).toContain('tool_viewed');
  expect(events).toContain('file_selected');
  expect(events).toContain('pdfs_merged');

  const tags = Object.fromEntries(
    calls.filter((c) => c[0] === 'set').map((c) => [String(c[1]), String(c[2])]),
  );
  expect(tags.tool).toBe('merge-pdf');
  // Clarity stores strings only — a raw byte count would be a useless filter value.
  expect(tags.output_bytes).toMatch(/^(<100kb|100kb-1mb|1-5mb|5-10mb|10-50mb|50mb\+)$/);
  expect(tags.source_file_count).toBe('2-5');
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
  const clarity = await clarityCalls(page);
  // Guard against passing vacuously: this assertion is only meaningful if events
  // actually fired, so prove the funnel ran before asserting what it did not contain.
  expect(eventNames(posthog)).toContain('images_converted_to_pdf');
  expect(clarity.length).toBeGreaterThan(0);

  const serialized = JSON.stringify(posthog) + JSON.stringify(clarity);
  for (const name of ['photo.jpg', 'shot.png', 'photo', 'shot']) {
    expect(serialized).not.toContain(name);
  }
});
