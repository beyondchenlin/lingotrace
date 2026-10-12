import test from 'node:test';
import assert from 'node:assert/strict';
import {parseArrangement,type Arrangement,type Movable,type Rect} from './transparent-layout';
import {PORTRAIT_WIDTH,PORTRAIT_HEIGHT,PORTRAIT_CONTENT_BOTTOM,PORTRAIT_RECTS,responsiveLayout,portraitRects,portraitContentBottom} from './responsive-layout';
import {constrainPortraitRect,movePortraitRect,scalePortraitRect,dockPortraitRect,keyboardPortraitRect,parsePortraitArrangement,parseResponsiveArrangement,portraitPointerDelta,portraitRectFor,portraitRectStyle} from './responsive-editor';

const keys=Object.keys(PORTRAIT_RECTS) as Movable[];
const near=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} should equal ${expected}`);
function assertSafe(rect:Rect){
 assert.ok(Object.values(rect).every(Number.isFinite));
 assert.ok(rect.w>0&&rect.h>0&&rect.x>=0&&rect.y>=0);
 assert.ok(rect.x+rect.w<=PORTRAIT_WIDTH+1e-8);
 assert.ok(rect.y+rect.h<=PORTRAIT_CONTENT_BOTTOM+1e-8);
 assert.ok(rect.y+rect.h<responsiveLayout(true).console.y);
}

test('all four portrait editor defaults match the live scene without a first-drag jump',()=>{
 for(const mode of ['lesson','camera','split'] as const){
  const scene=responsiveLayout(true,{},mode);
  const base:Arrangement={media:scene.media,inset:scene.inset,subtitle:scene.subtitle,metrics:scene.metrics};
  for(const key of keys){
   const rect=portraitRectFor(key,base);
   assert.deepEqual(rect,scene[key]);
   assert.deepEqual(constrainPortraitRect(key,rect),rect);
   assert.deepEqual(portraitRectStyle(rect),scene.style(rect));
   assertSafe(rect);
  }
 }
});

test('portrait dragging and scaling preserve aspect within bounds above the fixed console',()=>{
 for(const key of keys)for(const ratio of [PORTRAIT_RECTS[key].w/PORTRAIT_RECTS[key].h,.01,1,100])for(const width of [1,90,430,99999])for(const position of [-1000,400,9999]){
  const rect=constrainPortraitRect(key,{x:position,y:position,w:width,h:width/ratio});
  assertSafe(rect);
  near(rect.w/rect.h,ratio);
  const scaled=scalePortraitRect(key,rect,width-200);
  assertSafe(scaled);
  near(scaled.w/scaled.h,ratio);
 }
});

test('moving every original movable item retains its size and cannot cover fixed controls',()=>{
 for(const key of keys){
  const original=PORTRAIT_RECTS[key];
  for(const [dx,dy]of [[-2000,-2000],[2000,2000],[-2000,2000],[2000,-2000]]){
   const moved=movePortraitRect(key,original,dx,dy);
   assertSafe(moved);
   assert.equal(moved.w,original.w);
   assert.equal(moved.h,original.h);
  }
 }
});

test('all four docks place every movable item on the requested safe edge',()=>{
 for(const key of keys)for(const dock of ['top-left','top-right','bottom-left','bottom-right']as const){
  const original=PORTRAIT_RECTS[key],rect=dockPortraitRect(key,original,dock);
  assertSafe(rect);
  near(rect.x,dock.endsWith('right')?PORTRAIT_WIDTH-rect.w:0);
  near(rect.y,dock.startsWith('bottom')?PORTRAIT_CONTENT_BOTTOM-rect.h:0);
  near(rect.w/rect.h,original.w/original.h);
 }
});

test('portrait keyboard arrows, plus/minus and Shift use the same move and scale bounds',()=>{
 for(const key of keys)for(const shift of [false,true]){
  const rect=PORTRAIT_RECTS[key],step=shift?20:4;
  for(const [code,dx,dy]of [['ArrowLeft',-step,0],['ArrowRight',step,0],['ArrowUp',0,-step],['ArrowDown',0,step]]as const){
   assert.deepEqual(keyboardPortraitRect(key,rect,code,shift),movePortraitRect(key,rect,dx,dy));
  }
  for(const code of ['+','='])assert.deepEqual(keyboardPortraitRect(key,rect,code,shift),scalePortraitRect(key,rect,shift?100:25));
  for(const code of ['-','_'])assert.deepEqual(keyboardPortraitRect(key,rect,code,shift),scalePortraitRect(key,rect,shift?-100:-25));
  assert.equal(keyboardPortraitRect(key,rect,'a',shift),null);
 }
});

test('portrait pointer deltas use actual stage width and height at each viewport scale',()=>{
 for(const cssWidth of [320,390,430,768])for(const heightScale of [1,.8,1.2]){
  const cssHeight=cssWidth*PORTRAIT_HEIGHT/PORTRAIT_WIDTH*heightScale;
  const delta=portraitPointerDelta(17*cssWidth/PORTRAIT_WIDTH,29*cssHeight/PORTRAIT_HEIGHT,cssWidth,cssHeight);
  near(delta.dx,17);
  near(delta.dy,29);
 }
 assert.deepEqual(portraitPointerDelta(10,10,0,0),{dx:0,dy:0});
});

test('saved portrait layout keeps its coordinate space while landscape parsing stays unchanged',()=>{
 const saved:Arrangement={subtitle:{x:14,y:760,w:402,h:56},inset:{x:999,y:999,w:2000,h:1000}};
 const copy=JSON.stringify(saved),parsed=parseResponsiveArrangement(saved,true);
 assert.deepEqual(parsed.subtitle,saved.subtitle);
 assertSafe(parsed.inset!);
 assert.deepEqual(parseResponsiveArrangement(saved,false),parseArrangement(saved));
 assert.deepEqual(parseResponsiveArrangement(saved),parseArrangement(saved));
 assert.equal(JSON.stringify(saved),copy);
 assert.deepEqual(parsePortraitArrangement({media:{x:NaN,y:0,w:430,h:200},inset:{x:1,y:1,w:Infinity,h:20},unknown:{x:0,y:0,w:10,h:10}}),{});
 assert.deepEqual(parsePortraitArrangement(null),{});
 for(const key of keys)assertSafe(constrainPortraitRect(key,{x:Infinity,y:NaN,w:-1,h:0}));
});

test('resetting one portrait item restores its original rectangle and keeps other saved positions',()=>{
 const initial:Arrangement=Object.fromEntries(keys.map(key=>[key,movePortraitRect(key,PORTRAIT_RECTS[key],-14,-16)]));
 const snapshot=JSON.stringify(initial);
 for(const key of keys){
  const next={...initial};delete next[key];
  assert.deepEqual(portraitRectFor(key,next),PORTRAIT_RECTS[key]);
  for(const other of keys.filter(item=>item!==key))assert.deepEqual(portraitRectFor(other,next),initial[other]);
 }
 assert.equal(JSON.stringify(initial),snapshot);
});

test('resetting a saved inset aligns the editor overlay with the Canvas default for each layout mode',()=>{
 for(const mode of ['lesson','camera','split'] as const){
  const defaults=responsiveLayout(true,{},mode);
  const base:Arrangement={media:defaults.media,inset:defaults.inset,subtitle:defaults.subtitle,metrics:defaults.metrics};
  const saved:Arrangement={inset:movePortraitRect('inset',defaults.inset,-100,40),subtitle:movePortraitRect('subtitle',defaults.subtitle,0,-100)};
  const savedSnapshot=JSON.stringify(saved);
  const beforeReset=responsiveLayout(true,saved,mode);
  assert.deepEqual(portraitRectFor('inset',{...base,...saved}),beforeReset.inset);
  const next={...saved};delete next.inset;
  const scene=responsiveLayout(true,next,mode),overlay=portraitRectFor('inset',{...base,...next});
  assert.deepEqual(overlay,defaults.inset);
  assert.deepEqual(overlay,scene.inset);
  assert.deepEqual(portraitRectStyle(overlay),scene.style(scene.inset));
  assert.notDeepEqual(overlay,saved.inset);
  assert.deepEqual(scene.subtitle,saved.subtitle);
  assert.equal(JSON.stringify(saved),savedSnapshot);
 }
});


test('dynamic portrait heights use one scene, editor, pointer and hit coordinate space',()=>{
 for(const height of [820,860,940,1080,1400])for(const mode of ['lesson','camera','split'] as const){
  const scene=responsiveLayout(true,{},mode, height),bottom=portraitContentBottom(height);
  for(const key of keys){
   const rect=scene[key],base:Arrangement={[key]:rect};
   assert.deepEqual(portraitRectFor(key,base,height),rect);
   assert.deepEqual(constrainPortraitRect(key,rect,height),rect);
   assert.deepEqual(portraitRectStyle(rect,height),scene.style(rect));
   const docked=dockPortraitRect(key,rect,'bottom-right',height);
   near(docked.y+docked.h,bottom);near(docked.x+docked.w,PORTRAIT_WIDTH);
   assert.ok(docked.y+docked.h<scene.console.y);
   const moved=keyboardPortraitRect(key,rect,'ArrowDown',true,height)!;
   assert.ok(moved.y+moved.h<=bottom+1e-8);
   near(moved.w/moved.h,rect.w/rect.h);
  }
  for(const cssWidth of [320,390,430,768]){
   const cssHeight=cssWidth*height/PORTRAIT_WIDTH;
   const delta=portraitPointerDelta(17*cssWidth/PORTRAIT_WIDTH,29*cssHeight/height,cssWidth,cssHeight,height);
   near(delta.dx,17);near(delta.dy,29);
  }
 }
});

test('height-specific bounds do not mutate saved layout objects or the other orientation',()=>{
 const saved:Arrangement={media:{x:12,y:600,w:350,h:196.875},subtitle:{x:100,y:900,w:250,h:41}};
 const before=JSON.stringify(saved);
 for(const height of [820,860,940,1080,1400]){
  const parsed=parsePortraitArrangement(saved,height);
  for(const key of Object.keys(parsed) as Movable[])assert.ok(parsed[key]!.y+parsed[key]!.h<=portraitContentBottom(height)+1e-8);
  assert.equal(JSON.stringify(saved),before);
  assert.deepEqual(parseResponsiveArrangement(saved,false),parseArrangement(saved));
 }
});


test('saved tall-layout positions align editor and Canvas after a short portrait resize',()=>{
 const saved:Arrangement={metrics:{x:14,y:900,w:179.22,h:97.44}};
 const before=JSON.stringify(saved),scene=responsiveLayout(true,saved,'lesson',940);
 const overlay=portraitRectFor('metrics',{metrics:scene.metrics,...saved},940);
 assert.deepEqual(overlay,scene.metrics);
 assert.ok(overlay.y+overlay.h<=portraitContentBottom(940));
 assert.equal(JSON.stringify(saved),before);
});
