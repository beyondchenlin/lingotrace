import test from 'node:test';import assert from 'node:assert/strict';import {createCanvas} from '@napi-rs/canvas';
import {batch2FixtureScene,BATCH2_CLOCK,BATCH2_TYPES} from '../showcase/batch2-fixtures.ts';import {renderHudScene} from '../renderer.ts';import {validateScene} from '../validate.ts';import {effectiveState} from '../metrics.ts';import {targetPosition} from '../components/target-band.ts';import {HUD_REGISTRY} from '../registry.ts';import {calendarCells} from '../calendar.ts';
import type {BarMetric,CalendarMetric,HudMetric,HudScene,RenderClock,TargetBandMetric} from '../schema.ts';
function render(scene:HudScene,clock:RenderClock=BATCH2_CLOCK){const c=createCanvas(scene.size.width,scene.size.height);const report=renderHudScene(c.getContext('2d') as unknown as CanvasRenderingContext2D,scene,clock);return{bytes:c.toBuffer('image/png'),report};}
function metric<T>(scene:HudScene){return Object.values(scene.metrics)[0] as T;}
function withMetric(scene:HudScene,value:HudMetric):HudScene{return{...scene,metrics:{[scene.nodes[0].metricBinding.metricKey]:value}};}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const x of Object.values(value))freeze(x);Object.freeze(value);}return value;}

test('all three new registered components render four states from immutable scenes',()=>{
  for(const type of BATCH2_TYPES)for(const state of [{status:'ready' as const},{status:'no-data' as const,message:'No coverage'},{status:'paused' as const,frozenAtMs:30000},{status:'error' as const,message:'Read failed'}]){
    const scene=freeze(batch2FixtureScene(type,state)),before=JSON.stringify(scene),result=render(scene);assert.equal(result.report[0].status,state.status);assert.equal(before,JSON.stringify(scene));assert.match(result.report[0].accessibleText,/Fixture demonstration/);assert.ok(result.bytes.length>600);assert.equal(HUD_REGISTRY[type].status,'implemented');
  }
});
test('new components are static under explicit clocks and low-motion policies',()=>{for(const type of BATCH2_TYPES){const s=batch2FixtureScene(type);assert.deepEqual(render(s,{nowMs:30000,reducedMotion:false}).bytes,render(s,{nowMs:500000,reducedMotion:true}).bytes);}});
test('new component minimum sizes produce valid clipped frames and accessible descriptions',()=>{for(const type of BATCH2_TYPES){const s=batch2FixtureScene(type),size=HUD_REGISTRY[type].minSize;const r=render({...s,size,safeBounds:{x:0,y:0,...size},nodes:s.nodes.map(n=>({...n,size}))});assert.ok(r.report[0].accessibleText.length>70);}});
test('new components do not read current time, random values or modify sources',()=>{const now=Date.now,random=Math.random;Date.now=()=>{throw Error('Current time is forbidden')};Math.random=()=>{throw Error('Random values are forbidden')};try{for(const type of BATCH2_TYPES)render(batch2FixtureScene(type));}finally{Date.now=now;Math.random=random;}});

