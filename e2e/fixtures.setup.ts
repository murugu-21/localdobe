import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, concatTransformationMatrix, degrees, drawObject, popGraphicsState, pushGraphicsState, rgb } from 'pdf-lib';

declare global {
  // Provided by wasm_exec.js and the Go program respectively (see pdfcpu.worker.ts).
  // eslint-disable-next-line no-var
  var Go: new () => { importObject: WebAssembly.Imports; run(i: WebAssembly.Instance): Promise<void> };
  // eslint-disable-next-line no-var
  var __pdfcpuEncrypt: (input: Uint8Array, configJson: string) => { ok: true; bytes: Uint8Array } | { ok: false; error: string };
}

// Runs the real pdfcpu wasm engine directly under Node (globalSetup is Node, not
// a browser). `userPw: ''` produces the IRCC-style owner-only lock the
// auto-decrypt fix targets (pdfjs opens it fine; pdf-lib refuses without the
// fix). A non-empty user password produces a file that genuinely needs a
// password to open — the path that must point readers at the Unlock tool.
async function pdfcpuEncrypt(bytes: Uint8Array, userPw: string, ownerPw: string): Promise<Uint8Array> {
  if (typeof globalThis.__pdfcpuEncrypt !== 'function') {
    await import('../src/workers/go/wasm_exec.js');
    const go = new globalThis.Go();
    const wasmBytes = await readFile('public/wasm/pdfcpu-v4.wasm');
    const { instance } = await WebAssembly.instantiate(wasmBytes, go.importObject);
    void go.run(instance); // resolves only on exit; do not await
    for (let i = 0; i < 200 && typeof globalThis.__pdfcpuEncrypt !== 'function'; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    if (typeof globalThis.__pdfcpuEncrypt !== 'function') throw new Error('pdfcpu wasm failed to start');
  }
  const res = globalThis.__pdfcpuEncrypt(bytes, JSON.stringify({ userPw, ownerPw }));
  if (!res.ok) throw new Error(res.error);
  return res.bytes;
}

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

  // A "phone scan": one 1600×1600 RGB Flate image drawn into a 4-inch box (400 dpi
  // effective). Gradient + deterministic noise so Flate can't collapse it; the Shrink
  // images preset must resample it to 600 px and re-encode as JPEG.
  async function makeScan(): Promise<Uint8Array> {
    const W = 1600;
    const px = new Uint8Array(W * W * 3);
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        const n = (x * 7919 + y * 104729) % 23;
        px[i] = Math.min(255, (x * 255) / W + n);
        px[i + 1] = Math.min(255, (y * 255) / W + n);
        px[i + 2] = Math.min(255, ((x + y) * 127) / (2 * W) + n);
      }
    }
    const doc = await PDFDocument.create();
    const ref = doc.context.register(doc.context.flateStream(px, {
      Type: 'XObject', Subtype: 'Image', Width: W, Height: W, ColorSpace: 'DeviceRGB', BitsPerComponent: 8,
    }));
    const page = doc.addPage([612, 792]);
    const name = page.node.newXObject('Im1', ref);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(288, 0, 0, 288, 162, 252), drawObject(name), popGraphicsState());
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

  // Identity + hidden content for the privacy checker: author and company
  // fields, an embedded attachment, an auto-running script, and a link
  // annotation — enough to exercise every scan section the tool renders.
  async function makePrivacy(): Promise<Uint8Array> {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    page.drawText('Privacy fixture', { x: 72, y: 700, size: 14, font });
    doc.setAuthor('Jane Fixture');
    doc.setCreator('Fixture Writer 1.0');
    (doc.context.lookup(doc.context.trailerInfo.Info) as PDFDict).set(
      PDFName.of('Company'),
      PDFString.of('Fixture Corp'),
    );

    const embeddedRef = doc.context.register(
      doc.context.flateStream('attachment payload', { Type: 'EmbeddedFile', Subtype: 'text/plain' }),
    );
    const filespecRef = doc.context.register(
      doc.context.obj({
        Type: 'Filespec',
        F: PDFString.of('invoice.pdf'),
        UF: PDFString.of('invoice.pdf'),
        EF: doc.context.obj({ F: embeddedRef }),
      }),
    );
    doc.catalog.set(
      PDFName.of('Names'),
      doc.context.obj({
        EmbeddedFiles: doc.context.register(
          doc.context.obj({ Names: [PDFString.of('invoice.pdf'), filespecRef] }),
        ),
      }),
    );
    doc.catalog.set(
      PDFName.of('OpenAction'),
      doc.context.register(doc.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert("e2e")') })),
    );
    page.node.set(
      PDFName.of('Annots'),
      doc.context.obj([
        doc.context.register(
          doc.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: [72, 72, 200, 100],
            A: doc.context.obj({ S: 'URI', URI: PDFString.of('https://example.com/e2e') }),
          }),
        ),
      ]),
    );

    return doc.save({ useObjectStreams: false });
  }
  await writeFile('e2e/.fixtures/privacy.pdf', await makePrivacy());

  // Owner-password-only encryption (empty user password): pdfjs opens it fine
  // (thumbnails/detection work) but pdf-lib refuses without the auto-decrypt fix.
  await writeFile(
    'e2e/.fixtures/owner-locked.pdf',
    await pdfcpuEncrypt(await make(['Owner-locked 1', 'Owner-locked 2']), '', 'e2e-owner-secret'),
  );
  // Real user-password encryption: nothing opens it without the password, so
  // every tool must offer the Unlock tool as a link, not a dead text path.
  await writeFile(
    'e2e/.fixtures/user-locked.pdf',
    await pdfcpuEncrypt(await make(['User-locked 1']), 'e2e-user-secret', 'e2e-owner-secret'),
  );
  await writeFile('e2e/.fixtures/big.pdf', await make(Array.from({ length: 40 }, (_, i) => `Page ${i + 1}`), 80));
  await writeFile('e2e/.fixtures/edit.pdf', await make(['Hello World from localdobe']));
  await writeFile('e2e/.fixtures/signed.pdf', await makeSigned());
  await writeFile('e2e/.fixtures/scan.pdf', await makeScan());

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
