import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {responsiveLayout} from './responsive-layout';
import {learningGeometry} from './learning-surface';
import {IDBFactory} from 'fake-indexeddb';
import {TrainingEngine} from '../core/training';
import {IndexedDBTrainingRepository} from '../core/repository';
import {TrainingHistoryRecorder} from '../core/training-history-recorder';
import {readDefaultCourseBootstrap} from '../core/default-course-bootstrap';
import {bindTrainingTabRecovery,readReferenceVisibility,saveReferenceVisibility} from '../core/training-tab-recovery';
import {captureNativeInputDisplay,invalidateNativeInputDisplay,releaseNativeInputDisplay,nativeInputContentWidth,inputViewportPlan,syncInputViewport,inputCardGeometry,paintInputText} from './input-card';

const draft='Could I have a coffee, please?\nThis is a longer QA draft with several words to verify natural wrapping and native scrolling.\nThe final line stays editable.x';
// Bundled studio-mono WOFF: unitsPerEm=2048; Latin/space hmtx advance=1229.
const advance=28*1229/2048,threshold=15*advance,scale=300/430;

/** Deterministic ASCII pre-wrap fixture. Spaces hang at soft line ends. */
function positions(text:string,width:number,glyph=advance){
 const points:{x:number;y:number}[]=[],rows:string[]=[''];let row=0,column=0;
 for(const match of text.matchAll(/\n|[^\S\n]+|[^\s]+/g)){
  const token=match[0],start=match.index!;
  if(token==='\n'){points[start]={x:column*glyph,y:row*35};row++;column=0;rows[row]='';continue}
  const space=/^\s+$/.test(token);
  if(!space&&column&&((column+token.length)*glyph>width)){row++;column=0;rows[row]=''}
  for(let j=0;j<token.length;j++){
   if(!space&&column&&((column+1)*glyph>width)){row++;column=0;rows[row]=''}
   points[start+j]={x:column*glyph,y:row*35};rows[row]+=token[j];column++;
  }
 }
 points[text.length]={x:column*glyph,y:row*35};return{points,rows};
}
function fixture(contentWidth:number){
 let glyph=advance,node:any,mirror:any;let width=contentWidth;
 const css:any={width:`${width+12}px`,boxSizing:'border-box',borderLeftWidth:'0px',borderRightWidth:'0px',overflowY:'hidden',scrollbarWidth:'none',fontFamily:'monospace',fontSize:'28px',fontWeight:'400',fontStyle:'normal',lineHeight:'35px',paddingLeft:'6px',paddingRight:'6px',paddingTop:'6px',paddingBottom:'6px',letterSpacing:'0px',getPropertyValue:()=> '6px'};
 const rect=(x:number,y:number,w:number,h=32)=>({x,y,left:x,top:y,width:w,height:h,right:x+w,bottom:y+h});
 const mirrorLayout=()=>positions(node.data,Number.parseFloat(mirror.style.width),glyph);
 const detach=(element:any)=>{const parent=element.parentNode;if(parent?.childNodes){const i=parent.childNodes.indexOf(element);if(i>=0)parent.childNodes.splice(i,1)}element.parentNode=null};
 const children=(element:any,...nodes:any[])=>{for(const node of[...element.childNodes])detach(node);element.childNodes=[];for(const node of nodes){detach(node);element.childNodes.push(node);node.parentNode=element}};
 const body:any={childNodes:[],appendChild(element:any){detach(element);this.childNodes.push(element);element.parentNode=this}};
 const doc:any={defaultView:{getComputedStyle:()=>css},body,createTextNode(data:string){return{data,parentNode:null,get length(){return this.data.length}}},createElement(tag:string){
  if(tag==='canvas')return{getContext:()=>({measureText:(text:string)=>({width:text.length*glyph})})};
  const element:any={style:{},childNodes:[],parentNode:null,setAttribute(){},get isConnected(){let parent=this;while(parent&&parent!==body)parent=parent.parentNode;return parent===body},get textContent(){return this.childNodes.map((child:any)=>child.data??child.textContent).join('')},set textContent(value:string){children(this,...(value?[doc.createTextNode(value)]:[]))},append(...nodes:any[]){children(this,...this.childNodes,...nodes);if(tag==='div'&&!node)node=nodes[0]},replaceChildren(...nodes:any[]){children(this,...nodes)},remove(){detach(this)},getBoundingClientRect(){if(tag==='span'){const layout=mirrorLayout(),last=layout.points[Math.max(0,node.data.length-1)];return rect(0,6+last.y+26,0,0)}return rect(0,0,Number.parseFloat(element.style.width)+12,600)}};
  if(tag==='div'&&!mirror)mirror=element;return element;
 },createRange(){let a=0,b=0;const check=(node:any,i:number)=>{if(i<0||i>node.length)throw new DOMException('offset outside Text','IndexSizeError')};return{setStart(node:any,i:number){check(node,i);a=i},setEnd(node:any,i:number){check(node,i);b=i},collapse(){b=a},getClientRects(){const p=mirrorLayout().points[a];return[rect(6+p.x,6+p.y,(b-a)*glyph)]},getBoundingClientRect(){return this.getClientRects()[0]}}}};
 const textarea:any={ownerDocument:doc,style:{height:'117px'},value:draft,get clientWidth(){return Math.round(width+12)},get offsetWidth(){return Math.round(width+12)},clientHeight:117,selectionStart:draft.length,selectionEnd:draft.length,selectionDirection:'forward',scrollLeft:0,scrollTop:70};
 return{textarea,css,doc,mirror:()=>mirror,textNode:()=>node,setWidth(value:number){width=value;css.width=`${width+12}px`},setGlyph(value:number){glyph=value},nativeRows:()=>positions(draft,width,glyph).rows};
}

