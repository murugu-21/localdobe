import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  type PDFContext,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib';
import { formatBytes } from '../format';
import { loadPdf } from './errors';
import {
  collectReachable,
  decodeRawStream,
  isJavaScriptAction,
  latin1,
  nameText,
  resolve,
  textOfObject,
  walkObjects,
} from './objectGraph';

/**
 * Local PDF privacy analysis.
 *
 * Reads a PDF the way a stranger would after you email it: metadata that names
 * people and software, timestamps, embedded files, scripts, links, annotations,
 * and the parts of a file that aren't on the page at all (earlier revisions,
 * unreferenced objects, hidden layers). Everything happens on the user's device;
 * no bytes leave the page.
 *
 * Findings are deliberately evidence-only — this module reports what is in the
 * file and what it means, never a score. `values` holds document-derived text
 * (names, URLs), so it must be masked in session replays by the UI.
 */

export type PrivacySeverity = 'personal' | 'hidden' | 'informational';

export interface PrivacyFinding {
  id: string;
  title: string;
  detail: string;
  severity: PrivacySeverity;
  /** Document-derived strings (masked in session replays). */
  values: string[];
  /** Whether the bundled cleaner removes this item. */
  cleanable: boolean;
}

export interface PrivacyReport {
  pageCount: number;
  revisions: number;
  findings: PrivacyFinding[];
  counts: { personal: number; hidden: number; informational: number };
  attachments: number;
  javascript: number;
  canClean: boolean;
}

const MAX_VALUES = 12;

