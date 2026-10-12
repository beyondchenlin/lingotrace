import test from 'node:test';
import assert from 'node:assert/strict';
import {fitLearningSurface,learningGeometry,containLearningMedia,inputHeaderControls,learningFocusScroll} from './learning-surface';
import {responsiveLayout,resolvePortraitHeight} from './responsive-layout';

test('portrait learning surface uses all available width even when input, controls or keyboard extend its height',()=>{
 for(const aw of[320,360,390,430,485,640])for(const ah of[220,360,640,844,1200])for(const keyboardVisible of[false,true])for(const videoSize of['half','native','fit'] as const){
  const base=responsiveLayout(true,{},'lesson',resolvePortraitHeight(ah*430/aw));let width=aw;
  for(let pass=0;pass<3;pass++){
   const g=learningGeometry(base,{keyboardVisible,cssWidth:width,availableWidth:aw,availableHeight:ah,videoSize});
   const surface=fitLearningSurface({availableWidth:aw,availableHeight:ah,sceneWidth:g.width,sceneHeight:g.height,media:g.media,videoSize,portrait:true});
   assert.equal(surface.width,aw,`${aw}x${ah} / ${keyboardVisible} / ${videoSize}`);width=surface.width;
   const picture=containLearningMedia({width:1280,height:720},g.media,surface.scale,videoSize,{width:aw,height:ah});
   assert.ok(Math.abs(picture.w/picture.h-16/9)<1e-9);assert.ok(picture.w*surface.scale<=aw+.01);assert.ok(picture.h*surface.scale<=ah+.01);
   assert.ok(g.inputCard.input.w*surface.scale>=aw*.85,'native learning area retains screen-width reading space');
  }
 }
});

test('compact Follow and reference controls remain outside every native input line',()=>{
 for(const aw of[280,320,360,390,430,485]){
  const g=learningGeometry(responsiveLayout(true),{keyboardVisible:false,cssWidth:aw}),header=inputHeaderControls(g.inputCard),scale=aw/g.width;
  assert.ok(header.reference.w>0);assert.ok(header.reference.x+header.reference.w<header.follow.x);assert.ok(header.follow.w*scale>=100);assert.ok(header.follow.h*scale>=44);
  assert.ok(header.follow.y+header.follow.h<=g.inputCard.input.y);assert.equal(header.reference.y+header.reference.h,g.inputCard.input.y);
 }
});
test('software keyboard page scroll prioritizes input and includes nearby Follow and Play when they fit',()=>{
 const input={top:600,bottom:717},submit={top:722,bottom:766},play={top:832,bottom:876},follow={top:556,bottom:600};
 const delta=learningFocusScroll({top:0,bottom:360},input,submit,play,follow);
 assert.equal(delta,524);assert.ok(follow.top-delta>=8);assert.ok(play.bottom-delta<=352);
 const tight=learningFocusScroll({top:0,bottom:220},input,submit,play,follow);assert.equal(tight,554);assert.ok(input.top-tight>=8);assert.ok(submit.bottom-tight<=212);
 assert.equal(learningFocusScroll({top:0,bottom:360},{top:80,bottom:197},{top:202,bottom:246},{top:292,bottom:336},{top:36,bottom:80}),0);
});
