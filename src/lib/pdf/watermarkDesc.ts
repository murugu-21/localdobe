export interface TextWatermarkOpts { opacity: number; rotation: number; fontSize: number; colorHex: string }
export interface ImageWatermarkOpts { opacity: number; rotation: number; scale: number }

/** pdfcpu text watermark description string, e.g. "points:48, op:0.4, rot:45, fillc:#808080". */
export function buildTextWatermarkDesc(o: TextWatermarkOpts): string {
  return `points:${o.fontSize}, op:${o.opacity}, rot:${o.rotation}, fillc:${o.colorHex}`;
}

/** pdfcpu image watermark description string; scale is relative to page (0..1]. */
export function buildImageWatermarkDesc(o: ImageWatermarkOpts): string {
  return `op:${o.opacity}, rot:${o.rotation}, scale:${o.scale} rel`;
}

// Characters above U+00FF that WinAnsi (the encoding of the built-in watermark font)
// can represent. Anything else is SILENTLY DROPPED by the engine — the watermark
// simply doesn't render — so unsupported text must be rejected before running.
const WINANSI_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/** Returns the characters in `text` that the watermark font cannot draw ([] = all fine). */
export function unsupportedWatermarkChars(text: string): string[] {
  const bad = new Set<string>();
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code <= 0xff || WINANSI_EXTRAS.has(ch)) continue;
    bad.add(ch);
  }
  return [...bad];
}
