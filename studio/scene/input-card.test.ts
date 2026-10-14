import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {responsiveLayout} from './responsive-layout';
import {captureNativeInputDisplay,releaseNativeInputDisplay,applyInputCardLayout,inputCardGeometry,inputCardTextareaStyle,keyboardKeyRects,paintInputText,paintPassiveKeyboard,wrapInputText,visualSegments,type NativeInputDisplay} from './input-card';

const intersects=(a:{x:number;y:number;w:number;h:number},b:{x:number;y:number;w:number;h:number})=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
for(const portrait of [false,true])for(const height of [820,940,1080,1400])test(`input card geometry preserves primary anchors and safely clears secondary HUD on visibility toggle ${portrait}/${height}`,()=>{
 const base=responsiveLayout(portrait,{},'lesson',height);
 // Phone practice-compact uses the OS keyboard, never the in-app QWERTY plate.
 const shown=applyInputCardLayout(base,base.practiceCompact?{keyboardVisible:false}:{}),hidden=applyInputCardLayout(base,{keyboardVisible:false});
 if(portrait){
  assert.deepEqual(shown.inputCard.input,hidden.inputCard.input);
  if(base.practiceCompact){assert.equal(shown.height,hidden.height);assert.equal(shown.height,base.height)}
  else assert.ok(hidden.height<shown.height);
 }else{assert.ok(shown.inputCard.input.y<hidden.inputCard.input.y);assert.equal(shown.height,base.height)}
 assert.deepEqual(shown.media,base.media);assert.deepEqual(shown.goal,base.goal);assert.deepEqual(shown.trend,base.trend);assert.deepEqual(shown.counter,base.counter);
 if(portrait&&base.practiceCompact){
  // Captions stay on the media plate above typing; y may differ from the base template.
  assert.equal(shown.subtitle.x,base.subtitle.x);assert.equal(shown.subtitle.w,base.subtitle.w);assert.equal(shown.subtitle.h,base.subtitle.h);
  assert.ok(shown.subtitle.y+shown.subtitle.h<=shown.inputCard.card.y+1e-6);
 }else assert.deepEqual(shown.subtitle,base.subtitle);
 if(portrait){assert.deepEqual(shown.inset,base.inset);assert.deepEqual(shown.metrics,base.metrics)}else{assert.equal(shown.inset.x+shown.inset.w,base.inset.x+base.inset.w);assert.equal(shown.metrics.x,base.metrics.x)};
 assert.equal(hidden.inputCard.keyboard,null);
 if(base.practiceCompact){assert.equal(shown.inputCard.keyboard,null)}else assert.ok(shown.inputCard.keyboard);
 assert.ok(shown.inputCard.input.h-shown.inputCard.paddingY*2>=2*shown.inputCard.lineHeight);
 const rects=[shown.inputCard.card,shown.inputCard.toggle].concat(shown.inputCard.keyboard?[shown.inputCard.keyboard]:[]);
 for(const rect of rects){
  assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.w<=shown.width&&rect.y+rect.h<=shown.height);
  if(rect!==shown.inputCard.card)assert.ok(!intersects(rect,shown.inset));assert.ok(!intersects(rect,shown.counter));assert.ok(!intersects(rect,shown.player));
 }
 assert.ok(shown.zones.submit.y>=shown.zones.input.y+shown.zones.input.h);
 assert.ok(shown.zones.submit.h>=44);assert.ok(shown.inputCard.toggle.h>=44);
 if(!portrait){assert.ok(shown.inputCard.input.y+shown.inputCard.input.h<shown.inputCard.keyboard!.y);assert.ok(shown.inputCard.keyboard!.h/shown.height>=.28&&shown.inputCard.keyboard!.h/shown.height<=.33);}
});

