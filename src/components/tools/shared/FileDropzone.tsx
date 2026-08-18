import { useRef, useState, type DragEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { LocalBadge } from './LocalBadge';

interface Props {
  multiple?: boolean;
  label: string;
  onFiles: (files: File[]) => void;
}

function isPdf(f: File) {
  return f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
}

export function FileDropzone({ multiple = false, label, onFiles }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function accept(list: FileList | null) {
    if (!list) return;
    const files = Array.from(list);
    const pdfs = files.filter(isPdf);
    if (pdfs.length === 0) {
      setError('That doesn’t look like a PDF. Please choose a .pdf file.');
      return;
    }
    setError(null);
    onFiles(multiple ? pdfs : pdfs.slice(0, 1));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    accept(e.dataTransfer.files);
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          'group block w-full cursor-pointer rounded-2xl border-2 border-dashed px-6 py-12 text-center transition',
          dragOver
            ? 'border-primary bg-primary/5'
            : 'border-border bg-panel/40 hover:border-primary hover:bg-panel/70',
        )}
      >
        <span className="block text-lg font-semibold">{label}</span>
        <span className="mt-1 block text-sm text-muted-foreground">Drag &amp; drop or click to browse</span>
        <span className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition group-hover:bg-primary/90">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" x2="12" y1="3" y2="15" />
          </svg>
          Choose file
        </span>
      </button>
      <input
        ref={inputRef}
        data-testid="file-input"
        type="file"
        accept="application/pdf,.pdf"
        multiple={multiple}
        className="hidden"
        onChange={(e) => { accept(e.target.files); e.target.value = ''; }}
      />
      {error && (
        <Alert variant="destructive" role="alert" className="mt-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <LocalBadge />
    </div>
  );
}
