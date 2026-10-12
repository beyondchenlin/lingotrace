import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TrainingEngine, createInitialSnapshot, replay, RULE_VERSION, PACE_RULE_VERSION,
  type EngineClock, type FreezeReason, type Material, type TrainingSnapshot,
} from './training.ts';
import { derivePaceTimeline, formatPace, type PaceTimeline } from './pace-timeline.ts';

const START = Date.parse('2026-10-07T16:00:00.000Z');
const material: Material = {
  id: 'timeline-test', version: '1', title: 'Timeline test', rights: 'Original test fixture',
  cues: [{ id: 'one', text: 'one two three', start: 0, end: 6 }],
};

function fixture() {
  let mono = 0, wall = START, serial = 0;
  const clock: EngineClock = { now: () => mono, wallTime: () => new Date(wall).toISOString(), id: () => `id-${++serial}` };
  const engine = new TrainingEngine({ clock, material });
  return { engine, clock, advance(ms: number) { mono += ms; wall += ms; }, shiftWall(ms: number) { wall += ms; } };
}

function noSegmentCrosses(timeline: PaceTimeline, from: number, to: number) {
  for (const segment of timeline.segments) {
    const xs = segment.points.map(point => point.wallTimeMs);
    assert.ok(!(Math.min(...xs) < to && Math.max(...xs) > from), 'A drawable segment crossed an excluded interval.');
  }
}

test('a fresh session has no fabricated zero sample or padded history', () => {
  const f = fixture();
  const timeline = derivePaceTimeline(f.engine.getSnapshot());
  assert.deepEqual(timeline.points, []);
  assert.deepEqual(timeline.segments, []);
  assert.equal(timeline.sampleCount, 0);
  assert.equal(timeline.gaps.length, 1);
  assert.equal(timeline.gaps[0].open, true);
  assert.equal(timeline.gaps[0].observedWallMs, 0);
  f.advance(30 * 60_000); f.engine.sampleClock();
  assert.deepEqual(derivePaceTimeline(f.engine.getSnapshot()), timeline);
  const noEvents = derivePaceTimeline(createInitialSnapshot('unstarted', material));
  assert.equal(noEvents.domain, null);
  assert.equal(noEvents.originWallTime, null);
  assert.deepEqual(noEvents.gaps, []);
});

test('observed input and clock samples use exact shared-reducer pace and trace keys', () => {
  const f = fixture();
  f.advance(4500); f.engine.input('a');
  f.advance(3000); f.engine.sampleClock();
  f.engine.input('ab');
  const snapshot = f.engine.getSnapshot(), timeline = derivePaceTimeline(snapshot);
  assert.deepEqual(timeline.points.map(p => p.kind), ['input', 'sample', 'input']);
  assert.equal(timeline.sampleCount, 3);
  assert.equal(timeline.points[1].rawPace, 20 / Math.E);
  assert.equal(timeline.points[2].rawPace, snapshot.pace);
  assert.equal(timeline.points[0].elapsedWallMs, 4500);
  assert.equal(timeline.gaps[0].observedWallMs, 4500);
  for (const point of timeline.points) {
    const event = snapshot.events.find(e => e.eventId === point.eventId)!;
    const at = replay(snapshot.events.slice(0, snapshot.events.indexOf(event) + 1));
    assert.equal(point.sequence, event.sequence);
    assert.equal(point.wallTime, event.wallTime);
    assert.equal(point.activeMsBefore, event.activeMs);
    assert.equal(point.activeMs, at.activeMs);
    assert.equal(point.rawPace, at.pace);
    assert.equal(point.ruleVersion, RULE_VERSION);
    assert.equal(point.paceRuleVersion, PACE_RULE_VERSION);
    assert.equal(point.roundId, snapshot.roundId);
    assert.equal(point.materialVersion, material.version);
  }
  assert.deepEqual(timeline.issues, []);
});

