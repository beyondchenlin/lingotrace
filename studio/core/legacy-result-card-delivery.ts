import type { LegacyHistorySession } from './legacy-history';
import type { LegacyHistoryAccess } from './legacy-history-reader';

/** Private image delivery uses the existing durable history boundary, after
 * asynchronous PNG encoding. It never writes records or changes permission. */
export class LegacyResultCardDelivery {
  private readonly repository: Pick<LegacyHistoryAccess, 'deliverHistorySession'>;
  private epoch = 0;
  private active = true;
  private busy = false;
  constructor(repository: Pick<LegacyHistoryAccess, 'deliverHistorySession'>) { this.repository = repository; }
  activate(): void { this.invalidate(); this.active = true; }
  invalidate(): void { ++this.epoch; this.busy = false; }
  dispose(): void { this.active = false; this.invalidate(); }
  async download(session: LegacyHistorySession, encode: () => Promise<Blob>, sink: (name: string, blob: Blob) => void): Promise<boolean> {
    if (!this.active || this.busy) return false;
    const token = ++this.epoch; this.busy = true;
    const current = () => this.active && token === this.epoch;
    try {
      const blob = await encode();
      if (!current()) return false;
      if (blob.type !== 'image/png' || blob.size === 0) throw Error('PNG unavailable');
      let delivered = false;
      await this.repository.deliverHistorySession(session.snapshot.sessionId, session.snapshot, () => {
        if (!current()) return;
        sink('lingotrace-practice-card.png', blob); delivered = true;
      });
      return delivered;
    } catch (error) {
      if (!current()) return false;
      throw error;
    } finally { if (token === this.epoch) this.busy = false; }
  }
}
