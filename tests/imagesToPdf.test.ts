import { PDFDocument } from 'pdf-lib';
import { imagesToPdf, sniffImageType, UnsupportedImageError } from '../src/lib/pdf/imagesToPdf';

async function encode(width: number, height: number, format: 'jpeg' | 'png'): Promise<Uint8Array> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  const buf = format === 'png' ? await canvas.encode('png') : await canvas.encode('jpeg');
  return new Uint8Array(buf);
}

describe('sniffImageType', () => {
  test('detects jpg from magic bytes', async () => {
    const jpg = await encode(4, 4, 'jpeg');
    expect(sniffImageType(jpg)).toBe('jpg');
  });

  test('detects png from magic bytes', async () => {
    const png = await encode(4, 4, 'png');
    expect(sniffImageType(png)).toBe('png');
  });

  test('throws UnsupportedImageError on random bytes', () => {
    const random = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(() => sniffImageType(random)).toThrow(UnsupportedImageError);
  });
});

describe('imagesToPdf', () => {
  test('rejects an empty input array', async () => {
    await expect(imagesToPdf([], 'fit')).rejects.toThrow('no images');
  });

  test('fit: page size equals image pixel dimensions exactly', async () => {
    const jpg = await encode(40, 20, 'jpeg');
    const out = await imagesToPdf([jpg], 'fit');
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBe(40);
    expect(height).toBe(20);
  });

  test('a4: portrait image -> portrait page', async () => {
    const png = await encode(20, 40, 'png');
    const out = await imagesToPdf([png], 'a4');
    const doc = await PDFDocument.load(out);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(595.28, 2);
    expect(height).toBeCloseTo(841.89, 2);
  });

  test('a4: landscape image -> landscape page', async () => {
    const jpg = await encode(40, 20, 'jpeg');
    const out = await imagesToPdf([jpg], 'a4');
    const doc = await PDFDocument.load(out);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(841.89, 2);
    expect(height).toBeCloseTo(595.28, 2);
  });

  test('letter: landscape image -> landscape page', async () => {
    const jpg = await encode(40, 20, 'jpeg');
    const out = await imagesToPdf([jpg], 'letter');
    const doc = await PDFDocument.load(out);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(792, 2);
    expect(height).toBeCloseTo(612, 2);
  });

  test('multi-image order + mixed types: png then jpg, each on its own page', async () => {
    const png = await encode(20, 40, 'png'); // portrait
    const jpg = await encode(40, 20, 'jpeg'); // landscape
    const out = await imagesToPdf([png, jpg], 'fit');
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    const size0 = doc.getPage(0).getSize();
    const size1 = doc.getPage(1).getSize();
    expect(size0.width).toBe(20);
    expect(size0.height).toBe(40);
    expect(size1.width).toBe(40);
    expect(size1.height).toBe(20);
  });
});
