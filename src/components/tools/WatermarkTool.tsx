import { useRef, useState } from 'react';
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
  const [opacity, setOpacity] = useState(0.4);
  const [rotation, setRotation] = useState(45);
  const [fontSize, setFontSize] = useState(48);
  const [colorHex, setColorHex] = useState('#808080');
  const [image, setImage] = useState<Uint8Array | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [imageScale, setImageScale] = useState(0.5);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Uint8Array | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  function resetIfDone() {
    if (phase === 'done') { setPhase('idle'); setResult(null); }
  }

  async function onFile([f]: File[]) {
    setFile({ name: f.name.replace(/\.pdf$/i, ''), bytes: new Uint8Array(await f.arrayBuffer()) });
    setPhase('idle'); setResult(null); setError(null);
  }

  function clear() {
    setFile(null);
    setAction('text');
    setText('CONFIDENTIAL');
    setOpacity(0.4);
    setRotation(45);
    setFontSize(48);
    setColorHex('#808080');
    setImage(null);
    setImageName(null);
    setImageScale(0.5);
    setPhase('idle');
    setError(null);
    setResult(null);
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
        // The engine silently drops characters its built-in font can't draw — a fully
        // unsupported text would "succeed" with no visible watermark at all.
        const { unsupportedWatermarkChars } = await import('../../lib/pdf/watermarkDesc');
        const bad = unsupportedWatermarkChars(text);
        if (bad.length > 0) {
          setError(`The watermark font can't draw these characters: ${bad.join(' ')} — letters, numbers, and Western European accents work. For other scripts or symbols, add your text as an image instead.`);
          setPhase('error');
          return;
        }
        out = await client.addTextWatermark(file.bytes, text, { opacity, rotation, fontSize, colorHex });
      } else {
        if (!image) { setError('Choose a PNG or JPG image first.'); setPhase('error'); return; }
        out = await client.addImageWatermark(file.bytes, image, { opacity, rotation, scale: imageScale });
      }
      setResult(out);
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Watermarking failed.');
      setPhase('error');
    }
  }

  const suffix = action === 'remove' ? 'no-watermark' : 'watermarked';

  return (
    <div className="space-y-6">
      {!file && <FileDropzone label="Choose a PDF" onFiles={onFile} />}
      {file && (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{file.name}.pdf</p>
            <Button type="button" variant="ghost" size="sm" data-testid="clear-file" onClick={clear}>
              Start over
            </Button>
          </div>
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
                    <div className="flex items-center gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => imageInputRef.current?.click()}
                      >
                        Choose image…
                      </Button>
                      {imageName && <span className="truncate text-sm text-muted-foreground">{imageName}</span>}
                    </div>
                    <input
                      id="wm-image"
                      ref={imageInputRef}
                      data-testid="wm-image-input"
                      type="file"
                      accept="image/png,image/jpeg"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        setImage(f ? new Uint8Array(await f.arrayBuffer()) : null);
                        setImageName(f ? f.name : null);
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
              <p className="text-xs text-muted-foreground">
                The watermark is drawn over the page so it stays visible on every PDF. Lower the
                opacity for a subtle background look, or raise it for a bold stamp.
              </p>
            </div>
          )}
          {action === 'remove' && (
            <p className="text-sm text-muted-foreground">Removes watermarks and stamps that were added as separate layers (the kind most watermarking tools add). Watermarks flattened into page images can’t be removed.</p>
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
              {action === 'remove' ? 'Remove watermarks' : 'Add watermark'}
            </Button>
          )}
          {phase === 'working' && <ProgressBar value={null} />}
        </>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {phase === 'done' && result && file && (
        <DownloadResult filename={`${file.name}-${suffix}.pdf`} bytes={result} note="Processed entirely on your device." />
      )}
    </div>
  );
}
