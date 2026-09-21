import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

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

export async function renderPageToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
  rotationDelta?: number,
): Promise<void> {
  const rotation = (((page.rotate + (rotationDelta ?? 0)) % 360) + 360) % 360;
  const viewport = page.getViewport({ scale, rotation });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
}
