import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFContext,
  type PDFObject,
} from 'pdf-lib';
import { inflateSync, unzlibSync } from 'fflate';

/**
 * Low-level PDF object-graph helpers shared by the privacy scanner and the
 * cleaner. Both need to reason about what a document actually contains beyond
 * its visible pages: which objects are still referenced, what a metadata value
 * says, and what a compressed stream holds.
 */

/** Follow a reference to its object; direct objects pass through unchanged. */
export function resolve(context: PDFContext, obj: PDFObject | undefined): PDFObject | undefined {
  return obj instanceof PDFRef ? context.lookup(obj) : obj;
}

/**
 * Walk every object reachable from `roots`, calling `visit` on each dictionary
 * (stream dictionaries included) exactly once per reference target.
 *
 * Visits direct dictionaries and arrays in place, and follows references, so a
 * dictionary embedded directly in an annotation is seen just like an indirect
 * one. Cycles are safe: each PDFRef is followed at most once.
 *
 * PDFStream must be handled explicitly: in pdf-lib a stream extends PDFObject
 * and keeps its entries in a separate `dict`, so `instanceof PDFDict` is false
 * for it. Skipping stream dicts silently loses references held there — image
 * `/ColorSpace [/ICCBased …]`, `/SMask`, Form XObject `/Resources` — which made
 * reachability (and therefore the cleaner's pruning) drop live objects.
 */
export function walkObjects(
  context: PDFContext,
  roots: (PDFObject | undefined)[],
  visit: (dict: PDFDict) => void,
): void {
  const seen = new Set<PDFRef>();
  const stack: PDFObject[] = roots.filter((obj): obj is PDFObject => obj !== undefined);
  while (stack.length > 0) {
    const obj = stack.pop()!;
    if (obj instanceof PDFRef) {
      if (seen.has(obj)) continue;
      seen.add(obj);
      const target = context.lookup(obj);
      if (target) stack.push(target);
      continue;
    }
    if (obj instanceof PDFStream) {
      visit(obj.dict);
      for (const [, value] of obj.dict.entries()) stack.push(value);
      continue;
    }
    if (obj instanceof PDFDict) {
      visit(obj);
      for (const [, value] of obj.entries()) stack.push(value);
      continue;
    }
    if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) stack.push(obj.get(i));
    }
  }
}

/** The set of indirect object references reachable from `roots`. */
export function collectReachable(context: PDFContext, roots: (PDFObject | undefined)[]): Set<PDFRef> {
  const seen = new Set<PDFRef>();
  const stack: PDFObject[] = roots.filter((obj): obj is PDFObject => obj !== undefined);
  while (stack.length > 0) {
    const obj = stack.pop()!;
    if (obj instanceof PDFRef) {
      if (seen.has(obj)) continue;
      seen.add(obj);
      const target = context.lookup(obj);
      if (target) stack.push(target);
      continue;
    }
    if (obj instanceof PDFStream) {
      for (const [, value] of obj.dict.entries()) stack.push(value);
      continue;
    }
    if (obj instanceof PDFDict) {
      for (const [, value] of obj.entries()) stack.push(value);
      continue;
    }
    if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) stack.push(obj.get(i));
    }
  }
  return seen;
}

/** A dictionary as a lowercase name, e.g. PDFName.of('Link') -> 'link'. */
export function nameText(obj: PDFObject | undefined): string | undefined {
  if (!(obj instanceof PDFName)) return undefined;
  return obj.asString().replace(/^\//, '').toLowerCase();
}

/**
 * Whether a dictionary is a JavaScript action — `/S /JavaScript` or a direct
 * `/JS` entry. Used by both the scanner (report it) and the cleaner (remove it).
 */
export function isJavaScriptAction(dict: PDFDict): boolean {
  if (nameText(dict.get(PDFName.of('S'))) === 'javascript') return true;
  return dict.has(PDFName.of('JS'));
}

/** A PDF string, hex string, name, or number as display text. */
export function textOfObject(obj: PDFObject | undefined): string | undefined {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    try {
      return obj.decodeText();
    } catch {
      return undefined;
    }
  }
  if (obj instanceof PDFName) return obj.asString().replace(/^\//, '');
  if (obj instanceof PDFNumber) return String(obj.asNumber());
  return undefined;
}

/** Printable text for a byte array (PDF syntax is byte-oriented). */
export function latin1(bytes: Uint8Array): string {
  let out = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return out;
}

function tryInflate(data: Uint8Array): Uint8Array | null {
  try {
    return unzlibSync(data);
  } catch {
    try {
      // Some producers emit a raw deflate stream without the zlib wrapper.
      return inflateSync(data);
    } catch {
      return null;
    }
  }
}

function asciiHexDecode(data: Uint8Array): Uint8Array {
  const text = latin1(data);
  const hex = text.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Decode a raw stream to its bytes, supporting the filters that matter for the
 * streams the scanner reads (content streams and metadata: Flate, ASCIIHex, or
 * none). Returns null for anything else rather than guessing — a skipped
 * stream must never be reported as scanned.
 */
export function decodeRawStream(stream: PDFRawStream): Uint8Array | null {
  const filterObj = stream.dict.lookup(PDFName.of('Filter'));
  const filters: PDFName[] = [];
  if (filterObj instanceof PDFName) filters.push(filterObj);
  else if (filterObj instanceof PDFArray) {
    for (let i = 0; i < filterObj.size(); i++) {
      const f = filterObj.lookup(i, PDFName);
      filters.push(f);
    }
  }
  let data: Uint8Array = stream.contents;
  // Filters are applied in listed order when encoding, so decode in reverse.
  for (let i = filters.length - 1; i >= 0; i--) {
    const name = filters[i].asString().replace(/^\//, '');
    if (name === 'FlateDecode' || name === 'Fl') {
      const inflated = tryInflate(data);
      if (!inflated) return null;
      data = inflated;
    } else if (name === 'ASCIIHexDecode' || name === 'AHx') {
      data = asciiHexDecode(data);
    } else {
      return null;
    }
  }
  return data;
}
