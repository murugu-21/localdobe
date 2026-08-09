import { readFileSync } from 'node:fs';

// The AATL bundle is a committed build artifact (scripts/refresh-aatl.mjs) that the
// worker feeds to pdfcpu's trust pool. Losing or corrupting it silently downgrades
// every signature to "couldn't be fully verified".
test('AATL trust bundle exists and holds a plausible number of anchors', () => {
  const pem = readFileSync('public/trust/aatl.pem.txt', 'utf8');
  const count = (pem.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length;
  expect(count).toBeGreaterThan(100);
  expect((pem.match(/-----END CERTIFICATE-----/g) ?? []).length).toBe(count);
});
