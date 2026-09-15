import type { FontClass } from './fontMatch';

export interface TextEdit {
  /** Index of the page in the SOURCE document — text edits are applied before any page insert/delete. */
  page: number;
  itemKey: string;
  original: string;
  text: string;
  x: number; y: number;
  width: number; height: number; fontSize: number;
  fontClass: FontClass;
  cover: { r: number; g: number; b: number };
}

export interface NewTextBox {
  /** Stable identity, assigned by `EditSession.addBox()` — used as the React key so a box
   *  keeps its DOM node (and the text typed into it) when page insert/delete shifts indexes. */
  id?: string;
  /** Index into the session's CURRENT page list (`EditSession.pages`). */
  page: number; x: number; y: number; text: string;
  fontSize: number; fontClass: FontClass;
  color: { r: number; g: number; b: number };
}

export type PageRotation = 0 | 90 | 180 | 270;

export type ResizeSpec = { kind: 'percent'; value: number } | { kind: 'fit'; target: 'a4' | 'letter' };

/** One page of the working document: either an original page or a blank one the user inserted. */
export interface PageSlot {
  /** Stable identity (used as the React key); unchanged by inserts/deletes around it. */
  id: string;
  /** Index in the source document, or null for a blank page the user inserted. */
  source: number | null;
  /** Inserted pages only: size in points. Source pages carry 0 — their size lives in the PDF. */
  width: number;
  height: number;
}

export class EditSession {
  private editMap = new Map<string, TextEdit>();
  private boxList: NewTextBox[] = [];
  private rotationMap = new Map<number, PageRotation>();
  private slots: PageSlot[] = [];
  private blankSeq = 0;
  private boxSeq = 0;
  private structureDirty = false;
  resize: ResizeSpec | null = null;

  /** Starts the page list for a freshly opened document. Call before rendering any page. */
  setPageCount(count: number): void {
    this.slots = Array.from({ length: count }, (_, i) => ({ id: `page-${i}`, source: i, width: 0, height: 0 }));
    this.structureDirty = false;
  }

  /** The pages to show, in order — original pages plus any the user inserted. */
  get pages(): readonly PageSlot[] { return this.slots; }

  /** Whether the page list differs from the source document (a page was deleted or inserted). */
  get structureChanged(): boolean { return this.structureDirty; }

  /** Removes page `index`, dropping its text edits, text boxes, and rotation. Refuses to remove the last page. */
  deletePage(index: number): boolean {
    if (this.slots.length <= 1 || index < 0 || index >= this.slots.length) return false;
    const [removed] = this.slots.splice(index, 1);
    // Text edits live on source pages — the removed page's edits can no longer be applied.
    if (removed.source !== null) {
      for (const [key, edit] of this.editMap) {
        if (edit.page === removed.source) this.editMap.delete(key);
      }
    }
    // Boxes are indexed by list position: drop the removed page's, shift the rest up one.
    this.boxList = this.boxList.filter((b) => b.page !== index);
    for (const b of this.boxList) if (b.page > index) b.page -= 1;
    this.rotationMap = this.shiftRotations(index, -1);
    this.structureDirty = true;
    return true;
  }

  /** Inserts a blank page at `index` (clamped), shifting later pages' boxes and rotations down one. */
  insertBlankPage(index: number, width: number, height: number): void {
    const at = Math.max(0, Math.min(index, this.slots.length));
    this.slots.splice(at, 0, { id: `blank-${this.blankSeq++}`, source: null, width, height });
    for (const b of this.boxList) if (b.page >= at) b.page += 1;
    this.rotationMap = this.shiftRotations(at, 1);
    this.structureDirty = true;
  }

  /** Remaps rotation keys at/after `at`; on delete (delta -1) drops the removed page's entry. */
  private shiftRotations(at: number, delta: 1 | -1): Map<number, PageRotation> {
    const next = new Map<number, PageRotation>();
    for (const [page, rotation] of this.rotationMap) {
      if (delta === -1 && page === at) continue;
      next.set(page >= at ? page + delta : page, rotation);
    }
    return next;
  }

  recordEdit(edit: TextEdit): void {
    if (edit.text === edit.original) this.editMap.delete(edit.itemKey);
    else this.editMap.set(edit.itemKey, edit);
  }
  addBox(box: NewTextBox): void {
    box.id ??= `box-${this.boxSeq++}`;
    this.boxList.push(box);
  }
  updateBox(index: number, patch: Partial<NewTextBox>): void {
    const box = this.boxList[index];
    if (box) this.boxList[index] = { ...box, ...patch };
  }
  removeBox(index: number): void { this.boxList.splice(index, 1); }

  rotatePage(page: number, delta: 90 | -90): void {
    const next = ((((this.rotationMap.get(page) ?? 0) + delta) % 360) + 360) % 360 as PageRotation;
    if (next === 0) this.rotationMap.delete(page);
    else this.rotationMap.set(page, next);
  }
  rotationOf(page: number): PageRotation { return this.rotationMap.get(page) ?? 0; }

  get edits(): TextEdit[] { return [...this.editMap.values()]; }
  /** The recorded edit for one text item, if any — used by the UI to restore/paint edited spans. */
  editFor(itemKey: string): TextEdit | undefined { return this.editMap.get(itemKey); }
  get boxes(): NewTextBox[] { return this.boxList.filter((b) => b.text.trim() !== ''); }
  /** All boxes including empty ones still being typed — the UI needs real indexes into this array. */
  get boxesRaw(): NewTextBox[] { return this.boxList; }
  get rotations(): { page: number; rotation: PageRotation }[] {
    return [...this.rotationMap.entries()].map(([page, rotation]) => ({ page, rotation }));
  }
  get isEmpty(): boolean {
    return this.editMap.size === 0 && this.boxes.length === 0 && this.rotationMap.size === 0
      && this.resize === null && !this.structureDirty;
  }
}
