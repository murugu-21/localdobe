import { PDFDocument, StandardFonts } from 'pdf-lib';

/** One page per string, each ~US Letter with the string drawn at a known spot. */
export async function makePdf(texts: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of texts) {
    const page = doc.addPage([612, 792]);
    page.drawText(text, { x: 72, y: 700, size: 14, font });
  }
  return doc.save();
}

export async function pageCount(bytes: Uint8Array): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  return (await PDFDocument.load(bytes)).getPageCount();
}