test('native CSS shares font, line height, padding and transparent compact input background',()=>{
 const card=inputCardGeometry(responsiveLayout(true),{cssScale:.8}),style=inputCardTextareaStyle(card,.8);
 assert.equal(style.fontSize,'28px');assert.equal(style.lineHeight,'35px');assert.equal(style.padding,'6px 6.4px');assert.equal(style.whiteSpace,'pre-wrap');assert.equal(style.color,'#f4f6f5');assert.equal(style.background,'transparent');
});
test('fallback retains every grapheme and real newline without storing visual wraps',()=>{
 const source='First paragraph has a long word: Supercalifragilisticexpialidocious.\n\n中文 café 👩‍💻\n';
 const lines=wrapInputText(source,16,text=>Array.from(text).length);
 assert.ok(lines.length>4);assert.ok(lines.some(line=>line.text===''));
 for(const line of lines){assert.equal(line.text,source.slice(line.start,line.end));assert.ok(!line.text.includes('\n'));assert.ok(!/^[\udc00-\udfff]|[\ud800-\udbff]$/.test(line.text))}
 assert.equal(lines.map(line=>line.text).join(''),source.replaceAll('\n',''));
 assert.equal(wrapInputText('x'.repeat(2400),20,s=>s.length).map(line=>line.text).join('').length,2400,'restored drafts are never silently truncated');
});
test('keyboard is passive QWERTY geometry including punctuation, space, modifiers and backspace',()=>{
 const rect=inputCardGeometry(responsiveLayout(false)).keyboard!,keys=keyboardKeyRects(rect);
 for(const code of ['KeyQ','KeyA','KeyZ','Space','Backspace','Quote','ShiftLeft','Enter'])assert.ok(keys.some(key=>key.code===code));
 assert.equal(keys.filter(key=>key.code==='Space').length,1);assert.equal(new Set(keys.map(key=>key.code)).size,keys.length);
 for(const key of keys){assert.ok(key.rect.x>=rect.x&&key.rect.y>=rect.y);assert.ok(key.rect.x+key.rect.w<=rect.x+rect.w+.001);assert.ok(key.rect.y+key.rect.h<=rect.y+rect.h+.001)}
});

test('native browser geometry is used unchanged for multiline drawing, selection and scroll',()=>{
 const card=inputCardGeometry(responsiveLayout(false)),canvas=createCanvas(1672,941),c=canvas.getContext('2d'),labels:{text:string;x:number;y:number}[]=[],rects:number[][]=[];
 const fillText=c.fillText.bind(c),fillRect=c.fillRect.bind(c);c.fillText=(text:string,x:number,y:number,...rest:any[])=>{labels.push({text,x,y});return Reflect.apply(fillText,c,[text,x,y,...rest])};c.fillRect=(...args:any[])=>{rects.push(args);return Reflect.apply(fillRect,c,args)};
 const display:NativeInputDisplay={text:'First line\nSecond line\nThird line',lines:[{text:'First line',start:0,end:10,x:12,y:8,width:120,height:30,baseline:31},{text:'Second line',start:11,end:22,x:12,y:38,width:132,height:30,baseline:61},{text:'Third line',start:23,end:33,x:12,y:68,width:120,height:30,baseline:91}],selection:[{x:22,y:38,w:50,h:30}],caret:{x:72,y:38,w:1.5,h:30},scrollLeft:3,scrollTop:17,width:682,height:80,font:'400 25px monospace',letterSpacing:0,lineHeight:30,paddingX:12,paddingY:8};
 const state={draft:display.text,nativeInputDisplay:display,scrollLeft:900,scrollTop:900,caret:12,selectionEnd:17,inputFocused:true,composition:false,reducedMotion:true,renderTime:100};const before=JSON.stringify(state);
 paintInputText(c as unknown as CanvasRenderingContext2D,card,state);
 assert.equal(JSON.stringify(state),before);assert.deepEqual(labels.map(label=>label.text),['First line','Second line','Third line']);
 assert.deepEqual(labels[1],{text:'Second line',x:card.input.x+12-3,y:card.input.y+61-17});
 assert.ok(rects.some(r=>r[0]===card.input.x+22-3&&r[1]===card.input.y+38-17&&r[2]===50&&r[3]===30));
});
test('keyboard reduced motion has no timed flash or depressed-key animation',()=>{
 const card=inputCardGeometry(responsiveLayout(false)),draw=(codes:string[],committedUntil:number,time:number,reduced=true)=>{const canvas=createCanvas(1672,941);paintPassiveKeyboard(canvas.getContext('2d') as unknown as CanvasRenderingContext2D,card,{visible:true,codes,committedUntil,composing:false},time,reduced);return canvas.toBuffer('image/png')};
 assert.deepEqual(draw([],1000,100),draw([],0,900));assert.deepEqual(draw(['KeyQ'],1000,100),draw(['KeyQ'],0,900));assert.notDeepEqual(draw(['KeyQ'],0,100),draw([],0,100));assert.notDeepEqual(draw([],1000,100,false),draw([],0,100,false));assert.deepEqual(draw(['Unidentified'],0,100),draw([],0,100));
});

