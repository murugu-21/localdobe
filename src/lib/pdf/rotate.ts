import { loadPdf } from './errors';

/** Rotate pages by per-page clockwise deltas (multiples of 90). Metadata-only
 *  (/Rotate), so content streams, fonts, and images are untouched. */
export async function rotatePdf(src: Uint8Array, deltas: number[]): Promise<Uint8Array> {
  const { degrees } = await import('pdf-lib');
  const doc = await loadPdf(src);
  doc.getPages().forEach((page, i) => {
    const delta = deltas[i] ?? 0;
    if (delta % 360 === 0) return;
    const next = (((page.getRotation().angle + delta) % 360) + 360) % 360;
    page.setRotation(degrees(next));
  });
  return doc.save();
}
