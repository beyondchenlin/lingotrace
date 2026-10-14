'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { StudioLocaleProvider, useStudioLocale } from '../i18n/react';
import { translate, type MessageKey, type MessageParams } from '../i18n/locale';
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
type TransportT = (key: MessageKey, params?: MessageParams) => string;
const defaultT: TransportT = (key, params) => translate('zh-CN', key, params);
const cueStart = Math.min(...NPS_MATERIAL.cues.map(cue => cue.start));
const cueEnd = Math.max(...NPS_MATERIAL.cues.map(cue => cue.end));

/** Isolated diagnostic controller. It never creates a Training engine or persistent store. */
export function createNpsTransportCheckController(options: {
  video: HTMLVideoElement; canvas: HTMLCanvasElement; pool: OriginalCourseMediaPool;
  changed: (state: NpsTransportCheckState) => void;
  origin?: string; documentTarget?: EventTarget; windowTarget?: EventTarget; isHidden?: () => boolean;
  t?: TransportT;
}) {
  const { video, canvas, pool } = options;
  const t = options.t ?? defaultT;
  const readableError = (error: unknown) => error instanceof Error ? error.message : t('npsTransport.errFallback');
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
      fail(attempt, new Error(t('npsTransport.errSourceOrDurationChanged', {details: rangeDiagnostic()})));
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
        throw new Error(acquired.verificationError || t('npsTransport.errVerifySha'));
      }
      // Conversion keeps the same holder. Releasing acquired here would invalidate direct.
      attempt.lease = acquired.toVerifiedDirect();
      if (!verified(attempt)) throw new Error(t('npsTransport.errDirectCreds'));
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
        fail(attempt, new Error(t('npsTransport.errNativeDecodeDetails', {details: `${diagnostic} ${rangeDiagnostic()}`})), diagnostic);
      };
      const metadataTimeout = () => {
        if (!current(attempt)) return;
        if (sourceMatches(attempt, true) && video.error) { nativeFailure(); return; }
        if (!sourceMatches(attempt, true)) {
          fail(attempt, new Error(t('npsTransport.errSourceMismatchDetails', {details: rangeDiagnostic()})));
        } else if (!hasDuration()) {
          fail(attempt, new Error(`${t('npsTransport.errDurationTimeout')} ${rangeDiagnostic()}`));
        } else if (video.readyState < 1) {
          fail(attempt, new Error(`${t('npsTransport.errMetadataTimeoutReady')} ${rangeDiagnostic()}`));
        } else if (!metadataMatches()) {
          fail(attempt, new Error(t('npsTransport.errMetadataMismatchDetails', {details: rangeDiagnostic()})));
        } else {
          fail(attempt, new Error(`${t('npsTransport.errMetadataTimeout')} ${rangeDiagnostic()}`));
        }
      };
      const metadata = () => {
        if (!current(attempt)) return;
        if (!sourceMatches(attempt)) {
          fail(attempt, new Error(t('npsTransport.errSourceMismatchDetails', {details: rangeDiagnostic()})));
          return;
        }
        if (video.error) { nativeFailure(); return; }
        if (!attempt.ready && Date.now() >= deadline) { metadataTimeout(); return; }
        // Native metadata can arrive before a finite duration. Keep the original
        // deadline while waiting; once ready, every metadata change fails closed.
        if (!attempt.ready && (video.readyState < 1 || !hasDuration())) return;
        if (!metadataMatches()) {
          fail(attempt, new Error(t('npsTransport.errMetadataMismatchDetails', {details: rangeDiagnostic()})));
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
        if (!sourceMatches(attempt, true)) { fail(attempt, new Error(t('npsTransport.errSourceMismatch'))); return; }
        const error = video.error;
        fail(attempt, new Error(t('npsTransport.errNativeDecode')), error ? t('npsTransport.nativeErrorCode', {code: String(error.code), message: error.message || t('npsTransport.noNativeMessage')}) : t('npsTransport.noMediaError'));
      });
      listen('play', () => {
        if (!current(attempt)) return;
        if (!attempt.ready || !sourceMatches(attempt) || !metadataMatches()) {
          video.pause(); fail(attempt, new Error(t('npsTransport.errPreplayVerify', {details: rangeDiagnostic()})));
        }
      });
      listen('playing', () => { if (current(attempt) && ready() === attempt) publish({ phase: 'playing', error: '' }); });
      listen('pause', () => { if (current(attempt) && attempt.ready) publish({ phase: 'paused' }); });
      listen('ended', () => { if (current(attempt) && ready() === attempt) publish({ phase: 'ended' }); });
      listen('timeupdate', () => {
        if (!current(attempt) || !attempt.ready) return;
        if (!sourceMatches(attempt) || !metadataMatches() || !Number.isFinite(video.currentTime) || video.currentTime < 0 || video.currentTime > video.duration + 0.001) {
          fail(attempt, new Error(t('npsTransport.errPlaybackPosition', {details: rangeDiagnostic()}))); return;
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
    if (!cue || cue.start < 0 || cue.end > video.duration) { fail(attempt, new Error(t('npsTransport.errSeekOutOfRange'))); return; }
    video.pause(); eraseFrame();
    try { video.currentTime = cue.start; publish({ phase: 'paused', currentTime: video.currentTime, canvasResult: '', frameDataUrl: '', error: '' }); }
    catch (error) { fail(attempt, error); }
  }
  function checkCanvas() {
    const attempt = ready();
    if (!attempt) return;
    if (video.readyState < 2 || video.seeking) { publish({ canvasResult: t('npsTransport.canvasNotDecoded'), frameDataUrl: '' }); return; }
    try {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error(t('npsTransport.errNo2dCanvas'));
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const frameDataUrl = canvas.toDataURL('image/png');
      if (!frameDataUrl.startsWith('data:image/png;') || pixels.data.length !== canvas.width * canvas.height * 4) throw new Error(t('npsTransport.errCanvasIncomplete'));
      publish({ canvasResult: t('npsTransport.canvasSuccess', {width: canvas.width, height: canvas.height, time: video.currentTime.toFixed(3)}), frameDataUrl });
    } catch (error) { eraseFrame(); publish({ canvasResult: t('npsTransport.canvasFail', {details: readableError(error)}), frameDataUrl: '' }); }
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

const PHASE_KEYS = {
  idle: 'npsTransport.phaseIdle', verifying: 'npsTransport.phaseVerifying', loading: 'npsTransport.phaseLoading',
  ready: 'npsTransport.phaseReady', playing: 'npsTransport.phasePlaying', paused: 'npsTransport.phasePaused',
  ended: 'npsTransport.phaseEnded', stopped: 'npsTransport.phaseStopped', error: 'npsTransport.phaseError',
} as const;

function NpsTransportCheckInner() {
  const {t, ui} = useStudioLocale();
  const video = useRef<HTMLVideoElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<ReturnType<typeof createNpsTransportCheckController> | null>(null);
  const [pool] = useState(() => createOriginalCourseMediaPool({}, NPS_PLAYBACK_MEDIA));
  const [state, setState] = useState<NpsTransportCheckState>(EMPTY);
  useEffect(() => {
    if (!video.current || !canvas.current) return;
    const current = createNpsTransportCheckController({ video: video.current, canvas: canvas.current, pool, changed: setState, t });
    controller.current = current;
    return () => { current.dispose(); if (controller.current === current) controller.current = null; };
  }, [pool, t]);
  const busy = state.phase === 'verifying' || state.phase === 'loading';
  const ready = ['ready', 'playing', 'paused', 'ended'].includes(state.phase);
  const phaseText = t(PHASE_KEYS[state.phase]);
  const metadataText = state.duration === null
    ? t('npsTransport.metaPending')
    : t('npsTransport.metaReady', {duration: state.duration.toFixed(6), width: state.width, height: state.height});
  return <main style={{ maxWidth: 960, margin: '24px auto', padding: 20, fontFamily: 'system-ui, sans-serif', color: '#182b42', lineHeight: 1.6 }}>
    <h1 style={{ fontSize: 26, margin: '0 0 8px' }}>{t('npsTransport.title')}</h1>
    <p>{t('npsTransport.lede')}</p>
    <p>{t('npsTransport.shaNote')}</p>
    <p>{t('npsTransport.androidNote')}</p>
    <div style={row}>
      <button style={button} onClick={() => void controller.current?.load()} disabled={busy}>{t('npsTransport.load')}</button>
      <button style={button} onClick={() => controller.current?.stop()} disabled={state.phase === 'idle' || state.phase === 'stopped'}>{t('npsTransport.stop')}</button>
    </div>
    <p role="status" aria-live="polite">{t('npsTransport.phaseLabel', {phase: phaseText})}</p>
    {state.error && <p role="alert" style={{ color: '#a62620' }}>{ui(state.error)}</p>}
    <video ref={video} crossOrigin="anonymous" playsInline preload="metadata" muted
      aria-label={t('npsTransport.videoAria')} style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', background: '#0b1523', objectFit: 'contain', borderRadius: 12 }} />
    <div style={row}>
      <button style={button} disabled={!ready} onClick={() => void controller.current?.play()}>{t('npsTransport.play')}</button>
      <button style={button} disabled={!ready} onClick={() => controller.current?.pause()}>{t('npsTransport.pause')}</button>
      <button style={button} disabled={!ready} onClick={() => controller.current?.seek(0)}>{t('npsTransport.seekFirst')}</button>
      <button style={button} disabled={!ready} onClick={() => controller.current?.seek(1)}>{t('npsTransport.seekSecond')}</button>
      <button style={button} disabled={!ready} onClick={() => controller.current?.seek(-1)}>{t('npsTransport.seekLast')}</button>
      <button style={button} disabled={!ready} onClick={() => controller.current?.checkCanvas()}>{t('npsTransport.checkCanvas')}</button>
    </div>
    <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(96px, 120px) minmax(0, 1fr)', gap: '8px 16px', fontSize: 14 }}>
      <dt>{t('npsTransport.dtTransport')}</dt><dd style={value}>{t('npsTransport.ddTransport')}</dd>
      <dt>{t('npsTransport.dtFixed')}</dt><dd style={value}>{NPS_PLAYBACK_MEDIA.playbackVariant.url}</dd>
      <dt>{t('npsTransport.dtRequest')}</dt><dd style={value}>{state.source || t('npsTransport.notLoaded')}</dd>
      <dt>{t('npsTransport.dtCurrentSrc')}</dt><dd style={value}>{state.currentSrc || t('npsTransport.noSrcYet')}</dd>
      <dt>{t('npsTransport.dtExpectedSha')}</dt><dd style={value}>{NPS_PLAYBACK_MEDIA.playbackVariant.mediaSha256}</dd>
      <dt>{t('npsTransport.dtActualSha')}</dt><dd style={value}>{state.actualSha256 || t('npsTransport.notVerifiedYet')}</dd>
      <dt>{t('npsTransport.dtSourceSha')}</dt><dd style={value}>{NPS_COURSE_MEDIA.mediaSha256}</dd>
      <dt>{t('npsTransport.dtMetadata')}</dt><dd style={value}>{metadataText}</dd>
      <dt>{t('npsTransport.dtTime')}</dt><dd style={value}>{t('npsTransport.timeSeconds', {time: state.currentTime.toFixed(3)})}</dd>
      <dt>{t('npsTransport.dtNativeError')}</dt><dd style={value}>{ui(state.nativeError) || t('npsTransport.noNativeError')}</dd>
    </dl>
    <p role="status">{state.canvasResult ? ui(state.canvasResult) : t('npsTransport.canvasHint')}</p>
    <canvas ref={canvas} width={1} height={1} aria-label={t('npsTransport.canvasAria')}
      style={{ display: state.frameDataUrl ? 'block' : 'none', width: '100%', height: 'auto', borderRadius: 12, background: '#0b1523' }} />
    {state.frameDataUrl && <p><a href={state.frameDataUrl} download="nps-same-origin-frame.png">{t('npsTransport.downloadFrame')}</a></p>}
    <p style={{ fontSize: 13, color: '#50647d' }}>{t('npsTransport.leaveNote')}</p>
  </main>;
}

export default function NpsTransportCheck() {
  return <StudioLocaleProvider><NpsTransportCheckInner /></StudioLocaleProvider>;
}
