import { makePdf, extractPageTexts } from './helpers';
import { EditSession, type TextEdit } from '../src/lib/pdf/edit/session';
import { exportEditedPdf } from '../src/lib/pdf/edit/export';
import { readFile } from 'node:fs/promises';
import type { FontClass } from '../src/lib/pdf/edit/fontMatch';

const fetchFont = async (cls: FontClass) =>
  new Uint8Array(await readFile(`public/fonts/Liberation${cls === 'sans' ? 'Sans' : cls === 'serif' ? 'Serif' : 'Mono'}-Regular.ttf`));

// The browser build resolves the pdfium wasm binary via a Vite `?url` import + fetch
// (see src/lib/pdf/edit/removeText.ts) — there's no bundler dev server to fetch from in
// this Node test environment. Real vitest coverage of that default path lives in the e2e
// suite (which runs against an actual `astro build` + `preview`); here we inject the wasm
// bytes straight from node_modules via `removeTextInRects`'s `wasmBinary` override, so
// these tests still exercise the *real* PDFium removal logic end to end.
vi.mock('../src/lib/pdf/edit/removeText', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/pdf/edit/removeText')>();
  const { readFileSync } = await import('node:fs');
  const wasmBinary = readFileSync('node_modules/@embedpdf/pdfium/dist/pdfium.wasm');
  return {
    ...actual,
    removeTextInRects: (src: Uint8Array, targets: Parameters<typeof actual.removeTextInRects>[1]) =>
      actual.removeTextInRects(src, targets, { wasmBinary }),
  };
});

function edit(text: string): TextEdit {
  return {
    page: 0, itemKey: '0:0', original: 'Hello World', text,
    x: 72, y: 700, width: 90, height: 14, fontSize: 14,
    fontClass: 'sans', cover: { r: 1, g: 1, b: 1 },
  };
}

// The brief's own local `extractText` calls `doc.destroy()` unguarded, which throws
// under the installed pdfjs-dist version in this Node test environment. Reusing the
// existing `extractPageTexts` helper (which guards that call) sidesteps the issue.
async function extractText(bytes: Uint8Array): Promise<string> {
  return (await extractPageTexts(bytes)).join(' ');
}

/**
 * Draws `word` as one PDFium TEXT object PER CHARACTER, at advancing x positions — the
 * dominant real-world text representation per the feasibility spike (print-to-PDF output
 * stores one text object per glyph, not per word/line). Returns the x just past the word,
 * so a caller can chain a second per-glyph word onto the same line.
 */
function drawPerGlyphWord(
  page: import('pdf-lib').PDFPage,
  font: import('pdf-lib').PDFFont,
  word: string,
  x: number,
  y: number,
  size: number,
): number {
  let cx = x;
  for (const ch of word) {
    page.drawText(ch, { x: cx, y, size, font });
    cx += font.widthOfTextAtSize(ch, size);
  }
  return cx;
}

/**
 * "Hello" then "iiii" on the same line, each character its own drawText call/PDFium TEXT
 * object — the layout that reproduces the reported neighbor-eating bug. Empirically
 * verified (see task report) that a *single*-object "iiii" run is never adversarial enough
 * at realistic mismatch sizes to cross the 50%-coverage threshold (its own bounding box is
 * simply too wide relative to a few points of overrun) — the failure mode is specific to
 * *narrow, per-glyph* objects, exactly as the review's "i, l, 1, |" callout says. With this
 * exact geometry (2pt inter-word gap, 3pt width mismatch): the pre-fix predicate
 * (COVER_PAD=1 reused for the removal rect, no center check) incorrectly matches the first
 * "i" glyph; the fixed predicate (REMOVAL_EPS=0.5) does not.
 */
async function makeTwoRunSameLineFixture(): Promise<{ src: Uint8Array; x: number; y: number; size: number; helloWidth: number }> {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 150]);
  const x = 72, y = 100, size = 14;
  const helloEndX = drawPerGlyphWord(page, font, 'Hello', x, y, size);
  const gap = 2; // a tight, but realistic, inter-word gap
  drawPerGlyphWord(page, font, 'iiii', helloEndX + gap, y, size);
  return { src: await doc.save(), x, y, size, helloWidth: helloEndX - x };
}

/** Two per-glyph words ("Hello" then "World", space-separated) on one line — edit the
 *  first word's whole span and confirm every one of its glyph objects is removed while
 *  every one of the neighboring word's glyph objects survives untouched. */
