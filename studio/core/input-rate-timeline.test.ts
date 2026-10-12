import test from 'node:test';
import assert from 'node:assert/strict';
import { TrainingEngine, replay, type NativeEditEvidence, type TrainingSnapshot } from './training';
import { deriveInputRateTimeline } from './input-rate-timeline';
import { CompositionInputTail } from './native-input-evidence';
import { derivePaceTimeline } from './pace-timeline';
import { exportStudioSession } from './session-export';
const native = (inputType: string | null, data: string | null=null): NativeEditEvidence => ({version:'dom-edit-v1',kind:'input',inputType,data});
function fixture() {
  let now=0, wallOffset=0, id=0;
  const clock={now:()=>now,wallTime:()=>new Date(Date.UTC(2026,9,9)+now+wallOffset).toISOString(),id:()=>`input-rate-${++id}`};
  const engine=new TrainingEngine({sessionId:'input-rate-test',clock});
  return {engine,clock,advance:(ms:number)=>{now+=ms},shiftWall:(ms:number)=>{wallOffset+=ms},
    input:(text:string,type='insertText',data?:string)=>{const before=engine.draft;let start=0,tail=0;while(start<before.length&&start<text.length&&before[start]===text[start])start++;while(tail<before.length-start&&tail<text.length-start&&before.at(-1-tail)===text.at(-1-tail))tail++;engine.input(text,'typed',native(type,data??text.slice(start,text.length-tail)))},
    tick:(ms:number)=>{now+=ms;engine.sampleClock()},read:()=>deriveInputRateTimeline(engine.getSnapshot())};
}
const last=(f:ReturnType<typeof fixture>)=>f.read().points.at(-1)!;

