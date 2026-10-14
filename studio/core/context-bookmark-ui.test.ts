import {translate} from '../i18n/locale';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {TrainingEngine} from './training';
import {getBookmarkReference,contextBookmarkWords} from './context-bookmark';
import {roundReviewCueIndex} from './round-review';
import RoundReview from '../components/RoundReview';
import ContextBookmarkComposer from '../components/ContextBookmarkComposer';
const require=createRequire(import.meta.url),swc=require('next/dist/build/swc');await swc.loadBindings();
const studio=await readFile(new URL('../components/Studio.tsx',import.meta.url),'utf8');
const component=await readFile(new URL('../components/ContextBookmarkLibrary.tsx',import.meta.url),'utf8');
function fixture(){let id=0;return new TrainingEngine({clock:{now:()=>0,wallTime:()=>new Date(0).toISOString(),id:()=>`context-ui-${++id}`}})}
test('submitted-only RoundReview slot never reveals reference or creates bookmark controls before checking',()=>{
 const e=fixture(),slots:string[]=[];e.input('private unsubmitted answer');
 const render=()=>renderToStaticMarkup(React.createElement(RoundReview,{snapshot:e.getSnapshot(),disabledReason:null,onContinue(){},renderContextBookmark:(cueId:string)=>{slots.push(cueId);return React.createElement('div',null,'save slot')}}));
 const before=render();assert.equal(slots.length,0);assert.doesNotMatch(before,/Could I have|private unsubmitted answer|save slot/);
 e.submit();const after=render();assert.deepEqual(slots,[e.cue.id]);assert.match(after,/save slot/);assert.doesNotMatch(after,/Would you like it hot/);
});
test('actual composer is opt-in reference-only with bounded native word selectors and no render-time save',()=>{
 const e=fixture();e.input('a wrong private answer');e.submit();const reference=getBookmarkReference(e.getSnapshot(),e.cue.id)!;
 let writes=0;const html=renderToStaticMarkup(React.createElement(ContextBookmarkComposer,{reference,disabledReason:null,onSave:async()=>{writes++;throw Error('unexpected')},onOpenLibrary(){}}));
 assert.equal(writes,0);assert.match(html,/Save to local bookmarks/);assert.match(html,/Bookmark start word/);assert.match(html,/Bookmark end word/);assert.match(html,/Independent of automatic practice history/);assert.doesNotMatch(html,/a wrong private answer/);
 assert.equal(contextBookmarkWords(reference)[0].text,'Could');
 const blocked=renderToStaticMarkup(React.createElement(ContextBookmarkComposer,{reference,disabledReason:'原片未核验',onSave:async()=>{throw Error('unexpected')},onOpenLibrary(){}}));
 assert.match(blocked,/disabled=""/);assert.match(blocked,/原片未核验/);
});
const begin=studio.indexOf(' async function saveContextBookmark('),end=studio.indexOf(' function stopCamera(',begin);
const {code}=await swc.transform(studio.slice(begin,end)+'\nglobalThis.save=saveContextBookmark;', {jsc:{parser:{syntax:'typescript'},target:'es2022'},module:{type:'commonjs'}});
function harness(){
 const engine=fixture();engine.input(engine.cue.text);engine.submit();engine.input('retained new correction draft');
 const writes:any[]=[];const context:any={engineRef:{current:engine},originalMediaLease:{current:{verified:true,url:'blob:verified'}},lessonRef:{current:{currentSrc:'blob:verified',readyState:4,duration:72}},panel:'review',reviewSnapshot:engine.getSnapshot(),fixture:false,replaySnapshot:{current:null},composing:{current:false},mediaRef:{current:{kind:'demo'}},roundReviewCueIndex,getBookmarkReference,contextRepository:()=>({save:async(...args:any[])=>{writes.push(args);return{disposition:'saved'}}})};
 vm.createContext(context);vm.runInContext(code,context);return{context,engine,writes};
}
test('actual explicit save binds only verified current original reference and leaves drafts/attempts/results unchanged',async()=>{
 const h=harness(),before=JSON.stringify(h.engine.getSnapshot());await h.context.save(h.engine.cue.id,0,5);
 assert.equal(h.writes.length,1);assert.equal(h.writes[0][0].text,h.engine.cue.text);assert.deepEqual(h.writes[0].slice(1),[0,5]);assert.equal(JSON.stringify(h.engine.getSnapshot()),before);
 assert.doesNotMatch(JSON.stringify(h.writes),/retained new correction draft|conditions|accuracy|attemptId/);
});
test('actual save refuses stale, hidden/replay, imported, changed source, unverified bytes and invalid actual media duration',async()=>{
 const patches=[(h:any)=>h.context.panel='settings',(h:any)=>h.context.fixture=true,(h:any)=>h.context.replaySnapshot.current=h.engine.getSnapshot(),(h:any)=>h.context.composing.current=true,(h:any)=>h.context.mediaRef.current.kind='video',(h:any)=>h.context.originalMediaLease.current.verified=false,(h:any)=>h.context.lessonRef.current.currentSrc='blob:other',(h:any)=>h.context.lessonRef.current.readyState=1,(h:any)=>h.context.lessonRef.current.duration=2,(h:any)=>h.context.lessonRef.current.duration=Infinity,(h:any)=>h.engine.resetSession()];
 for(const patch of patches){const h=harness();patch(h);const before=JSON.stringify(h.engine.getSnapshot());await assert.rejects(h.context.save(h.engine.cue.id,0,5));assert.equal(h.writes.length,0);assert.equal(JSON.stringify(h.engine.getSnapshot()),before)}
});
test('formal integration adds only submitted-review/settings entries; no legacy source migration or preview recording graph',()=>{
 assert.match(studio,/history:t\('panel.history'\),bookmarks:t\('panel.bookmarks'\)/);assert.equal(translate('zh-CN','panel.history'),'本机练习历史');assert.equal(translate('zh-CN','panel.bookmarks'),'本机语境收藏');assert.match(studio,/panel==='bookmarks'.*ContextBookmarkLibrary/);
 assert.ok(studio.includes("onClick={()=>openPanel('bookmarks')}>{t('panel.bookmarks')}"));
 const graph=studio.slice(studio.indexOf(' async function startRecording('),studio.indexOf(' function stopRecording('));
 assert.ok(graph.indexOf('bookmarkPreviewRef.current?.setRecordingBlocked(true)')<graph.indexOf('canvas.captureStream'));
 assert.doesNotMatch(graph,/contextRepository|createMediaElementSource\([^)]*bookmark|captureStream\([^)]*bookmark/);
 assert.doesNotMatch(component,/TrainingEngine|\.submit\(|\.input\(|captureStream|createMediaStreamDestination|getUserMedia|localStorage/);
 assert.match(component,/repository\.load\(row.key\)/);assert.match(component,/a\.saveId===b\.saveId/);assert.match(component,/getState\(\)\.phase!=='ready'/);
});
