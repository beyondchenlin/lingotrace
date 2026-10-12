import test from 'node:test';
import assert from 'node:assert/strict';
import { TrainingEngine, exportSession, type EngineClock, type InputSource, type TrainingSnapshot } from '../core/training';
import { exportStudioSession } from '../core/session-export';
import {STANDBY_ENERGY_CYCLES,sampleStandbyEnergy} from './standby-energy';
import { PageInputGate, deriveTransparentPresentation, type TransparentPresentationOptions } from './transparent-presentation';

const DEFAULTS: TransparentPresentationOptions = {
  nowMs: 1000, enteredAtMs: 1000, reducedMotion: false, paused: false,
  pageInputStarted: false, restored: false, replay: false, scorable: true,
};
const EXPORTED_AT = '2026-10-08T00:00:00.000Z';
const present = (snapshot: TrainingSnapshot | null, options: Partial<TransparentPresentationOptions> = {}) =>
  deriveTransparentPresentation(snapshot, { ...DEFAULTS, ...options });

function harness() {
  let now = 1000, id = 0, clockCalls = 0, notifications = 0;
  const clock: EngineClock = {
    now: () => { clockCalls++; return now; },
    wallTime: () => { clockCalls++; return new Date(now).toISOString(); },
    id: () => { clockCalls++; return `event-${++id}`; },
  };
  const engine = new TrainingEngine({ sessionId: 'initial-session', clock });
  const gate = new PageInputGate();
  gate.begin(engine.getSnapshot());
  engine.subscribe(() => { notifications++; gate.observe(engine.getSnapshot()); });
  return { engine, clock, gate, at(value: number) { now = value; },
    view: (options: Partial<TransparentPresentationOptions> = {}) =>
      present(engine.getSnapshot(), { pageInputStarted: gate.started, ...options }),
    counts: () => ({ clockCalls, notifications }),
  };
}

test('fresh scorable rounds show labeled standby fixtures, never measured training', () => {
  const h = harness(), snapshot = h.engine.getSnapshot();
  const view = present(snapshot);
  assert.equal(view.mode, 'standby');
  assert.equal(view.label, '待开始');
  assert.equal(view.detail, '待机动效，尚未统计本次输入');
  assert.equal(view.accent, 'mint');
  assert.ok(view.standby);
  assert.equal(view.standby.source, 'presentation-demo');
  assert.equal(view.standby.goalTotal, 24);
  assert.ok(view.standby.goalWords > 0);
  assert.ok(view.standby.points.length>=301&&view.standby.points.length<=302);
  assert.ok(view.standby.points.every(point => point.provenance === 'presentation-demo'));
  assert.ok(view.standby.pulses.every(pulse => pulse.provenance === 'presentation-demo' && pulse.eventId.startsWith('presentation-standby-')));
  assert.equal(snapshot.earnedWords, 0);
  assert.equal(snapshot.attempts.length, 0);
  assert.ok(!/演示|预热/.test(view.label + view.detail));
});

test('standby stays gently active after entry and at long elapsed times without accumulating fixtures', () => {
  const snapshot = harness().engine.getSnapshot();
  const first = present(snapshot).standby!;
  for (const nowMs of [2000, 20000, 120000, 86400000]) {
    const fixture = present(snapshot, { nowMs }).standby!;
    assert.equal(fixture.source, 'presentation-demo');
    assert.ok(fixture.points.length>=301&&fixture.points.length<=302);
    assert.ok(fixture.pulses.length <= 57);
    assert.ok(fixture.commits10s>=0&&fixture.commits10s<=24);
    assert.ok(fixture.goalWords >= 1 && fixture.goalWords <= 24);
    assert.ok(fixture.energy >= .06 && fixture.energy <= .91);
    assert.ok(fixture.sweep >= 0 && fixture.sweep < 1);
    assert.ok(fixture.points.every(point => point.value >= .35 && point.value <= 5.5 && point.atMs <= fixture.nowMs));
    assert.ok(fixture.pulses.every(pulse => pulse.ageMs >= 0 && pulse.ageMs < 10000 && pulse.atMs <= fixture.nowMs));
    assert.notDeepEqual(fixture.points, first.points);
    assert.equal(fixture.frozen, false);
  }
  const cycle=STANDBY_ENERGY_CYCLES[0],peak=present(snapshot,{nowMs:1000+cycle.peakAtMs}).standby!,idle=present(snapshot,{nowMs:1000+cycle.idleStartMs+200}).standby!;
  assert.ok(peak.goalWords>idle.goalWords+12);assert.ok(peak.energy>idle.energy*8);
  assert.equal(peak.energy,sampleStandbyEnergy(1000+cycle.peakAtMs,1000).energy);
  assert.ok(peak.points.some(p=>p.value>1));
});

