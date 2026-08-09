import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import { renderPageToCanvas } from '../../../lib/pdf/render';
import { textItemToPdfBox } from '../../../lib/pdf/edit/coords';
import { classifyFont, cssFontStack, type FontClass } from '../../../lib/pdf/edit/fontMatch';
import type { EditSession, NewTextBox } from '../../../lib/pdf/edit/session';

const MAX_SCALE = 1.5;
const MIN_SCALE = 0.35;
const CONTAINER_PADDING = 32; // matches the p-4 wrapper in EditTool

interface SpanInfo {
  itemKey: string; str: string;
  /** What the span shows on mount: an existing session edit's text, else the original. */
  initialText: string;
  cssLeft: number; cssTop: number; cssFontSize: number;
  /** Rendered width of the ORIGINAL text — edited spans keep this as min-width so
   *  shorter replacements still cover the original canvas pixels beneath. */
  cssWidth: number;
  pdf: { x: number; y: number; fontSize: number; width: number; height: number };
  fontClass: FontClass;
}

interface Props {
  doc: PDFDocumentProxy;
  pageIndex: number;           // 0-based
  session: EditSession;
  addTextMode: boolean;
  onDirty: () => void;
  /** Bumped by EditTool on window resize so pages re-fit to the container width. */
  fitTick: number;
}

