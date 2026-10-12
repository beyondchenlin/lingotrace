import { identifyMedia, createSubtitleDraft, createTextTrackDraft, createASRDraft, reopenDraft, editCueText, editCueTiming, undoLastEdit, getCueIssues, exportVTT, serializeDraft, revalidateDuration, canUndo, canPlayCue } from './draft.js';
import { parseTimingSeconds, timingRange, nudgeTiming, boundaryPreview, timingShortcut } from './timing.js';
import { runAsr, ASR_INFO, getResourceStatus, clearAsrResources } from './asr-client.js';

const MEDIA_BYTES = 32 * 1024 * 1024;
const SUBTITLE_BYTES = 1024 * 1024;
const JSON_BYTES = 8 * 1024 * 1024;
const MAX_SECONDS = 60;

export function isPlayableRange(cue, duration) {
  return !!cue && Number.isFinite(cue.start) && Number.isFinite(cue.end) && Number.isFinite(duration) && cue.start >= 0 && cue.end > cue.start && cue.end <= duration;
}

// Average all real channels. Downsampling integrates each input frame's contribution;
// upsampling uses interpolation. No generated timing is attached to this PCM.
export function toMono16k(buffer) {
  if (!buffer || !Number.isFinite(buffer.sampleRate) || buffer.sampleRate <= 0 || !Number.isInteger(buffer.length) || buffer.length <= 0 || buffer.numberOfChannels < 1) throw new Error('浏览器没有解码出有效音轨。');
  const duration = buffer.length / buffer.sampleRate;
  if (!Number.isFinite(duration) || duration > MAX_SECONDS) throw new Error('实际解码音轨超过 60 秒，已停止。');
  const frames = Math.round(duration * 16000);
  if (frames < 1 || frames > 960000) throw new Error('音轨采样数超出本批范围。');
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < mono.length; i++) mono[i] += samples[i] / buffer.numberOfChannels;
  }
  for (let i = 0; i < mono.length; i++) if (!Number.isFinite(mono[i])) throw new Error('音轨包含无法处理的采样值。');
  if (buffer.sampleRate === 16000) return mono;
  const output = new Float32Array(frames);
  const ratio = buffer.sampleRate / 16000;
  for (let i = 0; i < frames; i++) {
    if (ratio < 1) {
      const index = i * ratio, left = Math.floor(index), weight = index - left;
      output[i] = mono[Math.min(left, mono.length - 1)] * (1 - weight) + mono[Math.min(left + 1, mono.length - 1)] * weight;
    } else {
      const left = i * ratio, right = Math.min((i + 1) * ratio, mono.length);
      let total = 0;
      for (let j = Math.floor(left); j < Math.ceil(right); j++) total += mono[j] * (Math.min(j + 1, right) - Math.max(j, left));
      output[i] = total / (right - left);
    }
  }
  return output;
}

