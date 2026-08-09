---
title: 'How to add a watermark or stamp to a PDF — free, offline'
description: 'Add a text or image watermark or stamp to a PDF (or remove one) without uploading it anywhere. Free, local, and watermark-tool irony-free.'
pubDate: 2026-07-27
tags: ['watermark', 'how-to', 'privacy']
---

Marking a document as "DRAFT," branding a report with a company logo, or stamping "APPROVED" across a signed agreement are all common reasons to add a watermark or stamp to a PDF. It's a simple operation, but it's worth understanding the difference between the two terms — they solve slightly different problems — and worth being honest about what removal can and can't do, since "remove watermark" is often bundled into the same tool.

## Watermark vs. stamp: what's the actual difference

In everyday use, the two words describe the same thing at different intensities:

- A **watermark** is faint and translucent — present enough to be noticed, but not so bold that it obscures the page. This is the right look for background branding like a company logo or a "DRAFT" label across a document that's still being reviewed.
- A **stamp** is bold and fully opaque, made to be seen no matter what, like "APPROVED," "CONFIDENTIAL," or a review date stamped over an already-signed contract.

You may see tools offer to place the mark "behind the page content" for a classic watermark. In practice that rarely works: most PDFs — scans, Word exports, anything printed from a browser — paint a solid background across the entire page, so anything placed underneath it is simply invisible. That's why this tool always draws the mark over the page and uses **opacity** to control how subtle it looks. A low opacity gives the faded watermark effect on every document; full opacity gives a stamp.

Here's a concrete case where the intensity matters: an invoice with a dense table of line items that needs to be marked "PAID" before it's archived. At low opacity, the mark stays polite — readable, but letting the numbers underneath show through. At high opacity it becomes a proper stamp, fully legible no matter how busy the page underneath is. Whenever the marking needs to survive contact with a dense, image-heavy, or table-filled page, turn the opacity up.

## How to add a watermark or stamp

On the [watermark PDF tool](/watermark-pdf):

1. Drop your PDF into the upload box, or click it to browse your device.
2. Choose **Add text** or **Add image**, and enter or upload what you want stamped onto the pages.
3. Adjust opacity, rotation, and size — low opacity for a subtle watermark, high opacity for a bold stamp.
4. Click the action button and download the result.

Everything runs locally, entirely inside your browser — the PDF you're marking never gets uploaded anywhere to have text or an image drawn onto it.

## Removing a watermark: what's genuinely possible

The same tool includes a **Remove watermarks** option, and it's worth being upfront about its actual scope, because "remove watermark" tools have a reputation for overpromising. Removal works reliably on watermarks and stamps that exist as separate PDF objects layered onto the page — which is how tools that follow the PDF specification properly (including this one) add them. In that case, removing the watermark object cleanly restores the original page content underneath, because the watermark was never merged into it.

What removal can't do is strip a watermark that's been flattened into the page content itself, or baked directly into a scanned image — for example, a watermark that was burned in during a print-and-rescan process, or an image where the watermark and the underlying photo are now the same pixels. There's no clean way to separate those back out without also damaging the content underneath, and any tool claiming otherwise is either working with a narrower definition of "watermark" than you'd expect, or overstating what it can do. We'd rather tell you the actual boundary than let you find out the hard way on a document you cared about.

## The irony of a watermark tool that doesn't watermark you

It's worth naming the obvious tension directly: a lot of "free" watermark tools add their own branding to your file as a condition of using them for free — which is a strange thing for a watermarking tool to do to your document without asking. Because this tool runs on your own device rather than a server, there's no processing cost per use to recoup, and so no reason to add anything to your file beyond what you explicitly asked for. The output contains your watermark or stamp — the one you configured — and nothing else.

For more on why that upsell pattern shows up across free PDF editors generally, not just watermark tools specifically, see our post on [why free PDF editors add watermarks](/blog/free-pdf-editors-watermarks).

## Why local processing matters here specifically

Watermarking and stamping often apply to documents that are already sensitive by nature — contracts mid-review, confidential drafts, approved-but-not-yet-public reports. Uploading a document to mark it as "CONFIDENTIAL" only to have that upload itself be the least confidential part of the process is a genuine irony worth avoiding. Running the whole operation locally means the file never has to leave your device to get marked, checked, or have a watermark stripped back out — the same in-browser engine handles both directions without a network request in either one.