test('156-character portrait repro crosses a 0.047px width rounding boundary by two full lines',()=>{
 assert.equal(draft.length,156);assert.equal(threshold,252.041015625);
 const contentWidth=264.046875-12;
 assert.equal(positions(draft,contentWidth).rows.length,13);
 assert.equal(positions(draft,Math.round(contentWidth+12)-12).rows.length,15);
 const {textarea}=fixture(contentWidth),before=JSON.stringify([textarea.value,textarea.selectionStart,textarea.selectionEnd,textarea.scrollTop]);
 const display=captureNativeInputDisplay(textarea,scale);
 assert.equal(display.lines.length,13);assert.equal(display.caret.y*scale,6+12*35);
 assert.ok(Math.abs(display.width*scale-(contentWidth+12))<1e-9);
 assert.equal(display.scrollTop*scale,70);assert.equal(display.text,draft);
 assert.equal(JSON.stringify([textarea.value,textarea.selectionStart,textarea.selectionEnd,textarea.scrollTop]),before);
 releaseNativeInputDisplay(textarea);
});
for(const delta of[-.01,.01])test(`fractional threshold ${delta>0?'+':''}${delta}px controls wraps and caret, including a sub-clientWidth resize`,()=>{
 const f=fixture(threshold+delta),a=captureNativeInputDisplay(f.textarea,scale);
 assert.equal(a.lines.length,delta<0?15:13);assert.equal(a.caret.y*scale,6+(a.lines.length-1)*35);
 const rounded=f.textarea.clientWidth;f.setWidth(threshold-delta);assert.equal(f.textarea.clientWidth,rounded);
 const b=captureNativeInputDisplay(f.textarea,scale);assert.equal(b.lines.length,delta<0?13:15);
 assert.equal(b.caret.y*scale,6+(b.lines.length-1)*35);
 releaseNativeInputDisplay(f.textarea);
});
test('font invalidation, native selection and scroll remain authoritative at fractional widths',()=>{
 const f=fixture(threshold+.01);assert.equal(captureNativeInputDisplay(f.textarea).lines.length,13);
 f.setGlyph(advance+.001);invalidateNativeInputDisplay(f.textarea);
 const swapped=captureNativeInputDisplay(f.textarea);assert.equal(swapped.lines.length,15);
 f.textarea.selectionStart=0;f.textarea.selectionEnd=5;f.textarea.selectionDirection='backward';f.textarea.scrollTop=35;
 const selected=captureNativeInputDisplay(f.textarea);assert.equal(selected.caret.y,6);assert.equal(selected.selection.length,1);assert.equal(selected.scrollTop,35);assert.equal(selected.text,draft);
 assert.equal(inputViewportPlan(selected,117,0,350,false).scrollTop,350);
 assert.equal(inputViewportPlan(selected,117,0,350,true).scrollTop,6);
 releaseNativeInputDisplay(f.textarea);
});
test('content box conversion subtracts only the textarea own padding, border and scrollbar',()=>{
 const f=fixture(threshold+.01),e=f.textarea,css=f.css;
 assert.equal(nativeInputContentWidth(e,css),threshold+.01);
 css.boxSizing='content-box';css.width=`${threshold+.01}px`;assert.equal(nativeInputContentWidth(e,css),threshold+.01);
 css.boxSizing='border-box';css.width=`${threshold+16+.01}px`;css.borderLeftWidth=css.borderRightWidth='2px';assert.equal(nativeInputContentWidth(e,css),threshold+.01);
 css.width='auto';assert.equal(nativeInputContentWidth(e,css),e.clientWidth-12);
 css.width='300.125px';css.overflowY='auto';css.scrollbarWidth='thin';const gutterElement={clientWidth:286,offsetWidth:300} as HTMLTextAreaElement;
 assert.equal(nativeInputContentWidth(gutterElement,css),274.125);
});

