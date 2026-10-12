import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import React from 'react';

const require=createRequire(import.meta.url),swc=require('next/dist/build/swc');
await swc.loadBindings();
const source=await readFile(new URL('../components/ContextBookmarkLibrary.tsx',import.meta.url),'utf8');
const {code}=await swc.transform(source,{jsc:{parser:{syntax:'typescript',tsx:true},transform:{react:{runtime:'automatic'}},target:'es2022'},module:{type:'commonjs'}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
const copy=value=>JSON.parse(JSON.stringify(value));
const reference={materialId:'cafe-original',materialVersion:'cafe-studio-v1',cueId:'cafe-studio-1',text:'Could I have a coffee, please?',startSeconds:0,endSeconds:6,mediaId:'cafe-original-video-v1',mediaSha256:'22fc25ade368f351cda21951916e559ff359cf1ac8419fbfa5444e050cdbf740'};
const row={schemaVersion:'context-bookmark-v1',key:'first-key',saveId:'first-incarnation',reference,selection:{start:0,end:7,text:'Could I'},createdAt:'2026-10-10T06:00:00.000Z'};
const second={...row,key:'second-key',saveId:'second-incarnation',selection:{start:15,end:21,text:'coffee'}};
function walk(node,out=[]){if(Array.isArray(node)){node.forEach(value=>walk(value,out));return out}if(!node||typeof node!=='object')return out;out.push(node);walk(node.props?.children,out);return out}
function textOf(node){if(node===null||node===undefined||typeof node==='boolean')return '';if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(textOf).join('');return textOf(node.props?.children)}
class Target extends EventTarget{
 handlers=new Map();hidden=false;
 addEventListener(name,callback,options){const handlers=this.handlers.get(name)??new Set();handlers.add(callback);this.handlers.set(name,handlers);super.addEventListener(name,callback,options)}
 removeEventListener(name,callback,options){this.handlers.get(name)?.delete(callback);if(!this.handlers.get(name)?.size)this.handlers.delete(name);super.removeEventListener(name,callback,options)}
 emit(name){this.dispatchEvent(new Event(name))}
 get count(){return [...this.handlers.values()].reduce((total,handlers)=>total+handlers.size,0)}
}

/** The real component is transpiled, not reimplemented. Hook cells survive renders;
 * dependency changes run cleanup and effects, and the real video ref is committed
 * before effects. Tests drive actual returned button handlers and event listeners. */
function setup(options={}){
 const windowTarget=new Target(),documentTarget=new Target(),video={kind:'dedicated-bookmark-video'};
 const calls=[],listeners=new Set(),controllers=[],records=new Map((options.rows??[row,second]).map(item=>[item.key,copy(item)]));
 let authoritativeRecording=false,beforePlayAllowed=true,loadOverride=null,removeOverride=null,mediaLoadOverride=null;
 const repository={
  subscribe(listener){calls.push(['repository.subscribe']);listeners.add(listener);return()=>{calls.push(['repository.unsubscribe']);listeners.delete(listener)}},
  async list(){calls.push(['repository.list']);return{entries:[...records.values()].map(copy),unreadableCount:0}},
  async load(key){calls.push(['repository.load',key]);return loadOverride?loadOverride(key):copy(records.get(key)??null)},
  async remove(key,expectedSaveId){calls.push(['repository.remove',key,expectedSaveId]);if(removeOverride)await removeOverride(key,expectedSaveId);else records.delete(key);for(const listener of [...listeners])listener()},
 };
 class Controller{
  state={phase:'empty',reference:null,duration:null,currentTime:null,error:null,recordingBlocked:false};subscribers=new Set();epoch=0;disposed=false;
  constructor(dependencies){this.dependencies=dependencies;calls.push(['controller.construct',dependencies.video]);controllers.push(this)}
  getState(){return this.state}
  publish(patch){if(this.disposed)return;this.state={...this.state,...patch};for(const listener of [...this.subscribers])listener()}
  subscribe(listener){this.subscribers.add(listener);calls.push(['controller.subscribe']);return()=>{this.subscribers.delete(listener);calls.push(['controller.unsubscribe'])}}
  select(value){this.epoch++;calls.push(['controller.select',value]);this.publish({phase:value?'selected':'empty',reference:value,error:null})}
  async load(loadOptions){calls.push(['controller.load',copy(loadOptions)]);const epoch=this.epoch;this.publish({phase:'loading'});const result=mediaLoadOverride?await mediaLoadOverride(loadOptions):null;if(this.disposed||epoch!==this.epoch)return;if(result?.error)this.publish({phase:'error',error:result.error});else this.publish({phase:'ready',duration:72,error:null})}
  play(){calls.push(['controller.play']);this.publish({phase:'playing'});return Promise.resolve()}
  pause(){calls.push(['controller.pause']);this.publish({phase:'ready'})}
  close(){this.epoch++;calls.push(['controller.close']);this.publish({phase:'empty',reference:null,error:null})}
  dispose(){calls.push(['controller.dispose']);this.epoch++;this.disposed=true;this.subscribers.clear()}
  setMonitor(value){calls.push(['controller.monitor',copy(value)])}
  setRecordingBlocked(value){calls.push(['controller.recording',value]);this.publish({recordingBlocked:value,...(value&&this.state.phase==='playing'?{phase:'ready'}:{})})}
 }
 const cells=[];let cursor=0,dirty=true,mounted=true,rendering=false,effects=[],tree=null,renderCount=0,lateStateUpdates=0;
 const sameDeps=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const hooks={...React,
  useRef(initial){const index=cursor++;if(!cells[index])cells[index]={kind:'ref',value:{current:initial}};return cells[index].value},
  useState(initial){const index=cursor++;if(!cells[index]){const cell={kind:'state',value:typeof initial==='function'?initial():initial,set:null};cell.set=next=>{if(!mounted){lateStateUpdates++;return}const value=typeof next==='function'?next(cell.value):next;if(!Object.is(value,cell.value)){cell.value=value;dirty=true}};cells[index]=cell}return[cells[index].value,cells[index].set]},
  useEffect(effect,deps){const index=cursor++,prior=cells[index];if(!prior||!sameDeps(prior.deps,deps)){const next={kind:'effect',deps,cleanup:prior?.cleanup};cells[index]=next;effects.push(()=>{next.cleanup?.();next.cleanup=effect()})}},
 };
 const exports={};vm.runInNewContext(code,{exports,Error,window:windowTarget,document:documentTarget,require:name=>name==='react'?hooks:name.includes('context-bookmark-media')?{createContextBookmarkPreviewController:dependencies=>new Controller(dependencies)}:name.endsWith('/context-bookmark')?{isCurrentBookmarkReference:value=>Object.keys(reference).every(key=>value[key]===reference[key])}:require(name)});
 const controllerRef={current:null};let props={repository,pool:{name:'shared-lesson-pool'},controllerRef,monitor:{volume:.8,courseMuted:false,allMuted:false},recordingBlocked:false,isRecordingBlocked:()=>authoritativeRecording,onBeforePlay:()=>{calls.push(['beforePlay']);return beforePlayAllowed}};
 const flush=()=>{
  if(!mounted||rendering)return;rendering=true;
  try{let turns=0;while(dirty||effects.length){if(++turns>100)throw new Error('Hook harness exceeded render/effect limit');if(dirty){dirty=false;cursor=0;tree=exports.default(props);renderCount++;for(const node of walk(tree)){if(node.type==='video'&&node.props.ref)node.props.ref.current=video}}
   const queued=effects;effects=[];for(const effect of queued)effect();
  }}finally{rendering=false}
 };
 const settle=async()=>{for(let count=0;count<3;count++){flush();await tick()}flush()};
 const button=(label,index=0)=>{flush();const found=walk(tree).filter(node=>node.type==='button'&&textOf(node)===label)[index];assert.ok(found,`Missing button: ${label} (${index})`);return found};
 const click=(label,index=0)=>{const target=button(label,index);assert.equal(!!target.props.disabled,false,`Button disabled: ${label}`);target.props.onClick();flush()};
 const update=patch=>{props={...props,...patch};dirty=true;flush()};
 const unmount=()=>{if(!mounted)return;mounted=false;for(const cell of cells)if(cell?.kind==='effect')cell.cleanup?.();for(const node of walk(tree))if(node.type==='video'&&node.props.ref)node.props.ref.current=null;effects=[];dirty=false};
 flush();
 return{calls,records,repository,listeners,controllers,controllerRef,windowTarget,documentTarget,video,flush,settle,button,click,update,unmount,
  get text(){flush();return textOf(tree)},get controller(){return controllers[0]},get renderCount(){return renderCount},get lateStateUpdates(){return lateStateUpdates},
  setLoad:fn=>{loadOverride=fn},setRemove:fn=>{removeOverride=fn},setMediaLoad:fn=>{mediaLoadOverride=fn},
  setRecording:value=>{authoritativeRecording=value},setBeforePlay:value=>{beforePlayAllowed=value},
  emitRepository:()=>{for(const listener of [...listeners])listener();flush()},
  async choose(index=0){await settle();click('查看收藏语境',index)},
  async prepare(){click('核验并准备片段');await settle()},
 };
}
const count=(environment,kind)=>environment.calls.filter(call=>call[0]===kind).length;
const ready=async environment=>{await environment.choose();await environment.prepare();assert.equal(environment.button('播放收藏片段').props.disabled,false)};

test('actual library hooks retain state/ref/controller across rerenders and never load or play on mount or selection',async()=>{
 const p=setup();await p.settle();assert.equal(p.controllers.length,1);assert.equal(p.controller.dependencies.video,p.video);assert.equal(count(p,'controller.load'),0);assert.equal(count(p,'controller.play'),0);
 await p.choose();assert.equal(count(p,'controller.load'),0);assert.equal(p.button('播放收藏片段').props.disabled,true);
 p.update({monitor:{volume:.25,courseMuted:true,allMuted:false}});p.update({monitor:{volume:.5,courseMuted:false,allMuted:true}});
 assert.equal(p.controllers.length,1);assert.ok(p.renderCount>3);assert.deepEqual(p.calls.filter(call=>call[0]==='controller.monitor').slice(-2),[['controller.monitor',{volume:.25,courseMuted:true,allMuted:false}],['controller.monitor',{volume:.5,courseMuted:false,allMuted:true}]]);
 p.unmount();assert.equal(count(p,'controller.dispose'),1);assert.equal(count(p,'repository.unsubscribe'),1);assert.equal(p.controllerRef.current,null);assert.equal(p.windowTarget.count,0);assert.equal(p.documentTarget.count,0);
});

test('actual prepare rereads before and after loading, never autoplays; separate Play invokes native controller synchronously',async()=>{
 const p=setup();await p.choose();const marker=p.calls.length;await p.prepare();
 const ordered=p.calls.slice(marker).filter(call=>['repository.load','controller.select','controller.load','controller.play'].includes(call[0])).map(call=>call[0]);
 assert.deepEqual(ordered,['repository.load','controller.select','controller.load','repository.load']);assert.equal(count(p,'controller.play'),0);assert.match(p.text,/原片与保存来源已核验/);
 const reads=count(p,'repository.load');p.click('播放收藏片段');assert.equal(count(p,'controller.play'),1,'Play is called before awaiting any task');assert.equal(count(p,'repository.load'),reads);assert.equal(count(p,'beforePlay'),1);
 assert.equal(p.button('暂停收藏片段').props.disabled,false);p.click('暂停收藏片段');assert.equal(count(p,'controller.pause'),1);assert.equal(p.button('播放收藏片段').props.disabled,false);p.unmount();
});

test('ready-only Play cannot run before preparation or while authoritative recording guard is true',async()=>{
 const p=setup();await p.choose();const early=p.button('播放收藏片段').props.onClick;early();assert.equal(count(p,'controller.play'),0);
 await p.prepare();const handler=p.button('播放收藏片段').props.onClick;p.setRecording(true);handler();assert.equal(count(p,'controller.play'),0);assert.equal(count(p,'beforePlay'),0);
 p.update({recordingBlocked:true});assert.equal(p.button('播放收藏片段').props.disabled,true);assert.doesNotMatch(p.text,/原片与保存来源已核验/);
 p.setRecording(false);p.update({recordingBlocked:false});assert.equal(p.button('播放收藏片段').props.disabled,true);assert.equal(count(p,'controller.play'),0);
 await p.prepare();p.setBeforePlay(false);p.click('播放收藏片段');assert.equal(count(p,'controller.play'),0);p.setBeforePlay(true);p.click('播放收藏片段');assert.equal(count(p,'controller.play'),1);p.unmount();
});

test('recording guard blocks prepare even before disabled state is rendered, and invalidates an in-flight prepare',async()=>{
 const p=setup();await p.choose();p.setRecording(true);p.click('核验并准备片段');assert.equal(count(p,'repository.load'),0);
 p.setRecording(false);const held=gate();p.setMediaLoad(()=>held.promise);p.click('核验并准备片段');await p.settle();
 p.setRecording(true);p.update({recordingBlocked:true});held.resolve();await p.settle();assert.equal(p.button('播放收藏片段').props.disabled,true);assert.equal(count(p,'controller.play'),0);
 p.setRecording(false);p.update({recordingBlocked:false});assert.equal(p.button('核验并准备片段').props.disabled,false);p.unmount();
});

for(const event of ['repository','focus','hidden','pagehide','refresh']){
 test(`actual ${event} handler clears ready authority and verified-ready message without replaying`,async()=>{
  const p=setup();await ready(p);const handler=p.button('播放收藏片段').props.onClick;
  if(event==='repository')p.emitRepository();else if(event==='focus')p.windowTarget.emit('focus');else if(event==='hidden'){p.documentTarget.hidden=true;p.documentTarget.emit('visibilitychange')}else if(event==='pagehide')p.windowTarget.emit('pagehide');else p.click('刷新语境收藏');
  await p.settle();handler();assert.equal(count(p,'controller.play'),0);assert.equal(p.button('播放收藏片段').props.disabled,true);assert.doesNotMatch(p.text,/原片与保存来源已核验/);
  if(event==='hidden'){p.documentTarget.hidden=false;p.documentTarget.emit('visibilitychange')}else if(event==='pagehide')p.windowTarget.emit('pageshow');await p.settle();assert.equal(count(p,'controller.play'),0);assert.equal(p.button('播放收藏片段').props.disabled,true);p.unmount();
 });
}

for(const mutation of ['removed','readded','changed']){
 test(`first saved-record reread blocks ${mutation} row before any media loading`,async()=>{
  const p=setup();await p.choose();if(mutation==='removed')p.records.delete(row.key);else p.records.set(row.key,mutation==='readded'?{...copy(row),saveId:'new-incarnation'}:{...copy(row),selection:{start:8,end:12,text:'have'}});
  await p.prepare();assert.equal(count(p,'controller.load'),0);assert.equal(count(p,'controller.play'),0);assert.match(p.text,/收藏已被取消或更改/);p.unmount();
 });
 test(`second saved-record reread blocks ${mutation} row during media preparation`,async()=>{
  const p=setup();await p.choose();const held=gate();p.setMediaLoad(()=>held.promise);p.click('核验并准备片段');await p.settle();assert.equal(count(p,'controller.load'),1);
  if(mutation==='removed')p.records.delete(row.key);else p.records.set(row.key,mutation==='readded'?{...copy(row),saveId:'new-incarnation'}:{...copy(row),createdAt:'2026-10-10T07:00:00.000Z'});
  held.resolve();await p.settle();assert.equal(count(p,'repository.load'),2);assert.equal(count(p,'controller.play'),0);assert.match(p.text,/加载期间收藏已改变/);p.unmount();
 });
}

test('media preparation error remains visible and next explicit prepare passes retry:true',async()=>{
 const p=setup();await p.choose();let attempt=0;p.setMediaLoad(async()=>++attempt===1?{error:'原片字节校验失败'}:null);
 await p.prepare();assert.match(p.text,/原片字节校验失败/);assert.equal(p.button('播放收藏片段').props.disabled,true);assert.deepEqual(p.calls.find(call=>call[0]==='controller.load'),['controller.load',{retry:false}]);
 await p.prepare();assert.deepEqual(p.calls.filter(call=>call[0]==='controller.load').at(-1),['controller.load',{retry:true}]);assert.equal(p.button('播放收藏片段').props.disabled,false);assert.equal(count(p,'controller.play'),0);p.unmount();
});

for(const pendingStage of ['record reread','media load']){
 test(`failed removal of another row while ${pendingStage} is pending cannot strand preparation`,async()=>{
  const p=setup();await p.choose();const held=gate();if(pendingStage==='record reread')p.setLoad(()=>held.promise);else p.setMediaLoad(()=>held.promise);
  p.click('核验并准备片段');await p.settle();p.setRemove(async()=>{throw new Error('Removal failed')});p.click('取消这条收藏',1);await p.settle();
  assert.match(p.text,/Removal failed/);assert.equal(p.button('核验并准备片段').props.disabled,false,'Invalidated preparation must be retryable even when remove rejects');assert.equal(p.button('播放收藏片段').props.disabled,true);
  held.resolve(pendingStage==='record reread'?copy(row):undefined);await p.settle();assert.equal(p.button('核验并准备片段').props.disabled,false);assert.equal(p.button('播放收藏片段').props.disabled,true);assert.doesNotMatch(p.text,/原片与保存来源已核验/);assert.equal(count(p,'controller.play'),0);p.unmount();
 });
}

test('late prepare completion after selection change cannot arm the previous saved row',async()=>{
 const p=setup();await p.choose();const held=gate();p.setMediaLoad(()=>held.promise);p.click('核验并准备片段');await p.settle();p.click('查看收藏语境',1);
 held.resolve();await p.settle();assert.equal(p.button('播放收藏片段').props.disabled,true);assert.doesNotMatch(p.text,/原片与保存来源已核验/);assert.equal(count(p,'controller.play'),0);
 p.setMediaLoad(null);await p.prepare();assert.equal(p.button('播放收藏片段').props.disabled,false);assert.equal(p.calls.filter(call=>call[0]==='repository.load').at(-1)[1],second.key);p.unmount();
});

test('repository invalidation removes selected stale incarnation and never replaces its authority with a readded row',async()=>{
 const p=setup();await ready(p);p.records.set(row.key,{...copy(row),saveId:'readded'});p.emitRepository();await p.settle();
 assert.match(p.text,/所选收藏已被取消、更改或不可读取/);assert.equal(count(p,'controller.play'),0);assert.equal(p.controller.getState().phase,'empty');p.unmount();
});

for(const pendingStage of ['record reread','media load']){
 test(`unmount cleans actual effects and fences late ${pendingStage} completion`,async()=>{
  const p=setup();await p.choose();const held=gate();if(pendingStage==='record reread')p.setLoad(()=>held.promise);else p.setMediaLoad(()=>held.promise);
  p.click('核验并准备片段');await p.settle();p.unmount();const after=p.calls.length;held.resolve(pendingStage==='record reread'?copy(row):undefined);await p.settle();
  assert.equal(count(p,'controller.dispose'),1);assert.equal(p.listeners.size,0);assert.equal(p.windowTarget.count,0);assert.equal(p.documentTarget.count,0);assert.equal(p.controllerRef.current,null);assert.equal(p.lateStateUpdates,0);assert.equal(p.calls.length,after);assert.equal(count(p,'controller.play'),0);
 });
}


test('repreparing an actively playing clip closes it synchronously before a failed saved-record reread',async()=>{
 const p=setup();await ready(p);p.click('播放收藏片段');assert.equal(p.controller.getState().phase,'playing');const held=gate();p.setLoad(()=>held.promise);
 const closes=count(p,'controller.close');p.click('核验并准备片段');assert.equal(count(p,'controller.close'),closes+1);assert.notEqual(p.controller.getState().phase,'playing');assert.equal(p.button('播放收藏片段').props.disabled,true);
 held.reject(new Error('Saved record read failed'));await p.settle();assert.match(p.text,/Saved record read failed/);assert.equal(p.button('核验并准备片段').props.disabled,false);assert.equal(p.button('播放收藏片段').props.disabled,true);assert.equal(count(p,'controller.play'),1);assert.doesNotMatch(p.text,/原片与保存来源已核验/);p.unmount();
});

test('controller callbacks read current recording/before-play props without rebuilding the media owner',async()=>{
 const p=setup();await ready(p);assert.equal(p.controller.dependencies.validateReference(reference),null);assert.notEqual(p.controller.dependencies.validateReference({...reference,materialVersion:'old'}),null);
 p.update({isRecordingBlocked:()=>true,onBeforePlay:()=>{throw new Error('Must not reach pre-play during recording')}});
 assert.equal(p.controller.dependencies.isRecordingBlocked(),true);p.button('播放收藏片段').props.onClick();assert.equal(count(p,'controller.play'),0);assert.equal(p.controllers.length,1);
 p.update({isRecordingBlocked:()=>false,onBeforePlay:()=>false});p.click('播放收藏片段');assert.equal(count(p,'controller.play'),0);
 p.update({onBeforePlay:()=>true});p.click('播放收藏片段');assert.equal(count(p,'controller.play'),1);assert.equal(p.controllers.length,1);p.unmount();
});

test('stale row removal passes its saved identity and refreshes the actual replacement after conflict',async()=>{
 const p=setup();await p.choose();const fresh={...copy(row),saveId:'fresh-incarnation'};
 p.records.set(row.key,fresh);p.setRemove(async(key,id)=>{assert.equal(key,row.key);assert.equal(id,row.saveId);throw Error('收藏已被另一页面重新保存，未删除新记录')});
 const before=count(p,'repository.list');p.click('取消这条收藏',0);await p.settle();
 assert.deepEqual(p.calls.filter(call=>call[0]==='repository.remove').at(-1),['repository.remove',row.key,row.saveId]);
 assert.equal(count(p,'repository.list'),before+1);assert.match(p.text,/未删除新记录/);assert.doesNotMatch(p.text,/已取消这条本机收藏/);assert.equal(p.controller.getState().phase,'empty');
 p.click('查看收藏语境',0);await p.prepare();assert.equal(p.button('播放收藏片段').props.disabled,false,'fresh reread is the row offered for explicit next actions');assert.equal(p.records.get(row.key).saveId,fresh.saveId);p.unmount();
});