export function clockText(seconds, milliseconds = false) {
  if (!Number.isFinite(seconds) || seconds < 0) return '缺时';
  const value = Math.round(seconds * 1000);
  const mins = Math.floor(value / 60000), secs = Math.floor((value % 60000) / 1000);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}${milliseconds ? '.' + String(value % 1000).padStart(3, '0') : ''}`;
}

function setupWorkbench() {
  const $ = id => document.getElementById(id);
  const player = $('source-player');
  const state = { media: null, file: null, url: null, versions: [], version: -1, selected: null, operation: null, operationId: 0, playId: 0, playEnd: null, playFrame: null, playIntent: null, pendingPlay: new Set(), editorPending: false, timingPending: false, mediaDecode: null, trackListeners: [], dialogPending: false };
  const currentVersion = () => state.versions[state.version] || null;
  const currentDraft = () => currentVersion()?.draft || null;
  const currentCue = () => currentDraft()?.candidates.find(cue => cue.id === state.selected) || null;
  const hasUnsaved = () => state.editorPending || state.timingPending || state.versions.some(version => !version.downloaded);
  const issuesOf = (draft, cue) => getCueIssues(draft, cue.id);
  const issueLabels = { 'needs-review': '待审核', overlap: '与其他段重叠', 'zero-duration': '零时长', 'missing-time': '缺少时间', 'out-of-bounds': '超出原片时长', 'cross-window': '跨 30 秒窗', 'crosses-window': '跨 30 秒窗', 'non-monotonic': '来源时间无序', 'alignment-stale': '修订后词对齐失效', 'invalid-time': '无效时间', 'reversed-time': '结束早于开始' };
  const issueText = issue => {
    const labels = { 'negative-time': '负时间', 'out-of-order': '源顺序与时间顺序不同', 'long-word-span': '词时间跨度偏长', 'duration-revalidated': '已按本次媒体时长复核', 'samples-revalidated': '已按本次解码采样复核', 'samples-not-redecoded': '本次尚未重新解码音轨', 'empty-text': '空白文字', 'invalid-syntax': '无效字幕时间行', 'vtt-unrepresentable-text': '文字包含 VTT 无法表示的换行或控制字符', 'vtt-millisecond-precision': '毫秒精度下时间范围无效' };
    if (issue === 'original-out-of-bounds') return '超出首次识别的原片时长';
    if (issue.startsWith('raw-')) return `${currentDraft()?.source.kind === 'asr' ? '原始词' : '原始字幕'}：${issueText(issue.slice(4))}`;
    return issueLabels[issue] || labels[issue] || issue;
  };
  const safeMessage = error => {
    const translations = {
      RESOURCE_NETWORK: '固定资源下载失败，可能网络已断开。请检查网络后重试。',
      RESOURCE_MISSING: '固定模型或运行库资源缺失；请稍后重试。',
      RESOURCE_HASH: '固定资源 SHA-256 校验失败。请释放本页资源后重试；不会改用外部模型。',
      RESOURCE_SIZE: '固定资源大小与清单不符，已停止加载。请释放本页资源后重试。',
      RESOURCE_REDIRECT: '固定资源发生了未允许的重定向，已停止下载。',
      RESOURCE_CACHE_WRITE: '浏览器无法在本页内存保留模型资源，可能内存不足。请释放资源后重试或导入已有字幕。',
      MEMORY_LIMIT: '浏览器本地转写内存不足。请关闭其他标签页、换用更短原片，或直接导入字幕。',
      MODEL_LOAD_FAILED: '已校验的本地模型无法启动。请释放本页资源后重试，或导入已有字幕。',
      INFERENCE_FAILED: '本地转写未能完成。可以重试或导入已有字幕；不会改用云端转写。',
      WORKER_UNAVAILABLE: '浏览器无法启动本地转写 Worker。可以重试，或直接导入已有字幕。',
      WORKER_ERROR: '本地转写 Worker 已停止，可能资源或内存不足。可释放资源后重试；现有初稿保留。',
      WORKER_MESSAGE: '本地 Worker 未能返回有效结果。请重试或导入已有字幕。',
      LOCAL_RESOURCES: '本地资源准备失败。请释放本页资源后重试。',
      'media-identity': '当前原片与 JSON 记录的文件 SHA-256 或大小不一致。请重新选择当时使用的同一份媒体。',
      'crypto-unavailable': '此浏览器无法计算本地 SHA-256，不能确认文件身份。请使用支持安全上下文的浏览器。'
    };
    const message = translations[error?.code] || (typeof error?.message === 'string' ? error.message : '此步骤未能完成，请检查文件后重试。');
    return `${message}${error?.file ? `\n失败的固定资源：${String(error.file)}` : ''}`;
  };

  function notice(text, kind = '') {
    $('notice').textContent = text;
    $('notice').className = `notice ${kind}`;
    $('notice').hidden = !text;
    $('notice').setAttribute('role', kind === 'error' ? 'alert' : 'status');
  }
  function updateButtons() {
    const ready = !!state.media && !state.operation;
    for (const id of ['choose-subtitles', 'choose-draft', 'start-asr']) $(id).disabled = !ready;
    $('toggle-play').disabled = !state.media || !!state.operation;
    $('clear-resources').disabled = !!state.operation;
    $('cancel-operation').disabled = !state.operation;
    $('draft-versions').disabled = !!state.operation;
    const draft = currentDraft();
    $('download-json').disabled = !draft || !!state.operation;
    $('download-vtt').disabled = !draft || !!state.operation;
    $('save-edit').disabled = !draft || !state.editorPending || !!state.operation;
    $('cue-text').disabled = !currentCue() || !!state.operation;
    $('undo-edit').disabled = !draft || !canUndo(draft) || !!state.operation;
    $('replay-cue').disabled = !!state.operation || !(isPlayableRange(currentCue(), state.media?.mediaDuration) && currentDraft() && canPlayCue(currentDraft(), state.selected));
    $('start-asr').textContent = state.versions.length ? '✳ 再次转写 · 新增并列初稿' : '✳ 开始本地转写 · 英文';
    for (const button of $('track-actions').querySelectorAll('button')) button.disabled = !ready;
    updateTimingControls();
  }
  function updateResources() {
    const resources = getResourceStatus();
    $('resource-status').textContent = `本页已校验 ${resources.verifiedFiles} / ${resources.totalFiles} 项，${resources.verifiedBytes.toLocaleString('en-US')} / ${resources.totalBytes.toLocaleString('en-US')} B${resources.complete ? '；资源齐备，可在本页复用。' : '；尚未全部齐备。'}`;
  }
  function updateSaveStatus() {
    const version = currentVersion();
    $('draft-save-status').textContent = state.editorPending || state.timingPending ? '改文或边界尚未保存到本页初稿' : version?.downloaded ? '已发起此版本完整 JSON 下载' : '尚未下载完整 JSON';
    $('draft-save-status').className = `save-state ${version?.downloaded && !state.editorPending && !state.timingPending ? 'saved' : ''}`;
  }
  function stopPlayback() {
    state.playId++;
    state.playEnd = null;
    state.playStart = null;
    state.playIntent = null;
    if (state.playFrame !== null) cancelAnimationFrame(state.playFrame);
    state.playFrame = null;
    player.pause();
    $('toggle-play').textContent = '播放原片';
  }
  function outsidePreviewRange() {
    return state.playEnd !== null && (!Number.isFinite(player.duration) || state.playEnd > player.duration || !Number.isFinite(player.currentTime) || player.currentTime < state.playStart || player.currentTime >= state.playEnd);
  }
  function enforceBoundary() {
    state.playFrame = null;
    if (document.hidden || outsidePreviewRange()) { stopPlayback(); return; }
    if (!player.paused && !player.ended) state.playFrame = requestAnimationFrame(enforceBoundary);
  }
  function armPlaybackBoundary() {
    if (state.playFrame !== null) cancelAnimationFrame(state.playFrame);
    state.playFrame = null;
    enforceBoundary();
  }
  async function startPlayback(cue = null, timingPreview = false) {
    if (!state.media || state.operation || document.hidden) return;
    stopPlayback();
    if (player.readyState < 1 || !Number.isFinite(player.duration) || player.duration <= 0 || player.duration > MAX_SECONDS) { notice('原片播放器尚未提供可用时长，请等候加载后再播放。', 'warning'); return; }
    if (cue && (!isPlayableRange(cue, player.duration) || !isPlayableRange(cue, state.media.mediaDuration) || (!timingPreview && !canPlayCue(currentDraft(), cue.id)))) { notice('本段存在缺时、零时长或越界问题，无法复听。原始数据仍完整保留，可下载 JSON。', 'warning'); return; }
    const owner = state.playId, media = state.media, source = state.url;
    state.playIntent = { owner, media, source }; state.pendingPlay.add(owner);
    try {
      if (cue) { state.playStart = cue.start; player.currentTime = cue.start; state.playEnd = cue.end; }
      else if (player.ended) player.currentTime = 0;
      player.playbackRate = Number($('playback-rate').value);
      await player.play();
      if (owner !== state.playId || media !== state.media || source !== state.url || document.hidden || state.operation) { if (!state.playIntent || document.hidden || state.operation) player.pause(); return; }
      if (player.error || player.readyState < 1 || !Number.isFinite(player.duration) || player.duration <= 0 || player.duration > MAX_SECONDS || (player.currentSrc && player.currentSrc !== source) || !Number.isFinite(player.currentTime) || player.currentTime < 0 || player.currentTime >= player.duration || (cue && (!isPlayableRange(cue, player.duration) || player.currentTime < cue.start || player.currentTime >= cue.end))) { stopPlayback(); notice('播放器状态或时长已变化，本次复听已停止。请检查原片后再试。', 'warning'); return; }
      $('toggle-play').textContent = '暂停原片';
      armPlaybackBoundary();
    } catch {
      if (owner === state.playId && media === state.media) { stopPlayback(); notice('浏览器未能播放这段原片。可再次点击播放；若持续失败，请换用浏览器支持的音视频编码。', 'error'); }
    } finally { state.pendingPlay.delete(owner); }
  }
  function owned(operation) { return state.operation === operation && !operation.controller.signal.aborted && (!operation.mediaSHA || operation.mediaSHA === state.media?.mediaSHA256); }
  function cancelOperation(showNotice = true) {
    const operation = state.operation;
    stopPlayback();
    if (!operation) return;
    state.operation = null;
    operation.controller.abort();
    clearInterval(operation.timer);
    for (const cleanup of operation.cleanups) cleanup();
    operation.cleanups.clear();
    $('operation-panel').hidden = true;
    updateButtons();
    updateResources();
    if (showNotice) notice('已取消本次任务，现有初稿保留。若浏览器仍在底层解码，迟到结果会被丢弃。', 'warning');
  }
  function startOperation(title, detail, mediaSHA = null) {
    cancelOperation(false);
    notice('');
    const operation = { id: ++state.operationId, controller: new AbortController(), mediaSHA, started: performance.now(), stageStarted: performance.now(), cleanups: new Set(), timer: null };
    state.operation = operation;
    $('operation-panel').hidden = false;
    $('operation-title').textContent = title;
    $('operation-detail').textContent = detail;
    $('operation-progress').removeAttribute('value');
    $('operation-remaining').textContent = '剩余时间未知';
    const tick = () => { if (owned(operation)) $('operation-elapsed').textContent = `已用 ${((performance.now() - operation.started) / 1000).toFixed(1)} 秒`; };
    tick(); operation.timer = setInterval(tick, 500);
    updateButtons();
    return operation;
  }
  function stage(operation, title, detail, progress = null) {
    if (!owned(operation)) return;
    $('operation-title').textContent = title;
    $('operation-detail').textContent = detail;
    if (progress && Number.isFinite(progress.total) && progress.total > 0 && Number.isFinite(progress.loaded)) {
      $('operation-progress').max = progress.total;
      $('operation-progress').value = Math.min(progress.loaded, progress.total);
      $('operation-remaining').textContent = '下载按真实字节计；剩余时间未知';
    } else { $('operation-progress').removeAttribute('value'); $('operation-remaining').textContent = '剩余时间未知'; }
  }
  function finishOperation(operation) {
    if (!owned(operation)) return false;
    clearInterval(operation.timer);
    state.operation = null;
    operation.cleanups.clear();
    $('operation-panel').hidden = true;
    updateButtons(); updateResources();
    return true;
  }
  function failOperation(operation, error) {
    if (!owned(operation)) return;
    finishOperation(operation);
    notice(`${safeMessage(error)}\n现有媒体与初稿未被替换。可检查文件后重新选择，或再次点击相同步骤重试。`, 'error');
  }
  function confirmDiscard(message) {
    if (state.dialogPending) return Promise.resolve(false);
    state.dialogPending = true;
    $('discard-message').textContent = message;
    const dialog = $('discard-dialog');
    return new Promise(resolve => {
      dialog.addEventListener('close', () => { state.dialogPending = false; resolve(dialog.returnValue === 'discard'); }, { once: true });
      dialog.returnValue = 'cancel'; dialog.showModal();
    });
  }
  async function discardPendingText() {
    if (!state.editorPending && !state.timingPending) return true;
    if (!await confirmDiscard('文字或时间边界还没有保存到本页初稿。继续会放弃尚未保存的改动；已保存的初稿保持不变。')) return false;
    state.editorPending = false; state.timingPending = false; stopPlayback(); renderEditor(); updateSaveStatus(); updateButtons(); return true;
  }
  function metadataFor(file, url, operation) {
    return new Promise((resolve, reject) => {
      const probe = document.createElement('video');
      probe.preload = 'metadata'; probe.playsInline = true;
      let settled = false;
      const deadline = performance.now() + 20000;
      const cleanup = () => { clearTimeout(timer); probe.removeAttribute('src'); probe.load(); operation.controller.signal.removeEventListener('abort', aborted); operation.cleanups.delete(aborted); };
      const done = (error, duration) => { if (settled) return; settled = true; probe.onloadedmetadata = null; probe.ondurationchange = null; probe.onerror = null; cleanup(); error ? reject(error) : resolve(duration); };
      const aborted = () => done(new DOMException('本次读取已取消。', 'AbortError'));
      const timer = setTimeout(() => done(new Error('浏览器未能及时读取原片元数据。请检查文件是否损坏、没有媒体轨或使用了不支持的编码。')), 20000);
      operation.controller.signal.addEventListener('abort', aborted, { once: true }); operation.cleanups.add(aborted);
      probe.onloadedmetadata = probe.ondurationchange = () => {
        if (operation.controller.signal.aborted) { aborted(); return; }
        if (probe.error) { probe.onerror(); return; }
        if (performance.now() >= deadline) { done(new Error('浏览器未能及时读取原片元数据。请检查文件是否损坏、没有媒体轨或使用了不支持的编码。')); return; }
        const duration = probe.duration;
        // Metadata can arrive before a finite duration. Keep the original bounded deadline.
        if (!Number.isFinite(duration) || duration <= 0) return;
        else if (duration > MAX_SECONDS) done(new Error('原片实际时长超过 60 秒。请先截取 60 秒以内的片段。'));
        else done(null, duration);
      };
      probe.onerror = () => done(new Error('浏览器无法读取该媒体。文件可能损坏、没有媒体轨或使用了不支持的编码。'));
      if (operation.controller.signal.aborted) { aborted(); return; }
      probe.src = url; probe.load();
    });
  }
  function showSource() {
    const media = state.media;
    $('media-name').textContent = state.file.name;
    $('media-details').textContent = `${media.size.toLocaleString('en-US')} B · ${(media.size / 1048576).toFixed(2)} MiB · ${media.mediaDuration.toFixed(3)} 秒 · ${media.mime || '未声明 MIME'}`;
    $('media-status').textContent = state.mediaDecode ? `音频解码成功 · 16,000 Hz 单声道 · ${state.mediaDecode.decodedSampleCount.toLocaleString('en-US')} 个采样` : '媒体元数据读取成功；音频解码尚未验证。';
    $('source-details').hidden = false;
    $('source-facts').replaceChildren();
    for (const [label, value] of [['SHA-256', media.mediaSHA256], ['身份依据', '本次重新计算的本地文件字节与大小'], ['实际媒体时长', `${media.mediaDuration.toFixed(6)} 秒`], ['读取方式', '本机 Blob URL；媒体和文件名不发送到网络']]) {
      const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; $('source-facts').append(dt, dd);
    }
    $('media-placeholder').hidden = true; player.hidden = false;
    $('play-clock').textContent = `${clockText(player.currentTime)} / ${clockText(media.mediaDuration)}`;
  }
  async function chooseMedia(file) {
    if (!file) return;
    if (file.size <= 0 || file.size > MEDIA_BYTES) { notice('请选择非空、最大 32 MiB 的本机媒体。当前原片与初稿保持不变。', 'error'); return; }
    if (hasUnsaved() && !await confirmDiscard('此页有尚未下载完整 JSON 的初稿或改文。切换原片后，这些本页内容会被移除。建议先取消并下载每份需要保留的 JSON。')) return;
    const operation = startOperation('读取并校验原片', '正在读取浏览器实际时长，并计算本地文件 SHA-256。');
    let url = null, committed = false;
    try {
      url = URL.createObjectURL(file);
      const duration = await metadataFor(file, url, operation);
      if (!owned(operation)) return;
      const media = await identifyMedia(file, { mediaDuration: duration });
      if (!owned(operation)) return;
      stopPlayback();
      for (const cleanup of state.trackListeners) cleanup(); state.trackListeners = [];
      const previous = state.url;
      player.removeAttribute('src'); player.load();
      state.media = media; state.file = file; state.url = url; state.mediaDecode = null;
      state.versions = []; state.version = -1; state.selected = null; state.editorPending = false; state.timingPending = false;
      player.src = url; player.load(); committed = true;
      if (previous) URL.revokeObjectURL(previous);
      showSource(); renderDraft(); finishOperation(operation); watchTracks();
      notice('原片已在本机读取。现在可以直接导入字幕，或下载固定模型后生成英文初稿。');
    } catch (error) { failOperation(operation, error); }
    finally { if (!committed && url) URL.revokeObjectURL(url); }
  }
  function watchTracks() {
    const owner = state.media;
    const list = player.textTracks;
    const update = () => {
      if (owner !== state.media) return;
      $('track-actions').replaceChildren();
      let readable = 0;
      for (let index = 0; index < list.length; index++) {
        const track = list[index];
        try {
          // Hidden exposes readable native cues without showing a second subtitle layer.
          track.mode = 'hidden';
          if (!track.cues?.length) continue;
          readable++;
          const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary small';
          button.textContent = `导入轨道 ${index + 1} · ${track.label || track.kind || '未命名'} · ${track.language || '未声明语言'} · ${track.cues.length} 段`;
          button.addEventListener('click', () => importTrack(track, index, owner)); $('track-actions').append(button);
        } catch { /* A browser may expose an unreadable track; no remote fallback. */ }
      }
      $('track-status').textContent = readable ? `发现 ${readable} 条可读取文本轨。轨道来源未经审核，不会称为官方字幕。` : '此浏览器未提供可读取文本轨。请改用本机 UTF-8 SRT / WebVTT。';
      updateButtons();
    };
    for (const event of ['loadedmetadata', 'loadeddata']) { player.addEventListener(event, update); state.trackListeners.push(() => player.removeEventListener(event, update)); }
    list.addEventListener('addtrack', update); state.trackListeners.push(() => list.removeEventListener('addtrack', update));
    update();
  }
  function addDraft(draft, label) {
    state.versions.push({ draft, label, downloaded: false }); state.version = state.versions.length - 1;
    state.selected = draft.candidates[0]?.id || null; state.editorPending = false; state.timingPending = false;
    renderDraft();
  }
  async function importTrack(track, index, owner) {
    if (state.media !== owner || state.operation || !await discardPendingText()) return;
    const operation = startOperation('读取浏览器文本轨', '将可读取轨道作为待审核字幕导入。', owner.mediaSHA256);
    try {
      const nativeCues = Array.from(track.cues || []);
      if (nativeCues.length > 500) throw new Error('可读取轨道超过 500 段，本批无法导入。');
      const cues = nativeCues.map(cue => ({ id: String(cue.id || ''), text: String(cue.text || ''), start: cue.startTime, end: cue.endTime }));
      const draft = await createTextTrackDraft({ media: owner, cues, track: { id: track.id || '', label: track.label || '', language: track.language || '', kind: track.kind || 'subtitles' } });
      if (!owned(operation)) return;
      addDraft(draft, `文本轨 ${index + 1}`); finishOperation(operation); notice('已加入文本轨待审核初稿。可读取的轨道文字、源序与轨道信息保存在完整 JSON 中；这是浏览器文本轨快照，不是原始容器内字幕文件字节。');
    } catch (error) { failOperation(operation, error); }
  }
  async function importSubtitleFile(file) {
    if (!file || !state.media) return;
    if (!file.size || file.size > SUBTITLE_BYTES) { notice('字幕必须是非空、最大 1 MiB 的 UTF-8 SRT / WebVTT。现有初稿保持不变。', 'error'); return; }
    const extension = file.name.split('.').at(-1).toLowerCase();
    if (!['srt', 'vtt'].includes(extension)) { notice('请选择扩展名为 .srt 或 .vtt 的字幕文件。', 'error'); return; }
    if (!await discardPendingText()) return;
    const media = state.media, operation = startOperation('读取本机字幕', '校验 UTF-8、源字幕段与时间范围；不会下载模型。', media.mediaSHA256);
    try {
      const bytes = await file.arrayBuffer(); if (!owned(operation)) return;
      let text; try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw new Error('字幕不是有效的 UTF-8 文本。请用 UTF-8 编码重新保存。'); }
      const draft = await createSubtitleDraft({ media, text, format: extension });
      if (!owned(operation)) return;
      addDraft(draft, `${extension.toUpperCase()} 导入`); finishOperation(operation); notice('本机字幕已加入待审核初稿。列表保留来源顺序和合法重叠；请逐段回听核对。');
    } catch (error) { failOperation(operation, error); }
  }
  async function importDraftFile(file) {
    if (!file || !state.media) return;
    if (!file.size || file.size > JSON_BYTES) { notice('初稿 JSON 必须非空且不超过 8 MiB。现有初稿保持不变。', 'error'); return; }
    if (!await discardPendingText()) return;
    const media = state.media, sourceFile = state.file, operation = startOperation('重新打开完整初稿', '先验证初稿数据，再重新计算当前原片的 SHA-256 与大小。', media.mediaSHA256);
    try {
      const bytes = await file.arrayBuffer(); if (!owned(operation)) return;
      const draft = await reopenDraft(new Uint8Array(bytes), sourceFile, { mediaDuration: media.mediaDuration, decodedSampleRate: state.mediaDecode?.decodedSampleRate ?? null, decodedSampleCount: state.mediaDecode?.decodedSampleCount ?? null });
      if (!owned(operation)) return;
      addDraft(draft, 'JSON 重新打开'); finishOperation(operation); notice('同一原片的 SHA-256 与大小核对成功，完整初稿已重新打开。时间范围按本次实测时长重新检查。');
    } catch (error) { failOperation(operation, error); }
  }
  async function decodeLocal(file, operation) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('此浏览器没有可用的本地音频解码接口。仍可导入已有字幕。');
    let context;
    try { context = new AudioContextClass({ sampleRate: 16000 }); } catch { context = new AudioContextClass(); }
    let closed = false;
    const close = () => { if (!closed) { closed = true; Promise.resolve(context.close()).catch(() => {}); } };
    operation.cleanups.add(close);
    try {
      const readStarted = performance.now();
      const bytes = await file.arrayBuffer(); if (!owned(operation)) throw new DOMException('已取消', 'AbortError');
      const readMs = performance.now() - readStarted, decodeStarted = performance.now();
      stage(operation, '本地解码音轨', '正在转换为 16,000 Hz 单声道 PCM；没有可测的完成百分比。');
      const audio = await context.decodeAudioData(bytes);
      if (!owned(operation)) throw new DOMException('已取消', 'AbortError');
      const pcm = toMono16k(audio);
      return { pcm, readMs, decodeMs: performance.now() - decodeStarted };
    } catch (error) {
      if (error?.name === 'AbortError' || !owned(operation)) throw error;
      if (error?.name === 'EncodingError' || error?.name === 'NotSupportedError') throw new Error('浏览器无法解码此音轨。可能没有音轨、文件损坏或编码不受支持；可换用 WAV / MP3，或直接导入字幕。');
      throw error;
    } finally { close(); operation.cleanups.delete(close); }
  }
  async function transcribe() {
    if (!state.media || state.operation || !await discardPendingText()) return;
    if (!state.media || state.operation) return;
    const media = state.media, file = state.file, operation = startOperation('读取本机音轨', '正在读取本机媒体字节，随后进行本地解码。此阶段没有可测的完成百分比。', media.mediaSHA256);
    let pcm = null;
    try {
      const decoded = await decodeLocal(file, operation); if (!owned(operation)) return;
      pcm = decoded.pcm;
      const { readMs, decodeMs } = decoded, sampleCount = pcm.length;
      const measurements = { mediaDuration: media.mediaDuration, decodedSampleRate: 16000, decodedSampleCount: sampleCount };
      state.mediaDecode = measurements; showSource();
      const result = await runAsr(pcm, { signal: operation.controller.signal, onProgress: progress => {
        if (!owned(operation)) return;
        const labels = { download: '下载固定模型与运行库', verify: '校验固定资源', loading: '加载本地模型', inference: '本地推理中' };
        const suffix = progress.file ? `\n当前固定资源：${progress.file}` : '';
        const detail = progress.stage === 'download' ? `已读取 ${Number(progress.loadedBytes || 0).toLocaleString('en-US')} / ${Number(progress.totalBytes || ASR_INFO.totalBytes).toLocaleString('en-US')} B${suffix}` : `${progress.stage === 'inference' ? '正在生成英文词时间戳。初稿仍需人工审核。' : '逐项校验资源或加载模型；没有可靠的完成百分比。'}${suffix}`;
        stage(operation, labels[progress.stage] || '本地处理中', detail, progress.stage === 'download' ? { loaded: progress.loadedBytes, total: progress.totalBytes } : null);
        updateResources();
      } });
      pcm = null;
      if (!owned(operation)) return;
      const draft = createASRDraft({ media: { ...media, ...measurements }, output: result.output, run: runtimeRecord(result, readMs, decodeMs) });
      if (!owned(operation)) return;
      addDraft(draft, `tiny.en 转写 ${state.versions.filter(version => version.label.startsWith('tiny.en')).length + 1}`);
      finishOperation(operation);
      notice(`已生成 ${draft.candidates.length} 个待审核候选段。解码 ${(decodeMs / 1000).toFixed(1)} 秒；下载 ${Number(result.downloadSeconds || 0).toFixed(1)} 秒；校验 ${Number(result.verifySeconds || 0).toFixed(1)} 秒；模型加载 ${Number(result.modelLoadSeconds || 0).toFixed(1)} 秒；推理 ${Number(result.inferenceSeconds || 0).toFixed(1)} 秒。已有人工稿保留为并列版本。`);
    } catch (error) { failOperation(operation, error); }
    finally { pcm = null; }
  }
  function runtimeRecord(result, readMs, decodeMs) {
    return { phaseMs: { read: readMs, decode: decodeMs, download: Number(result.downloadSeconds || 0) * 1000, verify: Number(result.verifySeconds || 0) * 1000, modelLoad: Number(result.modelLoadSeconds || 0) * 1000, inference: Number(result.inferenceSeconds || 0) * 1000, workerTotal: Number(result.workerTotalSeconds || 0) * 1000 } };
  }
  function renderDraft() {
    const draft = currentDraft();
    $('draft-empty').hidden = !!draft; $('draft-content').hidden = !draft;
    $('draft-versions').replaceChildren();
    state.versions.forEach((version, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = `${index + 1}. ${version.label} · 待审核`; option.selected = index === state.version; $('draft-versions').append(option); });
    if (!draft) { $('cue-list').replaceChildren(); updateButtons(); return; }
    $('cue-count').textContent = `${draft.candidates.length} 个候选段`;
    const issueCount = draft.candidates.filter(cue => issuesOf(draft, cue).some(issue => issue !== 'needs-review')).length;
    $('issue-count').textContent = issueCount ? `${issueCount} 段有时间 / 对齐提示` : '请复听核对所有候选段';
    $('cue-list').replaceChildren();
    draft.candidates.forEach((cue, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = `cue-item ${cue.id === state.selected ? 'selected' : ''}`; button.dataset.cueId = cue.id; button.setAttribute('aria-pressed', String(cue.id === state.selected));
      const top = document.createElement('span'); top.className = 'cue-item-top';
      const number = document.createElement('span'); number.className = 'cue-number'; number.textContent = String(index + 1).padStart(2, '0');
      const range = document.createElement('span'); range.textContent = `${clockText(cue.start, true)} — ${clockText(cue.end, true)}`; top.append(number, range);
      const text = document.createElement('span'); text.className = 'cue-item-text'; text.textContent = cue.text || '（空文本）';
      const bottom = document.createElement('span'); bottom.className = 'cue-item-bottom';
      const review = document.createElement('span'); review.textContent = '待审核'; bottom.append(review);
      const problems = issuesOf(draft, cue).filter(issue => issue !== 'needs-review');
      if (problems.length) { const count = document.createElement('span'); count.className = 'problem'; count.textContent = `· ${problems.length} 项提示`; bottom.append(count); }
      if (cue.alignment === 'stale') { const stale = document.createElement('span'); stale.className = 'problem'; stale.textContent = '· 对齐已失效'; bottom.append(stale); }
      if (!isPlayableRange(cue, state.media.mediaDuration) || !canPlayCue(draft, cue.id)) { const unavailable = document.createElement('span'); unavailable.className = 'problem'; unavailable.textContent = '· 无法复听'; bottom.append(unavailable); }
      button.append(top, text, bottom); button.addEventListener('click', () => selectCue(cue.id, true)); $('cue-list').append(button);
    });
    $('full-raw').textContent = JSON.stringify({ source: draft.source, run: draft.run, raw: draft.raw, edits: draft.edits }, null, 2);
    renderEditor(); updateSaveStatus(); updateButtons();
  }
  function renderEditor() {
    const cue = currentCue(), draft = currentDraft();
    $('editor-flags').replaceChildren();
    if (!cue) return;
    $('editor-heading').textContent = `候选段 ${draft.candidates.indexOf(cue) + 1}`;
    $('editor-range').textContent = `${clockText(cue.start, true)} — ${clockText(cue.end, true)}`;
    $('cue-text').value = cue.text;
    renderTiming();
    const messages = [...new Set(['待审核', ...issuesOf(draft, cue).filter(issue => issue !== 'needs-review').map(issueText), cue.alignment === 'stale' ? '文字或边界修订后词对齐失效' : cue.alignment === 'valid' ? '原始词时间关联，仍待审核' : '没有可用词级对齐'])];
    for (const message of messages) { const flag = document.createElement('span'); flag.className = 'flag'; flag.textContent = message; $('editor-flags').append(flag); }
    const words = draft.raw.words.filter(word => cue.rawWordIds.includes(word.id));
    const rawCue = draft.raw.cues?.find(item => item.id === cue.sourceRawCueId) || null;
    $('cue-raw').textContent = JSON.stringify({ sourceCueId: cue.sourceCueId, sourceOrder: cue.sourceOrder, segmentation: cue.segmentation, alignment: cue.alignment, rawWords: words, rawCue }, null, 2);
  }
  function timingDuration() {
    if (!state.media || player.readyState < 1 || !Number.isFinite(player.duration) || player.duration <= 0 || player.duration > MAX_SECONDS || player.error || (player.currentSrc && player.currentSrc !== state.url)) return null;
    return Math.min(state.media.mediaDuration, player.duration);
  }
  function pendingTiming() { return timingRange($('cue-start').value, $('cue-end').value, timingDuration()); }
  function renderTiming() {
    const cue = currentCue(), draft = currentDraft();
    if (!cue) return;
    $('cue-start').value = cue.start === null ? '' : String(cue.start);
    $('cue-end').value = cue.end === null ? '' : String(cue.end);
    const index = draft.candidates.indexOf(cue);
    const describe = (neighbor, label) => neighbor ? `${label} ${clockText(neighbor.start, true)}–${clockText(neighbor.end, true)} · ${neighbor.text}` : `${label} 无`;
    $('timing-neighbors').textContent = [describe(draft.candidates[index - 1], '前段'), describe(draft.candidates[index + 1], '后段')].join('\n');
    updateTimingControls();
  }
  function updateTimingControls() {
    const cue = currentCue(), duration = timingDuration(), checked = pendingTiming();
    const blocked = !cue || !!state.operation;
    $('timing-controls').disabled = blocked;
    $('timing-keyboard').tabIndex = blocked ? -1 : 0;
    $('timing-keyboard').setAttribute('aria-disabled', String(blocked));
    $('timing-duration').textContent = duration === null ? '当前播放器时长不可用；已保存来源仍保留。' : `本次可用时长 ${duration} 秒 · 数字与拖动按毫秒操作`;
    for (const boundary of ['start', 'end']) {
      const input = $(`cue-${boundary}`), slider = $(`cue-${boundary}-range`), value = parseTimingSeconds(input.value);
      input.max = duration === null ? '' : String(duration);
      slider.max = String(duration ?? state.media?.mediaDuration ?? 0);
      slider.disabled = blocked || duration === null || value === null || value > duration;
      if (value !== null && value >= 0 && value <= (duration ?? 0)) slider.value = String(value);
      slider.setAttribute('aria-valuetext', value === null ? '尚无有效时间，请输入秒数' : `${value} 秒`);
    }
    $('timing-status').textContent = !cue ? '请选择候选段。' : checked.error || (state.timingPending ? '边界暂存中；试听不会保存或确认字幕。' : `已保存边界 · 修订 ${cue.revision} · 始终待审核`);
    $('timing-status').className = `timing-status ${checked.error ? 'invalid' : ''}`;
    $('save-timing').disabled = blocked || !state.timingPending || !!checked.error;
    $('cancel-timing').disabled = blocked || !state.timingPending;
    for (const id of ['preview-timing', 'preview-start', 'preview-end']) $(id).disabled = blocked || !!checked.error;
    for (const id of ['timing-earlier', 'timing-later']) $(id).disabled = blocked || duration === null;
  }
  function timingChanged() {
    stopPlayback();
    const cue = currentCue();
    state.timingPending = !!cue && (parseTimingSeconds($('cue-start').value) !== cue.start || parseTimingSeconds($('cue-end').value) !== cue.end);
    updateTimingControls(); updateSaveStatus();
  }
  function nudgeBoundary(direction) {
    if (state.operation || !currentCue()) return;
    const boundary = $('timing-target').value === 'end' ? 'end' : 'start', input = $(`cue-${boundary}`);
    const next = nudgeTiming(input.value, direction, Number($('timing-step').value), timingDuration());
    if (next === null) { stopPlayback(); notice('微调未应用：请先填入有效秒数，并保持在本次原片范围内。', 'warning'); return; }
    input.value = next; timingChanged();
  }
  async function previewTiming(boundary = 'cue') {
    if (state.operation || !currentCue()) return;
    const checked = pendingTiming();
    if (checked.error) { notice(checked.error, 'warning'); return; }
    const range = boundaryPreview(checked.range, boundary, timingDuration());
    if (range) await startPlayback({ id: state.selected, ...range }, true);
  }
  function saveTiming() {
    if (state.operation || !currentCue() || !state.timingPending) return;
    const checked = pendingTiming();
    if (checked.error) { notice(checked.error, 'warning'); return; }
    try {
      const version = currentVersion(), text = $('cue-text').value, textPending = state.editorPending;
      const validated = revalidateDuration(version.draft, { mediaDuration: timingDuration(), decodedSampleRate: state.mediaDecode?.decodedSampleRate ?? null, decodedSampleCount: state.mediaDecode?.decodedSampleCount ?? null });
      const next = editCueTiming(validated, state.selected, checked.range);
      stopPlayback(); version.draft = next; version.downloaded = false; state.timingPending = false; renderDraft();
      if (textPending) { $('cue-text').value = text; state.editorPending = true; updateButtons(); updateSaveStatus(); }
      notice('边界修订已保存到本页初稿；原始时间与词时间保留，当前词对齐已失效。请下载完整 JSON 保存修订链；初稿仍待审核。');
    } catch (error) { notice(`${safeMessage(error)}\n现有初稿未变，暂存边界仍保留。`, 'error'); }
  }
  function cancelTiming() {
    if (state.operation || !currentCue()) return;
    stopPlayback(); state.timingPending = false; renderTiming(); updateSaveStatus();
  }
  async function selectCue(id, play) {
    if (state.operation) return;
    if (id === state.selected) { if (play) startPlayback(currentCue()); return; }
    if (id !== state.selected && !await discardPendingText()) return;
    if (!currentDraft()?.candidates.some(cue => cue.id === id)) return;
    stopPlayback(); state.selected = id; renderDraft();
    if (play) startPlayback(currentCue());
  }
  function saveEdit() {
    if (!currentDraft() || !currentCue() || state.operation) return;
    try {
      const version = currentVersion(), timing = { start: $('cue-start').value, end: $('cue-end').value, pending: state.timingPending };
      const next = editCueText(version.draft, state.selected, $('cue-text').value);
      stopPlayback(); version.draft = next; version.downloaded = false; state.editorPending = false; renderDraft();
      if (timing.pending) { $('cue-start').value = timing.start; $('cue-end').value = timing.end; state.timingPending = true; updateButtons(); updateSaveStatus(); }
      notice('这次改文已保存到本页初稿。原始输出未改动；请下载完整 JSON 才能在关闭后保留。');
    }
    catch (error) { notice(`${safeMessage(error)}\n现有初稿未变，输入框文字仍保留。`, 'error'); }
  }
  async function undoEdit() {
    if (!currentDraft() || state.operation || !await discardPendingText()) return;
    try { stopPlayback(); const version = currentVersion(); version.draft = undoLastEdit(version.draft); version.downloaded = false; state.editorPending = false; renderDraft(); notice('已撤销最近一次修订，恢复对应文字、时间与对齐状态；撤销记录保留。初稿仍待审核。'); }
    catch (error) { notice(safeMessage(error), 'error'); }
  }
  function downloadBlob(content, type, name) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    // A short grace period lets browser download handling consume the Blob.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function download(format) {
    if (!currentDraft() || state.operation) return;
    if (state.editorPending || state.timingPending) { notice('输入框还有未保存的改文或边界。请先保存或取消对应改动，再下载完整初稿。', 'warning'); $(state.editorPending ? 'save-edit' : 'save-timing').focus(); return; }
    try {
      const liveDuration = timingDuration();
      if (format === 'vtt' && liveDuration === null) throw new Error('原片播放器尚未提供可用时长，暂不能核验 VTT 范围。可先下载完整 JSON。');
      const version = currentVersion(), checked = revalidateDuration(version.draft, { mediaDuration: liveDuration ?? state.media.mediaDuration, decodedSampleRate: state.mediaDecode?.decodedSampleRate ?? null, decodedSampleCount: state.mediaDecode?.decodedSampleCount ?? null });
      const content = format === 'json' ? serializeDraft(checked) : exportVTT(checked);
      const name = `LingoTrace-待审核初稿-${state.version + 1}.${format}`;
      downloadBlob(content, format === 'json' ? 'application/json;charset=utf-8' : 'text/vtt;charset=utf-8', name);
      if (format === 'json') { version.downloaded = true; updateSaveStatus(); }
      notice(format === 'json' ? '已发起完整 JSON 下载。请确认浏览器确实保存了文件；保留原片，之后可重新打开继续修改。' : '已发起 UTF-8 VTT 下载。VTT 不含完整原始输出与修订，请另外下载 JSON 以便继续修改。');
    } catch (error) {
      if (error?.code === 'invalid-cues') {
        const details = Array.isArray(error.details) ? error.details.map(item => `第 ${Number(item.sourceOrder) + 1} 段${item.sourceCueId ? `（源标识 ${item.sourceCueId}）` : ''}：${(item.issues || []).map(issueText).join('、')}`).join('\n') : '';
        notice(`VTT 导出已阻止：存在无效时间范围，整份文件未导出，也没有静默丢弃任何段。\n${details}\n可先修正并保存时间边界，或下载完整 JSON 保留异常原件。`, 'error');
      } else notice(safeMessage(error), 'error');
    }
  }

  $('choose-media').addEventListener('click', () => $('media-input').click());
  $('choose-subtitles').addEventListener('click', () => $('subtitle-input').click());
  $('choose-draft').addEventListener('click', () => $('draft-input').click());
  for (const [id, callback] of [['media-input', chooseMedia], ['subtitle-input', importSubtitleFile], ['draft-input', importDraftFile]]) $(id).addEventListener('change', event => { const file = event.target.files?.[0]; event.target.value = ''; return callback(file); });
  $('start-asr').addEventListener('click', transcribe);
  $('cancel-operation').addEventListener('click', () => cancelOperation());
  $('clear-resources').addEventListener('click', () => { if (state.operation) return; clearAsrResources(); updateResources(); notice('已释放本页保留的模型资源；没有清除浏览器 HTTP 缓存，也没有修改原片或初稿。下一次转写会重新读取并校验所需资源。'); });
  $('toggle-play').addEventListener('click', () => player.paused ? startPlayback() : stopPlayback());
  $('playback-rate').addEventListener('change', () => { player.playbackRate = Number($('playback-rate').value); });
  $('replay-cue').addEventListener('click', () => startPlayback(currentCue()));
  player.addEventListener('play', () => { if (document.hidden || state.operation || (state.pendingPlay.size && !state.playIntent)) { stopPlayback(); return; } $('toggle-play').textContent = '暂停原片'; if (state.playEnd !== null) armPlaybackBoundary(); });
  player.addEventListener('pause', () => { $('toggle-play').textContent = '播放原片'; });
  player.addEventListener('ended', stopPlayback);
  player.addEventListener('timeupdate', () => { if (state.media) $('play-clock').textContent = `${clockText(player.currentTime)} / ${clockText(state.media.mediaDuration)}`; if (outsidePreviewRange()) stopPlayback(); });
  player.addEventListener('seeking', () => { if (document.hidden || state.operation) stopPlayback(); });
  for (const event of ['loadedmetadata', 'durationchange', 'emptied']) player.addEventListener(event, updateTimingControls);
  player.addEventListener('error', () => { if (state.media) { stopPlayback(); notice('原片播放器遇到解码错误。当前初稿仍保留；可下载 JSON 或换用兼容媒体。', 'error'); } });
  $('cue-text').addEventListener('input', () => { stopPlayback(); state.editorPending = $('cue-text').value !== currentCue()?.text; updateSaveStatus(); updateButtons(); });
  $('save-edit').addEventListener('click', saveEdit);
  for (const boundary of ['start', 'end']) {
    $(`cue-${boundary}`).addEventListener('input', timingChanged);
    $(`cue-${boundary}-range`).addEventListener('input', event => { $(`cue-${boundary}`).value = event.target.value; timingChanged(); });
  }
  $('save-timing').addEventListener('click', saveTiming);
  $('cancel-timing').addEventListener('click', cancelTiming);
  $('timing-earlier').addEventListener('click', () => nudgeBoundary(-1));
  $('timing-later').addEventListener('click', () => nudgeBoundary(1));
  $('timing-keyboard').addEventListener('keydown', event => {
    const action = timingShortcut(event, $('timing-keyboard'));
    if (action === null || state.operation || !currentCue()) return;
    event.preventDefault();
    if (action === 'hold') return;
    if (action === 'play') { if (player.paused) return previewTiming(); stopPlayback(); }
    else nudgeBoundary(action);
  });
  for (const [id, boundary] of [['preview-timing', 'cue'], ['preview-start', 'start'], ['preview-end', 'end']]) $(id).addEventListener('click', () => previewTiming(boundary));
  $('undo-edit').addEventListener('click', undoEdit);
  $('draft-versions').addEventListener('change', async event => { const index = Number(event.target.value); if (!await discardPendingText()) { event.target.value = String(state.version); return; } stopPlayback(); state.version = index; state.selected = currentDraft()?.candidates[0]?.id || null; state.editorPending = false; state.timingPending = false; renderDraft(); });
  $('download-json').addEventListener('click', () => download('json'));
  $('download-vtt').addEventListener('click', () => download('vtt'));
  for (const link of document.querySelectorAll('[data-leave]')) link.addEventListener('click', async event => {
    event.preventDefault();
    if (hasUnsaved() && !await confirmDiscard('此页有尚未下载完整 JSON 的内容。离开后，未下载的本页初稿与改文将丢失。')) return;
    state.versions.forEach(version => { version.downloaded = true; }); state.editorPending = false; state.timingPending = false;
    cancelOperation(false); location.assign(link.href);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopPlayback(); });
  window.addEventListener('beforeunload', event => { if (hasUnsaved()) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', event => { cancelOperation(false); stopPlayback(); if (!event.persisted && state.url) { player.removeAttribute('src'); player.load(); URL.revokeObjectURL(state.url); state.url = null; } });
  updateResources(); updateButtons();
}

if (typeof document !== 'undefined') setupWorkbench();