test('typing and pasting switch to actual metrics immediately, before confirmation', () => {
  for (const source of ['typed', 'paste'] satisfies InputSource[]) {
    const h = harness();
    h.engine.input('coffee', source);
    const snapshot = h.engine.getSnapshot(), view = h.view();
    assert.equal(snapshot.attempts.length, 0, source);
    assert.equal(snapshot.earnedWords, 0, source);
    assert.equal(view.mode, 'live', source);
    assert.equal(view.label, '训练中', source);
    assert.equal(view.accent, 'amber', source);
    assert.equal(view.standby, null, source);
    assert.equal(h.gate.started, true, source);
  }
});

test('IME composition alone is not input; its first final changed text switches once', () => {
  const h = harness();
  h.engine.beginComposition();
  assert.equal(h.view().mode, 'standby');
  h.engine.endComposition('');
  assert.equal(h.view().mode, 'standby');
  h.engine.beginComposition();
  h.engine.endComposition('é');
  assert.equal(h.view().mode, 'live');
  assert.equal(h.view().standby, null);
  h.engine.input('é');
  assert.equal(h.view().mode, 'live');
});

test('a no-op inputCommitted event and non-input metadata never mark a round started', () => {
  const h = harness();
  const snapshot = h.engine.getSnapshot();
  h.engine.dispatch({ ...snapshot.events[0], type: 'inputCommitted', eventId: 'noop-input',
    sequence: snapshot.sequence + 1, text: '', source: 'typed' });
  h.engine.exposeHint('hint');
  h.engine.exposeHint('reveal');
  h.engine.nextCue();
  h.engine.setFrozen('paused', true);
  h.engine.tick(9000);
  h.engine.setFrozen('paused', false);
  const after = h.engine.getSnapshot();
  assert.ok(after.events.some(event => event.type === 'inputCommitted'));
  assert.ok(Object.values(after.drafts).every(draft => draft.version === 0));
  assert.equal(h.gate.started, false);
  assert.equal(h.view().mode, 'standby');
});

test('deleting to empty, moving cues, going idle and pausing cannot restore standby', () => {
  const h = harness();
  h.engine.input('coffee');
  h.engine.input('');
  h.engine.nextCue(); // Current cue has no edits; another cue still proves input.
  h.engine.setFrozen('idle', true);
  h.engine.setFrozen('paused', true);
  h.engine.tick(600000);
  const snapshot = h.engine.getSnapshot();
  for (const options of [{}, { paused: true }, { reducedMotion: true }, { nowMs: 900000 }]) {
    const view = present(snapshot, { ...options, pageInputStarted: h.gate.started });
    assert.equal(view.mode, 'live');
    assert.equal(view.accent, 'amber');
    assert.equal(view.standby, null);
  }
  assert.match(h.view({ paused: true }).detail, /暂停/);
});