test('bar carries explicit sentence, duration and coverage meanings including actual zero',()=>{const s=batch2FixtureScene('bar-chart'),r=render(s);assert.match(r.report[0].accessibleText,/seconds/);assert.match(r.report[0].accessibleText,/SENTENCE 03: 0, complete coverage/);assert.match(r.report[0].accessibleText,/SENTENCE 04: unknown, unknown coverage/);assert.match(r.report[0].accessibleText,/12.4, partial coverage/);});
test('bar supports explicit non-overlapping intervals and count units without binning',()=>{
  const s=batch2FixtureScene('bar-chart'),m=metric<BarMetric>(s),value={...m,unit:'count' as const,grouping:{kind:'interval' as const,label:'Committed events / 5 seconds',intervalUnit:'seconds' as const},groups:[{id:'a',label:'First interval',value:3,coverage:'complete' as const,sourceEventIds:['a'],interval:{start:0,end:5}},{id:'b',label:'Second interval',value:0,coverage:'complete' as const,sourceEventIds:['b'],interval:{start:5,end:10}}]};
  const scene={...withMetric(s,value),nodes:s.nodes.map(n=>({...n,metricBinding:{...n.metricBinding,unit:'count' as const}}))};assert.match(render(scene).report[0].accessibleText,/interval 0 to 5 seconds/);assert.equal(metric<BarMetric>(scene).groups[1].value,0);
});
test('bar unknown, partial-null and complete zero cannot be confused',()=>{
  const s=batch2FixtureScene('bar-chart'),m=metric<BarMetric>(s);
  const zero={...m,groups:m.groups.map(g=>({...g,value:0,coverage:'complete' as const}))};assert.equal(effectiveState(zero).status,'ready');
  const unknown={...m,groups:m.groups.map(g=>({...g,value:null,coverage:'unknown' as const}))};assert.equal(effectiveState(unknown).status,'no-data');assert.notDeepEqual(render(withMetric(s,zero)).bytes,render(withMetric(s,unknown)).bytes);
  assert.deepEqual(validateScene(withMetric(s,{...m,groups:m.groups.map(g=>({...g,value:null,coverage:'partial' as const}))}),BATCH2_CLOCK),[]);
});
test('bar rejects missing group/unit/range, overlap, fake unknown zeros and invalid domains',()=>{
  const s=batch2FixtureScene('bar-chart'),m=metric<BarMetric>(s),g=m.groups[0];
  const invalid=[{...m,grouping:null},{...m,groups:[]},{...m,groups:[g,g]},{...m,groups:[{...g,value:0,coverage:'unknown'}]},{...m,groups:[{...g,value:null,coverage:'complete'}]},{...m,groups:[{...g,value:31}]},{...m,domain:{min:1,max:30}},{...m,groups:[{...g,value:-1}]},{...m,grouping:{kind:'sentence',label:'Sentences',intervalUnit:'seconds'}},{...m,grouping:{kind:'interval',label:'Time'},groups:[{...g,interval:{start:0,end:5}}]},{...m,grouping:{kind:'interval',label:'Time',intervalUnit:'seconds'},groups:[{...g,interval:{start:0,end:5}},{...g,id:'b',interval:{start:4,end:10}}]}];
  for(const value of invalid)assert.throws(()=>render(withMetric(s,value as BarMetric)),/Invalid HUD scene/);
});

test('target preserves actual overflow and reports explicit out-of-scale status',()=>{const s=batch2FixtureScene('target-band'),m=metric<TargetBandMetric>(s),r=render(s);assert.equal(m.value,67);assert.match(r.report[0].accessibleText,/Actual value 67 count/);assert.match(r.report[0].accessibleText,/Target 20 to 50/);assert.match(r.report[0].accessibleText,/Outside display scale/);});
test('target below, within, above and exact-point intervals are truthful',()=>{const s=batch2FixtureScene('target-band'),m=metric<TargetBandMetric>(s);for(const [value,expected]of [[0,'below'],[20,'inside'],[30,'inside'],[50,'inside'],[55,'above']] as const)assert.equal(targetPosition({...m,value}),expected);const exact={...m,target:{min:30,max:30},value:30};assert.equal(targetPosition(exact),'inside');assert.doesNotThrow(()=>render(withMetric(s,exact)));});
test('unknown target keeps a supplied actual quantity without inventing a goal or zero',()=>{const s=batch2FixtureScene('target-band'),m=metric<TargetBandMetric>(s);const r=render(withMetric(s,{...m,target:{min:null,max:null},value:12.75}));assert.equal(r.report[0].status,'no-data');assert.match(r.report[0].accessibleText,/Actual value 12.75/);assert.match(r.report[0].accessibleText,/Target interval not provided/);assert.equal(effectiveState({...m,value:null}).status,'no-data');});
test('target rejects reversed/nonfinite bounds and a scale not containing the target',()=>{const s=batch2FixtureScene('target-band'),m=metric<TargetBandMetric>(s);for(const value of [{...m,target:{min:50,max:20}},{...m,target:{min:NaN,max:50}},{...m,scale:{min:40,max:60}},{...m,scale:{min:0,max:0}},{...m,value:Infinity},{...m,scale:{min:-1e308,max:1e308}}])assert.throws(()=>render(withMetric(s,value)),/Invalid/);});
test('target finite extreme actual values remain literal and use the overflow marker',()=>{const s=batch2FixtureScene('target-band'),m=metric<TargetBandMetric>(s);for(const value of [-1e308,1e308]){const result=render(withMetric(s,{...m,value}));assert.match(result.report[0].accessibleText,new RegExp(value<0?'Actual value -1e\\+308':'Actual value 1e\\+308'));assert.match(result.report[0].accessibleText,/Outside display scale/);}});

