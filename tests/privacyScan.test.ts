import { PDFArray, PDFDict, PDFDocument, PDFInvalidObject, PDFName, PDFRawStream, PDFRef, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { cleanPdf } from '../src/lib/pdf/cleanPdf';
import { countRevisions, formatPdfDate, scanPrivacy } from '../src/lib/pdf/privacyScan';

const XMP = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
    xmp:CreatorTool="Acme Editor 9"
    pdf:Producer="Acme PDF Library 4"
    xmp:CreateDate="2026-01-02T03:04:05Z"
    xmpMM:DocumentID="uuid:abcd-1234">
   <dc:creator><rdf:Seq><rdf:li>Jane Doe</rdf:li></rdf:Seq></dc:creator>
   <xmpMM:History><rdf:Seq>
     <rdf:li xmlns:stEvt="http://ns.adobe.com/xap/1.0/sType/ResourceEvent#" stEvt:action="saved" stEvt:softwareAgent="Acme Editor 9" stEvt:when="2026-01-02T03:04:05Z"/>
   </rdf:Seq></xmpMM:History>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;

/**
 * A document exercising every detector: identity metadata, XMP with history,
 * a custom Info field, an embedded file, an auto-running script, link and
 * highlight annotations, a hidden layer, invisible text, and an object that
 * nothing references (the leftovers an incremental edit leaves behind).
 */
async function makeRichPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([612, 792]);

  doc.setTitle('Q3 client plan');
  doc.setAuthor('Jane Doe');
  doc.setSubject('Internal planning');
  doc.setKeywords(['client: Acme']);
  doc.setCreator('Acme Writer 9.1 (C:\\Users\\jdoe\\Documents\\plan.docx)');
  doc.setProducer('Acme PDF Library 4');
  // The setters above created the Info dictionary; add a custom field to it.
  (doc.context.lookup(doc.context.trailerInfo.Info) as PDFDict).set(
    PDFName.of('Company'),
    PDFString.of('Acme Corp'),
  );

  doc.catalog.set(
    PDFName.of('Metadata'),
    doc.context.register(doc.context.flateStream(XMP, { Type: 'Metadata', Subtype: 'XML' })),
  );

  const embeddedRef = doc.context.register(
    doc.context.flateStream('secret attachment contents', { Type: 'EmbeddedFile', Subtype: 'text/plain' }),
  );
  const filespecRef = doc.context.register(
    doc.context.obj({
      Type: 'Filespec',
      F: PDFString.of('secrets.txt'),
      UF: PDFString.of('secrets.txt'),
      EF: doc.context.obj({ F: embeddedRef }),
    }),
  );
  doc.catalog.set(
    PDFName.of('Names'),
    doc.context.obj({
      EmbeddedFiles: doc.context.register(
        doc.context.obj({ Names: [PDFString.of('secrets.txt'), filespecRef] }),
      ),
    }),
  );

  doc.catalog.set(
    PDFName.of('OpenAction'),
    doc.context.register(doc.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert("hello")') })),
  );

  const linkRef = doc.context.register(
    doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [72, 72, 200, 100],
      A: doc.context.obj({ S: 'URI', URI: PDFString.of('https://example.com/track?id=1') }),
    }),
  );
  const highlightRef = doc.context.register(
    doc.context.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: [10, 10, 30, 30] }),
  );
  const attachmentRef = doc.context.register(
    doc.context.obj({ Type: 'Annot', Subtype: 'FileAttachment', Rect: [10, 10, 20, 20], FS: filespecRef }),
  );
  page.node.set(PDFName.of('Annots'), doc.context.obj([linkRef, highlightRef, attachmentRef]));

  const ocgRef = doc.context.register(doc.context.obj({ Type: 'OCG', Name: PDFString.of('Layer A') }));
  doc.catalog.set(
    PDFName.of('OCProperties'),
    doc.context.obj({ OCGs: [ocgRef], D: doc.context.obj({ OFF: [ocgRef] }) }),
  );

  page.node.set(
    PDFName.of('Contents'),
    doc.context.register(doc.context.flateStream('BT /F1 12 Tf 3 Tr 72 700 Td (invisible hint) Tj ET')),
  );

  // Never referenced by the catalog: written to disk by pdf-lib but invisible
  // in every viewer — the shape of a leftover from an earlier edit.
  doc.context.register(doc.context.obj({ Secret: PDFString.of('text deleted in a later revision') }));

  return doc.save();
}

function findingsById(report: Awaited<ReturnType<typeof scanPrivacy>>) {
  return new Map(report.findings.map((f) => [f.id, f]));
}

