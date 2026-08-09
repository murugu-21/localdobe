import { parseSignatureReport } from '../src/lib/pdf/signatureReport';

// pdfcpu enums: Status 1=unknown, 2=valid, 4=invalid (bitfield);
// Reason is a bitfield (128=cert not trusted, 8192=malformed, ...);
// DocModified tristate 0=unknown, 1=false (untouched), 2=true (modified).

function entry(overrides: Record<string, unknown> = {}) {
  return {
    Status: 1,
    Reason: 0,
    DocModified: 0,
    Problems: [],
    Details: {
      SignerName: '',
      SignerIdentity: 'Unknown',
      SigningTime: '2026-07-30T14:46:15+05:30',
      FieldName: 'Signature1',
      Signers: [{
        Certificate: {
          Leaf: true,
          Subject: 'DS ZOHO CORPORATION PRIVATE LIMITED 1',
          Issuer: 'e-Mudhra Sub CA for Class 3 Document Signer 2022',
          ValidFrom: '2023-12-19T11:22:15Z',
          ValidThru: '2026-12-18T11:22:15Z',
          Expired: false,
        },
      }],
    },
    PageNr: 1,
    ...overrides,
  };
}

test('Status 1 (unknown) is NOT reported as valid', () => {
  const [r] = parseSignatureReport(JSON.stringify([entry({ Status: 1 })]));
  expect(r.status).toBe('unknown');
});

test('Status 2 -> valid, Status 4 -> invalid', () => {
  expect(parseSignatureReport(JSON.stringify([entry({ Status: 2 })]))[0].status).toBe('valid');
  expect(parseSignatureReport(JSON.stringify([entry({ Status: 4 })]))[0].status).toBe('invalid');
});

test('extracts signer and issuing authority from the leaf certificate', () => {
  const [r] = parseSignatureReport(JSON.stringify([entry()]));
  expect(r.signer).toBe('DS ZOHO CORPORATION PRIVATE LIMITED 1');
  expect(r.authority).toBe('e-Mudhra Sub CA for Class 3 Document Signer 2022');
  expect(r.certValidUntil).toContain('2026');
  expect(r.fieldName).toBe('Signature1');
  expect(r.pageNr).toBe(1);
});

test('reason bits become plain-language notes (128 = untrusted authority)', () => {
  const [r] = parseSignatureReport(JSON.stringify([entry({ Reason: 128 })]));
  expect(r.notes.some((n) => /trust list/i.test(n))).toBe(true);
});

test('reason 8192 (malformed) becomes a note', () => {
  const [r] = parseSignatureReport(JSON.stringify([entry({ Reason: 8192 })]));
  expect(r.notes.some((n) => /malformed/i.test(n))).toBe(true);
});

test('CLI-only and network-spam problem strings are dropped', () => {
  const [r] = parseSignatureReport(JSON.stringify([entry({
    Problems: [
      'import missing certificates into pdfcpu’s local certificate store with "pdfcpu certificates import <file>"',
      'certificate revocation check for serial="17b12a9" using CRL: CRL: fetch http://x: lookup failed',
      'pdfcpu is offline, unable to perform certificate revocation checking',
      'certificate path was not resolved using the configured local certificate store',
    ],
  })]));
  expect(r.notes).toEqual([]);
});

test('genuinely novel problem strings are kept', () => {
  const [r] = parseSignatureReport(JSON.stringify([entry({ Problems: ['some brand new problem'] })]));
  expect(r.notes).toContain('some brand new problem');
});

test('DocModified tristate maps to docChanges', () => {
  expect(parseSignatureReport(JSON.stringify([entry({ DocModified: 1 })]))[0].docChanges).toBe('untouched');
  expect(parseSignatureReport(JSON.stringify([entry({ DocModified: 2 })]))[0].docChanges).toBe('modified');
  expect(parseSignatureReport(JSON.stringify([entry({ DocModified: 0 })]))[0].docChanges).toBe('unknown');
});

test('unknown shapes degrade gracefully instead of throwing', () => {
  const [r] = parseSignatureReport('[{"someFutureField": 42}]');
  expect(r.signer).toBe('Unknown signer');
  expect(r.status).toBe('unknown');
  expect(r.notes).toEqual([]);
});

test('empty report -> empty array', () => {
  expect(parseSignatureReport('[]')).toEqual([]);
  expect(parseSignatureReport('null')).toEqual([]);
});

test('revocation-only uncertainty (Reason 4096) is elevated to valid, like Acrobat', () => {
  const [r] = parseSignatureReport(JSON.stringify([entry({ Status: 1, Reason: 4096 })]));
  expect(r.status).toBe('valid');
  expect(r.notes.some((n) => /revoked/i.test(n))).toBe(true); // the caveat stays visible
});

test('revocation bit combined with a real problem stays unknown', () => {
  const [r] = parseSignatureReport(JSON.stringify([entry({ Status: 1, Reason: 4096 | 128 })]));
  expect(r.status).toBe('unknown');
});

test('signing-time-assessed entries get the Acrobat-parity note and stay honest about expiry', () => {
  const [r] = parseSignatureReport(JSON.stringify([{
    ...entry({ Status: 1, Reason: 4096 }),
    __assessedAtSigningTime: true,
  }]));
  expect(r.status).toBe('valid'); // revocation-only after replay
  expect(r.notes[0]).toMatch(/valid at the time of signing/i);
});

test('certExpired is computed from ValidThru against the real clock', () => {
  const e = entry({ Status: 1, Reason: 4096 });
  (e.Details.Signers[0].Certificate as Record<string, unknown>).ValidThru = '2020-01-01T00:00:00Z';
  (e.Details.Signers[0].Certificate as Record<string, unknown>).Expired = false;
  const [r] = parseSignatureReport(JSON.stringify([e]));
  expect(r.certExpired).toBe(true);
});
