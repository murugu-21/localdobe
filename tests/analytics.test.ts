import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportError, sanitizeMessage, scheduleSdkLoad, toolFromPath, track } from '../src/lib/analytics';

interface FakeSink {
  capture: (event: string, props?: Record<string, unknown>) => void;
  register?: (props: Record<string, unknown>) => void;
  captureException?: (error: unknown, props?: Record<string, unknown>) => void;
}

interface FakeWindow {
  location: { pathname: string };
  posthog?: FakeSink;
  addEventListener?: (type: string, cb: () => void) => void;
}

const g = globalThis as unknown as {
  window?: FakeWindow;
  posthog?: FakeSink;
};

/**
 * Installs a fake `window` with a recording sink; returns what the sink saw.
 *
 * The sink goes on `globalThis.posthog` as well as the fake window: the module
 * prefers its own initialised SDK, then falls back to the global the snippet /
 * toolbar would leave behind (see `client()` in src/lib/analytics.ts).
 */
function installWindow(pathname = '/compress-pdf/', opts: { posthog?: boolean } = {}) {
  const { posthog = true } = opts;
  const captured: { event: string; props?: Record<string, unknown> }[] = [];
  const win: FakeWindow = { location: { pathname } };
  if (posthog) {
    win.posthog = {
      capture: (event, props) => { captured.push({ event, props }); },
      // client() requires both capture and register, so a half-initialised
      // global is ignored (matching the reference implementation).
      register: () => {},
    };
    g.posthog = win.posthog;
  }
  g.window = win;
  return { captured };
}

afterEach(() => {
  delete g.window;
  delete g.posthog;
  vi.useRealTimers();
});

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
  g.posthog = {
    capture: () => { throw new Error('blocked by extension'); },
    register: () => {},
  };
  g.window!.posthog = g.posthog;
  expect(() => track('pdf_pages_split', { split_mode: 'ranges' })).not.toThrow();
});

test('track drops null and undefined props instead of sending them', () => {
  const { captured } = installWindow('/watermark-pdf/');
  track('tool_option_changed', { option: 'opacity', value: undefined, other: null });
  expect(captured[0].props).toMatchObject({ option: 'opacity' });
  expect(captured[0].props).not.toHaveProperty('value');
  expect(captured[0].props).not.toHaveProperty('other');
});

/** A fresh module instance, so one test's booted SDK cannot leak into another. */
async function freshAnalytics() {
  vi.resetModules();
  return import('../src/lib/analytics');
}

function fakeSdk(calls: Array<[string, unknown]>) {
  return {
    capture: (event: string, props?: Record<string, unknown>) => { calls.push([event, props]); },
    captureException: (error: unknown, props?: Record<string, unknown>) => { calls.push(['$exception', { error, props }]); },
    register: () => {},
    init: () => {},
    startSessionRecording: () => {},
  };
}

test('buffers events until the SDK loads, then replays them in order', async () => {
  installWindow('/merge-pdf/', { posthog: false });
  const analytics = await freshAnalytics();
  const calls: Array<[string, unknown]> = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });

  const booting = analytics.initAnalytics('token', 'https://e.example', async () => {
    await gate;
    return fakeSdk(calls);
  });
  // Nothing to send to yet — these must be held, not dropped.
  analytics.track('tool_viewed');
  analytics.track('file_selected', { file_count: 2 });
  expect(calls).toHaveLength(0);

  release();
  await booting;
  expect(calls.map(([event]) => event)).toEqual(['tool_viewed', 'file_selected']);
  expect(calls[1][1]).toMatchObject({ tool: 'merge-pdf', file_count: 2 });
});

test('a blocked SDK load drops the buffer instead of accumulating it', async () => {
  installWindow('/merge-pdf/', { posthog: false });
  const analytics = await freshAnalytics();
  await analytics.initAnalytics('token', 'https://e.example', async () => {
    throw new Error('chunk blocked');
  });
  expect(() => analytics.track('tool_viewed')).not.toThrow();
});

test('scheduleSdkLoad waits for the first interaction', () => {
  const target = new EventTarget();
  let called = 0;
  scheduleSdkLoad(() => called++, target, 10_000);
  expect(called).toBe(0);

  target.dispatchEvent(new Event('pointermove'));
  expect(called).toBe(1);
  // A second gesture must not load twice.
  target.dispatchEvent(new Event('pointerdown'));
  expect(called).toBe(1);
});

test('scheduleSdkLoad falls back on the timer when the visitor never interacts', () => {
  vi.useFakeTimers();
  const target = new EventTarget();
  let called = 0;
  scheduleSdkLoad(() => called++, target, 10_000);
  vi.advanceTimersByTime(10_000);
  expect(called).toBe(1);
});

test('bootAnalytics reads the meta tags and drives init synchronously in tests', async () => {
  installWindow('/', { posthog: false });
  const analytics = await freshAnalytics();
  const calls: Array<[string, unknown]> = [];
  const doc = {
    querySelector: (selector: string) => ({
      getAttribute: () => (selector.includes('ph-token') ? 'token' : 'https://e.example'),
    }),
    defaultView: null,
  } as unknown as Document;

  await analytics.bootAnalytics(doc, async () => fakeSdk(calls));
  analytics.track('sponsor_clicked', { location: 'footer' });
  expect(calls.map(([event]) => event)).toEqual(['sponsor_clicked']);
});

// Caught errors (a malformed server frame, a failed render) would otherwise be
// invisible: they never reach PostHog's autocapture, which only sees errors
// that escape. reportError is the explicit channel for them.
describe('reportError', () => {
  it('reports the error with properties describing where it happened', () => {
    installWindow('/');
    const captured: Array<[unknown, unknown]> = [];
    g.posthog = {
      capture: () => {},
      register: () => {},
      captureException: (error: unknown, props?: Record<string, unknown>) => { captured.push([error, props]); },
    };
    const err = new Error('boom');
    reportError(err, { surface: 'chat' });
    expect(captured).toEqual([[err, { surface: 'chat' }]]);
  });

  it('drops properties with a blank value', () => {
    installWindow('/');
    const captured: Array<[unknown, unknown]> = [];
    g.posthog = {
      capture: () => {},
      register: () => {},
      captureException: (error: unknown, props?: Record<string, unknown>) => { captured.push([error, props]); },
    };
    const err = new Error('boom');
    reportError(err, { surface: 'chat', tag: ' ' });
    expect(captured).toEqual([[err, { surface: 'chat' }]]);
  });

  it('buffers the error while the SDK loads, then replays it', async () => {
    installWindow('/', { posthog: false });
    const analytics = await freshAnalytics();
    const calls: Array<[string, unknown]> = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const booting = analytics.initAnalytics('token', 'https://e.example', async () => {
      await gate;
      return fakeSdk(calls);
    });
    const err = new Error('hydrate failed');
    analytics.reportError(err, { phase: 'boot' });
    release();
    await booting;
    expect(calls).toEqual([['$exception', { error: err, props: { phase: 'boot' } }]]);
  });

  it('does nothing when analytics was never initialised', () => {
    installWindow('/', { posthog: false });
    expect(() => reportError(new Error('boom'))).not.toThrow();
  });
});
