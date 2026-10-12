import test from 'node:test';import assert from 'node:assert/strict';
import {effectiveState,eligiblePulseEvents,formatNumber,inputWaveKernel,inputWaveSamples,pulseReferenceTime,trendSegments} from '../metrics.ts';
import {fixtureScene} from '../showcase/fixtures.ts';import type {InputPulseMetric,ProgressMetric,TrendMetric} from '../schema.ts';
const metric=<T>(type:'trend-line'|'input-pulse'|'progress-ring')=>Object.values(fixtureScene(type).metrics)[0] as T;
test('trend preserves null, missing, paused and excessive-time gaps without zero substitution',()=>{
  const m=metric<TrendMetric>('trend-line'),s=trendSegments(m,3000);assert.deepEqual(s.map(p=>p.length),[5,5]);assert.equal(s.flat().some(p=>p.value===0),false);
  assert.equal(trendSegments(m,2000).length,10);
  const changed={...m,points:m.points.map((p,i)=>i===1?{...p,state:'missing' as const}:p)};assert.deepEqual(trendSegments(changed,3000).map(p=>p.length),[1,3,5]);
});
test('unknown and zero totals are no-data, actual zero with a supplied total is ready',()=>{
  const m=metric<ProgressMetric>('progress-ring');for(const denominator of [0,null])assert.equal(effectiveState({...m,denominator}).status,'no-data');
  assert.equal(effectiveState({...m,numerator:0}).status,'ready');assert.equal(effectiveState({...m,numerator:null}).status,'no-data');
});
test('unmeasured never masquerades as a measured zero',()=>{const m=metric<ProgressMetric>('progress-ring');assert.equal(effectiveState({...m,quality:'unmeasured',numerator:0}).status,'no-data');});
test('pulse only uses committed positive typed/IME events within the clock window',()=>{
  const m=metric<InputPulseMetric>('input-pulse');const events=[{id:'typed',atMs:100,source:'typed' as const,addedGraphemes:1},{id:'ime',atMs:150,source:'ime' as const,addedGraphemes:2},{id:'paste',atMs:170,source:'paste' as const,addedGraphemes:30},{id:'delete',atMs:180,source:'delete' as const,addedGraphemes:0},{id:'zero',atMs:190,source:'typed' as const,addedGraphemes:0},{id:'future',atMs:900,source:'typed' as const,addedGraphemes:1}];
  assert.deepEqual(eligiblePulseEvents({...m,events},200,200).map(e=>e.id),['typed','ime']);
});
test('paused, static and low-motion clocks freeze pulse position; future events stay unreplayed',()=>{
  const m=metric<InputPulseMetric>('input-pulse');assert.equal(pulseReferenceTime({...m,state:{status:'paused',frozenAtMs:29000}},{nowMs:90000,reducedMotion:false},'subtle'),29000);
  assert.equal(pulseReferenceTime(m,{nowMs:90000,reducedMotion:true},'subtle'),29500);assert.equal(pulseReferenceTime(m,{nowMs:90000,reducedMotion:false},'none'),29500);
  assert.equal(pulseReferenceTime(m,{nowMs:21000,reducedMotion:true},'subtle'),0);
});
test('wave has finite support, is triggered by actual input, and returns to baseline when idle',()=>{
  const m=metric<InputPulseMetric>('input-pulse');assert.equal(inputWaveKernel(-1),0);assert.equal(inputWaveKernel(400),0);assert.equal(inputWaveKernel(145),1);
  const empty=inputWaveSamples({...m,events:[]},30000,10000);assert.equal(empty.some(([,v])=>v!==0),false);
  assert.equal(inputWaveSamples(m,50000,10000).some(([,v])=>v!==0),false);
  assert.equal(inputWaveSamples(m,30000,10000).some(([,v])=>v!==0),true);
  const paste={...m,events:m.events.map(e=>({...e,source:'paste' as const}))};assert.equal(inputWaveSamples(paste,30000,10000).some(([,v])=>v!==0),false);
  assert.deepEqual(inputWaveSamples(m,30000,10000),inputWaveSamples(m,30000,10000));
});
test('numeric formatting is locale-independent and keeps requested precision',()=>{assert.equal(formatNumber(1234.56,2),'1,234.56');assert.equal(formatNumber(0,1),'0.0');assert.equal(formatNumber(-1234,0),'-1,234');});
import {formatSuppliedNumber} from '../metrics.ts';
test('ring quantity formatting preserves fractional supplied numerator and denominator',()=>{assert.equal(formatSuppliedNumber(.2),'0.2');assert.equal(formatSuppliedNumber(.4),'0.4');assert.equal(formatSuppliedNumber(.0000001),'1e-7');assert.equal(formatSuppliedNumber(1200),'1,200');});
test('paste, deletion and zero additions do not move the reduced-motion typed reference',()=>{const m=metric<InputPulseMetric>('input-pulse');const changed={...m,events:[...m.events,{id:'paste-last',atMs:31000,source:'paste' as const,addedGraphemes:0},{id:'delete-last',atMs:32000,source:'delete' as const,addedGraphemes:0},{id:'zero-last',atMs:33000,source:'typed' as const,addedGraphemes:0}]};assert.equal(pulseReferenceTime(changed,{nowMs:50000,reducedMotion:true},'subtle'),29500);});
