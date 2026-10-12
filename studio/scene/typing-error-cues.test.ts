import test from 'node:test';import assert from 'node:assert/strict';
import {hasNewTypingError,typingErrorShakeOffset,TYPING_ERROR_SHAKE_MS,type TypingErrorEdit} from './typing-error-cues';
import {CompositionInputTail} from '../core/native-input-evidence';
import {TrainingEngine,type Material} from '../core/training';
const edit=(before:string,after:string,patch:Partial<TypingErrorEdit>={})=>hasNewTypingError({before,after,reference:'Hello world',trusted:true,kind:'input',inputType:'insertText',...patch});
test('new wrong insertion cues; correct prefix and old wrong letters do not',()=>{
 assert.equal(edit('H','Hx'),true);assert.equal(edit('H','He'),false);assert.equal(edit('Hx','Hxe'),false);
 assert.equal(edit('Hx','Hx'),false);assert.equal(edit('Hx','Hy'),true);assert.equal(edit('H','Hx'),true);
 assert.equal(edit('Hello','Hxello'),true);assert.equal(edit('Hxello','Hello',{inputType:'deleteContentBackward'}),false);
 assert.equal(edit('Hello','Hello x'),true);
});
test('hidden, composing, paste, undo, drop, replacement/autocorrect and synthetic events never cue',()=>{
 for(const patch of [{reference:undefined},{composing:true},{trusted:false},{pasted:true},{inputType:'insertFromPaste'},{inputType:'insertFromDrop'},{inputType:'historyUndo'},{inputType:'deleteContentBackward'},{inputType:'insertReplacementText'},{inputType:'insertCompositionText'}])assert.equal(edit('H','Hx',patch),false,JSON.stringify(patch));
});
test('composition final emits once and same-task final input is consumed',()=>{
 assert.equal(edit('H','Hx',{kind:'compositionend',inputType:null}),true);
 const tail=new CompositionInputTail();tail.remember('Hx');assert.equal(tail.consume('Hx','insertFromComposition'),true);
 assert.equal(edit('Hx','Hx'),false);
 assert.equal(edit('H','Hx',{kind:'compositionend',inputType:null,pasted:true}),false);
});
test('normalization and native changed spans match existing letter feedback',()=>{
 assert.equal(edit('','Ｈｅｌｌｏ'),false);assert.equal(edit('','HELLO'),false);
 assert.equal(edit('','don’t',{reference:"don't"}),false);
 assert.equal(edit('H','H👋'),false);assert.equal(edit('','ﬁx',{reference:'fit'}),true);
 assert.equal(edit('','X'.repeat(8193)),false);
});
test('error feedback is read-only for attempts, scores and native draft',()=>{
 const material:Material={id:'errors',version:'1',title:'Errors',rights:'Original',cues:[{id:'a',start:0,end:5,text:'Hello world'}]},engine=new TrainingEngine({material});
 engine.input('Hx');const before=engine.getSnapshot(),json=JSON.stringify(before);
 for(let i=0;i<20;i++)edit('H',engine.draft);
 assert.equal(engine.getSnapshot(),before);assert.equal(JSON.stringify(engine.getSnapshot()),json);assert.equal(before.attempts.length,0);assert.equal(before.earnedWords,0);
});
test('small shake is bounded, finite, short and disabled for reduced motion or recording',()=>{
 for(let t=0;t<TYPING_ERROR_SHAKE_MS;t++)assert.ok(Math.abs(typingErrorShakeOffset(t,0,false))<=2);
 assert.notEqual(typingErrorShakeOffset(20,0,false),0);
 for(const t of [-1,180,181,Infinity,NaN])assert.equal(typingErrorShakeOffset(t,0,false),0);
 assert.equal(typingErrorShakeOffset(20,undefined,false),0);assert.equal(typingErrorShakeOffset(20,0,true),0);assert.equal(typingErrorShakeOffset(20,0,false,true),0);
});
test('actual Canvas moves only wrong glyphs, leaving correct text, ghost and native geometry fixed',async()=>{
 const {createCanvas}=await import('@napi-rs/canvas'),{paintInputText,inputCardGeometry}=await import('./input-card'),{responsiveLayout}=await import('./responsive-layout');
 const context=createCanvas(1672,1200).getContext('2d'),card=inputCardGeometry(responsiveLayout(false)),rows:{text:string;x:number;y:number;color:string}[]=[];
 const fill=context.fillText.bind(context);context.fillText=((text:string,x:number,y:number)=>{rows.push({text,x,y,color:String(context.fillStyle)});fill(text,x,y)})as typeof context.fillText;
 const state={draft:'Hx',referenceGuide:'Hello world',scrollLeft:0,caret:2,selectionEnd:2,inputFocused:true,composition:false,reducedMotion:false,renderTime:20,typingErrorAt:0};
 const draw=(patch:Partial<typeof state>&{recording?:boolean}={})=>{rows.length=0;paintInputText(context as unknown as CanvasRenderingContext2D,card,{...state,...patch});return rows.map(row=>({...row}))};
 const baseline=draw({typingErrorAt:undefined}),shaken=draw(),original=JSON.stringify(state);
 const wrong=baseline.find(row=>row.color==='#ff858b')!,moved=shaken.find(row=>row.color==='#ff858b')!;assert.ok(wrong&&moved);assert.notEqual(moved.x,wrong.x);assert.ok(Math.abs(moved.x-wrong.x)<=2/card.cssScale);assert.equal(moved.y,wrong.y);
 assert.deepEqual(shaken.filter(row=>row.color!=='#ff858b'),baseline.filter(row=>row.color!=='#ff858b'));assert.deepEqual(draw({recording:true}),baseline);assert.deepEqual(draw({reducedMotion:true}),baseline);assert.equal(JSON.stringify(state),original);
});
