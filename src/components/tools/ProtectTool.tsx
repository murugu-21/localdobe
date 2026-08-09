import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FileDropzone } from './shared/FileDropzone';
import { DownloadResult } from './shared/DownloadResult';
import { ProgressBar } from './shared/ProgressBar';

type Phase = 'idle' | 'working' | 'done' | 'error';

export default function ProtectTool() {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
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
    setConfirm('');
    setPhase('idle');
    setError(null);
    setResult(null);
  }

  async function run() {
    if (!file) return;
    if (password.length < 4) { setError('Password must be at least 4 characters.'); setPhase('error'); return; }
    if (password !== confirm) { setError('Passwords don’t match.'); setPhase('error'); return; }
    setPhase('working'); setError(null);
    try {
      const { encryptPdf } = await import('../../lib/pdf/pdfcpuClient');
      setResult(await encryptPdf(file.bytes, password));
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Encryption failed.');
      setPhase('error');
    }
  }

  return (
    <div className="space-y-6">
      {!file && <FileDropzone label="Choose a PDF to protect" onFiles={onFile} />}
      {file && (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{file.name}.pdf</p>
            <Button type="button" variant="ghost" size="sm" data-testid="clear-file" onClick={clear}>
              Start over
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="protect-password">Password</Label>
              <Input
                id="protect-password"
                data-testid="password-input"
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); resetIfDone(); }}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="protect-confirm">Confirm password</Label>
              <Input
                id="protect-confirm"
                data-testid="password-confirm"
                type="password"
                value={confirm}
                onChange={(e) => { setConfirm(e.target.value); resetIfDone(); }}
                autoComplete="new-password"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">AES-256 encryption. Your password never leaves this page — don’t forget it; there’s no way to recover it.</p>
          {phase !== 'done' && (
            <Button
              type="button"
              data-testid="run-tool"
              onClick={run}
              disabled={phase === 'working'}
              size="lg"
              className="w-full"
            >
              Protect PDF
            </Button>
          )}
          {phase === 'working' && <ProgressBar value={null} />}
        </>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {phase === 'done' && result && file && (
        <DownloadResult filename={`${file.name}-protected.pdf`} bytes={result} note="Encrypted with AES-256, entirely on your device." />
      )}
    </div>
  );
}
