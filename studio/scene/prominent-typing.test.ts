import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas,GlobalFonts} from '@napi-rs/canvas';
import {responsiveLayout} from './responsive-layout';
import {learningGeometry,containLearningMedia} from './learning-surface';
import {centeredInputPadding,inputCardTextareaStyle,inputViewportPlan,wrapInputText,type NativeInputDisplay} from './input-card';
import type {Rect} from './layout';
const overlaps=(a:Rect,b:Rect)=>a.x<b.x+b.w-1e-6&&a.x+a.w>b.x+1e-6&&a.y<b.y+b.h-1e-6&&a.y+a.h>b.y+1e-6;
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);

for(const portrait of[false,true])for(const cssWidth of(portrait?[320,390,430,640]:[320,560,692,960,1280,1672,1920]))for(const placement of['inside','below','hidden'] as const)test(`prominent text keeps actual editor and controls safe: ${portrait}/${cssWidth}/${placement}`,()=>{
 const base=responsiveLayout(portrait),before=JSON.stringify(base),g=learningGeometry(base,{keyboardVisible:placement!=='hidden',keyboardPlacement:placement==='hidden'?'inside':placement,cssWidth,availableHeight:1080}),card=g.inputCard,scale=cssWidth/base.width,style=inputCardTextareaStyle(card,scale);
 const glyphSize=Number.parseFloat(style.fontSize),contentWidth=card.input.w-card.paddingX*2;
 assert.ok(glyphSize>=(portrait?28:30)-1e-6&&glyphSize<=(portrait?38:64)+1e-6);
 assert.ok(contentWidth/base.width>=(cssWidth>=960?.86:cssWidth>=560?.85:.78));
 close(card.input.x+card.input.w/2,base.width/2);close(Number.parseFloat(style.lineHeight),card.lineHeight*scale);
 assert.equal(style.whiteSpace,'pre-wrap');assert.equal(style.overflowWrap,'break-word');assert.equal(style.background,'transparent');
 assert.ok(card.input.h-card.paddingY*2>=2*card.lineHeight-1e-6);
 const controls=[card.submit,card.toggle,card.modeToggle,g.zones.play,g.zones.previous,g.zones.next,g.zones.mute];
 for(const r of controls){assert.ok(r.w*scale>=44-1e-6&&r.h*scale>=44-1e-6);assert.ok(!overlaps(r,card.input));assert.ok(r.y+r.h<=g.height+1e-6)}
 for(const r of[g.goal,g.title,g.trend,g.inset,g.metrics,g.counter,g.player,card.status])assert.ok(!overlaps(card.input,r),JSON.stringify({portrait,cssWidth,placement,input:card.input,blocked:r}));
 if(card.keyboard){assert.ok(!overlaps(card.input,card.keyboard));assert.ok(!overlaps(card.keyboard,g.player))}
 assert.ok(!overlaps(card.helper,g.inset));assert.ok(!overlaps(card.helper,g.goal));
 assert.deepEqual(g.media,base.media);assert.deepEqual(g.goal,base.goal);assert.deepEqual(g.trend,base.trend);assert.deepEqual(g.counter,base.counter);assert.equal(JSON.stringify(base),before);
 if(!portrait&&placement==='inside'){close(g.inset.x+g.inset.w,base.inset.x+base.inset.w);close(g.metrics.x,base.metrics.x);close(g.inset.w/g.inset.h,base.inset.w/base.inset.h)}
 if(placement==='below'&&!portrait){const picture=containLearningMedia({width:1280,height:720},g.media,scale,'native');assert.ok(card.keyboard!.y>=picture.y+picture.h);assert.ok(g.player.y+g.player.h<=card.keyboard!.y)}
});

test('ordinary native 720p keeps its video pixels and one-screen inside presentation while glyphs become dominant',()=>{
 const base=responsiveLayout(false),g=learningGeometry(base,{keyboardVisible:true,cssWidth:1280}),card=g.inputCard,scale=1280/base.width,picture=containLearningMedia({width:1280,height:720},g.media,scale,'native');
 assert.equal(g.height,base.height);close(picture.w*scale,1280);close(picture.h*scale,720);close(card.fontSize*scale,45.933014354066984);
 assert.ok(card.fontSize/34>1.75);assert.ok((card.input.w-card.paddingX*2)/base.width>.86);
 assert.ok(card.keyboard!.y+card.keyboard!.h<=base.media.y+base.media.h);
});

test('large sentence wraps naturally without changing stable whole-cue centering or losing real characters',()=>{
 assert.ok(GlobalFonts.registerFromPath('public/studio-assets/fonts/studio-mono-regular.woff','Lingo Studio Mono'));
 const card=learningGeometry(responsiveLayout(false),{keyboardVisible:true,cssWidth:1280}).inputCard,c=createCanvas(1,1).getContext('2d');c.font=`400 ${card.fontSize}px "Lingo Studio Mono"`;
 const reference='We can make dumplings together in the kitchen.',pad=centeredInputPadding(card.input.w,card.paddingX,reference,text=>c.measureText(text).width),width=card.input.w-pad*2,lines=wrapInputText(reference,width,text=>c.measureText(text).width);
 assert.equal(lines.length,2);assert.equal(lines.map(line=>line.text).join(''),reference);assert.ok(lines.every(line=>c.measureText(line.text).width<=width+.001));
 for(const ignoredPrefix of['','We','We can make']){void ignoredPrefix;close(centeredInputPadding(card.input.w,card.paddingX,reference,text=>c.measureText(text).width),pad)}
 for(const width of[300,1000,1600])close(centeredInputPadding(width,12,undefined,()=>{throw Error('Hidden geometry must not measure an answer')}),12);
});

