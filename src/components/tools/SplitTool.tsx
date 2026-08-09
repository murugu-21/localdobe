import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { FileDropzone } from './shared/FileDropzone';
import { DownloadResult } from './shared/DownloadResult';
import { ProgressBar } from './shared/ProgressBar';

type Mode = 'extract' | 'all';
type Phase = 'idle' | 'working' | 'done' | 'error';

interface Loaded { bytes: Uint8Array; name: string; pageCount: number; thumbs: string[] }

export default function SplitTool() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [rangeText, setRangeText] = useState('');
  const [mode, setMode] = useState<Mode>('extract');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ filename: string; bytes: Uint8Array; mime: string } | null>(null);
  const abort = useRef(false);

  useEffect(() => () => { abort.current = true; }, []);

  async function onFile([file]: File[]) {
    setPhase('working'); setError(null); setResult(null); setSelected(new Set()); setRangeText('');
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
      setLoaded({ bytes, name: file.name.replace(/\.pdf$/i, ''), pageCount: doc.numPages, thumbs });
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
    setSelected(new Set());
    setRangeText('');
    setMode('extract');
    setPhase('idle');
    setError(null);
    setResult(null);
  }

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
    setRangeText('');
    if (phase === 'done') { setPhase('idle'); setResult(null); }
  }

  async function run() {
    if (!loaded) return;
    setPhase('working'); setError(null);
    try {
      const { parsePageRanges, splitPdf, RangeSyntaxError } = await import('../../lib/pdf/split');
      let ranges: number[][];
      if (mode === 'all') {
        ranges = Array.from({ length: loaded.pageCount }, (_, i) => [i]);
      } else if (rangeText.trim()) {
        try {
          // Extract mode always yields ONE document — same as thumbnail selection.
          // "2-3, 5" means pages 2, 3, and 5 together, not separate files (the
          // "every page" mode covers multi-file output).
          const pages = parsePageRanges(rangeText, loaded.pageCount).flat();
          ranges = [[...new Set(pages)]];
        } catch (e) {
          if (e instanceof RangeSyntaxError) { setError(e.message); setPhase('error'); return; }
          throw e;
        }
      } else if (selected.size > 0) {
        ranges = [Array.from(selected).sort((a, b) => a - b)];
      } else {
        setError('Select pages by clicking thumbnails, or type a range like 1-3, 5.');
        setPhase('error');
        return;
      }
      const outputs = await splitPdf(loaded.bytes, ranges);
      if (outputs.length === 1) {
        setResult({ filename: `${loaded.name}-pages.pdf`, bytes: outputs[0], mime: 'application/pdf' });
      } else {
        const { zipFiles } = await import('../../lib/pdf/zip');
        const zipped = zipFiles(outputs.map((data, i) => ({ name: `${loaded.name}-part-${i + 1}.pdf`, data })));
        setResult({ filename: `${loaded.name}-split.zip`, bytes: zipped, mime: 'application/zip' });
      }
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setPhase('error');
    }
  }

  return (
    <div className="space-y-6">
      {!loaded && phase !== 'working' && <FileDropzone label="Choose a PDF to split" onFiles={onFile} />}
      {phase === 'working' && !loaded && <ProgressBar value={null} />}
      {loaded && (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{loaded.name}.pdf</p>
            <Button type="button" variant="ghost" size="sm" data-testid="clear-file" onClick={clear}>
              Start over
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {loaded.thumbs.map((src, i) => (
              <button
                type="button"
                key={i}
                onClick={() => toggle(i)}
                className={cn(
                  'overflow-hidden rounded-lg border-2',
                  selected.has(i) ? 'border-accent ring-2 ring-accent/30' : 'border-border',
                )}
              >
                <img src={src} alt={`Page ${i + 1}`} className="w-full" />
                <span className="block py-1 text-center text-xs text-muted">{i + 1}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <RadioGroup
              value={mode}
              onValueChange={(v) => {
                setMode(v as Mode);
                if (phase === 'done') { setPhase('idle'); setResult(null); }
              }}
              className="flex w-auto flex-row flex-wrap items-center gap-4"
            >
              <Label className="flex items-center gap-2 text-sm font-normal">
                <RadioGroupItem value="extract" />
                Extract selection
              </Label>
              <Label className="flex items-center gap-2 text-sm font-normal">
                <RadioGroupItem value="all" />
                Every page as its own PDF (zip)
              </Label>
            </RadioGroup>
            {mode === 'extract' && (
              <Input
                value={rangeText}
                onChange={(e) => {
                  setRangeText(e.target.value);
                  // Typed ranges take precedence over thumbnail selection — clear it
                  // so the UI never shows two competing inputs at once.
                  if (e.target.value.trim() !== '' && selected.size > 0) setSelected(new Set());
                  if (phase === 'done') { setPhase('idle'); setResult(null); }
                }}
                placeholder="or type ranges: 1-3, 5, 7-"
                className="flex-1"
                data-testid="range-input"
              />
            )}
          </div>
          {phase !== 'done' && (
            <Button
              type="button"
              data-testid="run-tool"
              onClick={run}
              disabled={phase === 'working'}
              size="lg"
              className="w-full"
            >
              Split PDF
            </Button>
          )}
          {phase === 'working' && <ProgressBar value={null} />}
        </>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {phase === 'done' && result && (
        <DownloadResult filename={result.filename} bytes={result.bytes} mime={result.mime} note="Split entirely on your device." />
      )}
    </div>
  );
}
