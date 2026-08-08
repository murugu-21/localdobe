export type FontClass = 'sans' | 'serif' | 'mono';

const MONO = /courier|mono|consol|menlo|inconsolata|typewriter/i;
const SERIF = /times|serif|georgia|garamond|book|palatino|cambria|charter|minion|roman/i;

/** Classify a PDF font name (often subset-prefixed like "ABCDEF+Arial-BoldMT"). */
export function classifyFont(pdfFontName: string): FontClass {
  const name = pdfFontName.replace(/^[A-Z]{6}\+/, '');
  if (MONO.test(name)) return 'mono';
  if (SERIF.test(name)) return 'serif';
  return 'sans';
}

export const FONT_FILES: Record<FontClass, string> = {
  sans: '/fonts/LiberationSans-Regular.ttf',
  serif: '/fonts/LiberationSerif-Regular.ttf',
  mono: '/fonts/LiberationMono-Regular.ttf',
};

export function cssFontStack(cls: FontClass): string {
  return cls === 'mono' ? 'ui-monospace, Menlo, monospace'
    : cls === 'serif' ? 'Georgia, "Times New Roman", serif'
    : 'Arial, Helvetica, sans-serif';
}
