export interface SignatureReport {
  ok: boolean;
  signer: string;
  signedAt: string;
  coversDoc: boolean;
  problems: string[];
  raw: Record<string, unknown>;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

/** Parse pdfcpu's ValidateSignatures JSON output defensively — field names vary across versions. */
export function parseSignatureReport(json: string): SignatureReport[] {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object').map((raw) => {
    const details = (raw.Details && typeof raw.Details === 'object' ? raw.Details : {}) as Record<string, unknown>;
    const problems = ([] as unknown[])
      .concat(Array.isArray(raw.Problems) ? raw.Problems : [])
      .concat(str(raw.Reason) ? [raw.Reason] : [])
      .filter((p): p is string => typeof p === 'string' && p !== '');
    return {
      // pdfcpu status: treat only an explicit "valid" signal as ok.
      ok: raw.Status === 1 || raw.Status === 'valid' || raw.Valid === true,
      signer: str(details.SignerIdentity) ?? str(details.Signer) ?? str(raw.Signer) ?? 'Unknown signer',
      signedAt: str(details.SigningTime) ?? str(raw.SigningTime) ?? '',
      coversDoc: raw.DocModified === false || raw.CoversDoc === true,
      problems,
      raw,
    };
  });
}
