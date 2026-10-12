import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {captureNativeInputDisplay,inputCardGeometry,paintInputText,releaseNativeInputDisplay,syncInputViewport,visualSegments,wrapInputText,type NativeInputDisplay} from './input-card';
import {responsiveLayout} from './responsive-layout';
import {TrainingEngine} from '../core/training';

const longCue='My name is Ranger Connie and I am reporting live from the South Rim of the Grand Canyon. There are many spectacular viewpoints along this trail. Please remember to bring drinking water and enjoy the view.';
/** Deterministic DOM Range fixture: native word-wrap positions, in CSS pixels. */
function editor(width:number,value='',scale=1){
 const glyph=16.8,lineHeight=35,padding=6,measure=(text:string)=>visualSegments(text).length*glyph;
 let node:any,mirror:any,pointsText:string|undefined,pointsCache:{x:number;y:number}[]=[];
 const points=()=>{
  if(pointsText===node.data)return pointsCache;
  const text=node.data,rows=wrapInputText(text,width-padding*2,measure),result:{x:number;y:number}[]=[];
  for(const [row,line] of rows.entries())for(let i=line.start;i<=line.end;i++)result[i]={x:padding+measure(text.slice(line.start,i)),y:padding+row*lineHeight};
  pointsText=text;pointsCache=result;return result;
 };
 const rect=(x:number,y:number,w=0,h=32)=>({x,y,left:x,top:y,width:w,height:h,right:x+w,bottom:y+h});
 const detach=(item:any)=>{const parent=item.parentNode;if(parent){const i=parent.childNodes.indexOf(item);if(i>=0)parent.childNodes.splice(i,1)}item.parentNode=null};
 const replace=(item:any,children:any[])=>{for(const child of [...item.childNodes])detach(child);for(const child of children){detach(child);item.childNodes.push(child);child.parentNode=item}};
 const body:any={childNodes:[],appendChild(item:any){detach(item);this.childNodes.push(item);item.parentNode=this}};
 const css:any={width:`${width}px`,boxSizing:'border-box',borderLeftWidth:'0px',borderRightWidth:'0px',overflowY:'hidden',scrollbarWidth:'none',fontFamily:'monospace',fontSize:'28px',fontWeight:'400',fontStyle:'normal',lineHeight:`${lineHeight}px`,paddingLeft:'6px',paddingRight:'6px',paddingTop:'6px',paddingBottom:'6px',letterSpacing:'0px',getPropertyValue:()=> '6px'};
 const doc:any={body,defaultView:{getComputedStyle:()=>css},createTextNode(data:string){return{data,parentNode:null,get length(){return this.data.length}}},createElement(tag:string){
  if(tag==='canvas')return{getContext:()=>({measureText:(text:string)=>({width:measure(text)/scale})})};
  const item:any={style:{},childNodes:[],parentNode:null,setAttribute(){},get isConnected(){return this.parentNode===body},get textContent(){return this.childNodes.map((c:any)=>c.data??c.textContent).join('')},set textContent(value:string){replace(this,value?[doc.createTextNode(value)]:[])},append(...children:any[]){replace(this,[...this.childNodes,...children]);if(tag==='div'&&!node)node=children[0]},replaceChildren(...children:any[]){replace(this,children)},remove(){detach(this)},getBoundingClientRect(){if(tag==='span'){const p=points()[node.data.length-1];return rect(0,p.y+26,0,0)}return rect(0,0,width,600)}};
  if(tag==='div')mirror=item;return item;
 },createRange(){let a=0,b=0;const check=(n:any,i:number)=>{assert.ok(i>=0&&i<=n.length,'Range always addresses the complete native text')};return{setStart(n:any,i:number){check(n,i);a=i},setEnd(n:any,i:number){check(n,i);b=i},collapse(){b=a},getClientRects(){const ps=points(),p=ps[a];return p?[rect(p.x,p.y,measure(node.data.slice(a,b)))]:[]},getBoundingClientRect(){return this.getClientRects()[0]}}}};
 const textarea:any={ownerDocument:doc,style:{height:'117px'},value,clientWidth:Math.round(width),offsetWidth:Math.round(width),getBoundingClientRect:()=>({width}),get clientHeight(){return parseFloat(this.style.height)},selectionStart:value.length,selectionEnd:value.length,selectionDirection:'forward',scrollTop:0,scrollLeft:0};
 const viewport:any={clientHeight:117,clientWidth:width,scrollTop:0,scrollLeft:0,style:{}};
 const sync=(reference?:string,portrait=true)=> (syncInputViewport as (...args:any[])=>NativeInputDisplay)(textarea,viewport,undefined,scale,false,reference,portrait);
 const move=(start:number,end=start,direction='forward')=>{textarea.selectionStart=start;textarea.selectionEnd=end;textarea.selectionDirection=direction};
 return{textarea,viewport,css,sync,move,mirror:()=>mirror,textNode:()=>node,dispose:()=>releaseNativeInputDisplay(textarea)};
}
function page(display:NativeInputDisplay){return (display as NativeInputDisplay&{window?:{firstLine:number;lineCount:number;clipTop:number;clipBottom:number}}).window}

