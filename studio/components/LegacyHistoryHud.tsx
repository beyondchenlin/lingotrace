'use client';
import { useStudioLocale } from '../i18n/react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LegacyHistorySession } from '../core/legacy-history';
import { projectLegacyHistoryHud } from '../core/legacy-history-hud';
import { historyHudScene, type HistoryHudStyle } from '../core/legacy-history-hud-scene';
import { renderHudScene } from '../hud-library/renderer';
import type { HudMetric } from '../hud-library/schema';

function Chart({ metric, appearance, label }: { metric: HudMetric; appearance: HistoryHudStyle; label: string }) {
  const {t, ui, locale} = useStudioLocale();
  const box = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  useLayoutEffect(() => {
    const host = box.current, target = canvas.current;
    if (!host || !target) return;
    const paint = () => {
      try {
        const width = Math.max(270, Math.min(1600, Math.floor(host.getBoundingClientRect().width)));
        const dpr = Math.min(2, window.devicePixelRatio || 1), scene = historyHudScene(metric, appearance, width);
        target.width = Math.round(width * dpr); target.height = Math.round(scene.size.height * dpr);
        target.style.width = `${width}px`; target.style.height = `${scene.size.height}px`;
        const ctx = target.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const localizedScene = {...scene, nodes: scene.nodes.map(node => ({...node, label: ui(node.label), description: ui(node.description), ...('suffix' in node ? {suffix: ui(node.suffix)} : {})})), metrics: Object.fromEntries(Object.entries(scene.metrics).map(([key, value]) => [key, {...value, state: 'message' in value.state ? {...value.state, message: ui(value.state.message)} : value.state}]))};
        renderHudScene(ctx, localizedScene, { nowMs: metric.observedAtMs ?? 0, reducedMotion: true }, { clear: true });
        setError(false);
      } catch { setError(true); }
    };
    paint();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(paint) : null;
    observer?.observe(host); window.addEventListener('resize', paint);
    return () => { observer?.disconnect(); window.removeEventListener('resize', paint); };
  }, [metric, appearance, locale, ui]);
  return <div ref={box} style={{ width: '100%', minWidth: 0, overflowX: 'auto', background: '#101815', borderRadius: 10 }}>
    <canvas ref={canvas} role="img" aria-label={label} style={{ display: error ? 'none' : 'block' }}/>
    {error && <p className="notice warn" role="status">{t('historyHud.drawFailed')}</p>}
  </div>;
}

