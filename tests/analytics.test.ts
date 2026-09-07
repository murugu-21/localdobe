import {
  bucketBytes,
  bucketCount,
  bucketMs,
  sanitizeMessage,
  toolFromPath,
  track,
} from '../src/lib/analytics';

interface FakeWindow {
  location: { pathname: string };
  posthog?: { capture: (event: string, props?: Record<string, unknown>) => void };
  clarity?: (...args: unknown[]) => void;
}

const g = globalThis as unknown as { window?: FakeWindow };

/** Installs a fake `window` with recording sinks; returns what each sink saw. */
function installWindow(pathname = '/compress-pdf/', opts: { posthog?: boolean; clarity?: boolean } = {}) {
  const { posthog = true, clarity = true } = opts;
  const captured: { event: string; props?: Record<string, unknown> }[] = [];
  const clarityCalls: unknown[][] = [];
  const win: FakeWindow = { location: { pathname } };
  if (posthog) win.posthog = { capture: (event, props) => { captured.push({ event, props }); } };
  if (clarity) win.clarity = (...args) => { clarityCalls.push(args); };
  g.window = win;
  return { captured, clarityCalls };
}

/** The `clarity('set', k, v)` tags from a recorded call list, as a plain object. */
function tagsOf(calls: unknown[][]): Record<string, string> {
  return Object.fromEntries(
    calls.filter((c) => c[0] === 'set').map((c) => [String(c[1]), String(c[2])]),
  );
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

test('bucketBytes keeps size buckets low-cardinality', () => {
  expect(bucketBytes(0)).toBe('<100kb');
  expect(bucketBytes(99_000)).toBe('<100kb');
  expect(bucketBytes(500_000)).toBe('100kb-1mb');
  expect(bucketBytes(3 * 1024 * 1024)).toBe('1-5mb');
  expect(bucketBytes(8 * 1024 * 1024)).toBe('5-10mb');
  expect(bucketBytes(30 * 1024 * 1024)).toBe('10-50mb');
  expect(bucketBytes(200 * 1024 * 1024)).toBe('50mb+');
});

test('bucketCount buckets item counts', () => {
  expect(bucketCount(0)).toBe('0');
  expect(bucketCount(1)).toBe('1');
  expect(bucketCount(4)).toBe('2-5');
  expect(bucketCount(12)).toBe('6-20');
  expect(bucketCount(60)).toBe('21-100');
  expect(bucketCount(500)).toBe('100+');
});

test('bucketMs buckets durations', () => {
  expect(bucketMs(400)).toBe('<1s');
  expect(bucketMs(3_000)).toBe('1-5s');
  expect(bucketMs(9_000)).toBe('5-15s');
  expect(bucketMs(40_000)).toBe('15-60s');
  expect(bucketMs(120_000)).toBe('60s+');
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

test('track keeps raw numbers for PostHog but sends bucketed strings to Clarity', () => {
  const { captured, clarityCalls } = installWindow('/merge-pdf/');
  track('pdfs_merged', { source_file_count: 12, output_bytes: 3 * 1024 * 1024, duration_ms: 3_000 });

  // PostHog gets the real numbers, so funnels can average and compare them.
  expect(captured[0].props).toMatchObject({
    source_file_count: 12,
    output_bytes: 3 * 1024 * 1024,
    duration_ms: 3_000,
  });

  // Clarity only accepts string tags, so numbers arrive bucketed.
  expect(clarityCalls[0]).toEqual(['event', 'pdfs_merged']);
  expect(tagsOf(clarityCalls)).toMatchObject({
    tool: 'merge-pdf',
    source_file_count: '6-20',
    output_bytes: '1-5mb',
    duration_ms: '1-5s',
  });
});

test('track sanitizes a message property on both sinks', () => {
  const { captured, clarityCalls } = installWindow('/unlock-pdf/');
  track('tool_failed', { message: 'payslip-june.pdf: wrong password' });
  expect(captured[0].props).toMatchObject({ message: '<file>: wrong password' });
  expect(tagsOf(clarityCalls).message).toBe('<file>: wrong password');
});

test('track omits tool on non-tool pages rather than inventing one', () => {
  const { captured, clarityCalls } = installWindow('/');
  track('sponsor_clicked', { location: 'sidebar' });
  expect(captured[0].props).not.toHaveProperty('tool');
  expect(tagsOf(clarityCalls)).not.toHaveProperty('tool');
  expect(captured[0].props).toMatchObject({ location: 'sidebar' });
});

test('track reaches the sink that is present when the other is blocked', () => {
  const only = installWindow('/rotate-pdf/', { clarity: false });
  track('tool_viewed');
  expect(only.captured).toHaveLength(1);

  const other = installWindow('/rotate-pdf/', { posthog: false });
  track('tool_viewed');
  expect(other.clarityCalls[0]).toEqual(['event', 'tool_viewed']);
});

test('track is silent when there is no window and when both sinks are missing', () => {
  delete g.window;
  expect(() => track('tool_viewed')).not.toThrow();

  installWindow('/rotate-pdf/', { posthog: false, clarity: false });
  expect(() => track('tool_viewed')).not.toThrow();
});

test('a throwing sink never breaks the caller, and the other sink still fires', () => {
  const { clarityCalls } = installWindow('/split-pdf/');
  g.window!.posthog = { capture: () => { throw new Error('blocked by extension'); } };
  expect(() => track('pdf_pages_split', { split_mode: 'ranges' })).not.toThrow();
  expect(clarityCalls[0]).toEqual(['event', 'pdf_pages_split']);
});

test('track drops null and undefined props instead of tagging them', () => {
  const { captured, clarityCalls } = installWindow('/watermark-pdf/');
  track('tool_option_changed', { option: 'opacity', value: undefined, other: null });
  expect(captured[0].props).toMatchObject({ option: 'opacity' });
  expect(captured[0].props).not.toHaveProperty('value');
  expect(tagsOf(clarityCalls)).not.toHaveProperty('other');
});
