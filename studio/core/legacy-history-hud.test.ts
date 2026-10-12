import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { TrainingEngine, CAFE_MATERIAL, replay, type Material, type TrainingSnapshot } from './training';
import { readLegacyHistoryRecord, LegacyHistoryError, type LegacyHistorySession } from './legacy-history';
import { projectLegacyHistoryHud, LEGACY_HISTORY_HUD_POINT_LIMIT, type LegacyHistoryHudProjection } from './legacy-history-hud';
import { deriveInputRateTimeline } from './input-rate-timeline';
import { exportStudioSession } from './session-export';
import { TrainingHistorySegmentProjector } from './training-history-segment';
import { IndexedDBTrainingRepository } from './repository';
import { validateScene } from '../hud-library/validate';
import { trendSegments } from '../hud-library/metrics';
import type { HudScene, TrendNode, TrendBarsNode } from '../hud-library/schema';

// Deterministic unit fixtures and fake IndexedDB below are test evidence only,
// never claimed as real user history or as browser qualification.
const material: Material = { id: CAFE_MATERIAL.id, version: 'saved-material-2019', title: 'Embedded unit-test material', rights: 'Original test text',
  cues: [{ id: 'saved-one', text: 'one two three', start: 0, end: 5 }, { id: 'saved-two', text: 'four five', start: 5, end: 10 }] };
function fixture(observed = false) {
  let now = 0, wallOffset = 0, id = 0;
  const clock = { now: () => now, wallTime: () => new Date(Date.UTC(2026, 9, 8) + now + wallOffset).toISOString(), id: () => `hud-unit-event-${++id}` };
  const engine = new TrainingEngine({ sessionId: 'hud-unit-session', material, clock, ...(observed ? { inputObservation: { runId: 'hud-unit-observation' } } : {}) });
  return { engine, clock, advance(ms: number) { now += ms; }, shiftWall(ms: number) { wallOffset += ms; },
    tick(ms = 1000) { now += ms; engine.sampleClock(); },
    input(text: string, data: string) { engine.input(text, 'typed', { version: 'dom-edit-v1', kind: 'input', inputType: 'insertText', data }); } };
}
function session(snapshot: TrainingSnapshot): LegacyHistorySession {
  return readLegacyHistoryRecord({ sessionId: snapshot.sessionId, sequence: snapshot.sequence, updatedAt: '2026-10-08T12:00:00.000Z', snapshot });
}
function clone<T>(value: T): T { return structuredClone(value); }

function assertExactProjection(projected: LegacyHistoryHudProjection) {
  assert.ok(projected.timeline);
  const timeline = projected.timeline;
  const mapped = projected.trends.flatMap(window => window.metric.points.map((point, offset) => {
    const actual = timeline.points[window.sourcePointStart + offset];
    assert.equal(point.atMs + window.originWallTimeMs, actual.wallTimeMs);
    assert.equal(point.value, actual.cpm);
    assert.equal(window.metricVersion, actual.metricVersion ?? 'input.cpm.5s.v1');
    assert.ok(point.sourceEventIds.includes(actual.eventId));
    assert.equal(point.quality, actual.cpm === null ? 'unmeasured' : 'measured');
    return actual.eventId;
  }));
  assert.deepEqual(mapped, timeline.points.map(point => point.eventId));
  let end = 0;
  for (const window of projected.trends) {
    assert.equal(window.sourcePointStart, end);
    assert.equal(window.sourcePointEnd - window.sourcePointStart, window.metric.points.length);
    end = window.sourcePointEnd;
    assert.ok(window.metric.points.length > 0 && window.metric.points.length <= LEGACY_HISTORY_HUD_POINT_LIMIT);
    assert.equal(window.metric.points[0].atMs, 0);
    assert.ok(window.metric.points.every((point, i, points) => i === 0 || point.atMs > points[i - 1].atMs));
    const paths = new Set(timeline.segments.filter(segment => segment.points.some(point => window.metric.sourceEventIds.includes(point.eventId))).map(segment => segment.id));
    assert.ok(paths.size <= 1, 'A display metric may never connect separate measured paths');
    assert.equal([...paths][0] ?? null, window.observationSegmentId);
    for (const type of ['trend-line', 'trend-bars'] as const) {
      const node: TrendNode | TrendBarsNode = { id: 'rate', type, schemaVersion: 1,
        metricBinding: { metricKey: window.metric.metricId, metricVersion: 1, schemaVersion: 1, unit: window.metric.unit, source: window.metric.source },
        label: window.label, position: { x: 0, y: 0 }, size: { width: 600, height: 220 }, anchor: 'top-left', zIndex: 0, motion: 'none', ...(type === 'trend-line' ? { maxGapMs: Number.MAX_SAFE_INTEGER } : {}) } as TrendNode | TrendBarsNode;
      const scene: HudScene = { schemaVersion: 1, size: { width: 600, height: 220 }, safeBounds: { x: 0, y: 0, width: 600, height: 220 }, nodes: [node], metrics: { [window.metric.metricId]: window.metric } };
      assert.deepEqual(validateScene(scene, { nowMs: 0, reducedMotion: true }), [], type);
    }
  }
  assert.equal(end, timeline.points.length);
}

