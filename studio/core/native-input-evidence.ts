/** Some browsers deliver a final input directly after compositionend. Consume
 * that same-task tail once; a later intentional same-text replacement is input. */
export class CompositionInputTail {
  private pending: { id: number; text: string } | null = null;
  private sequence = 0;
  remember(text: string): number { const id = ++this.sequence; this.pending = { id, text }; return id; }
  expire(id: number): void { if (this.pending?.id === id) this.pending = null; }
  consume(text: string, inputType: string | null): boolean {
    const pending = this.pending; this.pending = null;
    return !!pending && pending.text === text && ['insertText', 'insertCompositionText', 'insertFromComposition'].includes(inputType ?? '');
  }
}
