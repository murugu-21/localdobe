---
title: 'PDF compression explained: why some PDFs are 10× too big'
description: 'Duplicate fonts, unoptimized images, dead objects — where PDF bloat comes from and what compression actually does to your file.'
pubDate: 2026-07-14
tags: ['compress', 'webassembly']
---

A three-page PDF that's somehow 40 MB isn't unusual, and it's a fair question to ask why. The content — a few paragraphs of text and maybe a couple of images — clearly doesn't need that much space. The answer almost always comes down to how the PDF was produced, not what it visually contains. Understanding where that bloat comes from also explains what a compression tool can and can't actually fix — and matters in practice the moment an oversized attachment bounces back from an email provider's size limit, which our post on [compressing a PDF for email](/blog/compress-pdf-for-email/) covers from the practical side.

## PDFs are a container format, and containers accumulate junk

A PDF file isn't a single stream of "page 1 looks like this, page 2 looks like this." It's a structured container: a catalog of objects — fonts, images, content streams describing what to draw and where, cross-reference tables pointing to all of it — that together describe the document. That structure is powerful (it's why PDFs render identically everywhere), but it also means a PDF can accumulate a lot of overhead that has nothing to do with what a reader actually sees on the page.

A few of the most common sources of bloat:

**Duplicate embedded fonts.** Every time a PDF is edited, merged, or re-exported by different software, there's a real risk that the same font gets embedded more than once — once from the original document, once from whatever was pasted in during editing, once more from a later merge. Each embedded font subset can be tens or hundreds of kilobytes; a document that's changed hands a few times can end up with the same font embedded three or four separate times, none of which the reader can see.

**Unoptimized or oversized images.** A scanned page saved at print resolution, or a photo pasted in at its original camera resolution and then visually shrunk on the page (but not actually resized in the file), keeps its full original pixel data in the PDF even though only a fraction of that resolution is ever displayed.

**Unused or orphaned objects.** Editing software doesn't always clean up after itself. Deleted content, previous versions of an image, or objects referenced by a since-removed page can linger in the file's internal object table, taking up space without appearing anywhere in the visible document.

**Repeated content streams.** Content streams — the instructions describing what to draw on a page — can end up duplicated across a document instead of referenced once and reused, especially in PDFs assembled by merging several source files without cleanup.

None of this is visible when you open the PDF and look at it. It's structural weight, not visual content, which is exactly why a well-designed compressor can often shrink a file dramatically without changing how a single page looks.

## What compression actually does about it

There are two fundamentally different strategies a "PDF compressor" can use, and they have very different consequences:

1. **Recompress images.** Lower the resolution or apply more aggressive lossy compression to embedded photos. This can produce large size reductions, but it's a real quality trade-off — text stays sharp, but photos and scanned pages come out visibly softer or blockier than the original.
2. **Remove redundancy.** Deduplicate repeated font embeds, strip unused objects, and eliminate repeated content streams, without touching the actual image or text data. This is what localdobe's [compress PDF tool](/compress-pdf/) does, using trusted, open-source PDF software that runs entirely inside your browser.

The redundancy-removal approach is more honest about its limits: it can only shrink a file by however much genuine redundancy that file actually contains. A cleanly generated PDF with no duplicate fonts and no orphaned objects might not shrink at all, and a good compressor should say so rather than pretending to have done something. A PDF that's been through several rounds of editing and merging, on the other hand, can often shrink by 20–70%, because that's roughly how much of its size turns out to be accumulated overhead rather than content.

## How to compress your own PDF

1. Go to the [compress PDF tool](/compress-pdf/) and drop your file in.
2. Choose a compression level — Light, Balanced, or Maximum.
3. Click **Compress PDF** and download the result.

Because this runs on a real compression engine inside your browser rather than on a server, there's no upload involved and no queue to wait in — the first run downloads the engine once, and every run after that is instant. Curious how professional-grade PDF software ends up running inside a browser tab at all? See our post on [WebAssembly and how it powers local PDF tools](/blog/webassembly-pdf-tools/).

## Why the honest answer is sometimes "not much smaller"

It's tempting to want every compression tool to promise a dramatic size reduction every time, but that promise usually means quality is being sacrificed somewhere to deliver it. A tool that tells you truthfully when a file is already lean — and shrinks the genuinely bloated files by a meaningful amount — is doing the more useful and more honest job, even if the headline number is less exciting on any individual file.
