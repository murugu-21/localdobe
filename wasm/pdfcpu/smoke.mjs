import { readFile } from 'node:fs/promises';
import '../../src/workers/go/wasm_exec.js';

// Mirror of the /certs fs shim in src/workers/pdfcpu.worker.ts — the Go side
// sets model.TrustedCertDir='/certs' and signature validation walks it; the
// wasm_exec stub fs would fail the walk (ENOSYS), so present an empty dir.
{
  const CERT_DIR = '/certs';
  const CERT_FD = 424242;
  const fs = globalThis.fs;
  const dirStat = {
    dev: 0, ino: 1, mode: 0o40755, nlink: 1, uid: 0, gid: 0, rdev: 0,
    size: 0, blksize: 4096, blocks: 0, atimeMs: 0, mtimeMs: 0, ctimeMs: 0,
    isDirectory: () => true,
  };
  // wasm_exec.js stubs constants.O_DIRECTORY as -1, which Go's syscall.Open treats
  // as "unsupported" and rejects directory opens BEFORE calling fs.open below.
  fs.constants.O_DIRECTORY = 65536;
  const orig = { lstat: fs.lstat, stat: fs.stat, open: fs.open, fstat: fs.fstat, readdir: fs.readdir, close: fs.close };
  fs.lstat = (path, cb) => (path === CERT_DIR ? cb(null, dirStat) : orig.lstat.call(fs, path, cb));
  fs.stat = (path, cb) => (path === CERT_DIR ? cb(null, dirStat) : orig.stat.call(fs, path, cb));
  fs.open = (path, flags, mode, cb) => (path === CERT_DIR ? cb(null, CERT_FD) : orig.open.call(fs, path, flags, mode, cb));
  fs.fstat = (fd, cb) => (fd === CERT_FD ? cb(null, dirStat) : orig.fstat.call(fs, fd, cb));
  fs.readdir = (path, cb) => (path === CERT_DIR ? cb(null, []) : orig.readdir.call(fs, path, cb));
  fs.close = (fd, cb) => (fd === CERT_FD ? cb(null) : orig.close.call(fs, fd, cb));
}

const go = new globalThis.Go();
const { instance } = await WebAssembly.instantiate(await readFile('../../public/wasm/pdfcpu-v3.wasm'), go.importObject);
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

const wm = globalThis.__pdfcpuWatermark(new Uint8Array(input), JSON.stringify({ mode: 'addText', onTop: true, text: 'DRAFT', desc: 'points:48, op:0.4, rot:45' }), null);
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