test('height-induced outer scrollbar remeasures fractional wraps before returning the same frame',()=>{
 const f=fixture(threshold+.01+10);let cssHeight='117px',heightWrites=0;
 Object.defineProperty(f.textarea.style,'height',{get:()=>cssHeight,set:(value:string)=>{cssHeight=value;heightWrites++;if(Number.parseFloat(value)>117)f.setWidth(threshold+.01)}});
 const viewport={clientHeight:117,clientWidth:Math.round(threshold+.01+12),scrollTop:0,scrollLeft:0} as HTMLDivElement;
 const actual=syncInputViewport(f.textarea,viewport,undefined,1,true);
 assert.equal(actual.lines.length,13);assert.equal(actual.caret.y,426);assert.equal(actual.width,threshold+.01+12);
 assert.ok(actual.caret.y>=actual.scrollTop&&actual.caret.y+actual.caret.h<=actual.scrollTop+actual.height);
 assert.equal(f.textarea.scrollTop,0);assert.ok(heightWrites<=3);assert.equal(actual.reference,undefined);
 assert.equal(f.textarea.value,draft);assert.equal(f.textarea.selectionStart,156);
 releaseNativeInputDisplay(f.textarea);
});
test('hidden live and recorded Canvas project the same fractional line, glyph and caret geometry',()=>{
 const f=fixture(threshold+.01),display=captureNativeInputDisplay(f.textarea,scale),card=inputCardGeometry(responsiveLayout(true),{cssScale:scale});
 const draw=(recording:boolean)=>{const c=createCanvas(430,1200).getContext('2d'),labels:any[]=[],rects:any[]=[];
  c.fillText=((text:string,x:number,y:number)=>{labels.push({text,x,y})}) as typeof c.fillText;
  c.fillRect=((...args:number[])=>{rects.push(args)}) as typeof c.fillRect;
  paintInputText(c as unknown as CanvasRenderingContext2D,card,{draft,nativeInputDisplay:{...display,scrollTop:display.caret.y-card.input.h+display.caret.h},scrollLeft:0,caret:156,selectionEnd:156,inputFocused:true,composition:false,reducedMotion:true,renderTime:0,recording});return{labels,rects}};
 assert.deepEqual(draw(false),draw(true));assert.ok(draw(false).labels.some(x=>x.text.includes('editable.x')));
 assert.equal(f.textarea.value,draft);assert.equal(f.textarea.selectionStart,156);releaseNativeInputDisplay(f.textarea);
});
test('fractional measurement does not modify an in-progress native composition or its selection',()=>{
 const f=fixture(threshold+.01);f.textarea.value='拼音输入';f.textarea.selectionStart=1;f.textarea.selectionEnd=3;f.textarea.isComposing=true;
 const before=[f.textarea.value,f.textarea.selectionStart,f.textarea.selectionEnd,f.textarea.isComposing];
 const display=captureNativeInputDisplay(f.textarea);assert.equal(display.text,'拼音输入');
 assert.deepEqual([f.textarea.value,f.textarea.selectionStart,f.textarea.selectionEnd,f.textarea.isComposing],before);releaseNativeInputDisplay(f.textarea);
});

