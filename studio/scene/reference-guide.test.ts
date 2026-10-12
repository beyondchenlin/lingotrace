import test from 'node:test';
import assert from 'node:assert/strict';
import {TrainingEngine,getDraft,type Material} from '../core/training';
import {referenceGuideText,ReferenceGuideExposure,layoutReferenceRemainder,REFERENCE_DISCLOSURE_STORAGE_KEY} from './reference-guide';
const material:Material={id:'guide-qa',version:'1',title:'Guide QA',rights:'Original QA',cues:[{id:'a',text:'A cup please.',start:0,end:3},{id:'b',text:'Thank you.',start:3,end:6}]};
function engine(){let id=0;return new TrainingEngine({material,deferInitialPractice:true,clock:{now:()=>0,wallTime:()=>new Date(0).toISOString(),id:()=>`guide-${++id}`}})}
test('pale whole cue never enters actual draft; only corresponding graphemes are replaced',()=>{
 assert.equal(referenceGuideText('','A cup please.'),'A cup please.');assert.equal(referenceGuideText('A cu','A cup please.'),'A cup please.');assert.equal(referenceGuideText('X','A cup please.'),'X cup please.');assert.equal(referenceGuideText('extra typing','Hi'),'extra typing');
 assert.equal(referenceGuideText('👩‍💻','🧑‍💻 A'),'👩‍💻 A');assert.equal(referenceGuideText('e\u0301','a cup'),'e\u0301 cup');assert.equal(referenceGuideText('A\n','A cup'),'A\ncup');assert.equal(referenceGuideText('A','A cup please.'),'A cup please.');
});
test('painting reference only remembers exposure; no events, input, active time or score changes',()=>{
 const e=engine(),seen=new ReferenceGuideExposure(),before=e.getSnapshot();seen.observe(before);assert.equal(e.getSnapshot(),before);assert.equal(e.isAwaitingInitialInput,true);assert.equal(e.draft,'');assert.equal(before.earnedWords,0);assert.equal(seen.has(before),true);
});
test('hiding after exposure still marks the next actual attempt revealed, once',()=>{
 const e=engine(),seen=new ReferenceGuideExposure();seen.observe(e.getSnapshot());seen.apply(e,getDraft(e.getSnapshot()).revealed);e.input('A cup please.');seen.apply(e,getDraft(e.getSnapshot()).revealed);const result=e.submit()!;assert.equal(result.conditions.revealed,true);assert.equal(result.answer,'A cup please.');assert.equal(e.getSnapshot().events.filter(event=>event.type==='hintExposed').length,1);assert.equal(e.getSnapshot().attempts.length,1);
});
test('hidden unseen cue remains independent; exposure is isolated by cue and round identity',()=>{
 const e=engine(),seen=new ReferenceGuideExposure();seen.observe(e.getSnapshot());e.nextCue(1);seen.apply(e,getDraft(e.getSnapshot()).revealed);e.input('Thank you.');assert.equal(e.submit()!.conditions.revealed,false);e.resetSession();seen.apply(e,getDraft(e.getSnapshot()).revealed);assert.equal(getDraft(e.getSnapshot()).revealed,false);
});
test('restored preview is not activated or rewritten by default reference painting',()=>{
 const original=engine();original.input('A cup please.');original.submit();const saved=original.getSnapshot(),restored=new TrainingEngine({snapshot:saved,restoredReadOnly:true}),seen=new ReferenceGuideExposure();seen.observe(restored.getSnapshot());assert.equal(restored.isPassiveRestored,true);assert.deepEqual(restored.getSnapshot(),saved);assert.equal(saved.attempts[0].conditions.revealed,false);seen.apply(restored,getDraft(restored.getSnapshot()).revealed);restored.input('A cup please!');assert.equal(restored.submit()!.conditions.revealed,true);assert.equal(restored.getSnapshot().attempts[0].conditions.revealed,false);
});
test('actual Studio host records exposure only at real edit/submit boundaries and strips strict hidden guides',async()=>{
 const{readFile}=await import('node:fs/promises');const source=await readFile(new URL('../components/Studio.tsx',import.meta.url),'utf8');
 assert.match(source,/v\.referenceGuide=referenceVisibleRef\.current&&!document\.hidden[^;]*activeListening\?\.mode!=='listen'/);
 assert.match(source,/if\(v\.referenceGuide&&!referenceExposureRef\.current\.observe\(e\.getSnapshot\(\)\)\)v\.referenceGuide=undefined/);
 assert.match(source,/applyReferenceGuideExposure\(\);engineRef\.current\?\.input/);assert.match(source,/applyReferenceGuideExposure\(\);engineRef\.current\?\.beginComposition/);assert.match(source,/applyReferenceGuideExposure\(\);const listeningCapture/);
 const drawStart=source.indexOf('const draw=(_rafTime'),drawEnd=source.indexOf('const frameLoop=startSceneFrameLoop',drawStart);assert.ok(drawStart>=0&&drawEnd>drawStart);const draw=source.slice(drawStart,drawEnd);assert.doesNotMatch(draw,/exposeHint\(|applyReferenceGuideExposure\(/);assert.match(source,/v\.inputGuide=referenceVisibleRef\.current/);
});

test('Canvas guide stays pale while typed feedback is purely visual and respects measured native wrapping/scroll',async()=>{
 const{createCanvas}=await import('@napi-rs/canvas'),{paintInputText,inputCardGeometry}=await import('./input-card'),{responsiveLayout}=await import('./responsive-layout');
 const card=inputCardGeometry(responsiveLayout(false)),context=createCanvas(1700,1100).getContext('2d'),drawn:{text:string;x:number;y:number;color:unknown}[]=[],fill=context.fillText.bind(context);
 context.fillText=((text:string,x:number,y:number)=>{drawn.push({text,x,y,color:context.fillStyle});fill(text,x,y)}) as typeof context.fillText;
 const state={draft:'X',referenceGuide:'A cup',nativeInputDisplay:{text:'X',lines:[{start:0,end:1,text:'X',x:12,y:8,width:20,height:40,baseline:38}],selection:[],caret:{x:32,y:8,w:1,h:40},scrollLeft:0,scrollTop:0,width:card.input.w,height:card.input.h,font:'400 34px monospace',letterSpacing:0,lineHeight:44,paddingX:12,paddingY:8,reference:{text:'X cup',lines:[{start:1,end:5,text:' cup',x:32,y:8,width:80,height:40,baseline:38}]}},scrollLeft:0,caret:1,selectionEnd:1,inputFocused:false,composition:false,reducedMotion:true,renderTime:0};
 const before=JSON.stringify(state);paintInputText(context as unknown as CanvasRenderingContext2D,card,state);assert.equal(JSON.stringify(state),before);assert.ok(drawn.some(run=>run.text===' cup'&&run.color==='#b7c6c1'));assert.ok(drawn.some(run=>run.text==='X'&&run.color==='#ff858b'));assert.ok(!drawn.some(run=>run.text==='A cup'));assert.equal(drawn.find(run=>run.text===' cup')!.y,drawn.find(run=>run.text==='X')!.y);
 drawn.length=0;paintInputText(context as unknown as CanvasRenderingContext2D,card,{...state,referenceGuide:undefined});assert.deepEqual(drawn.map(run=>run.text),['X']);
});

test('partial-word wrapping continues at the actual native end, without moving typed prefix',()=>{
 const lines=[{start:0,end:10,text:'123456 abc',x:0,y:0,width:10,height:1,baseline:.8}];
 const guide=layoutReferenceRemainder('123456 abc','123456 abcdef',{lines,width:11,paddingX:0,paddingY:0,lineHeight:1},text=>text.length);
 assert.deepEqual(guide.map(({text,x,y})=>({text,x,y})),[{text:'d',x:10,y:0},{text:'ef',x:0,y:1}]);assert.equal(guide.map(line=>line.text).join(''),'def');
});
function tabStore(){const values=new Map<string,string>();return{values,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)},removeItem:(key:string)=>{values.delete(key)}}}
test('seen then hidden then refresh retains exact-cue assisted exposure without any fake edit',()=>{
 const e=engine(),storage=tabStore(),first=new ReferenceGuideExposure();first.attach(storage);assert.equal(first.observe(e.getSnapshot()),true);assert.ok(!storage.values.get(REFERENCE_DISCLOSURE_STORAGE_KEY)!.includes('A cup'));
 const restored=new ReferenceGuideExposure();restored.attach(storage);assert.equal(e.draft,'');assert.equal(e.getSnapshot().attempts.length,0);restored.apply(e,false);e.input('A cup please.');assert.equal(e.submit()!.conditions.revealed,true);
});
test('privacy OFF clears the pending marker; current exposure stays in memory and a new round is isolated',()=>{
 const e=engine(),storage=tabStore(),seen=new ReferenceGuideExposure();seen.attach(storage);seen.observe(e.getSnapshot());seen.setPersistence(false);assert.equal(storage.values.size,0);seen.observe(e.getSnapshot());assert.equal(storage.values.size,0);seen.apply(e,false);assert.equal(getDraft(e.getSnapshot()).revealed,true);e.resetSession();seen.syncSession(e.getSnapshot());assert.equal(seen.has(e.getSnapshot()),false);
});
test('failed pending storage withholds default preview and classifies later unknown exposure conservatively',()=>{
 const e=engine(),seen=new ReferenceGuideExposure();seen.attach({getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){}});assert.equal(seen.unavailable,true);seen.apply(e,false);assert.equal(getDraft(e.getSnapshot()).hinted,true);assert.equal(e.getSnapshot().attempts.length,0);
});

