/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web';
import { centerCropRgba, interpretScores, rgbaToTensorData, MODEL_INPUT_SIZE } from '../lib/pdf/orientation';

export interface DetectRequest { id: number; rgba: ArrayBuffer; width: number; height: number }
export type DetectResponse =
  | { id: number; ok: true; angle: number; confidence: number }
  | { id: number; ok: false; error: string };

// Self-hosted runtime; single-threaded because the site is not cross-origin
// isolated (multithreaded wasm needs COOP/COEP headers we don't serve).
ort.env.wasm.wasmPaths = '/wasm/ort/';
ort.env.wasm.numThreads = 1;

let sessionPromise: Promise<ort.InferenceSession> | null = null;
function getSession(): Promise<ort.InferenceSession> {
  sessionPromise ??= ort.InferenceSession.create('/models/doc-ori.onnx', { executionProviders: ['wasm'] });
  return sessionPromise;
}

self.onmessage = async (e: MessageEvent<DetectRequest>) => {
  const { id, rgba, width, height } = e.data;
  try {
    const session = await getSession();
    const cropped = centerCropRgba(new Uint8ClampedArray(rgba), width, height);
    const input = new ort.Tensor('float32', rgbaToTensorData(cropped), [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
    const output = await session.run({ [session.inputNames[0]]: input });
    const scores = output[session.outputNames[0]].data as Float32Array;
    const { angle, confidence } = interpretScores(scores);
    self.postMessage({ id, ok: true, angle, confidence } satisfies DetectResponse);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies DetectResponse);
  }
};
