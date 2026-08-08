import { presetConfig, type CompressPreset } from './compressPresets';
import { buildTextWatermarkDesc, buildImageWatermarkDesc, type TextWatermarkOpts, type ImageWatermarkOpts } from './watermarkDesc';
import { parseSignatureReport, type SignatureReport } from './signatureReport';
import type { PdfcpuCmd } from '../../workers/pdfcpu.worker';

type Response = { id: number; ok: true; bytes?: ArrayBuffer; report?: string } | { id: number; ok: false; error: string };
type Settle = { resolve: (r: { bytes?: Uint8Array; report?: string }) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Settle>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../../workers/pdfcpu.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<Response>) => {
      const entry = pending.get(e.data.id);
      if (!entry) return;
      pending.delete(e.data.id);
      if (e.data.ok) entry.resolve({ bytes: e.data.bytes ? new Uint8Array(e.data.bytes) : undefined, report: e.data.report });
      else entry.reject(new Error(e.data.error));
    };
    worker.onerror = () => {
      for (const { reject } of pending.values()) reject(new Error('The PDF engine crashed — the file may be too large for this device.'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

function call(cmd: PdfcpuCmd, bytes: Uint8Array, config?: unknown, extraBytes?: Uint8Array): Promise<{ bytes?: Uint8Array; report?: string }> {
  const id = nextId++;
  const buffer = bytes.slice().buffer;
  const transfer: Transferable[] = [buffer];
  let extra: ArrayBuffer | undefined;
  if (extraBytes) {
    extra = extraBytes.slice().buffer;
    transfer.push(extra);
  }
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, cmd, bytes: buffer, config, extraBytes: extra }, transfer);
  });
}

async function callForBytes(cmd: PdfcpuCmd, bytes: Uint8Array, config?: unknown, extraBytes?: Uint8Array): Promise<Uint8Array> {
  const res = await call(cmd, bytes, config, extraBytes);
  if (!res.bytes) throw new Error('The PDF engine returned no output.');
  return res.bytes;
}

export function compressPdf(bytes: Uint8Array, preset: CompressPreset, onStatus?: (s: string) => void): Promise<Uint8Array> {
  onStatus?.('Loading PDF engine…');
  const promise = callForBytes('optimize', bytes, presetConfig(preset));
  onStatus?.('Compressing…');
  return promise;
}

export function addTextWatermark(bytes: Uint8Array, text: string, onTop: boolean, opts: TextWatermarkOpts): Promise<Uint8Array> {
  return callForBytes('watermark', bytes, { mode: 'addText', onTop, text, desc: buildTextWatermarkDesc(opts) });
}

export function addImageWatermark(bytes: Uint8Array, image: Uint8Array, onTop: boolean, opts: ImageWatermarkOpts): Promise<Uint8Array> {
  return callForBytes('watermark', bytes, { mode: 'addImage', onTop, text: '', desc: buildImageWatermarkDesc(opts) }, image);
}

export function removeWatermarks(bytes: Uint8Array): Promise<Uint8Array> {
  return callForBytes('watermark', bytes, { mode: 'remove', onTop: false, text: '', desc: '' });
}

export async function validateSignatures(bytes: Uint8Array): Promise<SignatureReport[]> {
  const res = await call('validateSignatures', bytes);
  return parseSignatureReport(res.report ?? '[]');
}

export function removeSignatures(bytes: Uint8Array): Promise<Uint8Array> {
  return callForBytes('removeSignatures', bytes);
}

export function encryptPdf(bytes: Uint8Array, userPw: string, ownerPw = ''): Promise<Uint8Array> {
  return callForBytes('encrypt', bytes, { userPw, ownerPw });
}

export function decryptPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  return callForBytes('decrypt', bytes, { password });
}
