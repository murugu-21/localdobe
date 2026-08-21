// Downloads the document-orientation ONNX model and copies the onnxruntime-web
// wasm runtime into public/, so the site stays fully self-hosted (no CDN).
//
// Model: PP-LCNet_x1_0_doc_ori — PaddleOCR's 4-class (0/90/180/270) document
// orientation classifier, Apache-2.0, converted to ONNX by the monkt/paddleocr-onnx
// project (the official PaddlePaddle repo publishes only .pdiparams, no ONNX).
//
// Run manually (network required), then commit the regenerated files:
//   npm run refresh-doc-ori
import { createHash } from 'node:crypto';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';

const MODEL_URL =
  'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/preprocessing/doc-orientation/PP-LCNet_x1_0_doc_ori.onnx';

const res = await fetch(MODEL_URL);
if (!res.ok) throw new Error(`fetch ${MODEL_URL}: ${res.status}`);
const model = Buffer.from(await res.arrayBuffer());
const sha256 = createHash('sha256').update(model).digest('hex');

await mkdir('public/models', { recursive: true });
await writeFile('public/models/doc-ori.onnx', model);

// onnxruntime-web's wasm EP loads its runtime from ort.env.wasm.wasmPaths at
// runtime; these two files are the whole single-threaded+SIMD CPU backend.
await mkdir('public/wasm/ort', { recursive: true });
for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) {
  await copyFile(`node_modules/onnxruntime-web/dist/${f}`, `public/wasm/ort/${f}`);
}

await writeFile(
  'public/models/README.md',
  `# public/models

Committed build artifacts, refreshed manually via \`npm run refresh-doc-ori\`.

## doc-ori.onnx

PP-LCNet_x1_0_doc_ori — PaddleOCR document image orientation classifier
(4 classes: 0/90/180/270 degrees). Apache-2.0.

- Source: ${MODEL_URL}
- sha256: ${sha256}
- Runtime: onnxruntime-web (wasm EP), runtime files under /public/wasm/ort/
  (copied from the installed onnxruntime-web package by the same script).
`,
);
console.log(`doc-ori.onnx downloaded (${(model.length / 1024 / 1024).toFixed(2)} MB, sha256 ${sha256})`);
