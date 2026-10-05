import type { Page } from '@playwright/test';

/**
 * Emulates a browser page translator (Chrome's, and extensions like it) on an
 * already-hydrated page: every text node is swapped for
 * `<font><font>translated</font></font>`, and text React renders later is
 * translated too.
 *
 * React keeps pointers to the text nodes it created, so once they are swapped
 * out, removing one throws `NotFoundError: Failed to execute 'removeChild'` and
 * unmounts the whole island. Tests use this to pin JSX shapes that survive it.
 */
export async function translatePage(page: Page): Promise<void> {
  await page.evaluate(() => {
    const wrap = (n: Node) => {
      const parent = n.parentNode as Element | null;
      if (n.nodeType !== Node.TEXT_NODE || !n.textContent?.trim() || !parent) return;
      if (parent.nodeName === 'FONT' || parent.closest('script,style')) return;
      const outer = document.createElement('font');
      const inner = document.createElement('font');
      inner.textContent = n.textContent;
      outer.appendChild(inner);
      parent.replaceChild(outer, n);
    };
    const sweep = (root: Node) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes: Node[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(wrap);
    };
    sweep(document.body);
    new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => (n.nodeType === Node.TEXT_NODE ? wrap(n) : sweep(n)));
        if (r.type === 'characterData') wrap(r.target);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}
