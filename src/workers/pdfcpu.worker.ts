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
// a small in-memory read-only filesystem. It starts empty; installTrustFile()
// drops in the AATL certificate bundle before signature commands run.
// Go's js syscalls involved: lstat/stat -> open -> fstat -> readdir (dirs) /
// read+close (files) — see $GOROOT/src/syscall/fs_js.go.
const certFiles = new Map<string, Uint8Array>(); // name -> content, all under /certs
function shimCertDirFs(): void {
  const CERT_DIR = '/certs';
  type FsCb = (err: unknown, ...rest: unknown[]) => void;
  const fs = (globalThis as Record<string, any>).fs;
  const enoent = (op: string, path: string) =>
    Object.assign(new Error(`${op} ${path}: no such file or directory`), { code: 'ENOENT' });
  const statOf = (size: number, dir: boolean) => ({
    dev: 0, ino: 1, mode: dir ? 0o40755 : 0o100644, nlink: 1, uid: 0, gid: 0, rdev: 0,
    size, blksize: 4096, blocks: 0, atimeMs: 0, mtimeMs: 0, ctimeMs: 0,
    isDirectory: () => dir,
  });
  const nameOf = (path: string) => (path.startsWith(CERT_DIR + '/') ? path.slice(CERT_DIR.length + 1) : null);
  // Open fds: Go opens the dir (readdir walk) and files (ReadFile). Track a
  // sequential read position per fd — Go passes position=null for plain reads.
  const fds = new Map<number, { name: string | null; pos: number }>(); // name null = the dir itself
  let nextFd = 424242;

  // wasm_exec.js stubs constants.O_DIRECTORY as -1, which Go's syscall.Open treats
  // as "unsupported" and rejects directory opens BEFORE calling fs.open — so this
  // shim would never be consulted. Any non-negative value fixes that; the flag is
  // only ever forwarded back into fs.open, which ignores it.
  fs.constants.O_DIRECTORY = 65536;
  const orig = {
    lstat: fs.lstat, stat: fs.stat, open: fs.open, fstat: fs.fstat,
    readdir: fs.readdir, read: fs.read, close: fs.close,
  };

  const statFor = (path: string) => {
    if (path === CERT_DIR) return statOf(0, true);
    const name = nameOf(path);
    if (name !== null && certFiles.has(name)) return statOf(certFiles.get(name)!.length, false);
    return null;
  };
  fs.lstat = (path: string, cb: FsCb) => {
    const st = statFor(path);
    if (st) return cb(null, st);
    if (nameOf(path) !== null) return cb(enoent('lstat', path));
    return orig.lstat.call(fs, path, cb);
  };
  fs.stat = (path: string, cb: FsCb) => {
    const st = statFor(path);
    if (st) return cb(null, st);
    if (nameOf(path) !== null) return cb(enoent('stat', path));
    return orig.stat.call(fs, path, cb);
  };
  fs.open = (path: string, flags: number, mode: number, cb: FsCb) => {
    const name = nameOf(path);
    if (path === CERT_DIR || (name !== null && certFiles.has(name))) {
      const fd = nextFd++;
      fds.set(fd, { name: path === CERT_DIR ? null : name, pos: 0 });
      return cb(null, fd);
    }
    if (name !== null) return cb(enoent('open', path));
    return orig.open.call(fs, path, flags, mode, cb);
  };
  fs.fstat = (fd: number, cb: FsCb) => {
    const f = fds.get(fd);
    if (!f) return orig.fstat.call(fs, fd, cb);
    return cb(null, f.name === null ? statOf(0, true) : statOf(certFiles.get(f.name)!.length, false));
  };
  fs.readdir = (path: string, cb: FsCb) =>
    path === CERT_DIR ? cb(null, [...certFiles.keys()]) : orig.readdir.call(fs, path, cb);
  fs.read = (fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null, cb: FsCb) => {
    const f = fds.get(fd);
    if (!f) return orig.read.call(fs, fd, buffer, offset, length, position, cb);
    const content = f.name !== null ? certFiles.get(f.name) : undefined;
    if (!content) return cb(enoent('read', String(fd)));
    const start = position ?? f.pos;
    const n = Math.max(0, Math.min(length, content.length - start));
    buffer.set(content.subarray(start, start + n), offset);
    if (position === null) f.pos += n;
    return cb(null, n);
  };
  fs.close = (fd: number, cb: FsCb) => (fds.delete(fd) ? cb(null) : orig.close.call(fs, fd, cb));
}
shimCertDirFs();

// Fetch the bundled AATL trust anchors (built by scripts/refresh-aatl.mjs) into
// the /certs shim so pdfcpu's trust pool can resolve real certificate chains.
// Best-effort: if the fetch fails (offline first visit), validation still runs —
// it just reports chains as "couldn't be independently confirmed", as before.
let trustReady: Promise<void> | null = null;
function installTrustFile(): Promise<void> {
  trustReady ??= (async () => {
    const res = await fetch('/trust/aatl.pem');
    if (!res.ok) throw new Error(`trust list fetch: ${res.status}`);
    certFiles.set('aatl.pem', new Uint8Array(await res.arrayBuffer()));
  })().catch(() => {
    trustReady = null; // retry on the next signature command
  });
  return trustReady;
}

let wasmReady: Promise<void> | null = null;

function init(): Promise<void> {
  wasmReady ??= (async () => {
    const go = new Go();
    const result = await WebAssembly.instantiateStreaming(fetch('/wasm/pdfcpu-v3.wasm'), go.importObject);
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
      // The trust pool must be populated BEFORE the first validation — pdfcpu
      // caches the pool after its first load of /certs.
      await installTrustFile();
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
