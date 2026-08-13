import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatBytes } from '../../lib/format';
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
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  function reset() {
    setPhase('idle');
    setResult(null);
  }

  function addFiles(files: File[]) {
    setEntries((prev) => [...prev, ...files.map((file) => ({ file, id: nextId++ }))]);
    reset();
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= entries.length) return;
    setEntries((prev) => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    reset();
  }

  function reorder(from: number, to: number) {
    if (from === to) return;
    setEntries((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    reset();
  }

  function remove(id: number) {
    setEntries((prev) => prev.filter((x) => x.id !== id));
    reset();
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
    <div className="space-y-4">
      <FileDropzone multiple label={entries.length > 0 ? 'Add more PDFs' : 'Choose PDFs to merge'} onFiles={addFiles} />
      {entries.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 2v20M2 12h20M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3" />
              </svg>
              Drag files to set the merge order
            </p>
            <Button type="button" variant="ghost" size="sm" data-testid="clear-file" onClick={clearAll}>
              Clear all
            </Button>
          </div>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {entries.map((e, i) => (
              <li
                key={e.id}
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragEnd={() => { setDragIndex(null); setDropIndex(null); }}
                onDragOver={(ev) => { ev.preventDefault(); setDropIndex(i); }}
                onDrop={(ev) => {
                  ev.preventDefault();
                  if (dragIndex !== null) reorder(dragIndex, i);
                  setDragIndex(null);
                  setDropIndex(null);
                }}
                className={cn(
                  'flex cursor-grab items-center gap-3 px-4 py-3 active:cursor-grabbing',
                  dragIndex === i && 'opacity-40',
                  dropIndex === i && dragIndex !== null && dragIndex !== i && 'bg-primary/5',
                )}
              >
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-panel text-xs font-semibold text-muted">{i + 1}</span>
                <svg className="h-4 w-4 shrink-0 text-muted" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
                  <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
                  <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
                </svg>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{e.file.name}</span>
                <span className="shrink-0 text-xs text-muted">{formatBytes(e.file.size)}</span>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>↑</Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === entries.length - 1}>↓</Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" className="text-destructive hover:text-destructive/80" onClick={() => remove(e.id)}>✕</Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {phase !== 'done' && (
        <Button
          type="button"
          data-testid="run-tool"
          onClick={merge}
          disabled={phase === 'working' || entries.length < 2}
          size="lg"
          className="h-12 w-full text-base"
        >
          {entries.length < 2 ? 'Add at least 2 PDFs to merge' : `Merge ${entries.length} PDFs`}
        </Button>
      )}
      {phase === 'working' && <ProgressBar value={null} />}
      {phase === 'error' && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {phase === 'done' && result && <DownloadResult filename="merged.pdf" bytes={result} note="Merged entirely on your device." />}
    </div>
  );
}
