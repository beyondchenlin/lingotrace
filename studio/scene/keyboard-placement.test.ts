import test from 'node:test';
import assert from 'node:assert/strict';
import {learningGeometry,fitLearningSurface,containLearningMedia} from './learning-surface';
import {responsiveLayout} from './responsive-layout';
for(const [width,height]of[[1280,720],[1920,1080],[720,1280],[900,900]])for(const mode of['half','native','fit'] as const)test(`below keyboard is outside actual ${width}x${height} picture at ${mode}`,()=>{
 const base=responsiveLayout(false),available={width:3840,height:2160};
 const fit=fitLearningSurface({availableWidth:available.width,availableHeight:available.height,sceneWidth:base.width,sceneHeight:base.height,media:base.media,intrinsicWidth:width,intrinsicHeight:height,videoSize:mode});
 const options={keyboardVisible:true,keyboardPlacement:'below' as const,cssWidth:fit.width,intrinsicWidth:width,intrinsicHeight:height,videoSize:mode,availableWidth:available.width,availableHeight:available.height};
 const g=learningGeometry(base,options),picture=containLearningMedia({width,height},g.media,fit.scale,mode,available),keyboard=g.inputCard.keyboard!;
 assert.ok(keyboard.y>=picture.y+picture.h);assert.ok(keyboard.y>g.inputCard.input.y+g.inputCard.input.h);assert.ok(g.player.y+g.player.h<=keyboard.y);assert.ok(keyboard.y+keyboard.h<=g.height);
 const hidden=learningGeometry(base,{...options,keyboardVisible:false});assert.deepEqual(g.inputCard.input,hidden.inputCard.input);assert.deepEqual(g.player,hidden.player);
 assert.deepEqual(g.media,base.media);assert.deepEqual(g.inset,hidden.inset);assert.deepEqual(g.goal,base.goal);assert.equal(g.inputCard.overlayKeyboard,false);
 assert.ok(Math.abs(picture.w/picture.h-width/height)<1e-10);
 if(mode!=='fit'){assert.ok(picture.w*fit.scale<=width*(mode==='half'?.5:1)+1e-6);assert.ok(picture.h*fit.scale<=height*(mode==='half'?.5:1)+1e-6)}
 for(const r of[g.inputCard.submit,g.inputCard.toggle,g.inputCard.modeToggle,g.zones.play,g.zones.next])assert.ok(r.w*fit.scale>=44-1e-6&&r.h*fit.scale>=44-1e-6);
 for(const ratio of[0,.25,.5,.75,1]){const marker=g.cueMarker(ratio);assert.ok(Math.abs(g.timelineProgress((marker.x+marker.w/2)*fit.scale,0,fit.width)-ratio)<1e-10)}
});
test('native 720p picture on 4K viewport stays 1280px and uses spare height below',()=>{
 const b=responsiveLayout(false),s=fitLearningSurface({availableWidth:3840,availableHeight:2160,sceneWidth:b.width,sceneHeight:b.height,media:b.media,intrinsicWidth:1280,intrinsicHeight:720,videoSize:'native'}),g=learningGeometry(b,{keyboardVisible:true,keyboardPlacement:'below',cssWidth:s.width,availableHeight:2160});
 assert.equal(s.width,1280);assert.ok(g.height*s.scale<2160);assert.ok(g.inputCard.keyboard!.h*s.scale>=150);assert.ok(g.inputCard.keyboard!.y*s.scale>=720);assert.ok(g.inputCard.card.y*s.scale<720);assert.ok(g.player.y*s.scale<720);
});
test('portrait or hidden keyboard ignores placement without changing default anchors',()=>{
 for(const portrait of[true,false]){const b=responsiveLayout(portrait),hidden=learningGeometry(b,{keyboardVisible:false,keyboardPlacement:'below'}),normal=learningGeometry(b,{keyboardVisible:false});assert.equal(JSON.stringify(hidden),JSON.stringify(normal))}
 const b=responsiveLayout(true);assert.equal(JSON.stringify(learningGeometry(b,{keyboardVisible:true,keyboardPlacement:'below'})),JSON.stringify(learningGeometry(b,{keyboardVisible:true})));
});