test('five seconds means true added graphemes ×12, null warmup, left-open boundary and idle zero',()=>{
  const f=fixture();f.input('a');assert.equal(last(f).cpm,null);assert.equal(last(f).state,'sampling');
  f.advance(1000);f.input('abc');f.advance(1000);f.input('abcde');f.tick(2999);
  assert.equal(last(f).cpm,null);f.tick(1);
  assert.equal(last(f).cpm,48);assert.equal(last(f).wpmEquivalent,9.6);assert.equal(last(f).addedGraphemes,4);
  f.tick(1000);assert.equal(last(f).cpm,24);f.tick(1000);assert.equal(last(f).cpm,0);
});
test('incorrect and replacement typed graphemes count without judging or awarding',()=>{
  const f=fixture();f.input('wrong');f.advance(1000);f.input('wXong');f.tick(4000);
  assert.equal(last(f).cpm,12);assert.equal(f.engine.getSnapshot().attempts.length,0);assert.equal(f.engine.getSnapshot().earnedWords,0);
});
test('paste, deletion, undo, redo, drop and browser replacement never increase CPM',()=>{
  const f=fixture();f.input('a');f.advance(1000);f.engine.input('abcdef','paste',native('insertText'));
  for(const [text,type]of [['abc','deleteContentBackward'],['abcdef','historyUndo'],['abcdefgh','historyRedo'],['abcDROP','insertFromDrop'],['abcAUTO','insertReplacementText']]){f.advance(100);f.input(text,type)}
  f.tick(3500);assert.equal(last(f).cpm,0);assert.equal(last(f).excludedEventIds.length,6);
});
test('unclassified legacy additions poison the window without changing the old energy facts',()=>{
  const f=fixture();f.input('a');f.advance(1000);f.engine.input('abcdef');f.tick(4000);
  assert.equal(last(f).state,'unavailable');assert.equal(last(f).cpm,null);assert.equal(last(f).unknownEventIds.length,1);
  f.tick(1000);assert.equal(last(f).state,'measured');assert.equal(last(f).cpm,0);
  const s=f.engine.getSnapshot(),before=JSON.stringify(s),legacy=derivePaceTimeline(s);
  exportStudioSession(s,'2026-10-09T00:00:00.000Z');assert.equal(JSON.stringify(s),before);assert.deepEqual(derivePaceTimeline(s),legacy);
  const event=s.events.find(e=>e.type==='inputCommitted'&&!e.nativeEdit)!;assert.equal('nativeEdit'in event,false);
});
test('missing and inconsistent native evidence are unavailable, not assumed typed',()=>{
  for(const evidence of [native(null),native('unknownInput'),{version:'dom-edit-v1',kind:'compositionend',inputType:null,data:'👩‍💻'} as NativeEditEvidence]){
    const f=fixture();f.input('a');f.advance(1000);f.engine.input('ab','typed',evidence);f.tick(4000);assert.equal(last(f).cpm,null);assert.equal(last(f).state,'unavailable');
  }
});
test('final IME commits add one grapheme event and preserve the conservative composition gap',()=>{
  const f=fixture();f.input('a');f.tick(1000);f.engine.beginComposition();f.advance(2000);
  f.engine.endComposition('a👩‍💻',{version:'dom-edit-v1',kind:'compositionend',inputType:null,data:'👩‍💻'});
  assert.equal(last(f).includesIME,true);assert.equal(last(f).sourceEventIds.length,1);assert.equal(last(f).cpm,null);
  assert.ok(f.read().gaps.some(g=>g.reasons.includes('composition')));
  const seq=f.engine.getSnapshot().sequence,tail=new CompositionInputTail();tail.remember('a👩‍💻');if(!tail.consume('a👩‍💻','insertText'))f.engine.input('a👩‍💻','typed',native('insertText','👩‍💻'));assert.equal(f.engine.getSnapshot().sequence,seq);
  f.advance(1000);f.input('a👩‍💻b');f.tick(4000);assert.equal(last(f).cpm,12);
});
test('Unicode final additions use graphemes, not UTF16 or codepoint length',()=>{
  const f=fixture();f.input('a');f.advance(1000);f.input('a👩‍💻é');f.tick(4000);assert.equal(last(f).addedGraphemes,2);assert.equal(last(f).cpm,24);
});
test('absent Segmenter never exposes fallback codepoint CPM',()=>{
  const f=fixture();f.input('a');f.advance(1000);f.input('a👩‍💻');f.tick(4000);
  const descriptor=Object.getOwnPropertyDescriptor(Intl,'Segmenter')!;
  try{Object.defineProperty(Intl,'Segmenter',{value:undefined,configurable:true});const p=last(f);assert.equal(p.cpm,null);assert.equal(p.unavailableReason,'grapheme-segmentation-unavailable')}
  finally{Object.defineProperty(Intl,'Segmenter',descriptor)}
});
test('overlapping pauses and cue changes restart full coverage without bridging paths',()=>{
  const f=fixture();f.input('a');f.tick(5000);f.engine.setFrozen('paused',true);f.engine.setFrozen('background',true);
  assert.equal(last(f).state,'frozen');f.advance(20000);f.engine.setFrozen('paused',false);f.engine.setFrozen('background',false);
  assert.equal(last(f).cpm,null);f.advance(1000);f.input('ab');f.tick(4000);assert.equal(last(f).cpm,12);
  f.engine.nextCue();f.input('x');assert.equal(last(f).cpm,null);
  assert.ok(f.read().segments.every(s=>s.points.every(p=>p.state==='measured')));
});
test('offline reload and reversed clock restart coverage and preserve draft/attempt facts',()=>{
  const f=fixture();f.input('a');f.tick(5000);const old=f.engine.getSnapshot();f.advance(20000);
  const restored=new TrainingEngine({snapshot:old,clock:f.clock});f.advance(1000);restored.sampleClock();
  const r=deriveInputRateTimeline(restored.getSnapshot());assert.equal(r.points.at(-1)!.cpm,null);assert.ok(r.gaps.some(g=>g.kind==='unobserved'));
  assert.equal(restored.draft,'a');assert.deepEqual(restored.getSnapshot().attempts,old.attempts);
  f.shiftWall(-30000);f.tick(1000);assert.equal(last(f).cpm,null);assert.ok(f.read().issues.some(i=>i.code==='wall-clock-reversed'));
});
test('standby / no input has no fabricated rates and duplicate events are deduplicated',()=>{
  const f=fixture();f.tick(10000);assert.equal(f.read().points.length,0);
  f.input('a');f.advance(1000);f.input('ab');f.tick(4000);const s=f.engine.getSnapshot(),expected=f.read();
  const duplicated={...s,events:[...s.events,s.events[1]]} as TrainingSnapshot;
  assert.deepEqual(deriveInputRateTimeline(duplicated),expected);assert.ok(Object.isFrozen(expected.points[0]));
});
test('new evidence is additive and survives replay without changing scoring/energy behavior',()=>{
  const a=fixture(),b=fixture();a.input('Could I have a coffee, please?');b.engine.input('Could I have a coffee, please?');
  a.tick(5000);b.tick(5000);a.engine.submit();b.engine.submit();const as=a.engine.getSnapshot(),bs=b.engine.getSnapshot();
  assert.deepEqual(as.attempts,bs.attempts);assert.equal(as.pace,bs.pace);assert.equal(as.earnedWords,bs.earnedWords);
  assert.deepEqual(replay(as.events),as);assert.deepEqual(replay(bs.events),bs);
  const stripped=as.events.map(e=>{if(e.type!=='inputCommitted')return e;const{nativeEdit,...old}=e;return old});assert.deepEqual(stripped,bs.events);
});
test('invalid additive evidence fails before accepting an event',()=>{
  const f=fixture();assert.throws(()=>f.engine.input('a','typed',{version:'wrong',kind:'input',inputType:'insertText',data:'a'} as unknown as NativeEditEvidence),/native edit/);
  assert.equal(f.engine.getSnapshot().drafts['cafe-studio-1'],undefined);
});

 test('native data counts a shrinking selection replacement and an intentional same-text insertion',()=>{
  const f=fixture();f.input('hello');f.advance(1000);f.input('he','insertText','e');f.advance(1000);f.input('he','insertText','e');f.tick(3000);
  assert.equal(last(f).cpm,24);assert.equal(last(f).sourceEventIds.length,2);assert.equal(f.engine.getSnapshot().drafts['cafe-studio-1'].version,2);
  assert.equal(f.engine.getSnapshot().attempts.length,0);
 });
 test('legacy shrinking edits are unknown, not inferred deletion or fake zero',()=>{
  const f=fixture();f.input('hello');f.advance(1000);f.engine.input('he');f.tick(4000);assert.equal(last(f).state,'unavailable');assert.equal(last(f).cpm,null);
 });
 test('same-task composition tail is consumed once, expiration keeps later intentional replacements',()=>{
  const tail=new CompositionInputTail();const id=tail.remember('你');assert.equal(tail.consume('你','insertText'),true);assert.equal(tail.consume('你','insertText'),false);
  const later=tail.remember('你');tail.expire(id);assert.equal(tail.consume('你','insertFromComposition'),true);tail.remember('你');tail.expire(later+1);assert.equal(tail.consume('你','insertText'),false);
  tail.remember('你');assert.equal(tail.consume('你好','insertText'),false);
 });
 test('same-text native input preserves current correct result and cumulative credit',()=>{
  const f=fixture();f.input('Could I have a coffee, please?');f.engine.submit();const old=f.engine.getSnapshot();
  f.engine.input(f.engine.draft,'typed',native('insertText','e'));const next=f.engine.getSnapshot();assert.equal(next.sequence,old.sequence+1);assert.deepEqual(next.attempts,old.attempts);assert.equal(next.earnedWords,old.earnedWords);assert.equal(next.pace,old.pace);assert.equal(f.engine.currentResult?.attemptId,old.attempts[0].attemptId);
 });

 test('repeated composition stays sampling: measured IME rates remain a disclosed implementation gap',()=>{
 const f=fixture();f.input('a');for(let i=1;i<=5;i++){f.tick(1000);f.engine.beginComposition();f.advance(500);f.engine.endComposition('a'+'你'.repeat(i),{version:'dom-edit-v1',kind:'compositionend',inputType:null,data:'你'});}
 assert.ok(f.read().points.every(p=>p.cpm===null));assert.equal(last(f).state,'sampling');assert.equal(last(f).includesIME,true);
 });
 test('same-text input with missing native data poisons rather than fabricating a zero rate',()=>{
 const f=fixture();f.input('a');f.advance(1000);f.engine.input('a','typed',native('insertText',null));f.tick(4000);assert.equal(last(f).state,'unavailable');assert.equal(last(f).cpm,null);
 });
