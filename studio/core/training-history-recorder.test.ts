import test from 'node:test';
import assert from 'node:assert/strict';
import { TrainingEngine } from './training.ts';
import { TrainingHistoryRecorder, type TrainingHistoryRecordingAccess } from './training-history-recorder.ts';
import type { TrainingHistorySegment } from './training-history-segment.ts';
import type { TrainingHistorySegmentPermit } from './repository.ts';
import type { AutomaticHistoryControl } from './automatic-history-control.ts';

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(overrides: Partial<TrainingHistoryRecordingAccess> = {}) {
  let serial = 0, time = 0;
  const engine = new TrainingEngine({sessionId: 'live-practice', clock: { now: () => time, wallTime: () => new Date(1_700_000_000_000 + time).toISOString(), id: () => `source-${++serial}` }});
  let control: AutomaticHistoryControl = {state:'legacy-default', generation:0};
  const legacy: unknown[] = [], segments: TrainingHistorySegment[] = [], revoked: TrainingHistorySegmentPermit[] = [];
  const permit = Object.freeze({}) as TrainingHistorySegmentPermit;
  const repository: TrainingHistoryRecordingAccess = {
    saveSession: async value => { legacy.push(value); },
    readAutomaticHistoryControl: async () => control,
    disableAutomaticHistory: async () => { control = {state:'segment-off', generation:control.generation + 1}; return control; },
    enableAutomaticHistory: async () => { control = {state:'segment-on', generation:control.generation + 1}; return control; },
    beginTrainingHistorySegment: async segment => { segments.push(segment); return {permit, segment}; },
    saveTrainingHistorySegment: async (_permit, segment) => { segments.push(segment); return segment; },
    revokeTrainingHistorySegment: value => { revoked.push(value); }, ...overrides,
  };
  const recorder = new TrainingHistoryRecorder(repository, {writerInstanceId:'page-instance', clock:{id:()=>`segment-${++serial}`,wallTime:()=>new Date(1_700_000_000_000+time).toISOString()}});
  recorder.connect(engine.getSnapshot(),control);
  engine.subscribe(()=>recorder.observe(engine.getSnapshot()));
  return {engine,recorder,repository,legacy,segments,revoked,permit,setTime:(t:number)=>{time=t;}};
}
test('record OFF/ON changes persistence only, leaving the live session and attempt unchanged', async () => {
  const f=fixture(); f.engine.input('saved prefix'); await f.recorder.flush(); assert.equal(f.legacy.length,1);
  await f.recorder.turnOff(); f.engine.input('OFF_PRIVATE_SENTINEL'); f.engine.submit();
  const live = f.engine.getSnapshot(); await f.recorder.flush(); assert.equal(f.legacy.length,1);
  await f.recorder.turnOn(); assert.strictEqual(f.engine.getSnapshot(),live); assert.equal(f.recorder.getSnapshot().mode,'segment');
  f.engine.input('OFF_PRIVATE_SENTINEL plus ON'); f.engine.submit(); await f.recorder.flush();
  assert.equal(f.legacy.length,1); assert.ok(f.segments.length>=2);
  assert.ok(!JSON.stringify(f.segments).includes('OFF_PRIVATE_SENTINEL'));
  assert.equal(f.engine.getSnapshot().sessionId,'live-practice'); assert.equal(f.engine.getSnapshot().attempts.length,2);
});
test('pending ON does not backfill events before the configuration transaction commits', async () => {
  const enabling=deferred<AutomaticHistoryControl>(); const f=fixture({enableAutomaticHistory:()=>enabling.promise});
  await f.recorder.turnOff(); const pending=f.recorder.turnOn(); await Promise.resolve();
  f.engine.input('PENDING_PRIVATE_SENTINEL');
  enabling.resolve({state:'segment-on',generation:2}); await pending;
  assert.equal(f.segments[0].facts.length,0);
  f.engine.input('PENDING_PRIVATE_SENTINEL after'); await f.recorder.flush();
  assert.ok(!JSON.stringify(f.segments).includes('PENDING_PRIVATE_SENTINEL'));
});
test('repeated ON is single-flight; OFF before ON work starts cancels admission', async () => {
  let enables=0; const f=fixture({enableAutomaticHistory:async()=>{enables++;return {state:'segment-on',generation:2};}});
  await f.recorder.turnOff(); const a=f.recorder.turnOn(),b=f.recorder.turnOn(); assert.strictEqual(a,b);
  await f.recorder.turnOff(); await a;
  assert.equal(enables,0); assert.equal(f.segments.length,0); assert.equal(f.recorder.getSnapshot().mode,'off');
});
test('late segment admission after OFF loses its local permit and cannot flush', async () => {
  const admission=deferred<{permit:TrainingHistorySegmentPermit;segment:TrainingHistorySegment}>(); let pendingSegment:TrainingHistorySegment|undefined;
  const f=fixture({beginTrainingHistorySegment:segment=>{pendingSegment=segment;return admission.promise;}});
  await f.recorder.turnOff(); const pending=f.recorder.turnOn(); await Promise.resolve(); await Promise.resolve();
  assert.ok(pendingSegment); await f.recorder.turnOff(); admission.resolve({permit:f.permit,segment:pendingSegment}); await pending;
  f.engine.input('late input stays private'); await f.recorder.flush();
  assert.deepEqual(f.revoked,[f.permit]); assert.equal(f.segments.length,0); assert.equal(f.recorder.getSnapshot().mode,'off');
});
test('read persisted ON does not restore a writing capability or replay a partial session', async () => {
  const f=fixture(); f.recorder.connect(f.engine.getSnapshot(),{state:'segment-on',generation:4});
  f.engine.input('temporary current page'); await f.recorder.flush();
  assert.equal(f.recorder.getSnapshot().mode,'awaiting-segment'); assert.equal(f.legacy.length,0); assert.equal(f.segments.length,0);
});
test('configuration failure keeps current practice usable and never claims successful recording', async () => {
  const f=fixture({disableAutomaticHistory:async()=>{throw Error('PRIVATE ERROR payload');}});
  f.engine.input('visible draft'); const before=f.engine.getSnapshot(); await f.recorder.turnOff();
  assert.strictEqual(f.engine.getSnapshot(),before); assert.equal(f.recorder.getSnapshot().mode,'off');
  assert.equal(f.recorder.getSnapshot().error,'本页已停止，设置未保存'); assert.ok(!JSON.stringify(f.recorder.getSnapshot()).includes('PRIVATE ERROR'));
  f.engine.input('still can practice'); await f.recorder.flush(); assert.equal(f.legacy.length,0);
});
test('failed segment write remains dirty for explicit same-segment retry, never a raw snapshot fallback', async () => {
  let fails=true,writes=0; const f=fixture({saveTrainingHistorySegment:async(_permit,segment)=>{writes++;if(fails)throw Error('quota');return segment;}});
  await f.recorder.turnOff(); await f.recorder.turnOn(); f.engine.input(''); f.engine.input('clean','typed',{version:'dom-edit-v1',kind:'input',inputType:'insertText',data:'clean'});
  await f.recorder.flush(); assert.equal(f.recorder.getSnapshot().dirty,true); assert.match(f.recorder.getSnapshot().error!,/尚未保存/);
  fails=false; await f.recorder.flush(); assert.equal(writes,2); assert.equal(f.recorder.getSnapshot().dirty,false); assert.equal(f.legacy.length,0);
});
test('dispose clears the volatile capture and invalidates pending saves without changing global settings', async () => {
  const saving=deferred<void>(); let toggles=0; const f=fixture({saveSession:()=>saving.promise,disableAutomaticHistory:async()=>{toggles++;}});
  f.engine.input('local data'); const pending=f.recorder.flush(); f.recorder.dispose(); saving.resolve(); await pending;
  f.engine.input('late callback'); await f.recorder.flush(); assert.equal(f.recorder.getSnapshot().mode,'disposed'); assert.equal(toggles,0);
  assert.equal(f.recorder.getSnapshot().pendingWrites,0);
});

