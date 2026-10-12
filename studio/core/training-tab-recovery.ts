import type { AutomaticHistoryControl } from './automatic-history-control';
import type { PersistenceStatus } from './repository';
import type { TrainingHistoryRecorderStatus } from './training-history-recorder';
import type { TrainingSnapshot } from './training';

export const TRAINING_TAB_KEY = 'lingotrace:training-tab:v1';
export const REFERENCE_VISIBILITY_KEY = 'lingotrace:reference-visible:v1';
type TabStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface TrainingTabSelection { readonly version: 1; readonly sessionId: string; readonly sequence: number }
const invalid = () => new Error('This tab’s saved practice selection could not be restored. Saved history was not changed.');
export function readTrainingTabSelection(storage: TabStorage): TrainingTabSelection | null {
  const raw = storage.getItem(TRAINING_TAB_KEY);
  if (raw === null) return null;
  let value: TrainingTabSelection;
  try { value = JSON.parse(raw); } catch { throw invalid(); }
  if (!value || Object.keys(value).sort().join(',') !== 'sequence,sessionId,version' || value.version !== 1 ||
      typeof value.sessionId !== 'string' || !value.sessionId.trim() || value.sessionId.length > 256 ||
      !Number.isSafeInteger(value.sequence) || value.sequence < 1) throw invalid();
  return Object.freeze(value);
}
export function readReferenceVisibility(storage: TabStorage): boolean {
  const raw = storage.getItem(REFERENCE_VISIBILITY_KEY);
  if (raw === null || raw === 'shown') return true;
  if (raw === 'hidden') return false;
  throw new Error('The reference display choice could not be restored.');
}
export function saveReferenceVisibility(storage: TabStorage, visible: boolean): void {
  storage.setItem(REFERENCE_VISIBILITY_KEY, visible ? 'shown' : 'hidden');
}

/** A tab-local locator only. Answers/events remain exclusively in IndexedDB.
 * A committed receipt must belong to the current engine. Delayed old-course
 * callbacks, fresh previews and privacy-gap segments cannot select a restore. */
export function bindTrainingTabRecovery(options: {
  storage(): TabStorage;
  repository: { getStatus(): PersistenceStatus; subscribe(listener: () => void): () => void };
  history: { getSnapshot(): TrainingHistoryRecorderStatus; subscribe(listener: () => void): () => void };
  snapshot(): TrainingSnapshot | null;
  isCurrent(): boolean;
  onError(): void;
}) {
  let lastWritten: string | undefined;
  const remember = (sessionId: string, sequence: number) => {
    const raw = JSON.stringify({ version: 1, sessionId, sequence });
    if (raw === lastWritten) return;
    options.storage().setItem(TRAINING_TAB_KEY, raw); lastWritten = raw;
  };
  const observe = () => {
    if (!options.isCurrent()) return;
    try {
      const history = options.history.getSnapshot();
      if (history.mode === 'off' || history.mode === 'segment' || history.mode === 'awaiting-segment' || history.mode === 'enabling') {
        options.storage().removeItem(TRAINING_TAB_KEY); lastWritten = undefined; return;
      }
      if (history.mode !== 'legacy' || history.control?.state !== 'legacy-default') return;
      const current = options.snapshot(), receipt = options.repository.getStatus();
      if (!current || receipt.state !== 'persisted' || receipt.pendingWrites || receipt.error ||
          receipt.lastPersistedSessionId !== current.sessionId || !receipt.lastPersistedSequence ||
          receipt.lastPersistedSequence > current.sequence) return;
      remember(current.sessionId, receipt.lastPersistedSequence);
    } catch { options.onError(); }
  };
  const releaseRepo = options.repository.subscribe(observe), releaseHistory = options.history.subscribe(observe);
  return {
    read: () => readTrainingTabSelection(options.storage()),
    rememberRestored(snapshot: TrainingSnapshot, control: AutomaticHistoryControl) {
      if (!options.isCurrent() || control.state !== 'legacy-default' || options.snapshot()?.sessionId !== snapshot.sessionId) return;
      try { remember(snapshot.sessionId, snapshot.sequence); } catch { options.onError(); }
    },
    dispose() { releaseRepo(); releaseHistory(); },
  };
}