for (const reason of ['idle', 'paused', 'listening', 'background', 'modal', 'checking', 'review'] as const) {
  test(`${reason} retains its actual wall-time gap and held pace`, () => {
    const f = fixture(); f.engine.input('abc'); f.advance(500); f.engine.setFrozen(reason, true);
    const before = f.engine.getSnapshot(), start = Date.parse(before.events.at(-1)!.wallTime);
    f.advance(12_000); f.engine.sampleClock(); f.engine.setFrozen(reason, false);
    const resumed = f.engine.getSnapshot();
    assert.equal(resumed.activeMs, before.activeMs);
    assert.equal(resumed.pace, before.pace);
    const timeline = derivePaceTimeline(resumed);
    const gap = timeline.gaps.find(g => g.reasons.includes(reason) && g.observedWallMs === 12_000)!;
    assert.ok(gap);
    assert.equal(gap.open, false);
    assert.equal(gap.from.wallTimeMs, start);
    assert.equal(gap.to.wallTimeMs, start + 12_000);
    noSegmentCrosses(timeline, start, start + 12_000);
    assert.equal(timeline.points.at(-1)!.rawPace, before.pace);
    f.advance(1000); f.engine.sampleClock();
    assert.ok(Math.abs(derivePaceTimeline(f.engine.getSnapshot()).points.at(-1)!.rawPace - before.pace * Math.exp(-1 / 3)) < 1e-10);
  });
}

test('an open freeze never invents elapsed time after the last recorded event', () => {
  const f = fixture(); f.engine.input('abc'); f.advance(500); f.engine.setFrozen('paused', true);
  const before = derivePaceTimeline(f.engine.getSnapshot());
  const gap = before.gaps.at(-1)!;
  assert.equal(gap.open, true);
  assert.equal(gap.observedWallMs, 0);
  assert.equal(gap.from.eventId, gap.to.eventId);
  f.advance(60_000); f.engine.sampleClock();
  assert.deepEqual(derivePaceTimeline(f.engine.getSnapshot()), before);
});

test('overlapping pause/background reasons retain each observable interval', () => {
  const f = fixture(); f.engine.input('a'); f.advance(500); f.engine.setFrozen('paused', true);
  f.advance(2000); f.engine.setFrozen('background', true);
  f.advance(3000); f.engine.setFrozen('paused', false);
  f.advance(3000); f.engine.setFrozen('background', false);
  const timeline = derivePaceTimeline(f.engine.getSnapshot());
  const gaps = timeline.gaps.filter(g => g.reasons.includes('paused') || g.reasons.includes('background'));
  assert.deepEqual(gaps.map(g => [g.reasons, g.observedWallMs]), [
    [['paused'], 2000], [['paused', 'background'], 3000], [['background'], 3000],
  ]);
  assert.equal(timeline.markers.filter(m => m.at.eventType === 'freezeChanged').length, 4);
  noSegmentCrosses(timeline, START + 500, START + 8500);
});

test('IME composition is an explicit gap and its committed grapheme counts once', () => {
  const f = fixture(); f.engine.input('a'); f.advance(100); f.engine.beginComposition();
  const held = f.engine.getSnapshot().pace;
  f.advance(9000); f.engine.sampleClock(); f.engine.endComposition('a👩‍💻'); f.engine.input('a👩‍💻');
  const timeline = derivePaceTimeline(f.engine.getSnapshot());
  assert.equal(timeline.points.at(-1)!.rawPace, held + 20);
  assert.equal(timeline.points.filter(p => p.kind === 'input').length, 2);
  assert.ok(timeline.gaps.some(g => g.reasons.includes('composition') && g.observedWallMs === 9000));
  assert.equal(timeline.points.at(-1)!.activeMs, 100);
  noSegmentCrosses(timeline, START + 100, START + 9100);
});

test('real active silence decays, the display threshold is exact, and cumulative credit is unchanged', () => {
  const f = fixture(); f.engine.input('one two three'); f.engine.submit();
  assert.equal(f.engine.getSnapshot().earnedWords, 3);
  f.engine.input('one two three x');
  f.advance(30_000); f.engine.sampleClock();
  const snapshot = f.engine.getSnapshot(), original = structuredClone(snapshot);
  const timeline = derivePaceTimeline(snapshot);
  assert.ok(timeline.points.at(-1)!.rawPace > 0 && timeline.points.at(-1)!.rawPace < 1);
  assert.equal(timeline.points.at(-1)!.pace, 0);
  assert.equal(snapshot.earnedWords, 3);
  assert.deepEqual(snapshot, original);
  assert.equal(formatPace(0.99999), 0);
  assert.equal(formatPace(0.5), 0);
  assert.equal(formatPace(1), 1);
  assert.equal(formatPace(1.5), 2);
  assert.equal(timeline.gaps.some(g => g.kind === 'unobserved'), false);
});

