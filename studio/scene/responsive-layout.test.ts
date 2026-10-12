import test from 'node:test';
import assert from 'node:assert/strict';
import {responsiveLayout,PORTRAIT_RECTS,PORTRAIT_CONTENT_BOTTOM,portraitRects,portraitContentBottom,resolvePortraitHeight,PORTRAIT_MIN_HEIGHT} from './responsive-layout';
import {CONSOLE_RECT,PLAYER_RECT,DEFAULT_RECTS,ZONES,rectStyle,cueMarkerRect,timelinePointerProgress,insetRect,type Rect} from './transparent-layout';

const overlap=(a:Rect,b:Rect)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
test('landscape geometry preserves original rectangles, style projection, cue targets and pointer mapping',()=>{
 for(const mode of ['lesson','camera','split'] as const){
  const geometry=responsiveLayout(false,{},mode);
  assert.equal(geometry.width,1672);assert.equal(geometry.height,941);assert.equal(geometry.inputScale,1);
  assert.deepEqual(geometry.zones,ZONES);assert.deepEqual(geometry.console,CONSOLE_RECT);assert.deepEqual(geometry.player,PLAYER_RECT);
  assert.deepEqual(geometry.inset,insetRect(mode));assert.deepEqual(geometry.metrics,DEFAULT_RECTS.metrics);assert.deepEqual(geometry.subtitle,DEFAULT_RECTS.subtitle);
  assert.deepEqual(geometry.media,mode==='split'?{x:0,y:0,w:1133,h:735}:DEFAULT_RECTS.media);
  assert.deepEqual(geometry.style(geometry.metrics),rectStyle(geometry.metrics));
  for(const ratio of [0,.25,.5,1])assert.deepEqual(geometry.cueMarker(ratio),cueMarkerRect(ratio));
  for(const point of [200,900,1500])assert.equal(geometry.timelineProgress(point,40,1280),timelinePointerProgress(point,40,1280));
 }
});
test('portrait resolves a bounded surface and independent controls at short, default and tall heights',()=>{
 for(const height of [PORTRAIT_MIN_HEIGHT,840,880,940,1080,1400]){
 const g=responsiveLayout(true,{},'lesson',height);
 assert.equal(g.width,430);assert.equal(g.height,height);
 for(const rect of [g.media,g.inset,g.metrics,g.subtitle,g.console,g.player,g.goal,g.title,g.trend,g.counter,...Object.values(g.zones)]){
  assert.ok(rect.x>=0&&rect.y>=0&&rect.w>0&&rect.h>0);
  assert.ok(rect.x+rect.w<=g.width+1e-8&&rect.y+rect.h<=g.height+1e-8,JSON.stringify(rect));
 }
 for(const key of ['input','submit','play','previous','next','mute'] as const){assert.ok(g.zones[key].w>=44);assert.ok(g.zones[key].h>=44)}
 for(const [a,b] of [['input','submit'],['seek','play'],['seek','previous'],['seek','next'],['seek','mute'],['previous','next']] as const)assert.equal(overlap(g.zones[a],g.zones[b]),0);
 assert.equal(g.zones.input.y+g.zones.input.h/2,g.zones.submit.y+g.zones.submit.h/2);
 assert.equal(g.inputScale,402/722);
 assert.equal(g.console.y-portraitContentBottom(height),16);
 assert.deepEqual(portraitRects(height),{media:g.media,inset:g.inset,metrics:g.metrics,subtitle:g.subtitle});
 for(const rect of Object.values(portraitRects(height)))assert.ok(rect.y+rect.h<=portraitContentBottom(height));
 }
 assert.equal(PORTRAIT_MIN_HEIGHT,820);assert.equal(resolvePortraitHeight(700),820);assert.equal(resolvePortraitHeight(1800),1400);
 assert.equal(resolvePortraitHeight(NaN),1080);assert.equal(responsiveLayout(true,{},'lesson',700).height,820);
});
test('portrait restores the original anchors with uniform HUD shapes and no default panel overlaps',()=>{
 for(const height of [940,1080,1400]){
  const g=responsiveLayout(true,{},'lesson',height),extra=height-940;
  for(const [key,width,tall] of [['goal',264,264],['trend',352,192],['metrics',309,168],['inset',240,152],['subtitle',300,49],['counter',69,65]] as const){
   assert.ok(Math.abs(g[key].w/width-.58)<1e-12,key);assert.ok(Math.abs(g[key].h/tall-.58)<1e-12,key);
  }
  assert.equal(g.goal.x,14);assert.equal(g.goal.y,104);assert.equal(g.trend.y,g.goal.y);
  assert.ok(g.trend.x>g.goal.x+g.goal.w);assert.ok(g.inset.x>g.goal.x+g.goal.w);
  assert.equal(g.inset.y,228);assert.equal(g.media.y,330+.4*extra);
  assert.equal(g.metrics.x,14);assert.equal(g.metrics.y,586+.6*extra);
  assert.equal(g.subtitle.x+g.subtitle.w/2,215);assert.equal(g.subtitle.y,697+.75*extra);
  assert.equal(g.console.y,742+.9*extra);assert.equal(g.zones.seek.y,828+extra);assert.equal(g.zones.play.y,891+extra);
  assert.ok(g.metrics.y>=g.media.y+g.media.h);assert.ok(g.subtitle.y>=g.metrics.y+g.metrics.h);
  const panels=[g.goal,g.trend,g.inset,g.media,g.metrics,g.subtitle,g.console,g.player,g.counter];
  for(let a=0;a<panels.length;a++)for(let b=a+1;b<panels.length;b++)assert.equal(overlap(panels[a],panels[b]),0,`${height}: ${a}/${b}`);
 }
});
test('all twelve portrait cue targets are independent, and CSS pointer positions match the painted rail',()=>{
 const g=responsiveLayout(true),targets=Array.from({length:12},(_,i)=>g.cueMarker(i/12));
 for(const [i,rect]of targets.entries()){
  assert.ok(rect.w>=24&&rect.h>=24);assert.ok(rect.x>=0&&rect.x+rect.w<=g.width);
  assert.ok(rect.y>=g.zones.seek.y&&rect.y+rect.h<=g.zones.seek.y+g.zones.seek.h);
  if(i)assert.equal(overlap(targets[i-1],rect),0);
 }
 for(const cssWidth of [320,375,390,430,540])for(const ratio of [0,.25,.5,.75,1]){
  const logicalX=g.zones.seek.x+20+(g.zones.seek.w-40)*ratio,clientX=23+logicalX*cssWidth/g.width;
  assert.ok(Math.abs(g.timelineProgress(clientX,23,cssWidth)-ratio)<1e-12);
 }
});
test('native input and Canvas share glyph scale, padding, scroll distance and expanded optical center',()=>{
 const g=responsiveLayout(true),zone=g.zones.input,scale=g.inputScale;
 assert.equal(zone.x,g.console.x+(ZONES.input.x-CONSOLE_RECT.x)*scale);
 assert.ok(Math.abs(zone.y+zone.h/2-(g.console.y+(ZONES.input.y-CONSOLE_RECT.y+32)*scale))<1e-10);
 for(const stageWidth of [320,430,860]){
  const cssScale=stageWidth/430,cssScroll=37,canonicalScroll=cssScroll/(cssScale*scale);
  assert.ok(Math.abs(canonicalScroll*scale*cssScale-cssScroll)<1e-10);
  assert.ok(34*scale*cssScale>14);
 }
});
test('portrait overrides are independent, finite, bounded and never mutate saved preferences or defaults',()=>{
 const saved={inset:{x:30,y:460,w:168,h:140},metrics:{x:500,y:900,w:600,h:200}},before=JSON.stringify(saved),defaults=JSON.stringify(PORTRAIT_RECTS);
 const geometry=responsiveLayout(true,saved);
 assert.deepEqual(geometry.inset,saved.inset);
 assert.ok(geometry.metrics.x+geometry.metrics.w<=430);assert.ok(geometry.metrics.y+geometry.metrics.h<=PORTRAIT_CONTENT_BOTTOM);
 assert.deepEqual(responsiveLayout(true,{inset:{x:NaN,y:1,w:1,h:1}}).inset,PORTRAIT_RECTS.inset);
 geometry.inset.x=9;geometry.zones.input.x=7;
 assert.equal(JSON.stringify(saved),before);assert.equal(JSON.stringify(PORTRAIT_RECTS),defaults);
 assert.notEqual(responsiveLayout(true).zones.input.x,7);
});
test('portrait split preserves two separate contained media windows and keeps explicit layout edits',()=>{
 for(const height of [PORTRAIT_MIN_HEIGHT,840,880,940,1080,1400]){
 const lesson=responsiveLayout(true,{},'lesson',height),split=responsiveLayout(true,{},'split',height);
 assert.equal(overlap(split.media,split.inset),0);
 const width=270;
 assert.deepEqual(split.media,{x:0,y:lesson.media.y,w:width,h:width*9/16});
 assert.deepEqual(split.inset,{...lesson.inset,y:lesson.media.y});
 assert.equal(split.media.w/split.media.h,16/9);assert.ok(Math.abs(split.inset.w/split.inset.h-240/152)<1e-12);
 for(const key of ['metrics','subtitle','goal','title','trend','console'] as const)assert.deepEqual(split[key],lesson[key]);
 }
 const custom={media:{x:10,y:330,w:250,h:200},inset:{x:290,y:365,w:120,h:160}};
 const edited=responsiveLayout(true,custom,'split');
 assert.deepEqual(edited.media,custom.media);assert.deepEqual(edited.inset,custom.inset);
});