const STANDARD_INFO_KEYS = new Set([
  'Title',
  'Author',
  'Subject',
  'Keywords',
  'Creator',
  'Producer',
  'CreationDate',
  'ModDate',
  'Trapped',
]);

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PATH_RES = [
  /[A-Za-z]:\\[^\s()<>"']+/g,
  /\\\\[^\s()<>"']+/g,
  /\/(?:Users|home)\/[^\s()<>"']+/g,
];

const ANNOTATION_LABELS: Record<string, string> = {
  text: 'sticky note',
  highlight: 'highlight',
  underline: 'underline',
  strikeout: 'strikethrough',
  squiggly: 'squiggly underline',
  stamp: 'stamp',
  freetext: 'text box',
  ink: 'drawing',
  fileattachment: 'file attachment',
  redact: 'redaction mark',
  caret: 'caret',
  polygon: 'shape',
  polyline: 'shape',
  square: 'shape',
  circle: 'shape',
  line: 'shape',
  sound: 'media',
  movie: 'media',
  screen: 'media',
  richmedia: 'media',
  '3d': '3D content',
  widget: 'form field',
  popup: 'popup',
};

function sanitizeValue(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const v = value.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function cap(values: string[]): string[] {
  if (values.length <= MAX_VALUES) return values;
  return [...values.slice(0, MAX_VALUES), `…and ${values.length - MAX_VALUES} more`];
}

function countBytes(haystack: Uint8Array, needle: string): number {
  const pattern = new Uint8Array(needle.length);
  for (let i = 0; i < needle.length; i++) pattern[i] = needle.charCodeAt(i);
  let count = 0;
  outer: for (let i = 0; i <= haystack.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) {
      if (haystack[i + j] !== pattern[j]) continue outer;
    }
    count++;
    i += pattern.length - 1;
  }
  return count;
}

/**
 * How many times the document was saved. PDFs save changes by appending, so a
 * multi-revision file still contains everything each earlier revision held —
 * including text that was later deleted, plus redaction that never removed it.
 */
export function countRevisions(bytes: Uint8Array): number {
  const eof = countBytes(bytes, '%%EOF');
  const startxref = countBytes(bytes, 'startxref');
  return Math.max(1, Math.min(eof || 1, startxref || 1));
}

/** Editable dates are `D:YYYYMMDDHHmmSS…`; render them as something readable. */
export function formatPdfDate(raw: string): string {
  const m = raw.match(/D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Z+\-])?(\d{2})?'?(\d{2})?'?/);
  if (!m || !m[1]) return raw;
  const [, y, mo, d, h, mi, s, tz, tzh, tzm] = m;
  const date = [y, mo, d].filter(Boolean).join('-');
  const time = [h, mi, s].filter(Boolean).join(':');
  let zone = '';
  if (tz === 'Z') zone = ' UTC';
  else if (tz === '+' || tz === '-') zone = ` UTC${tz}${tzh ?? ''}:${tzm ?? ''}`;
  return [date, time].filter(Boolean).join(' ') + zone;
}

function identityTraces(values: string[]): string[] {
  const traces: string[] = [];
  for (const value of values) {
    for (const m of value.match(EMAIL_RE) ?? []) traces.push(`Email: ${m}`);
    for (const re of PATH_RES) {
      for (const m of value.match(re) ?? []) traces.push(`Path: ${m}`);
    }
  }
  return unique(traces).slice(0, 6);
}

function infoDictOf(context: PDFContext): PDFDict | undefined {
  const info = resolve(context, context.trailerInfo.Info);
  return info instanceof PDFDict ? info : undefined;
}

function readInfoMetadata(context: PDFContext): { findings: PrivacyFinding[]; values: string[] } {
  const findings: PrivacyFinding[] = [];
  const info = infoDictOf(context);
  const field = (name: string) => {
    const value = textOfObject(info?.get(PDFName.of(name)));
    return value ? sanitizeValue(value) || undefined : undefined;
  };

  const title = field('Title');
  const author = field('Author');
  const subject = field('Subject');
  const keywords = field('Keywords');
  const creator = field('Creator');
  const producer = field('Producer');
  const created = field('CreationDate');
  const modified = field('ModDate');

  const custom: string[] = [];
  if (info) {
    for (const [key, value] of info.entries()) {
      const keyName = key.asString().replace(/^\//, '');
      if (STANDARD_INFO_KEYS.has(keyName)) continue;
      const text = textOfObject(value);
      if (text && sanitizeValue(text)) custom.push(`${keyName}: ${sanitizeValue(text)}`);
    }
  }

  const metadataValues = [title, author, subject, keywords, creator, producer, created, modified, ...custom]
    .filter((v): v is string => Boolean(v));

  if (author) {
    findings.push({
      id: 'author',
      title: 'Author name',
      detail:
        'The file records who created it. Viewers show this under Document Properties, and it travels with the file wherever it is sent.',
      severity: 'personal',
      values: [author],
      cleanable: true,
    });
  }

  const traces = identityTraces(metadataValues);
  if (traces.length > 0) {
    findings.push({
      id: 'identity-traces',
      title: 'Names, paths or email addresses',
      detail:
        'Metadata strings contain what looks like a username, file path, or email address — usually added automatically by the software that made the file.',
      severity: 'personal',
      values: traces,
      cleanable: true,
    });
  }

  if (creator || producer) {
    findings.push({
      id: 'software',
      title: 'Software fingerprint',
      detail:
        'Creator and Producer identify the exact application — and often the version and platform — that produced the file, plus the toolchain it passed through.',
      severity: 'informational',
      values: cap(
        unique([
          creator ? `Creator: ${creator}` : '',
          producer ? `Producer: ${producer}` : '',
        ]),
      ),
      cleanable: true,
    });
  }

  if (created || modified) {
    findings.push({
      id: 'timestamps',
      title: 'Creation and edit times',
      detail:
        'Timestamps reveal when the document was written and last changed. Combined with other files, they can narrow down who was working on what, and when.',
      severity: 'informational',
      values: cap(
        unique([
          created ? `Created: ${formatPdfDate(created)}` : '',
          modified ? `Modified: ${formatPdfDate(modified)}` : '',
        ]),
      ),
      cleanable: true,
    });
  }

  if (custom.length > 0) {
    findings.push({
      id: 'custom-metadata',
      title: 'Custom metadata fields',
      detail:
        'Extra fields written by the producing application. These often carry company names, project or client identifiers, or internal tracking codes.',
      severity: 'personal',
      values: cap(custom),
      cleanable: true,
    });
  }

  if (title) {
    findings.push({
      id: 'title',
      title: 'Document title',
      detail:
        'The title stored inside the file (not the file name) — often the document’s original working title or client name.',
      severity: 'informational',
      values: [title],
      cleanable: true,
    });
  }

  if (subject || keywords) {
    findings.push({
      id: 'subject-keywords',
      title: 'Subject and keywords',
      detail:
        'Descriptive fields that may include the document’s topic, client, or internal classification.',
      severity: 'informational',
      values: cap(unique([subject ? `Subject: ${subject}` : '', keywords ? `Keywords: ${keywords}` : ''])),
      cleanable: true,
    });
  }

  return { findings, values: metadataValues };
}

function readXmp(context: PDFContext, catalog: PDFDict): string | undefined {
  const metadata = resolve(context, catalog.get(PDFName.of('Metadata')));
  if (!(metadata instanceof PDFRawStream)) return undefined;
  const data = decodeRawStream(metadata);
  return data ? latin1(data) : undefined;
}

function tagValue(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return undefined;
  const value = m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
  return value ? sanitizeValue(value) : undefined;
}

function attributeValues(xml: string, attr: string): string[] {
  const escaped = attr.replace(/:/g, '\\:');
  return [...xml.matchAll(new RegExp(`${escaped}="([^"]+)"`, 'gi'))].map((m) => sanitizeValue(m[1]));
}

/**
 * One XMP property. Producers write common fields either as attributes on
 * rdf:Description (compact form) or as child elements (expanded form) — both
 * appear in the wild, so read whichever is present.
 */
function xmpProperty(xml: string, name: string): string | undefined {
  return attributeValues(xml, name)[0] || tagValue(xml, name);
}

function xmpHistory(xml: string): string[] {
  const block = xml.match(/<xmpMM:History[\s\S]*?<\/xmpMM:History>/i)?.[0];
  if (!block) return [];
  const entries: string[] = [];
  const attr = (attrs: string, name: string) =>
    new RegExp(`${name.replace(/:/g, '\\:')}="([^"]*)"`, 'i').exec(attrs)?.[1];
  for (const m of block.matchAll(/<rdf:li\b([^>]*?)\/?>/gi)) {
    const action = attr(m[1], 'stEvt:action');
    const when = attr(m[1], 'stEvt:when') ?? attr(m[1], 'stEvt:date');
    const agent = attr(m[1], 'stEvt:softwareAgent');
    if (action || when || agent) {
      entries.push([action, agent, when].filter((s): s is string => Boolean(s)).map(sanitizeValue).join(' · '));
    }
  }
  for (const m of block.matchAll(/<rdf:li[^>]*rdf:parseType="Resource"[^>]*>([\s\S]*?)<\/rdf:li>/gi)) {
    const inner = m[1];
    const action = tagValue(inner, 'stEvt:action');
    const when = tagValue(inner, 'stEvt:when') ?? tagValue(inner, 'stEvt:date');
    const agent = tagValue(inner, 'stEvt:softwareAgent');
    if (action || when || agent) {
      entries.push([action, agent, when].filter((s): s is string => Boolean(s)).map(sanitizeValue).join(' · '));
    }
  }
  return unique(entries).slice(0, 10);
}

function readXmpFindings(xml: string): { findings: PrivacyFinding[]; values: string[] } {
  const findings: PrivacyFinding[] = [];
  const creatorTool = xmpProperty(xml, 'xmp:CreatorTool');
  const xmpProducer = xmpProperty(xml, 'pdf:Producer');
  const createDate = xmpProperty(xml, 'xmp:CreateDate');
  const modifyDate = xmpProperty(xml, 'xmp:ModifyDate');
  const metadataDate = xmpProperty(xml, 'xmp:MetadataDate');
  const meta = unique(
    [
      creatorTool ? `Creator tool: ${creatorTool}` : '',
      xmpProducer ? `Producer: ${xmpProducer}` : '',
      createDate ? `Created: ${createDate}` : '',
      modifyDate ? `Modified: ${modifyDate}` : '',
      metadataDate ? `Metadata updated: ${metadataDate}` : '',
    ].filter(Boolean),
  );

  if (meta.length > 0) {
    findings.push({
      id: 'xmp',
      title: 'XMP metadata',
      detail:
        'A second metadata block (XMP) that duplicates and extends the standard fields. Most viewers and indexers can read it.',
      severity: 'informational',
      values: cap(meta),
      cleanable: true,
    });
  }

  const history = xmpHistory(xml);
  if (history.length > 0) {
    findings.push({
      id: 'xmp-history',
      title: 'Editing history',
      detail:
        'XMP records the saves this document went through — actions, applications and timestamps — which can reveal how many tools touched the file, and when.',
      severity: 'informational',
      values: cap(history),
      cleanable: true,
    });
  }

  const ids = unique([
    ...attributeValues(xml, 'xmpMM:DocumentID'),
    ...attributeValues(xml, 'xmpMM:InstanceID'),
    ...attributeValues(xml, 'xmpMM:OriginalDocumentID'),
    tagValue(xml, 'xmpMM:DocumentID') ?? '',
    tagValue(xml, 'xmpMM:InstanceID') ?? '',
    tagValue(xml, 'xmpMM:OriginalDocumentID') ?? '',
  ].filter(Boolean));
  if (ids.length > 0) {
    findings.push({
      id: 'xmp-ids',
      title: 'Persistent document IDs',
      detail:
        'XMP assigns globally unique IDs that survive edits — a fingerprint that can link copies of the same document back to one original.',
      severity: 'informational',
      values: cap(ids),
      cleanable: true,
    });
  }

  const authorBlock = xml.match(/<dc:creator[\s\S]*?<\/dc:creator>/i)?.[0];
  const authors = unique(
    authorBlock ? [...authorBlock.matchAll(/<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/gi)].map((m) => sanitizeValue(m[1])) : [],
  );
  if (authors.length > 0) {
    findings.push({
      id: 'xmp-author',
      title: 'Author name (XMP)',
      detail: 'The XMP block names the document’s creator independently of the standard Author field.',
      severity: 'personal',
      values: cap(authors),
      cleanable: true,
    });
  }

  return { findings, values: [...meta, ...history, ...ids, ...authors] };
}

function filespecName(context: PDFContext, fs: PDFDict): string | undefined {
  const name =
    textOfObject(resolve(context, fs.get(PDFName.of('UF')))) ??
    textOfObject(resolve(context, fs.get(PDFName.of('F'))));
  return name ? sanitizeValue(name) || undefined : undefined;
}

function filespecSize(context: PDFContext, fs: PDFDict): number | undefined {
  const ef = resolve(context, fs.get(PDFName.of('EF')));
  if (!(ef instanceof PDFDict)) return undefined;
  const f = resolve(context, ef.get(PDFName.of('F')));
  if (f instanceof PDFRawStream) return f.contents.length;
  return undefined;
}

function collectNameTree(context: PDFContext, node: PDFObject | undefined, out: PDFDict[], depth = 0): void {
  if (depth > 8) return;
  const dict = resolve(context, node);
  if (!(dict instanceof PDFDict)) return;
  const names = resolve(context, dict.get(PDFName.of('Names')));
  if (names instanceof PDFArray) {
    for (let i = 1; i < names.size(); i += 2) {
      const fs = resolve(context, names.get(i));
      if (fs instanceof PDFDict) out.push(fs);
    }
  }
  const kids = resolve(context, dict.get(PDFName.of('Kids')));
  if (kids instanceof PDFArray) {
    for (let i = 0; i < kids.size(); i++) collectNameTree(context, kids.get(i), out, depth + 1);
  }
}

function readAttachments(
  context: PDFContext,
  doc: PDFDocument,
  catalog: PDFDict,
): { names: string[]; count: number } {
  const specs: PDFDict[] = [];
  const seen = new Set<PDFDict>();
  const add = (fs: PDFDict) => {
    if (seen.has(fs)) return;
    seen.add(fs);
    specs.push(fs);
  };

  const namesDict = resolve(context, catalog.get(PDFName.of('Names')));
  if (namesDict instanceof PDFDict) collectNameTree(context, namesDict.get(PDFName.of('EmbeddedFiles')), specs);

  const associated = resolve(context, catalog.get(PDFName.of('AF')));
  if (associated instanceof PDFArray) {
    for (let i = 0; i < associated.size(); i++) {
      const fs = resolve(context, associated.get(i));
      if (fs instanceof PDFDict) add(fs);
    }
  }

  for (const page of doc.getPages()) {
    const annots = resolve(context, page.node.get(PDFName.of('Annots')));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annot = resolve(context, annots.get(i));
      if (!(annot instanceof PDFDict)) continue;
      if (nameText(annot.get(PDFName.of('Subtype'))) !== 'fileattachment') continue;
      const fs = resolve(context, annot.get(PDFName.of('FS')));
      if (fs instanceof PDFDict) specs.push(fs);
    }
  }

  const uniqueSpecs = [...new Set(specs)];
  const names = uniqueSpecs.map((fs, i) => {
    const name = filespecName(context, fs) ?? `attachment ${i + 1}`;
    const size = filespecSize(context, fs);
    return size !== undefined ? `${name} (${formatBytes(size)})` : name;
  });

  return { names: unique(names), count: uniqueSpecs.length };
}

function collectJsActions(
  context: PDFContext,
  obj: PDFObject | undefined,
  out: Set<PDFDict>,
  seen = new Set<PDFRef>(),
  depth = 0,
): void {
  if (depth > 12) return;
  if (obj instanceof PDFRef) {
    if (seen.has(obj)) return;
    seen.add(obj);
    collectJsActions(context, context.lookup(obj), out, seen, depth + 1);
    return;
  }
  if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) collectJsActions(context, obj.get(i), out, seen, depth + 1);
    return;
  }
  if (obj instanceof PDFStream) {
    for (const [, value] of obj.dict.entries()) collectJsActions(context, value, out, seen, depth + 1);
    return;
  }
  if (obj instanceof PDFDict) {
    if (isJavaScriptAction(obj)) {
      out.add(obj);
      return;
    }
    for (const [, value] of obj.entries()) collectJsActions(context, value, out, seen, depth + 1);
  }
}

