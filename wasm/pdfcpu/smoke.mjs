import { readFile, writeFile } from 'node:fs/promises';
import '../../src/workers/go/wasm_exec.js';

const go = new globalThis.Go();
const { instance } = await WebAssembly.instantiate(await readFile('../../public/wasm/pdfcpu.wasm'), go.importObject);
go.run(instance);
// Build a quick fixture PDF with pdf-lib from the repo root node_modules.
// Note: pdf-lib's ESM build (es/index.js) uses extensionless internal imports that
// Node's ESM resolver rejects; the CJS build (resolved via the "pdf-lib" bare
// specifier -> package.json "main") interops fine with named imports here.
const { PDFDocument } = await import('pdf-lib');
const doc = await PDFDocument.create();
for (let i = 0; i < 30; i++) doc.addPage([612, 792]).drawText(`page ${i}`, { x: 50, y: 700 });
const input = await doc.save();
const res = globalThis.__pdfcpuOptimize(new Uint8Array(input), JSON.stringify({ dedupResources: true, dedupContentStreams: true }));
if (!res.ok) throw new Error(res.error);
console.log(`optimize: in=${input.length} out=${res.bytes.length}`);

const wm = globalThis.__pdfcpuWatermark(new Uint8Array(input), JSON.stringify({ mode: 'addText', onTop: false, text: 'DRAFT', desc: 'points:48, op:0.4, rot:45' }), null);
if (!wm.ok) throw new Error(wm.error);
const unwm = globalThis.__pdfcpuWatermark(wm.bytes, JSON.stringify({ mode: 'remove', onTop: false, text: '', desc: '' }), null);
if (!unwm.ok) throw new Error(unwm.error);
console.log(`watermark: add=${wm.bytes.length} removed=${unwm.bytes.length}`);

const enc = globalThis.__pdfcpuEncrypt(new Uint8Array(input), JSON.stringify({ userPw: 'secret', ownerPw: '' }));
if (!enc.ok) throw new Error(enc.error);
const dec = globalThis.__pdfcpuDecrypt(enc.bytes, JSON.stringify({ password: 'secret' }));
if (!dec.ok) throw new Error(dec.error);
const bad = globalThis.__pdfcpuDecrypt(enc.bytes, JSON.stringify({ password: 'wrong' }));
if (bad.ok) throw new Error('decrypt with wrong password should fail');
console.log(`encrypt/decrypt: enc=${enc.bytes.length} dec=${dec.bytes.length} wrong-pw=rejected`);

const sig = globalThis.__pdfcpuValidateSignatures(new Uint8Array(input));
console.log(`signatures on unsigned doc: ${sig.ok ? sig.report : `error (acceptable for unsigned): ${sig.error}`}`);

const rmSig = globalThis.__pdfcpuRemoveSignatures(new Uint8Array(input));
console.log(`removeSignatures on unsigned doc: ${rmSig.ok ? `ok, out=${rmSig.bytes.length}` : `error (acceptable for unsigned): ${rmSig.error}`}`);
