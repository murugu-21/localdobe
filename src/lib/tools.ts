/**
 * Single source of truth for the tool catalog: the sidebar (Base.astro), the
 * landing page sections (index.astro), and the mobile nav all render from this
 * list so a new tool only has to be added once.
 *
 * `icon` is the inner markup of a 24x24 lucide-style stroke icon; render it
 * inside an <svg fill="none" stroke="currentColor" stroke-width="2" ...>.
 */
export interface Tool {
  href: string;
  name: string;
  desc: string;
  icon: string;
}

export interface ToolGroup {
  label: string;
  tools: Tool[];
}

export const toolGroups: ToolGroup[] = [
  {
    label: 'Organize',
    tools: [
      {
        href: '/merge-pdf',
        name: 'Merge PDF',
        desc: 'Combine multiple PDFs into one, in the order you choose.',
        icon: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
      },
      {
        href: '/split-pdf',
        name: 'Split PDF',
        desc: 'Extract pages or break a PDF into separate files.',
        icon: '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
      },
      {
        href: '/compress-pdf',
        name: 'Compress PDF',
        desc: 'Shrink file size with a real compression engine that runs in your browser.',
        icon: '<path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/>',
      },
    ],
  },
  {
    label: 'Edit & annotate',
    tools: [
      {
        href: '/edit-pdf',
        name: 'Edit PDF',
        desc: 'Retype any text, add new text, rotate and resize pages.',
        icon: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
      },
      {
        href: '/watermark-pdf',
        name: 'Watermark & Stamp',
        desc: 'Add text or image watermarks and stamps — or remove them.',
        icon: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
      },
    ],
  },
  {
    label: 'Security',
    tools: [
      {
        href: '/protect-pdf',
        name: 'Protect PDF',
        desc: 'Encrypt a PDF with AES-256 — the password never leaves your device.',
        icon: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
      },
      {
        href: '/unlock-pdf',
        name: 'Unlock PDF',
        desc: 'Remove a password from a PDF you own, using the password you know.',
        icon: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
      },
      {
        href: '/validate-pdf-signature',
        name: 'Check Signatures',
        desc: "Validate a PDF's digital signature and inspect the evidence.",
        icon: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
      },
    ],
  },
];

export const allTools: Tool[] = toolGroups.flatMap((g) => g.tools);
