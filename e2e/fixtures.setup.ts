import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, degrees, rgb } from 'pdf-lib';

export default async function globalSetup() {
  await mkdir('e2e/.fixtures', { recursive: true });

  async function make(pages: string[], padding = 0): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const text of pages) {
      const page = doc.addPage([612, 792]);
      page.drawText(text, { x: 72, y: 700, size: 14, font });
      // Padding: draw repeated text to create redundant content for compression.
      for (let i = 0; i < padding; i++) page.drawText(`filler line ${i} `.repeat(5), { x: 40, y: 650 - (i % 60) * 10, size: 8, font });
    }
    return doc.save({ useObjectStreams: false });
  }

  // A PDF with a signature field whose crypto is bogus. Validation can't succeed,
  // but pdfcpu still detects the signature and runs its full trust-pool + parse
  // path — the code that only executes for signed PDFs and that unsigned fixtures
  // can never reach (that gap hid two production-only signature bugs).
  async function makeSigned(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    page.drawText('Signed fixture', { x: 72, y: 700, size: 14, font });
    const ctx = doc.context;
    const sigRef = ctx.register(ctx.obj({
      Type: 'Sig',
      Filter: 'Adobe.PPKLite',
      SubFilter: 'adbe.pkcs7.detached',
      ByteRange: [0, 1000, 2000, 1000],
      Contents: PDFHexString.of('00'.repeat(64)),
      M: PDFString.of('D:20260101120000Z'),
    }));
    const widgetRef = ctx.register(ctx.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      FT: 'Sig',
      Rect: [0, 0, 0, 0],
      T: PDFString.of('Signature1'),
      F: 132,
      V: sigRef,
      P: page.ref,
    }));
    page.node.set(PDFName.of('Annots'), ctx.obj([widgetRef]));
    doc.catalog.set(PDFName.of('AcroForm'), ctx.register(ctx.obj({ SigFlags: 3, Fields: [widgetRef] })));
    return doc.save({ useObjectStreams: false });
  }

  await writeFile('e2e/.fixtures/a.pdf', await make(['Alpha 1', 'Alpha 2']));
  await writeFile('e2e/.fixtures/b.pdf', await make(['Beta 1']));
  await writeFile('e2e/.fixtures/big.pdf', await make(Array.from({ length: 40 }, (_, i) => `Page ${i + 1}`), 80));
  await writeFile('e2e/.fixtures/edit.pdf', await make(['Hello World from localdobe']));
  await writeFile('e2e/.fixtures/signed.pdf', await makeSigned());

  // Two dense-prose pages; page 2 carries /Rotate 90 so it RENDERS sideways —
  // the orientation model sees what a viewer sees. Continuous body text at
  // realistic line spacing is what the classifier was trained on: `make()`'s
  // sparse single-heading-plus-filler-lines layout scored well under the 0.8
  // confidence threshold in practice (~0.45), so this fixture draws full-page
  // prose instead of relying on `make()`'s padding.
  async function makeDenseProse(headings: string[]): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const heading of headings) {
      const page = doc.addPage([612, 792]);
      page.drawText(heading, { x: 72, y: 750, size: 18, font });
      for (let y = 700; y > 40; y -= 20) {
        page.drawText('The quick brown fox jumps over the lazy dog 0123456789.', { x: 40, y, size: 13, font });
      }
    }
    return doc.save({ useObjectStreams: false });
  }
  const rotated = await PDFDocument.load(
    await makeDenseProse(['Rotated fixture page one', 'Rotated fixture page two']),
  );
  rotated.getPage(1).setRotation(degrees(90));
  await writeFile('e2e/.fixtures/rotated.pdf', await rotated.save({ useObjectStreams: false }));

  // A page that paints its own opaque background, like scans and Word/browser
  // exports do. Anything drawn beneath that background is invisible — the exact
  // trap that made behind-content watermarks look like a no-op in production.
  const opaque = await PDFDocument.create();
  const opaqueFont = await opaque.embedFont(StandardFonts.Helvetica);
  const opaquePage = opaque.addPage([612, 792]);
  opaquePage.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(1, 1, 1) });
  opaquePage.drawText('Opaque background fixture', { x: 72, y: 700, size: 14, font: opaqueFont });
  await writeFile('e2e/.fixtures/opaque.pdf', await opaque.save({ useObjectStreams: false }));

  // Real JPEG/PNG fixtures for the image<->pdf converters — distinct aspect ratios
  // (landscape vs portrait) so page-size and reorder assertions can't pass by accident.
  const { createCanvas } = await import('@napi-rs/canvas');

  const photo = createCanvas(400, 200);
  const photoCtx = photo.getContext('2d');
  photoCtx.fillStyle = '#3366cc';
  photoCtx.fillRect(0, 0, 400, 200);
  photoCtx.fillStyle = '#ffffff';
  photoCtx.fillRect(20, 20, 100, 60);
  photoCtx.font = '24px sans-serif';
  photoCtx.fillText('photo.jpg fixture', 20, 120);
  await writeFile('e2e/.fixtures/photo.jpg', await photo.encode('jpeg'));

  const shot = createCanvas(200, 400);
  const shotCtx = shot.getContext('2d');
  shotCtx.fillStyle = '#cc6633';
  shotCtx.fillRect(0, 0, 200, 400);
  shotCtx.fillStyle = '#ffffff';
  shotCtx.fillRect(20, 20, 60, 100);
  shotCtx.font = '20px sans-serif';
  shotCtx.fillText('shot.png fixture', 10, 200);
  await writeFile('e2e/.fixtures/shot.png', await shot.encode('png'));
}