test('oversized real draft retains a reachable native caret in the same bounded large-text viewport',()=>{
 const card=learningGeometry(responsiveLayout(true),{keyboardVisible:false,cssWidth:320}).inputCard,draft='a complete long draft '.repeat(50),parts=wrapInputText(draft,card.input.w-card.paddingX*2,text=>text.length*card.fontSize*.6);
 const lines=parts.map((part,index)=>({...part,x:card.paddingX,y:card.paddingY+index*card.lineHeight,width:part.text.length*card.fontSize*.6,height:card.lineHeight,baseline:card.paddingY+(index+.8)*card.lineHeight}));
 const last=lines.at(-1)!,display:NativeInputDisplay={text:draft,lines,selection:[],caret:{x:last.x+last.width,y:last.y,w:1,h:card.lineHeight},scrollLeft:0,scrollTop:0,width:card.input.w,height:card.input.h,font:`${card.fontSize}px monospace`,letterSpacing:0,lineHeight:card.lineHeight,paddingX:card.paddingX,paddingY:card.paddingY};
 const before=JSON.stringify(display),plan=inputViewportPlan(display,card.input.h,0,0,true);assert.equal(parts.map(part=>part.text).join(''),draft);assert.ok(plan.scrollTop>0);assert.ok(display.caret.y+display.caret.h<=plan.scrollTop+plan.viewportHeight+1e-6);assert.equal(JSON.stringify(display),before);
});

test('colliding saved secondary panels retain visible area instead of collapsing or covering primary HUD',()=>{
 for(const cssWidth of[320,560,960,1280,1920])for(const metricsX of[50,350,650,1050,1363])for(const insetX of[0,500,1100,1374]){
  const base=responsiveLayout(false,{metrics:{x:metricsX,y:350,w:309,h:168},inset:{x:insetX,y:330,w:240,h:152}}),before=JSON.stringify(base),g=learningGeometry(base,{keyboardVisible:true,cssWidth}),card=g.inputCard;
  assert.ok(g.metrics.w>0&&g.metrics.h>0);assert.ok(g.inset.w>0&&g.inset.h>0);assert.equal(JSON.stringify(base),before);
  for(const r of[g.metrics,g.inset]){assert.ok(r.x>=0&&r.x+r.w<=g.width);for(const other of[card.input,card.helper,card.submit,card.status,g.goal,g.title,g.trend,g.player])assert.ok(!overlaps(r,other),JSON.stringify({cssWidth,metricsX,insetX,r,other}));}
  assert.ok(!overlaps(g.metrics,card.keyboard!));close(g.metrics.w/g.metrics.h,309/168);close(g.inset.w/g.inset.h,240/152);
 }
});

test('fixed/follow HUD size preferences keep the enlarged editor off the counter and all controls',()=>{
 for(const cssWidth of[320,560,960,1280,1920])for(const mode of['follow','fixed'] as const)for(const size of[.8,1,1.15])for(const keyboardVisible of[false,true]){
  const g=learningGeometry(responsiveLayout(false),{keyboardVisible,cssWidth,hud:{mode,size}}),card=g.inputCard;
  for(const other of[g.goal,g.title,g.trend,g.inset,g.metrics,g.counter,g.player,card.submit,card.status,card.helper])assert.ok(!overlaps(card.input,other),JSON.stringify({cssWidth,mode,size,keyboardVisible,input:card.input,other}));
  assert.ok(g.metrics.w>0&&g.metrics.h>0);assert.ok(g.inset.w>0&&g.inset.h>0);
 }
});

test('actual compact camera control stays below trend labels and outside enlarged editor/helper',async()=>{
 const {cameraControlGeometry}=await import('./camera-control');
 for(const cssWidth of[320,560,960,1280,1920])for(const mode of['follow','fixed'] as const)for(const size of[.8,1,1.15]){
  const g=learningGeometry(responsiveLayout(false),{keyboardVisible:true,cssWidth,hud:{mode,size}}),scale=cssWidth/g.width;
  for(const camera of['off','requesting','error'] as const){const control=cameraControlGeometry(g,camera,'lesson',{cssWidth,cssHeight:g.height*scale});close(control.hit.w*scale,44);close(control.hit.h*scale,44);for(const r of[g.goal,g.title,g.trend,g.inputCard.input,g.inputCard.helper])assert.ok(!overlaps(control.hit,r),JSON.stringify({cssWidth,mode,size,camera,hit:control.hit,r}));}
 }
});
