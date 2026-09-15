import { UNLOCK_PDF_HINT } from '../toolLinks';

export type PdfErrorCode = 'encrypted' | 'invalid';

export class PdfToolError extends Error {
  constructor(
    public code: PdfErrorCode,
    message: string,
    public fileIndex?: number,
  ) {
    super(message);
    this.name = 'PdfToolError';
  }
}

export type DecryptFn = (bytes: Uint8Array) => Promise<Uint8Array>;

/**
 * Extra pdf-lib load options. `updateMetadata: false` matters for tools that
 * report on or clean a document's existing metadata: pdf-lib's default load
 * rewrites Producer (to pdf-lib itself) and ModDate before the caller sees the
 * document, which would both misreport and re-stamp the file being inspected.
 */
export interface LoadPdfOptions {
  updateMetadata?: boolean;
}

// IRCC-style forms (e.g. Canadian government PDFs) carry owner-password-only
// encryption: an EMPTY user password with restrictions locked behind an owner
// password. pdfjs opens these fine (thumbnails/detection work), but pdf-lib
// refuses to load them at all — which used to dead-end as "password-protected"
// even though no password actually exists. pdfcpu's decrypt with an empty
// password strips this kind of owner-only encryption; once that succeeds,
// pdf-lib can load the result normally. A file with a REAL user password (or
// one that's just corrupt) still fails decryption and falls through to the
// existing, now-accurate, encrypted error below.
async function pdfcpuEmptyPasswordDecrypt(bytes: Uint8Array): Promise<Uint8Array> {
  const { decryptPdf } = await import('./pdfcpuClient');
  return decryptPdf(bytes, '');
}

/** Load a PDF, mapping pdf-lib failures to friendly, typed errors. */
export async function loadPdf(
  bytes: Uint8Array,
  fileIndex?: number,
  decrypt: DecryptFn = pdfcpuEmptyPasswordDecrypt,
  options: LoadPdfOptions = {},
) {
  const { PDFDocument } = await import('pdf-lib');
  try {
    return await PDFDocument.load(bytes, options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/encrypt/i.test(msg)) {
      try {
        const decrypted = await decrypt(bytes);
        return await PDFDocument.load(decrypted, options);
      } catch {
        // decrypt() failed, or the "decrypted" bytes still don't load: a real
        // user password (or something pdfcpu couldn't strip). Try exactly
        // once — no retry loop — and report the existing, accurate message.
        throw new PdfToolError(
          'encrypted',
          `This PDF is password-protected. Remove the password first with ${UNLOCK_PDF_HINT}.`,
          fileIndex,
        );
      }
    }
    throw new PdfToolError('invalid', 'This file is not a valid PDF.', fileIndex);
  }
}