function readJavaScript(doc: PDFDocument, context: PDFContext): { count: number; places: string[] } {
  const catalog = doc.catalog;
  const open = new Set<PDFDict>();
  collectJsActions(context, catalog.get(PDFName.of('OpenAction')), open);
  const named = new Set<PDFDict>();
  const names = resolve(context, catalog.get(PDFName.of('Names')));
  if (names instanceof PDFDict) collectJsActions(context, names.get(PDFName.of('JavaScript')), named);
  const docActions = new Set<PDFDict>();
  collectJsActions(context, catalog.get(PDFName.of('AA')), docActions);
  const pageActions = new Set<PDFDict>();
  const annotActions = new Set<PDFDict>();
  for (const page of doc.getPages()) {
    collectJsActions(context, page.node.get(PDFName.of('AA')), pageActions);
    const annots = resolve(context, page.node.get(PDFName.of('Annots')));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annot = resolve(context, annots.get(i));
      if (!(annot instanceof PDFDict)) continue;
      collectJsActions(context, annot.get(PDFName.of('A')), annotActions);
      collectJsActions(context, annot.get(PDFName.of('AA')), annotActions);
    }
  }

  const all = new Set<PDFDict>();
  walkObjects(context, [context.trailerInfo.Root, context.trailerInfo.Info], (dict) => {
    if (isJavaScriptAction(dict)) all.add(dict);
  });

  const classified = new Set<PDFDict>([...open, ...named, ...docActions, ...pageActions, ...annotActions]);
  const places: string[] = [];
  if (open.size > 0) places.push('Runs automatically when the document opens');
  if (named.size > 0) places.push('Named scripts');
  if (docActions.size > 0) places.push('Document actions');
  if (pageActions.size > 0) places.push('Page actions');
  if (annotActions.size > 0) places.push('Link or form actions');
  if ([...all].some((dict) => !classified.has(dict))) places.push('Embedded script');

  return { count: all.size, places };
}

