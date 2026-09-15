import { loadPdf } from '../errors';
import type { FontClass } from './fontMatch';
import type { NewTextBox, PageSlot, ResizeSpec, TextEdit } from './session';

const COVER_PAD = 1; // pt of margin around the original glyph box

const PAPER: Record<'a4' | 'letter', [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

export interface ExportChanges {
  /** Text edits, addressed by SOURCE page index — applied before any page insert/delete. */
  edits: TextEdit[];
  /** New text boxes, addressed by index into `pages` (the final page list). */
  boxes: NewTextBox[];
  /** Rotations, addressed by index into `pages` (the final page list). */
  rotations: { page: number; rotation: number }[];
  resize: ResizeSpec | null;
  /**
   * The final page structure (order plus inserted blank pages). Omitted keeps every
   * source page in order, which is what callers without page editing want.
   */
  pages?: readonly PageSlot[];
}

/** Original-glyph footprint for a text edit — the region PDFium is asked to clear. `eps` is
 *  `removeText.ts`'s REMOVAL_EPS (a few tenths of a point), deliberately NOT the much wider
 *  COVER_PAD used for the visual fallback cover box below — a wide removal-query rect was
 *  empirically shown to eat an entire neighboring word on the same line (see removeText.ts). */
function removalRect(e: TextEdit, eps: number) {
  return {
    x: e.x - eps,
    y: e.y - e.fontSize * 0.25 - eps,
    width: e.width + eps * 2,
    height: e.fontSize * 1.25 + eps * 2,
  };
}

export interface ExportResult {
  bytes: Uint8Array;
  /** Number of edits where the original text couldn't be cleanly removed via PDFium and
   *  fell back to the old cover-and-redraw rectangle. */
  fallbackCount: number;
}

/**
 * pdf-lib 1.17.1's `removePage` forgets to invalidate the document's page cache (unlike
 * `insertPage`, which does). Any page object served before a removal keeps being returned
 * for the index that shifted into its place, so edits/rotations/boxes would be written to
 * an orphaned page and silently dropped on save. Invalidate after removals, mirroring what
 * the library itself does on insert.
 */
function invalidatePageCache(doc: import('pdf-lib').PDFDocument) {
  (doc as unknown as { pageCache: { invalidate(): void } }).pageCache.invalidate();
}

export async function exportEditedPdf(
  src: Uint8Array,
  changes: ExportChanges,
  fetchFont: (cls: FontClass) => Promise<Uint8Array>,
): Promise<ExportResult> {
  const { rgb, degrees } = await import('pdf-lib');
  const fontkitModule = await import('@pdf-lib/fontkit');

  // 0. True-removal pass: try to delete the original glyph objects for each edit via
  //    PDFium before pdf-lib ever touches the bytes. The removal rect deliberately uses
  //    the ORIGINAL glyph width (not widened for a longer replacement) — widening it here
  //    risks the >=50%-coverage match eating into a neighboring word on the same line.
  //    Widening for the replacement text still happens below, but only for the fallback
  //    cover rectangle, which is a purely visual concern.
  //    Edits on a page the user deleted are dropped first: their source-page index would
  //    otherwise address whatever page now sits there.
  const keptSources = changes.pages
    ? new Set(changes.pages.flatMap((slot) => (slot.source === null ? [] : [slot.source])))
    : null;
  const edits = keptSources ? changes.edits.filter((e) => keptSources.has(e.page)) : changes.edits;
  let workingBytes = src;
  let removed: boolean[] = edits.map(() => false);
  if (edits.length > 0) {
    try {
      const { removeTextInRects, REMOVAL_EPS } = await import('./removeText');
      const targets = edits.map((e) => ({ page: e.page, ...removalRect(e, REMOVAL_EPS) }));
      const result = await removeTextInRects(src, targets);
      workingBytes = result.bytes;
      removed = result.removed;
    } catch {
      // pdfium failed to load/parse this document (e.g. wasm fetch failure, an encrypted
      // or malformed PDF) — fall back to cover-and-redraw for every edit, unchanged from
      // before this feature existed.
    }
  }

  const doc = await loadPdf(workingBytes);
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

  // 1. Text edits — content-space coordinates, so they must be drawn before rotation/resize
  //    transforms, and before the page structure changes below (their `page` addresses the
  //    source document).
  for (const [i, e] of edits.entries()) {
    const page = doc.getPage(e.page);
    const f = await font(e.fontClass);
    if (!removed[i]) {
      // Original text wasn't cleanly removed — cover it like before, widened to fit
      // a longer replacement.
      page.drawRectangle({
        x: e.x - COVER_PAD,
        y: e.y - e.fontSize * 0.25 - COVER_PAD,
        width: Math.max(e.width, f.widthOfTextAtSize(e.text, e.fontSize)) + COVER_PAD * 2,
        height: e.fontSize * 1.25 + COVER_PAD * 2,
        color: rgb(e.cover.r, e.cover.g, e.cover.b),
      });
    }
    if (e.text.trim() !== '') {
      page.drawText(e.text, { x: e.x, y: e.y, size: e.fontSize, font: f, color: rgb(0, 0, 0) });
    }
  }

  // 2. Page structure — deletions and inserted blank pages. Text edits above already live
  //    on their source pages, and the UI only ever deletes pages or inserts new ones, so
  //    the kept source pages stay in ascending order and can be matched to the final list
  //    by removing the gaps and inserting blanks at their final positions.
  if (changes.pages) {
    const sources = changes.pages.flatMap((slot) => (slot.source === null ? [] : [slot.source]));
    const kept = new Set(sources);
    const ascending = sources.every((src, i) => i === 0 || src > sources[i - 1]);
    const valid = changes.pages.length > 0 && kept.size === sources.length && ascending
      && sources.every((src) => src >= 0 && src < doc.getPageCount());
    if (!valid) throw new Error('Page changes could not be applied — reload the file and try again.');
    for (let i = doc.getPageCount() - 1; i >= 0; i--) {
      if (!kept.has(i)) doc.removePage(i);
    }
    invalidatePageCache(doc);
    changes.pages.forEach((slot, index) => {
      if (slot.source === null) doc.insertPage(index, [slot.width, slot.height]);
    });
  }

  // 3. Rotations — delta on top of the page's existing /Rotate, addressed by final index.
  for (const { page: idx, rotation } of changes.rotations) {
    const page = doc.getPage(idx);
    const angle = (((page.getRotation().angle + rotation) % 360) + 360) % 360;
    page.setRotation(degrees(angle));
  }

  // 4. New text boxes — final page indexes, content-space coordinates like the edits above.
  for (const b of changes.boxes) {
    const page = doc.getPage(b.page);
    page.drawText(b.text, {
      x: b.x, y: b.y, size: b.fontSize,
      font: await font(b.fontClass),
      color: rgb(b.color.r, b.color.g, b.color.b),
      lineHeight: b.fontSize * 1.3,
    });
  }

  // 5. Resize — scale content and boxes (including inserted blank pages); 'fit' centers
  //    content on an exact target box.
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

  const fallbackCount = removed.filter((r) => !r).length;
  return { bytes: await doc.save(), fallbackCount };
}
