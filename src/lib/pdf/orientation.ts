/**
 * Pure pre/post-processing for the PP-LCNet_x1_0_doc_ori orientation model.
 * Pipeline (from the model's inference.yml): resize short side to 256 (done by
 * the caller when rendering the page), center-crop 224, scale 1/255, normalize
 * with ImageNet mean/std, NCHW. Output: 4 scores for labels [0, 90, 180, 270].
 */
export const ORIENTATION_ANGLES = [0, 90, 180, 270] as const;
export type OrientationAngle = (typeof ORIENTATION_ANGLES)[number];
export interface OrientationResult { angle: OrientationAngle; confidence: number }

/** Below this softmax confidence we suggest nothing — silence over wrong guesses. */
export const CONFIDENCE_THRESHOLD = 0.8;
export const MODEL_INPUT_SIZE = 224;
/** Callers render the page so its short side is this many pixels before cropping. */
export const MODEL_SHORT_SIDE = 256;

const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

export function centerCropRgba(rgba: Uint8ClampedArray, width: number, height: number, size = MODEL_INPUT_SIZE): Uint8ClampedArray {
  if (width < size || height < size) throw new Error(`image ${width}x${height} too small for ${size} crop`);
  const x0 = Math.floor((width - size) / 2);
  const y0 = Math.floor((height - size) / 2);
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    const srcStart = ((y0 + y) * width + x0) * 4;
    out.set(rgba.subarray(srcStart, srcStart + size * 4), y * size * 4);
  }
  return out;
}

export function rgbaToTensorData(rgba: Uint8ClampedArray, size = MODEL_INPUT_SIZE): Float32Array {
  const plane = size * size;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) out[c * plane + i] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  }
  return out;
}

/** PaddleClas inference exports usually end in softmax; raw logits appear in some
 *  conversions. Detect which we got rather than double-softmaxing probabilities. */
export function interpretScores(scores: ArrayLike<number>): OrientationResult {
  const arr = Array.from(scores);
  const sum = arr.reduce((a, b) => a + b, 0);
  const isProbs = arr.every((v) => v >= 0 && v <= 1) && Math.abs(sum - 1) < 0.01;
  let probs = arr;
  if (!isProbs) {
    const max = Math.max(...arr);
    const exps = arr.map((v) => Math.exp(v - max));
    const expSum = exps.reduce((a, b) => a + b, 0);
    probs = exps.map((v) => v / expSum);
  }
  let best = 0;
  for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i;
  return { angle: ORIENTATION_ANGLES[best], confidence: probs[best] };
}

/** The label is how far the page content appears rotated clockwise; the fix
 *  rotates it back. (Task 4's smoke check verifies this mapping against real
 *  rotated renders — if inverted in practice, flip ONLY this function.) */
export function suggestedCorrection(angle: OrientationAngle): OrientationAngle {
  return ((360 - angle) % 360) as OrientationAngle;
}
