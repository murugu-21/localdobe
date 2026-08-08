/** pdf.js textContent item -> PDF user-space box. y is the text BASELINE. */
export function textItemToPdfBox(item: { transform: number[]; width: number; height: number }) {
  const [, b, c, d, e, f] = item.transform;
  return {
    x: e,
    y: f,
    fontSize: Math.hypot(c, d) || Math.abs(b),
    width: item.width,
    height: item.height,
  };
}

/** CSS px (top-left origin, at render scale) -> PDF pt (bottom-left origin). */
export function cssPointToPdf(cssX: number, cssY: number, scale: number, pageHeightPt: number) {
  return { x: cssX / scale, y: pageHeightPt - cssY / scale };
}
