import { openPdf, closePdf, renderPageToCanvas } from './render';

export const DPI_PRESETS = { standard: 150, high: 300 } as const;
export type DpiPreset = keyof typeof DPI_PRESETS;
export type ImageFormat = 'jpeg' | 'png';

/** Points-per-inch is fixed at 72; pdf.js viewport `scale` is relative to that. */
export function dpiToScale(dpi: number): number {
  return dpi / 72;
}

export function pageImageName(baseName: string, pageIndex: number, format: ImageFormat): string {
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  return `${baseName}-page-${pageIndex + 1}.${ext}`;
}

/**
 * Browser-only: renders every page of a PDF to a raster image and encodes it via
 * `canvas.toBlob`. Requires a real `<canvas>` element and is not node-testable —
 * covered by e2e instead (mirrors the load/render/cleanup pattern used by RotateTool).
 */
export async function pdfToImages(
  bytes: Uint8Array,
  format: ImageFormat,
  dpi: number,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array[]> {
  const scale = dpiToScale(dpi);
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const doc = await openPdf(bytes);
  try {
    const out: Uint8Array[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const canvas = document.createElement('canvas');
      await renderPageToCanvas(page, canvas, scale);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, mime, format === 'jpeg' ? 0.9 : undefined);
      });
      if (!blob) throw new Error('Could not encode page image.');
      out.push(new Uint8Array(await blob.arrayBuffer()));
      page.cleanup();
      onProgress?.(i, doc.numPages);
    }
    return out;
  } finally {
    await closePdf(doc);
  }
}
