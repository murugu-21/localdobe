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

let wasmReady: Promise<void> | null = null;

function init(): Promise<void> {
  wasmReady ??= (async () => {
    const go = new Go();
    const result = await WebAssembly.instantiateStreaming(fetch('/wasm/pdfcpu.wasm'), go.importObject);
    void go.run(result.instance); // resolves only on exit; do not await
    // Wait until the Go side has registered the bridge functions.
    for (let i = 0; i < 200 && typeof globalThis.__pdfcpuOptimize !== 'function'; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    if (typeof globalThis.__pdfcpuOptimize !== 'function') throw new Error('pdfcpu wasm failed to start');
  })();
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
