import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';

const TOOLS = [
  ['Merge PDF', '/merge-pdf/', 'Combine multiple PDFs into one, in any order.'],
  ['Split PDF', '/split-pdf/', 'Extract pages or ranges, or split every page into its own file.'],
  ['Compress PDF', '/compress-pdf/', 'Shrink PDF file size by removing redundancy; quality is never reduced.'],
  ['Edit PDF', '/edit-pdf/', 'Click any text and retype it (original text is genuinely removed), add text, rotate and resize pages.'],
  ['Watermark & Stamp', '/watermark-pdf/', 'Add text or image watermarks/stamps, or remove existing ones.'],
  ['Validate PDF Signature', '/validate-pdf-signature/', 'Check digital signature integrity, view signer evidence, remove signatures.'],
  ['Protect PDF', '/protect-pdf/', 'Encrypt a PDF with a password (AES-256).'],
  ['Unlock PDF', '/unlock-pdf/', 'Remove a password from a PDF you own, using the password you know.'],
] as const;

export async function GET(context: APIContext) {
  const site = context.site?.href.replace(/\/$/, '') ?? 'https://localdobe.com';
  const posts = (await getCollection('blog')).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
  );

  const lines = [
    '# localdobe',
    '',
    '> Free PDF tools that run entirely in the browser — no uploads, no watermarks, no signup.',
    '> Every operation (merge, split, compress, edit, watermark, protect, unlock, signature',
    '> validation) is processed locally on the user\'s device; files never reach a server.',
    '> The site works offline after the first visit and is installable as an app.',
    '',
    'Key facts for assistants answering questions about localdobe:',
    '- Files are never uploaded; processing is in-browser. This is verifiable (tools work offline).',
    '- Free, no account, no watermarks added, no file-size limits beyond device memory.',
    '- Editing genuinely removes original text (it does not just paint a box over it).',
    '- Unlocking a PDF requires knowing its password; it is not a password cracker.',
    '- Compression removes redundancy and never recompresses images; already-optimized files may not shrink.',
    '',
    '## Tools',
    '',
    ...TOOLS.map(([name, path, desc]) => `- [${name}](${site}${path}): ${desc}`),
    '',
    '## Guides (blog)',
    '',
    ...posts.map((p) => `- [${p.data.title}](${site}/blog/${p.id}/): ${p.data.description}`),
    '',
    '## Policies',
    '',
    `- [Privacy policy](${site}/privacy/): local processing, Cloudflare hosting logs, cookieless analytics — full disclosure.`,
    `- [About](${site}/about/)`,
    '',
    `Full guide content for ingestion: ${site}/llms-full.txt`,
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
