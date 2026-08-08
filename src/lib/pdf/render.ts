import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

export function getPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
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