test('bounded settling returns guide and caret scroll from the final captured width',()=>{
 const f=fixture(350),widths=[300,270,threshold+.01];let cssHeight='117px',writes=0;
 Object.defineProperty(f.textarea.style,'height',{get:()=>cssHeight,set:(value:string)=>{cssHeight=value;f.setWidth(widths[Math.min(writes++,widths.length-1)])}});
 const viewport={clientHeight:117,clientWidth:362,scrollTop:0,scrollLeft:0} as HTMLDivElement;
 const display=syncInputViewport(f.textarea,viewport,undefined,1,true);
 assert.equal(display.width,threshold+.01+12);assert.equal(display.lines.length,13);assert.equal(display.caret.y,426);
 assert.equal(Number.parseFloat(cssHeight),inputViewportPlan(display,117,0,0,true).contentHeight);
 assert.ok(display.caret.y>=display.scrollTop&&display.caret.y+display.caret.h<=display.scrollTop+display.height);
 assert.ok(writes<=4,'three width-settling passes plus final matching projection');releaseNativeInputDisplay(f.textarea);
});


for(const referenceVisible of[false,true])test(`joint saved 156-character restore, fractional capture and Below-only keyboard preserve editing facts: reference ${referenceVisible}`,async t=>{
 const indexedDB=new IDBFactory(),dbName=`joint-final-typing-${crypto.randomUUID()}`,repository=new IndexedDBTrainingRepository({indexedDB,dbName}),history=new TrainingHistoryRecorder(repository),engine=new TrainingEngine();
 const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}};
 const binding=bindTrainingTabRecovery({storage:()=>storage,repository,history,snapshot:()=>engine.getSnapshot(),isCurrent:()=>true,onError:()=>assert.fail('Working tab storage must not fail')});
 t.after(async()=>{binding.dispose();history.dispose();await repository.close()});
 engine.input(engine.cue.text);engine.submit();engine.nextCue();history.connect(engine.getSnapshot(),{state:'legacy-default',generation:0});engine.input(draft);history.observe(engine.getSnapshot());saveReferenceVisibility(storage,referenceVisible);await history.flush();
 const saved=engine.getSnapshot(),locator=binding.read(),reader=new IndexedDBTrainingRepository({indexedDB,dbName});t.after(()=>reader.close());
 const boot=await readDefaultCourseBootstrap(reader,null,null,binding.read);assert.deepEqual(boot.saved,saved);assert.equal(readReferenceVisibility(storage),referenceVisible);
 const restored=new TrainingEngine({snapshot:boot.saved!,restoredReadOnly:true}),before=JSON.stringify(restored.getSnapshot());assert.equal(restored.isPassiveRestored,true);assert.equal(restored.draft.length,156);assert.equal(restored.getSnapshot().attempts.length,1);
 const base=responsiveLayout(false),options={cssWidth:640,keyboardPlacement:'below' as const,availableHeight:720};
 const hidden=learningGeometry(base,{...options,keyboardVisible:false}),below=learningGeometry(base,{...options,keyboardVisible:true});
 assert.deepEqual(below.inputCard.input,hidden.inputCard.input);assert.deepEqual(below.player,hidden.player);assert.ok(below.inputCard.keyboard!.y>=hidden.height);assert.ok(below.height>hidden.height);
 const f=fixture(threshold+.01);f.textarea.value=restored.draft;const viewport={clientHeight:117,clientWidth:Math.round(threshold+.01+12),scrollTop:0,scrollLeft:0} as HTMLDivElement;
 const display=syncInputViewport(f.textarea,viewport,undefined,1,true,referenceVisible?restored.cue.text:undefined);
 assert.equal(display.lines.length,13);assert.equal(display.caret.y,426);assert.equal(display.text,restored.draft);assert.equal(display.reference!==undefined,referenceVisible);
 const draw=(card:typeof hidden.inputCard,recording:boolean)=>{const c=createCanvas(base.width,below.height).getContext('2d'),labels:any[]=[],rects:any[]=[];c.fillText=((text:string,x:number,y:number)=>labels.push({text,x,y}))as typeof c.fillText;c.fillRect=((...args:number[])=>rects.push(args))as typeof c.fillRect;
  paintInputText(c as unknown as CanvasRenderingContext2D,card,{draft:restored.draft,nativeInputDisplay:display,referenceGuide:referenceVisible?restored.cue.text:undefined,scrollLeft:0,caret:156,selectionEnd:156,inputFocused:true,composition:false,reducedMotion:true,renderTime:0,recording});return{labels,rects}};
 assert.deepEqual(draw(hidden.inputCard,false),draw(below.inputCard,false));assert.deepEqual(draw(below.inputCard,false),draw(below.inputCard,true));
 assert.equal(f.textarea.value,restored.draft);assert.equal(f.textarea.selectionStart,156);assert.equal(f.textarea.selectionEnd,156);assert.equal(JSON.stringify(restored.getSnapshot()),before);assert.equal(restored.isPassiveRestored,true);assert.deepEqual(binding.read(),locator);assert.deepEqual((await reader.loadHistorySession(saved.sessionId))!.snapshot,saved);releaseNativeInputDisplay(f.textarea);
});