interface AnnotationInfo {
  counts: Map<string, number>;
  links: string[];
  internalLinks: number;
  launches: number;
}

function readAnnotations(doc: PDFDocument, context: PDFContext): AnnotationInfo {
  const counts = new Map<string, number>();
  const links: string[] = [];
  let internalLinks = 0;
  let launches = 0;

  for (const page of doc.getPages()) {
    const annots = resolve(context, page.node.get(PDFName.of('Annots')));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annot = resolve(context, annots.get(i));
      if (!(annot instanceof PDFDict)) continue;
      const subtype = nameText(annot.get(PDFName.of('Subtype'))) ?? 'other';
      counts.set(subtype, (counts.get(subtype) ?? 0) + 1);

      if (subtype !== 'link') continue;
      const action = resolve(context, annot.get(PDFName.of('A')));
      if (action instanceof PDFDict) {
        const kind = nameText(action.get(PDFName.of('S')));
        const uri = textOfObject(resolve(context, action.get(PDFName.of('URI'))));
        if (kind === 'uri' && uri) links.push(sanitizeValue(uri));
        else if (kind === 'launch') launches++;
      }
      if (annot.has(PDFName.of('Dest'))) internalLinks++;
    }
  }

  return { counts, links: unique(links), internalLinks, launches };
}

