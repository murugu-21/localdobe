import { sanitizeMessage, toolFromPath, track } from '../src/lib/analytics';

interface FakeWindow {
  location: { pathname: string };
  posthog?: { capture: (event: string, props?: Record<string, unknown>) => void };
}

const g = globalThis as unknown as { window?: FakeWindow };

/** Installs a fake `window` with a recording sink; returns what the sink saw. */
function installWindow(pathname = '/compress-pdf/', opts: { posthog?: boolean } = {}) {
  const { posthog = true } = opts;
  const captured: { event: string; props?: Record<string, unknown> }[] = [];
  const win: FakeWindow = { location: { pathname } };
  if (posthog) win.posthog = { capture: (event, props) => { captured.push({ event, props }); } };
  g.window = win;
  return { captured };
}

afterEach(() => { delete g.window; });

test('toolFromPath recognizes tool pages with or without a trailing slash', () => {
  expect(toolFromPath('/compress-pdf/')).toBe('compress-pdf');
  expect(toolFromPath('/compress-pdf')).toBe('compress-pdf');
  // The two image directions share a component but must stay distinguishable.
  expect(toolFromPath('/jpg-to-pdf/')).toBe('jpg-to-pdf');
  expect(toolFromPath('/png-to-pdf/')).toBe('png-to-pdf');
  // As do the two pages SplitTool serves.
  expect(toolFromPath('/split-pdf/')).toBe('split-pdf');
  expect(toolFromPath('/extract-pdf-pages/')).toBe('extract-pdf-pages');
});

test('toolFromPath returns undefined for non-tool pages', () => {
  expect(toolFromPath('/')).toBeUndefined();
  expect(toolFromPath('/blog/some-post/')).toBeUndefined();
  expect(toolFromPath('/about/')).toBeUndefined();
  // Never let an arbitrary path become an unbounded event property.
  expect(toolFromPath('/../compress-pdf/')).toBeUndefined();
});

test('sanitizeMessage strips file names so error text can never leak one', () => {
  expect(sanitizeMessage('tax-return-2025.pdf: could not be parsed')).toBe('<file>: could not be parsed');
  expect(sanitizeMessage('failed on IMG_4821.JPG')).toBe('failed on <file>');
  expect(sanitizeMessage('/Users/jane/Desktop/scan.png is invalid')).toBe('<file> is invalid');
});

test('sanitizeMessage collapses whitespace and truncates long text', () => {
  expect(sanitizeMessage('  too   many\n\nspaces ')).toBe('too many spaces');
  const long = 'e'.repeat(200);
  expect(sanitizeMessage(long).length).toBe(120);
});

test('track sends the event to PostHog with the tool derived from the path', () => {
  const { captured } = installWindow('/compress-pdf/');
  track('tool_run_started', { compression_preset: 'medium' });
  expect(captured).toHaveLength(1);
  expect(captured[0].event).toBe('tool_run_started');
  expect(captured[0].props).toMatchObject({ tool: 'compress-pdf', compression_preset: 'medium' });
});

test('track passes numeric properties through untouched', () => {
  const { captured } = installWindow('/merge-pdf/');
  track('pdfs_merged', { source_file_count: 12, output_bytes: 3 * 1024 * 1024, duration_ms: 3_000 });

  // PostHog stores numbers as numbers, so funnels can average and compare them.
  expect(captured[0].props).toMatchObject({
    tool: 'merge-pdf',
    source_file_count: 12,
    output_bytes: 3 * 1024 * 1024,
    duration_ms: 3_000,
  });
});

test('track sanitizes a message property', () => {
  const { captured } = installWindow('/unlock-pdf/');
  track('tool_failed', { message: 'payslip-june.pdf: wrong password' });
  expect(captured[0].props).toMatchObject({ message: '<file>: wrong password' });
});

test('track omits tool on non-tool pages rather than inventing one', () => {
  const { captured } = installWindow('/');
  track('sponsor_clicked', { location: 'sidebar' });
  expect(captured[0].props).not.toHaveProperty('tool');
  expect(captured[0].props).toMatchObject({ location: 'sidebar' });
});

test('track is silent when there is no window and when the sink is missing', () => {
  delete g.window;
  expect(() => track('tool_viewed')).not.toThrow();

  installWindow('/rotate-pdf/', { posthog: false });
  expect(() => track('tool_viewed')).not.toThrow();
});

test('a throwing sink never breaks the caller', () => {
  installWindow('/split-pdf/');
  g.window!.posthog = { capture: () => { throw new Error('blocked by extension'); } };
  expect(() => track('pdf_pages_split', { split_mode: 'ranges' })).not.toThrow();
});

test('track drops null and undefined props instead of sending them', () => {
  const { captured } = installWindow('/watermark-pdf/');
  track('tool_option_changed', { option: 'opacity', value: undefined, other: null });
  expect(captured[0].props).toMatchObject({ option: 'opacity' });
  expect(captured[0].props).not.toHaveProperty('value');
  expect(captured[0].props).not.toHaveProperty('other');
});
