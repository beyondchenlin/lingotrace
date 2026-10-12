import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseTimingSeconds, timingRange, nudgeTiming, boundaryPreview, timingShortcut } from '../../public/subtitle-workbench/timing.js';
const html = await readFile(new URL('../../public/subtitle-workbench/index.html', import.meta.url), 'utf8');

test('timing controls reject missing, nonfinite, negative and inverted values without fabricating zero', () => {
  for (const value of ['', ' ', '-0', '-1', 'NaN', 'Infinity', '1e2', '0x10']) assert.equal(parseTimingSeconds(value), null);
  assert.equal(parseTimingSeconds('0'), 0); assert.equal(parseTimingSeconds('0.001'), 0.001); assert.equal(parseTimingSeconds('.9'),.9); assert.equal(parseTimingSeconds('1.'),1);
  for (const [start,end,duration] of [['','1',5],['0','Infinity',5],['1','1',5],['2','1',5],['0','5.001',5],['0','1',null],['0','1',Infinity]]) assert.ok(timingRange(start,end,duration).error);
  assert.equal(timingRange('0','5',5).error, '');
  assert.equal(nudgeTiming('0',-1,10,5),null);
  assert.equal(nudgeTiming('5',1,1,5),null);
  assert.equal(nudgeTiming('1.123456',1,10,5),'1.133456');
  assert.equal(nudgeTiming('1',1,7,5),null);
  assert.deepEqual(boundaryPreview({start:0,end:5},'start',5),{start:0,end:.5});
  assert.deepEqual(boundaryPreview({start:0,end:5},'end',5),{start:4.5,end:5});
  assert.equal(boundaryPreview({start:3,end:2},'cue',5),null);
});
test('keyboard mapping is exact-target, composition-safe and leaves native text/number controls alone', () => {
  const pad={}, input={};
  assert.equal(timingShortcut({target:pad,key:'ArrowLeft'},pad),-1);
  assert.equal(timingShortcut({target:pad,key:'ArrowRight'},pad),1);
  assert.equal(timingShortcut({target:pad,key:' '},pad),'play');
  assert.equal(timingShortcut({target:pad,key:' ',repeat:true},pad),'hold');
  for (const event of [{target:input,key:' '},{target:input,key:'ArrowLeft'},{target:pad,key:' ',isComposing:true},{target:pad,key:'ArrowRight',ctrlKey:true},{target:pad,key:'ArrowLeft',shiftKey:true}]) assert.equal(timingShortcut(event,pad),null);
});

// This substitute executes the production callbacks and draft model. It does not
// claim real-browser, media output, touch, or frame-accuracy acceptance.
class Element {
  constructor(tag='div',id='') { this.tagName=tag;this.id=id;this.children=[];this.listeners=new Map();this.attrs=new Map();this.value='';this.hidden=false;this.disabled=false;this.dataset={};this.textContent='';this.paused=true;this.currentTime=0;this.duration=5;this.readyState=4;this.textTracks=new EventTarget();this.textTracks.length=0;this.playCalls=0; }
  addEventListener(type,fn,options={}) { const list=this.listeners.get(type)||[];list.push({fn,once:options.once});this.listeners.set(type,list); }
  removeEventListener(type,fn) { this.listeners.set(type,(this.listeners.get(type)||[]).filter(item=>item.fn!==fn)); }
  async emit(type,event={}) { for(const item of [...(this.listeners.get(type)||[])]) { if(item.once)this.removeEventListener(type,item.fn);await item.fn(event); } }
  append(...nodes){this.children.push(...nodes)} replaceChildren(...nodes){this.children=[...nodes]}
  setAttribute(name,value){this.attrs.set(name,value)} removeAttribute(name){this.attrs.delete(name);if(name==='src')this.src=''}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(selector==='button'&&child.tagName==='button'?[child]:[]),...child.querySelectorAll(selector)])}
  pause(){this.paused=true} play(){this.playCalls++;this.paused=false;return Promise.resolve()}
  load(){if(this.src&&this.tagName==='video'&&this.id!=='source-player')queueMicrotask(()=>this.onloadedmetadata?.())}
  click(){} focus(){this.focused=true} remove(){} showModal(){this.returnValue='cancel';this.open=true}
}
let sequence=0;
async function withWorkbench(run) {
  const nodes=new Map([...html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g)].map(([,tag,id])=>[id,new Element(tag,id)]));
  nodes.get('playback-rate').value='1';nodes.get('timing-step').value='10';nodes.get('timing-target').value='start';
  const doc=new Element('document');doc.hidden=false;doc.getElementById=id=>nodes.get(id);doc.createElement=tag=>new Element(tag);doc.querySelectorAll=()=>[];doc.body=new Element('body');
  const old={document:globalThis.document,window:globalThis.window,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame,setTimeout:globalThis.setTimeout};
  let frame=null;const downloads=[];const oldCreate=URL.createObjectURL;
  globalThis.document=doc;globalThis.window=new Element('window');globalThis.requestAnimationFrame=fn=>{frame=fn;return 1};globalThis.cancelAnimationFrame=()=>{frame=null};
  globalThis.setTimeout=(fn,ms,...args)=>{const timer=old.setTimeout(fn,ms,...args);if(ms===30000)timer.unref();return timer};
  URL.createObjectURL=blob=>{if(!(blob instanceof File))downloads.push(blob);return oldCreate(blob)};
  const $=id=>nodes.get(id), choose=(id,file)=>$(id).emit('change',{target:{files:[file],value:'selected'}});
  const input=async(id,value)=>{$(id).value=value;await $(id).emit('input',{target:$(id)})};
  const key=async(key,target=$('timing-keyboard'),more={})=>{let prevented=false;await $('timing-keyboard').emit('keydown',{target,key,preventDefault(){prevented=true},...more});return prevented};
  try {
    await import(`../../public/subtitle-workbench/main.js?timing-ui-${++sequence}`);
    await choose('media-input',new File([new Uint8Array([1,2,3])],'clip.wav',{type:'audio/wav'}));
    await choose('subtitle-input',new File(['1\n00:00:01,000 --> 00:00:02,000\nFirst words\n\n2\n00:00:02,500 --> 00:00:04,000\nSecond words\n'],'clip.srt'));
    await run({$,choose,input,key,doc,downloads,getFrame:()=>frame});
  } finally { URL.createObjectURL=oldCreate;for(const[key,value]of Object.entries(old))value===undefined?delete globalThis[key]:globalThis[key]=value; }
}

