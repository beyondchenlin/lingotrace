/** ZH-canonical record stop protocol tokens + reason.* MessageKey bridge.
 * Values are the existing protocol strings (unchanged semantics / storage).
 * Display goes through t(reasonKey) or ui(token); never invent new reasons. */
import type {MessageKey} from '../i18n/locale';

export const RECORD_STOP_REASON = {
  userStop: '用户停止',
  practicePaused: '练习暂停',
  mixInterrupted: '录制混音中断',
  renderInterrupted: '画面渲染中断',
  backgrounded: '页面后台化',
} as const;

export type RecordStopReason = (typeof RECORD_STOP_REASON)[keyof typeof RECORD_STOP_REASON];

export const RECORD_STOP_REASON_KEYS = {
  [RECORD_STOP_REASON.userStop]: 'reason.recordUserStop',
  [RECORD_STOP_REASON.practicePaused]: 'reason.recordPracticePaused',
  [RECORD_STOP_REASON.mixInterrupted]: 'reason.recordMixInterrupted',
  [RECORD_STOP_REASON.renderInterrupted]: 'reason.recordRenderInterrupted',
  [RECORD_STOP_REASON.backgrounded]: 'reason.recordBackgrounded',
} as const satisfies Record<RecordStopReason, MessageKey>;

export function isRecordStopReason(value: string): value is RecordStopReason {
  return Object.prototype.hasOwnProperty.call(RECORD_STOP_REASON_KEYS, value);
}

export function recordStopReasonKey(reason: string): MessageKey | null {
  return isRecordStopReason(reason) ? RECORD_STOP_REASON_KEYS[reason] : null;
}

/** Scene-recorder failure copy keyed by stop protocol (ZH-canonical; ui()-bridged on display). */
export const RECORD_STOP_FAILURE_MESSAGE = {
  [RECORD_STOP_REASON.renderInterrupted]: '画面渲染中断，录像可能不完整。',
  [RECORD_STOP_REASON.mixInterrupted]: '录制混音已中断，声音可能不完整。',
  [RECORD_STOP_REASON.backgrounded]: '页面已进入后台，录像已中断；画面和声音可能不完整。',
} as const;
