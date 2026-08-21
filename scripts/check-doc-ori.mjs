// Smoke-check the committed doc-orientation model outside the browser.
//   node scripts/check-doc-ori.mjs             -> synthetic text page at 4 angles
//   node scripts/check-doc-ori.mjs file.pdf …  -> every page of the given PDFs
import { readFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import * as ort from 'onnxruntime-web';
import {
  centerCropRgba, interpretScores, rgbaToTensorData, MODEL_INPUT_SIZE, MODEL_SHORT_SIDE,
} from '../src/lib/pdf/orientation.ts';

ort.env.wasm.numThreads = 1;
const session = await ort.InferenceSession.create('public/models/doc-ori.onnx', { executionProviders: ['wasm'] });

async function classify(rgba, width, height) {
  const cropped = centerCropRgba(rgba, width, height);
  const input = new ort.Tensor('float32', rgbaToTensorData(cropped), [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
  const out = await session.run({ [session.inputNames[0]]: input });
  return interpretScores(out[session.outputNames[0]].data);
}

function drawDocUpright(w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#111'; ctx.font = '13px sans-serif';
  for (let y = 30; y < h - 20; y += 22) ctx.fillText('The quick brown fox jumps over the lazy dog 0123456789.', 24, y);
  return c;
}

function rotated(canvas, angle) {
  const [w, h] = angle % 180 === 0 ? [canvas.width, canvas.height] : [canvas.height, canvas.width];
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.translate(w / 2, h / 2); ctx.rotate((angle * Math.PI) / 180);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return c;
}

const pdfPaths = process.argv.slice(2);
if (pdfPaths.length === 0) {
  const base = drawDocUpright(MODEL_SHORT_SIDE, Math.round((MODEL_SHORT_SIDE * 792) / 612));
  for (const angle of [0, 90, 180, 270]) {
    const c = rotated(base, angle);
    const { data, width, height } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    const r = await classify(data, width, height);
    console.log(`drawn at ${angle}° -> label ${r.angle} (confidence ${r.confidence.toFixed(3)})`);
  }
} else {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  for (const path of pdfPaths) {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await readFile(path)) }).promise;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const v1 = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: MODEL_SHORT_SIDE / Math.min(v1.width, v1.height) });
      const c = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
      const r = await classify(data, width, height);
      console.log(`${path} page ${i} -> label ${r.angle} (confidence ${r.confidence.toFixed(3)})`);
    }
    if (typeof doc.loadingTask?.destroy === 'function') await doc.loadingTask.destroy();
  }
}
