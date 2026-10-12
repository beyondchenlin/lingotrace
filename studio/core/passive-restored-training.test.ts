import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TrainingEngine, replay, exportSession, getDraft,
  type EngineClock, type EngineOptions, type EventPayload,
  type Material, type NativeEditEvidence, type TrainingEvent, type TrainingSnapshot,
} from './training.ts';
import {deriveInputRateTimeline} from './input-rate-timeline.ts';

const material: Material = {id:'passive-test',version:'v1',title:'Restored practice',rights:'original',cues:[
  {id:'one',text:'one two three',start:0,end:6},{id:'two',text:'four five',start:6,end:12},
]};
const typed = (data:string):NativeEditEvidence => ({version:'dom-edit-v1',kind:'input',inputType:'insertText',data});
const ime = (data:string):NativeEditEvidence => ({version:'dom-edit-v1',kind:'compositionend',inputType:null,data});
function driver(name:string, readStep=0) {
  let now=0,serial=0;
  const clock:EngineClock={now:()=>{const value=now;now+=readStep;return value},wallTime:()=>new Date(1_700_000_000_000+now).toISOString(),id:()=>`${name}-${++serial}`};
  return {clock,advance(ms:number){now+=ms},get now(){return now}};
}
function saved(setup?:(engine:TrainingEngine)=>void):TrainingSnapshot {
  const d=driver('saved');
  const engine=new TrainingEngine({clock:d.clock,material,inputObservation:{runId:'saved-page'}});
  engine.input('one two','typed',typed('one two'));d.advance(125);engine.sampleClock();
  setup?.(engine);
  return structuredClone(engine.getSnapshot());
}
function restored(snapshot:TrainingSnapshot=saved(),options:Partial<EngineOptions>={},readStep=0) {
  const d=driver('restored',readStep);
  const engine=new TrainingEngine({snapshot,clock:d.clock,inputObservation:{runId:'restored-page'},restoredReadOnly:true,...options});
  return {...d,engine,tick(ms=1000){d.advance(ms);engine.sampleClock()}};
}
function dispatch(engine:TrainingEngine,payload:EventPayload) {
  const s=engine.getSnapshot();
  engine.dispatch({...payload,eventId:`external-${s.sequence+1}`,sessionId:s.sessionId,sequence:s.sequence+1,
    wallTime:'2026-10-10T00:00:00.000Z',activeMs:s.activeMs,cueId:engine.cue.id,inputVersion:getDraft(s).version,
    schemaVersion:s.schemaVersion,ruleVersion:s.events[0].ruleVersion,paceRuleVersion:s.events[0].paceRuleVersion,
    materialId:s.material.id,materialVersion:s.material.version} as TrainingEvent);
}
function assertPrefix(engine:TrainingEngine,baseline:TrainingSnapshot) {
  assert.deepEqual(engine.getSnapshot().events.slice(0,baseline.events.length),baseline.events);
  assert.deepEqual(replay(engine.getSnapshot().events),engine.getSnapshot());
}

test('passive admission requires opt-in, a restored snapshot, and whole saved baseline equality',()=>{
  const baseline=saved();
  assert.equal(restored(baseline).engine.isPassiveRestored,true);
  assert.equal(restored(baseline,{restoredReadOnly:false}).engine.isPassiveRestored,false);
  assert.equal(new TrainingEngine({clock:driver('fresh').clock,material,restoredReadOnly:true}).isPassiveRestored,false);
  // Same session and sequence are insufficient, including tiny derived differences.
  for(const mismatch of [{earnedWords:99},{pace:baseline.pace+0.0000000001},{roundId:'other'},{frozenReasons:['paused']}]) {
    const forged={...baseline,...mismatch} as TrainingSnapshot;
    const engine=restored(forged).engine;
    assert.equal(engine.isPassiveRestored,false);
    assert.deepEqual(engine.getSnapshot(),baseline);
  }
});

