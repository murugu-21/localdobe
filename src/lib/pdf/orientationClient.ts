import type { OrientationResult } from './orientation';
import type { DetectResponse } from '../../workers/orientation.worker';

type Settle = { resolve: (r: OrientationResult) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Settle>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../../workers/orientation.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<DetectResponse>) => {
      const entry = pending.get(e.data.id);
      if (!entry) return;
      pending.delete(e.data.id);
      if (e.data.ok) entry.resolve({ angle: e.data.angle as OrientationResult['angle'], confidence: e.data.confidence });
      else entry.reject(new Error(e.data.error));
    };
    worker.onerror = () => {
      for (const { reject } of pending.values()) reject(new Error('orientation detection unavailable'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/** Classify one page render (RGBA, short side ≥ 224 px). Rejects on any model
 *  failure — callers degrade to manual-only, they never surface this as a blocking error. */
export function detectOrientation(rgba: Uint8ClampedArray, width: number, height: number): Promise<OrientationResult> {
  const id = nextId++;
  const buffer = rgba.slice().buffer;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, rgba: buffer, width, height }, [buffer]);
  });
}