test('saved drafts, attempts and earned words never substitute for this page input gate', () => {
  const h = harness();
  h.engine.input(h.engine.cue.text);
  h.engine.submit();
  const snapshot = h.engine.getSnapshot();
  assert.ok(snapshot.attempts.length > 0 && snapshot.earnedWords > 0);
  // None of the old persisted-state eligibility fields can open the page gate.
  const attemptsOnly = { ...snapshot, drafts: {}, earnedWords: 0 };
  const earnedOnly = { ...snapshot, drafts: {}, attempts: [] };
  const draftsOnly = { ...snapshot, attempts: [], earnedWords: 0 };
  for (const evidence of [snapshot, attemptsOnly, earnedOnly, draftsOnly]) {
    const gate = new PageInputGate();
    gate.begin(evidence);
    gate.observe(evidence);
    assert.equal(gate.started, false);
    assert.equal(present(evidence, { restored: true, pageInputStarted: gate.started }).mode, 'standby');
    assert.equal(present(evidence, { pageInputStarted: true }).mode, 'live');
    assert.equal(present(evidence, { pageInputStarted: true }).standby, null);
  }
});

test('restoring an untouched save primes the gate and remains mint until new changed input', () => {
  const h = harness();
  const untouched = h.engine.getSnapshot();
  const restored = new TrainingEngine({ snapshot: untouched, clock: h.clock });
  h.gate.begin(restored.getSnapshot());
  const savedView = present(restored.getSnapshot(), { restored: true, pageInputStarted: h.gate.started });
  assert.equal(savedView.mode, 'standby');
  assert.equal(savedView.label, '待开始');
  assert.equal(savedView.accent, 'mint');
  assert.equal(savedView.detail, '待机动效，尚未统计本次输入；已有记录保留');
  restored.input('coffee');
  h.gate.observe(restored.getSnapshot());
  const started = present(restored.getSnapshot(), { restored: true, pageInputStarted: h.gate.started });
  assert.equal(started.mode, 'live');
  assert.equal(started.accent, 'amber');
  assert.equal(started.standby, null);
  const again = new TrainingEngine({ snapshot: restored.getSnapshot(), clock: h.clock });
  h.gate.begin(again.getSnapshot());
  assert.equal(present(again.getSnapshot(), { restored: true, pageInputStarted: h.gate.started }).mode, 'standby');
});

test('reopening saved completed work and a draft preserves every fact and waits for a new version', () => {
  const h = harness();
  h.engine.input(h.engine.cue.text);
  h.engine.submit();
  h.engine.nextCue();
  h.engine.input('saved unfinished draft', 'paste');
  const saved = h.engine.getSnapshot();
  assert.ok(saved.earnedWords > 0 && saved.attempts.length > 0 && saved.completedCueIds.length > 0);
  const serialized = JSON.stringify(saved);
  const before = exportStudioSession(saved, EXPORTED_AT);
  const restored = new TrainingEngine({ snapshot: saved, clock: h.clock });
  const snapshot = restored.getSnapshot(), gate = new PageInputGate();
  gate.begin(snapshot);
  for (let index = 0; index < 120; index++) {
    gate.observe(snapshot);
    const view = present(snapshot, { restored: true, pageInputStarted: gate.started, nowMs: 1000 + index * 500 });
    assert.equal(view.mode, 'standby');
    assert.equal(view.accent, 'mint');
  }
  assert.equal(JSON.stringify(snapshot), serialized);
  assert.equal(exportStudioSession(snapshot, EXPORTED_AT).json, before.json);
  assert.equal(exportStudioSession(snapshot, EXPORTED_AT).csv, before.csv);
  restored.input('saved unfinished draft', 'paste');
  gate.observe(restored.getSnapshot());
  assert.equal(gate.started, false, 'unchanged saved text is not new page input');
  restored.input('saved unfinished drafts', 'typed');
  gate.observe(restored.getSnapshot());
  assert.equal(gate.started, true);
  assert.equal(present(restored.getSnapshot(), { restored: true, pageInputStarted: gate.started }).mode, 'live');
  assert.equal(restored.getSnapshot().earnedWords, saved.earnedWords);
  assert.deepEqual(restored.getSnapshot().attempts, saved.attempts);
  assert.equal(JSON.stringify(saved), serialized);
});