test('settled restore with no freeze reasons stays byte-identical during all browsing inputs',()=>{
  const baseline=saved();assert.deepEqual(baseline.frozenReasons,[]);
  const before=JSON.stringify(baseline),exports=exportSession(baseline,'2026-10-10T00:00:00.000Z');
  const f=restored(baseline),initial=f.engine.getSnapshot();let notifications=0;
  f.engine.subscribe(()=>notifications++);
  for(let i=0;i<5;i++) {
    for(const reason of ['background','modal','listening','idle'] as const) {
      f.engine.setFrozen(reason,true);f.tick(60_000);f.engine.tick(60_000);f.engine.setFrozen(reason,false);
    }
    f.engine.setInputObservationFocused(false);f.tick(60_000);f.engine.setInputObservationFocused(true);
  }
  assert.equal(f.engine.isPassiveRestored,true);assert.equal(f.engine.getSnapshot(),initial);assert.equal(notifications,0);
  assert.equal(JSON.stringify(f.engine.getSnapshot()),before);
  assert.deepEqual(exportSession(f.engine.getSnapshot(),'2026-10-10T00:00:00.000Z'),exports);
  assert.throws(()=>f.engine.tick(-1),/Elapsed/);assert.throws(()=>f.engine.tick(Infinity),/Elapsed/);
});

test('first committed input excludes the entire browsing wait and starts new observation coverage',()=>{
  const baseline=saved(),f=restored(baseline);f.tick(3_600_000);
  f.engine.input('one two three','typed',typed(' three'));
  const state=f.engine.getSnapshot(),tail=state.events.slice(baseline.events.length);
  assert.equal(f.engine.isPassiveRestored,false);assert.deepEqual(tail.map(e=>e.type),['inputCommitted']);
  assert.equal(state.activeMs,baseline.activeMs);assert.equal(state.pace,baseline.pace+120);
  assert.equal(tail[0].inputObservation?.runId,'restored-page');assert.equal(tail[0].inputObservation?.atMs,3_600_000);
  assert.equal(tail[0].inputObservation?.restartReason,'start');assert.equal(deriveInputRateTimeline(state).points.at(-1)?.cpm,null);
  f.tick(1000);assert.equal(f.engine.getSnapshot().activeMs,baseline.activeMs+1000);
  assertPrefix(f.engine,baseline);
});

test('activation reconciles only current environment diffs without sampling or floating drift',()=>{
  const baseline=saved(engine=>{for(const reason of ['background','modal','listening','idle'] as const)engine.setFrozen(reason,true)});
  const f=restored(baseline,{},0.01);
  for(const reason of ['background','modal','listening','idle'] as const)f.engine.setFrozen(reason,false);
  // Transient modal changes leave only the final environment, not a synthetic history.
  f.engine.setFrozen('modal',true);f.engine.setFrozen('modal',false);f.advance(3_600_000);
  f.engine.input(f.engine.draft,'typed',typed('two'));
  const state=f.engine.getSnapshot(),tail=state.events.slice(baseline.events.length);
  assert.deepEqual(tail.map(e=>e.type),['freezeChanged','freezeChanged','freezeChanged','freezeChanged','inputCommitted']);
  assert.deepEqual(tail.filter(e=>e.type==='freezeChanged').map(e=>[e.reason,e.on]),[
    ['background',false],['modal',false],['listening',false],['idle',false],
  ]);
  assert.ok(tail.every(e=>e.activeMs===baseline.activeMs));assert.equal(state.activeMs,baseline.activeMs);assert.equal(state.pace,baseline.pace);
  assert.equal(getDraft(state).version,getDraft(baseline).version);assert.equal(state.attempts.length,baseline.attempts.length);
  assertPrefix(f.engine,baseline);
});

test('runtime blockers are installed before first input without clearing saved pause or review facts',()=>{
  const baseline=saved(engine=>{engine.submit();engine.setFrozen('paused',true)}),f=restored(baseline);
  f.engine.setFrozen('modal',true);f.engine.setFrozen('background',true);f.engine.setFrozen('listening',true);
  f.engine.setFrozen('idle',true);f.engine.setInputObservationFocused(false);f.tick(90_000);
  f.engine.activatePractice();
  const state=f.engine.getSnapshot(),tail=state.events.slice(baseline.events.length);
  assert.deepEqual(tail.map(e=>e.type),['freezeChanged','freezeChanged','freezeChanged','freezeChanged']);
  assert.ok(state.frozenReasons.includes('paused'));assert.ok(state.frozenReasons.includes('review'));
  assert.equal(state.activeMs,baseline.activeMs);assert.equal(state.pace,baseline.pace);
  assert.deepEqual(state.attempts,baseline.attempts);assert.deepEqual(state.drafts,baseline.drafts);
  f.engine.input('one two three','typed',typed(' three'));
  assert.equal(f.engine.getSnapshot().pace,baseline.pace);assert.ok(f.engine.getSnapshot().frozenReasons.includes('paused'));
  assert.equal(f.engine.getSnapshot().events.at(-1)?.inputObservation,undefined);
  assertPrefix(f.engine,baseline);
});