test('actual numeric, mouse and scoped keyboard callbacks create reversible time versions without touching source', async()=>withWorkbench(async({$,input,key,downloads})=>{
  assert.equal($('cue-start').value,'1');assert.equal($('cue-end').value,'2');
  assert.match($('timing-neighbors').textContent,/Second words/);
  await input('cue-start','0.9');
  assert.equal($('save-timing').disabled,false);
  await $('download-json').emit('click');assert.equal(downloads.length,0);assert.match($('notice').textContent,/未保存/);
  await input('cue-start-range','0.85');assert.equal($('cue-start').value,'0.85');
  assert.equal(await key('ArrowRight'),true);assert.equal($('cue-start').value,'0.86');
  $('timing-target').value='end';$('timing-step').value='100';
  assert.equal(await key('ArrowRight'),true);assert.equal($('cue-end').value,'2.1');
  // Neither textarea nor numeric input is a shortcut target, even if bubbled.
  for(const id of ['cue-text','cue-start']){assert.equal(await key(' ',$(id)),false);assert.equal(await key('ArrowLeft',$(id)),false)}
  await input('cue-text','Pending text edit');
  await $('save-timing').emit('click');
  assert.equal($('cue-text').value,'Pending text edit');assert.equal($('save-edit').disabled,false);
  assert.match($('cue-raw').textContent,/"start": 1/);assert.match($('editor-range').textContent,/00:00.860/);
  await $('save-edit').emit('click');await $('download-json').emit('click');
  const saved=JSON.parse(await downloads.at(-1).text());
  assert.equal(saved.version,'subtitle-draft.v2');assert.equal(saved.candidates[0].start,.86);assert.equal(saved.candidates[0].end,2.1);assert.equal(saved.candidates[0].alignment,'stale');
  assert.equal(saved.raw.cues[0].start,1);assert.equal(saved.raw.cues[0].end,2);assert.equal(saved.candidates[0].text,'Pending text edit');
  await $('undo-edit').emit('click');assert.equal($('cue-text').value,'First words');assert.equal($('cue-start').value,'0.86');
  await $('undo-edit').emit('click');assert.equal($('cue-start').value,'1');assert.equal($('cue-end').value,'2');assert.equal($('undo-edit').disabled,true);
  await input('cue-end','2.2');await input('cue-text','Saved independently');await $('save-edit').emit('click');
  assert.equal($('cue-end').value,'2.2');assert.equal($('save-timing').disabled,false);
  await $('cancel-timing').emit('click');assert.equal($('cue-end').value,'2');assert.equal($('cue-text').value,'Saved independently');
}));

