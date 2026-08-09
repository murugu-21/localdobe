// Regenerates public/trust/aatl.pem from Adobe's publicly published trust list (AATL).
//
// The AATL is the list of certificate authorities Adobe Acrobat trusts for document
// signatures. Adobe serves it openly at trustlist.adobe.com as a PDF whose single
// attachment (SecuritySettings.xml) carries base64 DER certificates plus per-identity
// trust flags. We keep ONLY identities flagged <Root>1</Root> — the ones Acrobat
// treats as trust anchors for approval signatures. Entries trusted solely for
// certified documents are excluded: pdfcpu can't scope trust per certificate, and
// over-trusting is worse than the honest "couldn't verify".
//
// Run manually (network required), then commit the regenerated file:
//   npm run refresh-aatl
import { mkdir, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

const SOURCE = 'https://trustlist.adobe.com/tl12.acrobatsecuritysettings';

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`fetch ${SOURCE}: ${res.status}`);
const pdf = Buffer.from(await res.arrayBuffer());

// The settings XML lives in one of the PDF's flate streams — find the largest
// stream that inflates to something containing certificates.
let xml = '';
for (let i = 0; i < pdf.length; i++) {
  const at = pdf.indexOf('stream', i);
  if (at === -1) break;
  i = at + 6;
  let start = at + 'stream'.length;
  if (pdf[start] === 0x0d) start++;
  if (pdf[start] === 0x0a) start++;
  const end = pdf.indexOf('endstream', start);
  if (end === -1) break;
  try {
    const inflated = inflateSync(pdf.subarray(start, end)).toString('latin1');
    if (inflated.includes('<SecuritySettings') && inflated.length > xml.length) xml = inflated;
  } catch { /* not a flate stream we care about */ }
}
if (!xml) throw new Error('SecuritySettings.xml not found in the downloaded trust list');

const identities = xml.match(/<Identity>[\s\S]*?<\/Identity>/g) ?? [];
const anchors = [];
for (const identity of identities) {
  if (!/<Root>\s*1\s*<\/Root>/.test(identity)) continue;
  const cert = identity.match(/<Certificate>\s*([A-Za-z0-9+/=\s]+?)\s*<\/Certificate>/)?.[1];
  if (cert) anchors.push(cert.replace(/\s+/g, ''));
}
if (anchors.length < 100) throw new Error(`only ${anchors.length} trust anchors extracted — format change? refusing to write`);

const pemBlocks = anchors.map((b64) => {
  const wrapped = b64.match(/.{1,64}/g).join('\n');
  return `-----BEGIN CERTIFICATE-----\n${wrapped}\n-----END CERTIFICATE-----\n`;
});

const header = [
  `Certificate authorities from Adobe's publicly published trust list (AATL).`,
  `Source: ${SOURCE}`,
  `Generated: ${new Date().toISOString().slice(0, 10)} — ${anchors.length} trust anchors (identities flagged Root=1 of ${identities.length} total).`,
  `Regenerate with: npm run refresh-aatl`,
  '',
].join('\n');

await mkdir(new URL('../public/trust/', import.meta.url), { recursive: true });
await writeFile(new URL('../public/trust/aatl.pem', import.meta.url), header + pemBlocks.join(''));
console.log(`wrote public/trust/aatl.pem — ${anchors.length} trust anchors from ${identities.length} identities`);
