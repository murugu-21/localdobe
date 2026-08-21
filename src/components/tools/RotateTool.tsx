import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatBytes } from '../../lib/format';
import { DownloadResult } from './shared/DownloadResult';
import { FileDropzone } from './shared/FileDropzone';
import { ProgressBar } from './shared/ProgressBar';

type Phase = 'idle' | 'working' | 'done' | 'error';

interface Loaded {
  bytes: Uint8Array;
  name: string;
  size: number;
  pageCount: number;
  thumbs: string[];
  /** RGBA page renders (short side ≥ 256) captured at load time for detection. */
  detectInputs: ImageData[];
}

export default function RotateTool() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [deltas, setDeltas] = useState<number[]>([]);
  const [autoFixed, setAutoFixed] = useState<Set<number>>(new Set());
  const [detectNote, setDetectNote] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ filename: string; bytes: Uint8Array } | null>(null);
  const abort = useRef(false);

  useEffect(() => () => { abort.current = true; }, []);

  async function onFile([file]: File[]) {
    setPhase('working'); setError(null); setResult(null); setAutoFixed(new Set()); setDetectNote(null);
    let doc: PDFDocumentProxy | null = null;
    let closePdf: ((d: PDFDocumentProxy) => Promise<void>) | null = null;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const render = await import('../../lib/pdf/render');
      const { MODEL_SHORT_SIDE } = await import('../../lib/pdf/orientation');
      closePdf = render.closePdf;
      doc = await render.openPdf(bytes);
      const thumbs: string[] = [];
      const detectInputs: ImageData[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const thumbCanvas = document.createElement('canvas');
        await render.renderPageToCanvas(page, thumbCanvas, 0.3);
        thumbs.push(thumbCanvas.toDataURL());
        // A second, larger render feeds the orientation model (short side = 256).
        const v1 = page.getViewport({ scale: 1 });
        const detectCanvas = document.createElement('canvas');
        await render.renderPageToCanvas(page, detectCanvas, MODEL_SHORT_SIDE / Math.min(v1.width, v1.height));
        const ctx = detectCanvas.getContext('2d');
        if (ctx) detectInputs.push(ctx.getImageData(0, 0, detectCanvas.width, detectCanvas.height));
        page.cleanup();
        if (abort.current) return;
      }
      const next: Loaded = {
        bytes, name: file.name.replace(/\.pdf$/i, ''), size: file.size,
        pageCount: doc.numPages, thumbs, detectInputs,
      };
      setLoaded(next);
      setDeltas(new Array(doc.numPages).fill(0));
      setPhase('idle');
      void detect(next); // Task 6 wires this in; a stub for now.
    } catch {
      setError('Could not read this PDF. It may be corrupt or password-protected.');
      setPhase('error');
    } finally {
      if (doc && closePdf) void closePdf(doc).catch(() => {});
    }
  }

  // Auto-detection lands in the next task; keep the hook so the flow above is final.
  async function detect(_l: Loaded) {}

  function clear() {
    setLoaded(null); setDeltas([]); setAutoFixed(new Set()); setDetectNote(null);
    setPhase('idle'); setError(null); setResult(null);
  }

  function resetOutcome() {
    setError(null);
    if (phase === 'done' || phase === 'error') { setPhase('idle'); setResult(null); }
  }

  function bump(i: number, by = 90) {
    setDeltas((prev) => prev.map((d, j) => (j === i ? (d + by) % 360 : d)));
    setAutoFixed((prev) => { const next = new Set(prev); next.delete(i); return next; });
    resetOutcome();
  }

  function rotateAll() {
    setDeltas((prev) => prev.map((d) => (d + 90) % 360));
    setAutoFixed(new Set());
    resetOutcome();
  }

  function resetAll() {
    setDeltas((prev) => prev.map(() => 0));
    setAutoFixed(new Set());
    resetOutcome();
  }

  const changed = deltas.filter((d) => d % 360 !== 0).length;

  async function run() {
    if (!loaded || changed === 0) return;
    setPhase('working'); setError(null);
    try {
      const { rotatePdf } = await import('../../lib/pdf/rotate');
      const out = await rotatePdf(loaded.bytes, deltas);
      setResult({ filename: `${loaded.name}-rotated.pdf`, bytes: out });
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setPhase('error');
    }
  }

  return (
    <div className="space-y-4">
      {!loaded && phase !== 'working' && <FileDropzone label="Choose a PDF to rotate" onFiles={onFile} />}
      {phase === 'working' && !loaded && <ProgressBar value={null} />}
      {loaded && (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm">
              <span className="font-medium">{loaded.name}.pdf</span>{' '}
              <span className="text-muted-foreground">· {loaded.pageCount} pages · {formatBytes(loaded.size)}</span>
            </p>
            <Button type="button" variant="ghost" size="sm" data-testid="clear-file" onClick={clear}>
              Start over
            </Button>
          </div>

          {detectNote && (
            <p data-testid="detect-status" className="text-sm text-muted-foreground" aria-live="polite">
              {detectNote}
            </p>
          )}

          <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
            <p className="text-sm font-medium">
              Pages <span className="font-normal text-muted-foreground">· tap a page to rotate it 90°</span>
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" data-testid="rotate-all" onClick={rotateAll}>
                Rotate all 90°
              </Button>
              <Button type="button" variant="ghost" size="sm" data-testid="reset-rotations" onClick={resetAll} disabled={changed === 0}>
                Reset
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {loaded.thumbs.map((src, i) => (
              <button
                type="button"
                key={i}
                data-testid={`rotate-thumb-${i}`}
                onClick={() => bump(i)}
                aria-label={`Rotate page ${i + 1} (currently ${deltas[i]} degrees)`}
                className={cn(
                  'relative overflow-hidden rounded-lg border-2 transition',
                  deltas[i] % 360 !== 0 ? 'border-accent ring-2 ring-accent/30' : 'border-border hover:border-accent/50',
                )}
              >
                {autoFixed.has(i) && (
                  <span
                    data-testid={`auto-badge-${i}`}
                    className="absolute top-1 left-1 z-10 rounded-full bg-primary px-2 py-0.5 text-[0.65rem] font-semibold text-primary-foreground"
                  >
                    Auto-straightened
                  </span>
                )}
                <span className="flex aspect-square items-center justify-center bg-panel/40 p-1">
                  <img
                    src={src}
                    alt={`Page ${i + 1}`}
                    className="max-h-full max-w-full transition-transform"
                    style={{ transform: `rotate(${deltas[i]}deg)` }}
                  />
                </span>
                <span className="block py-1 text-center text-xs text-muted">
                  {i + 1}{deltas[i] % 360 !== 0 && ` · ${deltas[i]}°`}
                </span>
              </button>
            ))}
          </div>

          {phase !== 'done' && (
            <Button
              type="button"
              data-testid="run-tool"
              onClick={run}
              disabled={phase === 'working' || changed === 0}
              size="lg"
              className="h-12 w-full text-base"
            >
              {changed === 0 ? 'Tap pages above to rotate them' : `Apply rotation to ${changed} page${changed === 1 ? '' : 's'}`}
            </Button>
          )}
          {phase === 'working' && <ProgressBar value={null} />}
        </>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {phase === 'done' && result && (
        <DownloadResult filename={result.filename} bytes={result.bytes} note="Rotated entirely on your device." />
      )}
    </div>
  );
}
