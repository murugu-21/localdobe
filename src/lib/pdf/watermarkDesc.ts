export interface TextWatermarkOpts { opacity: number; rotation: number; fontSize: number; colorHex: string }
export interface ImageWatermarkOpts { opacity: number; rotation: number; scale: number }

/** pdfcpu text watermark description string, e.g. "points:48, op:0.4, rot:45, fillc:#808080". */
export function buildTextWatermarkDesc(o: TextWatermarkOpts): string {
  return `points:${o.fontSize}, op:${o.opacity}, rot:${o.rotation}, fillc:${o.colorHex}`;
}

/** pdfcpu image watermark description string; scale is relative to page (0..1]. */
export function buildImageWatermarkDesc(o: ImageWatermarkOpts): string {
  return `op:${o.opacity}, rot:${o.rotation}, sc:${o.scale} rel`;
}
