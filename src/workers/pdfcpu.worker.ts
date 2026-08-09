/// <reference lib="webworker" />
import './go/wasm_exec.js';

type ByteResult = { ok: true; bytes: Uint8Array } | { ok: false; error: string };
type ReportResult = { ok: true; report: string } | { ok: false; error: string };

declare global {
  // Provided by wasm_exec.js and the Go program respectively.
  var Go: new () => { importObject: WebAssembly.Imports; run(i: WebAssembly.Instance): Promise<void> };
  var __pdfcpuOptimize: (input: Uint8Array, configJson: string) => ByteResult;
  var __pdfcpuWatermark: (input: Uint8Array, configJson: string, image: Uint8Array | null) => ByteResult;
  var __pdfcpuValidateSignatures: (input: Uint8Array) => ReportResult;
  var __pdfcpuRemoveSignatures: (input: Uint8Array) => ByteResult;
  var __pdfcpuEncrypt: (input: Uint8Array, configJson: string) => ByteResult;
  var __pdfcpuDecrypt: (input: Uint8Array, configJson: string) => ByteResult;
}

export type PdfcpuCmd = 'optimize' | 'watermark' | 'validateSignatures' | 'removeSignatures' | 'encrypt' | 'decrypt';

interface Request { id: number; cmd: PdfcpuCmd; bytes: ArrayBuffer; config?: unknown; extraBytes?: ArrayBuffer }

// The Go side sets model.TrustedCertDir = '/certs' (see wasm/pdfcpu/main.go):
// signature validation walks that directory to build its trust pool, and
// wasm_exec's default fs stub fails every call with ENOSYS. Present /certs as
// an empty directory so the walk yields an empty pool instead of an error.
// Go's js syscalls for this walk: lstat -> open -> fstat (isDirectory()) ->
// readdir -> close (see $GOROOT/src/syscall/fs_js.go).
function shimCertDirFs(): void {
  const CERT_DIR = '/certs';
  const CERT_FD = 424242;
  type FsCb = (err: unknown, ...rest: unknown[]) => void;
  const fs = (globalThis as Record<string, any>).fs;
  const dirStat = {
    dev: 0, ino: 1, mode: 0o40755, nlink: 1, uid: 0, gid: 0, rdev: 0,
    size: 0, blksize: 4096, blocks: 0, atimeMs: 0, mtimeMs: 0, ctimeMs: 0,
    isDirectory: () => true,
  };
  // wasm_exec.js stubs constants.O_DIRECTORY as -1, which Go's syscall.Open treats
  // as "unsupported" and rejects directory opens BEFORE calling fs.open — so the
  // /certs shim below never gets a chance. Any non-negative value fixes that; the
  // flag is only ever forwarded back into fs.open, which ignores it.
  fs.constants.O_DIRECTORY = 65536;
  const orig = { lstat: fs.lstat, stat: fs.stat, open: fs.open, fstat: fs.fstat, readdir: fs.readdir, close: fs.close };
  fs.lstat = (path: string, cb: FsCb) => (path === CERT_DIR ? cb(null, dirStat) : orig.lstat.call(fs, path, cb));
  fs.stat = (path: string, cb: FsCb) => (path === CERT_DIR ? cb(null, dirStat) : orig.stat.call(fs, path, cb));
  fs.open = (path: string, flags: number, mode: number, cb: FsCb) =>
    path === CERT_DIR ? cb(null, CERT_FD) : orig.open.call(fs, path, flags, mode, cb);
  fs.fstat = (fd: number, cb: FsCb) => (fd === CERT_FD ? cb(null, dirStat) : orig.fstat.call(fs, fd, cb));
  fs.readdir = (path: string, cb: FsCb) => (path === CERT_DIR ? cb(null, []) : orig.readdir.call(fs, path, cb));
  fs.close = (fd: number, cb: FsCb) => (fd === CERT_FD ? cb(null) : orig.close.call(fs, fd, cb));
}
shimCertDirFs();

let wasmReady: Promise<void> | null = null;

function init(): Promise<void> {
  wasmReady ??= (async () => {
    const go = new Go();
    const result = await WebAssembly.instantiateStreaming(fetch('/wasm/pdfcpu-v2.wasm'), go.importObject);
    void go.run(result.instance); // resolves only on exit; do not await
    // Wait until the Go side has registered the bridge functions.
    for (let i = 0; i < 200 && typeof globalThis.__pdfcpuOptimize !== 'function'; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    if (typeof globalThis.__pdfcpuOptimize !== 'function') throw new Error('pdfcpu wasm failed to start');
  })().catch((err) => {
    // Don't cache a failed init — let the next message retry instantiation.
    wasmReady = null;
    throw err;
  });
  return wasmReady;
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const { id, cmd, bytes, config, extraBytes } = e.data;
  const post = self.postMessage.bind(self) as (msg: unknown, transfer?: Transferable[]) => void;
  try {
    await init();
    const input = new Uint8Array(bytes);
    const configJson = JSON.stringify(config ?? {});
    if (cmd === 'validateSignatures') {
      const res = globalThis.__pdfcpuValidateSignatures(input);
      if (!res.ok) throw new Error(res.error);
      post({ id, ok: true, report: res.report });
      return;
    }
    const res =
      cmd === 'optimize' ? globalThis.__pdfcpuOptimize(input, configJson)
      : cmd === 'watermark' ? globalThis.__pdfcpuWatermark(input, configJson, extraBytes ? new Uint8Array(extraBytes) : null)
      : cmd === 'removeSignatures' ? globalThis.__pdfcpuRemoveSignatures(input)
      : cmd === 'encrypt' ? globalThis.__pdfcpuEncrypt(input, configJson)
      : globalThis.__pdfcpuDecrypt(input, configJson);
    if (!res.ok) throw new Error(res.error);
    const out = res.bytes.slice().buffer; // copy out of wasm-owned memory before transfer
    post({ id, ok: true, bytes: out }, [out]);
  } catch (err) {
    post({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
