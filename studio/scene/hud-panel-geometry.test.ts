import test from 'node:test';
import assert from 'node:assert/strict';
import {learningGeometry} from './learning-surface';
import {responsiveLayout} from './responsive-layout';
import {hudBackingRect,hudPanelBackingRects} from './hud-panel-backing';
import {cameraControlGeometry} from './camera-control';
import {DEFAULT_RECTS} from './transparent-layout';
import type {Rect} from './layout';

const contains=(outer:Rect,inner:Rect)=>outer.x<=inner.x&&outer.y<=inner.y&&outer.x+outer.w>=inner.x+inner.w&&outer.y+outer.h>=inner.y+inner.h;

test('desktop backing rails stay aligned through Fixed/Follow, native/half/Fit and all keyboard modes without changing content geometry',()=>{
 for(const cssWidth of[320,560,640,960,1280,1672,1920])for(const mode of['fixed','follow'] as const)for(const size of[.8,1,1.15])for(const videoSize of['native','half','fit'] as const)for(const keyboard of['inside','below','hidden'] as const){
  const g=learningGeometry(responsiveLayout(false),{keyboardVisible:keyboard!=='hidden',keyboardPlacement:keyboard==='below'?'below':'inside',cssWidth,hud:{mode,size},videoSize}),before=JSON.stringify(g),camera=cameraControlGeometry(g,'off','lesson',{cssWidth}).visual,p=hudPanelBackingRects(g,camera);
  assert.equal(p.goal.y,p.title.y);assert.equal(p.goal.y,p.trend.y);
  if(g.metrics.x===DEFAULT_RECTS.metrics.x)assert.equal(p.goal.x,p.flow.x);
  for(const [key,content]of Object.entries({goal:g.goal,title:g.title,trend:g.trend,flow:g.metrics,camera,typing:g.inputCard.card,transport:g.player,...g.inputCard.keyboard?{keyboard:g.inputCard.keyboard}:{}}))assert.ok(contains(p[key],content),`${cssWidth} ${mode}/${size} ${videoSize} ${keyboard}: ${key}`);
  for(const [key,content]of Object.entries({camera,typing:g.inputCard.card,transport:g.player,...g.inputCard.keyboard?{keyboard:g.inputCard.keyboard}:{}}))assert.deepEqual(p[key],hudBackingRect(content),`${key}: unchanged non-HUD plate`);
  assert.equal(JSON.stringify(g),before,'content, hit zones, media, layout anchors and input fonts stay untouched');
 }
});

test('default desktop outer edges match the user screenshot correction without resizing content',()=>{
 const g=learningGeometry(responsiveLayout(false),{keyboardVisible:true,keyboardPlacement:'below',cssWidth:1280});
 const p=hudPanelBackingRects(g,g.inset);
 assert.equal(p.goal.x,25);assert.equal(p.flow.x,25);assert.equal(p.goal.y,32);assert.equal(p.title.y,32);assert.equal(p.trend.y,32);
 assert.equal(p.goal.y+p.goal.h,g.goal.y+g.goal.h+6);assert.equal(p.trend.y+p.trend.h,g.trend.y+g.trend.h+6);
 assert.equal(p.flow.x+p.flow.w,g.metrics.x+g.metrics.w+7);
});

test('portrait keeps its stacked title and every previous backing rectangle',()=>{
 for(const height of[820,840,940,1080,1400])for(const cssWidth of[320,390,430,540])for(const mode of['follow','fixed'] as const){
  const g=learningGeometry(responsiveLayout(true,{},'lesson',height),{keyboardVisible:true,cssWidth,hud:{mode,size:1.15}}),p=hudPanelBackingRects(g,g.inset);
  for(const [key,content]of Object.entries({goal:g.goal,title:g.title,trend:g.trend,flow:g.metrics,camera:g.inset,typing:g.inputCard.card,transport:g.player,...g.inputCard.keyboard?{keyboard:g.inputCard.keyboard}:{}}))assert.deepEqual(p[key],hudBackingRect(content));
 }
});

test('a horizontally moved flow remains at its own saved anchor and saved rectangles are never mutated',()=>{
 for(const x of[0,12,80,540,1100]){
  const arrangement={metrics:{x,y:250,w:300,h:160}},before=JSON.stringify(arrangement),g=learningGeometry(responsiveLayout(false,arrangement),{keyboardVisible:false,cssWidth:1280}),p=hudPanelBackingRects(g,g.inset);
  assert.equal(g.metrics.x,x);assert.deepEqual(p.flow,hudBackingRect(g.metrics));assert.equal(JSON.stringify(arrangement),before);
 }
});