test('passive focus changes are remembered but cannot establish observation',()=>{
  const f=restored();f.engine.setInputObservationFocused(false);f.tick(60_000);
  f.engine.input('one two three','typed',typed(' three'));
  assert.equal(f.engine.getSnapshot().events.at(-1)?.inputObservation,undefined);
  f.engine.setInputObservationFocused(true);f.tick(1000);
  assert.equal(f.engine.getSnapshot().events.at(-1)?.inputObservation,undefined);
  f.engine.input('one two three!','typed',typed('!'));
  assert.equal(f.engine.getSnapshot().events.at(-1)?.inputObservation?.restartReason,'start');
});

const firstActions:readonly [string,(engine:TrainingEngine)=>unknown,readonly string[]][]=[
  ['changed input',engine=>engine.input('one two three','typed',typed(' three')),['inputCommitted']],
  ['same-text native input',engine=>engine.input(engine.draft,'typed',typed('two')),['inputCommitted']],
  ['compositionstart',engine=>engine.beginComposition(),['compositionStarted']],
  ['compositionend with real final text',engine=>engine.endComposition('one two三',ime('三')),['compositionEnded','inputCommitted']],
  ['submit restored draft',engine=>engine.submit(),['submitRequested','judgmentApplied']],
  ['hint',engine=>engine.exposeHint('hint'),['hintExposed']],
  ['reveal',engine=>engine.exposeHint('reveal'),['hintExposed']],
  ['same cue continue',engine=>engine.nextCue(0),[]],
  ['different cue',engine=>engine.nextCue(1),['cueChanged']],
  ['whole-practice pause',engine=>engine.setFrozen('paused',true),['freezeChanged']],
  ['explicit host practice intent',engine=>engine.activatePractice(),[]],
];
for(const [name,action,eventTypes] of firstActions) test(`${name} activates synchronously and executes once after the passive wait`,()=>{
  const baseline=saved(),f=restored(baseline);f.tick(600_000);action(f.engine);
  assert.equal(f.engine.isPassiveRestored,false);
  assert.deepEqual(f.engine.getSnapshot().events.slice(baseline.events.length).map(e=>e.type),eventTypes);
  assert.equal(f.engine.getSnapshot().activeMs,baseline.activeMs);assertPrefix(f.engine,baseline);
});

test('whole-practice resume preserves saved pause until the explicit command',()=>{
  const baseline=saved(engine=>engine.setFrozen('paused',true)),f=restored(baseline);f.tick(600_000);
  assert.ok(f.engine.getSnapshot().frozenReasons.includes('paused'));
  f.engine.setFrozen('paused',false);
  assert.equal(f.engine.isPassiveRestored,false);assert.deepEqual(f.engine.getSnapshot().frozenReasons,[]);
  assert.equal(f.engine.getSnapshot().activeMs,baseline.activeMs);f.tick();assert.equal(f.engine.getSnapshot().activeMs,baseline.activeMs+1000);
});

test('reset activates once, creates a new ordinary session, and leaves old baseline exportable',()=>{
  const baseline=saved(),before=JSON.stringify(baseline),f=restored(baseline);f.tick(600_000);f.engine.resetSession();
  const state=f.engine.getSnapshot();assert.equal(f.engine.isPassiveRestored,false);assert.notEqual(state.sessionId,baseline.sessionId);
  assert.deepEqual(state.events.map(e=>e.type),['sessionStarted']);assert.equal(state.activeMs,0);assert.equal(state.earnedWords,0);
  assert.equal(JSON.stringify(baseline),before);assert.deepEqual(JSON.parse(exportSession(baseline).json).session,baseline);
  f.engine.setFrozen('modal',true);assert.equal(f.engine.getSnapshot().sequence,2);
});

