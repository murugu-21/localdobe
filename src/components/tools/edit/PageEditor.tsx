import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import { getPdfjs, renderPageToCanvas } from '../../../lib/pdf/render';
import { REPLAY_BLOCK, REPLAY_MASK } from '../../../lib/replay';
import { textItemToPdfBox } from '../../../lib/pdf/edit/coords';
import { classifyFont, cssFontStack, type FontClass } from '../../../lib/pdf/edit/fontMatch';
import type { EditSession, NewTextBox, PageSlot } from '../../../lib/pdf/edit/session';

const MAX_SCALE = 1.5;
const MIN_SCALE = 0.35;

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
  /** The page shown here — an original page, or a blank one the user inserted. */
  slot: PageSlot;
  /** Position in the page list (0-based); labels and page operations use it. */
  displayIndex: number;
  session: EditSession;
  addTextMode: boolean;
  onDirty: () => void;
  /** Insert a blank page directly after this one. Size is in points, already oriented. */
  onInsertPage: (width: number, height: number) => void;
  onDeletePage: () => void;
  /** Bumped by EditTool on window resize so pages re-fit to the container width. */
  fitTick: number;
  /** Bumped by EditTool after a page insert/delete so cached per-page state is rebuilt. */
  structureTick: number;
}

const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

export function PageEditor({ doc, slot, displayIndex, session, addTextMode, onDirty, onInsertPage, onDeletePage, fitTick, structureTick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<PageViewport | null>(null);
  const [spans, setSpans] = useState<SpanInfo[]>([]);
  const [scale, setScale] = useState(MAX_SCALE);
  const [pageHeightPt, setPageHeightPt] = useState(792);
  const [rotDelta, setRotDelta] = useState(0);
  const [baseRotation, setBaseRotation] = useState(0);
  const [pageSizePt, setPageSizePt] = useState({ width: 612, height: 792 });
  const [loaded, setLoaded] = useState(false);
  const [editedKeys, setEditedKeys] = useState<Set<string>>(new Set());
  const [boxIndexes, setBoxIndexes] = useState<number[]>([]);

  const sourceIndex = slot.source;
  const isBlank = sourceIndex === null;
  // The visible orientation: the page's own /Rotate plus any preview rotation.
  const rotation = (((baseRotation + rotDelta) % 360) + 360) % 360;
  const paperSize = isBlank ? { width: slot.width, height: slot.height } : pageSizePt;

  useEffect(() => {
    let cancelled = false;
    const avail = wrapperRef.current?.clientWidth ?? 612 * MAX_SCALE;

    if (sourceIndex === null) {
      // Inserted page: nothing to render — the surface below is a plain white box.
      viewportRef.current = null;
      setScale(clampScale(avail / Math.max(1, slot.width)));
      setPageHeightPt(slot.height);
      setSpans([]);
      setEditedKeys(new Set());
      setLoaded(true);
      return;
    }

    (async () => {
      const page = await doc.getPage(sourceIndex + 1);
      if (!canvasRef.current || cancelled) return;
      const pageRotation = (((page.rotate + rotDelta) % 360) + 360) % 360;
      // Fit the page to the available container width (capped at MAX_SCALE) so
      // phones and narrow windows don't get a horizontally scrolling canvas.
      const base = page.getViewport({ scale: 1, rotation: pageRotation });
      const s = clampScale(avail / base.width);
      await renderPageToCanvas(page, canvasRef.current, s, rotDelta);
      // The render helper cancels a superseded render on this canvas, so after
      // awaiting, a newer effect may already own the page state. Stop here rather
      // than overwriting it with this run's stale viewport/scale.
      if (cancelled) return;
      const viewport = page.getViewport({ scale: s, rotation: pageRotation });
      viewportRef.current = viewport;
      const paper = page.getViewport({ scale: 1 });
      setScale(s);
      setPageHeightPt(viewport.height / s);
      setBaseRotation(page.rotate);
      setPageSizePt({ width: paper.width, height: paper.height });
      setLoaded(true);
      const content = await page.getTextContent();
      const pdfjs = await getPdfjs();
      const result: SpanInfo[] = [];
      const alreadyEdited = new Set<string>();
      content.items.forEach((item, i) => {
        if (!('str' in item) || item.str.trim() === '') return;
        const itemKey = `${sourceIndex}:${i}`;
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
  }, [doc, sourceIndex, slot, rotDelta, fitTick, session]);

  // Box and rotation indexes are list positions — both shift when pages around this one
  // are deleted or inserted, so re-read them whenever the structure changes.
  useEffect(() => {
    setBoxIndexes(session.boxesRaw.map((_, i) => i).filter((i) => session.boxesRaw[i].page === displayIndex));
  }, [session, displayIndex, structureTick]);

  useEffect(() => {
    setRotDelta(session.rotationOf(displayIndex));
  }, [session, displayIndex, structureTick]);

  function rotate(delta: 90 | -90) {
    session.rotatePage(displayIndex, delta);
    setRotDelta(session.rotationOf(displayIndex));
    onDirty();
  }

  function addPageBelow() {
    // Match what this page looks like now (its /Rotate plus any preview rotation), not
    // the unrotated paper size — a blank page can't carry /Rotate, so the size carries it.
    const swap = rotation % 180 !== 0;
    onInsertPage(swap ? paperSize.height : paperSize.width, swap ? paperSize.width : paperSize.height);
  }

  function onSpanInput(span: SpanInfo, el: HTMLElement) {
    const text = el.textContent ?? '';
    session.recordEdit({
      page: sourceIndex!,
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
    if (!addTextMode || !surfaceRef.current) return;
    if (!isBlank && !viewportRef.current) return;
    if ((e.target as HTMLElement).isContentEditable) return;
    const rect = surfaceRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    // convertToPdfPoint handles page rotation (including any preview rotation delta).
    // Inserted pages have no pdf.js viewport (and no rotation), so a plain scale with
    // the y axis flipped is the same mapping.
    const [x, y] = viewportRef.current
      ? viewportRef.current.convertToPdfPoint(cx, cy)
      : [cx / scale, pageHeightPt - cy / scale];
    const box: NewTextBox = { page: displayIndex, x, y: y - 16, text: '', fontSize: 16, fontClass: 'sans', color: { r: 0, g: 0, b: 0 } };
    session.addBox(box);
    setBoxIndexes(session.boxesRaw.map((_, i) => i).filter((i) => session.boxesRaw[i].page === displayIndex));
    onDirty();
  }

  const canDelete = session.pages.length > 1;

  return (
    <div ref={wrapperRef} className="mb-8">
      <div ref={surfaceRef} onClick={onPageClick}
        className={`relative mx-auto w-fit shadow-md ${addTextMode ? 'cursor-crosshair' : ''}`}>
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg bg-background/90 p-1 shadow">
          {!isBlank && (
            <>
              <Button type="button" variant="ghost" size="icon-xs" aria-label={`Rotate page ${displayIndex + 1} left`} title="Rotate left"
                onClick={(e) => { e.stopPropagation(); rotate(-90); }}>⟲</Button>
              <Button type="button" variant="ghost" size="icon-xs" aria-label={`Rotate page ${displayIndex + 1} right`} title="Rotate right"
                onClick={(e) => { e.stopPropagation(); rotate(90); }}>⟳</Button>
              {rotDelta !== 0 && <span className="px-1 py-1 text-xs text-muted">{rotDelta}°</span>}
            </>
          )}
          <Button type="button" variant="ghost" size="icon-xs" data-testid="delete-page"
            aria-label={`Delete page ${displayIndex + 1}`}
            title={canDelete ? 'Delete page' : 'A document needs at least one page'}
            disabled={!canDelete}
            onClick={(e) => { e.stopPropagation(); onDeletePage(); }}>
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
        {isBlank ? (
          <div data-testid="blank-page" className={`bg-white ${REPLAY_BLOCK}`}
            style={{ width: Math.round(slot.width * scale), height: Math.round(slot.height * scale) }} />
        ) : (
          <canvas ref={canvasRef} className={`block ${REPLAY_BLOCK}`} />
        )}
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
              focus:bg-white focus:text-slate-900 focus:ring-1 focus:ring-accent ${REPLAY_MASK} ${
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
              key={b.id ?? `box-${i}`}
              data-testid="new-text-box"
              contentEditable
              suppressContentEditableWarning
              onInput={(e) => { session.updateBox(i, { text: e.currentTarget.textContent ?? '' }); onDirty(); }}
              // text-slate-900 is pinned (not text-ink) for the same reason as the span above:
              // this box sits on the white canvas regardless of site theme, and would
              // otherwise inherit body's theme-flipping text-ink and vanish in dark mode.
              className={`absolute min-w-8 border border-dashed border-accent bg-white/80 px-0.5 text-slate-900 outline-none ${REPLAY_MASK}`}
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
      <div className="mx-auto mt-1 w-fit">
        <Button type="button" variant="ghost" size="sm" data-testid="add-page-below"
          aria-label={`Add page after page ${displayIndex + 1}`}
          title="Add a blank page after this one"
          disabled={!loaded}
          onClick={addPageBelow}>
          + Add page below
        </Button>
      </div>
    </div>
  );
}