function readHiddenLayers(context: PDFContext, catalog: PDFDict): { off: number; total: number } {
  const oc = resolve(context, catalog.get(PDFName.of('OCProperties')));
  if (!(oc instanceof PDFDict)) return { off: 0, total: 0 };
  const ocgs = resolve(context, oc.get(PDFName.of('OCGs')));
  const total = ocgs instanceof PDFArray ? ocgs.size() : 0;
  let off = 0;
  const d = resolve(context, oc.get(PDFName.of('D')));
  if (d instanceof PDFDict) {
    const offArr = resolve(context, d.get(PDFName.of('OFF')));
    if (offArr instanceof PDFArray) off = offArr.size();
  }
  return { off, total: Math.max(total, off) };
}

function invisibleTextCount(doc: PDFDocument, context: PDFContext): number {
  let hits = 0;
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    const streams: PDFRawStream[] = [];
    if (contents instanceof PDFRawStream) streams.push(contents);
    else if (contents instanceof PDFArray) {
      for (let i = 0; i < contents.size(); i++) {
        const stream = resolve(context, contents.get(i));
        if (stream instanceof PDFRawStream) streams.push(stream);
      }
    }
    for (const stream of streams) {
      const data = decodeRawStream(stream);
      if (!data) continue;
      hits += (latin1(data).match(/(?:^|[\s\]>()])3\s+Tr(?![a-zA-Z0-9])/g) ?? []).length;
    }
  }
  return hits;
}