for(const portrait of [false,true])for(const scale of [.414,.744,.8,1])test(`scaled controls retain native font and physical hit sizes ${portrait}/${scale}`,()=>{
 const g=applyInputCardLayout(responsiveLayout(portrait),{cssScale:scale}),card=g.inputCard;
 assert.ok(card.fontSize*scale>=16-.001);assert.ok(card.lineHeight*scale>=22-.001);assert.ok(card.submit.h*scale>=44-.001);assert.ok(card.toggle.h*scale>=44-.001);
 assert.ok(!intersects(card.toggle,card.input));assert.ok(!intersects(card.toggle,card.submit));assert.ok(!intersects(card.keyboard!,g.player));assert.ok(!intersects(card.card,g.player));
 const hidden=applyInputCardLayout(responsiveLayout(portrait),{cssScale:scale,keyboardVisible:false});if(portrait)assert.deepEqual(hidden.inputCard.input,card.input);else assert.ok(card.input.y<hidden.inputCard.input.y);
});
test('visual segmentation fallback retains UTF-16 offsets without claiming grapheme measurements',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(Intl,'Segmenter');Object.defineProperty(Intl,'Segmenter',{value:undefined,configurable:true});
 try{assert.deepEqual(visualSegments('A😀B'),[{segment:'A',index:0},{segment:'😀',index:1},{segment:'B',index:3}]);assert.equal(wrapInputText('A😀B',1,s=>Array.from(s).length).map(line=>line.text).join(''),'A😀B')}finally{if(descriptor)Object.defineProperty(Intl,'Segmenter',descriptor)}
});

test('font completion invalidates cached native wrap despite identical text and computed CSS',async()=>{
 const{captureNativeInputDisplay,invalidateNativeInputDisplay,releaseNativeInputDisplay}=await import('./input-card');
 let advance=5,node:any,mirror:any;
 const rect=(x:number,y:number,width:number,height=12)=>({x,y,left:x,top:y,width,height,right:x+width,bottom:y+height});
 const css:any={fontFamily:'monospace',fontSize:'10px',fontWeight:'400',fontStyle:'normal',lineHeight:'12px',paddingLeft:'0px',paddingRight:'0px',paddingTop:'0px',paddingBottom:'0px',letterSpacing:'0px'};
 const doc:any={defaultView:{getComputedStyle:()=>css},body:{appendChild(){}},createTextNode(data:string){node={data,get length(){return this.data.length}};return node},createElement(tag:string){const el:any={style:{},setAttribute(){},append(){},remove(){},getBoundingClientRect(){return tag==='span'?rect(0,Math.floor((node.data.length-1)*advance/40)*12+9,0,0):rect(0,0,40,24)}};if(tag==='div')mirror=el;return el},createRange(){let a=0,b=0;return{setStart(_:unknown,i:number){a=i},setEnd(_:unknown,i:number){b=i},collapse(){b=a},getClientRects(){return[rect(a*advance%40,Math.floor(a*advance/40)*12,(b-a)*advance)]},getBoundingClientRect(){return this.getClientRects()[0]}}}};
 const textarea:any={ownerDocument:doc,value:'abcdefgh',clientWidth:40,clientHeight:40,selectionStart:0,selectionEnd:0,selectionDirection:'none',scrollLeft:0,scrollTop:0};
 assert.equal(captureNativeInputDisplay(textarea).lines.length,1);advance=10;
 assert.equal(captureNativeInputDisplay(textarea).lines.length,1,'unchanged CSS uses cached wrap until font completion');
 invalidateNativeInputDisplay(textarea);assert.equal(captureNativeInputDisplay(textarea).lines.length,2);assert.equal(textarea.value,'abcdefgh');assert.equal(textarea.selectionStart,0);assert.ok(mirror);releaseNativeInputDisplay(textarea);
});

test('postcheck card gives a concrete mismatch and direct full-difference label',async()=>{
 const{TrainingEngine}=await import('../core/training');const{inputFeedbackLines}=await import('./input-card');
 const engine=new TrainingEngine();engine.input('wrong');const result=engine.submit()!;
 const lines=inputFeedbackLines(result);assert.match(lines[0],/Errors:.*Review/);assert.ok(lines[1].includes('→')||lines[1].startsWith('Missing:')||lines[1].startsWith('Extra:'));assert.equal(engine.draft,'wrong');
});

test('passive key labels remain at least 10 CSS pixels on small surfaces',()=>{
 for(const scale of[.414,.6927,1]){const card=inputCardGeometry(responsiveLayout(false),{cssScale:scale});const c=createCanvas(2000,2000).getContext('2d'),fonts:number[]=[],original=c.fillText.bind(c);c.fillText=((text:string,x:number,y:number)=>{fonts.push(parseFloat(c.font.match(/([\d.]+)px/)![1])*scale);original(text,x,y)})as typeof c.fillText;paintPassiveKeyboard(c as unknown as CanvasRenderingContext2D,card,{visible:true,codes:[],committedUntil:0,composing:false},0,true);assert.ok(fonts.length>30);assert.ok(fonts.every(size=>size>=9.999))}
});