test('compact portrait preserves full-width media and HUD proportions with one intentional camera PiP overlap',()=>{
 for(const height of [700,800,PORTRAIT_MIN_HEIGHT,840,880,940]){
  const g=responsiveLayout(true,{},'lesson',height),scale=g.goal.w/264;
  assert.ok(Math.abs(scale-.58)<1e-12);
  assert.equal(g.height,Math.max(PORTRAIT_MIN_HEIGHT,height));
  for(const [key,width,tall] of [['goal',264,264],['trend',352,192],['metrics',309,168],['inset',240,152],['counter',69,65]] as const){
   assert.ok(Math.abs(g[key].w/width-scale)<1e-12,key);assert.ok(Math.abs(g[key].h/tall-scale)<1e-12,key);
  }
  assert.equal(g.media.w/g.media.h,16/9);assert.equal(g.media.w,430);assert.equal(g.media.x,0);
  assert.equal(g.goal.x,14);assert.equal(g.goal.y,g.trend.y);assert.equal(g.metrics.x,14);
  assert.ok(g.trend.x>g.goal.x+g.goal.w);assert.ok(g.inset.x>g.goal.x+g.goal.w);
  assert.equal(g.subtitle.x+g.subtitle.w/2,215);
  const panels=[g.zones.title,g.goal,g.trend,g.inset,g.media,g.metrics,g.subtitle,g.console,g.player,g.counter];
  for(let a=0;a<panels.length;a++)for(let b=a+1;b<panels.length;b++){
   if(a===3&&b===4)continue; // The transparent camera remains a real PiP over the upper-right media corner.
   assert.equal(overlap(panels[a],panels[b]),0,`${height}: ${a}/${b}`);
  }
  if(g.height===PORTRAIT_MIN_HEIGHT){
   assert.ok(Math.abs(g.inset.y+g.inset.h-g.media.y-42.16)<1e-8);
   assert.equal(g.zones.title.h,60);assert.ok(g.zones.title.y+g.zones.title.h<g.goal.y);
  }
  assert.ok(g.inset.x>g.media.x+g.media.w/2);assert.ok(g.inset.y+g.inset.h<g.media.y+g.media.h);
  for(const rect of Object.values(portraitRects(height)))assert.ok(g.console.y-(rect.y+rect.h)>=16-1e-8);
  assert.ok(g.console.y+g.console.h<g.player.y);
  assert.equal(g.zones.play.y+g.zones.play.h,g.height-5);
  const targets=Array.from({length:12},(_,i)=>g.cueMarker(i/12));
  for(const [i,target] of targets.entries()){
   assert.ok(target.x>=0&&target.y>=0&&target.x+target.w<=g.width&&target.y+target.h<=g.height);
   if(i)assert.equal(overlap(targets[i-1],target),0);
   for(const key of ['input','submit','play','previous','next','mute'] as const)assert.equal(overlap(target,g.zones[key]),0);
  }
 }
});