export default function LegacyHistoryHud({ session }: { session: LegacyHistorySession }) {
  const {t, ui, locale} = useStudioLocale();
  const result = useMemo(() => { try { return { data: projectLegacyHistoryHud(session), error: false }; } catch { return { data: null, error: true }; } }, [session]);
  const [progressStyle, setProgressStyle] = useState<'progress-ring' | 'progress-track'>('progress-ring');
  const [trendStyle, setTrendStyle] = useState<'trend-line' | 'trend-bars'>('trend-line');
  const [windowIndex, setWindowIndex] = useState(() => Math.max(0, result.data?.trends.findIndex(item => item.metric.points.some(point => point.value !== null)) ?? 0)), [pointPage, setPointPage] = useState(0);
  const data = result.data;
  const displayCoverage = (value: string) => {
    const match = /^原始点 (\d+)–(\d+) \/ (\d+)；([^；]*)；(.+)。窗口独立，不跨窗口连线；横轴从该窗口首个实点计秒。$/.exec(value);
    if (!match) return ui(value);
    const states = match[4].split('，').map(part => {
      const state = /^(已测|采样中|暂停|不可测) (\d+)$/.exec(part);
      return state ? `${ui(state[1])} ${state[2]}` : part;
    }).join(', ');
    return t('historyHud.coverage', {start: match[1], end: match[2], total: match[3], states, boundary: ui(match[5])});
  };
  if (!data) return <p className="notice warn" role="status">{t('historyHud.unavailable')}</p>;
  const window = data.trends[Math.min(windowIndex, data.trends.length - 1)];
  const points = window && data.timeline ? data.timeline.points.slice(window.sourcePointStart, window.sourcePointEnd) : [];
  const visiblePoints = points.slice(pointPage * 50, (pointPage + 1) * 50);
  const measured = points.filter(p => p.cpm !== null && p.state === 'measured');
  const percent = data.completion.numerator !== null && data.completion.denominator !== null && data.completion.denominator > 0 ? `${(100 * data.completion.numerator / data.completion.denominator).toFixed(1)}%` : t('historyHud.notApplicable');
  return <section aria-label={t('historyHud.heading')} data-projection-version={data.version} data-history-session={data.sessionId} data-history-sequence={data.sequence} style={{ minWidth: 0, overflowWrap: 'anywhere', marginBlock: 20 }}>
    <h2>{t('historyHud.heading')}</h2>
    <p className="note">{t('historyHud.scope')}</p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 270px), 1fr))', gap: 16 }}>
      <div>
        <h3>{t('resultCard.confirmedWords')}</h3>
        <Chart metric={data.words} appearance="numeric" label={t('historyHud.wordsLabel', {count: data.words.value ?? t('historyHud.notApplicable')})}/>
        <p data-hud-value="words">{t('historyHud.wordsValue', {count: data.words.value ?? t('historyHud.notApplicable')})}</p>
        <p className="note">{t('historyHud.wordScope')}</p>
      </div>
      <div>
        <label>{t('historyHud.progressStyle')} <select aria-label={t('historyHud.progressStyle')} value={progressStyle} onChange={event => setProgressStyle(event.target.value as typeof progressStyle)}><option value="progress-ring">{t('historyHud.ring')}</option><option value="progress-track">{t('historyHud.track')}</option></select></label>
        <Chart metric={data.completion} appearance={progressStyle} label={t('historyHud.completionLabel', {done: data.completion.numerator ?? t('historyHud.notApplicable'), total: data.completion.denominator ?? t('historyHud.notApplicable'), percent})}/>
        <p data-hud-value="completion">{t('historyHud.completionValue', {done: data.completion.numerator ?? t('historyHud.notApplicable'), total: data.completion.denominator ?? t('historyHud.notApplicable'), percent})}</p>
        <p className="note">{t('historyHud.denominatorEvidence', {id: data.material.id, version: data.material.version})}</p>
      </div>
    </div>
    <h3>{t('historyHud.inputRate')}</h3>
    <p className="note">{t('historyHud.inputRateScope')}</p>
    {window ? <>
      <div className="button-row">
        <label>{t('historyHud.rateStyle')} <select aria-label={t('historyHud.rateStyle')} value={trendStyle} onChange={event => setTrendStyle(event.target.value as typeof trendStyle)}><option value="trend-line">{t('historyHud.line')}</option><option value="trend-bars">{t('historyHud.bars')}</option></select></label>
        <label>{t('historyHud.window')} <select aria-label={t('historyHud.window')} value={Math.min(windowIndex, data.trends.length - 1)} onChange={event => { setWindowIndex(Number(event.target.value)); setPointPage(0); }}>{data.trends.map((item, index) => <option value={index} key={item.id}>{t('historyHud.windowLabel', {number: index + 1})}</option>)}</select></label>
      </div>
      <Chart metric={window.metric} appearance={trendStyle} label={t('historyHud.rateLabel', {version: window.metricVersion, count: measured.length})}/>
      <p data-hud-value="rate-window">{window.metricVersion} · {displayCoverage(window.coverage)}</p>
      <p className="note">{t('historyHud.axisScope', {date: new Date(window.originWallTimeMs).toLocaleString(locale), measured: measured.length, total: points.length})}</p>
      {!measured.length && <p role="status">{t('historyHud.noMeasurements')}</p>}
      <details><summary>{t('historyHud.originalValues')}</summary>
        <p className="note">{t('historyHud.valuesScope')}</p>
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>{t('historyHud.time')}</th><th>{t('historyHud.cpm')}</th><th>{t('historyHud.coverageState')}</th><th>{t('historyHud.sourceEvent')}</th></tr></thead><tbody>{visiblePoints.map(point => <tr key={point.eventId}><td>{new Date(point.wallTimeMs).toLocaleTimeString(locale)}</td><td>{point.cpm === null ? t('historyHud.null') : point.cpm}</td><td>{{ measured: t('historyHud.measured'), sampling: t('historyHud.sampling'), frozen: t('historyHud.frozen'), unavailable: t('historyHud.unmeasurable') }[point.state]}</td><td style={{ maxWidth: 260, overflowWrap: 'anywhere' }}>{point.eventId}</td></tr>)}</tbody></table></div>
        <div className="button-row"><button disabled={pointPage === 0} onClick={() => setPointPage(p => p - 1)}>{t('historyHud.previousValues')}</button><span>{t('historyHud.page', {page: pointPage + 1})}</span><button disabled={(pointPage + 1) * 50 >= points.length} onClick={() => setPointPage(p => p + 1)}>{t('historyHud.nextValues')}</button></div>
      </details>
    </> : <p className="empty">{t('historyHud.noData')}</p>}
    <details><summary>{t('historyHud.versions')}</summary><p className="note">{t('historyHud.sourceVersion', {version: data.version, source: data.source, session: data.sessionId, sequence: data.sequence})}</p><ul>{data.limitations.map(text => <li key={text}>{ui(text)}</li>)}</ul><p className="note">{t('historyHud.partialScope')}</p></details>
  </section>;
}