test('replay takes priority and never decorates an early snapshot with future facts', () => {
  const h = harness();
  const prefix = h.engine.getSnapshot();
  h.engine.input(h.engine.cue.text);
  h.engine.submit();
  for (const snapshot of [null, prefix, h.engine.getSnapshot()]) {
    const view = present(snapshot, { replay: true, restoreFailed: true, pageInputStarted: true, nowMs: 9000000 });
    assert.equal(view.mode, 'replay');
    assert.equal(view.label, '事件回放');
    assert.equal(view.accent, 'neutral');
    assert.equal(view.standby, null);
    assert.equal('goalWords' in view, false);
  }
});

test('a missing snapshot or local media without scorable text cannot show virtual metrics', () => {
  for (const [snapshot, options] of [
    [null, {}], [harness().engine.getSnapshot(), { scorable: false }],
  ] as const) {
    const view = present(snapshot, options);
    assert.equal(view.mode, 'waiting');
    assert.equal(view.standby, null);
  }
  const h = harness();
  h.engine.input('local media input');
  assert.equal(h.view({ scorable: false }).standby, null);
});

test('restore failure stays visible and cannot be covered by standby or guessed saved metrics', () => {
  const h = harness();
  h.engine.input(h.engine.cue.text);
  h.engine.submit();
  for (const snapshot of [null, h.engine.getSnapshot()]) {
    for (const pageInputStarted of [false, true]) {
      const view = present(snapshot, { restored: true, restoreFailed: true, pageInputStarted });
      assert.equal(view.mode, 'waiting');
      assert.equal(view.label, '恢复失败');
      assert.match(view.detail, /恢复失败.*重试/);
      assert.equal(view.accent, 'neutral');
      assert.equal(view.standby, null);
    }
  }
});

test('reduced motion and prestart pause are fully static at all frame times', () => {
  const snapshot = harness().engine.getSnapshot();
  for (const options of [{ reducedMotion: true }, { paused: true }, { reducedMotion: true, paused: true }]) {
    const expected = present(snapshot, options);
    assert.equal(expected.label, '待开始');
    assert.equal(expected.standby?.frozen, true);
    for (const nowMs of [1000, 1016, 4000, 86400000]) {
      assert.deepEqual(present(snapshot, { ...options, nowMs }), expected);
    }
  }
});

test('a new explicit reset primes standby without altering the previous session', () => {
  const h = harness();
  h.engine.input('coffee');
  const previous = h.engine.getSnapshot();
  assert.equal(h.view().mode, 'live');
  const serialized = JSON.stringify(previous);
  h.at(2000);
  h.engine.resetSession();
  const reset = h.engine.getSnapshot();
  assert.notEqual(reset.sessionId, previous.sessionId);
  assert.equal(h.gate.started, false);
  assert.equal(h.view({ enteredAtMs: 2000, nowMs: 2000 }).mode, 'standby');
  assert.equal(JSON.stringify(previous), serialized);
  h.engine.input('new round');
  assert.equal(h.gate.started, true);
  assert.equal(h.view().mode, 'live');
});

test('begin resets only transient state for reload or bfcache reentry with the same snapshot', () => {
  const h = harness();
  h.engine.input('retained text');
  assert.equal(h.gate.started, true);
  const snapshot = h.engine.getSnapshot(), serialized = JSON.stringify(snapshot), counts = h.counts();
  for (let entry = 0; entry < 3; entry++) {
    h.gate.begin(snapshot);
    for (let repeat = 0; repeat < 5; repeat++) h.gate.observe(snapshot);
    assert.equal(h.gate.started, false);
    assert.equal(h.view().mode, 'standby');
    assert.equal(h.engine.getSnapshot(), snapshot);
  }
  assert.deepEqual(h.counts(), counts);
  assert.equal(JSON.stringify(snapshot), serialized);
  h.engine.input('retained texts');
  assert.equal(h.gate.started, true);
  assert.equal(h.view().mode, 'live');
});

