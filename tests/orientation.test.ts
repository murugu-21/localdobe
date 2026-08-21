import { describe, expect, it } from 'vitest';
import {
  centerCropRgba,
  interpretScores,
  rgbaToTensorData,
  suggestedCorrection,
  MODEL_INPUT_SIZE,
} from '../src/lib/pdf/orientation';

function solidRgba(width: number, height: number, [r, g, b]: number[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 255;
  }
  return out;
}

describe('centerCropRgba', () => {
  it('returns a size×size RGBA buffer taken from the image center', () => {
    // 6×4 image, crop 2×2: center crop starts at x=2, y=1.
    const w = 6, h = 4;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba[(y * w + x) * 4] = y * w + x; // R encodes position
    const crop = centerCropRgba(rgba, w, h, 2);
    expect(crop.length).toBe(2 * 2 * 4);
    expect([crop[0], crop[4], crop[8], crop[12]]).toEqual([1 * 6 + 2, 1 * 6 + 3, 2 * 6 + 2, 2 * 6 + 3]);
  });

  it('rejects images smaller than the crop', () => {
    expect(() => centerCropRgba(solidRgba(100, 300, [0, 0, 0]), 100, 300)).toThrow(/small/i);
  });
});

describe('rgbaToTensorData', () => {
  it('produces NCHW float data normalized with ImageNet mean/std', () => {
    const size = MODEL_INPUT_SIZE;
    const t = rgbaToTensorData(solidRgba(size, size, [255, 0, 128]), size);
    expect(t.length).toBe(3 * size * size);
    // R plane: (255/255 - 0.485) / 0.229
    expect(t[0]).toBeCloseTo((1 - 0.485) / 0.229, 5);
    // G plane: (0 - 0.456) / 0.224
    expect(t[size * size]).toBeCloseTo(-0.456 / 0.224, 5);
    // B plane: (128/255 - 0.406) / 0.225
    expect(t[2 * size * size]).toBeCloseTo((128 / 255 - 0.406) / 0.225, 5);
  });
});

describe('interpretScores', () => {
  it('picks the argmax of probability-like scores as-is', () => {
    const r = interpretScores([0.05, 0.05, 0.85, 0.05]);
    expect(r.angle).toBe(180);
    expect(r.confidence).toBeCloseTo(0.85, 5);
  });

  it('softmaxes raw logits (negative / not summing to 1)', () => {
    const r = interpretScores([-1, 6, -2, 0]);
    expect(r.angle).toBe(90);
    expect(r.confidence).toBeGreaterThan(0.99);
  });
});

describe('suggestedCorrection', () => {
  it('rotates detected orientation back to upright', () => {
    expect(suggestedCorrection(0)).toBe(0);
    expect(suggestedCorrection(90)).toBe(270);
    expect(suggestedCorrection(180)).toBe(180);
    expect(suggestedCorrection(270)).toBe(90);
  });
});
