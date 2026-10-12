import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,latest,types,native,ime,assertPrefix,TrainingEngine,PageInputGate,getDraft,replay,exportStudioSession,studio} from './passive-restored-first-actions-harness.mjs';

const idleDraft=(engine)=>{engine.input('Saved draft','typed',native('Saved draft'));engine.setFrozen('idle',true)};
const correctDraft=engine=>{engine.input(engine.cue.text,'typed',native(engine.cue.text));engine.submit()};
const firstObservation=h=>h.suffix().find(e=>e.inputObservation)?.inputObservation;
const learning=s=>({drafts:s.drafts,attempts:s.attempts,earnedWords:s.earnedWords,completedCueIds:s.completedCueIds,confirmedPositions:s.confirmedPositions});

test('a stale rendered course kind cannot activate practice after the current source already changed',async()=>{
  const h=fixture({restored:true,seed:idleDraft});h.state.mediaRef.current.kind='video';
  h.state.commands.togglePlay();await Promise.resolve();
  assert.equal(h.engine.isPassiveRestored,true);assert.deepEqual(h.engine.getSnapshot(),h.saved);
  assert.equal(firstObservation(h),undefined);
});

test('settled full restore alone replays an exact prefix, keeps learning and has no new-page observation',()=>{
  const h=fixture({restored:true,seed:idleDraft});
  assert.deepEqual(h.engine.getSnapshot(),h.saved);assertPrefix(h);assert.equal(h.gate.started,false);
  h.advance(30000);
  assert.deepEqual(h.engine.getSnapshot(),h.saved);assert.equal(firstObservation(h),undefined);
});

test('actual first typed input on an idle restore commits once at the action time and starts fresh observation',()=>{
  const h=fixture({restored:true,seed:idleDraft});h.advance(30000);h.input('Saved draft!','!');
  assert.deepEqual(types(h.suffix()),['inputCommitted']);assertPrefix(h);
  assert.equal(getDraft(h.engine.getSnapshot()).version,getDraft(h.saved).version+1);
  assert.equal(h.engine.getSnapshot().activeMs,h.saved.activeMs);assert.equal(h.gate.started,true);
  assert.equal(firstObservation(h).runId,'restored-page');assert.equal(firstObservation(h).atMs,30000);
  assert.equal(firstObservation(h).restartReason,'start');assert.equal(latest(h).cpm,null);assert.equal(latest(h).observedMs,0);
  for(let i=0;i<4;i++)h.tick();assert.equal(latest(h).cpm,null);
  h.tick();assert.equal(latest(h).observedMs,5000);assert.equal(latest(h).cpm,0);
});

test('actual same-text native replacement is activity without a new draft, score, attempt, energy or display activation',()=>{
  const h=fixture({restored:true,seed:correctDraft});const before=h.engine.getSnapshot();h.advance(30000);h.input(h.engine.draft,'A');
  assert.deepEqual(types(h.suffix()),['inputCommitted']);assertPrefix(h);
  assert.deepEqual(learning(h.engine.getSnapshot()),learning(before));assert.equal(h.engine.getSnapshot().pace,before.pace);
  assert.equal(h.engine.getSnapshot().activeMs,before.activeMs);assert.equal(h.gate.started,false);
  assert.equal(h.engine.currentResult.attemptId,before.attempts.at(-1).attemptId);
  assert.equal(firstObservation(h).atMs,30000);assert.equal(firstObservation(h).restartReason,'start');
  assert.equal(h.engine.getSnapshot().frozenReasons.includes('review'),false);
  assert.equal(h.calls.some(c=>c[0]==='sound'),false);
});