async function makePerGlyphTwoWordFixture(): Promise<{ src: Uint8Array; x: number; y: number; size: number; helloWidth: number }> {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 150]);
  const x = 72, y = 100, size = 14;
  const helloEndX = drawPerGlyphWord(page, font, 'Hello', x, y, size);
  const spaceWidth = font.widthOfTextAtSize(' ', size);
  drawPerGlyphWord(page, font, 'World', helloEndX + spaceWidth, y, size);
  return { src: await doc.save(), x, y, size, helloWidth: helloEndX - x };
}

describe('EditSession', () => {
  test('reverting an edit back to original removes it', () => {
    const s = new EditSession();
    s.recordEdit(edit('Goodbye'));
    expect(s.edits).toHaveLength(1);
    s.recordEdit(edit('Hello World'));
    expect(s.edits).toHaveLength(0);
    expect(s.isEmpty).toBe(true);
  });
  test('same itemKey overwrites rather than duplicates', () => {
    const s = new EditSession();
    s.recordEdit(edit('One'));
    s.recordEdit(edit('Two'));
    expect(s.edits).toHaveLength(1);
    expect(s.edits[0].text).toBe('Two');
  });
});

const noChanges = { edits: [], boxes: [], rotations: [], resize: null };

describe('exportEditedPdf', () => {
  test('edited text appears in output; new boxes are drawn; output stays valid', async () => {
    const src = await makePdf(['Hello World']);
    const { bytes } = await exportEditedPdf(src, {
      ...noChanges,
      edits: [edit('Replaced Words')],
      boxes: [{ page: 0, x: 100, y: 300, text: 'Brand New Box', fontSize: 18, fontClass: 'serif', color: { r: 0, g: 0, b: 0 } }],
    }, fetchFont);
    const text = await extractText(bytes);
    expect(text).toContain('Replaced Words');
    expect(text).toContain('Brand New Box');
  });

  test('no edits returns a loadable identical-page-count doc', async () => {
    const src = await makePdf(['a', 'b']);
    const { bytes, fallbackCount } = await exportEditedPdf(src, noChanges, fetchFont);
    const { PDFDocument } = await import('pdf-lib');
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
    expect(fallbackCount).toBe(0);
  });

  test('rotation delta composes with existing page rotation', async () => {
    const src = await makePdf(['a', 'b']);
    const { bytes } = await exportEditedPdf(src, { ...noChanges, rotations: [{ page: 1, rotation: 90 }] }, fetchFont);
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPage(0).getRotation().angle).toBe(0);
    expect(doc.getPage(1).getRotation().angle).toBe(90);
  });

  test('percent resize scales every page size', async () => {
    const src = await makePdf(['a']); // 612 x 792
    const { bytes } = await exportEditedPdf(src, { ...noChanges, resize: { kind: 'percent', value: 50 } }, fetchFont);
    const { PDFDocument } = await import('pdf-lib');
    const { width, height } = (await PDFDocument.load(bytes)).getPage(0).getSize();
    expect(width).toBeCloseTo(306);
    expect(height).toBeCloseTo(396);
  });

  test('fit-to-a4 produces exact A4 media box', async () => {
    const src = await makePdf(['a']);
    const { bytes } = await exportEditedPdf(src, { ...noChanges, resize: { kind: 'fit', target: 'a4' } }, fetchFont);
    const { PDFDocument } = await import('pdf-lib');
    const { width, height } = (await PDFDocument.load(bytes)).getPage(0).getSize();
    expect(width).toBeCloseTo(595.28, 1);
    expect(height).toBeCloseTo(841.89, 1);
  });

  describe('true text removal via pdfium (Sejda-style, not cover-and-redraw)', () => {
    test('replaced text: original glyphs are gone from extraction, replacement is present', async () => {
      const src = await makePdf(['Hello World']);
      const { bytes, fallbackCount } = await exportEditedPdf(src, { ...noChanges, edits: [edit('Goodbye')] }, fetchFont);
      const text = await extractText(bytes);
      expect(text).toContain('Goodbye');
      expect(text).not.toContain('Hello World');
      // Guard against partial removal slipping through a full-string check: neither half
      // of the original should survive on its own either.
      expect(text).not.toContain('Hello');
      expect(text).not.toContain('World');
      expect(fallbackCount).toBe(0);
    });

    test('delete-only edit (empty replacement text): original is gone, nothing new is drawn', async () => {
      const src = await makePdf(['Hello World']);
      const { bytes, fallbackCount } = await exportEditedPdf(src, { ...noChanges, edits: [edit('')] }, fetchFont);
      const text = await extractText(bytes);
      expect(text).not.toContain('Hello World');
      expect(text).not.toContain('Hello');
      expect(text).not.toContain('World');
      expect(text.trim()).toBe('');
      expect(fallbackCount).toBe(0);
    });

    test('fallback: a target rect nowhere near any text keeps the original (covered) and is counted', async () => {
      const src = await makePdf(['Hello World']);
      const farEdit: TextEdit = { ...edit('Replaced'), x: 400, y: 400 }; // nowhere near (72, 700)
      const { bytes, fallbackCount } = await exportEditedPdf(src, { ...noChanges, edits: [farEdit] }, fetchFont);
      const text = await extractText(bytes);
      expect(text).toContain('Hello World'); // never removed — nothing there to match the far-away rect
      expect(text).toContain('Replaced');
      expect(fallbackCount).toBe(1);
    });

    test('neighbor safety: a metric-width mismatch does not eat the adjacent run on the same line', async () => {
      const { src, x, y, size, helloWidth } = await makeTwoRunSameLineFixture();
      // Simulates pdf.js's metric-derived item width disagreeing with PDFium's own
      // (tighter) ink bounds by a few points — exactly the discrepancy that, before the
      // REMOVAL_EPS + center-check fix, let the removal rect's overrun cross the
      // coverage threshold against the narrow neighboring "iiii" run.
      const mismatchedEdit: TextEdit = {
        page: 0, itemKey: '0:0', original: 'Hello', text: 'Goodbye',
        x, y, width: helloWidth + 3, height: size, fontSize: size,
        fontClass: 'sans', cover: { r: 1, g: 1, b: 1 },
      };
      const { bytes, fallbackCount } = await exportEditedPdf(src, { ...noChanges, edits: [mismatchedEdit] }, fetchFont);
      const text = await extractText(bytes);
      expect(text).toContain('Goodbye');
      expect(text).toContain('iiii'); // the neighboring run must survive untouched
      expect(text).not.toContain('Hello');
      expect(fallbackCount).toBe(0);
    });

    test('per-glyph text (dominant real-world case): editing a whole word removes every glyph object, neighbor word survives', async () => {
      const { src, x, y, size, helloWidth } = await makePerGlyphTwoWordFixture();
      const e: TextEdit = {
        page: 0, itemKey: '0:0', original: 'Hello', text: 'Goodbye',
        x, y, width: helloWidth, height: size, fontSize: size,
        fontClass: 'sans', cover: { r: 1, g: 1, b: 1 },
      };
      const { bytes, fallbackCount } = await exportEditedPdf(src, { ...noChanges, edits: [e] }, fetchFont);
      const text = await extractText(bytes);
      expect(text).toContain('Goodbye');
      expect(text).toContain('World'); // every one of the neighbor's glyph objects survives
      expect(text).not.toContain('Hello'); // every one of "Hello"'s glyph objects was removed
      expect(fallbackCount).toBe(0);
    });
  });
});