test('used DOMRect width preserves the 1/64px unit lost by computed-style serialization',()=>{
 const f=fixture(252.03125);f.css.width='264.031px';f.textarea.getBoundingClientRect=()=>({width:264.03125});
 assert.equal(nativeInputContentWidth(f.textarea,f.css),252.03125);
 for(const sceneScale of[.35,300/430,1,1.5]){
  const display=captureNativeInputDisplay(f.textarea,sceneScale);
  assert.ok(Math.abs(display.width*sceneScale-264.03125)<1e-9,'rect is CSS border-box width; sceneScale is applied only to the final projection');
 }
 // Real Chrome fixture: assigning 252.031px back to a mirror floors it to
 // 252.015625px; 252.03125px keeps the original native layout unit exactly.
 const blinkUsed=(width:number)=>Math.floor(width*64)/64;
 assert.equal(blinkUsed(252.031),252.015625);assert.equal(blinkUsed(nativeInputContentWidth(f.textarea,f.css)),252.03125);
 releaseNativeInputDisplay(f.textarea);
});
test('DOMRect refinement handles both box models, borders and only the native own scrollbar',()=>{
 const f=fixture(252.03125);f.textarea.getBoundingClientRect=()=>({width:264.03125});f.css.width='252.031px';f.css.boxSizing='content-box';
 assert.equal(nativeInputContentWidth(f.textarea,f.css),252.03125);
 f.css.boxSizing='border-box';f.css.borderLeftWidth=f.css.borderRightWidth='2px';f.css.width='268.031px';f.textarea.getBoundingClientRect=()=>({width:268.03125});
 assert.equal(nativeInputContentWidth(f.textarea,f.css),252.03125);
 f.css.borderLeftWidth=f.css.borderRightWidth='0px';f.css.width='274.031px';f.css.overflowY='auto';f.css.scrollbarWidth='thin';
 const e={clientWidth:264,offsetWidth:274,getBoundingClientRect:()=>({width:274.03125})} as HTMLTextAreaElement;
 assert.equal(nativeInputContentWidth(e,f.css),252.03125,'10px own gutter deducted once');
 f.css.overflowY='hidden';f.css.width='264.031px';f.textarea.getBoundingClientRect=()=>({width:264.03125});
 assert.equal(nativeInputContentWidth(f.textarea,f.css),252.03125,'outer gutter is already reflected by textarea width');
});
test('missing, invalid and materially transformed visual bounds retain the CSS layout fallback',()=>{
 const f=fixture(252.03125);f.css.width='264.031px';
 for(const width of[0,Number.NaN,Infinity,132.015625,528.0625,300]){
  f.textarea.getBoundingClientRect=()=>({width});assert.equal(nativeInputContentWidth(f.textarea,f.css),252.031);
 }
 delete f.textarea.getBoundingClientRect;assert.equal(nativeInputContentWidth(f.textarea,f.css),252.031);
});
test('precision refinement never pads the content width to force a word to fit',()=>{
 const f=fixture(252.03125);
 for(const width of[263.984375,264,264.015625,264.03125,264.046875]){
  f.css.width=`${Number(width.toPrecision(6))}px`;f.textarea.getBoundingClientRect=()=>({width});
  assert.equal(nativeInputContentWidth(f.textarea,f.css),width-12);
 }
});

