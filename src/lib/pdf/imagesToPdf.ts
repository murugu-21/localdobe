export type PageSize = 'fit' | 'a4' | 'letter';

export class UnsupportedImageError extends Error {
  constructor(message = 'Unsupported image type. Please choose a JPG or PNG file.') {
    super(message);
    this.name = 'UnsupportedImageError';
  }
}

/** Fixed page sizes in points, portrait orientation (width x height). */
const PAGE_DIMS: Record<'a4' | 'letter', [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

const MARGIN = 24;

/** Detect 'jpg' | 'png' from magic bytes (JPEG: FF D8; PNG: 89 50 4E 47). */
export function sniffImageType(bytes: Uint8Array): 'jpg' | 'png' {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  throw new UnsupportedImageError();
}

/** One image per page, in array order. */
export async function imagesToPdf(images: Uint8Array[], pageSize: PageSize): Promise<Uint8Array> {
  if (images.length === 0) throw new Error('no images');
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();

  for (const bytes of images) {
    const type = sniffImageType(bytes);
    const image = type === 'jpg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);

    if (pageSize === 'fit') {
      const page = doc.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      continue;
    }

    const [baseWidth, baseHeight] = PAGE_DIMS[pageSize];
    const landscape = image.width > image.height;
    const pageWidth = landscape ? baseHeight : baseWidth;
    const pageHeight = landscape ? baseWidth : baseHeight;
    const page = doc.addPage([pageWidth, pageHeight]);

    const boxWidth = pageWidth - MARGIN * 2;
    const boxHeight = pageHeight - MARGIN * 2;
    const { width: drawWidth, height: drawHeight } = image.scaleToFit(boxWidth, boxHeight);
    const x = (pageWidth - drawWidth) / 2;
    const y = (pageHeight - drawHeight) / 2;
    page.drawImage(image, { x, y, width: drawWidth, height: drawHeight });
  }

  return doc.save();
}