test('deleting an old saved draft is a new changed input and cannot return to standby', () => {
  const h = harness();
  h.engine.input('saved draft');
  h.gate.begin(h.engine.getSnapshot());
  assert.equal(h.gate.started, false);
  h.engine.input('');
  assert.equal(h.gate.started, true);
  assert.equal(h.view().mode, 'live');
  h.engine.input('');
  h.engine.exposeHint('hint');
  h.engine.nextCue();
  assert.equal(h.gate.started, true);
});

test('saved per-cue versions survive navigation and same-version metadata changes', () => {
  const h = harness();
  h.engine.input('first cue');
  h.engine.nextCue();
  h.engine.input('second cue');
  h.gate.begin(h.engine.getSnapshot());
  h.engine.exposeHint('hint');
  h.engine.exposeHint('reveal');
  h.engine.nextCue();
  h.engine.exposeHint('hint'); // Adds a version-zero draft without new input.
  h.engine.setFrozen('background', true);
  h.engine.tick(20000);
  h.engine.setFrozen('background', false);
  const snapshot = h.engine.getSnapshot();
  h.gate.observe({ ...snapshot, drafts: { ...snapshot.drafts } });
  assert.equal(h.gate.started, false);
  h.engine.input('third cue');
  assert.equal(h.gate.started, true);
  for (let repeat = 0; repeat < 5; repeat++) h.gate.observe(h.engine.getSnapshot());
  assert.equal(h.gate.started, true);
});

test('a result applied to a retained draft cannot open the page gate without new input', () => {
  const h = harness();
  h.engine.input(h.engine.cue.text);
  const saved = h.engine.getSnapshot();
  h.gate.begin(saved);
  h.engine.submit();
  const judged = h.engine.getSnapshot();
  assert.ok(judged.earnedWords > saved.earnedWords);
  assert.ok(judged.attempts.length > saved.attempts.length);
  assert.deepEqual(judged.drafts, saved.drafts);
  assert.equal(h.gate.started, false);
  assert.equal(h.view({ restored: true }).mode, 'standby');
});

test('first observation safely primes a gate, including a populated replacement session', () => {
  const h = harness();
  h.engine.input('old input');
  const gate = new PageInputGate();
  assert.equal(gate.started, false);
  gate.observe(h.engine.getSnapshot());
  assert.equal(gate.started, false);
  h.engine.input('new input');
  gate.observe(h.engine.getSnapshot());
  assert.equal(gate.started, true);
  const other = new TrainingEngine({ sessionId: 'another-session', clock: h.clock });
  other.input('replacement historical input');
  gate.observe(other.getSnapshot());
  assert.equal(gate.started, false);
  other.input('replacement new input');
  gate.observe(other.getSnapshot());
  assert.equal(gate.started, true);
});