/**
 * An image whose /ColorSpace is `[/ICCBased <ref>]` — the reference lives in
 * the image STREAM's dictionary. In pdf-lib a stream is not a PDFDict (its
 * entries are in a separate `.dict`), so a walker that only follows PDFDict
 * misses it, calls the ICC profile unreferenced, and pruning deletes a live
 * object (real-world symptom: Acrobat reports "an error exists on this page").
 */
async function makeIccImagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([612, 792]);
  const icc = doc.context.register(doc.context.flateStream(new Uint8Array(16), { N: 3 }));
  const image = doc.context.register(
    doc.context.flateStream(new Uint8Array([0, 0, 0, 255, 255, 255]), {
      Type: 'XObject',
      Subtype: 'Image',
      Width: 2,
      Height: 1,
      BitsPerComponent: 8,
      ColorSpace: [PDFName.of('ICCBased'), icc],
    }),
  );
  page.node.newXObject('Im1', image);
  return doc.save({ useObjectStreams: false });
}

describe('scanPrivacy', () => {
  it('reports identity, software, timestamps, custom fields, and XMP details', async () => {
    const report = await scanPrivacy(await makeRichPdf());
    const byId = findingsById(report);

    expect(byId.get('author')?.values).toEqual(['Jane Doe']);
    expect(byId.get('title')?.values).toEqual(['Q3 client plan']);
    expect(byId.get('subject-keywords')?.values.join(' ')).toMatch(/Acme/);
    expect(byId.get('custom-metadata')?.values.join(' ')).toContain('Company: Acme Corp');
    expect(byId.get('identity-traces')?.values.join(' ')).toMatch(/jdoe/);
    expect(byId.get('software')?.values.join(' ')).toMatch(/Acme Writer 9\.1/);
    expect(byId.get('timestamps')).toBeUndefined(); // fixture has no Info dates
    expect(byId.get('xmp')?.values.join(' ')).toMatch(/Acme Editor 9/);
    expect(byId.get('xmp-history')?.values.join(' ')).toMatch(/saved/);
    expect(byId.get('xmp-ids')?.values.join(' ')).toContain('uuid:abcd-1234');
    expect(byId.get('xmp-author')?.values).toContain('Jane Doe');

    expect(report.counts.personal).toBeGreaterThanOrEqual(3);
  });

  it('reports hidden content: embedded files, scripts, layers, invisible text and leftovers', async () => {
    const report = await scanPrivacy(await makeRichPdf());
    const byId = findingsById(report);

    expect(report.attachments).toBe(1);
    expect(byId.get('embedded-files')?.values.join(' ')).toContain('secrets.txt');
    expect(report.javascript).toBe(1);
    expect(byId.get('javascript')?.values.join(' ')).toMatch(/opens/i);
    expect(byId.get('links')?.values).toContain('https://example.com/track?id=1');
    expect(byId.get('annotations')?.values.join(' ')).toMatch(/1 highlight/);
    expect(byId.get('annotations')?.values.join(' ')).toMatch(/1 file attachment/);
    expect(byId.get('hidden-layers')?.values.join(' ')).toMatch(/off by default/);
    expect(byId.get('invisible-text')?.values.join(' ')).toMatch(/1 invisible text run/);
    expect(byId.get('unreachable-objects')).toBeDefined();
    expect(report.findings.some((f) => f.severity === 'hidden')).toBe(true);
    expect(report.canClean).toBe(true);
  });

  it('does not report pdf-lib as the producer of the scanned bytes', async () => {
    const report = await scanPrivacy(await makeRichPdf());
    expect(findingsById(report).get('software')?.values.join(' ')).not.toMatch(/pdf-lib/i);
  });

  it('reports a plain, metadata-free PDF as clean', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage([612, 792]);
    const report = await scanPrivacy(await doc.save());

    expect(report.counts).toEqual({ personal: 0, hidden: 0, informational: 0 });
    expect(report.canClean).toBe(false);
  });

  it('does not call objects referenced from stream dictionaries unreferenced', async () => {
    const report = await scanPrivacy(await makeIccImagePdf());
    expect(report.findings.some((f) => f.id === 'unreachable-objects')).toBe(false);
  });
});

