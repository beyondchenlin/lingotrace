import test from 'node:test';
import assert from 'node:assert/strict';
import {align,TrainingEngine,validateSnapshot,type Attempt,type Material} from '../core/training';
import {inputLetterFeedback,liveLetterFeedback,submittedErrorRanges,MAX_FEEDBACK_TEXT_UTF16,MAX_FEEDBACK_UNITS,MAX_FEEDBACK_CELLS} from './live-letter-feedback';
import {inputCardGeometry,paintInputText,syncNativeFeedback} from './input-card';
import {responsiveLayout} from './responsive-layout';

const wrong=(draft:string,reference:string)=>liveLetterFeedback(draft,reference).filter(r=>r.kind==='wrong').map(r=>draft.slice(r.start,r.end)).join('');
const checked=(reference:string,answer:string)=>({...align(reference,answer),answer}) as Attempt;

test('every input prefix is highlighted immediately; the untyped suffix is never an error',()=>{
 const reference='And I am an education ranger here.';
 for(let end=1;end<=reference.length;end++){
  const draft=reference.slice(0,end),ranges=liveLetterFeedback(draft,reference);
  assert.equal(wrong(draft,reference),'');assert.ok(ranges.length);assert.ok(ranges.every(r=>r.end<=draft.length));
 }
 assert.equal(wrong('And I am an eduxation ranger here.',reference),'x');
});
test('middle insertion and deletion realign subsequent native letters; corrections refresh immediately',()=>{
 assert.equal(wrong('Hxello world','Hello world'),'x');
 assert.equal(wrong('Helo world','Hello world'),'');
 assert.equal(wrong('Hello middle world','Hello world').trim(),'middle');
 assert.equal(wrong('Hello world','Hello world'),'');
 assert.deepEqual(liveLetterFeedback('', 'Hello world'),[]);
 for(const draft of['Helllo','Hellllo'])assert.equal(wrong(draft,'Hello'),'l'.repeat(draft.length-5));
});
test('normalization, punctuation, Unicode compatibility, apostrophes and spacing match the real checker',()=>{
 for(const [reference,draft] of[
  ['Hi everybody!','ＨＩ, EVERYBODY.'],["don't stop","ＤＯＮ’T\t stop"],['Hello world','hello\n   world'],
  ['office','oﬃce'],['café tomorrow','cafe\u0301 tomorrow'],['Hi everybody','🌲 Hi!everybody'],
 ]){
  assert.equal(align(reference,draft).errors,0);assert.equal(wrong(draft,reference),'');
 }
 assert.equal(wrong('oﬃce','offce'),'ﬃ');
 assert.ok(liveLetterFeedback('oﬃce','offce').some(r=>r.start===1&&r.end===2&&r.kind==='wrong'));
});
test('pasted multiword text uses alignment rather than offsets and surplus letters stay wrong',()=>{
 const draft='Hi,\n  everybody extra';assert.equal(wrong(draft,'Hi everybody!').trim(),'extra');
 assert.equal(wrong('I canx see a tree.','I can see a tree.'),'x');
 assert.equal(wrong('I see a tree.','I can see a tree.'),'');
 assert.ok(liveLetterFeedback('every body','everybody').some(r=>r.kind==='wrong'&&r.start===5&&r.end===6));
});
test('compatibility glyphs that expand into token boundaries retain valid indivisible native ranges',()=>{
 for(const [draft,reference] of[['½','12'],['℀','ac'],['a½b','a12b'],['½','1/2'],['℀','a/c'],['İx','ix']]){
  const ranges=liveLetterFeedback(draft,reference);
  assert.ok(ranges.every((r,i)=>r.start>=0&&r.end>r.start&&r.end<=draft.length&&(!i||r.start>=ranges[i-1].end)));
 }
 assert.equal(wrong('½','12'),'½');assert.equal(wrong('℀','ac'),'℀');assert.equal(wrong('İx','ix'),'İ');
 assert.equal(wrong('½','1/2'),'');assert.equal(wrong('℀','a/c'),'');
});
test('hidden and composing projections are neutral and do not retain expected text or ranges',()=>{
 const visible=inputLetterFeedback('Hxello','Hello',null);assert.equal(visible.mode,'live');assert.ok(visible.ranges.some(r=>r.kind==='wrong'));
 assert.deepEqual(inputLetterFeedback('Hxello',undefined,null),{mode:'none',ranges:[]});
 assert.deepEqual(inputLetterFeedback('Hxello','Hello',null,true),{mode:'none',ranges:[]});
 assert.deepEqual(inputLetterFeedback('Hxello',undefined,null),inputLetterFeedback('Hxello',undefined,null));
 assert.deepEqual(liveLetterFeedback('a','a'.repeat(4_000_001)),[]);
});
test('exact checked feedback has priority and stale checks cannot override new live or hidden drafts',()=>{
 const attempt=checked('Hello','Helo');
 assert.deepEqual(inputLetterFeedback('Helo','Hello',attempt).ranges,[{start:0,end:4,kind:'wrong'}]);
 assert.equal(inputLetterFeedback('Helo','Hello',attempt).mode,'checked');
 assert.equal(inputLetterFeedback('Hello','Hello',attempt).mode,'live');
 assert.equal(inputLetterFeedback('Hello',undefined,attempt).mode,'none');
 assert.deepEqual(inputLetterFeedback('Helo','Hello',attempt,true),{mode:'none',ranges:[]});
 assert.deepEqual(inputLetterFeedback('Hello','Hello',checked('Hello','Hello')).ranges,[]);
});
function native(draft:string){
 const attrs=new Map<string,string>();
 const element={value:draft,selectionStart:1,selectionEnd:3,scrollTop:40,scrollLeft:2,style:{webkitTextFillColor:''},dataset:{},setAttribute:(key:string,value:string)=>attrs.set(key,value)} as unknown as HTMLTextAreaElement;
 return{element,attrs};
}
test('native visibility and AX wrong-state share the projection, with immediate hide and IME reset',()=>{
 const {element,attrs}=native('Hxello');
 syncNativeFeedback(element,null,'Hello');assert.equal(element.style.color,'transparent');assert.equal(element.dataset.letterFeedback,'live');assert.equal(attrs.get('aria-invalid'),'true');
 syncNativeFeedback(element,null,undefined);assert.equal(element.style.color,'#f4f6f5');assert.equal(element.dataset.letterFeedback,'none');assert.equal(attrs.get('aria-invalid'),'false');
 syncNativeFeedback(element,null,'Hello',true);assert.equal(element.style.color,'#f4f6f5');assert.equal(attrs.get('aria-invalid'),'false');
 element.value='Hello';syncNativeFeedback(element,null,'Hello');assert.equal(element.style.color,'transparent');assert.equal(attrs.get('aria-invalid'),'false');
 assert.equal(element.value,'Hello');assert.equal(element.selectionStart,1);assert.equal(element.selectionEnd,3);assert.equal(element.scrollTop,40);assert.equal(element.scrollLeft,2);
});
test('live rendering cannot create attempts, score, submission sounds, or replace the native draft',()=>{
 const material:Material={id:'live-letters',version:'1',title:'QA',rights:'Original',cues:[{id:'a',start:0,end:3,text:'Hello world'}]},engine=new TrainingEngine({material});
 engine.input('Hxello world','paste');const before=engine.getSnapshot(),serialized=JSON.stringify(before),attemptCount=before.attempts.length;
 for(let i=0;i<3;i++){liveLetterFeedback(engine.draft,engine.cue.text);syncNativeFeedback(native(engine.draft).element,null,engine.cue.text)}
 assert.equal(engine.getSnapshot(),before);assert.equal(JSON.stringify(engine.getSnapshot()),serialized);assert.equal(engine.getSnapshot().attempts.length,attemptCount);assert.equal(engine.getSnapshot().earnedWords,0);
 assert.equal(engine.draft,'Hxello world');assert.equal(engine.submit()!.errors,1);
});
test('shared Canvas paints letter feedback plus pale typing-zone reference remainder',async()=>{
 const {createCanvas}=await import('@napi-rs/canvas'),ctx=createCanvas(1672,1500).getContext('2d');
 const labels:{text:string;x:number;y:number;color:string}[]=[],strokes:string[]=[],fill=ctx.fillText.bind(ctx),stroke=ctx.stroke.bind(ctx);
 ctx.fillText=((text:string,x:number,y:number)=>{labels.push({text,x,y,color:String(ctx.fillStyle)});fill(text,x,y)}) as typeof ctx.fillText;
 ctx.stroke=(()=>{strokes.push(String(ctx.strokeStyle));stroke()}) as typeof ctx.stroke;
 const draft='Hxello',display={text:draft,lines:[{start:0,end:6,text:draft,x:200,y:8,width:120,height:40,baseline:38}],selection:[{x:220,y:8,w:40,h:40}],caret:{x:260,y:8,w:1,h:40},scrollLeft:0,scrollTop:3,width:800,height:100,font:'400 24px monospace',letterSpacing:0,lineHeight:40,paddingX:200,paddingY:8};
 const state={draft,referenceGuide:'Hello world',nativeInputDisplay:display,scrollLeft:0,caret:1,selectionEnd:3,inputFocused:true,composition:false,reducedMotion:true,renderTime:0},before=JSON.stringify(state),card=inputCardGeometry(responsiveLayout(false));
 paintInputText(ctx as unknown as CanvasRenderingContext2D,card,state);
 assert.equal(JSON.stringify(state),before);assert.ok(labels.some(r=>r.text==='x'&&r.color==='#ff858b'));assert.ok(labels.some(r=>r.text==='H'&&r.color==='#8ff0bd'));
 // Typing zone owns pale reference remainder (no video capsule).
 assert.ok(labels.some(r=>r.color==='#b7c6c1'));assert.ok(labels.some(r=>r.text.includes('world')));
 assert.ok(strokes.includes('#ff858b'));assert.ok(strokes.includes('#8ff0bd'));
 const draftLabels=labels.filter(r=>r.color!=='#b7c6c1');
 assert.equal(draftLabels[0].x,card.input.x+200);assert.equal(draftLabels[0].y,card.input.y+38-3);
 labels.length=0;paintInputText(ctx as unknown as CanvasRenderingContext2D,card,{...state,referenceGuide:undefined});assert.ok(labels.every(r=>r.color==='#f4f6f5'));
 labels.length=0;paintInputText(ctx as unknown as CanvasRenderingContext2D,card,{...state,composition:true});assert.ok(labels.every(r=>r.color==='#f4f6f5'||r.color==='#b7c6c1'));
});
test('an erroneous pasted newline has a visible wavy cue without inventing an input glyph',async()=>{
 const {createCanvas}=await import('@napi-rs/canvas'),ctx=createCanvas(1672,1500).getContext('2d'),colors:string[]=[],labels:string[]=[],stroke=ctx.stroke.bind(ctx),fill=ctx.fillText.bind(ctx);
 ctx.stroke=(()=>{colors.push(String(ctx.strokeStyle));stroke()}) as typeof ctx.stroke;
 ctx.fillText=((text:string,x:number,y:number)=>{labels.push(text);fill(text,x,y)}) as typeof ctx.fillText;
 paintInputText(ctx as unknown as CanvasRenderingContext2D,inputCardGeometry(responsiveLayout(false)),{draft:'every\nbody',referenceGuide:'everybody',scrollLeft:0,caret:5,selectionEnd:5,inputFocused:false,composition:false,reducedMotion:true,renderTime:0});
 assert.ok(colors.includes('#ff858b'));assert.equal(labels.join(''),'everybody');
});
test('native newline-inclusive ends and omitted tabs paint actual wrong control gaps',async()=>{
 const {createCanvas}=await import('@napi-rs/canvas'),ctx=createCanvas(1672,1500).getContext('2d'),colors:string[]=[],stroke=ctx.stroke.bind(ctx);
 ctx.stroke=(()=>{colors.push(String(ctx.strokeStyle));stroke()}) as typeof ctx.stroke;
 for(const control of['\n','\t']){
  const draft=`a${control}b`,display={text:draft,lines:[{start:0,end:control==='\n'?2:1,text:'a',x:20,y:8,width:16,height:40,baseline:38},{start:2,end:3,text:'b',x:control==='\n'?20:100,y:control==='\n'?48:8,width:16,height:40,baseline:control==='\n'?78:38}],selection:[],caret:{x:116,y:8,w:1,h:40},scrollLeft:0,scrollTop:0,width:800,height:100,font:'400 24px monospace',letterSpacing:0,lineHeight:40,paddingX:20,paddingY:8};
  colors.length=0;paintInputText(ctx as unknown as CanvasRenderingContext2D,inputCardGeometry(responsiveLayout(false)),{draft,referenceGuide:'ab',nativeInputDisplay:display,scrollLeft:0,caret:3,selectionEnd:3,inputFocused:false,composition:false,reducedMotion:true,renderTime:0});
  assert.ok(colors.includes('#ff858b'),JSON.stringify(control));
 }
});
test('actual Studio passes only the already-gated visible reference to native feedback and clears Hide synchronously',async()=>{
 const {readFile}=await import('node:fs/promises'),source=await readFile(new URL('../components/Studio.tsx',import.meta.url),'utf8');
 assert.match(source,/syncNativeFeedback\(input,activeListening\?\.mode==='listen'\?null:getDraftFeedback\(v\.snapshot,v\.draft,v\.composition\)\.attempt,v\.referenceGuide,v\.composition\)/);
 const hide=source.slice(source.indexOf('function setReferenceGuideVisible'),source.indexOf('function setReferenceGuideVisible')+1200);
 assert.match(hide,/if\(!visible\)/);assert.match(hide,/syncNativeFeedback\(inputRef\.current,[^;]*undefined,composing\.current\)/);
 const drawStart=source.indexOf('const draw=(_rafTime'),drawEnd=source.indexOf('const frameLoop=startSceneFrameLoop',drawStart);assert.ok(drawStart>=0&&drawEnd>drawStart);const draw=source.slice(drawStart,drawEnd);
 assert.doesNotMatch(draw,/\.submit\(|applyReferenceGuideExposure\(|exposeHint\(|playSubmission/);
});
test('oversized restored drafts and references stop before normalization without altering stored input',()=>{
 const long='a'.repeat(MAX_FEEDBACK_TEXT_UTF16+1),material:Material={id:'long-feedback-qa',version:'1',title:'QA',rights:'Original',cues:[{id:'a',start:0,end:1,text:'A'}]},engine=new TrainingEngine({material});
 engine.input(long);const saved=engine.getSnapshot(),restored=new TrainingEngine({snapshot:validateSnapshot(saved)}),before=JSON.stringify(restored.getSnapshot());
 const Segmenter=Intl.Segmenter;let segments=0;
 Object.defineProperty(Intl,'Segmenter',{value:new Proxy(Segmenter,{construct(target,args,newTarget){segments++;return Reflect.construct(target,args,newTarget)}})});
 try{for(let i=0;i<50;i++){assert.deepEqual(liveLetterFeedback(restored.draft,'A'),[]);assert.deepEqual(liveLetterFeedback('A',long),[]);assert.deepEqual(liveLetterFeedback(long,undefined),[]);assert.deepEqual(submittedErrorRanges({...checked('A','A'),answer:long},long),[])}}finally{Object.defineProperty(Intl,'Segmenter',{value:Segmenter})}
 assert.equal(segments,0);assert.equal(restored.draft,long);assert.equal(JSON.stringify(restored.getSnapshot()),before);assert.equal(restored.getSnapshot().attempts.length,0);
});
test('neutral and over-cell-budget projections are cached instead of normalizing on each RAF',()=>{
 const Segmenter=Intl.Segmenter;let segments=0;
 Object.defineProperty(Intl,'Segmenter',{value:new Proxy(Segmenter,{construct(target,args,newTarget){segments++;return Reflect.construct(target,args,newTarget)}})});
 try{
  for(const [draft,reference] of[['中'.repeat(1999),'unique-neutral-cue'],['x'.repeat(2100),'y'.repeat(2000)],['a'.repeat(MAX_FEEDBACK_UNITS+1),'z']]){
   const before=segments,first=liveLetterFeedback(draft,reference);assert.deepEqual(first,[]);
   for(let i=0;i<25;i++)assert.equal(liveLetterFeedback(draft,reference),first);
   assert.equal(segments-before,1);
  }
 }finally{Object.defineProperty(Intl,'Segmenter',{value:Segmenter})}
});
test('stable checked-draft color mapping is cached without changing formal checked precedence',()=>{
 const attempt=checked('Hello there','Hello wrong'),Segmenter=Intl.Segmenter;let segments=0;
 Object.defineProperty(Intl,'Segmenter',{value:new Proxy(Segmenter,{construct(target,args,newTarget){segments++;return Reflect.construct(target,args,newTarget)}})});
 try{const first=submittedErrorRanges(attempt,attempt.answer);for(let i=0;i<25;i++)assert.equal(submittedErrorRanges(attempt,attempt.answer),first);assert.equal(segments,1);assert.equal(inputLetterFeedback(attempt.answer,'Hello there',attempt).mode,'checked')}finally{Object.defineProperty(Intl,'Segmenter',{value:Segmenter})}
});
test('one accepted DP uses four reusable rows and its matrix stays within the declared bound',()=>{
 const U8=globalThis.Uint8Array,U32=globalThis.Uint32Array;let steps=0,stepLength=0,rows=0;
 globalThis.Uint8Array=new Proxy(U8,{construct(target,args,newTarget){steps++;stepLength=Number(args[0]);return Reflect.construct(target,args,newTarget)}});
 globalThis.Uint32Array=new Proxy(U32,{construct(target,args,newTarget){rows++;return Reflect.construct(target,args,newTarget)}});
 try{const first=liveLetterFeedback('bounded repeat insertion','bounded repeat');assert.ok(first.length);for(let i=0;i<25;i++)assert.equal(liveLetterFeedback('bounded repeat insertion','bounded repeat'),first)}finally{globalThis.Uint8Array=U8;globalThis.Uint32Array=U32}
 assert.equal(steps,1);assert.equal(rows,4);assert.ok(stepLength<=MAX_FEEDBACK_CELLS+MAX_FEEDBACK_UNITS*2+1);
});
