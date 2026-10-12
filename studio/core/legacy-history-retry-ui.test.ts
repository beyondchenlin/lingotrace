import {translate,translateKnownUi} from '../i18n/locale';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url),swc=require('next/dist/build/swc');await swc.loadBindings();
const source=await readFile(new URL('../components/LegacyHistoryPanel.tsx',import.meta.url),'utf8');
const {code}=await swc.transform(source,{jsc:{parser:{syntax:'typescript',tsx:true},transform:{react:{runtime:'automatic'}},target:'es2022'},module:{type:'commonjs'}});
function mount(patch:Record<string,unknown>={}){
 const state={list:null,selected:null,loading:false,downloading:false,paging:false,page:1,error:null,canRetry:false,...patch};
 let retries=0,refreshes=0;class Reader{getSnapshot=()=>state;retry=async()=>{retries++};refresh=async()=>{refreshes++};}
 const exports:Record<string,any>={};const context=vm.createContext({exports,require:(name:string)=>name === '../i18n/react' ? {useStudioLocale: () => ({locale: 'zh-CN', t: (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('zh-CN', key, params), ui: (message: string) => translateKnownUi('zh-CN', message)})} : name==='react'?{...React,useState:(value:any)=>[typeof value==='function'?value():value,()=>{}],useLayoutEffect:()=>{},useMemo:(fn:()=>unknown)=>fn()}:name.includes('legacy-history-reader')?{LegacyHistoryReader:Reader,supportsLegacyHistoryExport:()=>true}:name.includes('input-rate-timeline')?{deriveInputRateTimeline:()=>({})}:name.startsWith('./')?{__esModule:true,default:()=>null}:require(name)});
 vm.runInContext(code,context);const element=exports.default({repository:{},currentSessionId:null,download:()=>{throw Error('Read retry must not download')}});
 const buttons:any[]=[];function walk(node:any){if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(walk);return}if(node.type==='button')buttons.push(node);walk(node.props?.children)}walk(element);
 return{html:renderToStaticMarkup(element),buttons,retries:()=>retries,refreshes:()=>refreshes};
}
test('actual history panel offers a retry only for a retryable failure and preserves original error',()=>{
 const normal=mount();assert.equal(normal.html.includes('重试读取'),false);
 const denied=mount({error:'记录格式无法读取',canRetry:false});assert.ok(denied.html.includes('记录格式无法读取'));assert.equal(denied.html.includes('重试读取'),false);
 const failed=mount({error:'读取失败，请重试',canRetry:true});assert.ok(failed.html.includes('读取失败，请重试'));assert.ok(failed.html.includes('重试读取'));assert.equal(failed.retries(),0);
});
test('actual retry click delegates only to reader.retry, never refresh or download',async()=>{
 const view=mount({error:'导出未开始，请重新读取',canRetry:true}),button=view.buttons.find(b=>b.props.children==='重试读取');
 assert.ok(button);assert.equal(button.props.disabled,false);await button.props.onClick();assert.equal(view.retries(),1);assert.equal(view.refreshes(),0);
});
test('actual retry control disables while any read/page/download is in progress',()=>{
 for(const busy of ['loading','paging','downloading']){const view=mount({canRetry:true,error:'等待中的读取',[busy]:true}),button=view.buttons.find(b=>b.props.children==='重试读取');assert.ok(button);assert.equal(button.props.disabled,true,busy)}
});


test('actual complete-history list labels each retained schema rather than calling the NPS profile old v1',()=>{
 const record=(sessionId:string,schemaVersion:string,title:string)=>({status:'ready',summary:{sessionId,schemaVersion,materialTitle:title,materialVersion:`${sessionId}-fixed-reference`,createdAt:'2026-10-10T00:00:00Z',updatedAt:'2026-10-10T00:00:00Z',earnedWords:2,completedCount:1,attemptCount:1,activeMs:0}});
 const view=mount({list:{entries:[record('coffee','lingotrace-session-v1','Original coffee'),record('nps','lingotrace-session-builtin-v1','NPS Connie')],limit:100,hasMore:false}});
 assert.ok(view.html.includes('本机完整 Training 记录'));
 assert.ok(view.html.includes('lingotrace-session-v1'));assert.ok(view.html.includes('lingotrace-session-builtin-v1'));
 assert.ok(view.html.includes('coffee-fixed-reference'));assert.ok(view.html.includes('nps-fixed-reference'));
 assert.equal(view.html.includes('Training v1 · 素材'),false);assert.equal(view.html.includes('旧版数据结构'),false);
 assert.equal(view.retries(),0);assert.equal(view.refreshes(),0);
});
