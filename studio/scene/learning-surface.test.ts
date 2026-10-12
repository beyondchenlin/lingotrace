import test from 'node:test';
import assert from 'node:assert/strict';
import {fitLearningSurface,containLearningMedia,learningGeometry,projectHudGeometry} from './learning-surface';
import {responsiveLayout} from './responsive-layout';
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<.02,`${a} ≠ ${b}`);
const intersects=(a:{x:number;y:number;w:number;h:number},b:typeof a)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
test('native and half picture pixels preserve intrinsic aspect and never upscale, independently of extended scene height',()=>{
 for(const portrait of[false,true])for(const source of[{width:1280,height:720},{width:640,height:480},{width:480,height:854},{width:320,height:180}])for(const videoSize of['native','half','fit']as const){
  const base=responsiveLayout(portrait),g=learningGeometry(base,{keyboardVisible:true,cssWidth:portrait?430:960});
  const surface=fitLearningSurface({availableWidth:1600,availableHeight:1000,sceneWidth:g.width,sceneHeight:g.height,media:g.media,intrinsicWidth:source.width,intrinsicHeight:source.height,videoSize,portrait});
  const picture=containLearningMedia(source,g.media,surface.scale,videoSize,{width:1600,height:1000});
  close(picture.w/picture.h,source.width/source.height);assert.ok(picture.w*surface.scale<=1600+.01);assert.ok(picture.h*surface.scale<=1000+.01);
  if(videoSize!=='fit'){assert.ok(picture.w*surface.scale<=source.width*(videoSize==='half'?.5:1)+.01);assert.ok(picture.h*surface.scale<=source.height*(videoSize==='half'?.5:1)+.01)}
 }
});
test('Fit can upscale while native retains source pixels; fullscreen is only a larger available rectangle',()=>{
 const base=responsiveLayout(false),args={availableWidth:2400,availableHeight:1800,sceneWidth:base.width,sceneHeight:base.height,media:base.media,intrinsicWidth:640,intrinsicHeight:360};
 const native=fitLearningSurface({...args,videoSize:'native'}),fit=fitLearningSurface({...args,videoSize:'fit'});close(native.width,640);assert.ok(fit.width>native.width);
 const fullscreen=fitLearningSurface({...args,availableWidth:3000,availableHeight:2000,videoSize:'native'});close(fullscreen.width,native.width);
});
test('fixed-reference component CSS size stays constant across video scales until safety constrained',()=>{
 const base=responsiveLayout(false);for(const size of[.8,1,1.15]){
  const a=projectHudGeometry(base,{mode:'fixed',size},960),b=projectHudGeometry(base,{mode:'fixed',size},1440);
  close(a.goal.w*960/base.width,b.goal.w*1440/base.width);close(a.trend.w*960/base.width,b.trend.w*1440/base.width);
  assert.equal(a.goal.x,base.goal.x);close(a.trend.x+a.trend.w,base.trend.x+base.trend.w);
 }
 const normal=projectHudGeometry(base,{mode:'follow',size:1},960);assert.deepEqual(normal.goal,base.goal);assert.deepEqual(normal.metrics,base.metrics);assert.deepEqual(normal.trend,base.trend);
 assert.equal(projectHudGeometry(base,{mode:'fixed',size:1.15},320).hudClamped,true);
});
test('short and half-size scenes converge to a readable scrollable surface rather than a resize shrink loop',()=>{
 for(const portrait of[false,true])for(const availableWidth of[320,640,1280])for(const availableHeight of[160,320,720])for(const videoSize of['native','half','fit']as const){
  const base=responsiveLayout(portrait);let width=availableWidth,previous=width;
  for(let i=0;i<60;i++){
   const g=learningGeometry(base,{keyboardVisible:true,cssWidth:width,hud:{mode:'fixed',size:1.15}}),surface=fitLearningSurface({availableWidth,availableHeight,sceneWidth:g.width,sceneHeight:g.height,media:g.media,intrinsicWidth:1280,intrinsicHeight:720,videoSize,portrait});previous=width;width=surface.width;
  }
  assert.ok(Math.abs(width-previous)<.03);assert.ok(width<=availableWidth);const g=learningGeometry(base,{keyboardVisible:true,cssWidth:width}),card=g.inputCard,scale=width/base.width;
  for(const r of[card.submit,card.toggle,card.modeToggle,g.zones.play,g.zones.previous,g.zones.next,g.zones.mute]){assert.ok(r.w*scale>=43.99&&r.h*scale>=43.99);assert.ok(r.x>=0&&r.x+r.w<=base.width+.01);assert.ok(r.y+r.h<=g.height)}
  for(const a of['play','previous','next','mute']as const){assert.ok(!intersects(g.zones[a],g.listeningDock));for(const b of['play','previous','next','mute']as const)if(a!==b)assert.ok(!intersects(g.zones[a],g.zones[b]));assert.ok(!intersects(g.zones[a],g.zones.seek));}assert.ok(g.zones.seek.h*scale>=44);for(const ratio of[0,.25,.5,.75,1]){const marker=g.cueMarker(ratio);assert.ok(marker.y+marker.h<=g.height+.01);}assert.ok(!intersects(card.toggle,card.modeToggle));assert.ok(!intersects(card.input,card.keyboard!));assert.ok(card.keyboard!.y>=card.input.y+card.input.h);assert.ok(!intersects(card.keyboard!,g.player));
 }
});
test('software-keyboard bounds clamp actual video while readable controls can scroll',()=>{
 const picture=containLearningMedia({width:1920,height:1080},{x:0,y:0,w:1672,h:941},.5,'native',{width:800,height:180});assert.ok(picture.h*.5<=180);close(picture.w/picture.h,16/9);
});

