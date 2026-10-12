import test from 'node:test';
import assert from 'node:assert/strict';
import {centeredInputPadding,submittedErrorRanges,syncNativeFeedback} from './input-card';
import {align,type Attempt} from '../core/training';
const attempt=(reference:string,answer:string)=>({...align(reference,answer),answer}) as Attempt;
test('shown whole-cue block is centered independently of the current typed prefix',()=>{
 const pad=centeredInputPadding(1000,12,'Hi, everybody.',s=>s.length*20);
 assert.equal(pad,360);for(const draft of['','H','Hi,','wrong input']){assert.equal(centeredInputPadding(1000,12,'Hi, everybody.',s=>s.length*20),pad);void draft}
 assert.equal(centeredInputPadding(1000,12,'long '.repeat(300),s=>s.length*20),12);
});
test('hidden centered region uses its full safe width without measuring a former answer',()=>{
 assert.equal(centeredInputPadding(1000,12,undefined,s=>{throw Error('must not measure a reference')}),12);
 assert.equal(centeredInputPadding(300,10,undefined,s=>{throw Error('must not measure a reference')}),10);
});
test('checked replacement and extra ranges match actual UTF16 text without scoring mutations',()=>{
 const a=attempt('Hi everybody','Hi, erverbody! extra');const before=JSON.stringify(a);
 assert.deepEqual(submittedErrorRanges(a,a.answer).map(r=>a.answer.slice(r.start,r.end)),['erverbody','extra']);
 assert.equal(JSON.stringify(a),before);assert.deepEqual(submittedErrorRanges(a,a.answer+'!'),[]);assert.deepEqual(submittedErrorRanges(null,a.answer),[]);
});
test('normalization and punctuation preserve native wrong-word geometry',()=>{
 const answer='Ｈｉ, 🌲 can’t!';const a=attempt('Hi will',answer);
 assert.deepEqual(submittedErrorRanges(a,answer).map(r=>answer.slice(r.start,r.end)),['can’t']);
});
test('missing words have no invented typed span and checked styling resets on edit',()=>{
 const a=attempt('Hi everybody','Hi');assert.deepEqual(submittedErrorRanges(a,'Hi'),[]);
 const wrong=attempt('Hi everybody','Hi nobody'),element={value:wrong.answer,style:{webkitTextFillColor:''},dataset:{}} as unknown as HTMLTextAreaElement;
 syncNativeFeedback(element,wrong);assert.equal(element.style.webkitTextFillColor,'transparent');element.value+='x';syncNativeFeedback(element,wrong);assert.equal(element.style.webkitTextFillColor,'#f4f6f5');
});
test('Canvas paints wrong submitted native spans red with a non-color wavy underline',async()=>{
 const {createCanvas}=await import('@napi-rs/canvas'),{paintInputText,inputCardGeometry}=await import('./input-card'),{responsiveLayout}=await import('./responsive-layout');
 const ctx=createCanvas(1672,1500).getContext('2d'),labels:{text:string;color:string}[]=[],original=ctx.fillText.bind(ctx),a=attempt('Hi everybody','Hi nobody');
 ctx.fillText=((text:string,x:number,y:number)=>{labels.push({text,color:String(ctx.fillStyle)});original(text,x,y)})as typeof ctx.fillText;
 const display={text:a.answer,lines:[{start:0,end:9,text:a.answer,x:200,y:8,width:180,height:40,baseline:38}],selection:[],caret:{x:380,y:8,w:1,h:40},scrollLeft:0,scrollTop:0,width:800,height:100,font:'400 24px monospace',letterSpacing:0,lineHeight:40,paddingX:200,paddingY:8};
 const state={draft:a.answer,checkedAttempt:a,nativeInputDisplay:display,scrollLeft:0,caret:9,selectionEnd:9,inputFocused:false,composition:false,reducedMotion:true,renderTime:0};
 paintInputText(ctx as unknown as CanvasRenderingContext2D,inputCardGeometry(responsiveLayout(false)),state);
 assert.ok(labels.some(x=>x.text==='nobody'&&x.color==='#ff858b'));assert.ok(labels.some(x=>x.text==='Hi '&&x.color==='#f4f6f5'));
 labels.length=0;paintInputText(ctx as unknown as CanvasRenderingContext2D,inputCardGeometry(responsiveLayout(false)),{...state,checkedAttempt:null});assert.ok(labels.every(x=>x.color==='#f4f6f5'));
});
