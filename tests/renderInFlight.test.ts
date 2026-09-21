import { describe, expect, it } from 'vitest';
import type { PDFPageProxy } from 'pdfjs-dist';
import { renderPageToCanvas } from '../src/lib/pdf/render';

/** The exact failure pdf.js raises when a canvas already has a render in flight. */
const CANVAS_IN_USE =
  'Cannot use the same canvas during multiple render() operations. ' +
  'Use different canvas or ensure previous operations were cancelled or completed.';

interface RenderCall {
  canvas: unknown;
  cancelled: boolean;
  /** Completes the render and clears the canvas from pdf.js's in-use set. */
  finish: () => void;
  fail: (err: Error) => void;
  /** Mirrors InternalRenderTask.cancel(): clears in-use synchronously, rejects with RenderingCancelledException. */
  cancel: () => void;
}

function makeCanvas(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getContext: () => ({}),
  } as unknown as HTMLCanvasElement;
}

/**
 * Minimal stand-in for pdf.js's page: `render()` refuses a canvas that already has
 * a task drawing on it (returning a task whose promise rejects, like pdf.js does
 * via its `.catch(complete)`), and `cancel()` clears that in-use mark synchronously.
 * Reproducing the contract here keeps the cancellation logic testable without a browser.
 */
function makePage() {
  const inUse = new WeakSet<object>();
  const calls: RenderCall[] = [];
  const page = {
    rotate: 0,
    getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 200 * scale }),
    render: ({ canvas }: { canvas: object }) => {
      if (inUse.has(canvas)) {
        return { promise: Promise.reject(new Error(CANVAS_IN_USE)), cancel: () => {} };
      }
      inUse.add(canvas);
      let resolve!: () => void;
      let reject!: (err: Error) => void;
      const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
      const call: RenderCall = {
        canvas,
        cancelled: false,
        finish: () => { inUse.delete(canvas); resolve(); },
        fail: (err) => { inUse.delete(canvas); reject(err); },
        cancel: () => {
          call.cancelled = true;
          const err = new Error('Rendering cancelled');
          err.name = 'RenderingCancelledException';
          call.fail(err);
        },
      };
      calls.push(call);
      return { promise, cancel: call.cancel };
    },
  };
  return { page: page as unknown as PDFPageProxy, calls };
}

describe('renderPageToCanvas in-flight handling', () => {
  it('cancels the in-flight render before starting another on the same canvas', async () => {
    const { page, calls } = makePage();
    const canvas = makeCanvas();

    const first = renderPageToCanvas(page, canvas, 1);
    const second = renderPageToCanvas(page, canvas, 2);

    expect(calls).toHaveLength(2);
    expect(calls[0].cancelled).toBe(true);

    calls[1].finish();
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  it('resolves quietly when pdf.js cancels the render (e.g. document closed mid-render)', async () => {
    const { page, calls } = makePage();
    const render = renderPageToCanvas(page, makeCanvas(), 1);

    calls[0].cancel();

    await expect(render).resolves.toBeUndefined();
  });

  it('still rejects genuine render failures', async () => {
    const { page, calls } = makePage();
    const render = renderPageToCanvas(page, makeCanvas(), 1);

    calls[0].fail(new Error('page is no longer valid'));

    await expect(render).rejects.toThrow('page is no longer valid');
  });

  it('leaves separate canvases rendering independently', async () => {
    const { page, calls } = makePage();

    const a = renderPageToCanvas(page, makeCanvas(), 1);
    const b = renderPageToCanvas(page, makeCanvas(), 1);

    expect(calls).toHaveLength(2);
    expect(calls[0].cancelled).toBe(false);
    expect(calls[1].cancelled).toBe(false);

    calls[0].finish();
    calls[1].finish();
    await expect(a).resolves.toBeUndefined();
    await expect(b).resolves.toBeUndefined();
  });
});
