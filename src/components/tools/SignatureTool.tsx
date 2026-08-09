import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FileDropzone } from './shared/FileDropzone';
import { DownloadResult } from './shared/DownloadResult';
import { ProgressBar } from './shared/ProgressBar';
import type { SignatureReport } from '../../lib/pdf/signatureReport';

type Phase = 'idle' | 'working' | 'done' | 'error';

export default function SignatureTool() {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [report, setReport] = useState<SignatureReport[] | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removed, setRemoved] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile([f]: File[]) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    setFile({ name: f.name.replace(/\.pdf$/i, ''), bytes });
    setPhase('working'); setReport(null); setRemoved(null); setError(null);
    try {
      const { validateSignatures } = await import('../../lib/pdf/pdfcpuClient');
      setReport(await validateSignatures(bytes));
      setPhase('done');
    } catch (err) {
      // pdfcpu (v0.14.0) errors with its ErrNoSignatures sentinel ("validate signatures: no signatures
      // present") on docs with no signature dictionary — that's a "no signatures" answer, not a failure.
      // This match is coupled to that exact pdfcpu wording; revisit if the engine version changes.
      if (err instanceof Error && /no signature/i.test(err.message)) {
        setReport([]);
        setPhase('done');
      } else {
        setError(err instanceof Error ? err.message : 'Validation failed.');
        setPhase('error');
      }
    }
  }

  function clear() {
    setFile(null);
    setPhase('idle');
    setReport(null);
    setRemoving(false);
    setRemoved(null);
    setError(null);
  }

  async function remove() {
    if (!file) return;
    setRemoving(true); setError(null);
    try {
      const { removeSignatures } = await import('../../lib/pdf/pdfcpuClient');
      setRemoved(await removeSignatures(file.bytes));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove signatures.');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="space-y-6">
      {!file && <FileDropzone label="Choose a PDF to inspect" onFiles={onFile} />}
      {file && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{file.name}.pdf</p>
          <Button type="button" variant="ghost" size="sm" data-testid="clear-file" onClick={clear}>
            Start over
          </Button>
        </div>
      )}
      {phase === 'working' && <ProgressBar value={null} />}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {phase === 'done' && report && (
        <>
          {report.length === 0 && (
            <p data-testid="sig-report" className="rounded-xl border border-border bg-panel/40 p-5 text-sm">
              No digital signatures found in this PDF.
            </p>
          )}
          {report.map((sig, i) => (
            <div
              key={i}
              data-testid="sig-report"
              className={cn(
                'rounded-xl border p-5 text-sm',
                sig.status === 'valid' && 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950',
                sig.status === 'invalid' && 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950',
                sig.status === 'unknown' && 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950',
              )}
            >
              <p className="font-semibold">
                {sig.status === 'valid' && '✓ Signature is valid'}
                {sig.status === 'invalid' && '✕ Signature is not valid'}
                {sig.status === 'unknown' && '⚠ Signature found — couldn’t be fully verified'}
              </p>
              <dl className="mt-3 space-y-1.5">
                <div><dt className="inline font-medium">Signed by:</dt> <dd className="inline">{sig.signer}</dd></div>
                {sig.authority && (
                  <div><dt className="inline font-medium">Issuing authority:</dt> <dd className="inline">{sig.authority}</dd></div>
                )}
                {sig.signedAt && <div><dt className="inline font-medium">Signed on:</dt> <dd className="inline">{sig.signedAt}</dd></div>}
                {sig.certValidUntil && (
                  <div>
                    <dt className="inline font-medium">Certificate valid:</dt>{' '}
                    <dd className="inline">
                      {sig.certValidFrom} – {sig.certValidUntil}
                      {sig.certExpired && <span className="ml-1 font-medium text-red-700 dark:text-red-300">(expired)</span>}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="inline font-medium">Changes since signing:</dt>{' '}
                  <dd className="inline">
                    {sig.docChanges === 'untouched' && 'none — the document is exactly as signed'}
                    {sig.docChanges === 'modified' && 'the document WAS changed after signing'}
                    {sig.docChanges === 'unknown' && 'could not be determined'}
                  </dd>
                </div>
                {sig.fieldName && (
                  <div>
                    <dt className="inline font-medium">Signature field:</dt>{' '}
                    <dd className="inline">{sig.fieldName}{sig.pageNr ? ` (page ${sig.pageNr})` : ''}</dd>
                  </div>
                )}
              </dl>
              {sig.notes.length > 0 && (
                <div className="mt-3">
                  <p className="font-medium">What this means:</p>
                  <ul className="mt-1 list-inside list-disc space-y-1">
                    {sig.notes.map((p, j) => <li key={j}>{p}</li>)}
                  </ul>
                </div>
              )}
            </div>
          ))}
          {report.length > 0 && !removed && (
            <Button
              type="button"
              data-testid="remove-signatures"
              onClick={remove}
              disabled={removing}
              variant="outline"
              size="lg"
              className="w-full border-2 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {removing ? 'Removing…' : 'Remove all signatures'}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            Integrity checks run fully on your device. Trust-chain verification against certificate authorities may be
            limited in-browser (there’s no OS certificate store), so a valid signature can show as “not fully verified”.
            Removing a signature strips it from the file without altering page content.
          </p>
        </>
      )}
      {removed && file && (
        <DownloadResult filename={`${file.name}-unsigned.pdf`} bytes={removed} note="Signatures removed on your device." />
      )}
    </div>
  );
}
