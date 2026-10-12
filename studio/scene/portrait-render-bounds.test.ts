import test from 'node:test';
import assert from 'node:assert/strict';
import {learningGeometry,fitLearningSurface} from './learning-surface';
import {responsiveLayout,resolvePortraitHeight} from './responsive-layout';
test('viewport/keyboard geometry converges with bounded backing stores; no speculative production cap',()=>{
 let cases=0,maxBackingPixels=0;
 for(const aw of[320,360,390,430,485,768,1024,1280])for(const ah of[250,330,500,734,844,1200,1800])for(const portrait of[true,false])for(const keyboardVisible of[true,false])for(const keyboardPlacement of['inside','below'] as const)for(const mode of['fixed','follow'] as const){
  const base=responsiveLayout(portrait,{},'lesson',resolvePortraitHeight(Math.round(ah*430/aw)));let width=portrait?430:1672,previous=0;
  for(let pass=0;pass<40;pass++){
   const g=learningGeometry(base,{keyboardVisible,keyboardPlacement,cssWidth:width,availableWidth:aw,availableHeight:ah,hud:{mode,size:1.15}});
   const surface=fitLearningSurface({availableWidth:aw,availableHeight:ah,sceneWidth:g.width,sceneHeight:g.height,media:g.media,videoSize:'native',portrait});
   assert.ok(Number.isFinite(g.height)&&Number.isFinite(surface.width));previous=width;width=surface.width;
   maxBackingPixels=Math.max(maxBackingPixels,(portrait?860:1920)*Math.round(g.height*(portrait?2:1920/1672)));
  }
  assert.ok(Math.abs(width-previous)<=.02,`${aw}/${ah}/${portrait}/${keyboardVisible}/${keyboardPlacement}/${mode}`);cases++;
 }
 assert.equal(cases,896);assert.ok(maxBackingPixels<10000000);console.log(JSON.stringify({cases,maxBackingPixels}));
});
