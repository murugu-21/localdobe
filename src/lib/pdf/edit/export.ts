import { loadPdf } from '../errors';
import type { FontClass } from './fontMatch';
import type { NewTextBox, ResizeSpec, TextEdit } from './session';

const COVER_PAD = 1; // pt of margin around the original glyph box

const PAPER: Record<'a4' | 'letter', [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

export interface ExportChanges {
  edits: TextEdit[];
  boxes: NewTextBox[];
  rotations: { page: number; rotation: number }[];
  resize: ResizeSpec | null;
}

export async function exportEditedPdf(
  src: Uint8Array,
  changes: ExportChanges,
  fetchFont: (cls: FontClass) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const { rgb, degrees } = await import('pdf-lib');
  const fontkitModule = await import('@pdf-lib/fontkit');
  const doc = await loadPdf(src);
  // @pdf-lib/fontkit's default export shape doesn't line up 1:1 with pdf-lib's
  // `Fontkit` interface type declarations across versions; the runtime shape is correct.
  doc.registerFontkit(fontkitModule.default as unknown as Parameters<typeof doc.registerFontkit>[0]);

  const fontCache = new Map<FontClass, Awaited<ReturnType<typeof doc.embedFont>>>();
  async function font(cls: FontClass) {
    let f = fontCache.get(cls);
    if (!f) {
      f = await doc.embedFont(await fetchFont(cls), { subset: true });
      fontCache.set(cls, f);
    }
    return f;
  }

  // 1. Text edits and new boxes — content-space coordinates, so they must be drawn
  //    before rotation/resize transforms.
  for (const e of changes.edits) {
    const page = doc.getPage(e.page);
    const f = await font(e.fontClass);
    // Cover the original glyphs: from below the baseline (descender) to above the ascender.
    page.drawRectangle({
      x: e.x - COVER_PAD,
      y: e.y - e.fontSize * 0.25 - COVER_PAD,
      width: Math.max(e.width, f.widthOfTextAtSize(e.text, e.fontSize)) + COVER_PAD * 2,
      height: e.fontSize * 1.25 + COVER_PAD * 2,
      color: rgb(e.cover.r, e.cover.g, e.cover.b),
    });
    if (e.text.trim() !== '') {
      page.drawText(e.text, { x: e.x, y: e.y, size: e.fontSize, font: f, color: rgb(0, 0, 0) });
    }
  }

  for (const b of changes.boxes) {
    const page = doc.getPage(b.page);
    page.drawText(b.text, {
      x: b.x, y: b.y, size: b.fontSize,
      font: await font(b.fontClass),
      color: rgb(b.color.r, b.color.g, b.color.b),
      lineHeight: b.fontSize * 1.3,
    });
  }

  // 2. Rotations — delta on top of the page's existing /Rotate.
  for (const { page: idx, rotation } of changes.rotations) {
    const page = doc.getPage(idx);
    const angle = (((page.getRotation().angle + rotation) % 360) + 360) % 360;
    page.setRotation(degrees(angle));
  }

  // 3. Resize — scale content and boxes; 'fit' centers content on an exact target box.
  if (changes.resize) {
    const resize = changes.resize;
    for (const page of doc.getPages()) {
      const { width, height } = page.getSize();
      if (resize.kind === 'percent') {
        const f = resize.value / 100;
        page.scale(f, f);
      } else {
        const [tw, th] = PAPER[resize.target];
        const f = Math.min(tw / width, th / height);
        page.scale(f, f);
        page.setMediaBox(0, 0, tw, th);
        page.setCropBox(0, 0, tw, th);
        page.translateContent((tw - width * f) / 2, (th - height * f) / 2);
      }
    }
  }

  return doc.save();
}