test('constructor composition, pending judgment, and orphan checking recovery remain active and canonical',()=>{
  for(const setup of [
    (engine:TrainingEngine)=>engine.beginComposition(),
    (engine:TrainingEngine)=>dispatch(engine,{type:'submitRequested',attemptId:'pending',answer:engine.draft,draftVersion:getDraft(engine.getSnapshot()).version}),
    (engine:TrainingEngine)=>engine.setFrozen('checking',true),
  ]) {
    const baseline=saved(setup),plain=restored(baseline,{restoredReadOnly:false}).engine,requested=restored(baseline).engine;
    assert.equal(requested.isPassiveRestored,false);assert.ok(requested.getSnapshot().sequence>baseline.sequence);
    assert.deepEqual(requested.getSnapshot(),plain.getSnapshot());assert.equal(requested.getSnapshot().activeMs,baseline.activeMs);
    assert.equal(requested.getSnapshot().frozenReasons.includes('composition'),false);
    assert.equal(requested.getSnapshot().frozenReasons.includes('checking'),false);assertPrefix(requested,baseline);
  }
});

test('after activation, all pause boundaries retain active time and restart a complete observation window',()=>{
  for(const reason of ['modal','background','paused','listening'] as const) {
    const baseline=saved(),f=restored(baseline);f.tick(60_000);f.engine.input('one two three','typed',typed(' three'));
    for(let i=0;i<5;i++)f.tick();
    assert.equal(deriveInputRateTimeline(f.engine.getSnapshot()).points.at(-1)?.state,'measured');
    f.advance(250);f.engine.setFrozen(reason,true);
    assert.equal(f.engine.getSnapshot().activeMs,baseline.activeMs+5250);
    const pace=f.engine.getSnapshot().pace;f.tick(30_000);f.engine.setFrozen(reason,false);
    assert.equal(f.engine.isPassiveRestored,false);assert.equal(f.engine.getSnapshot().activeMs,baseline.activeMs+5250);assert.equal(f.engine.getSnapshot().pace,pace);
    assert.equal(deriveInputRateTimeline(f.engine.getSnapshot()).points.at(-1)?.state,'sampling');
    for(let i=0;i<4;i++)f.tick();assert.equal(deriveInputRateTimeline(f.engine.getSnapshot()).points.at(-1)?.cpm,null);
    f.tick();assert.equal(deriveInputRateTimeline(f.engine.getSnapshot()).points.at(-1)?.state,'measured');assertPrefix(f.engine,baseline);
  }
});

test('first six-second IME preserves observation, freezes practice, commits once, and accepts empty cancel',()=>{
  for(const cancel of [false,true]) {
    const baseline=saved(),f=restored(baseline);f.tick(60_000);f.engine.beginComposition();
    for(let i=0;i<6;i++)f.tick();
    assert.equal(f.engine.getSnapshot().activeMs,baseline.activeMs);
    const before=getDraft(f.engine.getSnapshot()).version;
    const text=cancel?f.engine.draft:`${f.engine.draft}你好`;
    f.engine.endComposition(text,ime(cancel?'':'你好'));const committed=f.engine.getSnapshot();f.engine.input(text);
    assert.equal(f.engine.getSnapshot(),committed);assert.equal(getDraft(committed).version,before+(cancel?0:1));
    const point=deriveInputRateTimeline(committed).points.at(-1)!;assert.equal(point.observedMs,5000);assert.equal(point.cpm,cancel?0:24);
    assert.equal(committed.events.slice(baseline.events.length).filter(e=>e.type==='inputCommitted').length,cancel?0:1);
    assertPrefix(f.engine,baseline);
  }
});

test('opt-out restored engines retain ordinary active sampling and environment writes',()=>{
  const baseline=saved(),f=restored(baseline,{restoredReadOnly:false});f.advance(1000);f.engine.setFrozen('modal',true);
  assert.equal(f.engine.getSnapshot().activeMs,baseline.activeMs+1000);
  assert.deepEqual(f.engine.getSnapshot().events.slice(baseline.events.length).map(e=>e.type),['timeAdvanced','freezeChanged']);
  f.engine.setFrozen('modal',false);f.engine.activatePractice();f.tick();
  assert.equal(f.engine.getSnapshot().activeMs,baseline.activeMs+2000);assertPrefix(f.engine,baseline);
});
