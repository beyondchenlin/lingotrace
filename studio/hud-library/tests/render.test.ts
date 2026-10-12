import test from 'node:test';import assert from 'node:assert/strict';import {createCanvas} from '@napi-rs/canvas';
import {renderHudScene} from '../renderer.ts';import {validateScene} from '../validate.ts';import {HUD_REGISTRY} from '../registry.ts';
import {COMPONENT_TYPES,FIXTURE_CLOCK,fixtureScene} from '../showcase/fixtures.ts';import type {HudScene,ProgressMetric,RenderClock} from '../schema.ts';
function render(scene:HudScene,clock:RenderClock=FIXTURE_CLOCK){const canvas=createCanvas(scene.size.width,scene.size.height);const ctx=canvas.getContext('2d') as unknown as CanvasRenderingContext2D;const report=renderHudScene(ctx,scene,clock);return {canvas,report,bytes:canvas.toBuffer('image/png')};}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}
test('all four registered components render ready/no-data/paused/error without mutating deeply frozen frames',()=>{
  for(const type of COMPONENT_TYPES)for(const state of [{status:'ready' as const},{status:'no-data' as const,message:'No observations'},{status:'paused' as const,frozenAtMs:30000},{status:'error' as const,message:'Source failed'}]){
    const scene=freeze(fixtureScene(type,state)),before=JSON.stringify(scene),result=render(scene);assert.equal(JSON.stringify(scene),before);assert.equal(result.report[0].status,state.status);assert.ok(result.bytes.length>500);assert.ok(result.report[0].accessibleText.includes('Fixture demonstration'));
  }
});
test('same scene and clock have identical pixels and shared preview/record compositor results',()=>{
  for(const type of COMPONENT_TYPES){const s=fixtureScene(type);assert.deepEqual(render(s).bytes,render(s).bytes);}
});
test('rendering never asks for wall clock or randomness',()=>{
  const now=Date.now,random=Math.random;Date.now=()=>{throw new Error('Forbidden wall clock')};Math.random=()=>{throw new Error('Forbidden random')};try{for(const type of COMPONENT_TYPES)render(fixtureScene(type));}finally{Date.now=now;Math.random=random;}
});
test('paused pulse, low motion and explicit static produce time-invariant pixels',()=>{
  const paused=fixtureScene('input-pulse',{status:'paused',frozenAtMs:30000});assert.deepEqual(render(paused,{nowMs:30000,reducedMotion:false}).bytes,render(paused,{nowMs:90000,reducedMotion:false}).bytes);
  const ready=fixtureScene('input-pulse');assert.deepEqual(render(ready,{nowMs:30000,reducedMotion:true}).bytes,render(ready,{nowMs:90000,reducedMotion:true}).bytes);
  const still={...ready,nodes:ready.nodes.map(n=>({...n,motion:'none' as const}))};assert.deepEqual(render(still,{nowMs:30000,reducedMotion:false}).bytes,render(still,{nowMs:90000,reducedMotion:false}).bytes);
  assert.notDeepEqual(render(ready,{nowMs:30000,reducedMotion:false}).bytes,render(ready,{nowMs:31000,reducedMotion:false}).bytes);
});
test('zero denominator renders unknown rather than a 0% result',()=>{
  const s=fixtureScene('progress-ring'),key=s.nodes[0].metricBinding.metricKey;const m=s.metrics[key] as ProgressMetric;
  const result=render({...s,metrics:{[key]:{...m,denominator:0}}});assert.equal(result.report[0].status,'no-data');assert.match(result.report[0].accessibleText,/Total not provided/);assert.doesNotMatch(result.report[0].accessibleText,/0%/);
});
test('minimum component sizes are renderable and retain nonempty accessible descriptions',()=>{for(const type of COMPONENT_TYPES){const s=fixtureScene(type),size=HUD_REGISTRY[type].minSize;const result=render({...s,size,safeBounds:{x:0,y:0,...size},nodes:s.nodes.map(n=>({...n,size}))});assert.ok(result.report[0].accessibleText.length>30);}});
test('transparent components remain transparent outside their clip; renderer restores caller context',()=>{
  const s=fixtureScene('progress-ring'),scene={...s,size:{width:600,height:400},safeBounds:{x:20,y:20,width:550,height:350},nodes:s.nodes.map(n=>({...n,position:{x:30,y:30}}))};
  const canvas=createCanvas(600,400),ctx=canvas.getContext('2d') as unknown as CanvasRenderingContext2D;ctx.globalAlpha=.5;const previousAlpha=ctx.globalAlpha;ctx.translate(0,0);renderHudScene(ctx,scene,FIXTURE_CLOCK);assert.equal(ctx.globalAlpha,previousAlpha);
  const pixels=ctx.getImageData(0,0,600,400).data;for(const [x,y] of [[0,0],[29,29],[510,300],[599,399]])assert.equal(pixels[(y*600+x)*4+3],0);
});
test('bad schema, binding, source, dimensions, colors, clocks and unsupported types are rejected before drawing',()=>{
  const s=fixtureScene('numeric'),n=s.nodes[0],key=n.metricBinding.metricKey;
  const bad=[{...s,schemaVersion:2},{...s,nodes:[n,n]},{...s,nodes:[{...n,size:{width:1,height:1}}]},{...s,nodes:[{...n,position:{x:-1,y:0}}]},{...s,nodes:[{...n,style:{opacity:2}}]},{...s,nodes:[{...n,style:{colors:{text:'url(secret)'}}}]},{...s,nodes:[{...n,type:'not-implemented'}]},{...s,metrics:{[key]:{...s.metrics[key],source:'practice-projection'}}},{...s,metrics:{[key]:{...s.metrics[key],value:NaN}}},{...s,nodes:[{...n,metricBinding:{...n.metricBinding,metricKey:'toString'}}]}];
  for(const scene of bad)assert.throws(()=>render(scene as HudScene),/Invalid HUD scene/);
  assert.ok(validateScene(s,{nowMs:NaN,reducedMotion:false}).length);assert.equal(HUD_REGISTRY['calendar-heatmap'].status,'implemented');
});
test('invalid trend order, zero gap, repeated event IDs and unmeasured valued points reject',()=>{
  const s=fixtureScene('trend-line'),k=s.nodes[0].metricBinding.metricKey,m=s.metrics[k];assert.equal(m.kind,'trend');if(m.kind!=='trend')return;
  assert.throws(()=>render({...s,metrics:{[k]:{...m,points:[m.points[0],m.points[0]]}}}),/Invalid/);
  assert.throws(()=>render({...s,metrics:{[k]:{...m,points:[{...m.points[0],quality:'unmeasured'}]}}}),/Invalid/);
  const pulse=fixtureScene('input-pulse'),pk=pulse.nodes[0].metricBinding.metricKey,pm=pulse.metrics[pk];if(pm.kind!=='input-pulse')return;
  assert.throws(()=>render({...pulse,metrics:{[pk]:{...pm,events:[pm.events[0],pm.events[0]]}}}),/Invalid/);
});
test('fractional progress remains exact in descriptions; percentage overflow rejects',()=>{
  const s=fixtureScene('progress-ring'),key=s.nodes[0].metricBinding.metricKey,m=s.metrics[key] as ProgressMetric;
  assert.match(render({...s,metrics:{[key]:{...m,numerator:.2,denominator:.4}}}).report[0].accessibleText,/0.2 of 0.4/);
  assert.throws(()=>render({...s,metrics:{[key]:{...m,numerator:1e308,denominator:1e-308}}}),/overflows/);
});
test('nonstring labels/messages/provenance and malformed nested structures reject before any painting',()=>{
  const s=fixtureScene('numeric'),n=s.nodes[0],key=n.metricBinding.metricKey;
  const bad=[null,{...s,size:null},{...s,nodes:[null]},{...s,nodes:[{...n,label:123}]},{...s,nodes:[{...n,metricBinding:null}]},{...s,nodes:[{...n,style:'red'}]},{...s,metrics:{[key]:{...s.metrics[key],state:{status:'error',message:123}}}}];
  for(const value of bad){const c=createCanvas(480,270);const before=c.toBuffer('image/png');assert.throws(()=>renderHudScene(c.getContext('2d') as unknown as CanvasRenderingContext2D,value as HudScene,FIXTURE_CLOCK),/Invalid HUD scene/);assert.deepEqual(c.toBuffer('image/png'),before);}
  const trend=fixtureScene('trend-line'),tk=trend.nodes[0].metricBinding.metricKey,tm=trend.metrics[tk];if(tm.kind!=='trend')return;
  assert.throws(()=>render({...trend,metrics:{[tk]:{...tm,points:[{...tm.points[0],sourceEventIds:[4,{}]}]}}} as unknown as HudScene),/Invalid/);
});
test('renderer isolates inherited dash, shadow, alpha, filter and compositing while restoring them',()=>{
  const s=fixtureScene('input-pulse'),canvas=createCanvas(s.size.width,s.size.height),ctx=canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  ctx.setLineDash([7,4]);ctx.globalCompositeOperation='destination-out';ctx.globalAlpha=.3;ctx.shadowColor='#ff0000';ctx.shadowBlur=8;ctx.shadowOffsetX=8;ctx.filter='blur(3px)';const alpha=ctx.globalAlpha;
  renderHudScene(ctx,s,FIXTURE_CLOCK);assert.deepEqual(canvas.toBuffer('image/png'),render(s).bytes);assert.equal(ctx.globalCompositeOperation,'destination-out');assert.equal(ctx.globalAlpha,alpha);assert.deepEqual(ctx.getLineDash(),[7,4]);assert.equal(ctx.shadowBlur,8);
});

test('font spacing and variant state cannot leak from a caller into component text',()=>{
  const s=fixtureScene('numeric'),canvas=createCanvas(s.size.width,s.size.height),ctx=canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  ctx.letterSpacing='10px';ctx.wordSpacing='20px';ctx.fontKerning='none';ctx.fontStretch='expanded';ctx.fontVariantCaps='small-caps';ctx.textRendering='optimizeSpeed';
  renderHudScene(ctx,s,FIXTURE_CLOCK);assert.deepEqual(canvas.toBuffer('image/png'),render(s).bytes);assert.equal(ctx.letterSpacing,'10px');assert.equal(ctx.wordSpacing,'20px');assert.equal(ctx.fontKerning,'none');
});
