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
      {phase === 'working' && <ProgressBar value={null} />}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
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
                sig.ok ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50',
              )}
            >
              <p className="font-semibold">{sig.ok ? '✓ Signature intact' : '⚠ Signature could not be fully verified'}</p>
              <dl className="mt-2 space-y-1">
                <div><dt className="inline font-medium">Signer:</dt> <dd className="inline">{sig.signer}</dd></div>
                {sig.signedAt && <div><dt className="inline font-medium">Signed at:</dt> <dd className="inline">{sig.signedAt}</dd></div>}
                <div><dt className="inline font-medium">Coverage:</dt> <dd className="inline">{sig.coversDoc ? 'entire document' : 'a revision of the document'}</dd></div>
              </dl>
              {sig.problems.length > 0 && (
                <ul className="mt-2 list-inside list-disc text-amber-900">
                  {sig.problems.map((p, j) => <li key={j}>{p}</li>)}
                </ul>
              )}
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-muted-foreground">Raw signature evidence</summary>
                <pre className="mt-2 overflow-x-auto rounded bg-background p-3 text-xs">{JSON.stringify(sig.raw, null, 2)}</pre>
              </details>
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
              className="w-full border-2 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-600"
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