function countSignatures(context: PDFContext): number {
  const signatures = new Set<PDFDict>();
  walkObjects(context, [context.trailerInfo.Root, context.trailerInfo.Info], (dict) => {
    if (nameText(dict.get(PDFName.of('Type'))) === 'sig') signatures.add(dict);
  });
  return signatures.size;
}

function findUnreachableObjects(context: PDFContext): number {
  const reachable = collectReachable(context, [context.trailerInfo.Root, context.trailerInfo.Info]);
  return context.enumerateIndirectObjects().filter(([ref]) => !reachable.has(ref)).length;
}

function sortFindings(findings: PrivacyFinding[]): PrivacyFinding[] {
  const rank: Record<PrivacySeverity, number> = { personal: 0, hidden: 1, informational: 2 };
  return [...findings].sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export async function scanPrivacy(bytes: Uint8Array): Promise<PrivacyReport> {
  // updateMetadata: false — pdf-lib's default load rewrites Producer/ModDate in
  // memory, which would both misreport this file's metadata and make a scan of
  // the same bytes differ from the file on disk.
  const doc = await loadPdf(bytes, undefined, undefined, { updateMetadata: false });
  const context = doc.context;
  const catalog = doc.catalog;
  const findings: PrivacyFinding[] = [];

  const info = readInfoMetadata(context);
  findings.push(...info.findings);

  const xmp = readXmp(context, catalog);
  let xmpValues: string[] = [];
  if (xmp) {
    const parsed = readXmpFindings(xmp);
    findings.push(...parsed.findings);
    xmpValues = parsed.values;
  }

  const traces = identityTraces([...info.values, ...xmpValues]);
  if (traces.length > 0 && !findings.some((f) => f.id === 'identity-traces')) {
    findings.push({
      id: 'identity-traces',
      title: 'Names, paths or email addresses',
      detail:
        'Metadata strings contain what looks like a username, file path, or email address — usually added automatically by the software that made the file.',
      severity: 'personal',
      values: traces,
      cleanable: true,
    });
  }

  const attachments = readAttachments(context, doc, catalog);
  if (attachments.count > 0) {
    findings.push({
      id: 'embedded-files',
      title: 'Embedded files',
      detail:
        'Whole files are packed inside this PDF. A viewer can extract and open them — including files you may not realize are there.',
      severity: 'hidden',
      values: cap(attachments.names),
      cleanable: true,
    });
  }

  const js = readJavaScript(doc, context);
  if (js.count > 0) {
    findings.push({
      id: 'javascript',
      title: 'JavaScript',
      detail:
        'The PDF contains embedded scripts. Some run the moment the file is opened. JavaScript in PDFs is a known malware vector — only open or forward scripts you trust.',
      severity: 'hidden',
      values: cap(js.places),
      cleanable: true,
    });
  }

  const annotations = readAnnotations(doc, context);
  if (annotations.launches > 0) {
    findings.push({
      id: 'launch-actions',
      title: 'Launch actions',
      detail:
        'Links in this file ask the viewer to open an external application or file. These are unusual in normal documents and can start programs on the reader’s machine.',
      severity: 'hidden',
      values: [`${annotations.launches} launch action${annotations.launches === 1 ? '' : 's'}`],
      cleanable: false,
    });
  }

  const revisions = countRevisions(bytes);
  if (revisions > 1) {
    findings.push({
      id: 'revisions',
      title: `Earlier saved versions (${revisions} revisions)`,
      detail:
        'PDF saves append changes, so this file still contains everything earlier revisions held. Text deleted or “redacted” in a later edit can often be recovered from an earlier revision with a recovery tool.',
      severity: 'hidden',
      values: [`${revisions} save revisions detected`],
      cleanable: true,
    });
  }

  const unreachable = findUnreachableObjects(context);
  if (unreachable > 0) {
    findings.push({
      id: 'unreachable-objects',
      title: 'Leftover objects',
      detail:
        'Objects no longer referenced by the document are still physically in the file. Invisible in every viewer, leftover objects have historically leaked deleted text and images.',
      severity: 'hidden',
      values: [`${unreachable} unreferenced object${unreachable === 1 ? '' : 's'}`],
      cleanable: true,
    });
  }

  const layers = readHiddenLayers(context, catalog);
  if (layers.off > 0) {
    findings.push({
      id: 'hidden-layers',
      title: 'Layers hidden by default',
      detail:
        'The file uses optional-content layers and some are switched off by default — content a reader won’t see unless they turn the layer on.',
      severity: 'hidden',
      values: [`${layers.off} of ${layers.total} layer${layers.total === 1 ? '' : 's'} off by default`],
      cleanable: false,
    });
  }

  const acroForm = resolve(context, catalog.get(PDFName.of('AcroForm')));
  const hasXfa = acroForm instanceof PDFDict && acroForm.has(PDFName.of('XFA'));
  if (hasXfa) {
    findings.push({
      id: 'xfa',
      title: 'XFA form',
      detail:
        'This form uses XFA — an embedded XML form format. Data entered into the form can be stored in the file, and XFA forms can carry their own scripts.',
      severity: 'hidden',
      values: [],
      cleanable: false,
    });
  }

  const invisible = invisibleTextCount(doc, context);
  if (invisible > 0) {
    findings.push({
      id: 'invisible-text',
      title: 'Invisible text layer',
      detail:
        'Text in this file is set to render invisibly. Scanned documents normally include this as an OCR/search layer; it can also be used to hide text that only appears when copied or parsed.',
      severity: 'informational',
      values: [`${invisible} invisible text run${invisible === 1 ? '' : 's'}`],
      cleanable: false,
    });
  }

  if (annotations.links.length > 0 || annotations.internalLinks > 0) {
    const values: string[] = [];
    if (annotations.links.length > 0) values.push(...annotations.links);
    if (annotations.internalLinks > 0) values.push(`${annotations.internalLinks} internal link${annotations.internalLinks === 1 ? '' : 's'}`);
    findings.push({
      id: 'links',
      title: 'Links',
      detail:
        'External links point at websites (often tracking or campaign URLs); internal links jump around the document. Links are ordinary annotations and are not removed by the cleaner.',
      severity: 'informational',
      values: cap(values),
      cleanable: false,
    });
  }

  const annotationValues: string[] = [];
  for (const [subtype, count] of annotations.counts) {
    if (subtype === 'link') continue;
    const label = ANNOTATION_LABELS[subtype] ?? subtype;
    annotationValues.push(`${count} ${label}${count === 1 ? '' : 's'}`);
  }
  if (annotationValues.length > 0) {
    findings.push({
      id: 'annotations',
      title: 'Comments and annotations',
      detail:
        'Annotations are visible in most viewers and can carry text, names, and timestamps of their own — review them before sending.',
      severity: 'informational',
      values: cap(annotationValues),
      cleanable: false,
    });
  }

  const documentId = resolve(context, context.trailerInfo.ID);
  if (documentId instanceof PDFArray && documentId.size() > 0) {
    const first = resolve(context, documentId.get(0));
    const value = first instanceof PDFHexString ? first.asString() : textOfObject(first);
    if (value) {
      findings.push({
        id: 'document-id',
        title: 'File identifier',
        detail:
          'The PDF trailer stores an ID that most producers reuse across saves. It can be used to tell that two files came from the same original.',
        severity: 'informational',
        values: [sanitizeValue(value)].filter((v): v is string => Boolean(v)),
        cleanable: true,
      });
    }
  }

  const signatures = countSignatures(context);
  if (signatures > 0) {
    findings.push({
      id: 'signatures',
      title: 'Digital signature',
      detail:
        'This PDF is digitally signed. A signature freezes the document — if you edit or clean a signed file, the signature will no longer validate. Check the evidence first with the signature tool.',
      severity: 'informational',
      values: [`${signatures} signature${signatures === 1 ? '' : 's'}`],
      cleanable: false,
    });
  }

  const sorted = sortFindings(findings);
  return {
    pageCount: doc.getPageCount(),
    revisions,
    findings: sorted,
    counts: {
      personal: sorted.filter((f) => f.severity === 'personal').length,
      hidden: sorted.filter((f) => f.severity === 'hidden').length,
      informational: sorted.filter((f) => f.severity === 'informational').length,
    },
    attachments: attachments.count,
    javascript: js.count,
    canClean: sorted.some((f) => f.cleanable),
  };
}