test('pending bounds validate against fresh media duration, do not clamp errors, and preview only temporary ranges', async()=>withWorkbench(async({$,input,key,getFrame})=>{
  const player=$('source-player');
  for(const[start,end]of [['','2'],['2','2'],['3','2'],['-1','2'],['0','5.001']]){
    await input('cue-start',start);await input('cue-end',end);assert.equal($('save-timing').disabled,true);assert.equal($('preview-timing').disabled,true);
    await $('save-timing').emit('click');assert.match($('editor-range').textContent,/00:01.000/);assert.equal($('cue-end').value,end);
  }
  await input('cue-start','0');await input('cue-end','5');
  await $('preview-start').emit('click');assert.equal(player.currentTime,0);assert.equal(player.paused,false);
  player.currentTime=.51;getFrame()();assert.equal(player.paused,true);
  await $('preview-end').emit('click');assert.equal(player.currentTime,4.5);
  await input('cue-end','4.8');assert.equal(player.paused,true);
  await key(' ');assert.equal(player.currentTime,0);assert.equal(player.paused,false);
  const plays=player.playCalls;assert.equal(await key(' ',undefined,{repeat:true}),true);assert.equal(player.playCalls,plays);
  await key(' ');assert.equal(player.paused,true);
  player.duration=4;await player.emit('durationchange');assert.equal($('save-timing').disabled,true);
  await input('cue-end','4');await $('save-timing').emit('click');assert.match($('editor-range').textContent,/00:04.000/);
  await input('cue-end','3.9');player.readyState=0;await player.emit('emptied');assert.equal($('save-timing').disabled,true);assert.equal($('preview-timing').disabled,true);
  const before=player.playCalls;await $('preview-timing').emit('click');assert.equal(player.playCalls,before);
}));

test('late preview play is cancelled by new timing, visibility and changed duration', async()=>withWorkbench(async({$,input,doc})=>{
  const player=$('source-player');
  for(const change of ['edit','hide','duration']){
    doc.hidden=false;player.duration=5;player.readyState=4;
    let release;player.play=()=>{player.playCalls++;return new Promise(resolve=>{release=()=>{player.paused=false;resolve()}})};
    const pending=$('preview-timing').emit('click');await new Promise(resolve=>setImmediate(resolve));
    if(change==='edit')await input('cue-end','2.1');
    if(change==='hide'){doc.hidden=true;await doc.emit('visibilitychange')}
    if(change==='duration')player.duration=1.5;
    release();await pending;assert.equal(player.paused,true);
  }
}));

test('pending timing is protected on cue and version changes, and original edited versions remain recoverable', async()=>withWorkbench(async({$,input,choose})=>{
  await input('cue-start','.9'); // Ordinary decimal shorthand stays valid without changing the stored cue.
  const pending=$('cue-list').children[1].emit('click');await new Promise(resolve=>setImmediate(resolve));
  $('discard-dialog').returnValue='cancel';await $('discard-dialog').emit('close');await pending;
  assert.equal($('cue-text').value,'First words');assert.equal($('cue-start').value,'.9');
  const accepted=$('cue-list').children[1].emit('click');await new Promise(resolve=>setImmediate(resolve));
  $('discard-dialog').returnValue='discard';await $('discard-dialog').emit('close');await accepted;
  assert.equal($('cue-text').value,'Second words');assert.equal($('cue-start').value,'2.5');
  await input('cue-start','2.4');await $('save-timing').emit('click');
  await choose('subtitle-input',new File(['1\n00:00:00,000 --> 00:00:01,000\nAnother draft\n'],'other.srt'));
  assert.equal($('draft-versions').children.length,2);
  await input('cue-end','.8');
  const switchVersion=$('draft-versions').emit('change',{target:{value:'0'}});await new Promise(resolve=>setImmediate(resolve));
  $('discard-dialog').returnValue='cancel';await $('discard-dialog').emit('close');await switchVersion;
  assert.equal($('cue-text').value,'Another draft');assert.equal($('cue-end').value,'.8');
  await $('cancel-timing').emit('click');await $('draft-versions').emit('change',{target:{value:'0'}});
  await $('cue-list').children[1].emit('click');assert.equal($('cue-start').value,'2.4');
}));

test('VTT export uses the same conservative duration as editing and preview', async()=>withWorkbench(async({$,choose,downloads,input})=>{
  await choose('subtitle-input',new File(['1\n00:00:00,000 --> 00:00:07,000\nOutside identified media\n\n2\n00:00:01,000 --> 00:00:02,000\nSecond\n'],'outside.srt'));
  await $('cue-list').children[1].emit('click');await input('cue-end','2.1');await $('save-timing').emit('click');
  $('source-player').duration=8;await $('download-vtt').emit('click');
  assert.equal(downloads.length,0);assert.match($('notice').textContent,/VTT 导出已阻止/);
  await $('download-json').emit('click');assert.equal(downloads.length,1);const saved=JSON.parse(await downloads[0].text());
  assert.equal(saved.source.mediaDuration,5);assert.equal(saved.candidates[0].end,7);
}));