test('actual first six-second IME records timing, no candidate text, and exactly one final Unicode commit',()=>{
  const h=fixture({restored:true});h.advance(30000);h.startIME();
  assert.deepEqual(types(h.suffix()),['compositionStarted']);assert.equal(h.gate.started,false);
  const beforeCandidate=JSON.stringify(h.engine.getSnapshot());h.input('candidate text','candidate');
  assert.equal(JSON.stringify(h.engine.getSnapshot()),beforeCandidate);
  for(let i=0;i<6;i++)h.tick();
  assert.equal(latest(h).observedMs,5000);assert.equal(latest(h).cpm,0);assert.equal(h.engine.getSnapshot().activeMs,0);
  assert.equal(firstObservation(h).atMs,30000);assert.equal(firstObservation(h).runId,'restored-page');
  h.endIME('👩‍💻é','👩‍💻é');
  assert.equal(h.suffix().filter(e=>e.type==='inputCommitted').length,1);
  assert.equal(h.engine.draft,'👩‍💻é');assert.equal(getDraft(h.engine.getSnapshot()).version,1);
  assert.equal(latest(h).cpm,24);assert.equal(latest(h).addedGraphemes,2);assert.equal(latest(h).sourceEventIds.length,1);
  assert.equal(latest(h).includesIME,true);assert.equal(h.engine.getSnapshot().activeMs,0);
  assert.equal(h.engine.getSnapshot().attempts.length,0);assert.equal(h.engine.getSnapshot().earnedWords,0);
  assert.equal(h.gate.started,true);assertPrefix(h);
  for(const event of h.suffix().filter(e=>e.type==='inputObservationSampled')){
    assert.equal('text' in event,false);assert.equal('data' in event,false);
  }
  assert.doesNotMatch(JSON.stringify(h.engine.getSnapshot().events),/candidate text/);
});

for(const inputType of ['insertText','insertCompositionText','insertFromComposition']){
  test(`actual IME tail ${inputType} is deduplicated once, and later intentional same-text input survives`,()=>{
    const h=fixture({restored:true});h.startIME();for(let i=0;i<6;i++)h.tick();h.endIME('你好','你好');
    const before=JSON.stringify(h.engine.getSnapshot());h.input('你好','你好',inputType);
    assert.equal(JSON.stringify(h.engine.getSnapshot()),before);assert.equal(latest(h).cpm,24);
    h.input('你好','好');assert.equal(h.engine.getSnapshot().events.filter(e=>e.type==='inputCommitted').length,2);
    assert.equal(getDraft(h.engine.getSnapshot()).version,1);assert.equal(latest(h).cpm,36);
  });
}

test('expiring the same-task composition tail permits later same-text replacement',()=>{
  const h=fixture({restored:true});h.startIME();h.endIME('你','你');h.expireTails();h.input('你','你');
  assert.equal(h.suffix().filter(e=>e.type==='inputCommitted').length,2);assert.equal(getDraft(h.engine.getSnapshot()).version,1);
});

test('actual six-second empty IME cancel keeps the old draft, emits no commit and measures zero',()=>{
  const h=fixture({restored:true,seed:idleDraft});h.advance(30000);h.startIME();for(let i=0;i<6;i++)h.tick();
  h.endIME('Saved draft','');h.input('Saved draft','', 'insertCompositionText');
  assert.equal(h.suffix().filter(e=>e.type==='inputCommitted').length,0);
  assert.deepEqual(learning(h.engine.getSnapshot()),learning(h.saved));assert.equal(h.engine.getSnapshot().activeMs,h.saved.activeMs);
  assert.equal(latest(h).state,'measured');assert.equal(latest(h).cpm,0);assert.equal(latest(h).unknownEventIds.length,0);
  assert.equal(h.gate.started,false);assertPrefix(h);
});

test('missing final IME data remains unavailable; a changed draft with empty data is not invented zero',()=>{
  for(const data of [null,'']){
    const h=fixture({restored:true});h.startIME();for(let i=0;i<6;i++)h.tick();h.endIME('你',data);
    assert.equal(latest(h).state,'unavailable');assert.equal(latest(h).cpm,null);assert.equal(latest(h).unknownEventIds.length,1);
  }
});

