import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';

export async function GET(context: APIContext) {
  const site = context.site?.href.replace(/\/$/, '') ?? 'https://localdobe.com';
  const posts = (await getCollection('blog')).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
  );

  const sections = [
    '# localdobe — full guide content',
    '',
    `Source: ${site} — free PDF tools that run entirely in the browser (no uploads, no watermarks, no signup).`,
    `Index of tools and shorter summaries: ${site}/llms.txt`,
    '',
    ...posts.flatMap((p) => [
      '---',
      '',
      `# ${p.data.title}`,
      '',
      `URL: ${site}/blog/${p.id}/`,
      `Published: ${p.data.pubDate.toISOString().slice(0, 10)}`,
      '',
      p.body?.trim() ?? '',
      '',
    ]),
  ];

  return new Response(sections.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
