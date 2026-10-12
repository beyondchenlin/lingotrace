import {translate} from '../i18n/locale';
import { inactiveListeningTestScope } from './inactive-listening-test-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {TrainingEngine,hasScorableReference,type Material} from './training';
import {isPracticePaused} from './practice-pause';
const studio=await readFile(new URL('../components/Studio.tsx',import.meta.url),'utf8');
const builtinAnswerGuard=studio.slice(studio.indexOf(' function builtinAnswerBlocked('),studio.indexOf(' function contextRepository('));
const submitSource=builtinAnswerGuard+studio.slice(studio.indexOf(' function submit('),studio.indexOf(' function changeCue('));
function harness(){
 let id=0;const material:Material={id:'sound-test',version:'sound-v1',title:'Sound test',rights:'Original QA text',cues:[{id:'c1',text:'A cup please.',start:0,end:2},{id:'c2',text:'Thank you.',start:2,end:4}]};
 const engine=new TrainingEngine({material,clock:{now:()=>0,wallTime:()=>new Date(0).toISOString(),id:()=>`sound-${++id}`}}),calls:unknown[][]=[];
 const state:any={ ...inactiveListeningTestScope(),observeReviewAttempt(){},referenceBlocked:()=>false,engineRef:{current:engine},visualRef:{current:{}},fixture:false,replaySnapshot:{current:null},isPracticePaused,mediaKind:'demo',composing:{current:false},hasScorableReference,notify:(s:string)=>calls.push(['notice',s]),inputRef:{current:{focus(){}}},setResult:()=>{},performance:{now:()=>0},changeCue:(n:number)=>calls.push(['cue',n]),submissionSound:{audio:{current:{getSnapshot:()=>({enabled:true}),play:(...args:unknown[])=>calls.push(['play',...args])}}}};
 vm.createContext(state);vm.runInContext(submitSource+';this.submit=submit',state);return{engine,calls,state};
}
test('actual Studio submit maps only new judged attempts, completion priority and no extra score work',()=>{
 const h=harness();h.engine.input('a dog');assert.deepEqual(h.calls,[]);h.state.submit();assert.equal(h.calls[0][1],'correction');
 h.calls.length=0;h.state.submit();assert.equal(h.calls.some(x=>x[0]==='play'),false);
 h.engine.input('A cup please.');h.state.submit();assert.equal(h.calls.at(-1)?.[1],'firstCompletion');
 h.calls.length=0;h.state.submit();assert.deepEqual(h.calls,[['cue',1]]);
 h.engine.input('A cup please!');h.state.submit();assert.equal(h.calls.at(-1)?.[1],'correct');
 const saved=h.engine.getSnapshot();assert.equal(saved.attempts.length,3);assert.equal(saved.earnedWords,3);assert.equal(saved.completedCueIds.length,1);
});
test('hidden unchecked input, replay, preview, composition, paused and unsupported media do not emit cues',()=>{
 for(const mode of ['fixture','replay','composition','paused','image']){const h=harness();h.engine.input('A cup please.');
  if(mode==='fixture')h.state.fixture=true;if(mode==='replay')h.state.replaySnapshot.current=h.engine.getSnapshot();if(mode==='composition')h.state.composing.current=true;if(mode==='paused')h.engine.setFrozen('paused',true);if(mode==='image')h.state.mediaKind='image';
  h.state.submit();assert.equal(h.calls.some(x=>x[0]==='play'),false,mode);assert.equal(h.engine.getSnapshot().attempts.length,0,mode);
 }
});
test('empty answer and empty reference do not cue; restored snapshot reading has no audio hook',()=>{
 const h=harness();h.state.submit();assert.equal(h.calls.some(x=>x[0]==='play'),false);
 assert.equal((studio.match(/\.play\(attempt\.firstCompletion/g)||[]).length,1);
 const sync=studio.slice(studio.indexOf(' const syncDraft='),studio.indexOf(' async function setStandbySound'));assert.doesNotMatch(sync,/submissionSound|\.play\(/);
 const restore=studio.slice(studio.indexOf(' useEffect(()=>{disposed.current=false'),studio.indexOf(' useEffect(()=>{const preference='));assert.doesNotMatch(restore,/submissionSound\.audio\.current\?\.play/);
});
test('recording choices are explicit default-off and listening mute is pre-record isolated',()=>{
 assert.match(studio,/\[promptAudio,setPromptAudio\]=useState\(false\)/);
 assert.match(studio,/if\(promptAudio\).*attachRecordingTarget/s);
 assert.match(studio,/if\(lessonAudio&&lessonRef.current\).*connectRecording\(dest\)/s);
 assert.ok(studio.includes("t('settings.muteMonitor')"));assert.match(translate('zh-CN','settings.muteMonitor'),/全部监听静音（不改变录像音轨选择）/);
 assert.match(studio,/checked=\{promptAudio\}[\s\S]*?disabled=\{activeRecord\|\|startingRecord\}/);
 const graph=studio.slice(studio.indexOf(' async function startRecording('),studio.indexOf(' function stopRecording('));assert.doesNotMatch(graph,/whiteNoise|standbyAudio|monitorMuted/);
});

 test('all-listening mute also covers saved-recording preview without rewriting stored audio',()=>{
 assert.match(studio,/className="record-preview" src=\{preview\} controls playsInline muted=\{monitorMuted\}/);
 assert.match(studio,/onVolumeChange=\{e=>\{if\(monitorPrefs.current.allMuted&&!e.currentTarget.muted\)e.currentTarget.muted=true\}\}/);
 });
