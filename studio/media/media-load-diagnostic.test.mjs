import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewDurationDiagnostic,reviewMediaDiagnostic,reviewRangeDiagnostic} from './media-load-diagnostic.ts';
test('failed duration diagnostics keep exact finite actual, expected and allowed margin',()=>{
 assert.equal(reviewDurationDiagnostic(43.368,43.366667,.001),'[duration; actual=43.368; expected=43.366667; tolerance=0.001]');
});
test('nonfinite timing is unknown rather than a false zero',()=>{assert.equal(reviewDurationDiagnostic(NaN,Infinity,0),'[duration; actual=unknown; expected=unknown; tolerance=0]');});
test('diagnostics do not change comparison inputs',()=>{const a=43.366668,b=43.366667;reviewDurationDiagnostic(a,b,.001);assert.equal(a,43.366668);assert.equal(b,43.366667);});

test('native parser message is bounded local detail while source URLs are removed',()=>{
 const result=reviewMediaDiagnostic('metadata',{error:{code:4,message:'DEMUXER_ERROR_COULD_NOT_OPEN: FFmpegDemuxer: open context failed blob:https://example.test/private-id\n'+ 'x'.repeat(300)},readyState:0,networkState:3});
 assert.match(result,/metadata; MEDIA_4; ready=0; network=3; detail=DEMUXER_ERROR_COULD_NOT_OPEN/);
 assert.equal(result.includes('example.test'),false);assert.equal(result.includes('private-id'),false);
 assert.ok(result.split('; detail=')[1].length<=161);
});
test('absent, empty, or throwing native message preserves existing finite diagnostic',()=>{
 for(const error of [{code:4},{code:4,message:''},{code:4,get message(){throw Error('native getter unavailable')}}])
 assert.equal(reviewMediaDiagnostic('metadata',{error,readyState:0,networkState:3}),'[metadata; MEDIA_4; ready=0; network=3]');
});

test('range-v71 keeps pending native sentinels and exact finite cue bounds distinct', () => {
 for (const actual of [NaN, Infinity, -Infinity, 0, -1, 5.999999, 43.366667]) {
  assert.equal(reviewRangeDiagnostic(actual, 1.0000001, 6, 'verified-direct', 1),
   `[range-v71; actual=${actual}; cueStart=1.0000001; cueEnd=6; ready=1; transport=verified-direct]`);
 }
});
test('range diagnostics allowlist transport and never expose caller strings or a source URL', () => {
 const result = reviewRangeDiagnostic(NaN, 0, 6, 'blob:https://private.example/token\n' + 'x'.repeat(1000));
 assert.equal(result, '[range-v71; actual=NaN; cueStart=0; cueEnd=6; ready=-1; transport=unknown]');
 assert.equal(reviewRangeDiagnostic(Number.MAX_VALUE, Number.MIN_VALUE, -Number.MAX_VALUE, 'blob', 4).length < 200, true);
});
