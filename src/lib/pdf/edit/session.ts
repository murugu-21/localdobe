import type { FontClass } from './fontMatch';

export interface TextEdit {
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
  page: number; x: number; y: number; text: string;
  fontSize: number; fontClass: FontClass;
  color: { r: number; g: number; b: number };
}

export type PageRotation = 0 | 90 | 180 | 270;

export type ResizeSpec = { kind: 'percent'; value: number } | { kind: 'fit'; target: 'a4' | 'letter' };

export class EditSession {
  private editMap = new Map<string, TextEdit>();
  private boxList: NewTextBox[] = [];
  private rotationMap = new Map<number, PageRotation>();
  resize: ResizeSpec | null = null;

  recordEdit(edit: TextEdit): void {
    if (edit.text === edit.original) this.editMap.delete(edit.itemKey);
    else this.editMap.set(edit.itemKey, edit);
  }
  addBox(box: NewTextBox): void { this.boxList.push(box); }
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
  get boxes(): NewTextBox[] { return this.boxList.filter((b) => b.text.trim() !== ''); }
  /** All boxes including empty ones still being typed — the UI needs real indexes into this array. */
  get boxesRaw(): NewTextBox[] { return this.boxList; }
  get rotations(): { page: number; rotation: PageRotation }[] {
    return [...this.rotationMap.entries()].map(([page, rotation]) => ({ page, rotation }));
  }
  get isEmpty(): boolean {
    return this.editMap.size === 0 && this.boxes.length === 0 && this.rotationMap.size === 0 && this.resize === null;
  }
}