test('paste and deletion are observed without a fabricated pace boost', () => {
  const f = fixture(); f.engine.input('hello', 'paste'); f.engine.input('hell'); f.engine.input('hello');
  assert.deepEqual(derivePaceTimeline(f.engine.getSnapshot()).points.map(p => p.rawPace), [0, 0, 20]);
});

test('a reload/offline interval becomes an unobserved gap without assumed activity or cause', () => {
  const f = fixture(); f.engine.input('a'); f.advance(1000); f.engine.sampleClock();
  const before = f.engine.getSnapshot();
  f.advance(19_000);
  const restored = new TrainingEngine({ snapshot: before, clock: f.clock });
  f.advance(1000); restored.sampleClock();
  const timeline = derivePaceTimeline(restored.getSnapshot());
  const gap = timeline.gaps.find(g => g.kind === 'unobserved')!;
  assert.ok(gap);
  assert.equal(gap.observedWallMs, 20_000);
  assert.deepEqual(gap.reasons, []);
  assert.equal(timeline.issues.at(-1)!.activeDeltaMs, 1000);
  assert.equal(timeline.points.at(-1)!.rawPace, restored.getSnapshot().pace);
  assert.equal(timeline.points.at(-1)!.activeMs, 2000);
  noSegmentCrosses(timeline, gap.from.wallTimeMs, gap.to.wallTimeMs);
});

test('wall-clock reversal preserves raw timestamps and breaks the line', () => {
  const f = fixture(); f.engine.input('a'); f.shiftWall(-5000); f.advance(1000); f.engine.sampleClock();
  const timeline = derivePaceTimeline(f.engine.getSnapshot());
  assert.equal(timeline.issues[0].code, 'wall-clock-reversed');
  assert.equal(timeline.points.at(-1)!.elapsedWallMs, -4000);
  assert.equal(timeline.gaps.at(-1)!.kind, 'clock-discontinuity');
  assert.equal(timeline.gaps.at(-1)!.observedWallMs, null);
  assert.deepEqual(timeline.domain, { minWallTimeMs: START - 4000, maxWallTimeMs: START });
  assert.equal(timeline.segments.length, 2);
});

test('imported derived numbers are ignored, duplicate IDs stay deduped, and output is immutable', () => {
  const f = fixture(); f.engine.input('abc'); f.advance(1000); f.engine.sampleClock();
  const snapshot = f.engine.getSnapshot(), expected = derivePaceTimeline(snapshot);
  const forged = structuredClone(snapshot) as unknown as { pace: number; earnedWords: number; events: unknown[] };
  forged.pace = 999_999; forged.earnedWords = 999_999;
  forged.events.push({ ...snapshot.events[1], sequence: -1, activeMs: NaN, sessionId: 'wrong' });
  assert.deepEqual(derivePaceTimeline(forged as unknown as TrainingSnapshot), expected);
  assert.ok(Object.isFrozen(expected));
  assert.ok(Object.isFrozen(expected.segments[0].points));
  assert.ok(Object.isFrozen(expected.points[0]));
});

test('invalid rule versions and sequence metadata fail through the shared contract', () => {
  const f = fixture(); f.engine.input('abc');
  const snapshot = f.engine.getSnapshot();
  const wrongRule = { ...snapshot, events: snapshot.events.map((e, i) => i ? { ...e, paceRuleVersion: 'made-up' } : e) };
  assert.throws(() => derivePaceTimeline(wrongRule as TrainingSnapshot), /Unsupported event schema or rule version/);
  assert.throws(() => derivePaceTimeline({ ...snapshot, sequence: 99 }), /metadata does not match/);
});
