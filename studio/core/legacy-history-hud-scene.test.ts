import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { TrainingEngine } from './training';
import { readLegacyHistoryRecord } from './legacy-history';
import { projectLegacyHistoryHud } from './legacy-history-hud';
import { historyHudScene, type HistoryHudStyle } from './legacy-history-hud-scene';
import { renderHudScene } from '../hud-library/renderer';
import { validateScene } from '../hud-library/validate';
import type { HudMetric } from '../hud-library/schema';

function retained() {
  let now = 0, id = 0;
  const engine = new TrainingEngine({ sessionId: 'hud-render-actual-engine', clock: { now: () => now, wallTime: () => new Date(1760000000000 + now).toISOString(), id: () => `real-event-${++id}` }, inputObservation: { runId: 'render-test' } });
  engine.input('a', 'typed', { version: 'dom-edit-v1', kind: 'input', inputType: 'insertText', data: 'a' });
  for (let i = 0; i < 7; i++) { now += 1000; engine.sampleClock(); engine.input(engine.draft + 'a', 'typed', { version: 'dom-edit-v1', kind: 'input', inputType: 'insertText', data: 'a' }); }
  const snapshot = engine.getSnapshot();
  return readLegacyHistoryRecord({ sessionId: snapshot.sessionId, sequence: snapshot.sequence, snapshot, updatedAt: new Date(1760000000000 + now).toISOString() });
}

test('all history appearances bind exactly the supplied metric and render at narrow and wide widths', () => {
  const session = retained(), before = JSON.stringify(session), projection = projectLegacyHistoryHud(session);
  const entries: [HudMetric, HistoryHudStyle[]][] = [[projection.words, ['numeric']], [projection.completion, ['progress-ring', 'progress-track']], ...projection.trends.map(item => [item.metric, ['trend-line', 'trend-bars']] as [HudMetric, HistoryHudStyle[]])];
  for (const [metric, styles] of entries) for (const style of styles) for (const width of [270, 432, 900]) {
    const scene = historyHudScene(metric, style as HistoryHudStyle, width), clock = { nowMs: metric.observedAtMs ?? 0, reducedMotion: true };
    assert.equal(scene.metrics[metric.metricId], metric); assert.deepEqual(validateScene(scene, clock), []);
    const canvas = createCanvas(width, 260), output = renderHudScene(canvas.getContext('2d') as unknown as CanvasRenderingContext2D, scene, clock, { clear: true });
    assert.equal(output.length, 1); assert.equal(output[0].rect.width, width); assert.ok(!output[0].accessibleText.includes('Fixture'));
  }
  assert.equal(JSON.stringify(session), before);
});

test('style switching preserves exact numerator, denominator, all rates, nulls and IDs', () => {
  const projection = projectLegacyHistoryHud(retained());
  const pairs: [HudMetric, HistoryHudStyle, HistoryHudStyle][] = [[projection.completion, 'progress-ring', 'progress-track'], ...projection.trends.map(item => [item.metric, 'trend-line', 'trend-bars'] as [HudMetric, HistoryHudStyle, HistoryHudStyle])];
  for (const pair of pairs) {
    const [metric, first, second] = pair;
    const a = historyHudScene(metric, first as HistoryHudStyle, 480), b = historyHudScene(metric, second as HistoryHudStyle, 480);
    assert.equal(a.metrics[metric.metricId], b.metrics[metric.metricId]);
    assert.deepEqual(a.nodes[0].metricBinding, b.nodes[0].metricBinding);
  }
});

test('incompatible style or non-history source is rejected rather than inventing a percentage', () => {
  const metric = projectLegacyHistoryHud(retained()).words;
  assert.throws(() => historyHudScene(metric, 'progress-ring', 480), /kind/);
  assert.throws(() => historyHudScene({ ...metric, source: 'fixture' }, 'numeric', 480), /retained/);
  for (const width of [0, 269, NaN, Infinity, 20000]) assert.throws(() => historyHudScene(metric, 'numeric', width));
});
