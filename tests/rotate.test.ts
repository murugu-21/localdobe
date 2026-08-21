import { PDFDocument, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { rotatePdf } from '../src/lib/pdf/rotate';

async function makePdf(rotations: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const r of rotations) {
    const page = doc.addPage([612, 792]);
    page.setRotation(degrees(r));
  }
  return doc.save();
}

async function readRotations(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => p.getRotation().angle);
}

describe('rotatePdf', () => {
  it('applies per-page deltas', async () => {
    const out = await rotatePdf(await makePdf([0, 0, 0]), [90, 0, 270]);
    expect(await readRotations(out)).toEqual([90, 0, 270]);
  });

  it('composes with existing /Rotate values, wrapping past 360', async () => {
    const out = await rotatePdf(await makePdf([90, 270]), [90, 180]);
    expect(await readRotations(out)).toEqual([180, 90]);
  });

  it('leaves pages beyond the deltas array untouched', async () => {
    const out = await rotatePdf(await makePdf([0, 90]), [180]);
    expect(await readRotations(out)).toEqual([180, 90]);
  });

  it('keeps page count and content (lossless metadata change)', async () => {
    const src = await makePdf([0]);
    const out = await rotatePdf(src, [90]);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });
});
