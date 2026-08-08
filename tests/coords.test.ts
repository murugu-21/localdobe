import { textItemToPdfBox, cssPointToPdf } from '../src/lib/pdf/edit/coords';

test('unrotated text item maps directly', () => {
  // pdf.js textContent transform: [fs, 0, 0, fs, tx, ty]
  const box = textItemToPdfBox({ transform: [14, 0, 0, 14, 72, 700], width: 90, height: 14 });
  expect(box).toEqual({ x: 72, y: 700, fontSize: 14, width: 90, height: 14 });
});

test('fontSize derives from matrix magnitude for scaled text', () => {
  const box = textItemToPdfBox({ transform: [0, 12, -12, 0, 10, 20], width: 40, height: 12 });
  expect(box.fontSize).toBeCloseTo(12);
});

test('cssPointToPdf flips y and unscales', () => {
  // page 792pt tall rendered at 1.5x: css (150, 138) -> pdf (100, 792 - 92)
  expect(cssPointToPdf(150, 138, 1.5, 792)).toEqual({ x: 100, y: 700 });
});
