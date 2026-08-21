import { useEffect, useRef, useState } from 'react';
import type { PageSize } from '../../lib/pdf/imagesToPdf';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DownloadResult } from './shared/DownloadResult';
import { FileDropzone } from './shared/FileDropzone';
import { ProgressBar } from './shared/ProgressBar';

interface Entry { file: File; id: number; url: string }
type Phase = 'idle' | 'working' | 'done' | 'error';
let nextId = 0;

const PAGE_SIZES: { id: PageSize; label: string }[] = [
  { id: 'fit', label: 'Fit to image' },
  { id: 'a4', label: 'A4' },
  { id: 'letter', label: 'Letter' },
];

function isImage(f: File) {
  return f.type === 'image/jpeg' || f.type === 'image/png' || /\.(jpe?g|png)$/i.test(f.name);
}

export default function ImageToPdfTool() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [pageSize, setPageSize] = useState<PageSize>('fit');
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<{ filename: string; bytes: Uint8Array } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  // Mirrors current `entries` for the unmount cleanup below (whose closure would
  // otherwise only ever see the empty array from the initial render).
  const entriesRef = useRef<Entry[]>([]);
  useEffect(() => { entriesRef.current = entries; }, [entries]);
  useEffect(() => () => { entriesRef.current.forEach((e) => URL.revokeObjectURL(e.url)); }, []);

  function reset() {
    setPhase('idle');
    setResult(null);
  }

  function addFiles(files: File[]) {
    setEntries((prev) => [...prev, ...files.map((file) => ({ file, id: nextId++, url: URL.createObjectURL(file) }))]);
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
    setEntries((prev) => {
      const target = prev.find((x) => x.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((x) => x.id !== id);
    });
    reset();
  }

  function clearAll() {
    entries.forEach((e) => URL.revokeObjectURL(e.url));
    setEntries([]);
    setPhase('idle');
    setResult(null);
    setError(null);
  }

  async function convert() {
    if (entries.length === 0) return;
    setPhase('working');
    setError(null);
    const { imagesToPdf, UnsupportedImageError } = await import('../../lib/pdf/imagesToPdf');
    try {
      const bytesList = await Promise.all(entries.map(async (e) => new Uint8Array(await e.file.arrayBuffer())));
      const out = await imagesToPdf(bytesList, pageSize);
      const baseName = entries[0].file.name.replace(/\.(jpe?g|png)$/i, '');
      setResult({ filename: `${baseName}.pdf`, bytes: out });
      setPhase('done');
    } catch (err) {
      setError(err instanceof UnsupportedImageError ? err.message : 'Something went wrong.');
      setPhase('error');
    }
  }

  return (
    <div className="space-y-4">
      <FileDropzone
        multiple
        label={entries.length > 0 ? 'Add more images' : 'Choose images to convert'}
        onFiles={addFiles}
        accept="image/jpeg,image/png,.jpg,.jpeg,.png"
        validate={isImage}
        typeErrorMessage="That doesn't look like a JPG or PNG image."
      />
      {entries.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 2v20M2 12h20M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3" />
              </svg>
              Drag images to set the page order
            </p>
            <Button type="button" variant="ghost" size="sm" data-testid="clear-file" onClick={clearAll}>
              Start over
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {entries.map((e, i) => (
              <div
                key={e.id}
                data-testid={`img-item-${i}`}
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
                  'relative cursor-grab overflow-hidden rounded-lg border-2 border-border active:cursor-grabbing',
                  dragIndex === i && 'opacity-40',
                  dropIndex === i && dragIndex !== null && dragIndex !== i && 'border-accent ring-2 ring-accent/30',
                )}
              >
                <span className="absolute top-1 left-1 z-10 inline-flex size-6 items-center justify-center rounded-md bg-panel text-xs font-semibold text-muted">
                  {i + 1}
                </span>
                <span className="flex aspect-square items-center justify-center bg-panel/40 p-1">
                  <img src={e.url} alt={`Image ${i + 1}`} className="max-h-full max-w-full" />
                </span>
                <div className="flex items-center justify-center gap-1 border-t border-border py-1">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Move up" data-testid={`img-up-${i}`} onClick={() => move(i, -1)} disabled={i === 0}>↑</Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Move down" data-testid={`img-down-${i}`} onClick={() => move(i, 1)} disabled={i === entries.length - 1}>↓</Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove" data-testid={`img-remove-${i}`} className="text-destructive hover:text-destructive/80" onClick={() => remove(e.id)}>✕</Button>
                </div>
              </div>
            ))}
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium">Page size</p>
            <div className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-panel/40 p-1" role="tablist" aria-label="Page size">
              {PAGE_SIZES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={pageSize === p.id}
                  data-testid={`page-size-${p.id}`}
                  onClick={() => { setPageSize(p.id); reset(); }}
                  className={cn(
                    'rounded-lg px-3 py-2 text-sm font-medium transition',
                    pageSize === p.id ? 'bg-background text-ink shadow-sm' : 'text-muted hover:text-ink',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      {phase !== 'done' && (
        <Button
          type="button"
          data-testid="run-tool"
          onClick={convert}
          disabled={phase === 'working' || entries.length === 0}
          size="lg"
          className="h-12 w-full text-base"
        >
          {`Convert ${entries.length} image${entries.length === 1 ? '' : 's'} to PDF`}
        </Button>
      )}
      {phase === 'working' && <ProgressBar value={null} />}
      {phase === 'error' && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {phase === 'done' && result && (
        <DownloadResult filename={result.filename} bytes={result.bytes} note="Converted entirely on your device." />
      )}
    </div>
  );
}
