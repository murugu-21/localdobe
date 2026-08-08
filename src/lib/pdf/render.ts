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
  return pdfjs.getDocument({ data: bytes.slice() }).promise;
}

export async function renderPageToCanvas(page: PDFPageProxy, canvas: HTMLCanvasElement, scale: number): Promise<void> {
  const viewport = page.getViewport({ scale });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
}
