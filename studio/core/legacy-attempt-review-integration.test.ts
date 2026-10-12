import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LegacyAttemptReview from '../components/LegacyAttemptReview';
import HistoryReferenceImpact from '../components/HistoryReferenceImpact';
import { TrainingEngine, type Material } from './training';
import { readLegacyHistoryRecord, type LegacyHistorySession } from './legacy-history';
const require=createRequire(import.meta.url),swc=require('next/dist/build/swc');await swc.loadBindings();
const panelSource=await readFile(new URL('../components/LegacyHistoryPanel.tsx',import.meta.url),'utf8');
const componentSource=await readFile(new URL('../components/LegacyAttemptReview.tsx',import.meta.url),'utf8');
const {code}=await swc.transform(panelSource,{jsc:{parser:{syntax:'typescript',tsx:true},transform:{react:{runtime:'automatic'}},target:'es2022'},module:{type:'commonjs'}});
function fixture(name:string){
 let id=0;const material:Material={id:`saved-${name}`,version:'retained-v0',title:name,rights:'Original test text',cues:[{id:'old-cue',text:`the ${name} coffee`,start:6,end:12}]};
 const engine=new TrainingEngine({material,sessionId:`session-${name}`,clock:{now:()=>0,wallTime:()=>new Date(1700000000000).toISOString(),id:()=>`${name}-${++id}`}});
 engine.input(`a ${name} tea`);engine.submit();const snapshot=engine.getSnapshot();
 return{engine,snapshot,session:readLegacyHistoryRecord({sessionId:snapshot.sessionId,sequence:snapshot.sequence,snapshot,updatedAt:snapshot.createdAt})};
}
function renderPanel(selected:LegacyHistorySession|null){
 const view={selected,list:null,loading:false,downloading:false,paging:false,page:1,error:null};
 class Reader{getSnapshot=()=>view;}
 const exports:Record<string,any>={};
 const context=vm.createContext({exports,require:(name:string)=>name==='react'?{...React,useState:(initial:any)=>[typeof initial==='function'?initial():initial,()=>{}],useLayoutEffect:()=>{},useMemo:(f:()=>unknown)=>f()}:name.includes('legacy-history-reader')?{LegacyHistoryReader:Reader,supportsLegacyHistoryExport:()=>true}:name.includes('input-rate-timeline')?{deriveInputRateTimeline:()=>({})}:name==='./HistoryReferenceImpact'?{__esModule:true,default:HistoryReferenceImpact}:name==='./LegacyAttemptReview'?{__esModule:true,default:LegacyAttemptReview}:['./LegacyHistoryHud','./LegacyResultCard','./PaceTimeline'].includes(name)?{__esModule:true,default:()=>null}:require(name)});
 vm.runInContext(code,context);
 return renderToStaticMarkup(React.createElement(exports.default,{repository:{},currentSessionId:null,download:()=>{throw Error('A read must not download')}}));
}
test('actual saved-history detail adopts read-only review and preserves saved reference instead of current catalogue',()=>{
 const f=fixture('retained'),before=JSON.stringify(f.snapshot),html=renderPanel(f.session);
 assert.ok(html.includes('the retained coffee'));assert.ok(html.includes('a retained tea'));assert.ok(html.includes('retained-v0'));
 assert.equal(html.includes('Could I have a coffee'),false);assert.equal(JSON.stringify(f.engine.getSnapshot()),before);
 assert.equal(html.includes('<audio'),false);assert.equal(html.includes('<video'),false);
});
test('switching saved detail or leaving it never leaks the prior reference or carries a media playback',()=>{
 const a=fixture('firstsource'),b=fixture('secondsource');
 assert.ok(renderPanel(a.session).includes('firstsource'));
 const switched=renderPanel(b.session);assert.ok(switched.includes('secondsource'));assert.equal(switched.includes('firstsource'),false);
 const closed=renderPanel(null);assert.equal(closed.includes('secondsource'),false);assert.equal(closed.includes('firstsource'),false);
});
test('paused training and recording controls are outside static history review; no engine/media/storage side effects exist',()=>{
 const f=fixture('paused');f.engine.setFrozen('paused',true);const before=JSON.stringify(f.engine.getSnapshot());
 renderToStaticMarkup(React.createElement(LegacyAttemptReview,{snapshot:f.snapshot,attempt:f.snapshot.attempts[0]}));
 assert.equal(JSON.stringify(f.engine.getSnapshot()),before);
 assert.doesNotMatch(componentSource,/useEffect|useLayoutEffect|fetch\s*\(|localStorage|indexedDB|\.play\s*\(|\.pause\s*\(|TrainingEngine|MediaRecorder|setTimeout|setInterval/);
 assert.doesNotMatch(componentSource,/<audio|<video|autoPlay|onClick/);
});
test('partial history has no accidental full-attempt review or reconstruction',async()=>{
 const partial=await readFile(new URL('../components/SegmentHistoryPanel.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(partial,/LegacyAttemptReview|legacy-attempt-review|deriveInputRateTimeline|\balign\s*\(/);
});
test('saved reference and answer are escaped as text in actual view',()=>{
 const f=fixture('escaped'),snapshot=structuredClone(f.snapshot);
 const attempt={...snapshot.attempts[0],reference:'<img src=x onerror=alert(1)>',answer:'<script>bad()</script>'};
 const html=renderToStaticMarkup(React.createElement(LegacyAttemptReview,{snapshot,attempt}));
 assert.equal(html.includes('<script>bad()'),false);assert.equal(html.includes('<img src=x'),false);
 assert.ok(html.includes('&lt;script&gt;'));
});

test('English and Chinese presentation preserve saved text, token kinds and historical values', async()=>{
 const {translate,translateKnownUi}=await import('../i18n/locale');
 const {code:reviewCode}=await swc.transform(componentSource,{jsc:{parser:{syntax:'typescript',tsx:true},transform:{react:{runtime:'automatic'}},target:'es2022'},module:{type:'commonjs'}});
 const f=fixture('bilingual'),original=structuredClone(f.snapshot);
 // Deliberately use strings that are also known UI messages. Stored evidence
 // must never pass through the legacy UI-message translator.
 const attempt={...original.attempts[0],reference:'原参考',answer:'原答案',alignment:[
  {kind:'match',position:0,expected:'正确',actual:'正确'},
  {kind:'replace',position:1,expected:'原参考',actual:'原答案'},
  {kind:'missing',position:2,expected:'未提交',actual:''},
  {kind:'extra',position:null,expected:'',actual:'<私人原文>'},
 ] as const};
 const snapshot={...original,material:{...original.material,cues:original.material.cues.map((cue,index)=>index===0?{...cue,text:'原参考'}:cue)},attempts:[attempt,...original.attempts.slice(1)]};
 const before=JSON.stringify(snapshot);
 for(const locale of ['en','zh-CN'] as const){
  const exports:Record<string,any>={};
  vm.runInNewContext(reviewCode,{exports,require:(name:string)=>name==='../i18n/react'?{useStudioLocale:()=>({locale,t:(key:Parameters<typeof translate>[1],params?:Parameters<typeof translate>[2])=>translate(locale,key,params),ui:(message:string)=>translateKnownUi(locale,message)})}:require(name)});
  const html=renderToStaticMarkup(React.createElement(exports.default,{snapshot,attempt}));
  for(const [kind,key] of [['match','review.tokenCorrect'],['replace','review.tokenWrong'],['missing','review.tokenMissing'],['extra','review.tokenExtra']] as const){
   assert.ok(html.includes(`data-kind="${kind}"`));
   assert.ok(html.includes(`<strong>${translate(locale,key)} (${kind})</strong>`));
  }
  assert.ok(html.includes('原参考'));assert.ok(html.includes('原答案'));assert.ok(html.includes('未提交'));
  assert.ok(html.includes('&lt;私人原文&gt;'));assert.doesNotMatch(html,/<私人原文>/);
  assert.equal(JSON.stringify(snapshot),before);
 }
});
