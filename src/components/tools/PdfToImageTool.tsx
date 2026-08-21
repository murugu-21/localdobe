import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { DpiPreset, ImageFormat } from '../../lib/pdf/pdfToImages';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatBytes } from '../../lib/format';
import { DownloadResult } from './shared/DownloadResult';
import { FileDropzone } from './shared/FileDropzone';
import { ProgressBar } from './shared/ProgressBar';

interface Props { format: ImageFormat }

type Phase = 'idle' | 'working' | 'done' | 'error';

interface Loaded { bytes: Uint8Array; name: string; size: number; pageCount: number; thumbs: string[] }

const PRESETS: { id: DpiPreset; label: string }[] = [
  { id: 'standard', label: 'Standard · 150 DPI' },
  { id: 'high', label: 'High · 300 DPI' },
];

export default function PdfToImageTool({ format }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [preset, setPreset] = useState<DpiPreset>('standard');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ filename: string; bytes: Uint8Array; mime: string } | null>(null);
  const abort = useRef(false);

  useEffect(() => () => { abort.current = true; }, []);

  const extLabel = format === 'jpeg' ? 'JPG' : 'PNG';

  async function onFile([file]: File[]) {
    setPhase('working'); setError(null); setResult(null); setProgress(null);
    let doc: PDFDocumentProxy | null = null;
    let closePdf: ((d: PDFDocumentProxy) => Promise<void>) | null = null;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const render = await import('../../lib/pdf/render');
      closePdf = render.closePdf;
      doc = await render.openPdf(bytes);
      const thumbs: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const canvas = document.createElement('canvas');
        await render.renderPageToCanvas(page, canvas, 0.3);
        thumbs.push(canvas.toDataURL());
        page.cleanup();
        if (abort.current) return;
      }
      setLoaded({ bytes, name: file.name.replace(/\.pdf$/i, ''), size: file.size, pageCount: doc.numPages, thumbs });
      setPhase('idle');
    } catch {
      setError('Could not read this PDF. It may be corrupt or password-protected.');
      setPhase('error');
    } finally {
      if (doc && closePdf) void closePdf(doc).catch(() => {});
    }
  }

  function clear() {
    setLoaded(null);
    setPreset('standard');
    setPhase('idle');
    setError(null);
    setResult(null);
    setProgress(null);
  }

  function resetOutcome() {
    setError(null);
    if (phase === 'done' || phase === 'error') { setPhase('idle'); setResult(null); }
  }

  async function run() {
    if (!loaded) return;
    setPhase('working'); setError(null); setProgress({ done: 0, total: loaded.pageCount });
    const { pdfToImages, DPI_PRESETS, pageImageName } = await import('../../lib/pdf/pdfToImages');
    const { PdfToolError } = await import('../../lib/pdf/errors');
    try {
      const images = await pdfToImages(loaded.bytes, format, DPI_PRESETS[preset], (done, total) => {
        setProgress({ done, total });
      });
      if (images.length === 1) {
        setResult({
          filename: pageImageName(loaded.name, 0, format),
          bytes: images[0],
          mime: format === 'jpeg' ? 'image/jpeg' : 'image/png',
        });
      } else {
        const { zipFiles } = await import('../../lib/pdf/zip');
        const zipped = zipFiles(images.map((data, i) => ({ name: pageImageName(loaded.name, i, format), data })));
        setResult({ filename: `${loaded.name}-images.zip`, bytes: zipped, mime: 'application/zip' });
      }
      setPhase('done');
    } catch (err) {
      setError(err instanceof PdfToolError ? err.message : 'Something went wrong converting this PDF.');
      setPhase('error');
    }
  }

  return (
    <div className="space-y-4">
      {!loaded && phase !== 'working' && (
        <FileDropzone label={`Choose a PDF to convert to ${extLabel}`} onFiles={onFile} />
      )}
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

          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {loaded.thumbs.map((src, i) => (
              <div key={i} className="overflow-hidden rounded-lg border-2 border-border">
                <span className="flex aspect-square items-center justify-center bg-panel/40 p-1">
                  <img src={src} alt={`Page ${i + 1}`} className="max-h-full max-w-full" />
                </span>
                <span className="block py-1 text-center text-xs text-muted">{i + 1}</span>
              </div>
            ))}
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium">Image quality</p>
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-panel/40 p-1" role="tablist" aria-label="Image quality">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={preset === p.id}
                  data-testid={`dpi-${p.id}`}
                  onClick={() => { setPreset(p.id); resetOutcome(); }}
                  className={cn(
                    'rounded-lg px-3 py-2 text-sm font-medium transition',
                    preset === p.id ? 'bg-background text-ink shadow-sm' : 'text-muted hover:text-ink',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {phase !== 'done' && (
            <Button
              type="button"
              data-testid="run-tool"
              onClick={run}
              disabled={phase === 'working'}
              size="lg"
              className="h-12 w-full text-base"
            >
              {`Convert ${loaded.pageCount} page${loaded.pageCount === 1 ? '' : 's'} to ${extLabel}`}
            </Button>
          )}
          {phase === 'working' && (
            <ProgressBar value={progress ? progress.done / progress.total : null} />
          )}
        </>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {phase === 'done' && result && (
        <DownloadResult filename={result.filename} bytes={result.bytes} mime={result.mime} note="Converted entirely on your device." />
      )}
    </div>
  );
}