test('ordinary landscape lower-third keyboard stays on the native video surface with typing above',()=>{
 const base=responsiveLayout(false);
 for(const available of[{width:1920,height:1080},{width:1280,height:720},{width:1165,height:747},{width:960,height:720}]){
  let width=1280,g=learningGeometry(base,{keyboardVisible:true,cssWidth:width});
  for(let i=0;i<12;i++){g=learningGeometry(base,{keyboardVisible:true,cssWidth:width});width=fitLearningSurface({availableWidth:available.width,availableHeight:available.height,sceneWidth:g.width,sceneHeight:g.height,media:g.media,intrinsicWidth:1280,intrinsicHeight:720,videoSize:'native'}).width;}
  const scale=width/base.width,keyboard=g.inputCard.keyboard!;assert.ok(g.height*scale<=available.height+1);assert.ok(keyboard.h/g.height>=.28&&keyboard.h/g.height<=.33);assert.ok(keyboard.y+keyboard.h<=base.media.y+base.media.h);assert.ok(g.inputCard.input.y+g.inputCard.input.h<keyboard.y);assert.ok(g.inputCard.card.y+g.inputCard.card.h<keyboard.y);assert.ok(keyboard.y+keyboard.h<g.player.y);
  close(width,Math.min(1280,available.width,available.height*16/9));close(keyboard.h/base.height,.30);
  assert.deepEqual(g.goal,base.goal);assert.equal(g.metrics.x,base.metrics.x);assert.deepEqual(g.trend,base.trend);close(g.inset.x+g.inset.w,base.inset.x+base.inset.w);assert.ok(!intersects(g.inset,g.inputCard.input));assert.ok(!intersects(g.metrics,g.inputCard.input));
 }
});

test('native range thumb travel exactly equals the painted rail at every tested viewport',()=>{
 for(const portrait of[false,true])for(const width of[320,430,560,640,960,1280,1920]){
  const g=learningGeometry(responsiveLayout(portrait),{keyboardVisible:!portrait,cssWidth:width}),scale=width/g.width,inputLeft=g.zones.seek.x*scale,inputWidth=g.zones.seek.w*scale;
  for(const ratio of[0,.25,.5,.75,1]){const nativeThumbCenter=inputLeft+g.seekThumbWidthCss/2+ratio*(inputWidth-g.seekThumbWidthCss);const paintedCenter=(g.zones.seek.x+g.railInset+ratio*(g.zones.seek.w-2*g.railInset))*scale;close(nativeThumbCenter,paintedCenter);close(g.timelineProgress(nativeThumbCenter,0,width),ratio);}
 }
});
