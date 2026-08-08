import { parseSignatureReport } from '../src/lib/pdf/signatureReport';

test('parses a representative pdfcpu result, keeping raw', () => {
  const json = JSON.stringify([{
    Status: 1, Reason: '', Details: { SignerIdentity: 'Jane Doe', SigningTime: '2026-01-15T10:00:00Z' },
    DocModified: false, Problems: null,
  }]);
  const [r] = parseSignatureReport(json);
  expect(r.raw).toHaveProperty('Status');
  expect(typeof r.ok).toBe('boolean');
  expect(Array.isArray(r.problems)).toBe(true);
});

test('unknown shapes degrade gracefully instead of throwing', () => {
  const [r] = parseSignatureReport('[{"someFutureField": 42}]');
  expect(r.signer).toBe('Unknown signer');
  expect(r.raw).toEqual({ someFutureField: 42 });
});

test('empty report -> empty array', () => {
  expect(parseSignatureReport('[]')).toEqual([]);
  expect(parseSignatureReport('null')).toEqual([]);
});
