import {translate,translateKnownUi} from '../i18n/locale';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {emptyRecordCalendarMetrics,recordCalendarWeek} from './record-calendar-metrics';
import {LegacyHistoryError} from './legacy-history';
import {validatePracticeTimeZone,practiceDayKey} from './practice-calendar';
const require=createRequire(import.meta.url),swc=require('next/dist/build/swc');await swc.loadBindings();
const source=await readFile(new URL('../components/RecordCalendarPanel.tsx',import.meta.url),'utf8');
const {code}=await swc.transform(source,{jsc:{parser:{syntax:'typescript',tsx:true},transform:{react:{runtime:'automatic'}},target:'es2022'},module:{type:'commonjs'}});
const ref={key:'legacy:A',source:'legacy-full',recordId:'A',sessionId:'A',identity:'known',days:['2026-10-09'],materialId:'cafe',materialVersion:'v1'};
function mount(patch:Record<string,any>={},options:Record<string,any>={}){
 const view={timeZone:'UTC',status:'loaded',records:[ref],metrics:emptyRecordCalendarMetrics(),selected:null,selecting:false,error:null,scannedRecords:1,...patch},calls:any[]=[],effects:any[]=[],setters:any[]=[];
 let stateIndex=0;class Reader{getSnapshot=()=>view;activate=()=>calls.push(['activate']);subscribe=()=>()=>calls.push(['unsubscribe']);refresh=async(zone:string)=>{calls.push(['refresh',zone])};dispose=()=>calls.push(['dispose']);cancel=()=>calls.push(['cancel']);back=()=>calls.push(['back']);select=async(key:string)=>{calls.push(['select',key])};}
 const reader=new Reader(),loaded={identity:'known'},repository={listHistory:async()=>null,loadHistorySession:async()=>loaded,deliverHistorySession:()=>{throw Error('No export on navigation')},listTrainingHistorySegments:async()=>null,loadTrainingHistorySegment:async()=>loaded,deliverTrainingHistorySegment:()=>{throw Error('No export on navigation')},listListeningSessions:async()=>{calls.push(['list-listening']);return[loaded]},loadListeningSession:async(id:string)=>{calls.push(['load-listening',id]);return options.missingListening?null:loaded},deliverListeningSession:async(id:string,value:any,sink:()=>void)=>{calls.push(['deliver-listening',id,value]);sink()}};
 const exports:Record<string,any>={};const initial=['UTC',options.zoneInput??'UTC','',options.month??'2026-10',options.day===undefined?'2026-10-09':options.day,reader,view];
 const context=vm.createContext({exports,require:(name:string)=>name === '../i18n/react' ? {useStudioLocale: () => ({locale: 'zh-CN', t: (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('zh-CN', key, params), ui: (message: string) => translateKnownUi('zh-CN', message)})} : name==='react'?{...React,useMemo:(fn:()=>unknown)=>fn(),useEffect:(fn:()=>unknown)=>effects.push(fn),useState:()=>{const index=stateIndex++;return[initial[index],(value:unknown)=>setters.push([index,value])]}}:name.includes('record-calendar-metrics')?{recordCalendarWeek}:name.includes('record-calendar-reader')?{RecordCalendarReader:Reader}:name.includes('record-calendar')?{recordCalendarSourceIdentity:async(v:any)=>v.identity,recordCalendarMonth:(records:any[],month:string)=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Invalid month');return Array.from({length:31},(_,i)=>{const day=`${month}-${String(i+1).padStart(2,'0')}`;return{day,coverage:'unknown',records:records.filter(r=>r.days.includes(day))}})}}:name.includes('practice-calendar')?{validatePracticeTimeZone,practiceDayKey}:name.includes('legacy-history')?{LegacyHistoryError}:name.startsWith('./')?{__esModule:true,default:()=>null}:require(name)});
 vm.runInContext(code,context);const element=exports.default({repository,referenceRepository:options.referenceRepository,currentSessionId:'A',download:()=>{throw Error('No download on navigation')},currentHistoryOff:options.off??false});const nodes:any[]=[];function walk(n:any){if(!n||typeof n!=='object')return;if(Array.isArray(n)){n.forEach(walk);return}nodes.push(n);walk(n.props?.children)}walk(element);
 return{view,calls,effects,setters,nodes,loaded,html:renderToStaticMarkup(element),button:(name:string)=>nodes.find(n=>n.type==='button'&&n.props.children===name)};
}
test('actual calendar uses categorical evidence, explicit timezone, and unknown rather than zero',()=>{
 const v=mount();assert.ok(v.html.includes('UTC'));assert.ok(v.html.includes('周一开始'));assert.ok(v.html.includes('空白日期为未知'));
 assert.ok(v.html.includes('完整记录'));assert.equal(v.nodes.filter(n=>n.type==='button'&&n.props['aria-pressed']!==undefined).length,31);
 assert.doesNotMatch(v.html,/学习分钟|连续天数|零分|0 分钟/);assert.deepEqual(v.calls,[]);
 const marked=v.nodes.find(n=>n.props?.['aria-pressed']===true&&n.props?.['aria-label']?.includes('有保存记录，覆盖不完整'));assert.ok(marked);marked.props.onFocus();assert.deepEqual(v.calls,[['back']]);assert.deepEqual(v.setters.at(-1),[4,'2026-10-09']);
 v.button('打开原记录').props.onClick();assert.deepEqual(v.calls.at(-1),['select','legacy:A']);
});
test('loading, cancelled, failed and current OFF do not invent empty-day coverage',()=>{
 for(const status of ['loading','partial','failed','cancelled']){const v=mount({status,records:[],error:status==='failed'?'读取失败':null},{off:true});assert.ok(v.html.includes('未知'));assert.ok(v.html.includes('当前历史记录已关闭'));assert.doesNotMatch(v.html,/已确认零|全天完整|连续/);if(status==='loading'){v.button('取消读取').props.onClick();assert.deepEqual(v.calls,[['cancel']])}}
});
test('month navigation cancels selection without restarting or filtering the full scan',()=>{
 const v=mount({status:'loading'});v.button('下一月').props.onClick();assert.deepEqual(v.calls,[['back']]);assert.ok(v.setters.some(x=>x[0]===3&&x[1]==='2026-11'));assert.equal(v.calls.some(c=>c[0]==='refresh'),false);
});
test('timezone validation keeps rejected input out and applies valid zone explicitly',()=>{
 const bad=mount({}, {zoneInput:'Mars/Unknown'});bad.button('应用查看时区').props.onClick();assert.equal(bad.calls.length,0);assert.ok(bad.setters.some(x=>x[0]===2&&String(x[1]).includes('有效')));
 const good=mount({}, {zoneInput:'America/New_York'});good.button('应用查看时区').props.onClick();assert.deepEqual(good.calls,[['refresh','America/New_York']]);
});
test('calendar owner cancels work on unmount and does not mutate storage',()=>{
 const v=mount(),cleanup=v.effects[0]();assert.deepEqual(v.calls,[['activate'],['refresh','UTC']]);cleanup();assert.deepEqual(v.calls.slice(-2),[['unsubscribe'],['dispose']]);
 assert.doesNotMatch(source,/saveSession|resetSession|submit\(|localStorage|indexedDB|new Practice/);
});
test('original detail reread guards exact selected-source identity for both families',async()=>{
 for(const sourceKind of ['legacy-full','partial-segment']){
  const selected={source:sourceKind,record:{...ref,source:sourceKind},session:{},segment:{}};const v=mount({selected});
  const detail=v.nodes.find(n=>n.props?.repository);assert.ok(detail);assert.equal(detail.props.detailOnly,true);const repo=detail.props.repository,method=sourceKind==='legacy-full'?'loadHistorySession':'loadTrainingHistorySegment';
  assert.equal(await repo[method]('A'),v.loaded);v.loaded.identity='changed';await assert.rejects(repo[method]('A'),/记录已变化|片段已变化/);
  assert.equal(await repo[method]('other'),v.loaded);v.button('返回记录日历').props.onClick();assert.deepEqual(v.calls,[['back']]);
 }
});

function metricFixture(day='2026-10-09'){
 const sources=[{sessionId:'A',eventId:'event-safe-id',recordKeys:['legacy:A']}];
 const count=(value:number|null,unknownCount=0)=>({value,unknownCount,sourceEventIds:sources});
 const bucket={day,coverage:'partial',submissions:count(2),firstCompletions:count(null,1),matchedTerms:count(6),inputActiveMs:count(60000)};
 return {days:[bucket],weeks:[{...bucket,day:'2026-10-05',through:'2026-10-11',submissions:count(3)}],conflictCount:0,unlocatedCount:0};
}
test('day and week figures expose units, unknown fields and guarded original-source links without answers',()=>{
 const v=mount({metrics:metricFixture()});assert.ok(v.html.includes('当天已记录数值'));assert.ok(v.html.includes('本周已记录数值'));assert.ok(v.html.includes('已记录首次完成句次'));assert.ok(v.html.includes('已记录输入活动分钟（旧口径）'));assert.ok(v.html.includes('约 1 分钟'));assert.ok(v.html.includes('另有 1 个来源事件'));assert.ok(v.html.includes('event-safe-id'));assert.doesNotMatch(v.html,/coffee|alignment|已掌握|连续天数/);
 const date=v.nodes.find(n=>n.props?.['aria-pressed']===true);assert.match(date.props['aria-label'],/已记录提交 2/);assert.match(date.props['aria-label'],/首次完成句次 未知/);
 v.button('打开贡献原记录').props.onClick();assert.deepEqual(v.calls,[['select','legacy:A']]);
});
test('reliable cross-day interval marks its intermediate date and supplies an original-record entry',()=>{
 const outside={...ref,days:['2026-10-08','2026-10-10']};const v=mount({records:[outside],metrics:metricFixture()});
 const date=v.nodes.find(n=>n.props?.['aria-pressed']===true);assert.match(date.props['aria-label'],/有保存记录，覆盖不完整/);assert.ok(v.button('打开原记录'));assert.equal(v.html.includes('未读到这一天'),false);
});
test('metric conflict warnings are visible while source details stay available',()=>{
 const v=mount({metrics:{...metricFixture(),conflictCount:2},status:'partial'});assert.ok(v.html.includes('2 处事实冲突'));assert.ok(v.html.includes('未把冲突贡献相加'));assert.ok(v.button('打开贡献原记录'));
});


test('calendar complete-detail passes the exact read-only revision capability; partial records do not gain an inferred reference',()=>{
 const referenceRepository={list(){throw Error('No render read')},subscribe(){throw Error('No render subscription')}};
 for(const sourceKind of ['legacy-full','partial-segment']){
  const v=mount({selected:{source:sourceKind,record:{...ref,source:sourceKind},session:{},segment:{}}},{referenceRepository});
  const detail=v.nodes.find(n=>n.props?.repository);assert.ok(detail);
  assert.equal(detail.props.referenceRepository,sourceKind==='legacy-full'?referenceRepository:undefined);
 }
});


test('calendar renders listening envelopes as an explicit third source without inventing listening duration',()=>{
 const listening={...ref,key:'listening-session:A',source:'listening-session'},metrics=metricFixture();
 for(const bucket of [...metrics.days,...metrics.weeks])for(const name of ['submissions','firstCompletions','matchedTerms','inputActiveMs'] as const)bucket[name].sourceEventIds[0].recordKeys=['listening-session:A'];
 const v=mount({records:[listening],metrics});assert.match(v.html,/含听力条件的完整记录/);assert.match(v.html,/听力观察区间/);assert.match(v.html,/已记录输入活动分钟（旧口径）/);assert.match(v.html,/约 1 分钟/);
 assert.doesNotMatch(v.html,/听力分钟：|完整学习时长：/);const day=v.nodes.find(n=>n.props?.['aria-pressed']===true);assert.match(renderToStaticMarkup(day),/听/);
 v.button('打开贡献原记录').props.onClick();assert.deepEqual(v.calls,[['select','listening-session:A']]);
});

test('calendar listening detail rechecks the entire original envelope and retains its export route',async()=>{
 const selected={source:'listening-session',record:{...ref,key:'listening-session:A',source:'listening-session'},listeningSession:{}};
 const v=mount({selected}),detail=v.nodes.find(n=>n.props?.repository);assert.ok(detail);assert.equal(detail.props.initialSessionId,'A');assert.equal(detail.props.detailOnly,true);assert.equal(detail.props.referenceRepository,undefined);
 const guarded=detail.props.repository;const records=await guarded.listListeningSessions();assert.equal(records.length,1);assert.equal(records[0],v.loaded);assert.deepEqual(v.calls,[['load-listening','A']]);
 let delivered=false;await guarded.deliverListeningSession('A',v.loaded,()=>{delivered=true});assert.equal(delivered,true);const delivery=v.calls.at(-1);assert.ok(delivery);assert.equal(delivery[0],'deliver-listening');assert.equal(delivery[2],v.loaded);
 v.loaded.identity='changed';await assert.rejects(guarded.listListeningSessions(),/听力条件记录已变化/);assert.equal(v.calls.filter(x=>x[0]==='list-listening').length,0);
 v.button('返回记录日历').props.onClick();assert.deepEqual(v.calls.at(-1),['back']);
});

test('missing listening target fails closed rather than falling back to another history list',async()=>{
 const selected={source:'listening-session',record:{...ref,key:'listening-session:A',source:'listening-session'},listeningSession:{}};
 const v=mount({selected},{missingListening:true}),detail=v.nodes.find(n=>n.props?.repository);assert.ok(detail);assert.equal(typeof detail.props.repository.listListeningSessions,'function');await assert.rejects(detail.props.repository.listListeningSessions(),/听力条件记录已变化/);assert.deepEqual(v.calls,[['load-listening','A']]);
});
