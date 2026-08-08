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

/** Load a PDF, mapping pdf-lib failures to friendly, typed errors. */
export async function loadPdf(bytes: Uint8Array, fileIndex?: number) {
  const { PDFDocument } = await import('pdf-lib');
  try {
    return await PDFDocument.load(bytes);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/encrypt/i.test(msg)) {
      throw new PdfToolError('encrypted', 'This PDF is password-protected. Remove the password first with the Unlock PDF tool (/unlock-pdf).', fileIndex);
    }
    throw new PdfToolError('invalid', 'This file is not a valid PDF.', fileIndex);
  }
}
