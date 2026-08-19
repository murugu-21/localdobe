---
title: 'The two compromises of PDF tools — and how to skip both'
description: 'A free Adobe Acrobat alternative with nothing to install — and an online-converter alternative with nothing to upload. How to skip both compromises.'
pubDate: 2026-08-09
tags: ['privacy', 'comparison']
---

Everyone who works with PDFs eventually faces the same fork in the road. Down one path: install a desktop PDF suite. Down the other: upload your file to a free converter site. Both paths get the job done, and both ask you to give up something that has nothing to do with the job itself.

## Compromise one: the desktop suite

Adobe Acrobat is the standard for a reason — it's genuinely capable software. But for the everyday tasks most people actually have (merge these two files, compress this attachment, fix a typo, add a "DRAFT" watermark), the cost of entry is steep. The free Acrobat Reader is a large download that can't do most of those tasks — merging, editing, compressing, and organizing pages live in the paid tier, currently a monthly subscription. The install itself brings the familiar friction of big desktop software: gigabytes of disk space, background updater services, frequent upgrade prompts, and offers for bundled extras you have to remember to untick.

None of that is a scandal — it's just a lot of machinery to accept when the task at hand is "put these two PDFs into one file." It's a truck when you need a hand cart.

## Compromise two: the upload sites

The other path is the one search engines love to serve: free online converter sites. No install, works anywhere — but the mechanism is that **your file is uploaded to someone else's server**. For a meme, who cares. For the documents people actually process — contracts, bank statements, tax forms, medical paperwork, signed agreements — you've just transmitted a sensitive document to an unfamiliar company in exchange for a page count.

What happens to it afterwards depends on a retention policy you'll probably never read, on that company's security practices, and on the laws of whatever jurisdiction their servers sit in. Add the business-model frictions — watermarks on output, page caps, forced signups at the exact moment your file is already on their server — and the "free" starts to look expensive. We've written more about [what actually happens to uploaded files](/blog/are-online-pdf-tools-safe/) and [the hidden costs of free converters](/blog/hidden-costs-free-pdf-converters/).

## Why the trade-off existed at all

The fork existed for an honest technical reason: PDF processing used to require real software — compiled libraries, meaningful compute — and that software had to run *somewhere*. Either on your machine (install the suite) or on a server (upload the file). A browser tab couldn't do the work.

That stopped being true. Modern browsers run compiled, professional-grade software at near-native speed, which means the same class of PDF engine that used to need an installer or a server farm now runs inside the page you're looking at. (Curious how? See [how your browser became a PDF powerhouse](/blog/webassembly-pdf-tools/).) The work happens on your machine — like the desktop suite — with nothing to install — like the web sites — and your file never leaves your device.

## What "no compromise" looks like in practice

That's exactly how [localdobe's tools](/) are built, and the difference is checkable rather than promised:

- **Nothing to install.** [Merge](/merge-pdf/), [split](/split-pdf/), [compress](/compress-pdf/), [edit](/edit-pdf/), [watermark](/watermark-pdf/), [password-protect](/protect-pdf/), [unlock](/unlock-pdf/), and [check signatures](/validate-pdf-signature/) — all in the browser you already have, on any operating system, with no admin rights and no updater.
- **Nothing to upload.** Disconnect from the internet after the page loads and every tool keeps working — the honest test no upload-based site can pass. The tools even work as an offline app.
- **No monetization of your document.** Free, no watermarks, no page caps, no account. Your hardware does the work, so nobody has to pay for servers by taxing your output.
- **The capable parts, too.** This isn't just the easy operations: editing genuinely removes the original text rather than papering over it, signature checking verifies certificate chains against the same publicly published trust list Adobe Acrobat uses (bundled locally), and encryption is real AES-256 whose password never leaves your machine.

## When you still want the other tools

Honesty cuts both ways. If you live in PDFs all day — redaction workflows, prepress, accessibility tagging, form authoring — a professional desktop suite earns its keep, and Acrobat is a fine one. And if a document is genuinely public and you're on a machine you trust nothing on, an upload site is harmless. The point isn't that those tools are villains; it's that the everyday middle — the merge, the compress, the quick edit on a document that matters — never needed either compromise. It just needed the work to happen on your own machine, with no installer attached.