test('compact hints mask all reference glyphs, retain spacing, and segment graphemes',async()=>{
 const{inputGuideMask}=await import('./input-card');
 assert.equal(inputGuideMask('HELLO'),'_____');assert.equal(inputGuideMask('Hello world!'),'_____ ______');
 assert.equal(inputGuideMask('é 👩‍💻\n中文'),'_ _\n__');
});
test('page keyboard defaults hidden on mobile or portrait even with old desktop show preference',async()=>{
 const{defaultKeyboardVisible}=await import('./input-card');
 for(const stored of[null,'0','1']){assert.equal(defaultKeyboardVisible(true,false,stored),false);assert.equal(defaultKeyboardVisible(false,true,stored),false)}
 assert.equal(defaultKeyboardVisible(false,false,null),true);assert.equal(defaultKeyboardVisible(false,false,'1'),true);assert.equal(defaultKeyboardVisible(false,false,'0'),false);
});
test('typed HELLO has five underline slots, word mode has one, and empty strict draft has one fixed neutral mark',()=>{
 const card=inputCardGeometry(responsiveLayout(false)),ctx=createCanvas(1672,1000).getContext('2d'),stroke=ctx.stroke.bind(ctx);let strokes=0;ctx.stroke=(...args:any[])=>{strokes++;return Reflect.apply(stroke,ctx,args)};
 const state={draft:'HELLO',scrollLeft:0,caret:0,selectionEnd:0,inputFocused:false,composition:false,reducedMotion:true,renderTime:0};
 paintInputText(ctx as unknown as CanvasRenderingContext2D,card,state);assert.equal(strokes,5);
 strokes=0;paintInputText(ctx as unknown as CanvasRenderingContext2D,card,{...state,underlineMode:'words'});assert.equal(strokes,1);
 strokes=0;paintInputText(ctx as unknown as CanvasRenderingContext2D,card,{...state,draft:''});assert.equal(strokes,1);
 strokes=0;paintInputText(ctx as unknown as CanvasRenderingContext2D,card,{...state,draft:'',inputGuide:{mode:'letters',mask:'_____'}});assert.equal(strokes,5);
});
test('assisted reference paints one stable word rail under each target word even with empty draft',()=>{
 const card=inputCardGeometry(responsiveLayout(false)),ctx=createCanvas(1672,1000).getContext('2d'),stroke=ctx.stroke.bind(ctx);let strokes=0;const spans:number[]=[];let cur:number[]=[];
 const move=ctx.moveTo.bind(ctx),lineTo=ctx.lineTo.bind(ctx),begin=ctx.beginPath.bind(ctx);
 ctx.beginPath=(...args:any[])=>{cur=[];return Reflect.apply(begin,ctx,args)};
 ctx.moveTo=(x:number,y:number)=>{cur.push(x);return Reflect.apply(move,ctx,[x,y])};
 ctx.lineTo=(x:number,y:number)=>{cur.push(x);return Reflect.apply(lineTo,ctx,[x,y])};
 ctx.stroke=(...args:any[])=>{strokes++;if(cur.length>=2)spans.push(Math.max(...cur)-Math.min(...cur));return Reflect.apply(stroke,ctx,args)};
 const state={draft:'',referenceGuide:'Hi, everybody.',underlineMode:'words' as const,scrollLeft:0,caret:0,selectionEnd:0,inputFocused:false,composition:false,reducedMotion:true,renderTime:0};
 paintInputText(ctx as unknown as CanvasRenderingContext2D,card,state);assert.equal(strokes,2);
 // Word rails stay short — never panel/full-width baselines across the input card.
 assert.ok(spans.every(span=>span>8&&span<card.input.w*.35),`expected short word rails, got ${spans}`);
 // Partial draft still keeps both target rails (plus live correct underlines on matched letters).
 strokes=0;spans.length=0;paintInputText(ctx as unknown as CanvasRenderingContext2D,card,{...state,draft:'Hi'});assert.ok(strokes>=2);
 assert.ok(spans.every(span=>span<card.input.w*.35),`no full-width rails while typing, got ${spans}`);
 strokes=0;paintInputText(ctx as unknown as CanvasRenderingContext2D,card,{...state,underlineMode:'letters',referenceGuide:undefined,draft:''});assert.equal(strokes,1);
});
test('Enter/Check target matches keyboard/settings 44px peer and style selector does not cover editing or keyboard toggle',()=>{
 for(const portrait of[true,false])for(const cssScale of[.3,.414,.744,1]){const card=inputCardGeometry(responsiveLayout(portrait),{cssScale});assert.ok(Math.abs(card.submit.w-card.submit.h)<1e-6);assert.ok(card.submit.w*cssScale>=44-1e-6);assert.ok(!intersects(card.modeToggle,card.input));assert.ok(!intersects(card.modeToggle,card.toggle));assert.ok(card.modeToggle.x+card.modeToggle.w<=1672);assert.ok(card.modeToggle.w*cssScale>=44)}
});

