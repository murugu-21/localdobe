import { loadPdf, PdfToolError, type DecryptFn } from '../src/lib/pdf/errors';
import { makeEncryptedPdf, makePdf } from './helpers';

// makeEncryptedPdf() splices a bogus /Encrypt entry into the trailer — pdf-lib
// refuses to load it with a message matching /encrypt/i, exactly like a real
// owner-only-encrypted PDF. Since `decrypt` is injected here, none of these
// tests touch the real pdfcpu worker — only loadPdf's branching logic.

test('encrypted bytes + fake decrypt returning a valid PDF resolves; decrypt called exactly once', async () => {
  const enc = await makeEncryptedPdf();
  const plain = await makePdf(['unlocked']);
  let calls = 0;
  const decrypt: DecryptFn = async () => {
    calls++;
    return plain;
  };

  const doc = await loadPdf(enc, undefined, decrypt);

  expect(doc.getPageCount()).toBe(1);
  expect(calls).toBe(1);
});

test('encrypted bytes + fake decrypt that throws yields PdfToolError encrypted, fileIndex preserved', async () => {
  const enc = await makeEncryptedPdf();
  const decrypt: DecryptFn = async () => {
    throw new Error('decrypt worker unavailable');
  };

  const err = await loadPdf(enc, 3, decrypt).catch((e) => e);

  expect(err).toBeInstanceOf(PdfToolError);
  expect(err).toMatchObject({ code: 'encrypted', fileIndex: 3 });
});

test('encrypted bytes + fake decrypt returning garbage yields PdfToolError encrypted; no retry', async () => {
  const enc = await makeEncryptedPdf();
  let calls = 0;
  const decrypt: DecryptFn = async () => {
    calls++;
    return new Uint8Array([1, 2, 3]);
  };

  const err = await loadPdf(enc, undefined, decrypt).catch((e) => e);

  expect(err).toBeInstanceOf(PdfToolError);
  expect(err).toMatchObject({ code: 'encrypted' });
  expect(calls).toBe(1);
});

test('non-encrypted invalid bytes yield PdfToolError invalid; decrypt never called', async () => {
  let calls = 0;
  const decrypt: DecryptFn = async (bytes) => {
    calls++;
    return bytes;
  };

  const err = await loadPdf(new Uint8Array([1, 2, 3]), undefined, decrypt).catch((e) => e);

  expect(err).toBeInstanceOf(PdfToolError);
  expect(err).toMatchObject({ code: 'invalid' });
  expect(calls).toBe(0);
});

test('a plain valid PDF loads without ever calling decrypt', async () => {
  let calls = 0;
  const decrypt: DecryptFn = async (bytes) => {
    calls++;
    return bytes;
  };
  const plain = await makePdf(['ok']);

  const doc = await loadPdf(plain, undefined, decrypt);

  expect(doc.getPageCount()).toBe(1);
  expect(calls).toBe(0);
});
