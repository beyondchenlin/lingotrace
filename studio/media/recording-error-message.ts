/** Presentation only. Keep the original failure in the recorder for diagnostics.
 * Never render arbitrary messages, stacks, causes, device names, or object fields. */
const MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  QuotaExceededError: '本机录像存储空间不足，录制已停止。',
  WRITE_BACKLOG: '录像写入速度跟不上，录制已停止。',
  SIZE_LIMIT: '本次录像已达到大小上限，录制已停止。',
  FINALIZE_TIMEOUT: '浏览器未能完成录像收尾。',
  EMPTY_RECORDING: '这次录像没有已写入的视频数据。',
  ENCODER_ERROR: '浏览器未能继续编码，录制已停止。',
  SCENE_RENDER_INTERRUPTED: '画面渲染已中断，录像已停止；画面可能不完整。',
  PAGE_BACKGROUND_INTERRUPTED: '页面已进入后台，录像已中断；画面和声音可能不完整。',
  AUDIO_MIX_INTERRUPTED: '录制混音已中断，录像已停止；声音可能不完整。',
  SOURCE_INTERRUPTED: '画面或音频来源已断开，录制已停止。',
  SOURCE_ENDED: '画面来源已结束，录制未能开始。',
  AUDIO_ENDED: '音频来源已结束，录制未能开始。',
  START_INTERRUPTED: '录制开始前已被中断。',
  ENCODER_UNAVAILABLE: '此浏览器不支持舞台录像。',
  NOT_PREPARED: '本机录像暂存尚未准备好，请稍后重试。',
  ANOTHER_TAB: '另一个训练页面正在使用录像存储，请关闭该页面后重试。',
});

function safeCode(error: unknown): string | null {
  if (typeof error === 'string') return Object.hasOwn(MESSAGES, error) ? error : null;
  if (!error || typeof error !== 'object') return null;
  // DOMException.code is numeric; its name remains the useful classifier.
  for (const field of ['code', 'name'] as const) {
    try {
      const value = (error as Record<string, unknown>)[field];
      if (typeof value === 'string' && Object.hasOwn(MESSAGES, value)) return value;
    } catch { /* A malformed diagnostic object must not break the error notice. */ }
  }
  return null;
}

export function recordingFailureMessage(error: unknown, committedBytes = 0): string {
  const code = safeCode(error);
  const reason = code ? MESSAGES[code] : '录像未能正常完成，请检查本机录像后重试。';
  const recovery = Number.isFinite(committedBytes) && committedBytes > 0
    ? '已写入的片段仍在本机，可在“本机录像”中尝试下载；片段可能无法播放。'
    : '尚未确认有已写入且可下载的录像数据。';
  return `${reason}${recovery}`;
}