test('saved aggregates, completion and material version remain historical facts, independent of replay and today’s catalog', () => {
  const f = fixture(); f.input('one two three', 'one two three'); f.tick(); f.engine.submit();
  const historical = clone(f.engine.getSnapshot()) as unknown as { earnedWords: number; attempts: { gain: number; accuracy: number }[] };
  historical.earnedWords = 173; historical.attempts[0].gain = 29; historical.attempts[0].accuracy = 17;
  const selected = session(historical as unknown as TrainingSnapshot), before = JSON.stringify(selected);
  const exported = exportStudioSession(selected.snapshot, '2026-10-09T00:00:00.000Z');
  const projected = projectLegacyHistoryHud(selected);
  assert.notEqual(replay(selected.snapshot.events, selected.snapshot.material).earnedWords, 173);
  assert.equal(projected.words.value, 173); assert.equal(projected.words.source, 'legacy-training-snapshot');
  assert.equal(projected.completion.numerator, 1); assert.equal(projected.completion.denominator, 2);
  assert.notEqual(projected.completion.denominator, CAFE_MATERIAL.cues.length);
  assert.deepEqual(projected.material, { id: material.id, version: material.version, evidence: 'embedded-snapshot' });
  assert.ok(projected.limitations.some(value => value.includes('旧规则')));
  assert.equal(JSON.stringify(selected), before);
  assert.deepEqual(exportStudioSession(selected.snapshot, '2026-10-09T00:00:00.000Z'), exported);
  assert.ok(Object.isFrozen(projected)); assert.ok(Object.isFrozen(projected.words)); assert.ok(Object.isFrozen(projected.completion));
  assert.ok(Object.isFrozen(projected.trends)); assert.ok(Object.isFrozen(projected.timeline?.points));
  assert.throws(() => { (projected.words as { value: number }).value = 0; }, TypeError);
});

test('missing, mismatched or substituted saved material evidence is rejected rather than guessed', () => {
  const selected = session(fixture().engine.getSnapshot());
  const mutations: ((value: any) => void)[] = [
    value => { delete value.snapshot.material.version; },
    value => { value.snapshot.material.version = ''; },
    value => { value.snapshot.material.version = 'guessed-current'; },
    value => { value.snapshot.events[0].material.version = 'other'; },
    value => { delete value.snapshot.events[0].material; },
    value => { value.summary.materialVersion = 'wrong-selection-version'; },
    value => { value.snapshot.material.cues = CAFE_MATERIAL.cues; },
  ];
  for (const mutate of mutations) {
    const candidate = clone(selected); mutate(candidate); const before = JSON.stringify(candidate);
    assert.throws(() => projectLegacyHistoryHud(candidate), error => error instanceof LegacyHistoryError);
    assert.equal(JSON.stringify(candidate), before);
  }
});

