import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import MaterialCorrectionPanel from '../components/MaterialCorrectionPanel';
import {CAFE_MATERIAL,hasScorableReference} from './training';
import {createContextBookmarkPreviewController,ORIGINAL_COURSE_MEDIA} from '../media/context-bookmark-media';
import {translate,translateKnownUi} from '../i18n/locale';

const require=createRequire(import.meta.url),swc=require('next/dist/build/swc');await swc.loadBindings();
const source=await readFile(new URL('../components/MaterialCorrectionPanel.tsx',import.meta.url),'utf8');
const {code}=await swc.transform(source,{jsc:{parser:{syntax:'typescript',tsx:true},transform:{react:{runtime:'automatic'}},target:'es2022'},module:{type:'commonjs'}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function gate<T=any>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
const copy=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
const current={material:CAFE_MATERIAL,cueId:CAFE_MATERIAL.cues[0].id,mediaId:ORIGINAL_COURSE_MEDIA.mediaId,mediaSha256:ORIGINAL_COURSE_MEDIA.mediaSha256};
const row={key:'saved-a',material:{...CAFE_MATERIAL,version:'local-ref-a',cues:CAFE_MATERIAL.cues.map(cue=>({...cue,text:`SECRET SAVED ${cue.id}`}))},parent:{version:CAFE_MATERIAL.version},change:{cueId:CAFE_MATERIAL.cues[1].id,before:{text:'HIDDEN BEFORE'},after:{text:'HIDDEN AFTER'}},createdAt:'2026-10-10T08:00:00.000Z'};
const second={...row,key:'saved-b',material:{...row.material,version:'local-ref-b'},createdAt:'2026-10-10T08:01:00.000Z'};
function walk(node:any,out:any[]=[]):any[]{if(Array.isArray(node)){node.forEach(value=>walk(value,out));return out}if(!node||typeof node!=='object')return out;out.push(node);walk(node.props?.children,out);return out}
function textOf(node:any):string{if(node==null||typeof node==='boolean')return '';if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(textOf).join('');return textOf(node.props?.children)}
class Target extends EventTarget{
 handlers=new Map<string,Set<any>>();hidden=false;
 addEventListener(name:string,callback:any,options?:any){const handlers=this.handlers.get(name)??new Set();handlers.add(callback);this.handlers.set(name,handlers);super.addEventListener(name,callback,options)}
 removeEventListener(name:string,callback:any,options?:any){this.handlers.get(name)?.delete(callback);if(!this.handlers.get(name)?.size)this.handlers.delete(name);super.removeEventListener(name,callback,options)}
 emit(name:string){this.dispatchEvent(new Event(name))}
 get count(){return [...this.handlers.values()].reduce((total,handlers)=>total+handlers.size,0)}
}
class Video extends Target{
 src='';currentSrc='';duration=72;readyState=1;currentTime=0;paused=true;muted=true;volume=.8;autoplay=false;loop=false;preload='metadata';playbackRate=1;
 plays=0;loads=0;pauses=0;metadataGate:ReturnType<typeof gate>|null=null;playGate:ReturnType<typeof gate>|null=null;
 load(){this.loads++;this.currentSrc=this.src;if(this.src){const src=this.src;void (this.metadataGate?.promise??Promise.resolve()).then(()=>{if(this.src===src)this.emit('loadedmetadata')})}}
 play(){this.plays++;this.paused=false;this.emit('play');return this.playGate?.promise??Promise.resolve()}
 pause(){this.pauses++;if(!this.paused){this.paused=true;this.emit('pause')}}
 removeAttribute(name:string){if(name==='src'){this.src='';this.currentSrc=''}}
}
/** Drives the actual component's handlers/effects and real bounded preview
 * controller. Only React's hook scheduler and media/network primitives are fake. */
function setup(options:any={}){
 const windowTarget=new Target(),documentTarget=new Target(),video=new Video();
 const calls:any[]=[],controllers:ReturnType<typeof createContextBookmarkPreviewController>[]=[],controllerDependencies:any[]=[];
 let modeChangeAllowed=false;
 Object.assign(windowTarget,{confirm:(message:string)=>{calls.push(['confirm',message]);return modeChangeAllowed}});
 let recording=false,beforeAllowed=true,acquireOverride:any=null,saveOverride:any=null,startOverride:any=null,reloadOverride:any=null;
 let acquisitions=0,releases=0,lateStateUpdates=0;
 const pool={async acquire(parameters?:any){
  acquisitions++;calls.push(['pool.acquire',parameters]);
  if(acquireOverride)await acquireOverride(parameters);
  let released=false;return{url:'blob:verified-current',mediaId:current.mediaId,mediaSha256:current.mediaSha256,actualSha256:current.mediaSha256,verified:true,verificationError:null,...options.lease,
   release(){if(released)return;released=true;releases++;calls.push(['lease.release'])}};
 }};
 const cells:any[]=[];let cursor=0,dirty=true,mounted=true,rendering=false,effects:(()=>void)[]=[],tree:any=null;
 const sameDeps=(a:any,b:any)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const hooks={...React,
  useRef(initial:any){const index=cursor++;if(!cells[index])cells[index]={kind:'ref',value:{current:initial}};return cells[index].value},
  useState(initial:any){const index=cursor++;if(!cells[index]){const cell:any={kind:'state',value:typeof initial==='function'?initial():initial};cell.set=(next:any)=>{if(!mounted){lateStateUpdates++;return}const value=typeof next==='function'?next(cell.value):next;if(!Object.is(value,cell.value)){cell.value=value;dirty=true}};cells[index]=cell}return[cells[index].value,cells[index].set]},
  useEffect(effect:any,deps:any){const index=cursor++,prior=cells[index];if(!prior||!sameDeps(prior.deps,deps)){const next={kind:'effect',deps,cleanup:prior?.cleanup};cells[index]=next;effects.push(()=>{next.cleanup?.();next.cleanup=effect()})}},
 };
 const exports:any={};vm.runInNewContext(code,{exports,Error,crypto:webcrypto,window:windowTarget,document:documentTarget,require:(name:string)=>name==='react'?hooks:name.includes('/i18n/react')?{useStudioLocale:()=>({t:(key:any,params?:any)=>translate(options.locale??'zh-CN',key,params),ui:(message:any)=>translateKnownUi(options.locale??'zh-CN',message)})}:name.includes('/core/training')?{hasScorableReference}:name.includes('context-bookmark-media')?{ORIGINAL_COURSE_MEDIA,createContextBookmarkPreviewController:(dependencies:any)=>{
  controllerDependencies.push(dependencies);const controller=createContextBookmarkPreviewController({...dependencies,lifecycle:{windowTarget,documentTarget,isHidden:()=>documentTarget.hidden},metadataTimeoutMs:1000});controllers.push(controller);return controller;
 }}:require(name)});
 const controllerRef={current:null as ReturnType<typeof createContextBookmarkPreviewController>|null};
 let props:any={current:copy(current),entries:copy([row,second]),pool,controllerRef,monitor:{volume:.8,courseMuted:false,allMuted:false},recordingBlocked:false,isRecordingBlocked:()=>recording,
  onBeforePreview:()=>{calls.push(['beforePreview']);return beforeAllowed},
  onSave:async(input:any)=>{calls.push(['save',copy(input)]);return saveOverride?saveOverride(input):{entry:row,disposition:'saved'}},
  onStart:async(entry:any)=>{calls.push(['start',entry]);if(startOverride)await startOverride(entry)},
  onReload:async()=>{calls.push(['reload']);if(reloadOverride)await reloadOverride()},onCancel:()=>calls.push(['cancel']),...options.props,
 };
 const flush=()=>{if(!mounted||rendering)return;rendering=true;try{let turns=0;while(dirty||effects.length){if(++turns>100)throw Error('Hook render loop');if(dirty){dirty=false;cursor=0;tree=exports.default(props);for(const node of walk(tree))if(node.type==='video'&&node.props.ref)node.props.ref.current=video}const queued=effects;effects=[];for(const effect of queued)effect()}}finally{rendering=false}};
 const settle=async()=>{for(let index=0;index<4;index++){flush();await tick()}flush()};
 const button=(label:string,index=0)=>{flush();const result=walk(tree).filter(node=>node.type==='button'&&textOf(node)===label)[index];assert.ok(result,`Missing button ${label}`);return result};
 const click=(label:string,index=0)=>{const node=button(label,index);assert.equal(!!node.props.disabled,false,`Disabled button ${label}`);node.props.onClick();flush()};
 const field=(label:string)=>{flush();const result=walk(tree).find(node=>node.props?.['aria-label']===label);assert.ok(result,`Missing field ${label}`);return result};
 const edit=(label:string,value:string)=>{const node=field(label);assert.equal(!!node.props.disabled,false);node.props.onChange({target:{value}});flush()};
 const update=(patch:any)=>{props={...props,...patch};dirty=true;flush()};
 const unmount=()=>{if(!mounted)return;mounted=false;for(const cell of cells)if(cell?.kind==='effect')cell.cleanup?.();for(const node of walk(tree))if(node.type==='video'&&node.props.ref)node.props.ref.current=null;effects=[];dirty=false};
 flush();return{calls,video,pool,controllerRef,controllers,controllerDependencies,documentTarget,windowTarget,flush,settle,button,click,field,edit,update,unmount,
  get text(){flush();return textOf(tree)},get tree(){flush();return tree},get acquisitions(){return acquisitions},get releases(){return releases},get lateStateUpdates(){return lateStateUpdates},
  setRecording:(value:boolean)=>{recording=value},setBeforePreview:(value:boolean)=>{beforeAllowed=value},setAcquire:(fn:any)=>{acquireOverride=fn},setSave:(fn:any)=>{saveOverride=fn},setStart:(fn:any)=>{startOverride=fn},setReload:(fn:any)=>{reloadOverride=fn},
  setModeChangeAllowed:(value:boolean)=>{modeChangeAllowed=value},
  async prepare(){click('核验校正片段');await settle()},async correct(){edit('当前句参考文字','Could I have a small coffee, please?');edit('校正开始秒数','0.25');edit('校正结束秒数','5.75');await settle()},
 };
}
const count=(p:ReturnType<typeof setup>,name:string)=>p.calls.filter(call=>call[0]===name).length;
const ready=async(p:ReturnType<typeof setup>)=>{await p.correct();await p.prepare();assert.equal(p.button('预听校正片段').props.disabled,false)};
const uiText=(p:ReturnType<typeof setup>)=>JSON.stringify(p.tree,(_key,value)=>typeof value==='function'||_key==='ref'?undefined:value);

test('actual initial DOM reveals only the current cue; list-only and metadata rows omit all answer text',()=>{
 const common:any={entries:[row,second],pool:{acquire:async()=>{throw Error('No render acquisition')}},controllerRef:{current:null},monitor:{volume:.8,courseMuted:false,allMuted:false},recordingBlocked:false,isRecordingBlocked:()=>false,onBeforePreview:()=>true,onSave:async()=>{throw Error('No render save')},onStart:async()=>{},onReload:async()=>{},onCancel(){}};
 const editor=renderToStaticMarkup(React.createElement(MaterialCorrectionPanel,{...common,current}));
 assert.match(editor,/Could I have a coffee, please/);assert.doesNotMatch(editor,/Would you like it hot|SECRET SAVED|HIDDEN BEFORE|HIDDEN AFTER/);
 const list=renderToStaticMarkup(React.createElement(MaterialCorrectionPanel,{...common,current:null}));
 assert.doesNotMatch(list,/Could I have|Would you like|SECRET SAVED|HIDDEN BEFORE|HIDDEN AFTER/);
 assert.match(list,/Corrected versions do not support context bookmarks/);assert.match(list,/refresh does not restore excluded practice/);
});

test('mount and saved-row selection are metadata-only and never load, save, start, or autoplay',async()=>{
 const p=setup();await p.settle();assert.equal(p.controllers.length,1);assert.equal(p.acquisitions,0);assert.equal(p.video.plays,0);assert.equal(count(p,'save'),0);assert.equal(count(p,'start'),0);
 p.click('选择此版本',1);assert.match(p.text,/已选择 local-ref-b/);assert.doesNotMatch(uiText(p),/SECRET SAVED|HIDDEN BEFORE|HIDDEN AFTER/);assert.equal(p.acquisitions,0);assert.equal(p.video.plays,0);assert.equal(count(p,'start'),0);p.unmount();
});

test('edited exact text/range validate against the current target, preparation never autoplays, play is explicit and bounded',async()=>{
 const p=setup();await ready(p);const controller=p.controllerRef.current!;
 const selected=controller.getState().reference!;assert.equal(selected.text,'Could I have a small coffee, please?');assert.equal(selected.startSeconds,.25);assert.equal(selected.endSeconds,5.75);
 assert.equal(p.controllerDependencies[0].validateReference(selected),null);assert.notEqual(p.controllerDependencies[0].validateReference({...selected,text:current.material.cues[0].text}),null);
 assert.notEqual(p.controllerDependencies[0].validateReference({...selected,materialVersion:'old'}),null);assert.equal(p.video.plays,0);assert.equal(p.acquisitions,1);assert.match(p.text,/实际已核验时长：72 秒/);
 p.click('预听校正片段');await p.settle();assert.equal(p.video.plays,1);assert.equal(p.video.currentTime,.25);assert.equal(p.video.muted,false);
 p.video.currentTime=5.8;p.video.emit('timeupdate');await p.settle();assert.equal(p.video.paused,true);assert.equal(p.video.currentTime,5.75);assert.equal(controller.getState().phase,'ready');p.unmount();
});

test('save requires the actual verified live lease and duration and leaves starting as a separate explicit action',async()=>{
 const p=setup();await p.correct();p.button('保存为新的本机版本').props.onClick();await p.settle();assert.equal(count(p,'save'),0);
 await p.prepare();p.click('保存为新的本机版本');await p.settle();assert.equal(count(p,'save'),1);const input=p.calls.find(call=>call[0]==='save')[1];
 assert.equal(input.text,'Could I have a small coffee, please?');assert.equal(input.start,.25);assert.equal(input.end,5.75);assert.equal(input.verifiedDurationSeconds,72);assert.match(input.saveRequestId,/^[\da-f-]{36}$/);
 assert.equal(count(p,'start'),0);assert.match(p.text,/当前轮未切换/);assert.doesNotMatch(p.text,/已选择/);
 p.click('选择此版本',0);p.click('结束当前轮，使用此版本新开练习');await p.settle();assert.equal(count(p,'start'),1);assert.equal(p.calls.find(call=>call[0]==='start')[1].key,row.key);p.unmount();
});

test('identical save retries preserve request identity, duplicate saves are fenced, editing creates a new identity',async()=>{
 const p=setup();await ready(p);let attempt=0;const held=gate();p.setSave(async()=>{attempt++;if(attempt===1)throw Error('Readback uncertain');if(attempt===2)return held.promise;return{entry:row,disposition:'saved'}});
 p.click('保存为新的本机版本');await p.settle();assert.match(p.text,/Readback uncertain/);p.click('保存为新的本机版本');const duplicate=p.button('正在保存新版本…');duplicate.props.onClick();assert.equal(count(p,'save'),2);
 const ids=p.calls.filter(call=>call[0]==='save').map(call=>call[1].saveRequestId);assert.equal(ids[0],ids[1]);held.resolve({entry:row,disposition:'already-present'});await p.settle();assert.match(p.text,/未重复创建版本/);
 p.edit('校正结束秒数','5.5');await p.prepare();p.click('保存为新的本机版本');await p.settle();const third=p.calls.filter(call=>call[0]==='save').at(-1)[1].saveRequestId;assert.notEqual(third,ids[0]);p.unmount();
});

test('changing the form invalidates preview immediately and cannot save or play the old range',async()=>{
 const p=setup();await ready(p);const oldReference=p.controllerRef.current!.getState().reference!;const oldSave=p.button('保存为新的本机版本').props.onClick,oldPlay=p.button('预听校正片段').props.onClick;
 p.edit('校正开始秒数','1.25');assert.equal(p.releases,1);assert.equal(p.controllerRef.current!.getState().phase,'empty');assert.notEqual(p.controllerDependencies[0].validateReference(oldReference),null);oldSave();oldPlay();await p.settle();assert.equal(count(p,'save'),0);assert.equal(p.video.plays,0);
 await p.prepare();assert.equal(p.controllerRef.current!.getState().reference!.startSeconds,1.25);assert.equal(p.button('保存为新的本机版本').props.disabled,false);p.unmount();
});

for(const [label,value] of [['当前句参考文字','  '],['当前句参考文字','中文'],['校正开始秒数',''],['校正开始秒数','-1'],['校正开始秒数','Infinity'],['校正结束秒数','0'],['校正结束秒数','NaN']]){
 test(`invalid ${label}=${JSON.stringify(value)} is never clipped into a publishable range`,async()=>{
  const p=setup();p.edit(label,value);assert.equal(p.button('核验校正片段').props.disabled,true);p.button('核验校正片段').props.onClick();p.button('保存为新的本机版本').props.onClick();await p.settle();assert.equal(p.acquisitions,0);assert.equal(count(p,'save'),0);p.unmount();
 });
}

for(const mutation of ['source','hash','duration','unknown duration','saved duration mismatch','outside duration']){
 test(`actual ${mutation} mismatch cannot authorize save or preview`,async()=>{
  const p=setup(mutation==='hash'?{lease:{verified:false,actualSha256:'bad',verificationError:'Media hash mismatch'}}:{});await p.correct();
  if(mutation==='unknown duration')p.video.duration=Infinity;
  if(mutation==='saved duration mismatch')p.update({current:{...current,expectedDurationSeconds:71}});
  if(mutation==='outside duration')p.edit('校正结束秒数','73');
  await p.prepare();
  if(mutation==='source')p.video.currentSrc='blob:unrelated';
  if(mutation==='duration')p.video.duration=71;
  p.button('保存为新的本机版本').props.onClick();p.button('预听校正片段').props.onClick();await p.settle();assert.equal(count(p,'save'),0);assert.equal(p.video.plays,0);p.unmount();
 });
}

test('unknown duration remains unverified, while no-change saves do not create a version',async()=>{
 const p=setup();assert.match(p.text,/尚未完成当前编辑范围的核验/);await p.prepare();assert.equal(p.button('保存为新的本机版本').props.disabled,true);p.button('保存为新的本机版本').props.onClick();await p.settle();assert.equal(count(p,'save'),0);p.unmount();
});

test('a verified corrected current material previews its exact new reference rather than requiring original bookmark identity',async()=>{
 const target={...current,material:{...CAFE_MATERIAL,version:'local-corrected-current',cues:CAFE_MATERIAL.cues.map((cue,index)=>index===0?{...cue,text:'Could I have a smaller coffee, please?',start:.1,end:5.9}:cue)},expectedDurationSeconds:72};
 const p=setup({props:{current:target}});await p.prepare();const reference=p.controllerRef.current!.getState().reference!;
 assert.equal(reference.materialVersion,'local-corrected-current');assert.equal(reference.text,'Could I have a smaller coffee, please?');assert.equal(reference.startSeconds,.1);assert.equal(reference.endSeconds,5.9);assert.equal(p.button('预听校正片段').props.disabled,false);
 assert.notEqual(p.controllerDependencies[0].validateReference({...reference,materialVersion:CAFE_MATERIAL.version}),null);assert.equal(p.video.plays,0);p.unmount();
});

test('monitor updates reach the existing dedicated controller; authoritative recording guard blocks stale handlers',async()=>{
 const p=setup();await ready(p);p.update({monitor:{volume:.3,courseMuted:true,allMuted:false}});p.click('预听校正片段');await p.settle();assert.equal(p.video.volume,.3);assert.equal(p.video.muted,true);p.click('暂停校正片段');
 p.update({monitor:{volume:.45,courseMuted:false,allMuted:true}});p.click('预听校正片段');await p.settle();assert.equal(p.video.muted,true);p.click('暂停校正片段');
 const play=p.button('预听校正片段').props.onClick,save=p.button('保存为新的本机版本').props.onClick,before=count(p,'beforePreview');p.setRecording(true);play();save();p.button('核验校正片段').props.onClick();await p.settle();assert.equal(p.video.plays,2);assert.equal(count(p,'save'),0);assert.equal(count(p,'beforePreview'),before);assert.equal(p.controllers.length,1);
 p.update({recordingBlocked:true});assert.equal(p.releases,1);p.setRecording(false);p.update({recordingBlocked:false});assert.equal(p.button('预听校正片段').props.disabled,true);assert.equal(p.video.plays,2);p.unmount();
});

for(const event of ['hidden','pagehide','recording','cancel','target change','transition','disabled']){
 test(`${event} closes the preview and prevents late metadata from becoming playable`,async()=>{
  const p=setup();await p.correct();const held=gate();p.video.metadataGate=held;p.click('核验校正片段');await p.settle();assert.equal(p.acquisitions,1);
  if(event==='hidden'){p.documentTarget.hidden=true;p.documentTarget.emit('visibilitychange')}
  if(event==='pagehide')p.windowTarget.emit('pagehide');
  if(event==='recording')p.update({recordingBlocked:true});
  if(event==='cancel')p.click('取消编辑并关闭');
  if(event==='target change')p.update({current:{...current,cueId:CAFE_MATERIAL.cues[1].id}});
  if(event==='transition')p.update({transitionBusy:true});
  if(event==='disabled')p.update({disabledReason:'Source no longer verified'});
  held.resolve(undefined);await p.settle();assert.equal(p.releases,1);assert.equal(p.video.plays,0);assert.equal(p.button('预听校正片段').props.disabled,true);assert.equal(count(p,'save'),0);
  p.documentTarget.hidden=false;p.documentTarget.emit('visibilitychange');p.windowTarget.emit('pageshow');await p.settle();assert.equal(p.video.plays,0);assert.equal(p.acquisitions,1);p.unmount();
 });
}

test('unmount releases a late pool acquisition and leaves no listeners, controller, or late state updates',async()=>{
 const p=setup();await p.correct();const held=gate();p.setAcquire(()=>held.promise);p.click('核验校正片段');await p.settle();p.unmount();held.resolve(undefined);await p.settle();assert.equal(p.releases,1);assert.equal(p.video.plays,0);assert.equal(p.controllerRef.current,null);assert.equal(p.documentTarget.count,0);assert.equal(p.windowTarget.count,0);assert.equal(p.video.count,0);assert.equal(p.lateStateUpdates,0);
});

test('host synchronous controller recording lock forbids saving before React props or guard catch up',async()=>{
 const p=setup();await ready(p);const save=p.button('保存为新的本机版本').props.onClick,play=p.button('预听校正片段').props.onClick;
 p.controllerRef.current!.setRecordingBlocked(true);save();play();await p.settle();assert.equal(count(p,'save'),0);assert.equal(p.video.plays,0);assert.equal(p.button('保存为新的本机版本').props.disabled,true);p.unmount();
});

test('a late native play resolution after background remains paused and silent',async()=>{
 const p=setup();await ready(p);const held=gate();p.video.playGate=held;p.click('预听校正片段');p.documentTarget.hidden=true;p.documentTarget.emit('visibilitychange');held.resolve(undefined);await p.settle();assert.equal(p.video.paused,true);assert.equal(p.video.muted,true);assert.equal(p.releases,1);assert.equal(p.button('预听校正片段').props.disabled,true);p.unmount();
});

test('stale selected row, changed same-key content, and unrelated latest row never auto-start or silently adopt',async()=>{
 const p=setup();p.click('选择此版本',0);const start=p.button('结束当前轮，使用此版本新开练习').props.onClick;
 p.update({entries:[second]});start();await p.settle();assert.equal(count(p,'start'),0);assert.doesNotMatch(p.text,/已选择 local-ref-b/);assert.match(p.text,/没有自动改用其他版本/);
 p.update({entries:[row,second]});p.click('选择此版本',0);p.update({entries:[{...row,material:{...row.material,cues:[]}},second]});start();await p.settle();assert.equal(count(p,'start'),0);assert.doesNotMatch(uiText(p),/SECRET SAVED/);p.unmount();
});

test('failed start keeps the explicit selected receipt; concurrent starts/reloads/cancel cannot duplicate a transition',async()=>{
 const p=setup();p.click('选择此版本',1);const held=gate();p.setStart(()=>held.promise);const handler=p.button('结束当前轮，使用此版本新开练习').props.onClick;p.click('结束当前轮，使用此版本新开练习');handler();p.button('刷新本机版本').props.onClick();p.button('取消编辑并关闭').props.onClick();assert.equal(count(p,'start'),1);assert.equal(count(p,'reload'),0);assert.equal(count(p,'cancel'),0);
 held.reject(Error('Current round could not be flushed'));await p.settle();assert.match(p.text,/Current round could not be flushed/);assert.match(p.text,/已选择 local-ref-b/);assert.equal(p.button('结束当前轮，使用此版本新开练习').props.disabled,false);p.unmount();
});

test('the form exposes neighboring range ambiguity without neighboring reference text',async()=>{
 const p=setup();p.edit('校正结束秒数','7');assert.match(p.text,/与后一句时间有重叠/);assert.doesNotMatch(uiText(p),/Would you like it hot or iced/);p.edit('校正结束秒数','5');assert.match(p.text,/与后一句时间有间隔/);p.unmount();
});

test('component never creates training facts, recording graph, source uploads, or original-bookmark acceptance',()=>{
 assert.doesNotMatch(source,/TrainingEngine|\.submit\(|\.input\(|captureStream|createMediaStreamDestination|getUserMedia|localStorage|isCurrentBookmarkReference|type="file"/);
 assert.match(source,/actualSha256!==target.mediaSha256/);assert.match(source,/element\.duration!==duration/);assert.match(source,/saveRequest\.current\.id/);
});

test('structural editor keeps next reference hidden and requires explicit complete merge text, proof and confirmation',async()=>{
 const p=setup();p.click('合并当前与后一句');assert.doesNotMatch(uiText(p),/Would you like it hot/);
 assert.match(p.text,/后一句参考不会自动展示/);assert.equal(p.button('保存为新的本机版本').props.disabled,true);
 p.edit('当前句参考文字','Could I have coffee? Hot or iced?');await p.prepare();assert.equal(p.button('保存为新的本机版本').props.disabled,true);
 p.click('确认新句结构');p.click('保存为新的本机版本');await p.settle();const input=p.calls.find(call=>call[0]==='save')[1];
 assert.deepEqual(input.structure,{operation:'merge',firstText:'Could I have coffee? Hot or iced?',confirmed:true});assert.equal(input.start,0);assert.equal(input.end,12);
 assert.equal(count(p,'start'),0);p.unmount();
});
test('split requires two scorable texts, an internal time and renewed confirmation after editing',async()=>{
 const p=setup();p.click('拆分当前句');p.edit('当前句参考文字','Could I have');p.edit('拆分后第二句文字','a coffee, please?');p.edit('拆分时间点秒数','3');await p.prepare();p.click('确认新句结构');
 p.edit('拆分时间点秒数','4');assert.equal(p.button('保存为新的本机版本').props.disabled,true);await p.prepare();p.click('确认新句结构');p.click('保存为新的本机版本');await p.settle();
 const input=p.calls.find(call=>call[0]==='save')[1];assert.equal(input.text,'Could I have a coffee, please?');assert.deepEqual(input.structure,{operation:'split',firstText:'Could I have',secondText:'a coffee, please?',splitAt:4,confirmed:true});
 p.edit('拆分时间点秒数','6');assert.equal(p.button('保存为新的本机版本').props.disabled,true);p.unmount();
});
test('mode switch invalidates an old clip, hidden or recording blocks structural handlers, last cue cannot merge',async()=>{
 const p=setup();await ready(p);p.setModeChangeAllowed(true);p.click('拆分当前句');assert.equal(p.controllerRef.current!.getState().phase,'empty');assert.equal(p.button('预听校正片段').props.disabled,true);
 p.setRecording(true);p.button('合并当前与后一句').props.onClick();assert.match(p.text,/拆分后第二句文字/);p.setRecording(false);p.documentTarget.hidden=true;p.button('仅校正文字与时间').props.onClick();assert.match(p.text,/拆分后第二句文字/);p.documentTarget.hidden=false;
 p.update({current:{...current,cueId:CAFE_MATERIAL.cues.at(-1)!.id}});assert.equal(p.button('合并当前与后一句').props.disabled,true);p.unmount();
});
for(const mode of ['合并当前与后一句','拆分当前句'])test(`initial ${mode} can preview original range before filling in new text or split time`,async()=>{
 const p=setup();p.click(mode);await p.prepare();p.click('预听校正片段');await p.settle();assert.equal(p.video.plays,1);
 assert.equal(p.button('保存为新的本机版本').props.disabled,true);assert.equal(p.button('确认新句结构').props.disabled,true);assert.doesNotMatch(uiText(p),/Would you like it hot/);p.unmount();
});
test('merge neighbor warning refers to the next unaffected cue, not the consumed second parent',()=>{
 const p=setup();p.click('合并当前与后一句');assert.doesNotMatch(p.text,/与后一句时间有重叠/);p.unmount();
 const material={...CAFE_MATERIAL,cues:CAFE_MATERIAL.cues.map((cue,i)=>i===2?{...cue,start:11}:cue)};
 const overlap=setup({props:{current:{...current,material}}});overlap.click('合并当前与后一句');assert.match(overlap.text,/与后一句时间有重叠/);overlap.unmount();
});

const editingModes=['仅校正文字与时间','合并当前与后一句','拆分当前句'] as const;
const visibleDraft=(p:ReturnType<typeof setup>)=>walk(p.tree).filter(node=>node.type==='input'||node.type==='textarea').map(node=>[node.props['aria-label'],node.props.value]);
for(const from of editingModes)for(const to of editingModes.filter(mode=>mode!==from)){
 test(`canceling ${from} → ${to} preserves the complete current draft and selected mode`,async()=>{
  const p=setup();p.click(from);p.edit('当前句参考文字','An unsaved subtitle draft.');
  if(from==='仅校正文字与时间'){p.edit('校正开始秒数','0.25');p.edit('校正结束秒数','5.75')}
  if(from==='拆分当前句'){p.edit('拆分后第二句文字','A second unsaved sentence.');p.edit('拆分时间点秒数','3');p.click('确认新句结构')}
  const draft=visibleDraft(p);p.click(to);await p.settle();
  assert.equal(p.button(from).props['aria-pressed'],true);assert.deepEqual(visibleDraft(p),draft);
  assert.equal(count(p,'confirm'),1);assert.equal(count(p,'save'),0);assert.equal(count(p,'start'),0);assert.equal(p.acquisitions,0);
  if(from==='拆分当前句')assert.equal(p.button('已确认新句结构').props['aria-pressed'],true);
  p.click(to);assert.equal(count(p,'confirm'),2);assert.deepEqual(visibleDraft(p),draft);p.unmount();
 });
}
for(const [mode,label,value] of [
 ['仅校正文字与时间','当前句参考文字','  '],['仅校正文字与时间','校正开始秒数',''],['仅校正文字与时间','校正结束秒数','NaN'],
 ['合并当前与后一句','当前句参考文字','A merged draft.'],['拆分当前句','拆分后第二句文字','Second sentence only.'],['拆分当前句','拆分时间点秒数','2.5'],
])test(`mode reset also protects isolated or invalid ${mode} ${label} edits`,()=>{
 const p=setup();p.click(mode);p.edit(label,value);const draft=visibleDraft(p);p.click(mode==='仅校正文字与时间'?'拆分当前句':'仅校正文字与时间');
 assert.equal(count(p,'confirm'),1);assert.deepEqual(visibleDraft(p),draft);assert.equal(p.button(mode).props['aria-pressed'],true);p.unmount();
});
test('same-mode clicks and pristine mode changes do not prompt or mutate a draft',()=>{
 const p=setup();for(const mode of editingModes){p.click(mode);assert.equal(p.button(mode).props['aria-pressed'],true)}assert.equal(count(p,'confirm'),0);
 p.edit('拆分后第二句文字','Keep this draft.');const draft=visibleDraft(p);p.click('拆分当前句');assert.deepEqual(visibleDraft(p),draft);assert.equal(count(p,'confirm'),0);p.unmount();
});
test('canceling reset retains exact media proof and the request ID for an uncertain save retry',async()=>{
 const p=setup();await ready(p);p.setSave(async()=>{throw Error('Readback uncertain')});p.click('保存为新的本机版本');await p.settle();
 const proof=p.controllerRef.current!.getState().reference,draft=visibleDraft(p),requestId=p.calls.find(call=>call[0]==='save')[1].saveRequestId;
 p.click('拆分当前句');assert.deepEqual(visibleDraft(p),draft);assert.equal(p.controllerRef.current!.getState().reference,proof);assert.equal(p.releases,0);assert.match(p.text,/Readback uncertain/);
 p.click('保存为新的本机版本');await p.settle();assert.equal(p.calls.filter(call=>call[0]==='save').at(-1)[1].saveRequestId,requestId);assert.equal(count(p,'start'),0);p.unmount();
});
test('accepted mode reset clears only the form and invalidates old proof without saving or starting',async()=>{
 const p=setup();await ready(p);const oldSave=p.button('保存为新的本机版本').props.onClick,oldPlay=p.button('预听校正片段').props.onClick;
 p.setModeChangeAllowed(true);p.click('合并当前与后一句');assert.equal(count(p,'confirm'),1);assert.equal(p.button('合并当前与后一句').props['aria-pressed'],true);
 assert.equal(p.field('当前句参考文字').props.value,current.material.cues[0].text);assert.equal(p.field('校正开始秒数').props.value,'0');assert.equal(p.field('校正结束秒数').props.value,'12');
 assert.equal(p.releases,1);assert.equal(p.controllerRef.current!.getState().phase,'empty');assert.equal(p.button('确认新句结构').props['aria-pressed'],false);
 oldSave();oldPlay();await p.settle();assert.equal(count(p,'save'),0);assert.equal(count(p,'start'),0);assert.equal(p.video.plays,0);assert.doesNotMatch(uiText(p),/Would you like it hot/);p.unmount();
});
for(const locale of ['en','zh-CN'] as const)test(`mode reset warning is localized in ${locale}`,()=>{
 const p=setup({locale});
 const textLabel=locale==='en'?'Current-sentence reference text':'当前句参考文字';
 const splitLabel=locale==='en'?'Split current sentence':'拆分当前句';
 p.edit(textLabel,'Draft');p.click(splitLabel);const warning=p.calls.find(call=>call[0]==='confirm')?.[1];
 assert.equal(typeof warning,'string');assert.match(warning,locale==='en'?/Unsaved changes will be lost/:/尚未保存的修改将丢失/);p.unmount();
});
for(const lock of ['recording','hidden','transition','disabled','save pending'])test(`${lock} refuses a dirty mode change before requesting confirmation`,async()=>{
 const p=setup();await ready(p);const draft=visibleDraft(p),switchMode=p.button('拆分当前句').props.onClick,held=gate();
 if(lock==='recording')p.setRecording(true);
 if(lock==='hidden')p.documentTarget.hidden=true;
 if(lock==='transition')p.update({transitionBusy:true});
 if(lock==='disabled')p.update({disabledReason:'Source unavailable'});
 if(lock==='save pending'){p.setSave(()=>held.promise);p.click('保存为新的本机版本')}
 switchMode();assert.equal(count(p,'confirm'),0);assert.deepEqual(visibleDraft(p),draft);assert.equal(p.button('仅校正文字与时间').props['aria-pressed'],true);
 if(lock==='save pending'){held.resolve({entry:row,disposition:'saved'});await p.settle()}p.unmount();
});
for(const change of ['recording','hidden','transition','disabled','target','edit','unmount'])test(`confirmation cannot authorize a mode reset after ${change} changes`,async()=>{
 const p=setup();await ready(p);let expectedDraft=visibleDraft(p);
 Object.assign(p.windowTarget,{confirm:()=>{
  if(change==='recording')p.setRecording(true);
  if(change==='hidden')p.documentTarget.hidden=true;
  if(change==='transition')p.update({transitionBusy:true});
  if(change==='disabled')p.update({disabledReason:'Source unavailable'});
  if(change==='target')p.update({current:{...current,cueId:CAFE_MATERIAL.cues[1].id}});
  if(change==='edit')p.edit('当前句参考文字','Newer draft must survive.');
  if(change==='unmount')p.unmount();
  expectedDraft=visibleDraft(p);return true;
 }});
 p.click('拆分当前句');await p.settle();assert.deepEqual(visibleDraft(p),expectedDraft);assert.equal(p.button('仅校正文字与时间').props['aria-pressed'],true);
 assert.equal(count(p,'save'),0);assert.equal(count(p,'start'),0);assert.equal(p.lateStateUpdates,0);p.unmount();
});
test('a stale mode button from another target cannot reset or prompt for the new draft',()=>{
 const p=setup();const staleSwitch=p.button('拆分当前句').props.onClick;p.update({current:{...current,cueId:CAFE_MATERIAL.cues[1].id}});
 p.edit('当前句参考文字','The new target draft.');const draft=visibleDraft(p);p.setModeChangeAllowed(true);staleSwitch();
 assert.deepEqual(visibleDraft(p),draft);assert.equal(count(p,'confirm'),0);assert.equal(p.button('仅校正文字与时间').props['aria-pressed'],true);p.unmount();
});
for(const playback of ['playing','pending native play','pending native start'])for(const accepted of [false,true])test(`mode reset pauses ${playback} before the native prompt; accepted=${accepted}`,async()=>{
 const p=setup();try{await ready(p);p.setSave(async()=>{throw Error('Readback uncertain')});p.click('保存为新的本机版本');await p.settle();
 const proof=p.controllerRef.current!.getState().reference,draft=visibleDraft(p),requestId=p.calls.find(call=>call[0]==='save')[1].saveRequestId;
 const held=gate();if(playback==='pending native play')p.video.playGate=held;
 if(playback==='pending native start')p.video.play=()=>{p.video.plays++;return held.promise};
 p.click('预听校正片段');await p.settle();assert.equal(p.video.paused,playback==='pending native start');assert.equal(p.video.muted,false);
 let prompted=false;Object.assign(p.windowTarget,{confirm:()=>{
  prompted=true;assert.equal(p.video.paused,true,'preview must pause before the blocking native prompt');assert.equal(p.video.muted,true);
  assert.equal(p.controllerRef.current!.getState().phase,'ready');assert.equal(p.controllerRef.current!.getState().reference,proof);
  return accepted;
 }});
 p.click('拆分当前句');assert.equal(prompted,true);
 if(playback!=='playing'){p.video.paused=false;held.resolve(undefined)}
 await p.settle();assert.equal(p.video.paused,true);assert.equal(p.video.muted,true);assert.equal(p.video.plays,1);assert.equal(count(p,'start'),0);
 if(accepted){assert.equal(p.releases,1);assert.equal(p.controllerRef.current!.getState().phase,'empty');assert.equal(p.button('拆分当前句').props['aria-pressed'],true)}
 else{
  assert.deepEqual(visibleDraft(p),draft);assert.equal(p.releases,0);assert.equal(p.controllerRef.current!.getState().reference,proof);assert.equal(p.button('预听校正片段').props.disabled,false);
  p.click('保存为新的本机版本');await p.settle();assert.equal(p.calls.filter(call=>call[0]==='save').at(-1)[1].saveRequestId,requestId);assert.equal(p.video.plays,1);
 }
 }finally{p.unmount()}
});
test('canceling a mode reset during metadata preparation does not promote loading to ready',async()=>{
 const p=setup();try{await p.correct();const held=gate();p.video.metadataGate=held;p.click('核验校正片段');await p.settle();
  const draft=visibleDraft(p);assert.equal(p.controllerRef.current!.getState().phase,'loading');
  Object.assign(p.windowTarget,{confirm:()=>{assert.equal(p.controllerRef.current!.getState().phase,'loading');return false}});
  p.click('拆分当前句');assert.deepEqual(visibleDraft(p),draft);assert.equal(p.controllerRef.current!.getState().phase,'loading');assert.equal(p.button('预听校正片段').props.disabled,true);
  held.resolve(undefined);await p.settle();assert.equal(p.controllerRef.current!.getState().phase,'ready');assert.equal(p.video.plays,0);assert.equal(p.releases,0);
 }finally{p.unmount()}
});