test('wide editor refinement respects six-significant-digit CSSOM serialization',()=>{
 const f=fixture(252.03125);
 for(const width of[1030.03125,1102.046875,2644.03125,9999.984375]){
  f.css.width=`${Number(width.toPrecision(6))}px`;f.textarea.getBoundingClientRect=()=>({width});
  assert.equal(nativeInputContentWidth(f.textarea,f.css),width-12);
  f.textarea.getBoundingClientRect=()=>({width:width*1.1});
  assert.equal(nativeInputContentWidth(f.textarea,f.css),Number.parseFloat(f.css.width)-12,'scaled visual bounds still fall back');
 }
});


test('a shortened cached mirror is reconstructed from the complete unchanged native draft before reading Range offsets',()=>{
 const f=fixture(threshold+.01),first=captureNativeInputDisplay(f.textarea,scale),before=JSON.stringify([f.textarea.value,f.textarea.selectionStart,f.textarea.selectionEnd,f.textarea.scrollTop]);
 f.textNode().data='h';
 const repaired=captureNativeInputDisplay(f.textarea,scale);
 assert.equal(repaired.text,draft);assert.deepEqual(repaired.lines,first.lines);assert.equal(f.textNode().data,draft);assert.equal(JSON.stringify([f.textarea.value,f.textarea.selectionStart,f.textarea.selectionEnd,f.textarea.scrollTop]),before);releaseNativeInputDisplay(f.textarea);
});

for(const [label,mutate] of Object.entries({
 'same-length translation':(f:ReturnType<typeof fixture>)=>{f.textNode().data='x'.repeat(f.textNode().length)},
 'shortened text':(f:ReturnType<typeof fixture>)=>{f.textNode().data=''},
 'split text':(f:ReturnType<typeof fixture>)=>{const node=f.textNode(),tail=f.doc.createTextNode(node.data.slice(1));node.data=node.data.slice(0,1);f.mirror().replaceChildren(node,tail,f.mirror().childNodes[1])},
 'replacement text':(f:ReturnType<typeof fixture>)=>{f.mirror().replaceChildren(f.doc.createTextNode('译文'))},
 'wrapped text':(f:ReturnType<typeof fixture>)=>{const wrapper=f.doc.createElement('font');wrapper.append(f.textNode());f.mirror().append(wrapper)},
 'extra child':(f:ReturnType<typeof fixture>)=>{f.mirror().append(f.doc.createElement('br'))},
 'removed mirror':(f:ReturnType<typeof fixture>)=>{f.mirror().remove()},
 'reparented mirror':(f:ReturnType<typeof fixture>)=>{const parent=f.doc.createElement('section');f.doc.body.appendChild(parent);parent.append(f.mirror())},
 'baseline text':(f:ReturnType<typeof fixture>)=>{f.mirror().childNodes[1].textContent='translated'},
 'empty baseline child':(f:ReturnType<typeof fixture>)=>{f.mirror().childNodes[1].append(f.doc.createElement('br'))},
}))for(const value of[draft,'','hello\n','😀 e\u0301 中文'])test(`native mirror repairs ${label} with exact ${value===draft?'long':JSON.stringify(value)} UTF-16 content`,()=>{
 const f=fixture(threshold+.01);f.textarea.value=value;f.textarea.selectionStart=value.length;f.textarea.selectionEnd=value.length;
 const before=[f.textarea.value,f.textarea.selectionStart,f.textarea.selectionEnd,f.textarea.scrollTop],first=captureNativeInputDisplay(f.textarea,scale),node=f.textNode();
 mutate(f);const next=captureNativeInputDisplay(f.textarea,scale);assert.deepEqual(next,first);assert.deepEqual(captureNativeInputDisplay(f.textarea,scale),first,'unchanged subsequent frame reuses the repaired cache');
 assert.equal(node.data,value?value+(value.endsWith('\n')?'\u200b':''):'\u200b');assert.equal(f.mirror().parentNode,f.doc.body);assert.equal(node.parentNode,f.mirror());assert.equal(f.mirror().childNodes.length,2);assert.equal(f.mirror().childNodes[1].childNodes.length,0);
 assert.deepEqual([f.textarea.value,f.textarea.selectionStart,f.textarea.selectionEnd,f.textarea.scrollTop],before);releaseNativeInputDisplay(f.textarea);
});
