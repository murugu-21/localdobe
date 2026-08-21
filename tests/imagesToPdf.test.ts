import { PDFDocument } from 'pdf-lib';
import { imagesToPdf, parseExifOrientation, sniffImageType, UnsupportedImageError } from '../src/lib/pdf/imagesToPdf';

async function encode(width: number, height: number, format: 'jpeg' | 'png'): Promise<Uint8Array> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  const buf = format === 'png' ? await canvas.encode('png') : await canvas.encode('jpeg');
  return new Uint8Array(buf);
}

function u16(value: number, little: boolean): number[] {
  return little ? [value & 0xff, (value >> 8) & 0xff] : [(value >> 8) & 0xff, value & 0xff];
}

function u32(value: number, little: boolean): number[] {
  const b0 = value & 0xff;
  const b1 = (value >> 8) & 0xff;
  const b2 = (value >> 16) & 0xff;
  const b3 = (value >>> 24) & 0xff;
  return little ? [b0, b1, b2, b3] : [b3, b2, b1, b0];
}

/** Builds a minimal Exif APP1 segment (single IFD0 entry: Orientation) in the given byte order. */
function buildExifApp1(orientation: number, little: boolean): number[] {
  const byteOrderMark = little ? [0x49, 0x49] : [0x4d, 0x4d];
  const tiff = [
    ...byteOrderMark,
    ...u16(0x002a, little), // TIFF magic
    ...u32(8, little), // IFD0 offset, relative to TIFF header start
    ...u16(1, little), // IFD0 entry count
    ...u16(0x0112, little), // tag: Orientation
    ...u16(3, little), // type: SHORT
    ...u32(1, little), // component count
    ...u16(orientation, little), 0x00, 0x00, // value (in first 2 bytes of the 4-byte slot) + padding
    ...u32(0, little), // next IFD offset (none)
  ];
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0"
  const length = u16(payload.length + 2, false); // JPEG segment length fields are always big-endian
  return [0xff, 0xe1, ...length, ...payload];
}

/** Inserts a minimal Exif APP1 segment right after the SOI marker of a JPEG. */
function injectExif(jpeg: Uint8Array, orientation: number, little = true): Uint8Array {
  const segment = buildExifApp1(orientation, little);
  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(segment, 2);
  out.set(jpeg.subarray(2), 2 + segment.length);
  return out;
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

describe('parseExifOrientation', () => {
  test('returns 1 for a plain jpeg with no Exif segment', async () => {
    const jpg = await encode(10, 6, 'jpeg');
    expect(parseExifOrientation(jpg)).toBe(1);
  });

  test('returns 1 for a png (no JPEG SOI marker)', async () => {
    const png = await encode(10, 6, 'png');
    expect(parseExifOrientation(png)).toBe(1);
  });

  test('returns 1 for malformed EXIF without throwing', () => {
    // Looks like a JPEG (SOI) followed by an APP1 marker claiming a segment length
    // that runs past the end of the buffer.
    const malformed = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x45, 0x78, 0x69, 0x66]);
    expect(() => parseExifOrientation(malformed)).not.toThrow();
    expect(parseExifOrientation(malformed)).toBe(1);
  });

  test('returns 1 for garbage bytes', () => {
    const random = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parseExifOrientation(random)).toBe(1);
  });

  test.each([1, 3, 6, 8])('reads injected orientation %i (little-endian / II)', async (orientation) => {
    const jpg = await encode(10, 6, 'jpeg');
    const withExif = injectExif(jpg, orientation, true);
    expect(parseExifOrientation(withExif)).toBe(orientation);
  });

  test.each([3, 6, 8])('reads injected orientation %i (big-endian / MM)', async (orientation) => {
    const jpg = await encode(10, 6, 'jpeg');
    const withExif = injectExif(jpg, orientation, false);
    expect(parseExifOrientation(withExif)).toBe(orientation);
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

  test('fit: orientation-6 landscape-stored jpeg -> raw page size + 90deg rotation', async () => {
    // Raw stored bytes are landscape (40x20); Exif 6 says the photo displays upright
    // rotated 90deg clockwise from how it's stored.
    const jpg = await encode(40, 20, 'jpeg');
    const withExif = injectExif(jpg, 6, true);
    const out = await imagesToPdf([withExif], 'fit');
    const doc = await PDFDocument.load(out);
    const page = doc.getPage(0);
    const { width, height } = page.getSize();
    expect(width).toBe(40);
    expect(height).toBe(20);
    expect(page.getRotation().angle).toBe(90);
  });

  test('a4: orientation-6 landscape-stored jpeg -> page picked from EFFECTIVE (portrait) dims', async () => {
    // Raw 40x20 (landscape); rotated 90deg the effective/upright dims are 20x40
    // (portrait), so the A4 page must be chosen portrait, not landscape.
    const jpg = await encode(40, 20, 'jpeg');
    const withExif = injectExif(jpg, 6, true);
    const out = await imagesToPdf([withExif], 'a4');
    const doc = await PDFDocument.load(out);
    const page = doc.getPage(0);
    const { width, height } = page.getSize();
    expect(width).toBeCloseTo(595.28, 2);
    expect(height).toBeCloseTo(841.89, 2);
    expect(page.getRotation().angle).toBe(90);
  });

  test('fit: plain jpeg (no Exif) -> no rotation applied', async () => {
    const jpg = await encode(40, 20, 'jpeg');
    const out = await imagesToPdf([jpg], 'fit');
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(0).getRotation().angle).toBe(0);
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