test('unsupported historical rules keep saved facts but have no fabricated current-rule CPM', () => {
  const original = clone(fixture().engine.getSnapshot()) as unknown as { earnedWords: number; events: { ruleVersion: string }[] };
  original.earnedWords = 77; original.events[0].ruleVersion = 'historical-unknown-rule';
  const projected = projectLegacyHistoryHud(session(original as unknown as TrainingSnapshot));
  assert.equal(projected.words.value, 77); assert.equal(projected.timeline, null); assert.deepEqual(projected.trends, []);
  assert.ok(projected.limitations.some(value => value.includes('尚未支持')));
});

test('partial v42 observations and disguised partial snapshots are rejected before projection', () => {
  const f = fixture(true);
  const projector = new TrainingHistorySegmentProjector(f.engine.getSnapshot(), { segmentId: 'test-partial', writerInstanceId: 'test-writer', generation: 1, startedAt: '2026-10-08T00:00:00.000Z' });
  f.input('one', 'one'); const partial = projector.observe(f.engine.getSnapshot());
  assert.equal(partial.coverage, 'partial'); assert.equal(partial.replayable, false);
  assert.throws(() => projectLegacyHistoryHud(partial as unknown as LegacyHistorySession), /complete saved Training v1 snapshot/);
  const selected = session(f.engine.getSnapshot());
  for (const candidate of [{ ...selected, coverage: 'partial' }, { ...selected, snapshot: { ...selected.snapshot, replayable: false } }, { ...selected, snapshot: partial }]) {
    assert.throws(() => projectLegacyHistoryHud(candidate as LegacyHistorySession), /complete saved Training v1 snapshot/);
  }
});

test('v1 CPM points, zero observations and null gaps are copied exactly and remain separate paths', () => {
  const f = fixture(); f.input('a', 'a'); f.tick(); f.input('a👩‍💻é', '👩‍💻é'); f.tick(4000);
  f.engine.setFrozen('paused', true); f.advance(10000); f.engine.setFrozen('paused', false); f.tick(5000);
  f.engine.input('unknown'); f.tick(5000); f.tick();
  const selected = session(f.engine.getSnapshot()), projected = projectLegacyHistoryHud(selected);
  assert.deepEqual(projected.timeline, deriveInputRateTimeline(selected.snapshot));
  assert.ok(projected.timeline!.points.some(point => point.cpm === 24));
  assert.ok(projected.timeline!.points.some(point => point.cpm === 0));
  assert.ok(projected.timeline!.points.some(point => point.cpm === null));
  assertExactProjection(projected);
  assert.ok(projected.trends.filter(window => window.observationSegmentId === null).every(window => trendSegments(window.metric, Number.MAX_SAFE_INTEGER).length === 0));
});

test('v2 CPM retains simultaneous distinct observations, clock reversals, IME, pause and observation segment boundaries', () => {
  const f = fixture(true); f.engine.beginComposition(); for (let i = 0; i < 5; i++) f.tick();
  f.engine.endComposition('你', { version: 'dom-edit-v1', kind: 'compositionend', inputType: null, data: '你' });
  f.input('你好', '好'); f.input('你好啊', '啊');
  f.shiftWall(-60000); f.tick(); f.engine.setInputObservationFocused(false); f.tick(10000); f.engine.setInputObservationFocused(true);
  for (let i = 0; i < 5; i++) f.tick();
  const selected = session(f.engine.getSnapshot()), projected = projectLegacyHistoryHud(selected);
  assert.deepEqual(projected.timeline, deriveInputRateTimeline(selected.snapshot));
  const simultaneous = projected.timeline!.points.filter(point => point.wallTimeMs === Date.UTC(2026, 9, 8) + 5000 && point.cpm !== null);
  assert.ok(new Set(simultaneous.map(point => point.cpm)).size >= 3);
  assert.ok(projected.trends.some(window => window.coverage.includes('相同墙钟时间')));
  assert.ok(projected.trends.some(window => window.coverage.includes('墙钟倒退')));
  assert.ok(projected.timeline!.points.some(point => point.includesIME));
  assert.ok(projected.timeline!.points.some(point => point.state === 'frozen'));
  assertExactProjection(projected);
});

