import {translate,translateKnownUi} from '../i18n/locale';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ReviewTaskComposer from '../components/ReviewTaskComposer';
import ReviewTaskPanel,{type ReviewTaskRow} from '../components/ReviewTaskPanel';
import * as dateTools from './review-due-time';
import type {ReviewDueTime} from './review-due-time';

const require=createRequire(import.meta.url),swc=require('next/dist/build/swc');await swc.loadBindings();
const sources=await Promise.all(['ReviewTaskComposer','ReviewTaskPanel'].map(name=>readFile(new URL(`../components/${name}.tsx`,import.meta.url),'utf8')));
const compiled=await Promise.all(sources.map((source,index)=>swc.transform(source+(index===0?'\nexport {ComposerForm as TestForm};':''),{jsc:{parser:{syntax:'typescript',tsx:true},transform:{react:{runtime:'automatic'}},target:'es2022'},module:{type:'commonjs'}})));
const due:ReviewDueTime={instant:'2000-01-01T12:00:00.000Z',localTime:'2000-01-01T12:00',timeZone:'UTC',offsetMinutes:0};
const later:ReviewDueTime={instant:'2099-02-02T02:30:00.000Z',localTime:'2099-02-02T10:30',timeZone:'Asia/Shanghai',offsetMinutes:480};
const row:ReviewTaskRow={taskId:'task-a',revision:1,status:'active',materialTitle:'咖啡馆课程',materialVersion:'original-1',cueNumber:2,due,nextDue:null,sourceCoverage:'complete',referenceStatus:'固定原版可用',resultSummary:'',canStart:true};
const second:ReviewTaskRow={...row,taskId:'task-b',cueNumber:3,due:later,sourceCoverage:'partial',materialVersion:'local-correction-2'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function gate<T=void>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
function walk(node:any,out:any[]=[]):any[]{if(Array.isArray(node)){node.forEach(value=>walk(value,out));return out}if(!node||typeof node!=='object')return out;out.push(node);walk(node.props?.children,out);return out}
function textOf(node:any):string{if(node==null||typeof node==='boolean')return '';if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(textOf).join('');return textOf(node.props?.children)}

/** Runs actual component handlers/effects. Only the hook scheduler and nested
 * date picker are substituted; the date picker has its own validation tests. */
function mount(kind:'composer'|'panel',overrides:any={},runtime:any={}){
 let locale:'en'|'zh-CN'='zh-CN';
 const cells:any[]=[],calls:any[]=[];let cursor=0,dirty=true,mounted=true,tree:any,lateStateUpdates=0,effects:(()=>void)[]=[];
 const sameDeps=(a:any,b:any)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const hooks={...React,
  useRef(initial:any){const index=cursor++;if(!cells[index])cells[index]={kind:'ref',value:{current:initial}};return cells[index].value},
  useState(initial:any){const index=cursor++;if(!cells[index]){const cell:any={kind:'state',value:typeof initial==='function'?initial():initial};cell.set=(next:any)=>{if(!mounted){lateStateUpdates++;return}const value=typeof next==='function'?next(cell.value):next;if(!Object.is(value,cell.value)){cell.value=value;dirty=true}};cells[index]=cell}return[cells[index].value,cells[index].set]},
  useEffect(effect:any,deps:any){const index=cursor++,prior=cells[index];if(!prior||!sameDeps(prior.deps,deps)){const next={kind:'effect',deps,cleanup:prior?.cleanup};cells[index]=next;effects.push(()=>{next.cleanup?.();next.cleanup=effect()})}},
 };
 const exports:any={};
 vm.runInNewContext(compiled[kind==='composer'?0:1].code,{exports,Error,crypto:webcrypto,...runtime,require:(name:string)=>name === '../i18n/react' ? {useStudioLocale: () => ({locale, t: (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate(locale, key, params), ui: (message: string) => translateKnownUi(locale, message)})} : name==='react'?hooks:name.includes('review-due-time')?dateTools:name.includes('ReviewDueTimeInput')?{__esModule:true,default:'review-date-input'}:require(name)});
 let props:any=kind==='composer'?{cueNumber:2,disabledReason:null,onSave:async(...args:any[])=>{calls.push(['save',...args]);return{disposition:'saved'}},onOpenLibrary:()=>calls.push(['library']),...overrides}:{entries:[row,second],unreadableCount:0,onReload:async()=>{calls.push(['reload'])},onStart:async(...args:any[])=>{calls.push(['start',...args])},onChange:async(...args:any[])=>{calls.push(['change',...args])},onExport:async(...args:any[])=>{calls.push(['export',...args])},...overrides};
 function flush(){if(!mounted)return;let turns=0;while(dirty||effects.length){if(++turns>100)throw Error('Hook render loop');if(dirty){dirty=false;cursor=0;tree=(kind==='composer'?exports.TestForm:exports.default)(props)}const queued=effects;effects=[];queued.forEach(effect=>effect())}}
 async function settle(){for(let count=0;count<4;count++){flush();await tick()}flush()}
 function button(label:string,index=0){flush();const node=walk(tree).filter(node=>node.type==='button'&&textOf(node)===label)[index];assert.ok(node,`Missing button ${label}`);return node}
 function click(label:string,index=0){const node=button(label,index);assert.equal(!!node.props.disabled,false,`Disabled button ${label}`);node.props.onClick();flush()}
 function date(label:string,value:ReviewDueTime|null){flush();const node=walk(tree).find(node=>node.type==='review-date-input'&&node.props.label===label);assert.ok(node,`Missing date ${label}`);assert.equal(!!node.props.disabled,false);node.props.onChange(value);flush()}
 function update(patch:any){props={...props,...patch};dirty=true;flush()}
 function unmount(){mounted=false;cells.forEach(cell=>{if(cell?.kind==='effect')cell.cleanup?.()});effects=[];dirty=false}
 flush();return{calls,button,click,date,update,settle,unmount,setLocale(next:'en'|'zh-CN'){locale=next;dirty=true;flush()},get text(){flush();return textOf(tree)},get tree(){flush();return tree},get lateStateUpdates(){return lateStateUpdates}};
}

test('composer SSR is date opt-in only, does not expose answers, and never saves on render',()=>{
 let saves=0;const html=renderToStaticMarkup(React.createElement(ReviewTaskComposer,{cueNumber:2,disabledReason:null,onSave:async()=>{saves++;return{disposition:'saved'}},onOpenLibrary(){},reference:'SECRET REFERENCE',answer:'PRIVATE ANSWER'} as any));
 assert.equal(saves,0);assert.match(html,/Save local review task/);assert.match(html,/No due date and time selected/);assert.match(html,/Creating a task adds no score or practice/);assert.match(html,/not inferred from mastery/);assert.doesNotMatch(html,/SECRET REFERENCE|PRIVATE ANSWER/);assert.match(html,/<button disabled="">Save local review task/);
});

test('panel SSR is metadata-only, groups stored instants, and separates partial provenance and corruption',()=>{
 let actions=0;const action=async()=>{actions++};
 const html=renderToStaticMarkup(React.createElement(ReviewTaskPanel,{entries:[{...row,referenceText:'SECRET REFERENCE',answer:'PRIVATE ANSWER'} as any,second,{...row,taskId:'task-c',status:'cancelled'}],unreadableCount:2,onReload:action,onStart:action,onChange:action,onExport:action}));
 assert.equal(actions,0);for(const expected of [/Due/,/Upcoming/,/Cancelled/,/Fixed version: original-1/,/Asia\/Shanghai/,/UTC\+08:00/,/Assistance and reference exposure are unknown/,/not treated as unaided completion/,/2 tasks could not be read safely/])assert.match(html,expected);
 assert.doesNotMatch(html,/SECRET REFERENCE|PRIVATE ANSWER|datetime-local|End this round and retest this sentence/);
});

test('empty, loading and failed reads do not invent results or conceal unreadable counts',()=>{
 const base:any={entries:[],unreadableCount:3,onReload:async()=>{},onStart:async()=>{},onChange:async()=>{},onExport:async()=>{}};
 const empty=renderToStaticMarkup(React.createElement(ReviewTaskPanel,base));assert.match(empty,/No readable review tasks/);assert.match(empty,/3 tasks could not be read safely/);assert.doesNotMatch(empty,/Actual retest record|0%|100%|Review completed/);
 const loading=renderToStaticMarkup(React.createElement(ReviewTaskPanel,{...base,loading:true}));assert.match(loading,/Reading local review tasks/);assert.doesNotMatch(loading,/No readable/);
 const failed=renderToStaticMarkup(React.createElement(ReviewTaskPanel,{...base,error:'读取失败'}));assert.match(failed,/role="alert"/);assert.match(failed,/读取失败/);assert.doesNotMatch(failed,/No readable|Review completed/);
});

test('composer needs a date and explicit save; unchanged failed retries retain identity, double clicks cannot duplicate',async()=>{
 const writes:any[]=[],held=gate<{disposition:'saved'|'already-present'}>();let attempt=0;
 const h=mount('composer',{onSave:async(...args:any[])=>{writes.push(args);if(++attempt===1)throw Error('Durable readback uncertain');if(attempt===2)return held.promise;return{disposition:'saved'}}});
 await h.settle();h.button('保存本机复习任务').props.onClick();assert.equal(writes.length,0);
 h.date('首次复习日期与时间',due);assert.equal(writes.length,0);h.click('保存本机复习任务');await h.settle();assert.match(h.text,/保存未完成/);
 h.click('保存本机复习任务');h.button('正在保存复习任务…').props.onClick();assert.equal(writes.length,2);assert.equal(writes[0][1],writes[1][1]);assert.match(writes[0][1],/^[\da-f-]{36}$/);
 held.resolve({disposition:'already-present'});await h.settle();assert.match(h.text,/没有重复创建/);
 h.date('首次复习日期与时间',{...due});h.click('保存本机复习任务');await h.settle();assert.equal(writes[2][1],writes[1][1]);
 h.date('首次复习日期与时间',later);h.click('保存本机复习任务');await h.settle();assert.notEqual(writes[3][1],writes[0][1]);assert.deepEqual(writes[3][0],later);h.unmount();
});

test('composer rejects stale date/disabled handlers and ignores completion after unmount',async()=>{
 const writes:any[]=[],held=gate<{disposition:'saved'}>();const h=mount('composer',{onSave:async(...args:any[])=>{writes.push(args);return held.promise}});
 h.date('首次复习日期与时间',due);const stale=h.button('保存本机复习任务').props.onClick;h.date('首次复习日期与时间',later);stale();assert.equal(writes.length,0);
 const disabled=h.button('保存本机复习任务').props.onClick;h.update({disabledReason:'来源尚未保存'});disabled();assert.equal(writes.length,0);
 h.update({disabledReason:null});h.click('保存本机复习任务');assert.equal(writes.length,1);h.unmount();held.resolve({disposition:'saved'});await h.settle();assert.equal(h.lateStateUpdates,0);
});

test('panel mount, selection and choosing dates are read-only; launch requires an explicit new-round action',async()=>{
 const h=mount('panel');await h.settle();assert.equal(h.calls.length,0);h.click('管理这条复习任务');assert.equal(h.calls.length,0);
 assert.equal(h.button('结束当前轮，开始本句复测').props.disabled,true);h.button('结束当前轮，开始本句复测').props.onClick();assert.equal(h.calls.length,0);
 h.date('本次复测后的下次日期与时间',later);assert.equal(h.calls.length,0);assert.match(h.text,/首个实际有效且成功保存/);assert.match(h.text,/有错误的真实结果也可生效/);assert.match(h.text,/跳过、未判定或保存失败不推进/);
 h.click('结束当前轮，开始本句复测');await h.settle();assert.deepEqual(h.calls,[['start',row,later]]);assert.match(h.text,/打开任务本身不算完成/);h.unmount();
});

test('stored next date is visibly reused and is not replaced by a new default or picker',async()=>{
 const stored={...row,nextDue:later};const h=mount('panel',{entries:[stored]});h.click('管理这条复习任务');assert.match(h.text,/沿用任务中已确定的下次日期/);assert.equal(walk(h.tree).filter(node=>node.type==='review-date-input').length,0);
 h.click('结束当前轮，开始本句复测');await h.settle();assert.deepEqual(h.calls,[['start',stored,later]]);h.unmount();
});

test('pending launch locks mutations, repeated launch, refresh and export; switching row suppresses stale errors',async()=>{
 const calls:any[]=[],held=gate();const h=mount('panel',{onStart:async(...args:any[])=>{calls.push(args);await held.promise}});
 h.click('管理这条复习任务');h.date('本次复测后的下次日期与时间',later);const start=h.button('结束当前轮，开始本句复测').props.onClick;h.click('结束当前轮，开始本句复测');start();
 h.button('刷新复习任务').props.onClick();h.button('取消这条复习任务').props.onClick();h.button('导出这条任务记录').props.onClick();assert.equal(calls.length,1);assert.equal(h.calls.length,0);
 h.click('管理这条复习任务',1);assert.match(h.text,/第 3 句/);held.reject(Error('OLD ROW FAILURE'));await h.settle();assert.doesNotMatch(h.text,/OLD ROW FAILURE/);assert.equal(h.button('结束当前轮，开始本句复测').props.disabled,true);h.unmount();
});

test('old revision, removed target and changed same-revision metadata invalidate selection without adopting another row',async()=>{
 for(const replacement of [[second],[{...row,revision:2},second],[{...row,materialVersion:'unrequested-new-version'},second]]){
  const h=mount('panel');h.click('管理这条复习任务');h.date('本次复测后的下次日期与时间',later);const stale=h.button('结束当前轮，开始本句复测').props.onClick;
  h.update({entries:replacement});stale();await h.settle();assert.equal(h.calls.length,0);assert.match(h.text,/所选任务已变化/);assert.doesNotMatch(h.text,/已选择：/);h.unmount();
 }
});

test('stale date handler and a new blocker cannot start a retest',async()=>{
 const h=mount('panel');h.click('管理这条复习任务');h.date('本次复测后的下次日期与时间',due);const old=h.button('结束当前轮，开始本句复测').props.onClick;
 h.date('本次复测后的下次日期与时间',later);old();assert.equal(h.calls.length,0);const newer=h.button('结束当前轮，开始本句复测').props.onClick;h.update({blockedReason:'请先明确开启练习记录'});newer();await h.settle();assert.equal(h.calls.length,0);assert.match(h.text,/请先明确开启/);h.unmount();
});

test('cancel changes only status; restore and reschedule require their own explicitly chosen dates',async()=>{
 const h=mount('panel');h.click('管理这条复习任务');h.click('取消这条复习任务');await h.settle();assert.deepEqual(h.calls,[['change',row,'cancel',undefined]]);
 h.click('选择新的复习日期');assert.equal(h.button('确认改期').props.disabled,true);h.button('确认改期').props.onClick();assert.equal(h.calls.length,1);h.date('改期后的复习日期与时间',later);h.click('确认改期');await h.settle();assert.deepEqual(h.calls[1],['change',row,'reschedule',later]);h.unmount();
 const cancelled={...row,status:'cancelled' as const};const restored=mount('panel',{entries:[cancelled]});restored.click('管理这条复习任务');assert.doesNotMatch(restored.text,/结束当前轮，开始本句复测/);restored.click('选择日期并恢复任务');assert.equal(restored.button('确认恢复任务').props.disabled,true);restored.button('确认恢复任务').props.onClick();assert.equal(restored.calls.length,0);restored.date('恢复后的复习日期与时间',due);restored.click('确认恢复任务');await restored.settle();assert.deepEqual(restored.calls,[['change',cancelled,'restore',due]]);restored.unmount();
});

test('stale change-form handler cannot commit a replaced date or a dismissed operation',async()=>{
 const h=mount('panel');h.click('管理这条复习任务');h.click('选择新的复习日期');h.date('改期后的复习日期与时间',due);const old=h.button('确认改期').props.onClick;
 h.date('改期后的复习日期与时间',later);old();assert.equal(h.calls.length,0);const newer=h.button('确认改期').props.onClick;h.click('取消日期变更');newer();await h.settle();assert.equal(h.calls.length,0);h.unmount();
});

test('refresh is explicit, read-only and failed operations clearly remain incomplete',async()=>{
 let reads=0;const h=mount('panel',{onReload:async()=>{reads++;throw Error('Database unavailable')}});assert.equal(reads,0);h.click('刷新复习任务');await h.settle();assert.equal(reads,1);assert.match(h.text,/刷新未完成/);assert.match(h.text,/Database unavailable/);assert.equal(h.calls.length,0);
 h.click('管理这条复习任务');h.update({onChange:async()=>{throw Error('Revision changed')}});h.click('取消这条复习任务');await h.settle();assert.match(h.text,/任务变更未完成/);assert.match(h.text,/Revision changed/);assert.doesNotMatch(h.text,/已取消任务/);h.unmount();
});

test('unmount fences both success and failure from panel async handlers',async()=>{
 for(const failed of [false,true]){const held=gate();const h=mount('panel',{onExport:()=>held.promise});h.click('管理这条复习任务');h.click('导出这条任务记录');h.unmount();if(failed)held.reject(Error('late export failure'));else held.resolve();await h.settle();assert.equal(h.lateStateUpdates,0)}
});

test('UI components do not import an engine, create attempts, read persistence or touch the stage/recorder',()=>{
 for(const source of sources)assert.doesNotMatch(source,/TrainingEngine|PracticeEngine|\.submit\(|\.input\(|indexedDB|localStorage|captureStream|getUserMedia|\.reference\.text|\.answer\b|dangerouslySetInnerHTML|setInterval/);
 assert.match(sources[0],/request\.current\.id/);assert.match(sources[1],/generation===epoch\.current/);assert.match(sources[1],/latest\.current\.entries\.some/);assert.doesNotMatch(sources[1],/onDelete|onRemove|永久删除/);
});


test('changing interface locale preserves review selection, chosen date and explicit launch guards',async()=>{
 const h=mount('panel');h.click('管理这条复习任务');h.date('本次复测后的下次日期与时间',later);
 h.setLocale('en');assert.equal(h.calls.length,0);assert.match(h.text,/Selected: 咖啡馆课程 · Sentence 2/);
 const date=walk(h.tree).find(node=>node.type==='review-date-input');assert.deepEqual(date.props.value,later);
 assert.equal(h.button('End this round and retest this sentence').props.disabled,false);
 h.click('End this round and retest this sentence');await h.settle();assert.deepEqual(h.calls,[['start',row,later]]);
 assert.match(h.text,/Opening a task does not itself count as completion/);h.setLocale('zh-CN');
 assert.match(h.text,/打开任务本身不算完成/);assert.deepEqual(h.calls,[['start',row,later]]);h.unmount();
});

test('a locale change during save keeps one request and translates feedback when it completes',async()=>{
 const writes:any[]=[],held=gate<{disposition:'saved'}>();
 const h=mount('composer',{onSave:async(...args:any[])=>{writes.push(args);return held.promise}});
 h.date('首次复习日期与时间',later);h.click('保存本机复习任务');h.setLocale('en');
 assert.equal(writes.length,1);assert.equal(h.button('Saving review task…').props.disabled,true);
 h.button('Saving review task…').props.onClick();assert.equal(writes.length,1);
 assert.deepEqual(writes[0][0],later);held.resolve({disposition:'saved'});await h.settle();
 assert.match(h.text,/The local review task was saved for your chosen date/);assert.equal(writes.length,1);h.unmount();
});

for(const action of ['cancel','restore','reschedule'] as const)test(`own ${action} revision refresh reports successful change without a false stale-selection warning`,async()=>{
 const initial:ReviewTaskRow={...row,status:action==='restore'?'cancelled':'active'};
 const h=mount('panel',{entries:[initial]});
 h.update({onChange:async(changed:ReviewTaskRow,operation:string,chosen?:ReviewDueTime)=>{
  assert.equal(operation,action);assert.equal(changed.revision,1);
  h.update({entries:[{...initial,revision:2,status:action==='cancel'?'cancelled':'active',due:chosen??initial.due}]});
 }});
 h.click('管理这条复习任务');
 if(action==='cancel')h.click('取消这条复习任务');
 else if(action==='restore'){h.click('选择日期并恢复任务');h.date('恢复后的复习日期与时间',later);h.click('确认恢复任务')}
 else{h.click('选择新的复习日期');h.date('改期后的复习日期与时间',later);h.click('确认改期')}
 await h.settle();assert.match(h.text,action==='cancel'?/已取消任务/:action==='restore'?/已按你明确选择的日期恢复任务/:/已按你明确选择的日期改期/);
 assert.doesNotMatch(h.text,/所选任务已变化|已选择：/);h.unmount();
});

function panelClock(start:number){
 let now=start,id=0;const timers=new Map<number,{at:number;callback:()=>void}>();
 const focus=new Set<()=>void>(),visibility=new Set<()=>void>();
 const doc={hidden:false,addEventListener(_name:string,fn:()=>void){visibility.add(fn)},removeEventListener(_name:string,fn:()=>void){visibility.delete(fn)}};
 const runtime={Date:class extends Date{static now(){return now}},document:doc,window:{
  setTimeout(callback:()=>void,delay:number){const key=++id;timers.set(key,{at:now+delay,callback});return key},
  clearTimeout(key:number){timers.delete(key)},
  addEventListener(_name:string,fn:()=>void){focus.add(fn)},removeEventListener(_name:string,fn:()=>void){focus.delete(fn)},
 }};
 return{runtime,get timerCount(){return timers.size},get listenerCount(){return focus.size+visibility.size},
  advance(time:number){now=time;for(const[key,timer]of [...timers])if(timer.at<=now){timers.delete(key);timer.callback()}},
  focus(time=now){now=time;for(const callback of [...focus])callback()},
  hide(hidden:boolean,time=now){now=time;doc.hidden=hidden;for(const callback of [...visibility])callback()},
 };
}
const clockDue:ReviewDueTime={instant:'2030-01-10T10:00:00.000Z',localTime:'2030-01-10T10:00',timeZone:'UTC',offsetMinutes:0};
const dueInstant=Date.parse(clockDue.instant);
test('an open review panel changes upcoming to due at its saved instant without user action or a write',()=>{
 const clock=panelClock(dueInstant-1000),saved={...row,due:clockDue},before=JSON.stringify(saved);
 const h=mount('panel',{entries:[saved]},clock.runtime);assert.match(h.text,/计划状态：待复习 · 尚未到期/);assert.equal(clock.timerCount,1);
 clock.advance(dueInstant-1);assert.match(h.text,/计划状态：待复习 · 尚未到期/);
 clock.advance(dueInstant);assert.match(h.text,/计划状态：待复习 · 已到期/);assert.doesNotMatch(h.text,/计划状态：待复习 · 尚未到期/);
 assert.equal(h.calls.length,0);assert.equal(JSON.stringify(saved),before);h.unmount();assert.equal(clock.timerCount,0);assert.equal(clock.listenerCount,0);
});
test('review due metadata catches up on focus and visibility, handles a backward clock, and releases old timers',()=>{
 const clock=panelClock(dueInstant-1000),saved={...row,due:clockDue},h=mount('panel',{entries:[saved]},clock.runtime);
 clock.hide(true);assert.equal(clock.timerCount,0);clock.advance(dueInstant+1000);assert.match(h.text,/计划状态：待复习 · 尚未到期/);
 clock.hide(false);assert.match(h.text,/计划状态：待复习 · 已到期/);assert.equal(clock.timerCount,1);
 clock.focus(dueInstant-1000);assert.match(h.text,/计划状态：待复习 · 尚未到期/);assert.equal(clock.timerCount,1);
 clock.advance(dueInstant);assert.match(h.text,/计划状态：待复习 · 已到期/);assert.equal(h.calls.length,0);
 h.update({entries:[{...saved,status:'cancelled'}]});assert.equal(clock.timerCount,0);h.update({entries:[]});assert.equal(clock.timerCount,0);
 h.unmount();clock.focus();clock.hide(false);assert.equal(h.lateStateUpdates,0);assert.equal(clock.listenerCount,0);
});
test('clock repaints preserve selected next dates, editing state and locale and never advance a task',()=>{
 const clock=panelClock(dueInstant-1000),h=mount('panel',{entries:[{...row,due:clockDue}]},clock.runtime);
 h.click('管理这条复习任务');h.date('本次复测后的下次日期与时间',later);h.click('选择新的复习日期');h.date('改期后的复习日期与时间',clockDue);
 clock.advance(dueInstant);assert.match(h.text,/计划状态：待复习 · 已到期/);assert.match(h.text,/已选择：/);
 const dates=walk(h.tree).filter(node=>node.type==='review-date-input');assert.deepEqual(dates.map(node=>node.props.value),[later,clockDue]);
 h.setLocale('en');assert.match(h.text,/Awaiting review · Due/);assert.equal(h.calls.length,0);assert.equal(clock.timerCount,1);h.unmount();
});
test('own revision refresh followed by a failed operation remains a visible failure, while a newer selection fences its result',async()=>{
 const failed=mount('panel',{entries:[row]});failed.update({onChange:async()=>{failed.update({entries:[{...row,revision:2,status:'cancelled'}]});throw Error('Readback failed')}});
 failed.click('管理这条复习任务');failed.click('取消这条复习任务');await failed.settle();assert.match(failed.text,/任务变更未完成/);assert.match(failed.text,/Readback failed/);assert.doesNotMatch(failed.text,/已取消任务；|所选任务已变化/);failed.unmount();
 for(const rejects of [false,true]){const held=gate(),h=mount('panel',{onChange:async()=>held.promise});
  h.click('管理这条复习任务');h.click('取消这条复习任务');h.click('管理这条复习任务',1);h.update({entries:[{...row,revision:2,status:'cancelled'},second]});
  if(rejects)held.reject(Error('STALE CHANGE ERROR'));else held.resolve();await h.settle();
  assert.match(h.text,/已选择：咖啡馆课程 · 第 3 句/);assert.doesNotMatch(h.text,/已取消任务；|STALE CHANGE ERROR|所选任务已变化/);h.unmount();
 }
});