describe('EditSession rotation/resize', () => {
  test('rotation accumulates and normalizes; isEmpty accounts for it', () => {
    const s = new EditSession();
    expect(s.isEmpty).toBe(true);
    s.rotatePage(0, 90);
    s.rotatePage(0, 90);
    expect(s.rotationOf(0)).toBe(180);
    expect(s.isEmpty).toBe(false);
    s.rotatePage(0, -90); s.rotatePage(0, -90);
    expect(s.rotationOf(0)).toBe(0);
    expect(s.rotations).toEqual([]);
    expect(s.isEmpty).toBe(true);
    s.resize = { kind: 'percent', value: 150 };
    expect(s.isEmpty).toBe(false);
  });
});

describe('EditSession boxesRaw', () => {
  test('includes empty boxes still being typed, unlike boxes', () => {
    const s = new EditSession();
    s.addBox({ page: 0, x: 10, y: 10, text: '', fontSize: 12, fontClass: 'sans', color: { r: 0, g: 0, b: 0 } });
    expect(s.boxesRaw).toHaveLength(1);
    expect(s.boxes).toHaveLength(0);
    s.updateBox(0, { text: 'Now filled' });
    expect(s.boxesRaw).toHaveLength(1);
    expect(s.boxes).toHaveLength(1);
  });
});