describe('cleanPdf', () => {
  it('removes metadata, XMP, IDs, attachments, scripts and unreferenced objects', async () => {
    const cleaned = await cleanPdf(await makeRichPdf(), {
      keepTitle: true,
      removeAttachments: true,
      removeJavaScript: true,
    });
    const doc = await PDFDocument.load(cleaned, { updateMetadata: false });

    expect(doc.getTitle()).toBe('Q3 client plan');
    expect(doc.getAuthor()).toBeUndefined();
    expect(doc.getCreator()).toBeUndefined();
    expect(doc.getProducer()).toBeUndefined();
    expect(doc.getSubject()).toBeUndefined();
    expect(doc.getKeywords()).toBeUndefined();
    expect(doc.catalog.get(PDFName.of('Metadata'))).toBeUndefined();
    expect(doc.catalog.get(PDFName.of('OpenAction'))).toBeUndefined();
    expect(doc.getPageCount()).toBe(1);

    const report = await scanPrivacy(cleaned);
    const ids = report.findings.map((f) => f.id);
    for (const id of ['author', 'software', 'custom-metadata', 'xmp', 'xmp-history', 'xmp-ids', 'embedded-files', 'javascript', 'unreachable-objects', 'document-id', 'timestamps']) {
      expect(ids).not.toContain(id);
    }
    expect(report.revisions).toBe(1);
    expect(report.counts.personal).toBe(0);
    // The kept title is the only cleanable item left.
    expect(report.findings.filter((f) => f.cleanable).map((f) => f.id)).toEqual(['title']);
  });

  it('keeps objects referenced only from a stream dictionary when cleaning', async () => {
    const cleaned = await cleanPdf(await makeIccImagePdf(), {
      keepTitle: true,
      removeAttachments: false,
      removeJavaScript: false,
    });
    const doc = await PDFDocument.load(cleaned, { updateMetadata: false });
    const resources = doc.getPage(0).node.Resources();
    const xobjects = resources?.lookup(PDFName.of('XObject'));
    expect(xobjects).toBeInstanceOf(PDFDict);
    const rawImage = (xobjects as PDFDict).values()[0];
    const image = rawImage instanceof PDFRef ? doc.context.lookup(rawImage) : rawImage;
    expect(image).toBeInstanceOf(PDFRawStream);
    const colorSpace = (image as PDFRawStream).dict.lookup(PDFName.of('ColorSpace'));
    expect(colorSpace).toBeInstanceOf(PDFArray);
    const iccRef = (colorSpace as PDFArray).get(1);
    expect(doc.context.lookup(iccRef)).toBeInstanceOf(PDFRawStream);
  });

  it('keeps the title only when asked, and leaves attachments/scripts when unchecked', async () => {
    const cleaned = await cleanPdf(await makeRichPdf(), {
      keepTitle: false,
      removeAttachments: false,
      removeJavaScript: false,
    });
    const doc = await PDFDocument.load(cleaned, { updateMetadata: false });
    expect(doc.getTitle()).toBeUndefined();

    const report = await scanPrivacy(cleaned);
    const ids = report.findings.map((f) => f.id);
    expect(ids).toContain('embedded-files');
    expect(ids).toContain('javascript');
    expect(ids).not.toContain('author');
  });

  it('never ships a dangling reference when an invalid object holds a reference the walk cannot see', async () => {
    // PDFInvalidObject is opaque bytes to the object model. If a reachable one
    // mentions an unreferenced object, pruning would normally delete that object
    // and leave the reference dangling — the safety net must keep it instead.
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage([612, 792]);
    const secretRef = doc.context.register(doc.context.obj({ Secret: PDFString.of('leftover') }));
    doc.catalog.set(
      PDFName.of('Zzz'),
      doc.context.register(PDFInvalidObject.of(new TextEncoder().encode(`${secretRef.objectNumber} 0 R`))),
    );
    const cleaned = await cleanPdf(await doc.save({ useObjectStreams: false }), {
      keepTitle: true,
      removeAttachments: false,
      removeJavaScript: false,
    });
    const out = await PDFDocument.load(cleaned, { updateMetadata: false });
    expect(out.context.lookup(PDFRef.of(secretRef.objectNumber))).toBeDefined();
  });
});

describe('countRevisions', () => {
  it('counts a single save as one revision', () => {
    const bytes = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< >>\nendobj\nstartxref\n9\n%%EOF\n');
    expect(countRevisions(bytes)).toBe(1);
  });

  it('counts appended saves as multiple revisions', () => {
    const bytes = new TextEncoder().encode(
      '%PDF-1.4\nstartxref\n9\n%%EOF\n1 0 obj\n<< >>\nendobj\nstartxref\n99\n%%EOF\n',
    );
    expect(countRevisions(bytes)).toBe(2);
  });
});

describe('formatPdfDate', () => {
  it('renders PDF date strings readably', () => {
    expect(formatPdfDate('D:20260102150405Z')).toBe('2026-01-02 15:04:05 UTC');
    expect(formatPdfDate('D:20260102')).toBe('2026-01-02');
  });

  it('passes through anything unrecognizable', () => {
    expect(formatPdfDate('not a date')).toBe('not a date');
  });
});
