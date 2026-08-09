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

/** Creates an encrypted PDF by byte-splicing an /Encrypt entry into the trailer. */
export async function makeEncryptedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('encrypted', { x: 72, y: 700, size: 14, font });
  const bytes = await doc.save({ useObjectStreams: false });

  // Convert bytes to string for regex operations (latin1 preserves binary)
  const str = Buffer.from(bytes).toString('latin1');

  // Find /Root reference in trailer: /Root (\d+) 0 R
  const rootMatch = str.match(/\/Root\s+(\d+)\s+0\s+R/);
  if (!rootMatch) throw new Error('Could not find /Root in trailer');
  const rootRef = rootMatch[1];

  // Find the trailer dict start: trailer\n<< or trailer <<
  const trailerMatch = str.match(/trailer\s*<</) as any;
  if (!trailerMatch) throw new Error('Could not find trailer in PDF');
  const insertPos = trailerMatch.index! + trailerMatch[0].length;

  // Insert /Encrypt entry pointing to the same object as /Root
  const encryptEntry = `\n/Encrypt ${rootRef} 0 R`;
  const splicedStr = str.slice(0, insertPos) + encryptEntry + str.slice(insertPos);

  // Convert back to bytes (latin1 preserves binary)
  return new Uint8Array(Buffer.from(splicedStr, 'latin1'));
}

export async function extractPageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    out.push(content.items.map((it: any) => ('str' in it ? it.str : '')).join(''));
  }
  // pdfjs v6 removed PDFDocumentProxy#destroy(); destroy via the loading task instead.
  // @ts-ignore loadingTask may not be typed but is available at runtime
  if (typeof doc.loadingTask?.destroy === 'function') {
    // @ts-ignore
    await doc.loadingTask.destroy();
  }
  return out;
}
