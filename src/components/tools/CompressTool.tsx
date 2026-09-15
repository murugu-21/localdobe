import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FileDropzone } from './shared/FileDropzone';
import { ToolError } from './shared/ToolError';
import { DownloadResult } from './shared/DownloadResult';
import { ProgressBar } from './shared/ProgressBar';
import { track } from '../../lib/analytics';
import { FILE_READ_ERROR, readFileBytes } from '../../lib/readFile';
import { formatBytes, percentSaved } from '../../lib/format';
import { REPLAY_MASK } from '../../lib/replay';
import type { CompressPreset } from '../../lib/pdf/compressPresets';

type Phase = 'idle' | 'working' | 'done' | 'error';

const PRESETS: { value: CompressPreset; label: string; hint: string }[] = [
  { value: 'low', label: 'Light', hint: 'Fast cleanup, safest' },
  { value: 'medium', label: 'Balanced', hint: 'Dedup shared resources' },
  { value: 'high', label: 'Maximum', hint: 'Deepest deduplication' },
  { value: 'images', label: 'Shrink images', hint: 'Downsample scans & photos to 150 dpi' },
];

export default function CompressTool() {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [preset, setPreset] = useState<CompressPreset>('medium');
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<Uint8Array | null>(null);

  async function onFile([f]: File[]) {
    const bytes = await readFileBytes(f);
    if (!bytes) { setError(FILE_READ_ERROR); setPhase('error'); return; }
    setFile({ name: f.name.replace(/\.pdf$/i, ''), bytes });
    setPhase('idle'); setOut(null); setError(null); setStatus('');
  }

  function clear() {
    track('tool_reset');
    setFile(null);
    setPreset('medium');
    setPhase('idle');
    setStatus('');
    setError(null);
    setOut(null);
  }

  async function run() {
    if (!file) return;
    setPhase('working'); setError(null);
    track('tool_run_started', { compression_preset: preset, input_bytes: file.bytes.length });
    const startedAt = Date.now();
    try {
      const { compressPdf } = await import('../../lib/pdf/pdfcpuClient');
      const result = await compressPdf(file.bytes, preset, setStatus);
      setOut(result);
      track('pdf_compressed', {
        compression_preset: preset,
        input_bytes: file.bytes.length,
        output_bytes: result.length,
        duration_ms: Date.now() - startedAt,
      });
      setPhase('done');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Compression failed.';
      track('tool_failed', { message, compression_preset: preset, duration_ms: Date.now() - startedAt });
      setError(message);
      setPhase('error');
    }
  }

  const smaller = out && file ? out.length < file.bytes.length : false;

  return (
    <div className="space-y-6">
      {!file && <FileDropzone label="Choose a PDF to compress" onFiles={onFile} />}
      {file && (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground"><span className={REPLAY_MASK}>{file.name}.pdf</span> — {formatBytes(file.bytes.length)}</p>
            <Button type="button" variant="ghost" size="sm" data-testid="clear-file" onClick={clear}>
              Start over
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {PRESETS.map((p) => (
              <button
                type="button"
                key={p.value}
                data-testid={`preset-${p.value}`}
                onClick={() => {
                  if (p.value !== preset) track('tool_option_changed', { option: 'compression_preset', value: p.value });
                  setPreset(p.value);
                  if (phase === 'done') { setPhase('idle'); setOut(null); }
                }}
                className={cn(
                  'rounded-xl border-2 p-4 text-left transition',
                  preset === p.value ? 'border-primary bg-primary/5' : 'border-border',
                )}
              >
                <span className="block font-semibold">{p.label}</span>
                <span className="block text-xs text-muted-foreground">{p.hint}</span>
              </button>
            ))}
          </div>
          {preset === 'images' && (
            <p className="text-xs text-muted-foreground" data-testid="images-preset-note">
              Lossy: photos and scans drawn above 225 dpi are resampled to 150 dpi and re-encoded (JPEG for photos, lossless for
              flat graphics). Text, vector art, black-and-white scans and form fields are untouched. Digital signatures will no longer
              validate afterwards.
            </p>
          )}
          {phase !== 'done' && (
            <Button
              type="button"
              data-testid="run-tool"
              onClick={run}
              disabled={phase === 'working'}
              size="lg"
              className="w-full"
            >
              Compress PDF
            </Button>
          )}
          {phase === 'working' && (
            <div className="space-y-2">
              <ProgressBar value={null} />
              <p className="text-center text-sm text-muted-foreground">{status}</p>
            </div>
          )}
        </>
      )}
      {error && <ToolError message={error} />}
      {phase === 'done' && out && file && (smaller ? (
        <DownloadResult
          filename={`${file.name}-compressed.pdf`}
          bytes={out}
          note={`${formatBytes(file.bytes.length)} → ${formatBytes(out.length)} (${percentSaved(file.bytes.length, out.length)}% smaller)`}
        />
      ) : (
        <div className="space-y-3 text-center text-sm">
          <p>This PDF is already well optimized — compression couldn’t shrink it further.</p>
          <DownloadResult filename={`${file.name}-optimized.pdf`} bytes={out} />
        </div>
      ))}
    </div>
  );
}
