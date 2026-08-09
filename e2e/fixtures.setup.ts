import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';

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

  await writeFile('e2e/.fixtures/a.pdf', await make(['Alpha 1', 'Alpha 2']));
  await writeFile('e2e/.fixtures/b.pdf', await make(['Beta 1']));
  await writeFile('e2e/.fixtures/big.pdf', await make(Array.from({ length: 40 }, (_, i) => `Page ${i + 1}`), 80));
  await writeFile('e2e/.fixtures/edit.pdf', await make(['Hello World from localdobe']));
}
