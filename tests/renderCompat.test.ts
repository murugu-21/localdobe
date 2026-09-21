import { describe, expect, it } from 'vitest';
import { ensureReadableStreamAsyncIterator } from '../src/lib/pdf/render';

type StreamProto = { [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array> };

const proto = ReadableStream.prototype as unknown as StreamProto;
const getIterator = () => proto[Symbol.asyncIterator];

describe('ensureReadableStreamAsyncIterator', () => {
  it('installs a working async iterator when the platform is missing one', async () => {
    const native = getIterator();
    try {
      // Simulate Safari/WebKit < 26.4, which has no async iterator on streams.
      Reflect.deleteProperty(proto, Symbol.asyncIterator);
      ensureReadableStreamAsyncIterator();
      expect(typeof getIterator()).toBe('function');

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3]));
          controller.close();
        },
      });
      const bytes: number[] = [];
      for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
        bytes.push(...chunk);
      }
      expect(bytes).toEqual([1, 2, 3]);
    } finally {
      if (native) Reflect.set(proto, Symbol.asyncIterator, native);
      else Reflect.deleteProperty(proto, Symbol.asyncIterator);
    }
  });

  it('keeps the platform implementation when one already exists', () => {
    const native = getIterator();
    ensureReadableStreamAsyncIterator();
    expect(getIterator()).toBe(native);
  });
});
