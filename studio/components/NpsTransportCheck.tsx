'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { NPS_COURSE_MEDIA, NPS_MATERIAL } from '../core/builtin-material';
import {
  createOriginalCourseMediaPool, isVerifiedCourseMediaLease,
  type OriginalCourseMediaLease, type OriginalCourseMediaPool,
} from '../media/context-bookmark-media';
import { NPS_PLAYBACK_MEDIA } from '../media/nps-playback';
import { reviewMediaDiagnostic, reviewRangeDiagnostic } from '../media/media-load-diagnostic';

type Phase = 'idle' | 'verifying' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'stopped' | 'error';
export type NpsTransportCheckState = Readonly<{
  phase: Phase; source: string; currentSrc: string; actualSha256: string;
  duration: number | null; width: number; height: number; currentTime: number;
  error: string; nativeError: string; canvasResult: string; frameDataUrl: string;
}>;
const EMPTY: NpsTransportCheckState = {
  phase: 'idle', source: '', currentSrc: '', actualSha256: '', duration: null,
  width: 0, height: 0, currentTime: 0, error: '', nativeError: '', canvasResult: '', frameDataUrl: '',
};
const labels: Record<Phase, string> = {
  idle: '尚未加载', verifying: '核验固定资源字节', loading: '等待原生视频元数据', ready: '元数据已核验，等待手动播放',
  playing: '正在播放', paused: '已暂停', ended: '播放结束', stopped: '已停止并释放', error: '检查失败',
};
const readableError = (error: unknown) => error instanceof Error ? error.message : '视频检查失败，请手动重试。';
const cueStart = Math.min(...NPS_MATERIAL.cues.map(cue => cue.start));
const cueEnd = Math.max(...NPS_MATERIAL.cues.map(cue => cue.end));

