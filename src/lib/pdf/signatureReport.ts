export type SignatureStatus = 'valid' | 'invalid' | 'unknown';

export interface SignatureReport {
  /** Three-state outcome. pdfcpu's Status is a bitfield: 1 unknown, 2 valid, 4 invalid.
   *  "unknown" is NOT a pass — it must never render as an intact signature. */
  status: SignatureStatus;
  signer: string;
  /** Issuing authority (the leaf certificate's Issuer), if present. */
  authority: string;
  signedAt: string;
  certValidFrom: string;
  certValidUntil: string;
  certExpired: boolean;
  /** 'untouched' | 'modified' | 'unknown' — from pdfcpu's DocModified tristate (0/1/2 = unknown/false/true). */
  docChanges: 'untouched' | 'modified' | 'unknown';
  fieldName: string;
  pageNr: number | null;
  /** Plain-language notes explaining the status — already deduplicated and translated. */
  notes: string[];
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

// pdfcpu model.SignatureReason bit values (1 << i) → plain language.
// Positive/neutral bits (no reason=1, doc-not-modified=2) intentionally have no note.
const REASON_NOTES: [number, string][] = [
  [4, 'The document was changed after it was signed.'],
  [8, 'The signature does not match the document — it may have been tampered with.'],
  [16, 'The signing time could not be verified.'],
  [32, 'The signing timestamp could not be verified.'],
  [64, 'The signer’s certificate is invalid.'],
  [128, 'The signer’s certificate authority isn’t in Adobe’s published trust list (which this tool checks against), so the signer’s identity couldn’t be independently confirmed. The signature itself may still be perfectly genuine.'],
  [256, 'The signer’s certificate (or one of its parent certificates) has expired.'],
  [512, 'The signer’s certificate has been revoked.'],
  [1024, 'The signature could not be fully processed.'],
  [2048, 'The signer used a self-signed certificate, which can’t be independently confirmed.'],
  [4096, 'Whether the certificate was revoked couldn’t be checked — this tool works entirely on your device, without internet lookups.'],
  [8192, 'The signature data is malformed.'],
  [16384, 'This type of signature isn’t supported.'],
];

/** Raw pdfcpu problem strings that duplicate a reason note or only make sense for the CLI. */
const DROP_PROBLEMS = [
  /certificate path was not resolved/i,
  /certificates? import/i, // "...import missing certificates with \"pdfcpu certificates import <file>\""
  /signed by unknown authority/i,
  /revocation check/i, // CRL/OCSP fetch spam — covered by the offline note
  /pdfcpu is offline/i, // covered by the offline revocation note (bit 4096)
  /CRL:/i,
  /OCSP:/i,
];

function tristate(v: unknown): 'untouched' | 'modified' | 'unknown' {
  if (v === 1) return 'untouched';
  if (v === 2) return 'modified';
  return 'unknown';
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Parse pdfcpu's ValidateSignatures JSON output defensively — field shapes vary across versions. */
export function parseSignatureReport(json: string): SignatureReport[] {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object').map((raw) => {
    const details = (raw.Details && typeof raw.Details === 'object' ? raw.Details : {}) as Record<string, unknown>;
    const signers = Array.isArray(details.Signers) ? details.Signers : [];
    const leaf = signers
      .map((s) => (s && typeof s === 'object' ? (s as Record<string, unknown>).Certificate : undefined))
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .find((c) => c.Leaf === true);

    let status: SignatureStatus =
      raw.Status === 2 ? 'valid' : raw.Status === 4 ? 'invalid' : 'unknown';

    const reason = typeof raw.Reason === 'number' ? raw.Reason : 0;
    // Revocation-only uncertainty (bit 4096, nothing else): the signature crypto
    // verified AND the certificate chain resolved to a bundled trust anchor — the
    // only unanswerable question offline is "was the certificate revoked?".
    // pdfcpu conservatively reports Status unknown here; Acrobat presents the same
    // situation as a valid signature with a revocation caveat. We do the same —
    // the caveat stays visible in the notes below.
    if (status === 'unknown' && reason === 4096) status = 'valid';

    // Set by the worker when the chain only verified with the clock at the signing
    // time (certificate lapsed after signing) — Acrobat's default semantics.
    const assessedAtSigningTime = raw.__assessedAtSigningTime === true;
    const notes = REASON_NOTES.filter(([bit]) => reason & bit).map(([, note]) => note);
    if (assessedAtSigningTime) {
      notes.unshift('The signer’s certificate has expired since this document was signed. It was valid at the time of signing, so the signature is assessed at that moment — the same way Adobe Acrobat does.');
    }
    for (const p of Array.isArray(raw.Problems) ? raw.Problems : []) {
      if (typeof p !== 'string' || p.trim() === '') continue;
      if (DROP_PROBLEMS.some((re) => re.test(p))) continue;
      notes.push(p);
    }

    return {
      status,
      signer: str(details.SignerName) ?? str(leaf?.Subject as string) ?? str(details.SignerIdentity) ?? 'Unknown signer',
      authority: str(leaf?.Issuer as string) ?? '',
      signedAt: fmtDate(str(details.SigningTime)),
      certValidFrom: fmtDate(str(leaf?.ValidFrom as string)),
      certValidUntil: fmtDate(str(leaf?.ValidThru as string)),
      // Computed against the real current date, not the engine's flag — replayed
      // entries were assessed with the clock at signing time, where Expired=false.
      certExpired: leaf?.Expired === true ||
        (typeof leaf?.ValidThru === 'string' && new Date(leaf.ValidThru).valueOf() < Date.now()),
      docChanges: tristate(raw.DocModified),
      fieldName: str(details.FieldName) ?? '',
      pageNr: typeof raw.PageNr === 'number' && raw.PageNr > 0 ? raw.PageNr : null,
      notes: [...new Set(notes)],
    };
  });
}