// Unlike getFrame's older pointer-only fixture, this queue consumes each frame
// before invoking it, so native pause cannot leave a fictitious live checker.
function nativeFrameQueue() {
  const frames = new Map(); let serial = 0;
  globalThis.requestAnimationFrame = callback => { frames.set(++serial, callback); return serial; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  return { get size() { return frames.size; }, tick() { for (const [id, callback] of [...frames]) { if (frames.delete(id)) callback(); } } };
}
async function pauseNativePreview($, frames) {
  const player = $('source-player');
  await $('preview-timing').emit('click');
  assert.equal(player.currentTime, 1); assert.equal(frames.size, 1);
  player.pause(); await player.emit('pause'); frames.tick();
  assert.equal(frames.size, 0);
  return player;
}
test('native resume inside a paused preview restores exactly one boundary checker', async()=>withWorkbench(async({$})=>{
  const frames = nativeFrameQueue(), player = await pauseNativePreview($, frames);
  player.currentTime = 1.3; await player.emit('seeking'); player.paused = false; await player.emit('play');
  assert.equal(player.paused, false); assert.equal(frames.size, 1);
  frames.tick(); assert.equal(frames.size, 1);
  await player.emit('play'); await player.emit('play'); assert.equal(frames.size, 1, 'repeated native play must not duplicate RAF chains');
  player.currentTime = 2; frames.tick(); assert.equal(player.paused, true); assert.equal(frames.size, 0);
}));
for (const time of [.25, 2, 2.1]) test(`native resume at ${time} cannot continue outside retained preview [1,2]`, async()=>withWorkbench(async({$})=>{
  const frames = nativeFrameQueue(), player = await pauseNativePreview($, frames);
  player.currentTime = time; await player.emit('seeking'); player.paused = false; await player.emit('play'); await player.emit('timeupdate');
  assert.equal(player.paused, true); assert.equal(frames.size, 0);
}));
test('native lower-bound timeupdate stops preview and a later explicit full play has no old boundary', async()=>withWorkbench(async({$})=>{
  const frames = nativeFrameQueue(), player = await pauseNativePreview($, frames);
  player.currentTime = .25; await player.emit('seeking'); await player.emit('timeupdate');
  player.paused = false; await player.emit('play');
  player.currentTime = 2.5; await player.emit('timeupdate');
  assert.equal(player.paused, false, 'stopped preview must not retain its old end on new full-media playback');
  await $('toggle-play').emit('click'); assert.equal(player.paused, true); assert.equal(frames.size, 0);
}));
test('native play event and fulfilled owned play share one checker and do not change draft history', async()=>withWorkbench(async({$,downloads})=>{
  const frames = nativeFrameQueue(), player = $('source-player');
  await $('download-json').emit('click'); const before = await downloads.at(-1).text();
  player.play = async()=>{player.paused=false; await player.emit('play');};
  await $('preview-timing').emit('click'); assert.equal(frames.size, 1);
  player.pause(); await player.emit('pause'); frames.tick(); player.paused=false; await player.emit('play');
  assert.equal(frames.size, 1); await $('download-json').emit('click'); assert.equal(await downloads.at(-1).text(), before);
}));
test('hidden or active import still blocks native playback without restarting preview', async()=>withWorkbench(async({$,doc,choose})=>{
  const frames = nativeFrameQueue(), player = await pauseNativePreview($, frames);
  doc.hidden=true; player.paused=false; await player.emit('play'); assert.equal(player.paused,true); assert.equal(frames.size,0); doc.hidden=false;
  let release; const file=new File(['1\n00:00:01,000 --> 00:00:02,000\nWords'],'pending.srt'); const original=file.arrayBuffer.bind(file);
  file.arrayBuffer=()=>new Promise(resolve=>{release=async()=>resolve(await original())});
  const pending=choose('subtitle-input',file); await new Promise(resolve=>setImmediate(resolve));
  player.paused=false; await player.emit('play'); assert.equal(player.paused,true); assert.equal(frames.size,0);
  await $('cancel-operation').emit('click'); await release(); await pending; assert.equal(player.paused,true); assert.equal(frames.size,0);
}));
test('a canceled late play event cannot revive the preview checker', async()=>withWorkbench(async({$,input})=>{
  const frames=nativeFrameQueue(), player=$('source-player'); let release;
  player.play=()=>new Promise(resolve=>{release=async()=>{player.paused=false;await player.emit('play');resolve()}});
  const pending=$('preview-timing').emit('click'); await new Promise(resolve=>setImmediate(resolve));
  await input('cue-end','2.1'); await release(); await pending;
  assert.equal(player.paused,true); assert.equal(frames.size,0);
}));
