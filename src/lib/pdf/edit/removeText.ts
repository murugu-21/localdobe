import type { WrappedPdfiumModule } from '@embedpdf/pdfium';

export interface RemoveTextTarget {
  page: number;
  /** PDF user-space rect, bottom-left anchored — same geometry as the pdf-lib cover rect. */
  x: number; y: number; width: number; height: number;
}

export interface RemoveTextResult {
  bytes: Uint8Array;
  /** removed[i] is true iff at least one text object was actually deleted for targets[i]. */
  removed: boolean[];
}

export interface RemoveTextOptions {
  /**
   * Overrides how the pdfium wasm binary is obtained. The browser/worker default
   * (`?url` import + fetch, so Vite content-hashes the asset into `_astro/`) needs a
   * bundler and `fetch`, neither of which exist in the Vitest/Node test environment —
   * tests pass the bytes directly (e.g. read from node_modules) instead.
   */
  wasmBinary?: ArrayBuffer | Uint8Array;
}

interface Rect { left: number; bottom: number; right: number; top: number }

/** A glyph must have at least this fraction of its own bounding-box area inside the
 *  target rect to count as "covered" — keeps a same-line-height neighbor safe. */
const COVERAGE_THRESHOLD = 0.5;

const TYPE_TEXT = 1;

let pdfiumPromise: Promise<WrappedPdfiumModule> | null = null;

async function resolveDefaultWasmBinary(): Promise<ArrayBuffer> {
  // Vite ?url import: resolves to a content-hashed, cache-busted asset URL under
  // dist/_astro/ at build time. Only reachable in a bundler + fetch environment.
  const { default: wasmUrl } = await import('@embedpdf/pdfium/pdfium.wasm?url');
  const res = await fetch(wasmUrl);
  if (!res.ok) throw new Error(`Failed to fetch pdfium.wasm (${res.status})`);
  return res.arrayBuffer();
}

async function initPdfium(wasmBinary?: ArrayBuffer | Uint8Array): Promise<WrappedPdfiumModule> {
  const { init } = await import('@embedpdf/pdfium');
  const binary = wasmBinary ?? (await resolveDefaultWasmBinary());
  const pdfium = await init({ wasmBinary: binary as ArrayBuffer });
  pdfium.PDFiumExt_Init();
  return pdfium;
}

function getPdfium(wasmBinary?: ArrayBuffer | Uint8Array): Promise<WrappedPdfiumModule> {
  if (!pdfiumPromise) {
    pdfiumPromise = initPdfium(wasmBinary).catch((err) => {
      pdfiumPromise = null; // allow a retry on the next call instead of caching the failure forever
      throw err;
    });
  }
  return pdfiumPromise;
}

function getBounds(pdfium: WrappedPdfiumModule, obj: number): Rect | null {
  const { wasmExports, getValue } = pdfium.pdfium;
  const left = wasmExports.malloc(4);
  const bottom = wasmExports.malloc(4);
  const right = wasmExports.malloc(4);
  const top = wasmExports.malloc(4);
  try {
    if (!pdfium.FPDFPageObj_GetBounds(obj, left, bottom, right, top)) return null;
    return {
      left: getValue(left, 'float'),
      bottom: getValue(bottom, 'float'),
      right: getValue(right, 'float'),
      top: getValue(top, 'float'),
    };
  } finally {
    wasmExports.free(left);
    wasmExports.free(bottom);
    wasmExports.free(right);
    wasmExports.free(top);
  }
}

function rectArea(r: Rect): number {
  return Math.max(0, r.right - r.left) * Math.max(0, r.top - r.bottom);
}

function intersectArea(a: Rect, b: Rect): number {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.right, b.right);
  const bottom = Math.max(a.bottom, b.bottom);
  const top = Math.min(a.top, b.top);
  if (right <= left || top <= bottom) return 0;
  return (right - left) * (top - bottom);
}

function saveDocToBytes(pdfium: WrappedPdfiumModule, doc: number): Uint8Array {
  const writer = pdfium.PDFiumExt_OpenFileWriter();
  try {
    if (!pdfium.PDFiumExt_SaveAsCopy(doc, writer)) throw new Error('PDFiumExt_SaveAsCopy failed');
    const size = pdfium.PDFiumExt_GetFileWriterSize(writer);
    const ptr = pdfium.pdfium.wasmExports.malloc(size);
    try {
      pdfium.PDFiumExt_GetFileWriterData(writer, ptr, size);
      return pdfium.pdfium.HEAPU8.slice(ptr, ptr + size);
    } finally {
      pdfium.pdfium.wasmExports.free(ptr);
    }
  } finally {
    pdfium.PDFiumExt_CloseFileWriter(writer);
  }
}

