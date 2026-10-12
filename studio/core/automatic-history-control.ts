/** Configuration only. Segment mode never permits full TrainingSnapshot writes,
 * even while ON. A successful toggle also installs the connection-version
 * barrier, which refuses published v41 writers; blocked upgrades remain local OFF. */
export const AUTOMATIC_HISTORY_CONTROL_KEY = 'automatic-history-control';
export const AUTOMATIC_HISTORY_UNSAVED_MESSAGE = '本页已停止，设置未保存';
export class HistoryWriterBarrierBlockedError extends Error {
  constructor() { super('Older practice tabs still block history protection. Close them and retry.'); this.name = 'HistoryWriterBarrierBlockedError'; }
}

/** The original OFF-only format remains readable and its helper is unchanged. */
export interface AutomaticHistoryOffRecord {
  readonly key: typeof AUTOMATIC_HISTORY_CONTROL_KEY;
  readonly version: 1;
  readonly automaticHistoryEnabled: false;
  readonly generation: number;
}
/** No session ID, answer, event, timestamp, or content hash belongs in settings. */
export interface AutomaticHistorySegmentRecord {
  readonly key: typeof AUTOMATIC_HISTORY_CONTROL_KEY;
  readonly version: 2;
  readonly mode: 'segments';
  readonly automaticHistoryEnabled: boolean;
  readonly generation: number;
}
export type AutomaticHistoryControl =
  | Readonly<{ state: 'legacy-default'; generation: 0 }>
  | Readonly<{ state: 'off'; generation: number }>
  | Readonly<{ state: 'segment-on' | 'segment-off'; generation: number }>;

/** Reads never grant a page permission or erase a failed setting. ON permission
 * requires an explicit successful local enable request and a new admission. */
export interface AutomaticHistoryStatus {
  readonly locallyStopped: boolean;
  readonly settingsState: 'not-requested' | 'pending' | 'persisted' | 'not-persisted';
  readonly persistedGeneration: number | null;
  readonly error: string | null;
  readonly message: string | null;
}

export class AutomaticHistoryWriteFenceError extends Error {
  readonly reason: 'local-off' | 'persisted-off' | 'invalid-control' | 'segment-mode' | 'stale-generation' | 'invalid-permit' | 'closed';
  constructor(reason: AutomaticHistoryWriteFenceError['reason']) {
    super(reason === 'invalid-control'
      ? 'Automatic history settings could not be verified; automatic saving is stopped.'
      : reason === 'stale-generation'
        ? 'Automatic history settings changed. Read the current setting before trying again.'
        : reason === 'segment-mode'
          ? 'Only newly admitted history segments can be saved in segment mode.'
          : reason === 'invalid-permit'
            ? 'This history segment is no longer admitted for saving.'
            : reason === 'closed'
              ? 'This history repository is closed for saving.'
              : 'Automatic history is stopped; this snapshot was not saved.');
    this.name = 'AutomaticHistoryWriteFenceError';
    this.reason = reason;
  }
}

/** Missing configuration preserves ONLY the pre-feature legacy default. Segment
 * admission must require explicit segment-on; an absent control cannot grant it. */
export function readAutomaticHistoryControl(value: unknown): AutomaticHistoryControl {
  if (value === undefined) return Object.freeze({ state: 'legacy-default', generation: 0 });
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new AutomaticHistoryWriteFenceError('invalid-control');
  const record = value as Partial<AutomaticHistoryOffRecord | AutomaticHistorySegmentRecord>;
  if (record.key !== AUTOMATIC_HISTORY_CONTROL_KEY || !Number.isSafeInteger(record.generation) || record.generation! < 1) throw new AutomaticHistoryWriteFenceError('invalid-control');
  if (record.version === 1 && Reflect.ownKeys(record).length === 4 && record.automaticHistoryEnabled === false) {
    return Object.freeze({ state: 'off', generation: record.generation! });
  }
  if (record.version === 2 && Reflect.ownKeys(record).length === 5 && record.mode === 'segments' && typeof record.automaticHistoryEnabled === 'boolean') {
    return Object.freeze({ state: record.automaticHistoryEnabled ? 'segment-on' : 'segment-off', generation: record.generation! });
  }
  throw new AutomaticHistoryWriteFenceError('invalid-control');
}

/** Legacy OFF is idempotent. It cannot turn segment mode back into legacy mode. */
export function automaticHistoryOffRecord(control: AutomaticHistoryControl): AutomaticHistoryOffRecord {
  if (control.state !== 'legacy-default' && control.state !== 'off') throw new AutomaticHistoryWriteFenceError('stale-generation');
  return Object.freeze({ key: AUTOMATIC_HISTORY_CONTROL_KEY, version: 1, automaticHistoryEnabled: false,
    generation: control.state === 'off' ? control.generation : 1 });
}

/** Called under the same meta readwrite transaction as the setting update. */
export function automaticHistorySegmentRecord(control: AutomaticHistoryControl, enabled: boolean, expectedGeneration: number): AutomaticHistorySegmentRecord {
  if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0 || control.generation !== expectedGeneration) throw new AutomaticHistoryWriteFenceError('stale-generation');
  const same = control.state === (enabled ? 'segment-on' : 'segment-off');
  const generation = same ? control.generation : control.generation + 1;
  if (!Number.isSafeInteger(generation)) throw new AutomaticHistoryWriteFenceError('invalid-control');
  return Object.freeze({ key: AUTOMATIC_HISTORY_CONTROL_KEY, version: 2, mode: 'segments', automaticHistoryEnabled: enabled, generation });
}
