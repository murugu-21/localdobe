const SITE = 'https://localdobe.com';

// Cloudflare Workers assets 308-redirects slash-less paths to their trailing-slash
// form, and the sitemap always emits trailing slashes — keep JSON-LD urls in sync.
function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

export function webAppJsonLd(name: string, path: string, description: string): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name,
    url: withTrailingSlash(`${SITE}${path}`),
    description,
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires a modern browser with WebAssembly',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };
}

export function articleJsonLd(title: string, description: string, slug: string, pubDate: Date): object {
  return {
    '@context': 'https://schema.org',
    // BlogPosting is the more specific subtype of Article — declaring both lets
    // Google treat the post as the richer, richer-markup BlogPosting.
    '@type': ['Article', 'BlogPosting'],
    headline: title,
    description,
    datePublished: pubDate.toISOString(),
    url: withTrailingSlash(`${SITE}/blog/${slug}`),
    author: { '@type': 'Organization', name: 'localdobe' },
    publisher: { '@type': 'Organization', name: 'localdobe', url: SITE },
  };
}

export function aboutJsonLd(description: string): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    name: 'About localdobe',
    url: withTrailingSlash(`${SITE}/about`),
    description,
    about: {
      '@type': 'Organization',
      name: 'localdobe',
      description: 'Free, private, in-browser PDF tools',
      url: SITE,
    },
  };
}

export function itemListJsonLd(items: { name: string; url: string }[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: items.map(({ name, url }, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      url,
    })),
  };
}

export function faqJsonLd(items: { q: string; a: string }[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}
