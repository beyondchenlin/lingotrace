import { inactiveListeningTestScope } from './inactive-listening-test-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import RoundReview from '../components/RoundReview';
import {TrainingEngine, type Material} from './training';
import {roundReviewCueIndex} from './round-review';
import {isPracticePaused} from './practice-pause';
function fixture(){let id=0;const material:Material={id:'qa',version:'v1',title:'QA',rights:'Original QA',cues:[{id:'a',text:'A cup please.',start:0,end:2},{id:'b',text:'Secret reference second.',start:2,end:4}]};return new TrainingEngine({material,clock:{now:()=>0,wallTime:()=>new Date(0).toISOString(),id:()=>`qa-${++id}`}})}
const render=(e:TrainingEngine,disabledReason:string|null=null)=>renderToStaticMarkup(React.createElement(RoundReview,{snapshot:e.getSnapshot(),disabledReason,onContinue(){throw Error('Rendering must not navigate')}}));
test('real component keeps unsubmitted references/drafts out of HTML and provides explicit continue',()=>{
 const e=fixture();e.input('unsubmitted secret draft');const html=render(e);assert.doesNotMatch(html,/Secret reference second|unsubmitted secret draft|A cup please/);assert.match(html,/Continue sentence 1/);assert.match(html,/Not submitted: 2/);
});
test('real component displays saved first/latest condition and actual error kinds',()=>{
 const e=fixture();e.input('a dog now');e.submit();e.exposeHint('hint');e.input('A cup please.');e.submit();const before=JSON.stringify(e.getSnapshot());const html=render(e);
 assert.match(html,/First submission/);assert.match(html,/Latest submission/);assert.match(html,/Hint used/);assert.match(html,/a dog now/);assert.match(html,/100%/);assert.doesNotMatch(html,/Secret reference second/);assert.equal(JSON.stringify(e.getSnapshot()),before);
});
test('real component escapes stored text and disables return while paused',()=>{
 const e=fixture();e.input('<script>alert(1)</script>');e.submit();const html=render(e,'先继续已暂停的练习，再选择句子。');assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.equal((html.match(/disabled=""/g)||[]).length,2);
});
const studio=await readFile(new URL('../components/Studio.tsx',import.meta.url),'utf8');
const require=createRequire(import.meta.url),swc=require('next/dist/build/swc');await swc.loadBindings();
const start=studio.indexOf(' function changeCue('),end=studio.indexOf(' function togglePlay(');
const strictCourse=studio.slice(studio.indexOf(' function strictCourse('),studio.indexOf(' function prepareCoursePoster('));
const {code}=await swc.transform(strictCourse+studio.slice(start,end)+'\nglobalThis.go=continueRoundReview;',{jsc:{parser:{syntax:'typescript'},target:'es2022'},module:{type:'commonjs'}});
function harness(){
 const engine=fixture();engine.input('a dog');engine.submit();engine.input('original pending correction');engine.nextCue(1);engine.input('second pending draft');engine.setFrozen('modal',true);
 const calls:unknown[][]=[];
 const state:any={ ...inactiveListeningTestScope(),reviewBindingRef:{current:null},referenceBlocked:()=>false,engineRef:{current:engine},reviewSnapshot:engine.getSnapshot(),panel:'review',fixture:false,replaySnapshot:{current:null},restoreFailedRef:{current:false},mediaRef:{current:{kind:'demo'}},isPracticePaused,composing:{current:false},roundReviewCueIndex,t:(key:string)=>key,notify:(message:string)=>calls.push(['notice',message]),dialogRef:{current:{close:()=>calls.push(['dialog-close'])}},closePanel:(restore:boolean)=>{calls.push(['close',restore]);state.panel=null;engine.setFrozen('modal',false)},submissionSound:{audio:{current:{cancel:()=>calls.push(['cancel'])}}},mediaInteractedRef:{current:false},lessonRef:{current:{pause:()=>calls.push(['pause'])}},seekTo:(n:number)=>calls.push(['seek',n]),setShowSubtitle:(v:boolean)=>calls.push(['subtitle',v]),syncDraft:()=>calls.push(['draft',engine.draft]),inputRef:{current:{focus:()=>calls.push(['focus'])}}};
 vm.createContext(state);vm.runInContext(code,state);return{engine,state,calls};
}
test('actual Studio return handler uses existing cue path and preserves both drafts, score and attempts',()=>{
 const h=harness(),before=h.engine.getSnapshot();h.state.go('a');const after=h.engine.getSnapshot();
 assert.equal(after.cueIndex,0);assert.equal(h.engine.draft,'original pending correction');assert.deepEqual(after.drafts,before.drafts);assert.deepEqual(after.attempts,before.attempts);assert.equal(after.earnedWords,before.earnedWords);
 assert.deepEqual(h.calls,[['close',false],['dialog-close'],['cancel'],['pause'],['seek',0],['subtitle',false],['draft','original pending correction'],['focus']]);
 const once=after.sequence;h.state.go('a');assert.equal(h.engine.getSnapshot().sequence,once);
});
test('actual return is inert when closed, paused, previewing, replaying, restoring, composing or non-course media',()=>{
 for(const reason of ['closed','paused','fixture','replay','restore','composition','media']){
  const h=harness();if(reason==='closed')h.state.panel=null;if(reason==='paused')h.engine.setFrozen('paused',true);if(reason==='fixture')h.state.fixture=true;if(reason==='replay')h.state.replaySnapshot.current=h.engine.getSnapshot();if(reason==='restore')h.state.restoreFailedRef.current=true;if(reason==='composition')h.state.composing.current=true;if(reason==='media')h.state.mediaRef.current.kind='video';
  const before=JSON.stringify(h.engine.getSnapshot());h.state.go('a');assert.equal(JSON.stringify(h.engine.getSnapshot()),before,reason);assert.deepEqual(h.calls,[],reason);
 }
});
test('actual stale view and unknown target refuse navigation without closing or touching draft',()=>{
 for(const kind of ['new-round','new-submit','unknown']){
  const h=harness();if(kind==='new-round')h.engine.resetSession();if(kind==='new-submit'){h.engine.setFrozen('modal',false);h.engine.submit();}
  const before=JSON.stringify(h.engine.getSnapshot());h.state.go(kind==='unknown'?'unknown':'a');assert.equal(JSON.stringify(h.engine.getSnapshot()),before);assert.equal(h.calls.length,1);assert.equal(h.calls[0][0],'notice');
 }
});
test('after returning, real correction submits normally and does not repeat completion rewards',()=>{
 const h=harness();h.state.go('a');h.engine.input('A cup please.');const first=h.engine.submit()!;assert.equal(first.firstCompletion,true);
 h.engine.nextCue(1);h.engine.setFrozen('modal',true);h.state.panel='review';h.state.reviewSnapshot=h.engine.getSnapshot();h.state.go('a');h.engine.input('A cup please!');const repeated=h.engine.submit()!;assert.equal(repeated.firstCompletion,false);assert.equal(repeated.gain,0);assert.equal(h.engine.getSnapshot().completedCueIds.length,1);
});
test('OFF/current-page review has no persistence or automatic submit path',async()=>{
 const component=await readFile(new URL('../components/RoundReview.tsx',import.meta.url),'utf8');const projection=await readFile(new URL('./round-review.ts',import.meta.url),'utf8');
 assert.doesNotMatch(component+projection,/indexedDB|localStorage|fetch\(|setTimeout|\.submit\(|\.input\(|\.play\(/);
 assert.match(studio,/<RoundReview key=\{reviewSnapshot.sessionId\}/);
});
