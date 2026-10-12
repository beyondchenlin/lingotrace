import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import React from 'react';
import * as format from '../scene/layout-plan-file';
const require=createRequire(import.meta.url),swc=require('next/dist/build/swc');await swc.loadBindings();
const source=await readFile(new URL('../components/LayoutPlanFiles.tsx',import.meta.url),'utf8');
const {code}=await swc.transform(source,{jsc:{parser:{syntax:'typescript',tsx:true},transform:{react:{runtime:'automatic'}},target:'es2022'},module:{type:'commonjs'}});
const applied={layout:'lesson',arrangement:{inset:{x:1300,y:250,w:240,h:152}}}as const,context={portrait:false,height:1080};
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(e:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
const tick=()=>new Promise(r=>setImmediate(r));
function mount(){let cursor=0,effectRun=false;const slots:any[]=[],cleanups:(()=>void)[]=[],calls:any[]=[];const exports:any={};
 const props:any={applied,context,onBegin:()=>true,onPreview:(value:any,ctx:any)=>{calls.push(['preview',value,ctx]);return true},onBusy:(busy:boolean)=>calls.push(['busy',busy]),download:(name:string,blob:Blob)=>calls.push(['download',name,blob])};
 const hooks={...React,useRef:(value:any)=>{const i=cursor++;return slots[i]??(slots[i]={current:value})},useState:(value:any)=>{const i=cursor++;if(!(i in slots))slots[i]=value;return[slots[i],(v:any)=>{slots[i]=v}]},useEffect:(f:()=>()=>void)=>{if(!effectRun)cleanups.push(f())}};
 vm.runInNewContext(code,{exports,Blob,Error,require:(name:string)=>name==='react'?hooks:name.includes('layout-plan-file')?format:require(name)});
 function render(){cursor=0;const tree=exports.default(props);effectRun=true;return tree}
 function nodes(value:any,out:any[]=[]):any[]{if(Array.isArray(value)){value.forEach(v=>nodes(v,out));return out}if(value&&typeof value==='object'){out.push(value);nodes(value.props?.children,out)}return out}
 function input(){return nodes(render()).find(x=>x.type==='input')}
 function choose(file:any){const currentTarget={files:[file],value:'fake-path'};input().props.onChange({currentTarget});assert.equal(currentTarget.value,'')}
 function button(){return nodes(render()).find(x=>x.type==='button')}
 function text(){return JSON.stringify(render(),(_k,v)=>typeof v==='function'?undefined:v)}
 render();return{calls,props,choose,button,text,unmount(){for(const f of cleanups)f()}};
}
test('actual file component exports only applied configuration, no preview or automatic download',async()=>{const h=mount();assert.equal(h.calls.length,0);h.button().props.onClick();assert.equal(h.calls[0][0],'download');assert.equal(h.calls[0][1],'lingotrace-layout-landscape.json');assert.deepEqual(format.parseLayoutPlan(await h.calls[0][2].text(),context),applied);h.unmount()});
test('actual file component reads explicit file, previews changes, never applies or persists',async()=>{const h=mount(),candidate={layout:'lesson',arrangement:{}}as const;h.choose({size:100,text:async()=>format.exportLayoutPlan(candidate,context)});await tick();assert.deepEqual(h.calls.map(c=>c[0]),['busy','preview','busy']);assert.deepEqual(h.calls[1][1],candidate);assert.match(h.text(),/已载入预览：小窗/);assert.doesNotMatch(source,/localStorage|indexedDB|fetch\(|\.apply\(|setTimeout/);h.unmount()});
test('oversized file rejected before File.text reads bytes; no fake success',async()=>{const h=mount();let reads=0;h.choose({size:65537,text:async()=>{reads++;return '{}'}});await tick();assert.equal(reads,0);assert.equal(h.calls.some(c=>c[0]==='preview'),false);assert.match(h.text(),/64 KiB/);h.unmount()});
test('invalid JSON and denied preview leave existing configuration untouched',async()=>{for(const mode of ['invalid','guard']){const h=mount();h.props.onPreview=()=>false;h.choose({size:100,text:async()=>mode==='invalid'?'{':format.exportLayoutPlan(applied,context)});await tick();assert.match(h.text(),mode==='invalid'?/有效 JSON/:/状态已变化/);assert.equal(h.calls.some(c=>c[0]==='download'),false);h.unmount()}});
test('close/unmount invalidates late file result and releases busy without late preview or error',async()=>{for(const outcome of ['resolve','reject']){const h=mount(),wait=deferred<string>();h.choose({size:100,text:()=>wait.promise});assert.equal(h.button().props.disabled,true);h.unmount();const before=structuredClone(h.calls);if(outcome==='resolve')wait.resolve(format.exportLayoutPlan(applied,context));else wait.reject(Error('late'));await tick();assert.deepEqual(h.calls,before);assert.deepEqual(h.calls,[['busy',true],['busy',false]])}});
test('replaced file result cannot overtake a newer explicit selection or clear its busy flag',async()=>{const h=mount(),a=deferred<string>(),b=deferred<string>();h.choose({size:100,text:()=>a.promise});h.choose({size:100,text:()=>b.promise});a.resolve(format.exportLayoutPlan(applied,context));await tick();assert.equal(h.calls.some(c=>c[0]==='preview'),false);assert.equal(h.button().props.disabled,true);b.resolve(format.exportLayoutPlan({layout:'lesson',arrangement:{}},context));await tick();assert.equal(h.calls.filter(c=>c[0]==='preview').length,1);assert.equal(h.button().props.disabled,false);h.unmount()});
test('record/preview-state refusal avoids even reading selected file',async()=>{const h=mount();h.props.onBegin=()=>false;let reads=0;h.choose({size:20,text:async()=>{reads++;return '{}'}});await tick();assert.equal(reads,0);assert.equal(h.calls.length,0);assert.match(h.text(),/当前不能预览/);h.unmount()});
test('late file resolution uses current parent guard after camera availability changes',async()=>{const h=mount(),wait=deferred<string>();h.choose({size:100,text:()=>wait.promise});let checked=0;h.props.onPreview=()=>{checked++;return false};h.text();wait.resolve(format.exportLayoutPlan(applied,context));await tick();assert.equal(checked,1);assert.equal(h.calls.some(c=>c[0]==='preview'),false);assert.match(h.text(),/状态已变化/);h.unmount()});
