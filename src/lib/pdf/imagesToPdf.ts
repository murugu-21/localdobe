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

function readU16(bytes: Uint8Array, offset: number, little: boolean): number | null {
  if (offset < 0 || offset + 1 >= bytes.length) return null;
  return little ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32(bytes: Uint8Array, offset: number, little: boolean): number | null {
  if (offset < 0 || offset + 3 >= bytes.length) return null;
  return little
    ? (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
    : ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

/** Reads the Orientation tag (0x0112) out of IFD0 of a TIFF header starting at `tiffStart`. */
function readOrientationFromTiff(bytes: Uint8Array, tiffStart: number): number | null {
  if (tiffStart + 8 > bytes.length) return null;
  let little: boolean;
  if (bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49) little = true;
  else if (bytes[tiffStart] === 0x4d && bytes[tiffStart + 1] === 0x4d) little = false;
  else return null;

  const magic = readU16(bytes, tiffStart + 2, little);
  if (magic !== 0x002a) return null;

  const ifd0Offset = readU32(bytes, tiffStart + 4, little);
  if (ifd0Offset === null) return null;
  const ifd0Start = tiffStart + ifd0Offset;

  const count = readU16(bytes, ifd0Start, little);
  if (count === null) return null;

  for (let i = 0; i < count; i++) {
    const entryOffset = ifd0Start + 2 + i * 12;
    if (entryOffset + 12 > bytes.length) return null;
    const tag = readU16(bytes, entryOffset, little);
    if (tag === 0x0112) {
      const value = readU16(bytes, entryOffset + 8, little);
      if (value === null || value < 1 || value > 8) return null;
      return value;
    }
  }
  return null;
}

/**
 * Walks JPEG APP1 segments looking for an Exif Orientation tag (IFD0, tag 0x0112).
 * Returns 1 (identity) when the input isn't a JPEG, has no Exif APP1 segment, or the
 * segment is malformed in any way — every read is bounds-checked and this never throws.
 */
export function parseExifOrientation(bytes: Uint8Array): number {
  try {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
    let offset = 2;
    while (offset + 1 < bytes.length) {
      if (bytes[offset] !== 0xff) return 1;
      const marker = bytes[offset + 1];
      // Markers with no payload: TEM/RST*/SOI have no length field.
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        offset += 2;
        continue;
      }
      if (marker === 0xda) break; // start of scan — no more metadata segments follow

      const length = readU16(bytes, offset + 2, false);
      if (length === null || length < 2) return 1;
      const segmentStart = offset + 2;
      const segmentEnd = segmentStart + length;
      if (segmentEnd > bytes.length) return 1;

      if (marker === 0xe1) {
        const payloadStart = offset + 4;
        const hasExifHeader =
          payloadStart + 6 <= bytes.length &&
          bytes[payloadStart] === 0x45 &&
          bytes[payloadStart + 1] === 0x78 &&
          bytes[payloadStart + 2] === 0x69 &&
          bytes[payloadStart + 3] === 0x66 &&
          bytes[payloadStart + 4] === 0x00 &&
          bytes[payloadStart + 5] === 0x00;
        if (hasExifHeader) {
          const orientation = readOrientationFromTiff(bytes, payloadStart + 6);
          if (orientation !== null) return orientation;
        }
      }
      offset = segmentEnd;
    }
    return 1;
  } catch {
    return 1;
  }
}

/**
 * Maps an Exif orientation value to a page rotation (degrees, clockwise).
 * Mirrored values (2/4/5/7) can only be approximated by their rotation component —
 * a PDF /Rotate entry rotates the whole page but cannot flip it, so the mirror
 * itself is lost. 6 -> 90: Exif 6 means "0th row is the visual right side", i.e. the
 * stored image needs a 90 deg clockwise turn to display upright, which is exactly what
 * PDF /Rotate 90 (page displayed rotated 90 deg clockwise) produces.
 */
function orientationToRotation(orientation: number): number {
  switch (orientation) {
    case 6: return 90;
    case 3: return 180;
    case 8: return 270;
    case 7: return 90;
    case 4: return 180;
    case 5: return 270;
    default: return 0; // 1, 2, or malformed/out-of-range
  }
}

/** One image per page, in array order. */
export async function imagesToPdf(images: Uint8Array[], pageSize: PageSize): Promise<Uint8Array> {
  if (images.length === 0) throw new Error('no images');
  const { PDFDocument, degrees } = await import('pdf-lib');
  const doc = await PDFDocument.create();

  for (const bytes of images) {
    const type = sniffImageType(bytes);
    const image = type === 'jpg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    const angle = type === 'jpg' ? orientationToRotation(parseExifOrientation(bytes)) : 0;
    const rotated = angle === 90 || angle === 270;
    // Effective (as-displayed-upright) dimensions, used only to pick page orientation.
    const effWidth = rotated ? image.height : image.width;
    const effHeight = rotated ? image.width : image.height;

    if (pageSize === 'fit') {
      const page = doc.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
      if (angle !== 0) page.setRotation(degrees(angle));
      continue;
    }

    const [baseWidth, baseHeight] = PAGE_DIMS[pageSize];
    // Pick the DISPLAYED page orientation from the effective (upright) dims, then —
    // since /Rotate 90|270 swaps displayed width/height — build the MediaBox as the
    // swapped, pre-rotation raw frame so the display comes out as decided here.
    // (fit mode above never swaps because its "page" IS the raw frame already.)
    const displayLandscape = effWidth > effHeight;
    const displayWidth = displayLandscape ? baseHeight : baseWidth;
    const displayHeight = displayLandscape ? baseWidth : baseHeight;
    const pageWidth = rotated ? displayHeight : displayWidth;
    const pageHeight = rotated ? displayWidth : displayHeight;
    const page = doc.addPage([pageWidth, pageHeight]);

    const boxWidth = pageWidth - MARGIN * 2;
    const boxHeight = pageHeight - MARGIN * 2;
    const { width: drawWidth, height: drawHeight } = image.scaleToFit(boxWidth, boxHeight);
    const x = (pageWidth - drawWidth) / 2;
    const y = (pageHeight - drawHeight) / 2;
    page.drawImage(image, { x, y, width: drawWidth, height: drawHeight });
    if (angle !== 0) page.setRotation(degrees(angle));
  }

  return doc.save();
}
