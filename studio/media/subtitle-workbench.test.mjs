import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { toMono16k, isPlayableRange, clockText } from '../../public/subtitle-workbench/main.js';
const html = await readFile(new URL('../../public/subtitle-workbench/index.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../../public/subtitle-workbench/main.js', import.meta.url), 'utf8');
const audio = (rate, channels) => ({ sampleRate: rate, length: channels[0].length, numberOfChannels: channels.length, getChannelData: index => channels[index] });

test('cue playback requires strictly finite, positive, in-bounds ranges', () => {
  assert.equal(isPlayableRange({start:0,end:60},60),true);
  for (const cue of [{start:null,end:1},{start:NaN,end:1},{start:0,end:Infinity},{start:1,end:1},{start:-1,end:2},{start:2,end:1},{start:0,end:60.00001}]) assert.equal(isPlayableRange(cue,60),false);
  assert.equal(isPlayableRange({start:0,end:1},Infinity),false);
  assert.equal(isPlayableRange(null,60),false);
});
test('PCM downmix averages actual channels at 16k without changing sample count', () => {
  const output = toMono16k(audio(16000,[new Float32Array([1,.5,-.5,-1]),new Float32Array([-1,.5,.5,1])]));
  assert.deepEqual([...output],[0,.5,0,0]);
});
test('PCM resampling yields actual 16k mono frame counts', () => {
  for (const sampleRate of [8000,22050,44100,48000]) {
    const data = new Float32Array(sampleRate).fill(.25);
    const output = toMono16k(audio(sampleRate,[data]));
    assert.equal(output.length,16000);
    assert.equal(output.every(sample => Math.abs(sample-.25) < 1e-6),true);
  }
});
test('PCM downsampling integrates source samples instead of decimating one channel', () => {
  const output = toMono16k(audio(48000,[new Float32Array([1,0,-1,.3,.6,.9])]));
  assert.ok(Math.abs(output[0]) < 1e-6);
  assert.ok(Math.abs(output[1]-.6) < 1e-6);
});
test('PCM rejects empty, invalid, nonfinite and beyond-60-second audio', () => {
  assert.throws(()=>toMono16k(audio(16000,[new Float32Array()])));
  assert.throws(()=>toMono16k(audio(16000,[new Float32Array([NaN])])));
  assert.throws(()=>toMono16k(audio(16000,[new Float32Array([Infinity])])));
  assert.throws(()=>toMono16k(audio(16000,[new Float32Array(960001)])));
  assert.equal(toMono16k(audio(16000,[new Float32Array(960000)])).length,960000);
});
test('timestamp labels never invent zero for missing or invalid evidence', () => {
  assert.equal(clockText(null,true),'缺时');
  assert.equal(clockText(NaN,true),'缺时');
  assert.equal(clockText(-1,true),'缺时');
  assert.equal(clockText(0,true),'00:00.000');
  assert.equal(clockText(59.9999,true),'01:00.000');
});
test('workbench opens lightweight and has no network/storage/user-content sinks', () => {
  assert.doesNotMatch(js,/\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon|indexedDB|localStorage|sessionStorage)\b/);
  assert.doesNotMatch(js,/\.innerHTML\s*=|insertAdjacentHTML|document\.write|\beval\s*\(/);
  assert.doesNotMatch(html,/<(?:script|link)[^>]+(?:src|href)=["']https?:/);
  assert.doesNotMatch(html,/<video[^>]*\bautoplay\b/);
  assert.match(js,/new Blob\(\[content\]/);
  assert.match(js,/new TextDecoder\('utf-8', \{ fatal: true, ignoreBOM: true \}\)/);
});
test('new page CSP limits execution to same-origin and validated local runtime blobs', () => {
  assert.match(html,/default-src 'none'/);
  assert.match(html,/script-src 'self' blob: 'wasm-unsafe-eval'/);
  assert.match(html,/connect-src 'self'/);
  assert.match(html,/media-src blob:/);
  assert.match(html,/base-uri 'none'; form-action 'none'/);
  assert.doesNotMatch(html,/'unsafe-eval'|'unsafe-inline'/);
});
test('ownership and cancellation protect late tasks, media and manual versions', () => {
  assert.match(js,/state\.operation === operation && !operation\.controller\.signal\.aborted/);
  assert.match(js,/operation\.controller\.abort\(\)/);
  assert.match(js,/operation\.mediaSHA === state\.media\?\.mediaSHA256/);
  assert.match(js,/if \(!owned\(operation\)\) return;/);
  assert.match(js,/state\.versions\.push\(/);
  assert.match(js,/window\.addEventListener\('beforeunload'/);
  assert.match(js,/window\.addEventListener\('pagehide'/);
  assert.match(js,/document\.addEventListener\('visibilitychange'/);
  assert.match(js,/context\.close\(\)/);
  assert.match(js,/URL\.revokeObjectURL\(previous\)/);
  assert.match(js,/state\.pendingPlay\.delete\(owner\)/);
});
test('contract limits and honest resource/offline/review labels remain visible', () => {
  for (const phrase of ['32 MiB','60 秒','1 MiB','500 段','8 MiB','66,032,855 B','43,521,689 B','22,511,166 B','HTTP 缓存','未验证完整离线','始终待审核','剩余时间未知','不会将初稿变成已审核参考']) assert.ok(html.includes(phrase),phrase);
  assert.match(js,/VTT 导出已阻止/);
  assert.match(js,/没有静默丢弃任何段/);
  assert.match(js,/同一原片的 SHA-256 与大小核对成功/);
});

// Small behavioral DOM substitute, deliberately separate from real-browser acceptance.
// It exercises the actual UI event callbacks and actual draft/identity code, not a mock draft.
test('UI event flow preserves edits, versions, bad-file recovery, and late media A→B ownership', async () => {
  class Element {
    constructor(tag='div', id='') { this.tagName=tag; this.id=id; this.children=[]; this.listeners=new Map(); this.attrs=new Map(); this.hidden=false; this.disabled=false; this.value=''; this.textContent=''; this.className=''; this.dataset={}; this.paused=true; this.currentTime=0; this.duration=5; this.readyState=4; this.textTracks=new EventTarget(); this.textTracks.length=0; }
    addEventListener(type, callback) { const list=this.listeners.get(type)||[]; list.push(callback); this.listeners.set(type,list); }
    removeEventListener(type, callback) { this.listeners.set(type,(this.listeners.get(type)||[]).filter(fn=>fn!==callback)); }
    async emit(type, event={}) { for(const callback of this.listeners.get(type)||[]) await callback(event); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children=[...nodes]; }
    setAttribute(name,value) { this.attrs.set(name,value); }
    removeAttribute(name) { this.attrs.delete(name); if(name==='src')this.src=''; }
    querySelectorAll(selector) { return this.children.flatMap(child=>[...(selector==='button'&&child.tagName==='button'?[child]:[]),...child.querySelectorAll(selector)]); }
    pause() { this.paused=true; }
    play() { this.paused=false; return Promise.resolve(); }
    load() { if(this.src && this.tagName==='video' && this.id!=='source-player') queueMicrotask(()=>this.onloadedmetadata?.()); }
    click() {}
    focus() {}
    remove() {}
    showModal() { this.returnValue='cancel'; }
  }
  const nodes=new Map([...html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g)].map(([,tag,id])=>[id,new Element(tag,id)]));
  nodes.get('playback-rate').value='1';
  const documentStub={hidden:false,getElementById:id=>nodes.get(id),createElement:tag=>new Element(tag),querySelectorAll:()=>[],addEventListener(){},body:new Element('body')};
  const previous={document:globalThis.document,window:globalThis.window,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame,setTimeout:globalThis.setTimeout};
  const originalCreate=URL.createObjectURL, downloaded=[];
  URL.createObjectURL=blob=>{if(!(blob instanceof File))downloaded.push(blob);return originalCreate(blob);};
  globalThis.setTimeout=(callback,ms,...args)=>{const timer=previous.setTimeout(callback,ms,...args);if(ms===30000)timer.unref();return timer;};
  globalThis.document=documentStub;globalThis.window=new Element('window');globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
  try {
    await import(`../../public/subtitle-workbench/main.js?ownership-test`);
    const choose=(id,file)=>nodes.get(id).emit('change',{target:{files:[file],value:'selected'}});
    const source=new File([new Uint8Array([1,2,3])],'original.wav',{type:'audio/wav'});
    await choose('media-input',source);
    assert.equal(nodes.get('media-name').textContent,'original.wav');
    assert.equal(nodes.get('start-asr').disabled,false);
    assert.equal(nodes.get('source-player').paused,true);
    const srt=new File(['1\n00:00:00,000 --> 00:00:01,000\nOriginal words\n'],'original.srt');
    await choose('subtitle-input',srt);
    assert.equal(nodes.get('cue-text').value,'Original words');
    nodes.get('cue-text').value='Human edit'; await nodes.get('cue-text').emit('input'); await nodes.get('save-edit').emit('click');
    assert.equal(nodes.get('cue-text').value,'Human edit');
    assert.equal(nodes.get('undo-edit').disabled,false);
    assert.match(nodes.get('cue-raw').textContent,/Original words/);
    const subtitle2=new File(['WEBVTT\n\n00:01.000 --> 00:02.000\nSecond draft\n'],'second.vtt');
    await choose('subtitle-input',subtitle2);
    assert.equal(nodes.get('draft-versions').children.length,2);
    await nodes.get('draft-versions').emit('change',{target:{value:'0'}});
    assert.equal(nodes.get('cue-text').value,'Human edit');
    const oversized=new File([new Uint8Array(1024*1024+1)],'too-large.srt');
    await choose('subtitle-input',oversized);
    assert.equal(nodes.get('cue-text').value,'Human edit');
    assert.match(nodes.get('notice').textContent,/1 MiB/);
    await choose('draft-input',new File(['{"version":"not-a-draft"}'],'bad.json'));
    assert.equal(nodes.get('cue-text').value,'Human edit');
    await nodes.get('undo-edit').emit('click');
    assert.equal(nodes.get('cue-text').value,'Original words');
    assert.equal(nodes.get('undo-edit').disabled,true);
    // Selecting the same cue while typing must not silently drop the unsaved input.
    nodes.get('cue-text').value='Pending edit';await nodes.get('cue-text').emit('input');
    await nodes.get('cue-list').children[0].emit('click');
    assert.equal(nodes.get('cue-text').value,'Pending edit');
    await nodes.get('download-json').emit('click');
    assert.match(nodes.get('notice').textContent,/未保存的改文/);
    // Cancel pending input explicitly by saving, then consider this version downloaded.
    await nodes.get('save-edit').emit('click');
    await nodes.get('download-json').emit('click');
    assert.equal(downloaded.length,1);
    const json=await downloaded[0].text();
    assert.equal(JSON.parse(json).candidates[0].text,'Pending edit');
    await choose('draft-input',new File([json],'saved-draft.json'));
    assert.equal(nodes.get('draft-versions').children.length,3);
    assert.equal(nodes.get('cue-text').value,'Pending edit');
    await choose('subtitle-input',new File(['1\n00:00:01,000 --> 00:00:01,000\nZero duration\n'],'invalid-range.srt'));
    assert.equal(nodes.get('replay-cue').disabled,true);
    await nodes.get('download-vtt').emit('click');
    assert.equal(downloaded.length,1);
    assert.match(nodes.get('notice').textContent,/VTT 导出已阻止/);
    assert.match(nodes.get('notice').textContent,/零时长/);
    // A fresh independent UI session allows media ownership testing without discard dialogs.
    await import(`../../public/subtitle-workbench/main.js?ownership-test-fresh`);
    const handlers=nodes.get('media-input').listeners.get('change');
    const newest=handlers.at(-1);
    let resolveA;
    const bytesA=new Promise(resolve=>{resolveA=resolve;});
    const mediaA=new File([new Uint8Array([1,2,3])],'late-A.wav',{type:'audio/wav'}); mediaA.arrayBuffer=()=>bytesA;
    const promiseA=newest({target:{files:[mediaA],value:''}});
    await new Promise(resolve=>setImmediate(resolve));
    const mediaB=new File([new Uint8Array([4,5,6])],'current-B.wav',{type:'audio/wav'});
    await newest({target:{files:[mediaB],value:''}});
    resolveA(new Uint8Array([1,2,3]).buffer);await promiseA;
    assert.equal(nodes.get('media-name').textContent,'current-B.wav');
    assert.equal(nodes.get('source-player').paused,true);
    assert.equal(nodes.get('operation-panel').hidden,true);
    let resolveC;
    const bytesC=new Promise(resolve=>{resolveC=resolve;});
    const mediaC=new File([new Uint8Array([7,8,9])],'cancelled-C.wav',{type:'audio/wav'});mediaC.arrayBuffer=()=>bytesC;
    const promiseC=newest({target:{files:[mediaC],value:''}});
    await new Promise(resolve=>setImmediate(resolve));
    await nodes.get('cancel-operation').listeners.get('click').at(-1)();
    assert.equal(nodes.get('operation-panel').hidden,true);
    resolveC(new Uint8Array([7,8,9]).buffer);await promiseC;
    assert.equal(nodes.get('media-name').textContent,'current-B.wav');
    assert.match(nodes.get('notice').textContent,/已取消本次任务/);
  } finally { URL.createObjectURL=originalCreate;for(const[key,value]of Object.entries(previous))value===undefined?delete globalThis[key]:globalThis[key]=value; }
});

import vm from 'node:vm';
import {createSubtitleDraft,canPlayCue} from '../../public/subtitle-workbench/draft.js';
function metadataFixture(){
 let probe,timeout,cleared=0,now=0;
 const body=js.slice(js.indexOf('  function metadataFor('),js.indexOf('  function showSource('));
 const metadata=vm.runInNewContext(`${body}\nmetadataFor`,{document:{createElement(){return probe={duration:NaN,load(){},removeAttribute(){}}}},MAX_SECONDS:60,DOMException,performance:{now:()=>now},setTimeout(fn,ms){assert.equal(ms,20000);timeout=fn;return 1},clearTimeout(){cleared++}});
 const operation={controller:new AbortController(),cleanups:new Set()};
 return {run:()=>metadata({},'blob:local',operation),operation,get probe(){return probe},expire:()=>timeout(),advance:ms=>{now=ms},get cleared(){return cleared}};
}
test('metadata waits for finite durationchange within original deadline and cleans every listener',async()=>{
 const f=metadataFixture(),promise=f.run();f.probe.onloadedmetadata();f.probe.duration=Infinity;f.probe.ondurationchange();f.probe.duration=43.366667;f.probe.ondurationchange();
 assert.equal(await promise,43.366667);assert.equal(f.probe.onloadedmetadata,null);assert.equal(f.probe.ondurationchange,null);assert.equal(f.probe.onerror,null);assert.equal(f.operation.cleanups.size,0);assert.equal(f.cleared,1);
});
test('metadata pending finite duration respects cancellation, timeout and over-limit failure',async()=>{
 for(const kind of ['cancel','timeout','too-long','pre-aborted']){
  const f=metadataFixture();if(kind==='pre-aborted')f.operation.controller.abort();const promise=f.run();
  if(kind==='cancel')f.operation.controller.abort();if(kind==='timeout')f.expire();if(kind==='too-long'){f.probe.duration=60.00001;f.probe.onloadedmetadata()}
  await assert.rejects(promise);assert.equal(f.operation.cleanups.size,0);assert.equal(f.probe.ondurationchange,null);
 }
});
test('actual playback rejects fresh player boundary mismatch and not-ready duration; valid cue plays',async()=>{
 const media={name:'clip.mp4',mediaSHA256:'a'.repeat(64),size:1234,mime:'video/mp4',mediaDuration:43.366667,decodedSampleRate:null,decodedSampleCount:null};
 const draft=await createSubtitleDraft({media,text:'WEBVTT\n\n00:00:42.000 --> 00:00:43.366\nHello\n',format:'vtt'});
 const guard=js.slice(js.indexOf('export function isPlayableRange('),js.indexOf('// Average all real channels.')).replace('export ','');
 const body=js.slice(js.indexOf('  function stopPlayback('),js.indexOf('  function owned('));
 for(const [duration,readyState,expected] of [[43.365999,4,0],[NaN,4,0],[43.366667,0,0],[43.366667,4,1]]){
  const state={media,url:'blob:local',playId:0,playEnd:null,playFrame:null,playIntent:null,pendingPlay:new Set(),operation:null};let calls=0;
  const player={duration,readyState,currentTime:0,ended:false,paused:true,pause(){this.paused=true},async play(){calls++;this.paused=false}};
  const start=vm.runInNewContext(`${guard}\n${body}\nstartPlayback`,{state,player,MAX_SECONDS:60,document:{hidden:false},$:()=>({value:'1'}),notice(){},currentDraft:()=>draft,canPlayCue,cancelAnimationFrame(){},requestAnimationFrame(){return 1}});
  await start(draft.candidates[0]);assert.equal(calls,expected);assert.equal(state.pendingPlay.size,0);
 }
});

test('late native play success rechecks actual duration, readiness, source and error before announcing playback',async()=>{
 const media={name:'clip.mp4',mediaSHA256:'a'.repeat(64),size:1234,mime:'video/mp4',mediaDuration:5,decodedSampleRate:null,decodedSampleCount:null};
 const draft=await createSubtitleDraft({media,text:'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello\n',format:'vtt'});
 const guard=js.slice(js.indexOf('export function isPlayableRange('),js.indexOf('// Average all real channels.')).replace('export ','');
 const body=js.slice(js.indexOf('  function stopPlayback('),js.indexOf('  function owned('));
 for(const change of [{duration:3.999999},{readyState:0},{currentSrc:'blob:other'},{error:{code:3}},{currentTime:4},{currentTime:NaN}]){
  const state={media,url:'blob:local',playId:0,playEnd:null,playFrame:null,playIntent:null,pendingPlay:new Set(),operation:null};let frames=0;
  const player={duration:5,readyState:4,currentSrc:'blob:local',currentTime:0,ended:false,paused:true,pause(){this.paused=true},async play(){this.paused=false;Object.assign(this,change)}};
  const start=vm.runInNewContext(`${guard}\n${body}\nstartPlayback`,{state,player,MAX_SECONDS:60,document:{hidden:false},$:()=>({value:'1'}),notice(){},currentDraft:()=>draft,canPlayCue,cancelAnimationFrame(){},requestAnimationFrame(){frames++;return 1}});
  await start(draft.candidates[0]);assert.equal(player.paused,true);assert.equal(frames,0);assert.equal(state.playEnd,null);assert.equal(state.pendingPlay.size,0);
 }
});

test('finite metadata after absolute deadline fails even when the scheduled timeout task is delayed',async()=>{
 const f=metadataFixture(),promise=f.run();f.probe.onloadedmetadata();f.advance(21000);f.probe.duration=43.366667;f.probe.ondurationchange();await assert.rejects(promise,/及时/);assert.equal(f.operation.cleanups.size,0);assert.equal(f.probe.ondurationchange,null);
});

test('actual File subtitle importer preserves UTF-8 BOM/CRLF source and exact original SHA',async()=>{
 const {sha256Bytes}=await import('../../public/subtitle-workbench/draft.js');
 const body=js.slice(js.indexOf('  async function importSubtitleFile('),js.indexOf('  async function importDraftFile('));
 const media={name:'clip.wav',mediaSHA256:'a'.repeat(64),size:3,mime:'audio/wav',mediaDuration:5,decodedSampleRate:null,decodedSampleCount:null};let draft;
 const load=vm.runInNewContext(`${body}\nimportSubtitleFile`,{state:{media},SUBTITLE_BYTES:1048576,TextDecoder,createSubtitleDraft,notice(){},discardPendingText:async()=>true,startOperation:()=>({}),owned:()=>true,addDraft:d=>{draft=d},finishOperation(){},failOperation(op,error){throw error}});
 for(const [name,text] of [['bom.srt','\ufeff1\r\n00:00:00,000 --> 00:00:01,000\r\nHello café\r\n'],['bom.vtt','\ufeffWEBVTT\r\n\r\n00:00:00.000 --> 00:00:01.000\r\nHello café\r\n']]){
  const file=new File([text],name);await load(file);assert.equal(draft.source.subtitle.text,text);assert.equal(draft.source.subtitle.sha256,await sha256Bytes(await file.arrayBuffer()));assert.equal(draft.candidates.length,1);
 }
});
