---
title: 'How to extract specific pages from a PDF'
description: 'Pull just the pages you need into a new PDF — locally, free, no upload. Includes page-range syntax tips for fast extraction.'
pubDate: 2026-07-18
tags: ['split', 'how-to', 'privacy']
---

Sometimes you don't want to split a whole document apart — you want one specific slice of it. The signature page out of a 30-page contract. The appendix out of a report. Pages 4 through 9 of a scanned packet, and nothing else. That's extraction: pulling a defined subset of pages out of a PDF into a new, standalone file, while leaving the source document untouched.

It's functionally the same operation as splitting, just with a narrower goal, and it's worth knowing the range syntax that makes it fast rather than clicking through pages one at a time.

## How to extract pages from a PDF

Using the [split PDF tool](/split-pdf/):

1. Drop your PDF into the upload box, or click it to browse your device.
2. Click the thumbnails of the specific pages you want, or type the range directly into the input — for example, `4-9` for a contiguous block, or `1, 3, 5` for scattered individual pages.
3. Click **Split PDF**. Your new PDF containing just the selected pages downloads immediately.

Everything happens in that one step, entirely on your device — there's no separate "upload," "process," and "download" wait, because there's no server involved to wait on.

## Range syntax reference

A few patterns that cover most real extraction needs:

| What you want | What to type |
|---|---|
| A contiguous block | `4-9` |
| Scattered individual pages | `1, 3, 5` |
| From a page to the end | `10-` |
| A mix of all of the above | `1-3, 5, 7-` |

This is deliberately similar to the page-range syntax you'd type into a print dialog, so if you already know how to print "just pages 4 through 9," you already know how to extract them here too.

## A few extraction scenarios worth knowing

**Pulling out the signed page of a contract.** If you only need to prove a document was signed — for an application, a records request, or your own files — extracting just the signature page (rather than sending the whole underlying contract) shares less than necessary. Type the specific page number and extract just that one page.

**Splitting an appendix off a report.** Long reports often bury a data appendix at the end that's useful on its own. A range like `40-` (page 40 to the end) pulls the whole appendix into its own file without needing to know exactly how many pages the report has.

**Grabbing every other page.** This comes up more than you'd think — for double-sided scans that came in as separate front/back sequences, for instance. Listing pages individually (`1, 3, 5, 7...`) works, though for very long alternating sequences it's worth checking whether your source scan can be re-ordered before extraction instead.

**Removing pages instead of keeping them.** If your actual goal is "everything except pages 2 and 3," the fastest approach with a page-range tool is usually to describe what you want to keep rather than what you want to remove — e.g., `1, 4-` to keep page 1 and everything from page 4 onward, skipping 2 and 3.

## Why extraction shouldn't require an upload

The reason this can run entirely in your browser is that extracting pages doesn't require understanding or modifying the actual content of those pages — it's a structural operation on the PDF's object tree, copying the pages you selected into a new file while leaving everything else behind. Your browser already has to parse that structure just to render the thumbnails you're clicking on, using the same PDF rendering technology built into Firefox. Extraction reuses that same parsed structure to build the output file, all in memory, without a network round-trip.

That's a meaningful difference from uploading the source document to extract a page from it. If the document is a signed lease or a medical form, uploading the whole thing to get one page out means a third-party server briefly held everything you were trying to avoid sharing — the exact opposite of the selective sharing extraction is usually meant to achieve. Processing locally means the only pages that ever exist outside your device are the ones you actually selected.

## Extraction vs. splitting the whole document

If your goal is closer to "break this whole document into pieces" rather than "pull out this one section," the same tool handles that too — choosing "Every page as its own PDF" produces a zip file with one PDF per page instead of a single extracted range. Our companion post on [how to split a PDF into separate pages](/blog/split-pdf-into-separate-pages/) covers that full-document version of the same operation in more detail, including when it's the better fit than targeted extraction.

Either way, the underlying mechanics are identical: your browser reads the file, copies the pages you asked for, and hands you the result — no upload, no watermark, no waiting on a server that never needed to be involved.