test('native draft-end capture includes trailing tab independently of moved selection',()=>{
 const css:any={fontFamily:'monospace',fontSize:'10px',fontWeight:'400',fontStyle:'normal',lineHeight:'12px',paddingLeft:'0px',paddingRight:'0px',paddingTop:'0px',paddingBottom:'0px',letterSpacing:'0px'};
 let node:any,collapsedAvailable=true;const rect=(x:number,width:number)=>({x,y:0,left:x,top:0,width,height:12,right:x+width,bottom:12});const position=(i:number)=>i===4?40:i*5;
 const doc:any={defaultView:{getComputedStyle:()=>css},body:{appendChild(){}},createTextNode(data:string){node={data,get length(){return this.data.length}};return node},createElement(tag:string){return{style:{},setAttribute(){},append(){},remove(){},getBoundingClientRect(){return tag==='span'?{...rect(0,0),top:9}:rect(0,100)}}},createRange(){let a=0,b=0;return{setStart(_:unknown,i:number){a=i},setEnd(_:unknown,i:number){b=i},collapse(){b=a},getClientRects(){return a===b&&!collapsedAvailable?[]:[rect(position(a),position(b)-position(a))]},getBoundingClientRect(){return this.getClientRects()[0]}}}};
 const textarea:any={ownerDocument:doc,value:'abc\t',clientWidth:100,clientHeight:40,selectionStart:1,selectionEnd:1,selectionDirection:'none',scrollLeft:0,scrollTop:0};
 for(const fallback of[false,true]){collapsedAvailable=!fallback;const display=captureNativeInputDisplay(textarea);assert.equal(display.lines.at(-1)!.width,15);assert.equal(display.draftEnd!.x,40);assert.equal(display.caret.x,5);assert.equal(textarea.selectionStart,1);assert.equal(textarea.value,'abc\t')}
 releaseNativeInputDisplay(textarea);
});

test('native draft-end fallback uses the final empty line sentinel after a pasted newline',()=>{
 const css:any={fontFamily:'monospace',fontSize:'10px',fontWeight:'400',fontStyle:'normal',lineHeight:'12px',paddingLeft:'0px',paddingRight:'0px',paddingTop:'0px',paddingBottom:'0px',letterSpacing:'0px'};
 let node:any;const rect=(x:number,y:number,width:number)=>({x,y,left:x,top:y,width,height:12,right:x+width,bottom:y+12});const point=(i:number)=>i>=4?{x:0,y:12}:{x:i*5,y:0};
 const doc:any={defaultView:{getComputedStyle:()=>css},body:{appendChild(){}},createTextNode(data:string){node={data,get length(){return this.data.length}};return node},createElement(tag:string){return{style:{},setAttribute(){},append(){},remove(){},getBoundingClientRect(){return tag==='span'?{...rect(0,12,0),top:21}:rect(0,0,100)}}},createRange(){let a=0,b=0;return{setStart(_:unknown,i:number){a=i},setEnd(_:unknown,i:number){b=i},collapse(){b=a},getClientRects(){const p=point(a),q=point(b);return a===b?[]:[rect(p.x,p.y,Math.max(0,q.x-p.x))]},getBoundingClientRect(){return this.getClientRects()[0]}}}};
 const textarea:any={ownerDocument:doc,value:'abc\n',clientWidth:100,clientHeight:40,selectionStart:1,selectionEnd:1,selectionDirection:'none',scrollLeft:0,scrollTop:0};
 const display=captureNativeInputDisplay(textarea);assert.equal(display.draftEnd!.x,0);assert.equal(display.draftEnd!.y,12);assert.equal(display.draftEnd!.baseline,21);assert.equal(display.caret.x,5);assert.equal(textarea.value,'abc\n');assert.equal(textarea.selectionStart,1);releaseNativeInputDisplay(textarea);
});
