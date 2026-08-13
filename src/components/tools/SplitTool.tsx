import { useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatBytes } from '../../lib/format';
import { parsePageRanges, RangeSyntaxError } from '../../lib/pdf/split';
import { FileDropzone } from './shared/FileDropzone';
import { DownloadResult } from './shared/DownloadResult';
import { ProgressBar } from './shared/ProgressBar';

type Tab = 'ranges' | 'pages' | 'all';
type Phase = 'idle' | 'working' | 'done' | 'error';

interface Loaded { bytes: Uint8Array; name: string; size: number; pageCount: number; thumbs: string[] }

const TABS: { id: Tab; label: string }[] = [
  { id: 'ranges', label: 'Type ranges' },
  { id: 'pages', label: 'Select pages' },
  { id: 'all', label: 'Split all' },
];

export default function SplitTool() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tab, setTab] = useState<Tab>('ranges');
  const [mergeOne, setMergeOne] = useState(false);
  const [rangeText, setRangeText] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ filename: string; bytes: Uint8Array; mime: string } | null>(null);
  const lastClicked = useRef<number | null>(null);
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
    setTab('ranges');
    setMergeOne(false);
    setSelected(new Set());
    setRangeText('');
    setPhase('idle');
    setError(null);
    setResult(null);
    lastClicked.current = null;
  }

  function resetOutcome() {
    setError(null);
    if (phase === 'done' || phase === 'error') { setPhase('idle'); setResult(null); }
  }

  function toggle(i: number, shiftKey: boolean) {
    // Snapshot the anchor now: the updater runs later (during render), after
    // lastClicked has already been advanced to the tile being clicked.
    const anchor = lastClicked.current;
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && anchor !== null) {
        // Shift+click selects the whole run between the two clicks, like ihatepdf.
        const [lo, hi] = [Math.min(anchor, i), Math.max(anchor, i)];
        for (let p = lo; p <= hi; p++) next.add(p);
      } else {
        next.has(i) ? next.delete(i) : next.add(i);
      }
      return next;
    });
    lastClicked.current = i;
    resetOutcome();
  }

  /** The plan for the current tab: which 0-based page ranges become which files. */
  const plan = useMemo<{ ranges: number[][]; pages: number } | { invalid: string } | null>(() => {
    if (!loaded) return null;
    if (tab === 'all') {
      return { ranges: Array.from({ length: loaded.pageCount }, (_, i) => [i]), pages: loaded.pageCount };
    }
    if (tab === 'pages') {
      if (selected.size === 0) return null;
      const pages = Array.from(selected).sort((a, b) => a - b);
      return { ranges: mergeOne ? [pages] : pages.map((p) => [p]), pages: pages.length };
    }
    if (!rangeText.trim()) return null;
    try {
      const parsed = parsePageRanges(rangeText, loaded.pageCount);
      if (mergeOne) {
        const pages = [...new Set(parsed.flat())];
        return { ranges: [pages], pages: pages.length };
      }
      return { ranges: parsed, pages: parsed.flat().length };
    } catch (e) {
      if (e instanceof RangeSyntaxError) return { invalid: e.message };
      throw e;
    }
  }, [loaded, tab, mergeOne, selected, rangeText]);

  const planInvalid = plan !== null && 'invalid' in plan ? plan.invalid : null;
  const planRanges = plan !== null && 'ranges' in plan ? plan : null;

  const ctaLabel = (() => {
    if (!loaded) return '';
    if (tab === 'all') return `Split all ${loaded.pageCount} pages into separate PDFs`;
    if (planInvalid) return 'Fix the page ranges above';
    if (!planRanges) return tab === 'ranges' ? 'Enter page ranges above' : 'Tap pages above to choose what to extract';
    const n = planRanges.ranges.length;
    if (n === 1) return `Extract ${planRanges.pages} page${planRanges.pages === 1 ? '' : 's'} into 1 PDF`;
    return `Split into ${n} files`;
  })();

  async function run() {
    if (!loaded || !planRanges) return;
    setPhase('working'); setError(null);
    try {
      const { splitPdf } = await import('../../lib/pdf/split');
      const outputs = await splitPdf(loaded.bytes, planRanges.ranges);
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

  // Quick-split chips mirror ihatepdf: whole doc + halves, one tap to fill.
  const chips = useMemo(() => {
    if (!loaded) return [];
    const n = loaded.pageCount;
    const half = Math.ceil(n / 2);
    const out = [{ label: 'All pages', value: `1-${n}` }];
    if (n > 1) out.push({ label: `1–${half}`, value: `1-${half}` }, { label: `${half + 1}–${n}`, value: `${half + 1}-${n}` });
    return out;
  }, [loaded]);

  function addChip(value: string) {
    setRangeText((prev) => (prev.trim() ? `${prev.trim().replace(/,\s*$/, '')}, ${value}` : value));
    resetOutcome();
  }

  return (
    <div className="space-y-4">
      {!loaded && phase !== 'working' && <FileDropzone label="Choose a PDF to split" onFiles={onFile} />}
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

          <div className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-panel/40 p-1" role="tablist" aria-label="Split mode">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => { setTab(t.id); resetOutcome(); }}
                className={cn(
                  'rounded-lg px-3 py-2 text-sm font-medium transition',
                  tab === t.id ? 'bg-background text-ink shadow-sm' : 'text-muted hover:text-ink',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab !== 'all' && (
            <button
              type="button"
              role="switch"
              aria-checked={mergeOne}
              data-testid="merge-toggle"
              onClick={() => { setMergeOne((v) => !v); resetOutcome(); }}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-left"
            >
              <span>
                <span className="block text-sm font-medium">Merge into a single PDF</span>
                <span className="block text-xs text-muted-foreground">
                  {mergeOne ? 'All chosen pages come back as one document' : 'Each range or page downloads as its own file'}
                </span>
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition',
                  mergeOne ? 'bg-primary' : 'bg-panel border border-border',
                )}
              >
                <span className={cn('inline-block size-5 transform rounded-full bg-background shadow transition', mergeOne ? 'translate-x-5' : 'translate-x-0.5')} />
              </span>
            </button>
          )}

          {tab === 'ranges' && (
            <div className="space-y-3 rounded-xl border border-border p-4">
              <div>
                <p className="text-sm font-medium">Page ranges</p>
                <p className="text-xs text-muted-foreground">Separate multiple ranges with commas — e.g. 1-3, 5, 7-</p>
              </div>
              <Input
                value={rangeText}
                onChange={(e) => { setRangeText(e.target.value); resetOutcome(); }}
                placeholder={`e.g. 1-${Math.min(3, loaded.pageCount)}, 5, 7-`}
                data-testid="range-input"
              />
              {planInvalid && rangeText.trim() !== '' && (
                <p className="text-xs text-destructive">{planInvalid}</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[0.68rem] font-semibold tracking-widest text-muted uppercase">Quick splits</span>
                {chips.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    onClick={() => addChip(c.value)}
                    className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted transition hover:border-accent hover:text-accent"
                  >
                    + {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === 'pages' && (
            <div className="space-y-3 rounded-xl border border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">
                  Pages <span className="font-normal text-muted-foreground">· tap to select, shift+tap for a range</span>
                </p>
                {selected.size < loaded.pageCount ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setSelected(new Set(loaded.thumbs.map((_, i) => i))); resetOutcome(); }}>
                    Select all
                  </Button>
                ) : (
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setSelected(new Set()); resetOutcome(); }}>
                    Clear
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                {loaded.thumbs.map((src, i) => (
                  <button
                    type="button"
                    key={i}
                    onClick={(e) => toggle(i, e.shiftKey)}
                    aria-pressed={selected.has(i)}
                    className={cn(
                      'relative overflow-hidden rounded-lg border-2 transition',
                      selected.has(i) ? 'border-accent ring-2 ring-accent/30' : 'border-border hover:border-accent/50',
                    )}
                  >
                    {selected.has(i) && (
                      <span className="absolute top-1 right-1 inline-flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden="true">
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                      </span>
                    )}
                    <img src={src} alt={`Page ${i + 1}`} className="w-full" />
                    <span className="block py-1 text-center text-xs text-muted">{i + 1}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === 'all' && (
            <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
              Every page becomes its own PDF — you'll get a zip with {loaded.pageCount} files.
            </div>
          )}

          {phase !== 'done' && (
            <Button
              type="button"
              data-testid="run-tool"
              onClick={run}
              disabled={phase === 'working' || (tab !== 'all' && !planRanges)}
              size="lg"
              className="h-12 w-full text-base"
            >
              {ctaLabel}
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