test('actual submit judges an old restored draft once without demanding new text or starting input coverage',()=>{
  const h=fixture({restored:true,seed:idleDraft});h.advance(30000);h.state.commands.submit();
  assert.deepEqual(types(h.suffix()),['submitRequested','judgmentApplied']);assertPrefix(h);
  assert.equal(h.engine.getSnapshot().attempts.length,1);assert.equal(h.engine.getSnapshot().attempts[0].answer,'Saved draft');
  assert.deepEqual(h.engine.getSnapshot().drafts,h.saved.drafts);assert.equal(h.engine.getSnapshot().activeMs,h.saved.activeMs);
  assert.equal(firstObservation(h),undefined);assert.equal(h.gate.started,false);
  const after=JSON.stringify(h.engine.getSnapshot());h.state.commands.submit();
  assert.equal(JSON.stringify(h.engine.getSnapshot()),after);assert.equal(h.calls.filter(c=>c[0]==='sound').length,1);
});

test('actual submit on an already correct old answer uses next cue once without duplicate judgment or credit',()=>{
  const h=fixture({restored:true,seed:correctDraft});h.advance(30000);h.state.commands.submit();
  assert.deepEqual(types(h.suffix()),['cueChanged']);assert.equal(h.engine.getSnapshot().cueIndex,1);
  assert.deepEqual(learning(h.engine.getSnapshot()),learning(h.saved));assert.equal(h.gate.started,false);
  assert.equal(h.calls.some(c=>c[0]==='sound'),false);assertPrefix(h);
});

test('actual hint and reveal expose conditions without changing text; hiding subtitles adds no new fact',()=>{
  const h=fixture({restored:true,seed:idleDraft});h.advance(30000);h.state.handlers.hint();h.state.commands.reveal();
  assert.deepEqual(types(h.suffix()),['hintExposed','hintExposed']);
  const draft=getDraft(h.engine.getSnapshot());assert.equal(draft.text,'Saved draft');assert.equal(draft.version,getDraft(h.saved).version);
  assert.equal(draft.hinted,true);assert.equal(draft.revealed,true);assert.equal(h.gate.started,false);assert.equal(firstObservation(h),undefined);
  const after=JSON.stringify(h.engine.getSnapshot());h.state.commands.reveal();assert.equal(JSON.stringify(h.engine.getSnapshot()),after);
  assert.equal(h.engine.getSnapshot().activeMs,h.saved.activeMs);assertPrefix(h);
});

test('actual explicit cue change preserves drafts/attempts and same-cue selection remains a no-op in current engine',()=>{
  const h=fixture({restored:true,seed:idleDraft});h.advance(30000);h.state.commands.changeCue(1,false);
  assert.deepEqual(types(h.suffix()),['cueChanged']);assert.equal(h.engine.getSnapshot().cueIndex,1);
  assert.deepEqual(learning(h.engine.getSnapshot()),learning(h.saved));assert.equal(h.gate.started,false);
  const after=JSON.stringify(h.engine.getSnapshot());h.state.commands.changeCue(1,false);assert.equal(JSON.stringify(h.engine.getSnapshot()),after);
  assertPrefix(h);
});

test('actual continue-review handler closes review, follows the existing cue command, and preserves both old drafts',()=>{
  const h=fixture({restored:true,seed:engine=>{correctDraft(engine);engine.input('pending correction','typed',native('pending correction'));engine.nextCue(1);engine.input('second old draft','typed',native('second old draft'));engine.setFrozen('idle',true)}});
  h.engine.setFrozen('modal',true);h.state.panel='review';h.state.reviewSnapshot=h.engine.getSnapshot();const before=h.engine.getSnapshot();
  h.advance(30000);h.state.commands.continueRoundReview('cup');
  assert.equal(h.engine.getSnapshot().cueIndex,0);assert.equal(h.engine.draft,'pending correction');
  assert.deepEqual(learning(h.engine.getSnapshot()),learning(before));assert.equal(h.gate.started,false);
  assert.deepEqual(h.calls.filter(c=>['closePanel','dialogClose','syncDraft','focus'].includes(c[0])),[
    ['closePanel',false],['dialogClose'],['syncDraft','pending correction'],['focus'],
  ]);
  const after=JSON.stringify(h.engine.getSnapshot());h.state.commands.continueRoundReview('cup');assert.equal(JSON.stringify(h.engine.getSnapshot()),after);
});

