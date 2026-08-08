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
          'block w-full cursor-pointer rounded-2xl border-2 border-dashed px-6 py-14 text-center transition',
          dragOver ? 'border-primary bg-primary/5' : 'border-border bg-muted/40 hover:border-primary',
        )}
      >
        <span className="block text-lg font-semibold">{label}</span>
        <span className="mt-1 block text-sm text-muted-foreground">Drag &amp; drop or click to browse</span>
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