for(const width of[320,360,390,430,485])test(`portrait ${width}px shows exactly three whole wrapped rows without a manual input scroll`,()=>{
 const e=editor(width);e.viewport.scrollTop=75;e.viewport.scrollLeft=12;e.textarea.scrollLeft=7;
 const display=e.sync(longCue);
 assert.equal(display.scrollTop,0,'empty native caret chooses first page regardless of manual scroll');
 assert.equal(display.scrollLeft,0);assert.equal(e.textarea.scrollLeft,0);
 assert.deepEqual(page(display),{firstLine:0,lineCount:3,clipTop:6,clipBottom:111});
 assert.equal(display.text,'');assert.equal(e.textarea.value,'');assert.equal(display.reference?.text,longCue);
 assert.ok(display.reference!.lines.length>3,'complete reference projection is retained beyond the page');
 assert.equal(e.textNode().data,'\u200b');e.dispose();
});

test('a long draft advances at native row boundaries and selection/backspace moves to prior pages',()=>{
 const e=editor(320,longCue),before=[e.textarea.value,e.textarea.selectionStart,e.textarea.selectionEnd];
 let display=e.sync(longCue);assert.deepEqual([e.textarea.value,e.textarea.selectionStart,e.textarea.selectionEnd],before);
 const rows=display.lines;
 for(const index of[0,1,2,3,4,5,6,rows.length-1,5,2,0]){
  e.move(rows[index].start+1);display=e.sync(longCue);
  assert.equal(page(display)?.firstLine,Math.floor(index/3)*3);assert.equal(display.scrollTop,Math.floor(index/3)*105);
  assert.ok(display.caret.y-display.scrollTop>=6);assert.ok(display.caret.y+display.caret.h-display.scrollTop<=111);
 }
 e.move(rows[1].start+1,rows[7].start+1,'forward');assert.equal(page(e.sync(longCue))?.firstLine,6);
 e.move(rows[1].start+1,rows[7].start+1,'backward');assert.equal(page(e.sync(longCue))?.firstLine,0);
 e.textarea.value=longCue.slice(0,rows[3].start-1);e.move(e.textarea.value.length);display=e.sync(longCue);assert.equal(page(display)?.firstLine,0,'backspace before page boundary restores prior page');
 assert.equal(display.text,e.textarea.value);assert.equal(e.textNode().data,e.textarea.value);e.dispose();
});

test('partial final words never reflow any already typed native row, including page boundaries',()=>{
 const e=editor(320);
 for(let length=1;length<longCue.length;length++){
  e.textarea.value=longCue.slice(0,length);e.move(length);
  const native=captureNativeInputDisplay(e.textarea),display=e.sync(longCue);
  assert.deepEqual(display.lines,native.lines);assert.deepEqual(display.caret,native.caret);assert.equal(display.text,longCue.slice(0,length));
  assert.ok(display.caret.y-display.scrollTop>=6);assert.ok(display.caret.y+display.caret.h-display.scrollTop<=111);
 }
 e.dispose();
});

for(const value of['','\n','a\n\n','👩‍💻 e\u0301 中文\n🐈 jump\nnext\nlast','a'.repeat(180)])test(`Unicode, empty, newline and long-word draft ${JSON.stringify(value.slice(0,20))} keeps full UTF-16 native editing value`,()=>{
 const e=editor(320,value),before=[value,e.textarea.selectionStart,e.textarea.selectionEnd];
 const display=e.sync(longCue);assert.deepEqual([e.textarea.value,e.textarea.selectionStart,e.textarea.selectionEnd],before);
 assert.equal(display.text,value);assert.equal(e.textNode().data,value?value+(value.endsWith('\n')?'\u200b':''):'\u200b');
 assert.ok(Number.isFinite(display.scrollTop));assert.ok(page(display));
 assert.deepEqual(e.sync(longCue),display,'repeated unchanged capture is stable');e.dispose();
});