/**
 * Deletes the PDF text objects that back each target rect, so the original text is
 * genuinely gone (not just painted over) in the returned bytes.
 *
 * Only text objects living directly on the page (not nested inside a Form XObject) are
 * removed. `FPDFFormObj_RemoveObject` looked promising in a spike but empirically does
 * NOT survive `FPDFPage_GenerateContent` + save — the form's own appearance stream is
 * never regenerated (no public PDFium API exposes that), so the "removed" text silently
 * reappears on reload. Leaving those matches alone means `removed[i]` stays false and the
 * caller falls back to its cover-and-redraw path for that edit — safe, just not a true
 * removal. The vast majority of real-world text (glyph-level, print-to-PDF output
 * included) lives directly on the page.
 *
 * Also deliberately NOT using this build's `EPDFText_RedactInRect` / `EPDFPage_ApplyRedactions`
 * extension APIs: verified empirically that they paint a permanent solid black box (a new
 * PATH fill object) over the redacted region in addition to removing the text — worse than
 * the plain white cover box this replaces, since the caller draws its own replacement text
 * on top and a hardcoded black rect can't be recolored via the exposed API surface.
 */
export async function removeTextInRects(
  src: Uint8Array,
  targets: RemoveTextTarget[],
  options: RemoveTextOptions = {},
): Promise<RemoveTextResult> {
  if (targets.length === 0) return { bytes: src, removed: [] };

  const pdfium = await getPdfium(options.wasmBinary);
  const { wasmExports, HEAPU8 } = pdfium.pdfium;

  const docPtr = wasmExports.malloc(src.length);
  HEAPU8.set(src, docPtr);
  const doc = pdfium.FPDF_LoadMemDocument(docPtr, src.length, '');
  if (!doc) {
    // Encrypted / malformed for this parser — leave everything to the caller's fallback.
    wasmExports.free(docPtr);
    return { bytes: src, removed: targets.map(() => false) };
  }

  const removed = targets.map(() => false);
  const byPage = new Map<number, number[]>();
  targets.forEach((t, i) => {
    const list = byPage.get(t.page);
    if (list) list.push(i);
    else byPage.set(t.page, [i]);
  });

  for (const [pageIndex, targetIdxs] of byPage) {
    const page = pdfium.FPDF_LoadPage(doc, pageIndex);
    if (!page) continue; // out-of-range page index: leave those targets un-removed

    const candidates: { obj: number; bounds: Rect; consumed: boolean }[] = [];
    const count = pdfium.FPDFPage_CountObjects(page);
    for (let i = 0; i < count; i++) {
      const obj = pdfium.FPDFPage_GetObject(page, i);
      if (pdfium.FPDFPageObj_GetType(obj) !== TYPE_TEXT) continue;
      const bounds = getBounds(pdfium, obj);
      if (bounds) candidates.push({ obj, bounds, consumed: false });
    }

    let pageDirty = false;
    for (const idx of targetIdxs) {
      const t = targets[idx];
      const rect: Rect = { left: t.x, bottom: t.y, right: t.x + t.width, top: t.y + t.height };
      for (const c of candidates) {
        if (c.consumed) continue;
        const area = rectArea(c.bounds);
        if (area <= 0) continue;
        if (intersectArea(rect, c.bounds) / area < COVERAGE_THRESHOLD) continue;
        if (pdfium.FPDFPage_RemoveObject(page, c.obj)) {
          pdfium.FPDFPageObj_Destroy(c.obj);
          c.consumed = true;
          removed[idx] = true;
          pageDirty = true;
        }
      }
    }

    if (pageDirty) pdfium.FPDFPage_GenerateContent(page);
    pdfium.FPDF_ClosePage(page);
  }

  const bytes = saveDocToBytes(pdfium, doc);
  pdfium.FPDF_CloseDocument(doc);
  wasmExports.free(docPtr);

  return { bytes, removed };
}
