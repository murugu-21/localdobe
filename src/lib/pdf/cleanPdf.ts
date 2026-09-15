import { PDFArray, PDFDict, PDFName, PDFRef, type PDFDocument, type PDFObject } from 'pdf-lib';
import { loadPdf } from './errors';
import { collectReachable, isJavaScriptAction, nameText, resolve, walkObjects } from './objectGraph';

/**
 * Writes a privacy-cleaned copy of a PDF, entirely on the user's device.
 *
 * The output is a fresh rewrite of the document's current object graph, which
 * is what makes it effective: metadata, XMP, file IDs, previous incremental
 * revisions, and any object left behind by earlier edits simply are not part of
 * the file any more. Visible pages, links, and annotations are untouched.
 */

export interface CleanOptions {
  /** Keep the document's internal Title; everything else in Info is removed. */
  keepTitle: boolean;
  removeAttachments: boolean;
  removeJavaScript: boolean;
}

function rootsOf(doc: PDFDocument): (PDFObject | undefined)[] {
  return [doc.context.trailerInfo.Root, doc.context.trailerInfo.Info];
}

function stripMetadata(doc: PDFDocument, keepTitle: boolean): void {
  const context = doc.context;
  const info = resolve(context, context.trailerInfo.Info);
  if (info instanceof PDFDict) {
    const title = keepTitle ? info.get(PDFName.of('Title')) : undefined;
    for (const key of info.keys()) info.delete(key);
    if (title) info.set(PDFName.of('Title'), title);
    if (info.keys().length === 0) {
      const infoRef = context.trailerInfo.Info;
      if (infoRef instanceof PDFRef) context.delete(infoRef);
      context.trailerInfo.Info = undefined;
    }
  }
  doc.catalog.delete(PDFName.of('Metadata'));
  context.trailerInfo.ID = undefined;
}

function stripAttachments(doc: PDFDocument): void {
  const context = doc.context;
  const names = resolve(context, doc.catalog.get(PDFName.of('Names')));
  if (names instanceof PDFDict) {
    names.delete(PDFName.of('EmbeddedFiles'));
    if (names.keys().length === 0) doc.catalog.delete(PDFName.of('Names'));
  }
  doc.catalog.delete(PDFName.of('AF'));

  for (const page of doc.getPages()) {
    const annots = resolve(context, page.node.get(PDFName.of('Annots')));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const annot = resolve(context, annots.get(i));
      if (annot instanceof PDFDict && nameText(annot.get(PDFName.of('Subtype'))) === 'fileattachment') {
        annots.remove(i);
      }
    }
  }
}

function stripJavaScript(doc: PDFDocument): void {
  const context = doc.context;
  const roots = rootsOf(doc);
  const actions = new Set<PDFDict>();
  walkObjects(context, roots, (dict) => {
    if (isJavaScriptAction(dict)) actions.add(dict);
  });
  if (actions.size === 0) return;

  // Remove every reference to a JavaScript action: OpenAction, /AA entries,
  // name-tree script catalogues, annotation and field actions, and /Next chains.
  walkObjects(context, roots, (dict) => {
    if (dict.has(PDFName.of('JavaScript'))) dict.delete(PDFName.of('JavaScript'));
    for (const [key, value] of dict.entries()) {
      const target = resolve(context, value);
      if (target && actions.has(target as PDFDict)) {
        dict.delete(key);
      } else if (target instanceof PDFArray) {
        for (let i = target.size() - 1; i >= 0; i--) {
          const element = resolve(context, target.get(i));
          if (element && actions.has(element as PDFDict)) target.remove(i);
        }
      }
    }
  });

  // Anything still holding script bytes (e.g. an action reached only through a
  // dictionary we could not edit in place) is emptied rather than trusted.
  for (const action of actions) {
    for (const key of action.keys()) action.delete(key);
  }
}

function pruneUnreachable(doc: PDFDocument): Set<number> {
  const context = doc.context;
  const reachable = collectReachable(context, rootsOf(doc));
  const removed = new Set<number>();
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref)) {
      context.delete(ref);
      removed.add(ref.objectNumber);
    }
  }
  return removed;
}

function isWhitespace(byte: number): boolean {
  return byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
}

/**
 * Every object number mentioned as an indirect reference (`N G R`) anywhere in
 * the serialized file, including inside stream bytes and invalid objects that a
 * structured walk cannot see. Used only as a safety net after pruning — false
 * positives merely keep an object that could have been dropped.
 */
function findReferencedObjectNumbers(bytes: Uint8Array): Set<number> {
  const referenced = new Set<number>();
  let first = -1;
  let second = -1;
  let i = 0;
  while (i < bytes.length) {
    const byte = bytes[i];
    if (byte >= 48 && byte <= 57) {
      let value = 0;
      while (i < bytes.length && bytes[i] >= 48 && bytes[i] <= 57) {
        value = value * 10 + (bytes[i] - 48);
        i++;
      }
      if (first < 0) first = value;
      else if (second < 0) second = value;
      continue;
    }
    if (isWhitespace(byte)) {
      i++;
      continue;
    }
    if ((byte === 82 || byte === 114) && first >= 0 && second >= 0) referenced.add(first);
    first = -1;
    second = -1;
    i++;
  }
  return referenced;
}

function applyClean(doc: PDFDocument, options: CleanOptions): void {
  if (options.removeJavaScript) stripJavaScript(doc);
  if (options.removeAttachments) stripAttachments(doc);
  stripMetadata(doc, options.keepTitle);
}

export async function cleanPdf(bytes: Uint8Array, options: CleanOptions): Promise<Uint8Array> {
  const doc = await loadPdf(bytes, undefined, undefined, { updateMetadata: false });
  applyClean(doc, options);
  const removed = pruneUnreachable(doc);
  const output = await doc.save();
  if (removed.size === 0) return output;

  // Safety net: a surviving object may still point at something pruning removed
  // (an indirect reference the structured walk cannot see, e.g. inside an
  // invalid object's raw bytes). Shipping a document with dangling references
  // makes readers report page errors, so if that happened, rebuild the clean
  // copy without pruning — leftovers are better than a broken file.
  const stillReferenced = findReferencedObjectNumbers(output);
  if (![...removed].some((objectNumber) => stillReferenced.has(objectNumber))) return output;

  const fallback = await loadPdf(bytes, undefined, undefined, { updateMetadata: false });
  applyClean(fallback, options);
  return fallback.save();
}