test('mixed v1/v2 saved snapshots preserve each point’s metric version without backfilling old evidence', () => {
  const f = fixture(); f.input('a', 'a'); f.tick(); f.input('ab', 'b'); f.tick(4000);
  const previous = f.engine.getSnapshot(), before = JSON.stringify(previous);
  const resumed = new TrainingEngine({ snapshot: previous, clock: f.clock, inputObservation: { runId: 'hud-unit-resumed' } });
  f.advance(100); resumed.beginComposition();
  for (let i = 0; i < 5; i++) { f.advance(1000); resumed.sampleClock(); }
  resumed.endComposition('ab你', { version: 'dom-edit-v1', kind: 'compositionend', inputType: null, data: '你' });
  const projected = projectLegacyHistoryHud(session(resumed.getSnapshot()));
  assert.deepEqual(new Set(projected.trends.map(window => window.metricVersion)), new Set(['input.cpm.5s.v1', 'input.cpm.5s.v2']));
  assert.equal(JSON.stringify(previous), before); assertExactProjection(projected);
});

test('standby is empty data, never a invented zero trend', () => {
  const f = fixture(true); f.tick(20000);
  const projected = projectLegacyHistoryHud(session(f.engine.getSnapshot()));
  assert.deepEqual(projected.timeline!.points, []); assert.deepEqual(projected.trends, []);
});

test('long source paths are paged at 4096 actual points without truncation or boundary duplication', () => {
  const f = fixture(); f.input('a', 'a');
  for (let i = 0; i < LEGACY_HISTORY_HUD_POINT_LIMIT + 8; i++) f.tick();
  const projected = projectLegacyHistoryHud(session(f.engine.getSnapshot()));
  assert.ok(projected.trends.some(window => window.metric.points.length === LEGACY_HISTORY_HUD_POINT_LIMIT));
  assert.ok(projected.trends.some(window => window.coverage.includes('4096')));
  assertExactProjection(projected);
});

test('fake IndexedDB integration: readonly HUD projection changes no saved stores, repository status or JSON/CSV export bytes', async () => {
  const factory = new IDBFactory(), dbName = 'hud-unit-fake-indexeddb', repository = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  const f = fixture(true); f.input('one two three', 'one two three'); for (let i = 0; i < 5; i++) f.tick(); f.engine.submit();
  await repository.saveSession(f.engine.getSnapshot());
  const readStores = async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = factory.open(dbName); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const names = [...db.objectStoreNames], tx = db.transaction(names, 'readonly'), records: Record<string, unknown> = {};
      for (const name of names) { const request = tx.objectStore(name).getAll(); request.onsuccess = () => { records[name] = request.result; }; }
      await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error); });
      return records;
    } finally { db.close(); }
  };
  try {
    const before = await readStores(), status = repository.getStatus(); let notifications = 0;
    const unsubscribe = repository.subscribe(() => { notifications++; });
    const selected = await repository.loadHistorySession(f.engine.getSnapshot().sessionId); assert.ok(selected);
    const text = JSON.stringify(selected), exportBefore = exportStudioSession(selected.snapshot, '2026-10-09T00:00:00.000Z');
    assertExactProjection(projectLegacyHistoryHud(selected)); assertExactProjection(projectLegacyHistoryHud(selected));
    const again = await repository.loadHistorySession(selected.snapshot.sessionId); assert.ok(again);
    assert.equal(JSON.stringify(again), text); assert.deepEqual(await readStores(), before);
    assert.equal(repository.getStatus(), status); assert.equal(notifications, 0);
    assert.deepEqual(exportStudioSession(again.snapshot, '2026-10-09T00:00:00.000Z'), exportBefore);
    unsubscribe();
  } finally { await repository.close(); }
});