test('actual viewport clears all reference/mask length when hidden while retaining native draft scroll',async()=>{
 const{readFile}=await import('node:fs/promises'),{createRequire}=await import('node:module'),{inputViewportPlan,wrapInputText}=await import('./input-card'),require=createRequire(import.meta.url),swc=require('next/dist/build/swc');await swc.loadBindings();
 const source=await readFile(new URL('./input-card.ts',import.meta.url),'utf8'),handler=source.slice(source.indexOf('export function syncInputViewport')).replace('export function','function');
 const{code}=await swc.transform(handler,{jsc:{parser:{syntax:'typescript'},target:'es2022'},module:{type:'commonjs'}});
 const display={text:'',lines:[{start:0,end:0,text:'',x:0,y:0,width:0,height:20,baseline:16}],selection:[],caret:{x:0,y:0,w:1,h:20},scrollLeft:0,scrollTop:0,width:100,height:60,font:'20px monospace',letterSpacing:0,lineHeight:20,paddingX:0,paddingY:0};
 const sync=new Function('captureNativeInputDisplay','viewportMeasures','layoutReferenceRemainder','referenceGuideText','wrapInputText','inputViewportPlan',`${code};return syncInputViewport`)(()=>display,new WeakMap(),layoutReferenceRemainder,referenceGuideText,wrapInputText,inputViewportPlan);
 const input={value:'',scrollTop:0,style:{height:'60px'},ownerDocument:{createElement:()=>({getContext:()=>({font:'',letterSpacing:'',measureText:(text:string)=>({width:text.length*10})})})}},viewport={clientHeight:60,clientWidth:100,scrollTop:0,scrollLeft:0};
 const shown=sync(input,viewport,undefined,1,false,'A '.repeat(150));assert.ok(parseFloat(input.style.height)>60);assert.ok(shown.reference.lines.length>3);viewport.scrollTop=300;
 const hidden=sync(input,viewport,undefined,1,false,undefined);assert.equal(input.style.height,'60px');assert.equal(viewport.scrollTop,0);assert.equal(hidden.reference,undefined);assert.equal(input.value,'');
});

test('failed marker write withholds an unseen reference and does not falsely assert it was revealed',()=>{
 const e=engine(),seen=new ReferenceGuideExposure();seen.attach({getItem:()=>null,setItem(){throw Error('quota')},removeItem(){}});assert.equal(seen.observe(e.getSnapshot()),false);assert.equal(seen.has(e.getSnapshot()),false);seen.apply(e,false);assert.equal(getDraft(e.getSnapshot()).revealed,false);assert.equal(getDraft(e.getSnapshot()).hinted,true);
});

test('pasted trailing tab continuation uses native draft end even after selection moves',()=>{
 const display={lines:[{start:0,end:3,text:'abc',x:0,y:0,width:3,height:1,baseline:.8}],draftEnd:{x:8,y:0,baseline:.8},caret:{x:1,y:0},width:10,paddingX:0,paddingY:0,lineHeight:1};
 const guide=layoutReferenceRemainder('abc\t','abc defgh',display,text=>text.length);
 assert.deepEqual(guide.map(({text,x,y})=>({text,x,y})),[{text:'de',x:8,y:0},{text:'fgh',x:0,y:1}]);
 display.caret.x=0;assert.deepEqual(layoutReferenceRemainder('abc\t','abc defgh',display,text=>text.length),guide);
});
