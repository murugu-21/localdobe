import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ResizeSpec } from '../../../lib/pdf/edit/session';

export const RESIZE_OPTIONS: { value: string; label: string; spec: ResizeSpec | null }[] = [
  { value: 'none', label: 'Original size', spec: null },
  { value: 'p50', label: 'Scale to 50%', spec: { kind: 'percent', value: 50 } },
  { value: 'p75', label: 'Scale to 75%', spec: { kind: 'percent', value: 75 } },
  { value: 'p150', label: 'Scale to 150%', spec: { kind: 'percent', value: 150 } },
  { value: 'p200', label: 'Scale to 200%', spec: { kind: 'percent', value: 200 } },
  { value: 'a4', label: 'Fit to A4', spec: { kind: 'fit', target: 'a4' } },
  { value: 'letter', label: 'Fit to Letter', spec: { kind: 'fit', target: 'letter' } },
];

interface Props {
  dirty: boolean;
  exporting: boolean;
  addTextMode: boolean;
  resizeValue: string;
  onToggleAddText: () => void;
  onResizeChange: (value: string) => void;
  onExport: () => void;
}

export function ExportBar({ dirty, exporting, addTextMode, resizeValue, onToggleAddText, onResizeChange, onExport }: Props) {
  return (
    <div className="sticky top-0 z-10 mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
      <Button
        type="button"
        data-testid="toggle-add-text"
        variant={addTextMode ? 'default' : 'secondary'}
        onClick={onToggleAddText}
      >
        {addTextMode ? 'Click the page to place text…' : '+ Add text'}
      </Button>
      <label className="flex items-center gap-2 text-sm text-muted">
        Page size
        <Select value={resizeValue} onValueChange={onResizeChange}>
          <SelectTrigger data-testid="resize-select" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RESIZE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <p className="flex-1 text-xs text-muted">Click any text to edit it in place. Rotate pages with the ⟲ ⟳ buttons on each page.</p>
      <Button type="button" data-testid="run-tool" onClick={onExport} disabled={!dirty || exporting} size="lg">
        {exporting ? 'Exporting…' : 'Export PDF'}
      </Button>
    </div>
  );
}
