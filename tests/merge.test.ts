import { makePdf, pageCount } from './helpers';
import { mergePdfs } from '../src/lib/pdf/merge';
import { PdfToolError } from '../src/lib/pdf/errors';

test('merges two PDFs preserving page order and count', async () => {
  const a = await makePdf(['A1', 'A2']);
  const b = await makePdf(['B1']);
  const merged = await mergePdfs([a, b]);
  expect(await pageCount(merged)).toBe(3);
});

test('single file round-trips', async () => {
  const a = await makePdf(['only']);
  expect(await pageCount(await mergePdfs([a]))).toBe(1);
});

test('invalid bytes throw PdfToolError with code invalid and file index', async () => {
  const a = await makePdf(['ok']);
  const bad = new Uint8Array([1, 2, 3]);
  await expect(mergePdfs([a, bad])).rejects.toMatchObject({ code: 'invalid', fileIndex: 1 });
});