export function PageEditor({ doc, pageIndex, session, addTextMode, onDirty, fitTick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<PageViewport | null>(null);
  const [spans, setSpans] = useState<SpanInfo[]>([]);
  const [pageHeightPt, setPageHeightPt] = useState(792);
  const [rotDelta, setRotDelta] = useState(0);
  const [scale, setScale] = useState(MAX_SCALE);
  const [editedKeys, setEditedKeys] = useState<Set<string>>(new Set());
  const [boxIndexes, setBoxIndexes] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(pageIndex + 1);
      if (!canvasRef.current || cancelled) return;
      const rotation = (((page.rotate + rotDelta) % 360) + 360) % 360;
      // Fit the page to the available container width (capped at MAX_SCALE) so
      // phones and narrow windows don't get a horizontally scrolling canvas.
      const base = page.getViewport({ scale: 1, rotation });
      const avail = containerRef.current?.parentElement
        ? containerRef.current.parentElement.clientWidth - CONTAINER_PADDING
        : base.width * MAX_SCALE;
      const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, avail / base.width));
      await renderPageToCanvas(page, canvasRef.current, s, rotDelta);
      const viewport = page.getViewport({ scale: s, rotation });
      viewportRef.current = viewport;
      setScale(s);
      setPageHeightPt(viewport.height / s);
      const content = await page.getTextContent();
      const pdfjs = await import('pdfjs-dist');
      const result: SpanInfo[] = [];
      const alreadyEdited = new Set<string>();
      content.items.forEach((item, i) => {
        if (!('str' in item) || item.str.trim() === '') return;
        const itemKey = `${pageIndex}:${i}`;
        const existingEdit = session.editFor(itemKey);
        if (existingEdit) alreadyEdited.add(itemKey);
        const tx = pdfjs.Util.transform(viewport.transform, item.transform);
        const cssFontSize = Math.hypot(tx[2], tx[3]);
        const styleName = content.styles[item.fontName]?.fontFamily ?? item.fontName;
        result.push({
          itemKey,
          str: item.str,
          initialText: existingEdit?.text ?? item.str,
          cssLeft: tx[4],
          cssTop: tx[5] - cssFontSize,
          cssFontSize,
          cssWidth: item.width * s,
          pdf: textItemToPdfBox(item),
          fontClass: classifyFont(styleName),
        });
      });
      if (!cancelled) {
        setSpans(result);
        setEditedKeys(alreadyEdited);
      }
    })();
    return () => { cancelled = true; };
  }, [doc, pageIndex, rotDelta, fitTick, session]);

  function rotate(delta: 90 | -90) {
    session.rotatePage(pageIndex, delta);
    setRotDelta(session.rotationOf(pageIndex));
    onDirty();
  }

  function onSpanInput(span: SpanInfo, el: HTMLElement) {
    const text = el.textContent ?? '';
    session.recordEdit({
      page: pageIndex,
      itemKey: span.itemKey,
      original: span.str,
      text,
      ...span.pdf,
      fontClass: span.fontClass,
      cover: { r: 1, g: 1, b: 1 },
    });
    // Keep edited spans permanently opaque so the preview shows the NEW text
    // instead of falling back to the transparent overlay (original canvas text).
    setEditedKeys((prev) => {
      const next = new Set(prev);
      if (text === span.str) next.delete(span.itemKey);
      else next.add(span.itemKey);
      return next;
    });
    onDirty();
  }

  function onPageClick(e: React.MouseEvent) {
    if (!addTextMode || !containerRef.current || !viewportRef.current) return;
    if ((e.target as HTMLElement).isContentEditable) return;
    const rect = containerRef.current.getBoundingClientRect();
    // convertToPdfPoint handles page rotation (including any preview rotation delta).
    const [x, y] = viewportRef.current.convertToPdfPoint(e.clientX - rect.left, e.clientY - rect.top);
    const box: NewTextBox = { page: pageIndex, x, y: y - 16, text: '', fontSize: 16, fontClass: 'sans', color: { r: 0, g: 0, b: 0 } };
    session.addBox(box);
    setBoxIndexes(session.boxesRaw.map((_, i) => i).filter((i) => session.boxesRaw[i].page === pageIndex));
    onDirty();
  }

  return (
    <div ref={containerRef} onClick={onPageClick}
      className={`relative mx-auto mb-8 w-fit shadow-md ${addTextMode ? 'cursor-crosshair' : ''}`}>
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg bg-background/90 p-1 shadow">
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`Rotate page ${pageIndex + 1} left`} title="Rotate left"
          onClick={(e) => { e.stopPropagation(); rotate(-90); }}>⟲</Button>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`Rotate page ${pageIndex + 1} right`} title="Rotate right"
          onClick={(e) => { e.stopPropagation(); rotate(90); }}>⟳</Button>
        {rotDelta !== 0 && <span className="px-1 py-1 text-xs text-muted">{rotDelta}°</span>}
      </div>
      <canvas ref={canvasRef} className="block" />
      {spans.map((s) => (
        <span
          key={s.itemKey}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onInput={(e) => onSpanInput(s, e.currentTarget)}
          // Colors here are pinned to the always-white rendered PDF canvas beneath this span,
          // not to the site theme — text-ink would go near-white in dark mode and vanish
          // against this white/yellow highlight, so these stay hardcoded slate deliberately.
          // Edited spans stay opaque (white bg over the original canvas text) so the
          // preview reflects the edit instead of reverting on blur.
          className={`absolute origin-top-left whitespace-pre caret-black outline-none
            focus:bg-white focus:text-slate-900 focus:ring-1 focus:ring-accent ${
              editedKeys.has(s.itemKey)
                ? 'bg-white text-slate-900 ring-1 ring-accent/40'
                : 'text-transparent hover:bg-yellow-100/60 hover:text-slate-900'
            }`}
          style={{
            left: s.cssLeft,
            top: s.cssTop,
            fontSize: s.cssFontSize,
            fontFamily: cssFontStack(s.fontClass),
            lineHeight: 1,
            minWidth: editedKeys.has(s.itemKey) ? s.cssWidth : undefined,
            // Cover the original text's descenders (which extend below the baseline).
            paddingBottom: editedKeys.has(s.itemKey) ? s.cssFontSize * 0.25 : undefined,
          }}
        >{s.initialText}</span>
      ))}
      {boxIndexes.map((i) => {
        const b = session.boxesRaw[i];
        if (!b) return null;
        return (
          <div
            key={`box-${i}`}
            data-testid="new-text-box"
            contentEditable
            suppressContentEditableWarning
            onInput={(e) => { session.updateBox(i, { text: e.currentTarget.textContent ?? '' }); onDirty(); }}
            // text-slate-900 is pinned (not text-ink) for the same reason as the span above:
            // this box sits on the white canvas regardless of site theme, and would
            // otherwise inherit body's theme-flipping text-ink and vanish in dark mode.
            className="absolute min-w-8 border border-dashed border-accent bg-white/80 px-0.5 text-slate-900 outline-none"
            style={{
              left: b.x * scale,
              top: (pageHeightPt - b.y) * scale - b.fontSize * scale,
              fontSize: b.fontSize * scale,
              fontFamily: cssFontStack(b.fontClass),
              lineHeight: 1.3,
            }}
          />
        );
      })}
    </div>
  );
}