for (const phase of ['off', 'pending-on'] as const) {
  test(`stale same-session snapshot during ${phase} cannot rewind the next ON privacy boundary`, async () => {
    const gate=deferred<AutomaticHistoryControl>();
    const f=fixture(phase==='pending-on'?{enableAutomaticHistory:()=>gate.promise}:{});
    await f.recorder.turnOff(); const empty=f.engine.getSnapshot();
    let enabling:Promise<void>|undefined;
    if(phase==='pending-on'){ enabling=f.recorder.turnOn(); await Promise.resolve(); }
    f.engine.input('OFF_PRIVATE_SENTINEL','typed',{version:'dom-edit-v1',kind:'input',inputType:'insertText',data:'OFF_PRIVATE_SENTINEL'});
    f.recorder.observe(empty);
    if(phase==='pending-on'){ gate.resolve({state:'segment-on',generation:2}); await enabling; }
    else await f.recorder.turnOn();
    f.recorder.observe(f.engine.getSnapshot()); await f.recorder.flush();
    f.engine.input('OFF_PRIVATE_SENTINEL suffix','typed',{version:'dom-edit-v1',kind:'input',inputType:'insertText',data:' suffix'}); await f.recorder.flush();
    assert.ok(!JSON.stringify(f.segments).includes('OFF_PRIVATE_SENTINEL'));
    assert.equal(f.engine.draft,'OFF_PRIVATE_SENTINEL suffix');
  });
}
test('rapid OFF then ON uses the preceding local committed receipt, not a stale generation', async()=>{
  const off=deferred<AutomaticHistoryControl>(); let passed:number|undefined;
  const f=fixture({disableAutomaticHistory:()=>off.promise,enableAutomaticHistory:async gen=>{passed=gen;return {state:'segment-on',generation:gen+1};}});
  const stopping=f.recorder.turnOff(), starting=f.recorder.turnOn(); await Promise.resolve();
  assert.equal(passed,undefined); off.resolve({state:'segment-off',generation:1}); await Promise.all([stopping,starting]);
  assert.equal(passed,1); assert.equal(f.recorder.getSnapshot().mode,'segment');
});

test('successful ON receipt survives failed admission, so retry uses the committed generation', async()=>{
  let generation=1, fails=true; const expected:number[]=[];
  const f=fixture({enableAutomaticHistory:async g=>{expected.push(g);if(g!==generation)throw Error('stale');generation=2;return {state:'segment-on',generation};},beginTrainingHistorySegment:async segment=>{if(fails)throw Error('quota');return {permit:Object.freeze({}) as TrainingHistorySegmentPermit,segment};}});
  await f.recorder.turnOff(); await f.recorder.turnOn();
  assert.equal(f.recorder.getSnapshot().mode,'off'); assert.equal(f.recorder.getSnapshot().control?.generation,2);
  fails=false; await f.recorder.turnOn(); assert.deepEqual(expected,[1,2]); assert.equal(f.recorder.getSnapshot().mode,'segment');
});
