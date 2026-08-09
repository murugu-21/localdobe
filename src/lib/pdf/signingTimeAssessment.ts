/**
 * Acrobat-style validation-time semantics for certificate expiry.
 *
 * pdfcpu assesses certificate chains at the CURRENT time, so a signature whose
 * certificate was valid when the document was signed — but has lapsed since —
 * reports "expired" (Reason bit 256). Adobe Acrobat's default assesses at the
 * SIGNING time instead, which is why the same file shows valid there.
 *
 * The worker replays validation with the wall clock frozen to the signing time
 * (Go's js/wasm walltime reads `new Date()` live). These helpers decide which
 * entries deserve a replay and merge the replay results back, tagging merged
 * entries with `__assessedAtSigningTime` for the report UI.
 */

const REASON_CERT_EXPIRED = 256;

type Entry = Record<string, unknown> & {
  Reason?: number;
  Details?: { SigningTime?: string };
};

function signingTimeMs(entry: Entry): number | null {
  const t = entry.Details?.SigningTime;
  if (typeof t !== 'string') return null;
  const ms = new Date(t).valueOf();
  // Rejects unparseable values and Go's zero time (0001-01-01, large negative ms).
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/** Distinct signing times (ms) of entries that failed ONLY-at-current-time expiry. */
export function expiryReplayTimes(report: Entry[]): number[] {
  const times = new Set<number>();
  for (const entry of report) {
    if (typeof entry.Reason !== 'number' || !(entry.Reason & REASON_CERT_EXPIRED)) continue;
    const ms = signingTimeMs(entry);
    if (ms !== null) times.add(ms);
  }
  return [...times];
}

/**
 * Replaces entries in `first` with their `replay` counterparts when the replay
 * (assessed at `atMs`) cleared the expiry reason for that entry. Returns the
 * number of entries merged. Entries are matched by index — both reports come
 * from the same document in the same call order.
 */
export function mergeExpiryReplay(first: Entry[], replay: Entry[], atMs: number): number {
  let merged = 0;
  first.forEach((entry, i) => {
    const re = replay[i];
    if (!re || typeof entry.Reason !== 'number' || typeof re.Reason !== 'number') return;
    if (!(entry.Reason & REASON_CERT_EXPIRED)) return;
    if (signingTimeMs(entry) !== atMs) return;
    if (re.Reason & REASON_CERT_EXPIRED) return; // still expired at signing time — keep the honest failure
    (re as Record<string, unknown>).__assessedAtSigningTime = true;
    first[i] = re;
    merged++;
  });
  return merged;
}
