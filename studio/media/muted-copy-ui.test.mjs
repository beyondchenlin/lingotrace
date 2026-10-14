import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url),swc=require('next/dist/build/swc');await swc.loadBindings();
const {translate,translateKnownUi}=require('tsx/cjs/api').require('../i18n/locale.ts',import.meta.url);
const source=await readFile(new URL('../components/MutedRecordingCopy.tsx',import.meta.url),'utf8');
const {code}=await swc.transform(source,{jsc:{parser:{syntax:'typescript',tsx:true},transform:{react:{runtime:'automatic'}},target:'es2022'},module:{type:'commonjs'}});
const localeHook={useStudioLocale:()=>({locale:'en',t:translate.bind(null,'en'),ui:translateKnownUi.bind(null,'en')})};
function mount(patch={},blocked=false){
 const state={phase:'selected',consent:false,previewUrl:null,previewed:false,info:null,error:null,...patch};
 const calls=[];const mock=new Proxy({},{get:(_,key)=>(...args)=>calls.push([key,...args])});let refs=0;
 const exports={};const context=vm.createContext({exports,require:name=>name==='react'?{...React,useRef:value=>({current:refs++===0?mock:value}),useState:()=>[state,()=>{}],useEffect:()=>{}}:name.includes('i18n/react')?localeHook:name.includes('muted-copy-controller')?{createMutedCopyController:()=>{throw Error('Must not initialize during render')}}:require(name)});
 vm.runInContext(code,context);const element=exports.default({record:{id:'original',startedAt:0},load:()=>{throw Error('No automatic read')},onClose:()=>calls.push(['close']),blocked});const nodes=[];
 function walk(n){if(!n||typeof n!=='object')return;if(Array.isArray(n)){n.forEach(walk);return}nodes.push(n);walk(n.props?.children)}walk(element);
 return {html:renderToStaticMarkup(element),nodes,calls,button:name=>nodes.find(n=>n.type==='button'&&n.props.children===name)};
}
test('actual export UI requires explicit all-audio consent and warns that picture remains',()=>{
 const view=mount();assert.equal(view.calls.length,0);assert.equal(view.button('Create muted copy').props.disabled,true);
 for(const phrase of ['entire mix','burned-in captions','faces','typed content','not redaction','original is unchanged','never auto-saved'])assert.ok(view.html.includes(phrase),phrase);
 assert.match(view.html,/aria-label="Create a muted recording copy"/);
 const input=view.nodes.find(n=>n.type==='input');assert.equal(input.props.checked,false);input.props.onChange({target:{checked:true}});assert.deepEqual(view.calls,[['setConsent',true]]);
});
test('generate is explicit and disabled during live recording or duplicate processing',()=>{
 const view=mount({consent:true});view.button('Create muted copy').props.onClick();assert.deepEqual(view.calls,[['generate']]);
 assert.equal(mount({consent:true},true).button('Create muted copy').props.disabled,true);
 assert.equal(mount({consent:true,phase:'generating'}).button('Generating and checking…').props.disabled,true);
});
test('preview never autoplays and cannot download before user playback',()=>{
 const info={width:860,height:1640,durationSeconds:2.1,sourceDurationSeconds:2.2},view=mount({phase:'ready',consent:true,previewUrl:'blob:copy',info});
 const video=view.nodes.find(n=>n.type==='video');assert.equal(video.props.autoPlay,undefined);assert.equal(video.props.controls,true);assert.equal(view.button('Download muted copy').props.disabled,true);
 video.props.onPlaying({currentTarget:{getAttribute:()=> 'blob:copy'}});video.props.onError({currentTarget:{getAttribute:()=> 'blob:copy'}});
 assert.deepEqual(view.calls,[['markPreviewed','blob:copy'],['previewFailed','blob:copy']]);
 const ready=mount({phase:'ready',consent:true,previewUrl:'blob:copy',previewed:true,info});ready.button('Download muted copy').props.onClick();assert.deepEqual(ready.calls,[['download']]);
});
test('cancel and close are explicit; background/unmount install cleanup boundaries',()=>{
 const view=mount();view.button('Cancel and discard copy').props.onClick();view.button('Back to recording list').props.onClick();assert.deepEqual(view.calls,[['cancel'],['close'],['close']]);
 assert.match(source,/visibilitychange/);assert.match(source,/pagehide/);assert.match(source,/current\.dispose\(\)/);assert.match(source,/removeEventListener/);
});
test('errors display through ui() bridge for ZH-canonical controller messages',()=>{
 const zh='原录像没有可读取的视频数据。';
 const view=mount({error:zh});
 assert.ok(view.html.includes('The original recording has no readable video data.'),view.html);
 assert.match(source,/ui\(state\.error\)/);
 assert.match(source,/useStudioLocale/);
});
test('Studio entry only adds library controls and clears on panel or record switches',async()=>{
 const studio=await readFile(new URL('../components/Studio.tsx',import.meta.url),'utf8');
 assert.match(studio,/disabled=\{activeRecord\|\|startingRecord\|\|!r\.complete\|\|r\.status!=='complete'\}/);
 assert.match(studio,/function closePanel\(restoreFocus=true,keepLayoutPreview=false\)\{[^\n]*setMutedRecord\(null\);clearRecordingPreview\(\)/);
 assert.match(studio,/openPanel\(next:Panel\)\{[^\n]*submissionSound\.audio\.current\?\.cancel\(\);setMutedRecord\(null\);clearRecordingPreview\(\)/);
 assert.match(studio,/<MutedRecordingCopy key=\{mutedRecord\.id\}/);
 assert.equal(source.includes('TrainingEngine'),false);assert.equal(source.includes('MediaRecorder'),false);assert.equal(source.includes('indexedDB'),false);
});
test('actual original preview async loader cannot resurrect beside a newer export or closed panel',async()=>{
 const studio=await readFile(new URL('../components/Studio.tsx',import.meta.url),'utf8');
 const begin=studio.indexOf(' function clearRecordingPreview('),end=studio.indexOf(' async function saveRecording(',begin);
 const {code}=await swc.transform(studio.slice(begin,end),{jsc:{parser:{syntax:'typescript'},target:'es2022'},module:{type:'commonjs'}});
 const pending=[],created=[],revoked=[],shown=[],notices=[];
 const request={current:0},life={current:1},disposed={current:false};
 const context=vm.createContext({recordingPreviewRequest:request,life,disposed,previewURL:{current:null},INITIAL_PREVIEW_INFO:{},
  setPreview:x=>shown.push(x),setPreviewInfo:()=>{},notify:x=>notices.push(x),
  recorderRef:{current:{blob:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))}},
  URL:{createObjectURL:blob=>{created.push(blob);return 'blob:'+created.length},revokeObjectURL:url=>revoked.push(url)}});
 vm.runInContext(code,context);
 const stale=context.previewRecording('A');context.clearRecordingPreview();pending[0].resolve('A');await stale;
 assert.equal(created.length,0);assert.equal(shown.at(-1),null);
 const first=context.previewRecording('B'),second=context.previewRecording('C');pending[2].resolve('C');await second;pending[1].resolve('B');await first;
 assert.deepEqual(created,['C']);assert.equal(shown.at(-1),'blob:1');context.clearRecordingPreview();assert.deepEqual(revoked,['blob:1']);
 const failed=context.previewRecording('D');context.clearRecordingPreview();pending[3].reject(new Error('late'));await failed;assert.deepEqual(notices,[]);
 const oldLife=context.previewRecording('E');life.current++;pending[4].resolve('E');await oldLife;assert.deepEqual(created,['C']);
});
