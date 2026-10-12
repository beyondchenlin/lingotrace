import type { TypingFollowAppend } from './typing-follow-policy.ts';

type Selection = { start: number; end: number } | null;
type InputEvidence = Pick<InputEvent, 'isTrusted' | 'isComposing' | 'inputType' | 'data'>;
type CompositionEvidence = Pick<CompositionEvent, 'isTrusted' | 'data'>;
interface Before { text: string; selection: Selection; native: InputEvidence }
/** Ephemeral native edit boundary, not a keystroke log. Unknown evidence fails closed. */
export class TypingFollowInput {
  revision = 0;
  private value = '';
  private before: Before | null = null;
  private composition: { id: number; text: string; selection: Selection; trusted: boolean } | null = null;
  private sequence = 0;
  reset(value: string) { this.value = value; this.revision = 0; this.before = null; this.composition = null; }
  matches(value: string) { return value === this.value; }
  capture(value: string, selection: Selection, native: InputEvidence) {
    if (this.composition || native.isComposing) return;
    this.before = { text: value, selection, native: { isTrusted: native.isTrusted, isComposing: native.isComposing, inputType: native.inputType, data: native.data } };
  }
  beginComposition(value: string, selection: Selection, native: Pick<CompositionEvent, 'isTrusted'>) {
    const id = ++this.sequence;
    this.before = null;
    this.composition = { id, text: value, selection, trusted: native.isTrusted };
    return id;
  }
  commit(value: string, native: InputEvidence): TypingFollowAppend {
    const before = this.before; this.before = null;
    const valid = before && before.text === this.value && before.native.isTrusted &&
      before.native.inputType === native.inputType && before.native.data === native.data && !before.native.isComposing;
    const edit: TypingFollowAppend = {
      before: this.value, after: value, beforeRevision: this.revision, afterRevision: ++this.revision,
      selectionBefore: valid ? before.selection : null,
      source: valid ? native.inputType === 'insertText' ? 'typed' : native.inputType === 'insertFromPaste' ? 'paste' : 'unknown' : 'unknown',
      kind: 'input', inputType: native.inputType ?? null, data: native.data ?? null,
      isTrusted: native.isTrusted, isComposing: native.isComposing,
    };
    this.value = value; return edit;
  }
  endComposition(value: string, native: CompositionEvidence): { id: number | null; edit: TypingFollowAppend | null } {
    const composition = this.composition; this.composition = null; this.before = null;
    if (composition && value === composition.text && !native.data) return { id: composition.id, edit: null };
    const edit: TypingFollowAppend = {
      before: this.value, after: value, beforeRevision: this.revision, afterRevision: ++this.revision,
      selectionBefore: composition?.text === this.value && composition.trusted ? composition.selection : null,
      source: composition ? 'ime' : 'unknown', kind: 'compositionend', inputType: null,
      data: native.data ?? null, isTrusted: native.isTrusted, isComposing: false,
      compositionId: composition?.id,
    };
    this.value = value; return { id: composition?.id ?? null, edit };
  }
  clear() { this.before = null; this.composition = null; this.value = ''; }
}