/** Isolated diagnostic controller. It never creates a Training engine or persistent store. */
export function createNpsTransportCheckController(options: {
  video: HTMLVideoElement; canvas: HTMLCanvasElement; pool: OriginalCourseMediaPool;
  changed: (state: NpsTransportCheckState) => void;
  origin?: string; documentTarget?: EventTarget; windowTarget?: EventTarget; isHidden?: () => boolean;
}) {
  const { video, canvas, pool } = options;
  const origin = options.origin ?? window.location.origin;
  const expectedSrc = new URL(NPS_PLAYBACK_MEDIA.playbackVariant.url, origin).href;
  const documentTarget = options.documentTarget ?? document;
  const windowTarget = options.windowTarget ?? window;
  const isHidden = options.isHidden ?? (() => document.hidden);
  type Attempt = { epoch: number; abort: AbortController; lease: OriginalCourseMediaLease | null;
    ready: boolean; cleanup: () => void };
  let state: NpsTransportCheckState = EMPTY;
  let disposed = false, epoch = 0, active: Attempt | null = null;
  const publish = (patch: Partial<NpsTransportCheckState>) => {
    state = { ...state, ...patch };
    if (!disposed) options.changed(state);
  };
  const current = (attempt: Attempt) => !disposed && !isHidden() && active === attempt && epoch === attempt.epoch && !attempt.abort.signal.aborted;
  const verified = (attempt: Attempt) => current(attempt) &&
    isVerifiedCourseMediaLease(attempt.lease, NPS_PLAYBACK_MEDIA, origin) &&
    attempt.lease?.transport === 'verified-direct' && attempt.lease.url === expectedSrc;
  const sourceMatches = (attempt: Attempt, allowUnselected = false) => verified(attempt) && video.src === expectedSrc &&
    (video.currentSrc === expectedSrc || (allowUnselected && !video.currentSrc));
  const eraseFrame = () => {
    // Assigning dimensions also resets a potentially tainted canvas.
    canvas.width = 1; canvas.height = 1;
  };
  const release = () => {
    ++epoch;
    const previous = active; active = null;
    previous?.cleanup();
    // Stop the element before releasing the capability; a direct URL is not revocable.
    video.pause(); video.controls = false; video.removeAttribute('src'); video.load();
    previous?.abort.abort(); previous?.lease?.release();
    eraseFrame();
  };
  const stop = () => {
    if (disposed) return;
    release();
    publish({ phase: 'stopped', currentSrc: '', canvasResult: '', frameDataUrl: '' });
  };
  const fail = (attempt: Attempt, error: unknown, nativeError = '') => {
    if (!current(attempt)) return;
    const selected = video.currentSrc;
    release();
    publish({ phase: 'error', currentSrc: selected, error: readableError(error), nativeError,
      canvasResult: '', frameDataUrl: '' });
  };
  const hasDuration = () => Number.isFinite(video.duration) && video.duration > 0;
  const rangeDiagnostic = () => reviewRangeDiagnostic(video.duration, cueStart, cueEnd, 'verified-direct', video.readyState);
  const metadataMatches = () => !video.error && video.readyState >= 1 && hasDuration() &&
    Math.abs(video.duration - NPS_COURSE_MEDIA.durationSeconds) <= 0.001 &&
    NPS_MATERIAL.cues.every(cue => cue.start >= 0 && cue.start < cue.end && cue.end <= video.duration) &&
    video.videoWidth > 0 && video.videoHeight > 0;
  const ready = () => {
    const attempt = active;
    if (!attempt || !attempt.ready) return null;
    if (!sourceMatches(attempt) || !metadataMatches()) {
      fail(attempt, new Error(`原生视频来源或时长已改变，已停止。 ${rangeDiagnostic()}`));
      return null;
    }
    return attempt;
  };
  async function load() {
    if (disposed || isHidden()) return;
    release();
    const attempt: Attempt = { epoch, abort: new AbortController(), lease: null, ready: false, cleanup() {} };
    active = attempt;
    publish({ ...EMPTY, phase: 'verifying' });
    try {
      const acquired = await pool.acquire({ signal: attempt.abort.signal, retry: true });
      if (!current(attempt)) { acquired.release(); return; }
      attempt.lease = acquired;
      publish({ actualSha256: acquired.actualSha256 ?? '' });
      if (!isVerifiedCourseMediaLease(acquired, NPS_PLAYBACK_MEDIA, origin) || !acquired.toVerifiedDirect) {
        throw new Error(acquired.verificationError || '固定资源没有通过同源 URL、类型与 SHA-256 核验。');
      }
      // Conversion keeps the same holder. Releasing acquired here would invalidate direct.
      attempt.lease = acquired.toVerifiedDirect();
      if (!verified(attempt)) throw new Error('同源直接播放凭据无效。');
      const deadline = Date.now() + 20000;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const events: [string, EventListener][] = [];
      const listen = (name: string, listener: EventListener) => { events.push([name, listener]); video.addEventListener(name, listener); };
      attempt.cleanup = () => {
        if (timeout !== null) clearTimeout(timeout);
        for (const [name, listener] of events) video.removeEventListener(name, listener);
      };
      const nativeFailure = () => {
        const diagnostic = reviewMediaDiagnostic('metadata', video);
        fail(attempt, new Error(`原生视频加载或解码失败。 ${diagnostic} ${rangeDiagnostic()}`), diagnostic);
      };
      const metadataTimeout = () => {
        if (!current(attempt)) return;
        if (sourceMatches(attempt, true) && video.error) { nativeFailure(); return; }
        const reason = !sourceMatches(attempt, true) ? '原生视频来源不符。'
          : !hasDuration() ? '等待原生时长超时，时长尚未取得，请手动重试。'
          : video.readyState < 1 ? '等待原生元数据超时，元数据尚未就绪，请手动重试。'
          : !metadataMatches() ? '原生视频时长、画面尺寸或片段范围不符。'
          : '等待原生元数据超时，请手动重试。';
        fail(attempt, new Error(`${reason} ${rangeDiagnostic()}`));
      };
      const metadata = () => {
        if (!current(attempt)) return;
        if (!sourceMatches(attempt)) {
          fail(attempt, new Error(`原生视频来源不符。 ${rangeDiagnostic()}`));
          return;
        }
        if (video.error) { nativeFailure(); return; }
        if (!attempt.ready && Date.now() >= deadline) { metadataTimeout(); return; }
        // Native metadata can arrive before a finite duration. Keep the original
        // deadline while waiting; once ready, every metadata change fails closed.
        if (!attempt.ready && (video.readyState < 1 || !hasDuration())) return;
        if (!metadataMatches()) {
          fail(attempt, new Error(`原生视频时长、画面尺寸或片段范围不符。 ${rangeDiagnostic()}`));
          return;
        }
        if (attempt.ready) return;
        if (timeout !== null) { clearTimeout(timeout); timeout = null; }
        attempt.ready = true; video.controls = true;
        publish({ phase: 'ready', currentSrc: video.currentSrc, duration: video.duration,
          width: video.videoWidth, height: video.videoHeight, currentTime: video.currentTime });
      };
      for (const event of ['loadedmetadata', 'durationchange', 'loadeddata', 'canplay']) listen(event, metadata);
      listen('error', () => {
        if (!current(attempt)) return;
        if (!sourceMatches(attempt, true)) { fail(attempt, new Error('原生视频选择了不匹配的来源。')); return; }
        const error = video.error;
        fail(attempt, new Error('原生视频加载或解码失败。'), error ? `code=${error.code}; ${error.message || '(无原生消息)'}` : '(未提供 MediaError)');
      });
      listen('play', () => {
        if (!current(attempt)) return;
        if (!attempt.ready || !sourceMatches(attempt) || !metadataMatches()) {
          video.pause(); fail(attempt, new Error(`播放前的来源或元数据核验失败。 ${rangeDiagnostic()}`));
        }
      });
      listen('playing', () => { if (current(attempt) && ready() === attempt) publish({ phase: 'playing', error: '' }); });
      listen('pause', () => { if (current(attempt) && attempt.ready) publish({ phase: 'paused' }); });
      listen('ended', () => { if (current(attempt) && ready() === attempt) publish({ phase: 'ended' }); });
      listen('timeupdate', () => {
        if (!current(attempt) || !attempt.ready) return;
        if (!sourceMatches(attempt) || !metadataMatches() || !Number.isFinite(video.currentTime) || video.currentTime < 0 || video.currentTime > video.duration + 0.001) {
          fail(attempt, new Error(`播放位置、时长或来源不符。 ${rangeDiagnostic()}`)); return;
        }
        publish({ currentSrc: video.currentSrc, currentTime: video.currentTime });
      });
      listen('seeking', () => {
        if (current(attempt)) { eraseFrame(); publish({ canvasResult: '', frameDataUrl: '' }); }
      });
      video.crossOrigin = 'anonymous'; video.playsInline = true; video.preload = 'metadata';
      video.autoplay = false; video.defaultMuted = true; video.muted = true; video.controls = false;
      publish({ phase: 'loading', source: expectedSrc });
      video.src = attempt.lease.url;
      timeout = setTimeout(metadataTimeout, 20000);
      video.load();
    } catch (error) { fail(attempt, error); }
  }
  async function play() {
    const attempt = ready();
    if (!attempt) return;
    try {
      await video.play();
      // A stale promise cannot update, retry, or restart any later attempt.
      if (current(attempt) && ready() === attempt) publish({ phase: video.paused ? 'paused' : 'playing', error: '' });
    } catch (error) { if (current(attempt)) publish({ error: readableError(error) }); }
  }
  function seek(index: 0 | 1 | -1) {
    const attempt = ready();
    if (!attempt) return;
    const cue = NPS_MATERIAL.cues[index === -1 ? NPS_MATERIAL.cues.length - 1 : index];
    if (!cue || cue.start < 0 || cue.end > video.duration) { fail(attempt, new Error('定位超出已核验时长。')); return; }
    video.pause(); eraseFrame();
    try { video.currentTime = cue.start; publish({ phase: 'paused', currentTime: video.currentTime, canvasResult: '', frameDataUrl: '', error: '' }); }
    catch (error) { fail(attempt, error); }
  }
  function checkCanvas() {
    const attempt = ready();
    if (!attempt) return;
    if (video.readyState < 2 || video.seeking) { publish({ canvasResult: '当前帧尚未解码，请播放或等待定位完成后重试。', frameDataUrl: '' }); return; }
    try {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器未提供 2D 画布。');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const frameDataUrl = canvas.toDataURL('image/png');
      if (!frameDataUrl.startsWith('data:image/png;') || pixels.data.length !== canvas.width * canvas.height * 4) throw new Error('画布读取结果不完整。');
      publish({ canvasResult: `画布读取成功：${canvas.width} × ${canvas.height}，${video.currentTime.toFixed(3)} 秒；像素读取与 PNG 编码均完成。`, frameDataUrl });
    } catch (error) { eraseFrame(); publish({ canvasResult: `画布读取失败：${readableError(error)}`, frameDataUrl: '' }); }
  }
  const hidden = () => { if (isHidden()) stop(); };
  const pagehide = () => stop();
  documentTarget.addEventListener('visibilitychange', hidden);
  windowTarget.addEventListener('pagehide', pagehide);
  return {
    load, stop, play, seek, checkCanvas,
    pause() { if (ready()) video.pause(); },
    getState() { return state; },
    dispose() {
      if (disposed) return;
      disposed = true; release();
      documentTarget.removeEventListener('visibilitychange', hidden);
      windowTarget.removeEventListener('pagehide', pagehide);
    },
  };
}

