import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { FileDropzone } from './shared/FileDropzone';
import { DownloadResult } from './shared/DownloadResult';
import { ProgressBar } from './shared/ProgressBar';

type Action = 'text' | 'image' | 'remove';
type Phase = 'idle' | 'working' | 'done' | 'error';

const ACTIONS: { value: Action; label: string }[] = [
  { value: 'text', label: 'Add text' },
  { value: 'image', label: 'Add image' },
  { value: 'remove', label: 'Remove watermarks' },
];

export default function WatermarkTool() {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [action, setAction] = useState<Action>('text');
  const [text, setText] = useState('CONFIDENTIAL');
  // Default to stamp (on top): most real-world PDFs (scans, generated docs) paint
  // an opaque background over the whole page, making behind-content watermarks
  // invisible. Users opt into classic behind-content placement explicitly.
  const [onTop, setOnTop] = useState(true); // false = watermark (behind), true = stamp (on top)
  const [opacity, setOpacity] = useState(0.4);
  const [rotation, setRotation] = useState(45);
  const [fontSize, setFontSize] = useState(48);
  const [colorHex, setColorHex] = useState('#808080');
  const [image, setImage] = useState<Uint8Array | null>(null);
  const [imageScale, setImageScale] = useState(0.5);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Uint8Array | null>(null);

  function resetIfDone() {
    if (phase === 'done') { setPhase('idle'); setResult(null); }
  }

  async function onFile([f]: File[]) {
    setFile({ name: f.name.replace(/\.pdf$/i, ''), bytes: new Uint8Array(await f.arrayBuffer()) });
    setPhase('idle'); setResult(null); setError(null);
  }

  async function run() {
    if (!file) return;
    setPhase('working'); setError(null);
    try {
      const client = await import('../../lib/pdf/pdfcpuClient');
      let out: Uint8Array;
      if (action === 'remove') {
        out = await client.removeWatermarks(file.bytes);
      } else if (action === 'text') {
        out = await client.addTextWatermark(file.bytes, text, onTop, { opacity, rotation, fontSize, colorHex });
      } else {
        if (!image) { setError('Choose a PNG or JPG image first.'); setPhase('error'); return; }
        out = await client.addImageWatermark(file.bytes, image, onTop, { opacity, rotation, scale: imageScale });
      }
      setResult(out);
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Watermarking failed.');
      setPhase('error');
    }
  }

  const suffix = action === 'remove' ? 'no-watermark' : onTop ? 'stamped' : 'watermarked';

  return (
    <div className="space-y-6">
      {!file && <FileDropzone label="Choose a PDF" onFiles={onFile} />}
      {file && (
        <>
          <p className="text-sm text-muted-foreground">{file.name}.pdf</p>
          <RadioGroup
            value={action}
            onValueChange={(v) => { setAction(v as Action); resetIfDone(); }}
            className="flex w-auto flex-row flex-wrap items-center gap-4"
          >
            {ACTIONS.map(({ value, label }) => (
              <Label key={value} className="flex items-center gap-2 text-sm font-normal">
                <RadioGroupItem value={value} />
                {label}
              </Label>
            ))}
          </RadioGroup>
          {action !== 'remove' && (
            <div className="space-y-4 rounded-xl border border-border p-4">
              {action === 'text' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="wm-text">Text</Label>
                    <Input
                      id="wm-text"
                      data-testid="wm-text"
                      value={text}
                      onChange={(e) => { setText(e.target.value); resetIfDone(); }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="wm-font-size">Font size</Label>
                    <Input
                      id="wm-font-size"
                      type="number"
                      min={8}
                      max={144}
                      value={fontSize}
                      onChange={(e) => { setFontSize(Number(e.target.value)); resetIfDone(); }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="wm-color">Color</Label>
                    <input
                      id="wm-color"
                      type="color"
                      value={colorHex}
                      onChange={(e) => { setColorHex(e.target.value); resetIfDone(); }}
                      className="mt-1 block h-10 w-16"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="wm-image">Image (PNG or JPG)</Label>
                    <input
                      id="wm-image"
                      type="file"
                      accept="image/png,image/jpeg"
                      className="mt-1 block text-sm"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        setImage(f ? new Uint8Array(await f.arrayBuffer()) : null);
                        resetIfDone();
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Scale: {Math.round(imageScale * 100)}% of page</Label>
                    <Slider
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={[imageScale]}
                      onValueChange={([v]) => { setImageScale(v); resetIfDone(); }}
                    />
                  </div>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Opacity: {opacity}</Label>
                  <Slider
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={[opacity]}
                    onValueChange={([v]) => { setOpacity(v); resetIfDone(); }}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Rotation: {rotation}°</Label>
                  <Slider
                    min={-90}
                    max={90}
                    step={15}
                    value={[rotation]}
                    onValueChange={([v]) => { setRotation(v); resetIfDone(); }}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Placement</Label>
                <RadioGroup
                  value={onTop ? 'stamp' : 'watermark'}
                  onValueChange={(v) => { setOnTop(v === 'stamp'); resetIfDone(); }}
                  className="flex flex-col gap-2"
                >
                  <Label className="flex items-start gap-2 text-sm font-normal">
                    <RadioGroupItem value="stamp" className="mt-0.5" />
                    <span>On top of content (stamp) — always visible</span>
                  </Label>
                  <Label className="flex items-start gap-2 text-sm font-normal">
                    <RadioGroupItem value="watermark" className="mt-0.5" />
                    <span>
                      Behind content (classic watermark) — invisible on PDFs with opaque
                      backgrounds, such as scans and many generated documents
                    </span>
                  </Label>
                </RadioGroup>
              </div>
            </div>
          )}
          {action === 'remove' && (
            <p className="text-sm text-muted-foreground">Removes watermarks and stamps that exist as separate PDF objects (the kind pdfcpu-style tools add). Watermarks flattened into page images can’t be removed.</p>
          )}
          {phase !== 'done' && (
            <Button
              type="button"
              data-testid="run-tool"
              onClick={run}
              disabled={phase === 'working'}
              size="lg"
              className="w-full"
            >
              {action === 'remove' ? 'Remove watermarks' : onTop ? 'Add stamp' : 'Add watermark'}
            </Button>
          )}
          {phase === 'working' && <ProgressBar value={null} />}
        </>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {phase === 'done' && result && file && (
        <DownloadResult filename={`${file.name}-${suffix}.pdf`} bytes={result} note="Processed entirely on your device." />
      )}
    </div>
  );
}