test('actual whole-practice pause/resume is synchronous, preserves facts, and resume never starts media',()=>{
  const h=fixture({restored:true,seed:idleDraft});h.advance(30000);h.state.commands.pauseTraining();
  assert.equal(h.engine.getSnapshot().frozenReasons.includes('paused'),true);assert.equal(h.calls.filter(c=>c[0]==='interruptRecording').length,1);
  h.tick(20000);h.state.commands.pauseTraining();assert.equal(h.engine.getSnapshot().frozenReasons.includes('paused'),false);
  assert.deepEqual(learning(h.engine.getSnapshot()),learning(h.saved));assert.equal(h.engine.getSnapshot().activeMs,h.saved.activeMs);
  assert.equal(h.calls.some(c=>c[0]==='playLesson'),false);assert.equal(h.gate.started,false);
  assert.deepEqual(h.suffix().filter(e=>e.type==='freezeChanged').map(e=>[e.reason,e.on]),[['paused',true],['paused',false]]);
});

test('actual pause during IME discards interrupted candidate/end/tail without manufacturing a commit',()=>{
  const h=fixture({restored:true,seed:idleDraft});h.startIME();h.tick();h.target.value='uncommitted candidate';h.state.commands.pauseTraining();
  assert.equal(h.target.value,'Saved draft');h.endIME('uncommitted candidate','candidate');h.input('uncommitted candidate','candidate','insertFromComposition');
  assert.equal(h.engine.draft,'Saved draft');assert.equal(h.suffix().filter(e=>e.type==='inputCommitted').length,0);
  assert.deepEqual(learning(h.engine.getSnapshot()),learning(h.saved));assert.equal(h.gate.started,false);
});

test('actual explicit listening uses play/pause events, preserves text/score, and starts no input coverage',()=>{
  const h=fixture({restored:true,seed:idleDraft});h.advance(30000);h.state.commands.togglePlay(true);
  assert.equal(h.calls.filter(c=>c[0]==='playLesson').length,1);assert.equal(h.engine.getSnapshot().frozenReasons.includes('listening'),true);
  h.tick(20000);h.state.commands.togglePlay();
  assert.equal(h.engine.getSnapshot().frozenReasons.includes('listening'),false);
  assert.deepEqual(learning(h.engine.getSnapshot()),learning(h.saved));assert.equal(firstObservation(h),undefined);assert.equal(h.gate.started,false);
  assert.equal(h.engine.getSnapshot().activeMs,h.saved.activeMs);
});

test('candidate automatic media callbacks update runtime only and keep the restored snapshot passive',()=>{
  const h=fixture({restored:true,seed:idleDraft});h.state.mediaCallbacks.onPlay();h.state.mediaCallbacks.onPause();
  assert.deepEqual(h.suffix(),[]);assert.equal(h.engine.isPassiveRestored,true);
  assert.equal(h.calls.some(c=>c[0]==='playLesson'),false);
});