const button: CSSProperties = { padding: '10px 14px', minHeight: 44, borderRadius: 8, border: '1px solid #8fa3bd', font: 'inherit', cursor: 'pointer' };
const row: CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap', margin: '16px 0' };
const value: CSSProperties = { margin: 0, overflowWrap: 'anywhere' };

export default function NpsTransportCheck() {
  const video = useRef<HTMLVideoElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<ReturnType<typeof createNpsTransportCheckController> | null>(null);
  const [pool] = useState(() => createOriginalCourseMediaPool({}, NPS_PLAYBACK_MEDIA));
  const [state, setState] = useState<NpsTransportCheckState>(EMPTY);
  useEffect(() => {
    if (!video.current || !canvas.current) return;
    const current = createNpsTransportCheckController({ video: video.current, canvas: canvas.current, pool, changed: setState });
    controller.current = current;
    return () => { current.dispose(); if (controller.current === current) controller.current = null; };
  }, [pool]);
  const busy = state.phase === 'verifying' || state.phase === 'loading';
  const ready = ['ready', 'playing', 'paused', 'ended'].includes(state.phase);
  return <main style={{ maxWidth: 960, margin: '24px auto', padding: 20, fontFamily: 'system-ui, sans-serif', color: '#182b42', lineHeight: 1.6 }}>
    <h1 style={{ fontSize: 26, margin: '0 0 8px' }}>同源视频传输检查</h1>
    <p>仅验证同源直接播放与画布，不产生学习记录。</p>
    <p>只加载固定的 NPS 兼容视频。先核验下载字节的 SHA-256，再由原生视频请求同一同源地址。第二次响应不由画布或 SHA-256 重新核验，依赖该内容寻址资源保持不变。</p>
    <p>本页不复现 AAC 错误，也不代表 Android 已验收。默认静音，不自动播放；需要听声音时，请手动打开视频音量。</p>
    <div style={row}>
      <button style={button} onClick={() => void controller.current?.load()} disabled={busy}>核验并加载同源兼容视频</button>
      <button style={button} onClick={() => controller.current?.stop()} disabled={state.phase === 'idle' || state.phase === 'stopped'}>停止并释放</button>
    </div>
    <p role="status" aria-live="polite">阶段：{labels[state.phase]}</p>
    {state.error && <p role="alert" style={{ color: '#a62620' }}>{state.error}</p>}
    <video ref={video} crossOrigin="anonymous" playsInline preload="metadata" muted
      aria-label="已核验的固定 NPS 同源视频" style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', background: '#0b1523', objectFit: 'contain', borderRadius: 12 }} />
    <div style={row}>
      <button style={button} disabled={!ready} onClick={() => void controller.current?.play()}>播放</button>
      <button style={button} disabled={!ready} onClick={() => controller.current?.pause()}>暂停</button>
      <button style={button} disabled={!ready} onClick={() => controller.current?.seek(0)}>定位第一句</button>
      <button style={button} disabled={!ready} onClick={() => controller.current?.seek(1)}>定位第二句</button>
      <button style={button} disabled={!ready} onClick={() => controller.current?.seek(-1)}>定位末句</button>
      <button style={button} disabled={!ready} onClick={() => controller.current?.checkCanvas()}>检查画布</button>
    </div>
    <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(96px, 120px) minmax(0, 1fr)', gap: '8px 16px', fontSize: 14 }}>
      <dt>传输</dt><dd style={value}>同源 HTTPS 直接播放；手动核验后启用</dd>
      <dt>固定资源</dt><dd style={value}>{NPS_PLAYBACK_MEDIA.playbackVariant.url}</dd>
      <dt>请求地址</dt><dd style={value}>{state.source || '未加载'}</dd>
      <dt>原生 currentSrc</dt><dd style={value}>{state.currentSrc || '尚未选择资源'}</dd>
      <dt>预期播放 SHA-256</dt><dd style={value}>{NPS_PLAYBACK_MEDIA.playbackVariant.mediaSha256}</dd>
      <dt>实测下载 SHA-256</dt><dd style={value}>{state.actualSha256 || '尚未核验'}</dd>
      <dt>原素材 SHA-256</dt><dd style={value}>{NPS_COURSE_MEDIA.mediaSha256}</dd>
      <dt>元数据</dt><dd style={value}>{state.duration === null ? '尚未取得' : `${state.duration.toFixed(6)} 秒；${state.width} × ${state.height}`}</dd>
      <dt>当前时间</dt><dd style={value}>{state.currentTime.toFixed(3)} 秒</dd>
      <dt>原生错误</dt><dd style={value}>{state.nativeError || '无已报告错误'}</dd>
    </dl>
    <p role="status">{state.canvasResult || '点击“检查画布”读取当前视频帧。'}</p>
    <canvas ref={canvas} width={1} height={1} aria-label="当前原生视频帧的画布读回结果"
      style={{ display: state.frameDataUrl ? 'block' : 'none', width: '100%', height: 'auto', borderRadius: 12, background: '#0b1523' }} />
    {state.frameDataUrl && <p><a href={state.frameDataUrl} download="nps-same-origin-frame.png">下载已读取的 PNG 帧</a></p>}
    <p style={{ fontSize: 13, color: '#50647d' }}>离开或隐藏本页会停止播放、取消请求并释放凭据。返回后需手动重新核验。本页不请求摄像头、麦克风或录屏权限。</p>
  </main>;
}
