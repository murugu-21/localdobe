import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FileDropzone } from './shared/FileDropzone';
import { DownloadResult } from './shared/DownloadResult';
import { ProgressBar } from './shared/ProgressBar';

type Phase = 'idle' | 'working' | 'done' | 'error';

export default function UnlockTool() {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Uint8Array | null>(null);

  function resetIfDone() {
    if (phase === 'done') { setPhase('idle'); setResult(null); }
  }

  async function onFile([f]: File[]) {
    setFile({ name: f.name.replace(/\.pdf$/i, ''), bytes: new Uint8Array(await f.arrayBuffer()) });
    setPhase('idle'); setResult(null); setError(null);
  }

  function clear() {
    setFile(null);
    setPassword('');
    setPhase('idle');
    setError(null);
    setResult(null);
  }

  async function run() {
    if (!file) return;
    setPhase('working'); setError(null);
    try {
      const { decryptPdf } = await import('../../lib/pdf/pdfcpuClient');
      setResult(await decryptPdf(file.bytes, password));
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error && /password/i.test(err.message)
        ? 'That password didn’t work. Double-check it — unlocking requires the correct password.'
        : err instanceof Error ? err.message : 'Decryption failed.');
      setPhase('error');
    }
  }

  return (
    <div className="space-y-6">
      {!file && <FileDropzone label="Choose a password-protected PDF" onFiles={onFile} />}
      {file && (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{file.name}.pdf</p>
            <Button type="button" variant="ghost" size="sm" data-testid="clear-file" onClick={clear}>
              Start over
            </Button>
          </div>
          <div className="space-y-1">
            <Label htmlFor="unlock-password">Password</Label>
            <Input
              id="unlock-password"
              data-testid="password-input"
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); resetIfDone(); }}
              autoComplete="current-password"
            />
          </div>
          <p className="text-xs text-muted-foreground">You must know the password — this removes protection from PDFs you own; it can’t crack passwords. The password never leaves this page.</p>
          {phase !== 'done' && (
            <Button
              type="button"
              data-testid="run-tool"
              onClick={run}
              disabled={phase === 'working'}
              size="lg"
              className="w-full"
            >
              Unlock PDF
            </Button>
          )}
          {phase === 'working' && <ProgressBar value={null} />}
        </>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {phase === 'done' && result && file && (
        <DownloadResult filename={`${file.name}-unlocked.pdf`} bytes={result} note="Password removed, entirely on your device." />
      )}
    </div>
  );
}
