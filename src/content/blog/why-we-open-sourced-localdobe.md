---
title: 'localdobe: open source PDF tools that never upload your files'
description: 'Most free PDF tools upload your files to a server, making that company the custodian of your data. localdobe is open source and runs entirely in your browser.'
pubDate: 2026-08-19
tags: ['privacy', 'open-source', 'trust', 'security']
faq:
  - q: 'Is it safe to use free online PDF tools?'
    a: 'It depends on where your file goes. If the tool uploads your document to a server you don’t control, you’re trusting that company — and its security, retention, and business practices — with your data. Tools that process locally, like localdobe, never have your file in the first place.'
  - q: 'Is localdobe open source?'
    a: 'Yes. The entire source code is published under the MIT License on GitHub and is public for anyone to read, audit, and verify. The in-browser PDF engine, pdfcpu, is itself open source under the Apache 2.0 License.'
  - q: 'Does localdobe upload my PDF anywhere?'
    a: 'No. Every operation runs inside your browser on your own device. Your file is never transmitted to, logged on, or stored by a server — disconnect from the internet after the page loads and the tools still work.'
  - q: 'Can I compress a PDF without uploading it?'
    a: 'Yes — compress a PDF without uploading it at all. localdobe compresses (and splits, merges, and edits) your file entirely in your browser, so no server ever sees your document.'
  - q: 'What does "processed on a server" mean for my documents?'
    a: 'It means the operator’s servers receive, hold, and process a full copy of your file. That company becomes the party in possession of — and responsible for — your data. With local processing, no server ever sees your file, so that exposure is gone.'
---

A free PDF tool should be the easiest technical decision you make all day. In practice it's often the opposite — because most "free" online PDF tools hide the one detail that actually matters: **where your file goes.**

## The two models of "free" PDF tools

Almost every free PDF tool you've ever used follows one of two designs.

**The server model.** You upload your PDF, it travels over the internet to the company's servers, they process it there, and they send the result back. This is what tools like ihatepdf.cv do — and it's the most common model, because it needs nothing from your device beyond a browser.

That model has a consequence most people don't stop to think about: **the company running the site becomes the party that holds your document.** Every file you run through it — contracts, bank statements, medical records, signed agreements — is copied onto infrastructure you don't control. Whatever their privacy policy says, the responsibility for what happens to those files no longer sits with you. It sits with them.

If they're careless, or breached, or acquired, or just quietly change their retention terms, it's their infrastructure that has your documents — and they're the ones answerable for it. Choosing to upload a document to a server tool is, in effect, choosing to make a third party the custodian of your file.

**The local model.** localdobe runs the opposite way. Your PDF is processed *inside your browser, on your device*. No file is ever uploaded. Nothing is transmitted, logged, or stored on a server. Disconnect from the internet after the page loads and the tools keep working — because the work never involved the network in the first place.

That means you can [compress a PDF without uploading it](/compress-pdf/), [split a PDF without uploading it](/split-pdf/), or [merge PDFs without uploading them](/merge-pdf/) — and nothing about the operation ever leaves your device. There's no server holding your file, no server to breach, and no third party responsible for it.

## Open source is the trust layer

The server model asks you to trust a company you've never met. The local model mostly removes that need — but how do you verify the claim?

That's the second thing we believe deserves to be upfront: **you shouldn't have to take our word for it.**

So localdobe is now fully open source. The entire codebase is published on GitHub under the **MIT License** — anyone can read it, audit it, fork it, and check exactly what it does. And the PDF engine inside it, [pdfcpu](https://github.com/pdfcpu/pdfcpu), is itself open source under the **Apache 2.0 License**, the same class of permissive license used by some of the most widely deployed software in the world.

That's the difference between "trust us" and "check for yourself."

Tools that process your files on their servers, and keep their own code closed behind a private repository, ask you to accept their word for what happens to your documents. When our code is public for anyone to inspect, that trust is verifiable — not just asserted. Open code can be audited. Closed code can only be trusted.

## What we're asking you to do next time

Before you run a PDF through any free online tool, ask two questions:

1. **Where does my file actually go?** If it uploads to their servers, a third party now holds a copy of your document — and the responsibility for it.
2. **Can I verify what the tool does?** If the source is private, your only option is to trust the company's word. If it's open source, you can check — or have someone you trust check for you.

localdobe's answers are simple: **nowhere, and yes.**

Not sure an online PDF tool is safe? We've written about [what actually happens to your files on online PDF tools](/blog/are-online-pdf-tools-safe/) and [how to merge PDFs without uploading them anywhere](/blog/merge-pdfs-without-uploading/).

Try it — [compress a PDF](/compress-pdf/), [split a PDF](/split-pdf/), or [merge PDFs](/merge-pdf/) entirely in your browser. Or skip us entirely and audit the code first at [github.com/murugu-21/localdobe](https://github.com/murugu-21/localdobe). We'd rather you verify us than trust us blindly.
