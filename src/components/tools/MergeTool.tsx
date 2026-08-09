import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileDropzone } from './shared/FileDropzone';
import { DownloadResult } from './shared/DownloadResult';
import { ProgressBar } from './shared/ProgressBar';

interface Entry { file: File; id: number }
type Phase = 'idle' | 'working' | 'done' | 'error';
let nextId = 0;

export default function MergeTool() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);

  function addFiles(files: File[]) {
    setEntries((prev) => [...prev, ...files.map((file) => ({ file, id: nextId++ }))]);
    setPhase('idle');
    setResult(null);
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= entries.length) return;
    setEntries((prev) => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setPhase('idle');
    setResult(null);
  }

  function remove(id: number) {
    setEntries((prev) => prev.filter((x) => x.id !== id));
    setPhase('idle');
    setResult(null);
  }

  function clearAll() {
    setEntries([]);
    setPhase('idle');
    setResult(null);
    setError(null);
  }

  async function merge() {
    setPhase('working');
    setError(null);
    try {
      const { mergePdfs } = await import('../../lib/pdf/merge');
      const buffers = await Promise.all(entries.map(async (e) => new Uint8Array(await e.file.arrayBuffer())));
      setResult(await mergePdfs(buffers));
      setPhase('done');
    } catch (err) {
      const fileIndex = (err as { fileIndex?: number }).fileIndex;
      const detail = err instanceof Error ? err.message : 'Something went wrong.';
      setError(fileIndex !== undefined ? `${entries[fileIndex]?.file.name}: ${detail}` : detail);
      setPhase('error');
    }
  }

  return (
    <div className="space-y-6">
      <FileDropzone multiple label="Choose PDFs to merge" onFiles={addFiles} />
      {entries.length > 0 && (
        <div className="flex items-center justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="clear-file"
            onClick={clearAll}
          >
            Clear all
          </Button>
        </div>
      )}
      {entries.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {entries.map((e, i) => (
            <li key={e.id} className="flex items-center gap-3 px-4 py-3">
              <span className="w-6 text-sm text-muted">{i + 1}.</span>
              <span className="flex-1 truncate text-sm font-medium">{e.file.name}</span>
              <Button type="button" variant="ghost" size="sm" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>↑</Button>
              <Button type="button" variant="ghost" size="sm" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === entries.length - 1}>↓</Button>
              <Button type="button" variant="ghost" size="sm" aria-label="Remove" className="text-red-500 hover:text-red-600" onClick={() => remove(e.id)}>✕</Button>
            </li>
          ))}
        </ul>
      )}
      {entries.length >= 2 && phase !== 'done' && (
        <Button
          type="button"
          data-testid="run-tool"
          onClick={merge}
          disabled={phase === 'working'}
          size="lg"
          className="w-full"
        >
          Merge {entries.length} PDFs
        </Button>
      )}
      {phase === 'working' && <ProgressBar value={null} />}
      {phase === 'error' && error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {phase === 'done' && result && <DownloadResult filename="merged.pdf" bytes={result} note="Merged entirely on your device." />}
    </div>
  );
}
