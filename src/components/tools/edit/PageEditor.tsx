import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import { renderPageToCanvas } from '../../../lib/pdf/render';
import { textItemToPdfBox } from '../../../lib/pdf/edit/coords';
import { classifyFont, cssFontStack, type FontClass } from '../../../lib/pdf/edit/fontMatch';
import type { EditSession, NewTextBox } from '../../../lib/pdf/edit/session';

const SCALE = 1.5;

interface SpanInfo {
  itemKey: string; str: string;
  cssLeft: number; cssTop: number; cssFontSize: number;
  pdf: { x: number; y: number; fontSize: number; width: number; height: number };
  fontClass: FontClass;
}

interface Props {
  doc: PDFDocumentProxy;
  pageIndex: number;           // 0-based
  session: EditSession;
  addTextMode: boolean;
  onDirty: () => void;
}

export function PageEditor({ doc, pageIndex, session, addTextMode, onDirty }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<PageViewport | null>(null);
  const [spans, setSpans] = useState<SpanInfo[]>([]);
  const [pageHeightPt, setPageHeightPt] = useState(792);
  const [rotDelta, setRotDelta] = useState(0);
  const [boxIndexes, setBoxIndexes] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(pageIndex + 1);
      if (!canvasRef.current || cancelled) return;
      await renderPageToCanvas(page, canvasRef.current, SCALE, rotDelta);
      const rotation = (((page.rotate + rotDelta) % 360) + 360) % 360;
      const viewport = page.getViewport({ scale: SCALE, rotation });
      viewportRef.current = viewport;
      setPageHeightPt(viewport.height / SCALE);
      const content = await page.getTextContent();
      const pdfjs = await import('pdfjs-dist');
      const result: SpanInfo[] = [];
      content.items.forEach((item, i) => {
        if (!('str' in item) || item.str.trim() === '') return;
        const tx = pdfjs.Util.transform(viewport.transform, item.transform);
        const cssFontSize = Math.hypot(tx[2], tx[3]);
        const styleName = content.styles[item.fontName]?.fontFamily ?? item.fontName;
        result.push({
          itemKey: `${pageIndex}:${i}`,
          str: item.str,
          cssLeft: tx[4],
          cssTop: tx[5] - cssFontSize,
          cssFontSize,
          pdf: textItemToPdfBox(item),
          fontClass: classifyFont(styleName),
        });
      });
      if (!cancelled) setSpans(result);
    })();
    return () => { cancelled = true; };
  }, [doc, pageIndex, rotDelta]);

  function rotate(delta: 90 | -90) {
    session.rotatePage(pageIndex, delta);
    setRotDelta(session.rotationOf(pageIndex));
    onDirty();
  }

  function onSpanInput(span: SpanInfo, el: HTMLElement) {
    session.recordEdit({
      page: pageIndex,
      itemKey: span.itemKey,
      original: span.str,
      text: el.textContent ?? '',
      ...span.pdf,
      fontClass: span.fontClass,
      cover: { r: 1, g: 1, b: 1 },
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
          className="absolute origin-top-left whitespace-pre text-transparent caret-black outline-none
            hover:bg-yellow-100/60 hover:text-slate-900 focus:bg-white focus:text-slate-900 focus:ring-1 focus:ring-accent"
          style={{ left: s.cssLeft, top: s.cssTop, fontSize: s.cssFontSize, fontFamily: cssFontStack(s.fontClass), lineHeight: 1 }}
        >{s.str}</span>
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
              left: b.x * SCALE,
              top: (pageHeightPt - b.y) * SCALE - b.fontSize * SCALE,
              fontSize: b.fontSize * SCALE,
              fontFamily: cssFontStack(b.fontClass),
              lineHeight: 1.3,
            }}
          />
        );
      })}
    </div>
  );
}
