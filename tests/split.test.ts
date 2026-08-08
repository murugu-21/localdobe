import { makePdf, pageCount } from './helpers';
import { parsePageRanges, splitPdf, RangeSyntaxError } from '../src/lib/pdf/split';
import { zipFiles } from '../src/lib/pdf/zip';
import { unzipSync } from 'fflate';

describe('parsePageRanges', () => {
  test('parses mixed ranges "1-3, 5, 7-" for 9 pages', () => {
    expect(parsePageRanges('1-3, 5, 7-', 9)).toEqual([[0, 1, 2], [4], [6, 7, 8]]);
  });
  test('single page and open start "-2"', () => {
    expect(parsePageRanges('-2', 5)).toEqual([[0, 1]]);
  });
  test('clamps out-of-bounds high end', () => {
    expect(parsePageRanges('4-99', 5)).toEqual([[3, 4]]);
  });
  test('rejects garbage token with the offending token attached', () => {
    expect(() => parsePageRanges('1-3, x', 5)).toThrowError(RangeSyntaxError);
    try { parsePageRanges('1-3, x', 5); } catch (e) {
      expect((e as RangeSyntaxError).token).toBe('x');
    }
  });
  test('rejects reversed and zero pages', () => {
    expect(() => parsePageRanges('3-1', 5)).toThrow(RangeSyntaxError);
    expect(() => parsePageRanges('0', 5)).toThrow(RangeSyntaxError);
  });
});

describe('splitPdf', () => {
  test('extracts each range into its own document', async () => {
    const src = await makePdf(['p1', 'p2', 'p3', 'p4']);
    const outs = await splitPdf(src, [[0, 1], [3]]);
    expect(outs).toHaveLength(2);
    expect(await pageCount(outs[0])).toBe(2);
    expect(await pageCount(outs[1])).toBe(1);
  });
});

describe('zipFiles', () => {
  test('round-trips entries', () => {
    const data = new Uint8Array([37, 80, 68, 70]);
    const zipped = zipFiles([{ name: 'part-1.pdf', data }]);
    const back = unzipSync(zipped);
    expect(Array.from(back['part-1.pdf'])).toEqual(Array.from(data));
  });
});