test('many decorative frames leave snapshots, engine callbacks, JSON and CSV byte-identical', () => {
  const h = harness();
  for (const live of [false, true]) {
    if (live) { h.engine.input(h.engine.cue.text); h.engine.submit(); }
    const snapshot = h.engine.getSnapshot(), serialized = JSON.stringify(snapshot);
    const exported = exportSession(snapshot, EXPORTED_AT);
    const studioExported = exportStudioSession(snapshot, EXPORTED_AT);
    const counts = h.counts();
    h.gate.begin(snapshot);
    for (let index = 0; index < 720; index++) {
      h.gate.observe(snapshot);
      const options = { nowMs: 1000 + index * 125, pageInputStarted: h.gate.started, restored: live };
      assert.equal(present(snapshot, options).mode, 'standby');
      present(snapshot, { ...options, reducedMotion: true });
      present(snapshot, { ...options, pageInputStarted: true });
    }
    assert.equal(h.engine.getSnapshot(), snapshot);
    assert.equal(JSON.stringify(snapshot), serialized);
    assert.deepEqual(h.counts(), counts);
    assert.deepEqual(exportSession(snapshot, EXPORTED_AT), exported);
    assert.deepEqual(exportStudioSession(snapshot, EXPORTED_AT), studioExported);
    assert.equal(exportSession(snapshot, EXPORTED_AT).json, exported.json);
    assert.equal(exportSession(snapshot, EXPORTED_AT).csv, exported.csv);
    assert.equal(exportStudioSession(snapshot, EXPORTED_AT).json, studioExported.json);
    assert.equal(exportStudioSession(snapshot, EXPORTED_AT).csv, studioExported.csv);
    assert.ok(!studioExported.json.includes('presentation-demo'));
    assert.ok(!studioExported.csv.includes('presentation-standby'));
  }
});

test('identical inputs reproduce identical frames without retaining output mutations', () => {
  const snapshot = harness().engine.getSnapshot();
  const frame = present(snapshot, { nowMs: 4512 });
  assert.deepEqual(present(snapshot, { nowMs: 4512 }), frame);
  const original = structuredClone(frame);
  // A consumer's accidental mutation cannot affect later calls or shared constants.
  (frame.standby!.points[0] as { value: number }).value = 999;
  assert.deepEqual(present(snapshot, { nowMs: 4512 }), original);
});

test('invalid decoration clocks are rejected rather than producing NaN geometry', () => {
  const snapshot = harness().engine.getSnapshot();
  for (const value of [NaN, Infinity, -1]) {
    assert.throws(() => present(snapshot, { nowMs: value }), RangeError);
    assert.throws(() => present(snapshot, { enteredAtMs: value }), RangeError);
  }
});

test('goal, delayed trace and rhythm share the same asymmetric envelope without changing the real takeover',()=>{const h=harness(),cycle=STANDBY_ENERGY_CYCLES[0];const t=1000+cycle.peakAtMs+70,frame=present(h.engine.getSnapshot(),{nowMs:t}).standby!;assert.ok(frame.points.at(-1)!.value>.35&&frame.points.at(-1)!.value<.35+cycle.peak*5.1);assert.equal(frame.historyWindowMs,12000);assert.equal(frame.commits10s,Math.round(sampleStandbyEnergy(t,1000,{lagMs:130}).energy*24));const before=JSON.stringify(h.engine.getSnapshot());for(let dt=0;dt<7000;dt+=50)present(h.engine.getSnapshot(),{nowMs:1000+dt});assert.equal(JSON.stringify(h.engine.getSnapshot()),before);h.engine.input('C');assert.equal(h.view().standby,null);assert.equal(h.engine.getSnapshot().earnedWords,0)});

test('fixed trace timestamps keep historical values unchanged while the view scrolls by subpixels',()=>{const snapshot=harness().engine.getSnapshot(),a=present(snapshot,{nowMs:23517}).standby!,b=present(snapshot,{nowMs:23533}).standby!;const values=new Map(a.points.slice(0,-1).map(p=>[p.atMs,p.value]));let common=0;for(const p of b.points.slice(0,-1)){if(values.has(p.atMs)){assert.equal(p.value,values.get(p.atMs));common++}}assert.ok(common>295);assert.notEqual(a.nowMs,b.nowMs);});
test('continuous arc geometry can change while its rounded word readout stays fixed',()=>{const snapshot=harness().engine.getSnapshot();let found=false;for(let t=1300;t<1700;t++){const a=present(snapshot,{nowMs:t}).standby!,b=present(snapshot,{nowMs:t+1}).standby!;if(a.goalWords===b.goalWords&&a.goalFraction!==b.goalFraction){found=true;break}}assert.ok(found)});
