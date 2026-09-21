import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

// The LEGACY build is load-bearing, not a preference. The default build calls
// Map.prototype.getOrInsertComputed directly, a method too new for many browsers
// (Chrome < 140, Safari < 26), which fails as `getOrInsertComputed is not a
// function` the moment any document is opened. The legacy build ships polyfills
// for those methods in both the main bundle and the worker. Do not switch back
// without checking those polyfills still exist.
let pdfjsPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null;

// WebKit (Safari/iOS) only gained `ReadableStream.prototype[Symbol.asyncIterator]`
// in 26.4, and the legacy build cannot polyfill a Web API. pdf.js reads text
// content with `for await` over a stream, so on older WebKit every edit-tool
// page load dies with `undefined is not a function (near '...e of t...')`.
// Install the pdf.js project's own fallback (mozilla/pdf.js#20973) before any
// call site; it must be present before `page.getTextContent()` runs.
export function ensureReadableStreamAsyncIterator(): void {
  if (typeof ReadableStream === 'undefined') return;
  const proto = ReadableStream.prototype;
  // lib.dom types `[Symbol.asyncIterator]` as always present, so the runtime
  // presence check needs an untyped read.
  const untypedProto = proto as unknown as Record<symbol, unknown>;
  if (typeof untypedProto[Symbol.asyncIterator] === 'function') return;
  Object.defineProperty(proto, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    value: async function* (this: ReadableStream<unknown>) {
      const reader = this.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  });
}

ensureReadableStreamAsyncIterator();

export function getPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
    return pdfjs;
  });
  return pdfjsPromise;
}

export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const pdfjs = await getPdfjs();
  // pdf.js transfers the buffer to its worker; hand it a copy so callers keep theirs.
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    return await task.promise;
  } catch (err) {
    // getDocument() spawns a dedicated worker before parsing; if parsing fails,
    // nothing else will ever destroy it, so terminate it explicitly here.
    void task.destroy().catch(() => {});
    throw err;
  }
}

/**
 * Terminates the dedicated worker behind an opened document. `PDFDocumentProxy`
 * has no `destroy()` of its own (removed upstream) — the loading task it came
 * from does. Callers of `openPdf` must call this when done with the document.
 */
export async function closePdf(doc: PDFDocumentProxy): Promise<void> {
  await doc.loadingTask.destroy();
}

/**
 * pdf.js tracks every canvas with a render in flight and refuses to start a second
 * one on it — `Cannot use the same canvas during multiple render() operations` —
 * unless the previous task was cancelled or completed. The edit tool re-renders one
 * persistent canvas whenever a page is rotated or the window resizes, so a fast
 * second render can overlap the first. Remember the in-flight task per canvas and
 * cancel it before the next render starts; pdf.js clears its canvas-in-use mark
 * synchronously inside `cancel()`, so the replacement can begin immediately.
 */
const inFlightRenders = new WeakMap<HTMLCanvasElement, { task: RenderTask; settled: boolean }>();

/** True for pdf.js's expected, non-error result of cancelling a render task. */
function isRenderCancelled(err: unknown): boolean {
  return err instanceof Error && err.name === 'RenderingCancelledException';
}

export async function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
  rotationDelta?: number,
): Promise<void> {
  const previous = inFlightRenders.get(canvas);
  // Never cancel a task that already settled — pdf.js would run its completion
  // callback (and operator-list abort) a second time. `settled` flips in the first
  // promise callback, so a later caller can only observe it as still-running if the
  // task really is still drawing.
  if (previous && !previous.settled) previous.task.cancel();
  const rotation = (((page.rotate + (rotationDelta ?? 0)) % 360) + 360) % 360;
  const viewport = page.getViewport({ scale, rotation });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  const task = page.render({ canvas, canvasContext: ctx, viewport });
  const record = { task, settled: false };
  inFlightRenders.set(canvas, record);
  void task.promise.then(
    () => { record.settled = true; },
    () => { record.settled = true; },
  );
  try {
    await task.promise;
  } catch (err) {
    // Expected when a newer render replaced this one (or the document was closed
    // mid-render). A genuine render failure still reaches the caller.
    if (!isRenderCancelled(err)) throw err;
  } finally {
    // Only clear our own entry: a replacement render may already own the canvas.
    if (inFlightRenders.get(canvas) === record) inFlightRenders.delete(canvas);
  }
}