test('paused timeline seeking currently changes media position only and invents no Training command',()=>{
  const start=studio.indexOf(' function dragTimeline('),end=studio.indexOf(' function loadDemo(',start);
  const source=studio.slice(start,end);assert.ok(start>=0&&end>start);
  assert.match(source,/seekTo\(/);assert.doesNotMatch(source,/engineRef|setFrozen|\.input\(|\.nextCue\(/);
});

test('actual post-input blur excludes blocked time and requires a new full five-second observation window',()=>{
  const h=fixture({restored:true});h.input('a','a');for(let i=0;i<5;i++)h.tick();
  h.advance(250);h.state.handlers.onBlur();assert.equal(h.engine.getSnapshot().activeMs,5250);assert.equal(latest(h).state,'frozen');
  h.tick(20000);h.state.handlers.onFocus();assert.equal(h.engine.getSnapshot().activeMs,5250);assert.equal(latest(h).state,'sampling');
  h.input('ab','b');for(let i=0;i<4;i++)h.tick();assert.equal(latest(h).cpm,null);h.tick();assert.equal(latest(h).state,'measured');
  assert.equal(h.engine.getSnapshot().activeMs,10250);assert.equal(h.gate.started,true);
});

for(const reason of ['modal','background','paused']){
  test(`post-input ${reason} boundary preserves time up to the boundary and excludes the blocked interval`,()=>{
    const h=fixture({restored:true});h.input('a','a');for(let i=0;i<5;i++)h.tick();h.advance(250);
    if(reason==='paused')h.state.commands.pauseTraining();else h.engine.setFrozen(reason,true);
    assert.equal(h.engine.getSnapshot().activeMs,5250);assert.equal(latest(h).state,'frozen');h.tick(20000);
    if(reason==='paused')h.state.commands.pauseTraining();else h.engine.setFrozen(reason,false);
    assert.equal(h.engine.getSnapshot().activeMs,5250);assert.equal(latest(h).cpm,null);assert.equal(latest(h).state,'sampling');
    for(let i=0;i<4;i++)h.tick();assert.equal(latest(h).cpm,null);h.tick();assert.equal(latest(h).observedMs,5000);
    assert.equal(h.engine.getSnapshot().activeMs,10250);assert.equal(h.gate.started,true);assertPrefix(h);
  });
}

test('constructor composition recovery remains an appended recovery fact, not an untouched baseline',()=>{
  const h=fixture({restored:true,seed:engine=>{idleDraft(engine);engine.beginComposition()}});
  assert.deepEqual(types(h.suffix()),['compositionEnded']);assert.equal(h.engine.getSnapshot().frozenReasons.includes('composition'),false);
  assert.deepEqual(learning(h.engine.getSnapshot()),learning(h.saved));assertPrefix(h);
});

test('constructor pending-judgment recovery remains deterministic and does not replay a submission sound',()=>{
  const f=fixture();f.engine.input(f.engine.cue.text,'typed',native(f.engine.cue.text));f.engine.submit();
  const state=f.engine.getSnapshot();const pending=replay(state.events.slice(0,-1));
  const restored=new TrainingEngine({snapshot:pending,clock:f.clock,inputObservation:{runId:'recovery'}});
  assert.equal(restored.getSnapshot().sequence,pending.sequence+1);assert.equal(restored.getSnapshot().events.at(-1).type,'judgmentApplied');
  assert.equal(restored.getSnapshot().attempts.length,1);assert.equal(restored.getSnapshot().earnedWords,3);
  assert.deepEqual(restored.getSnapshot().events.slice(0,pending.events.length),pending.events);
  assert.equal(f.calls.some(c=>c[0]==='sound'),false);
});

test('candidate unfrozen restore excludes all elapsed passive time before first actual input',()=>{
  const h=fixture({restored:true,seed:engine=>engine.input('saved active','typed',native('saved active'))});
  h.advance(30000);h.input('saved active!','!');
  assert.deepEqual(types(h.suffix()),['inputCommitted']);assert.equal(h.engine.getSnapshot().activeMs,0);assert.equal(h.engine.isPassiveRestored,false);
  assert.equal(firstObservation(h).atMs,30000);assert.equal(firstObservation(h).restartReason,'start');assertPrefix(h);
});

test('replay, JSON and CSV retain the untouched original prefix and additive new input evidence',()=>{
  const h=fixture({restored:true,seed:idleDraft});const old=JSON.stringify(h.saved);h.advance(30000);h.input('Saved draft!','!');h.state.commands.submit();
  const state=h.engine.getSnapshot(),output=exportStudioSession(state,'2026-10-10T07:30:00.000Z'),json=JSON.parse(output.json);
  assert.equal(JSON.stringify(h.saved),old);assertPrefix(h);assert.deepEqual(replay(state.events),state);
  assert.deepEqual(json.rawEvents.slice(0,h.saved.events.length),h.saved.events);
  assert.equal(output.csv.includes('input-observation-v1'),true);assert.equal(output.csv.includes('Saved draft!'),true);
});

for(const [name,seed,action] of [
  ['typed',idleDraft,h=>h.input('Saved draft!','!')],
  ['native same-text',idleDraft,h=>h.input('Saved draft','S')],
  ['compositionstart',idleDraft,h=>h.startIME()],
  ['final composition commit without observed start',idleDraft,h=>h.endIME('Saved draft你','你')],
  ['old draft submit',idleDraft,h=>h.state.commands.submit()],
  ['hint',idleDraft,h=>h.state.handlers.hint()],
  ['reveal',idleDraft,h=>h.state.commands.reveal()],
  ['different cue',idleDraft,h=>h.state.commands.changeCue(1,false)],
  ['same cue',idleDraft,h=>h.state.commands.changeCue(0,false)],
  ['whole pause',idleDraft,h=>h.state.commands.pauseTraining()],
  ['whole resume',e=>{idleDraft(e);e.setFrozen('paused',true)},h=>h.state.commands.pauseTraining()],
  ['explicit lesson play',idleDraft,h=>h.state.commands.togglePlay()],
  ['explicit lesson replay',idleDraft,h=>h.state.commands.togglePlay(true)],
]){
  test(`candidate original first ${name} handler activates synchronously without treating presentation as authority`,()=>{
    const h=fixture({restored:true,seed});assert.equal(h.engine.isPassiveRestored,true);
    h.tick(30000);assert.equal(h.engine.isPassiveRestored,true);assert.deepEqual(h.engine.getSnapshot(),h.saved);
    action(h);assert.equal(h.engine.isPassiveRestored,false);assertPrefix(h);
    assert.equal(h.engine.getSnapshot().activeMs,h.saved.activeMs);
  });
}

test('candidate explicit same-cue review continue activates even though no cueChanged is needed',()=>{
  const h=fixture({restored:true,seed:idleDraft});h.engine.setFrozen('modal',true);h.state.panel='review';h.state.reviewSnapshot=h.engine.getSnapshot();
  h.advance(30000);h.state.commands.continueRoundReview('cup');
  assert.equal(h.engine.isPassiveRestored,false);assert.equal(h.engine.getSnapshot().cueIndex,0);
  assert.deepEqual(h.engine.getSnapshot(),h.saved);assert.equal(h.gate.started,false);
  assert.ok(h.calls.some(c=>c[0]==='closePanel'));assert.ok(h.calls.some(c=>c[0]==='focus'));
});

test('candidate explicit pause of an already playing lesson activates before the pause callback',()=>{
  const h=fixture({restored:true,seed:idleDraft});h.video.paused=false;h.state.mediaCallbacks.onPlay();
  assert.equal(h.engine.isPassiveRestored,true);assert.deepEqual(h.engine.getSnapshot(),h.saved);
  h.advance(30000);let passiveAtPause=null;
  const originalPause=h.video.pause.bind(h.video);h.video.pause=()=>{passiveAtPause=h.engine.isPassiveRestored;originalPause()};
  h.state.commands.togglePlay();assert.equal(passiveAtPause,false);assert.equal(h.engine.isPassiveRestored,false);
  assert.equal(h.engine.getSnapshot().frozenReasons.includes('listening'),false);
  assert.equal(h.engine.getSnapshot().activeMs,h.saved.activeMs);assertPrefix(h);
});

test('candidate rejected lesson play activates intent but invents no successful listening/input/credit facts',async()=>{
  const h=fixture({restored:true,seed:idleDraft});h.video.play=()=>Promise.reject(new Error('NotAllowedError fixture'));
  h.advance(30000);h.state.commands.togglePlay();assert.equal(h.engine.isPassiveRestored,false);
  await Promise.resolve();await Promise.resolve();
  assert.deepEqual(h.engine.getSnapshot(),h.saved);assert.equal(firstObservation(h),undefined);
  assert.equal(h.calls.filter(c=>c[0]==='notice').length,1);assert.equal(h.video.paused,true);
});

for(const mode of ['video','image','unknown','fixture','replay']){
  test(`candidate explicit media action in ${mode} mode does not activate restored Training`,()=>{
    const h=fixture({restored:true,seed:idleDraft});
    if(mode==='fixture')h.state.fixture=true;else if(mode==='replay')h.state.replaySnapshot.current=h.saved;
    else {h.state.mediaKind=mode;h.state.mediaRef.current.kind=mode}
    h.advance(30000);h.state.commands.togglePlay(true);
    assert.equal(h.engine.isPassiveRestored,true);assert.deepEqual(h.engine.getSnapshot(),h.saved);
    h.state.mediaCallbacks.onPause();assert.equal(h.engine.isPassiveRestored,true);assert.deepEqual(h.engine.getSnapshot(),h.saved);
  });
}

test('candidate passive focus/blur/background/modal/automatic media/timers preserve snapshot and observation',()=>{
  const h=fixture({restored:true,seed:e=>e.input('unfrozen saved','typed',native('unfrozen saved'))});
  const savedJSON=JSON.stringify(h.saved);
  for(let i=0;i<3;i++){
    h.advance(10000);h.state.handlers.onBlur();h.engine.setFrozen('modal',true);h.engine.setFrozen('background',true);
    h.state.mediaCallbacks.onPlay();h.tick(10000);h.engine.tick(10000);h.state.mediaCallbacks.onPause();
    h.engine.setFrozen('background',false);h.engine.setFrozen('modal',false);h.state.handlers.onFocus();h.tick(10000);
    assert.equal(h.engine.isPassiveRestored,true);assert.equal(JSON.stringify(h.engine.getSnapshot()),savedJSON);
  }
  assert.equal(firstObservation(h),undefined);assert.equal(h.gate.started,false);
  h.input('unfrozen saved!','!');assert.equal(h.engine.isPassiveRestored,false);assert.equal(h.engine.getSnapshot().activeMs,h.saved.activeMs);
  assert.equal(firstObservation(h).atMs,h.now());assert.equal(firstObservation(h).runId,'restored-page');
  assert.equal(h.suffix().filter(e=>e.type==='inputCommitted').length,1);assertPrefix(h);
});

test('candidate presentation reset and later environment changes never reenter passive after activation',()=>{
  const h=fixture({restored:true,seed:idleDraft});h.input('Saved draft!','!');assert.equal(h.engine.isPassiveRestored,false);
  h.gate.begin(h.engine.getSnapshot());assert.equal(h.gate.started,false);assert.equal(h.engine.isPassiveRestored,false);
  h.engine.setFrozen('idle',true);h.engine.setFrozen('modal',true);h.engine.setFrozen('background',true);h.state.handlers.onBlur();
  h.tick(20000);h.engine.setFrozen('background',false);h.engine.setFrozen('modal',false);h.state.handlers.onFocus();
  assert.equal(h.engine.isPassiveRestored,false);assert.ok(h.suffix().some(e=>e.type==='freezeChanged'));
});

test('candidate moving clock does not leak browsing or reconciliation time into first actual input',()=>{
  const seed=fixture({seed:e=>{e.input('old','typed',native('old'));e.setFrozen('background',true);e.setFrozen('modal',true);e.setFrozen('listening',true)}}).engine.getSnapshot();
  let now=100000,id=0;const clock={now:()=>now+=0.01,wallTime:()=>new Date(Date.UTC(2026,9,10)+now).toISOString(),id:()=>`moving-candidate-${++id}`};
  const engine=new TrainingEngine({snapshot:seed,clock,inputObservation:{runId:'moving-candidate'},restoredReadOnly:true});
  assert.equal(engine.isPassiveRestored,true);engine.setFrozen('background',false);engine.setFrozen('modal',false);engine.setFrozen('listening',false);
  now+=30000;engine.sampleClock();engine.tick(30000);assert.deepEqual(engine.getSnapshot(),seed);
  engine.input('old!','typed',native('!'));const suffix=engine.getSnapshot().events.slice(seed.events.length);
  assert.equal(engine.isPassiveRestored,false);assert.equal(engine.getSnapshot().activeMs,seed.activeMs);
  assert.deepEqual(types(suffix),['freezeChanged','freezeChanged','freezeChanged','inputCommitted']);
  assert.deepEqual(suffix.filter(e=>e.type==='freezeChanged').map(e=>[e.reason,e.on]),[['background',false],['modal',false],['listening',false]]);
  assert.equal(suffix.filter(e=>e.inputObservation).length,1);assert.equal(suffix.at(-1).inputObservation.restartReason,'start');
  assert.deepEqual(engine.getSnapshot().events.slice(0,seed.events.length),seed.events);
});

test('candidate exact final environment is reconciled once, without replaying passive panel history',()=>{
  const h=fixture({restored:true,seed:idleDraft});
  for(let i=0;i<10;i++){h.engine.setFrozen('modal',true);h.engine.setFrozen('modal',false)}
  h.engine.setFrozen('background',true);h.engine.setFrozen('listening',true);h.engine.setFrozen('idle',false);h.advance(30000);
  h.state.handlers.hint();assert.equal(h.engine.isPassiveRestored,false);
  assert.deepEqual(h.suffix().filter(e=>e.type==='freezeChanged').map(e=>[e.reason,e.on]),[['background',true],['listening',true],['idle',false]]);
  assert.equal(h.suffix().filter(e=>e.type==='hintExposed').length,1);assert.equal(h.suffix().some(e=>e.reason==='modal'),false);
  assert.equal(h.engine.getSnapshot().activeMs,h.saved.activeMs);assert.equal(firstObservation(h),undefined);
});

for(const [inputType,text] of [['insertFromPaste','pasted text'],['deleteContentBackward','Saved draf'],['historyUndo','older text'],['insertReplacementText','replacement']]){
  test(`candidate first native ${inputType} edit activates once and does not invent counted manual characters`,()=>{
    const h=fixture({restored:true,seed:idleDraft});h.advance(30000);h.input(text,null,inputType);
    assert.equal(h.engine.isPassiveRestored,false);assert.equal(h.suffix().filter(e=>e.type==='inputCommitted').length,1);
    assert.equal(h.engine.getSnapshot().activeMs,h.saved.activeMs);assert.equal(firstObservation(h).atMs,30000);
    for(let i=0;i<5;i++)h.tick();assert.equal(latest(h).cpm,0);assert.equal(h.engine.getSnapshot().earnedWords,h.saved.earnedWords);
  });
}

test('candidate new session and normal restore without explicit verified-readonly request retain original behavior',()=>{
  const h=fixture();assert.equal(h.engine.isPassiveRestored,false);
  const direct=new TrainingEngine({clock:h.clock,restoredReadOnly:true});assert.equal(direct.isPassiveRestored,false);
  const ordinary=fixture({restored:true,readOnly:false,seed:e=>e.input('active','typed',native('active'))});
  assert.equal(ordinary.engine.isPassiveRestored,false);ordinary.advance(30000);ordinary.input('active!','!');
  assert.equal(ordinary.engine.getSnapshot().activeMs,30000);assert.deepEqual(types(ordinary.suffix()),['timeAdvanced','inputCommitted']);
});

test('candidate recovery and canonical mismatch cannot be admitted as an untouched passive snapshot',()=>{
  for(const reason of ['composition','checking']){
    const h=fixture({restored:true,seed:e=>{idleDraft(e);e.setFrozen(reason,true)}});
    assert.equal(h.engine.isPassiveRestored,false);assert.ok(h.suffix().length>0);assertPrefix(h);
  }
  const h=fixture({seed:idleDraft}),saved=h.engine.getSnapshot();
  const tampered={...saved,earnedWords:saved.earnedWords+1};
  const engine=new TrainingEngine({snapshot:tampered,clock:h.clock,restoredReadOnly:true});
  assert.equal(engine.isPassiveRestored,false);assert.deepEqual(engine.getSnapshot(),saved);
  const f=fixture();f.engine.input(f.engine.cue.text,'typed',native(f.engine.cue.text));f.engine.submit();
  const pending=replay(f.engine.getSnapshot().events.slice(0,-1));
  const recovered=new TrainingEngine({snapshot:pending,clock:f.clock,restoredReadOnly:true});
  assert.equal(recovered.isPassiveRestored,false);assert.equal(recovered.getSnapshot().attempts.length,1);
  assert.equal(recovered.getSnapshot().events.at(-1).type,'judgmentApplied');
});
