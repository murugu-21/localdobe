import { FILE_READ_ERROR, readFileBytes } from '../src/lib/readFile';

interface FakeWindow {
  location: { pathname: string };
  posthog?: {
    capture: (event: string, props?: Record<string, unknown>) => void;
    register: (props: Record<string, unknown>) => void;
  };
}

const g = globalThis as unknown as {
  window?: FakeWindow;
  posthog?: FakeWindow['posthog'];
};

/** Installs a fake `window` with a recording sink; returns what the sink saw. */
function installWindow(pathname = '/compress-pdf/') {
  const captured: { event: string; props?: Record<string, unknown> }[] = [];
  const sink = {
    capture: (event: string, props?: Record<string, unknown>) => { captured.push({ event, props }); },
    // client() requires both capture and register, so a half-initialised global
    // is ignored (matching the reference implementation).
    register: () => {},
  };
  g.window = { location: { pathname }, posthog: sink };
  g.posthog = sink;
  return { captured };
}

/** Only `size` and `arrayBuffer()` are used by the helper. */
function fakeFile(size: number, arrayBuffer: () => Promise<ArrayBuffer>): File {
  return { size, arrayBuffer } as unknown as File;
}

afterEach(() => { delete g.window; delete g.posthog; });

test('readFileBytes returns the file bytes', async () => {
  const bytes = await readFileBytes(fakeFile(3, async () => new Uint8Array([1, 2, 3]).buffer));
  expect(bytes).not.toBeNull();
  expect(Array.from(bytes!)).toEqual([1, 2, 3]);
});

test('a NotReadableError becomes null and a handled failure, not a throw', async () => {
  const { captured } = installWindow();
  const err = new DOMException(
    'The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.',
    'NotReadableError',
  );

  await expect(readFileBytes(fakeFile(2048, async () => { throw err; }))).resolves.toBeNull();

  expect(captured).toHaveLength(1);
  expect(captured[0].event).toBe('tool_failed');
  expect(captured[0].props).toMatchObject({
    tool: 'compress-pdf',
    reason: 'read_failed',
    input_bytes: 2048,
  });
  expect(String(captured[0].props?.message)).toContain('could not be read');
});

test('a non-Error rejection still resolves to null and is recorded', async () => {
  const { captured } = installWindow('/merge-pdf/');
  await expect(readFileBytes(fakeFile(7, async () => { throw 'stale picker grant'; }))).resolves.toBeNull();
  expect(captured[0].props).toMatchObject({ tool: 'merge-pdf', reason: 'read_failed', input_bytes: 7 });
});

test('the shown message never blames the document', () => {
  // A file the browser could not read never reached an engine — "corrupt or
  // password-protected" would be a false diagnosis (and the old copy did that).
  expect(FILE_READ_ERROR).not.toMatch(/corrupt|password/i);
  expect(FILE_READ_ERROR).toMatch(/cloud|moved|deleted/i);
});
