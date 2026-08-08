import { makePdf, extractPageTexts } from './helpers';
import { EditSession, type TextEdit } from '../src/lib/pdf/edit/session';
import { exportEditedPdf } from '../src/lib/pdf/edit/export';
import { readFile } from 'node:fs/promises';
import type { FontClass } from '../src/lib/pdf/edit/fontMatch';

const fetchFont = async (cls: FontClass) =>
  new Uint8Array(await readFile(`public/fonts/Liberation${cls === 'sans' ? 'Sans' : cls === 'serif' ? 'Serif' : 'Mono'}-Regular.ttf`));

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
    const out = await exportEditedPdf(src, {
      ...noChanges,
      edits: [edit('Replaced Words')],
      boxes: [{ page: 0, x: 100, y: 300, text: 'Brand New Box', fontSize: 18, fontClass: 'serif', color: { r: 0, g: 0, b: 0 } }],
    }, fetchFont);
    const text = await extractText(out);
    expect(text).toContain('Replaced Words');
    expect(text).toContain('Brand New Box');
  });

  test('no edits returns a loadable identical-page-count doc', async () => {
    const src = await makePdf(['a', 'b']);
    const out = await exportEditedPdf(src, noChanges, fetchFont);
    const { PDFDocument } = await import('pdf-lib');
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  });

  test('rotation delta composes with existing page rotation', async () => {
    const src = await makePdf(['a', 'b']);
    const out = await exportEditedPdf(src, { ...noChanges, rotations: [{ page: 1, rotation: 90 }] }, fetchFont);
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(0).getRotation().angle).toBe(0);
    expect(doc.getPage(1).getRotation().angle).toBe(90);
  });

  test('percent resize scales every page size', async () => {
    const src = await makePdf(['a']); // 612 x 792
    const out = await exportEditedPdf(src, { ...noChanges, resize: { kind: 'percent', value: 50 } }, fetchFont);
    const { PDFDocument } = await import('pdf-lib');
    const { width, height } = (await PDFDocument.load(out)).getPage(0).getSize();
    expect(width).toBeCloseTo(306);
    expect(height).toBeCloseTo(396);
  });

  test('fit-to-a4 produces exact A4 media box', async () => {
    const src = await makePdf(['a']);
    const out = await exportEditedPdf(src, { ...noChanges, resize: { kind: 'fit', target: 'a4' } }, fetchFont);
    const { PDFDocument } = await import('pdf-lib');
    const { width, height } = (await PDFDocument.load(out)).getPage(0).getSize();
    expect(width).toBeCloseTo(595.28, 1);
    expect(height).toBeCloseTo(841.89, 1);
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