test('calendar fixed dates, timezone and distinct coverage appear in accessible output',()=>{const s=batch2FixtureScene('calendar-heatmap'),r=render(s);assert.match(r.report[0].accessibleText,/2026-08-17 to 2026-10-04; Asia\/Shanghai/);assert.match(r.report[0].accessibleText,/2026-08-17: 0, complete coverage/);assert.match(r.report[0].accessibleText,/unknown coverage/);assert.match(r.report[0].accessibleText,/partial coverage/);});
test('calendar zero, unknown and partial-zero produce distinct pixels with unchanged dates',()=>{
  const s=batch2FixtureScene('calendar-heatmap'),m=metric<CalendarMetric>(s),frames=['complete','unknown','partial'].map(coverage=>withMetric(s,{...m,days:m.days.map(d=>({...d,value:coverage==='unknown'?null:0,coverage:coverage as 'complete'|'unknown'|'partial'}))}));
  assert.equal(effectiveState(metric<CalendarMetric>(frames[0])).status,'ready');assert.equal(effectiveState(metric<CalendarMetric>(frames[1])).status,'no-data');
  const bytes=frames.map(f=>render(f).bytes);assert.notDeepEqual(bytes[0],bytes[1]);assert.notDeepEqual(bytes[0],bytes[2]);assert.notDeepEqual(bytes[1],bytes[2]);assert.match(render(frames[1]).report[0].accessibleText,/dates shown as unknown, never zero/);
});
test('calendar partial null is allowed and does not become a daily zero',()=>{const s=batch2FixtureScene('calendar-heatmap'),m=metric<CalendarMetric>(s),days=m.days.map((d,i)=>i===0?{...d,value:null,coverage:'partial' as const}:d);assert.match(render(withMetric(s,{...m,days})).report[0].accessibleText,/2026-08-17: unknown, partial coverage/);});
test('calendar rejects missing/duplicate/out-of-order days, invalid timezone and false coverage',()=>{
  const s=batch2FixtureScene('calendar-heatmap'),m=metric<CalendarMetric>(s),d=m.days[0];
  const bad=[{...m,timezone:''},{...m,timezone:'Mars/Olympus'},{...m,timezone:'UTC+8'},{...m,days:m.days.slice(1)},{...m,days:[d,d,...m.days.slice(2)]},{...m,days:[...m.days].reverse()},{...m,days:[{...d,value:0,coverage:'unknown'},...m.days.slice(1)]},{...m,days:[{...d,value:null,coverage:'complete'},...m.days.slice(1)]},{...m,days:[{...d,value:21},...m.days.slice(1)]},{...m,colorDomain:{min:0,max:0}},{...m,startDate:'2026-02-30'},{...m,endDate:'2026-12-31'}];
  for(const value of bad)assert.throws(()=>render(withMetric(s,value as CalendarMetric)),/Invalid/);
});
test('calendar leap day and Sunday start are supplied correctly across 112-day boundary',()=>{
  const s=batch2FixtureScene('calendar-heatmap'),m=metric<CalendarMetric>(s),layout=calendarCells('2024-02-01','2024-05-22','sunday'),days=layout.map(d=>({date:d.date,value:0,coverage:'complete' as const,sourceEventIds:[]}));assert.equal(days.length,112);assert.ok(days.some(d=>d.date==='2024-02-29'));
  const scene=withMetric(s,{...m,startDate:'2024-02-01',endDate:'2024-05-22',weekStartsOn:'sunday',timezone:'UTC',days});assert.doesNotThrow(()=>render(scene));
});
test('calendar explicit window remains independent of timezone environment and supplied render time',()=>{const s=batch2FixtureScene('calendar-heatmap'),before=JSON.stringify(s);const old=process.env.TZ;try{process.env.TZ='Pacific/Honolulu';const a=render(s,{nowMs:0,reducedMotion:false});process.env.TZ='Asia/Tokyo';const b=render(s,{nowMs:1e9,reducedMotion:true});assert.deepEqual(a.bytes,b.bytes);assert.equal(JSON.stringify(s),before);}finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}});
test('all-partial null coverage stays distinct from all-unknown without inventing a quantity',()=>{
  for(const type of ['bar-chart','calendar-heatmap'] as const){
    const scene=batch2FixtureScene(type),m=metric<BarMetric|CalendarMetric>(scene);
    const partial=m.kind==='bar'?{...m,groups:m.groups.map(g=>({...g,value:null,coverage:'partial' as const}))}:{...m,days:m.days.map(d=>({...d,value:null,coverage:'partial' as const}))};
    const unknown=m.kind==='bar'?{...m,groups:m.groups.map(g=>({...g,value:null,coverage:'unknown' as const}))}:{...m,days:m.days.map(d=>({...d,value:null,coverage:'unknown' as const}))};
    const p=render(withMetric(scene,partial)),u=render(withMetric(scene,unknown));assert.notDeepEqual(p.bytes,u.bytes);assert.match(p.report[0].accessibleText,/unknown, partial coverage/);assert.notEqual(p.report[0].accessibleText,u.report[0].accessibleText);assert.equal(effectiveState(partial).status,'ready');
  }
});
