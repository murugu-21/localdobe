import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { FileDropzone } from '../shared/FileDropzone';
import { DownloadResult } from '../shared/DownloadResult';
import { ProgressBar } from '../shared/ProgressBar';
import { PageEditor } from './PageEditor';
import { ExportBar, RESIZE_OPTIONS } from './ExportBar';
import { EditSession } from '../../../lib/pdf/edit/session';
import { FONT_FILES, type FontClass } from '../../../lib/pdf/edit/fontMatch';

async function fetchFont(cls: FontClass): Promise<Uint8Array> {
  const res = await fetch(FONT_FILES[cls]);
  if (!res.ok) throw new Error(`Failed to load font: ${cls}`);
  return new Uint8Array(await res.arrayBuffer());
}

export default function EditTool() {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [srcBytes, setSrcBytes] = useState<Uint8Array | null>(null);
  const [name, setName] = useState('document');
  const [dirty, setDirty] = useState(false);
  const [addTextMode, setAddTextMode] = useState(false);
  const [resizeValue, setResizeValue] = useState('none');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Uint8Array | null>(null);
  const session = useRef(new EditSession());
  const docRef = useRef<PDFDocumentProxy | null>(null);

  // Close the previously opened pdf.js document's worker whenever a new one replaces it,
  // and on unmount — `openPdf` spawns a dedicated worker per document that nothing else
  // will terminate (see src/lib/pdf/render.ts: closePdf / Task 6 notes).
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);
  useEffect(() => {
    return () => {
      if (docRef.current) {
        void import('../../../lib/pdf/render').then(({ closePdf }) => closePdf(docRef.current!)).catch(() => {});
      }
    };
  }, []);

  async function onFile([file]: File[]) {
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { openPdf, closePdf } = await import('../../../lib/pdf/render');
      if (docRef.current) {
        const previous = docRef.current;
        void closePdf(previous).catch(() => {});
      }
      const nextDoc = await openPdf(bytes);
      setDoc(nextDoc);
      setSrcBytes(bytes);
      setName(file.name.replace(/\.pdf$/i, ''));
      session.current = new EditSession();
      setDirty(false);
      setAddTextMode(false);
      setResizeValue('none');
      setResult(null);
    } catch {
      setError('Could not open this PDF. It may be corrupt or password-protected (see /unlock-pdf).');
    }
  }

  function onResizeChange(value: string) {
    setResizeValue(value);
    session.current.resize = RESIZE_OPTIONS.find((o) => o.value === value)?.spec ?? null;
    setDirty(!session.current.isEmpty);
  }

  async function exportPdf() {
    if (!srcBytes) return;
    setExporting(true); setError(null);
    try {
      const { exportEditedPdf } = await import('../../../lib/pdf/edit/export');
      setResult(await exportEditedPdf(srcBytes, {
        edits: session.current.edits,
        boxes: session.current.boxes,
        rotations: session.current.rotations,
        resize: session.current.resize,
      }, fetchFont));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed — your edits are still here, try again.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      {!doc && <FileDropzone label="Choose a PDF to edit" onFiles={onFile} />}
      {doc && (
        <>
          <ExportBar dirty={dirty} exporting={exporting} addTextMode={addTextMode} resizeValue={resizeValue}
            onToggleAddText={() => setAddTextMode((m) => !m)} onResizeChange={onResizeChange} onExport={exportPdf} />
          {exporting && <div className="mb-4"><ProgressBar value={null} /></div>}
          {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}
          {result && <div className="mb-6"><DownloadResult filename={`${name}-edited.pdf`} bytes={result} note="Edited entirely on your device." /></div>}
          <div className="overflow-x-auto rounded-xl bg-surface p-4">
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PageEditor key={i} doc={doc} pageIndex={i} session={session.current}
                addTextMode={addTextMode} onDirty={() => setDirty(!session.current.isEmpty)} />
            ))}
          </div>
          <p className="mt-4 text-xs text-muted">
            How editing works: your change covers the original text and redraws it with a matched font
            (Liberation fonts are metric-compatible with Arial, Times, and Courier). Surrounding text does not
            reflow, and covers assume a solid background.
          </p>
        </>
      )}
    </div>
  );
}
