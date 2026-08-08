import { loadPdf } from './errors';

export class RangeSyntaxError extends Error {
  constructor(public token: string) {
    super(`Invalid page range: "${token}"`);
    this.name = 'RangeSyntaxError';
  }
}

/**
 * "1-3, 5, 7-" -> [[0,1,2],[4],[6..last]]. 1-based inclusive input, 0-based output.
 * Open ends: "7-" = 7..last, "-2" = 1..2. Out-of-range ends clamp to the document.
 */
export function parsePageRanges(input: string, pageCount: number): number[][] {
  const ranges: number[][] = [];
  for (const rawToken of input.split(',')) {
    const token = rawToken.trim();
    if (!token) continue;
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(token) ?? /^(\d+)$/.exec(token);
    if (!m || (m[1] === '' && (m[2] === '' || m[2] === undefined))) throw new RangeSyntaxError(token);
    const start = m[1] === '' ? 1 : parseInt(m[1], 10);
    const end = m.length === 2 ? start : m[2] === '' ? pageCount : parseInt(m[2], 10);
    const hi = Math.min(end, pageCount);
    if (start < 1 || start > end || start > pageCount) throw new RangeSyntaxError(token);
    const range: number[] = [];
    for (let p = start; p <= hi; p++) range.push(p - 1);
    ranges.push(range);
  }
  if (ranges.length === 0) throw new RangeSyntaxError(input.trim() || '(empty)');
  return ranges;
}

export async function splitPdf(src: Uint8Array, ranges: number[][]): Promise<Uint8Array[]> {
  const { PDFDocument } = await import('pdf-lib');
  const srcDoc = await loadPdf(src);
  const outputs: Uint8Array[] = [];
  for (const range of ranges) {
    const doc = await PDFDocument.create();
    const pages = await doc.copyPages(srcDoc, range);
    for (const p of pages) doc.addPage(p);
    outputs.push(await doc.save());
  }
  return outputs;
}