test('Hidden/listen/background projection has no reference or mask dependent page geometry',()=>{
 const e=editor(320,longCue.slice(0,130));e.move(80);
 const shown=e.sync('UNIQUE PRIVATE REFERENCE '.repeat(30)),hidden=e.sync();
 assert.equal(hidden.reference,undefined);assert.deepEqual(page(hidden),page(shown));assert.equal(hidden.scrollTop,shown.scrollTop);
 assert.equal(hidden.text,e.textarea.value);assert.ok(!JSON.stringify(hidden).includes('UNIQUE PRIVATE'));
 assert.deepEqual(e.sync(),hidden);e.dispose();
});

test('last page reserves blank slots rather than clamping the native caret between clipped rows',()=>{
 const e=editor(320,'one\ntwo\nthree\nfour');const display=e.sync();
 assert.equal(display.scrollTop,105);assert.equal(page(display)?.firstLine,3);assert.ok(parseFloat(e.textarea.style.height)>=222);
 assert.equal(display.caret.y-display.scrollTop,6);e.dispose();
});

test('two-line windows and scaled capture use complete native row slots',()=>{
 const e=editor(390,longCue,.75);e.viewport.clientHeight=82;
 const display=e.sync(longCue);assert.equal(page(display)?.lineCount,2);
 assert.ok(Math.abs(display.scrollTop-page(display)!.firstLine*35/.75)<1e-9);assert.ok(display.caret.y-display.scrollTop>=6/.75);
 assert.ok(display.caret.y+display.caret.h-display.scrollTop<=76/.75);e.dispose();
});

test('the mobile page is a view-only projection with identical live/recorded drawing and unchanged attempt truth',()=>{
 const engine=new TrainingEngine();engine.input(longCue.slice(0,130));const before=JSON.stringify(engine.getSnapshot());
 const e=editor(320,engine.draft),display=e.sync(longCue),card=inputCardGeometry(responsiveLayout(true));card.input.w=320;card.input.h=117;
 const draw=(recording:boolean)=>{const c=createCanvas(430,1200).getContext('2d'),labels:any[]=[],rects:any[]=[],clips:any[]=[];c.fillText=((...args:any[])=>labels.push(args))as typeof c.fillText;c.fillRect=((...args:any[])=>rects.push(args))as typeof c.fillRect;const original=c.rect.bind(c);c.rect=((...args:number[])=>{clips.push(args);original(...args as [number,number,number,number])})as typeof c.rect;
  paintInputText(c as unknown as CanvasRenderingContext2D,card,{draft:engine.draft,referenceGuide:longCue,nativeInputDisplay:display,scrollLeft:0,caret:engine.draft.length,selectionEnd:engine.draft.length,inputFocused:true,composition:false,reducedMotion:true,renderTime:0,recording});return{labels,rects,clips}};
 assert.deepEqual(draw(false),draw(true));assert.ok(draw(false).clips.some(r=>r[1]===card.input.y+6&&r[3]===105),'Canvas clips the same complete line slots as the native editor');
 assert.equal(JSON.stringify(engine.getSnapshot()),before);assert.equal(engine.getSnapshot().attempts.length,0);assert.equal(e.textarea.value,engine.draft);e.dispose();
});

test('desktop keeps its old continuous viewport unless the explicit portrait flag is set',()=>{
 const e=editor(320,longCue);e.viewport.scrollTop=47;const display=e.sync(undefined,false);
 assert.equal(display.scrollTop,47);assert.equal(page(display),undefined);e.dispose();
});

for(const padding of[6.2,6.349,7.895])test(`fractional viewport height preserves three complete native slots with ${padding}px padding`,()=>{
 const e=editor(390,longCue),usedHeight=Math.floor((35*3+padding*2)*64)/64;
 e.css.paddingTop=e.css.paddingBottom=`${padding}px`;e.viewport.clientHeight=Math.round(usedHeight);e.viewport.getBoundingClientRect=()=>({height:usedHeight});
 const display=e.sync(longCue);assert.equal(page(display)?.lineCount,3);assert.equal(display.height,usedHeight);
 assert.ok(Math.abs(page(display)!.clipBottom-(padding+105))<1e-9);e.dispose();
});
