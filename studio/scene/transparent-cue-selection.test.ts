import {translate} from '../i18n/locale';
import { inactiveListeningTestScope } from '../core/inactive-listening-test-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { TrainingEngine, CAFE_MATERIAL, type Material } from '../core/training';
import { NPS_MATERIAL, NPS_COURSE_MEDIA } from '../core/builtin-material';
import { knownCueMarkers, nearestCueMarker, type CueMarker } from './transparent-timeline';
import { responsiveLayout } from './responsive-layout';
import {learningGeometry} from './learning-surface';

// Execute the actual cue JSX handlers and navigation/seek functions. The DOM
// hit-test and media element are synthetic; this is not real-browser evidence.
const source = await readFile(new URL('../components/Studio.tsx', import.meta.url), 'utf8');
const cueLine = source.split('\n').find(line => line.includes('className="hit cue-marker"'))!;
assert.ok(cueLine?.includes('className="hit cue-marker"'));
const cueJSX = cueLine.trim().slice(1, -1);
const functions = ['seekTo', 'dragTimeline', 'changeCue', 'navigationCueIndex'].map(name => {
  const line = source.split('\n').find(value => value.startsWith(` function ${name}(`));
  assert.ok(line, `Use actual Studio ${name}`); return line;
}).join('\n');
const require = createRequire(import.meta.url), swc = require('next/dist/build/swc');
await swc.loadBindings();
const { code } = await swc.transform(`${functions}\nfunction renderCueMarkers(){return (${cueJSX});}`, {
  jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2022' },
  module: { type: 'commonjs' },
});

type Options = { portrait?: boolean; height?: number; left?: number; width?: number; material?: Material; duration?: number };
function setup({ portrait = false, height = 1080, left = 0, width = 1182, material = NPS_MATERIAL, duration = NPS_COURSE_MEDIA.durationSeconds }: Options = {}) {
  const engine = new TrainingEngine({ material }), geometry = learningGeometry(responsiveLayout(portrait, {}, 'lesson', height),{cssWidth:width,keyboardVisible:true});
  const markers = knownCueMarkers(material.cues, duration, true);
  const stage = { left, width, top: -127 }, captures = new Set<number>();
  const video = { currentTime: 0, duration, pauseCount: 0, pause() { this.pauseCount++; }, seekable: { length: 1, start: () => 0, end: () => duration } };
  let focused = 0;
  const context = vm.createContext({t:(key:any,params:any)=>translate('en',key,params), ...inactiveListeningTestScope(), require, exports: {}, fixture: false, geometry, hitStyle: geometry.style,
    inlineCueTargets:true,cueMarkers: markers, nearestCueMarker, currentCue: 0, transportCueIndex: 0, stageRef: { current: { getBoundingClientRect: () => ({ ...stage }) } },
    suppressCueClickRef: { current: false }, cueDragRef: { current: null }, lessonRef: { current: video }, pendingSeek: { current: null },
    engineRef: { current: engine }, mediaRef: { current: { kind: 'demo' } }, mediaInteractedRef: { current: false },
    referenceBlocked: () => false, submissionSound: { audio: { current: { cancel() {} } } }, replaySnapshot: { current: null },
    reviewBindingRef: { current: null }, strictCourse: (value: Material) => !!(value.builtinReference || value.localReference),
    correctedPlayRequest: { current: 0 }, correctedPlayOwner: { current: null }, setShowSubtitle() {}, syncDraft() {},
    inputRef: { current: { focus() { focused++; } } }, notify(message: string) { throw Error(message); },
    responsiveLayout, portraitRef: { current: portrait }, portraitHeightRef: { current: height }, visualRef: { current: { fixture: false } },
  });
  vm.runInContext(code, context);
  const buttons = context.renderCueMarkers() as { props: Record<string, any> }[];
  const box = (index: number) => {
    const rect = geometry.cueMarker(markers[index].ratio);
    return { left: stage.left + rect.x / geometry.width * stage.width, width: rect.w / geometry.width * stage.width };
  };
  const center = (index: number) => { const rect = box(index); return rect.left + rect.width / 2; };
  const target = (clientX: number) => {
    const index = buttons.reduce((last, _, i) => { const rect = box(i); return clientX >= rect.left && clientX <= rect.left + rect.width ? i : last; }, -1);
    assert.ok(index >= 0, 'Pointer must be inside an existing cue hit box'); return index;
  };
  const pointer = (clientX: number, pointerType = 'mouse', pointerId = 7) => ({
    clientX, pageX: clientX + 619, pointerType, pointerId, detail: 1,nativeEvent:{isTrusted:true},
    currentTarget: {
      setPointerCapture(id: number) { captures.add(id); },
      hasPointerCapture(id: number) { return captures.has(id); },
      releasePointerCapture(id: number) { captures.delete(id); },
    },
  });
  const click = (clientX: number, pointerType = 'mouse', releaseX = clientX) => {
    const index = target(clientX), props = buttons[index].props;
    props.onPointerDown(pointer(clientX, pointerType));
    props.onPointerUp(pointer(releaseX, pointerType));
    props.onClick(pointer(releaseX, pointerType));
    assert.equal(captures.size, 0); return index;
  };
  return { engine, geometry, markers, stage, video, context, buttons, box, center, target, pointer, click, captures, focused: () => focused };
}

const cue = (cueIndex: number, ratio: number): CueMarker => ({ cueIndex, ratio, id: `cue-${cueIndex}`, start: ratio * 10 });
test('nearest cue resolution preserves original indices and uses lower-index exact ties without a new tolerance', () => {
  const first = Object.freeze(cue(2, .25)), second = Object.freeze(cue(7, .75));
  const markers = Object.freeze([second, first]), before = JSON.stringify(markers);
  assert.equal(nearestCueMarker(markers, .5), first);
  assert.equal(nearestCueMarker(markers, .5 - Number.EPSILON), first);
  assert.equal(nearestCueMarker(markers, .5 + Number.EPSILON), second);
  assert.equal(nearestCueMarker([cue(7, .25), first], .25), first);
  assert.equal(nearestCueMarker(markers, -1), first);
  assert.equal(nearestCueMarker(markers, 2), second);
  assert.equal(nearestCueMarker([], .5), null);
  for (const value of [NaN, Infinity, -Infinity]) assert.equal(nearestCueMarker(markers, value), null);
  assert.equal(JSON.stringify(markers), before);
});

test('actual overlapping NPS cue hit boxes select 1/2 and 3/4 instead of the topmost button', () => {
  const f = setup();
  assert.equal(f.target(f.center(0)), 1, 'Reproduce first-center DOM overlap');
  const thirdOverlap = (f.box(3).left + (f.center(2) + f.center(3)) / 2) / 2;
  assert.equal(f.target(thirdOverlap), 3, 'Third/fourth boxes overlap even though their centers do not');
  f.click(thirdOverlap);
  assert.equal(f.engine.getSnapshot().cueIndex, 2, 'Click nearer the third cue through the fourth hit box');
  assert.equal(f.video.currentTime, NPS_MATERIAL.cues[2].start);
  for (const index of [0, 1, 2, 3, 1, 0]) {
    f.click(f.center(index));
    assert.equal(f.engine.getSnapshot().cueIndex, index);
    assert.equal(f.video.currentTime, NPS_MATERIAL.cues[index].start);
  }
  assert.equal(f.focused(), 0);
  assert.equal(f.engine.getSnapshot().attempts.length, 0);
});

test('the actual first-center click and answer are graded against the first NPS phrase', () => {
  const f = setup(); f.engine.nextCue(1); f.click(f.center(0));
  f.engine.input(NPS_MATERIAL.cues[0].text); f.engine.submit();
  const attempt = f.engine.getSnapshot().attempts[0];
  assert.equal(attempt.cueId, NPS_MATERIAL.cues[0].id);
  assert.equal(attempt.reference, 'Hi, everybody.');
  assert.equal(attempt.accuracy, 100);
  assert.equal(attempt.errors, 0);
});

test('an exactly equidistant actual overlap click selects the earlier cue independently of stacking', () => {
  const material: Material = { id: 'equal-distance', version: 'equal-distance-v1', title: 'Equal distance', rights: 'Test fixture', cues: [
    { id: 'earlier', text: 'Earlier phrase.', start: 16, end: 17 },
    { id: 'later', text: 'Later phrase.', start: 17, end: 18 },
  ] };
  const f = setup({ material, duration: 32, width: 1672 }), middle = (f.center(0) + f.center(1)) / 2;
  assert.equal(f.target(middle), 1, 'The later button receives the native event');
  assert.equal(f.geometry.timelineProgress(middle, 0, 1672), .515625, 'The midpoint is exactly representable');
  f.click(middle); assert.equal(f.engine.getSnapshot().cueIndex, 0);
  f.click(middle + .000001); assert.equal(f.engine.getSnapshot().cueIndex, 1);
  f.click(middle - .000001); assert.equal(f.engine.getSnapshot().cueIndex, 0);
});

for (const options of [
  { portrait: false, left: 8, width: 1182 }, { portrait: false, left: -220, width: 836 },
  { portrait: false, left: 183, width: 2508 }, { portrait: true, left: 16, width: 430, height: 1080 },
  { portrait: true, left: -73, width: 215, height: 820 }, { portrait: true, left: 61, width: 640, height: 1400 },
]) test(`actual nearest-center clicks preserve ${options.portrait ? 'portrait' : 'landscape'} coordinates at width ${options.width}`, () => {
  const f = setup(options);
  for (const pointerType of ['mouse', 'touch', 'pen']) {
    // Re-read live viewport geometry after scrolling/centering/rescaling.
    f.stage.left += 37; f.stage.width *= .9;
    for (let index = 0; index < f.markers.length; index++) {
      f.click(f.center(index), pointerType);
      assert.equal(f.engine.getSnapshot().cueIndex, index, `${pointerType}: cue ${index + 1}`);
      assert.equal(f.video.currentTime, NPS_MATERIAL.cues[index].start);
    }
  }
});

test('overlap edges choose the nearest center and a short release movement uses click coordinates', () => {
  const f = setup();
  const first = f.center(0), second = f.center(1), middle = (first + second) / 2;
  for (const [x, expected] of [[first - f.box(0).width / 2 + .1, 0], [middle - .2, 0], [middle + .2, 1], [second + 1, 1]]) {
    f.click(x, 'touch'); assert.equal(f.engine.getSnapshot().cueIndex, expected);
  }
  f.click(middle - 1, 'touch', middle + 1);
  assert.equal(f.engine.getSnapshot().cueIndex, 1, 'Selection uses release/click location, not pointerdown');
});

test('keyboard and assistive detail-zero clicks retain the activated cue regardless of pointer coordinates', () => {
  const f = setup();
  for (const index of [0, 1, 2, 3, 10]) {
    f.buttons[index].props.onClick({ detail: 0, clientX: f.center(0),nativeEvent:{isTrusted:true} });
    assert.equal(f.engine.getSnapshot().cueIndex, index);
    assert.equal(f.video.currentTime, NPS_MATERIAL.cues[index].start);
  }
  f.context.stageRef.current = null;
  f.buttons[2].props.onClick({ detail: 0, clientX: NaN,nativeEvent:{isTrusted:true} });
  assert.equal(f.engine.getSnapshot().cueIndex, 2);
});

test('actual drag capture, the existing 4px threshold and one-click suppression remain unchanged', () => {
  for (const pointerType of ['mouse', 'touch', 'pen']) {
    const f = setup(), x = f.center(0), props = f.buttons[f.target(x)].props;
    f.engine.nextCue(5);
    props.onPointerDown(f.pointer(x, pointerType));
    props.onPointerMove(f.pointer(x + 4, pointerType));
    assert.equal(f.context.cueDragRef.current.dragging, false);
    props.onPointerMove(f.pointer(x + 4.01, pointerType));
    assert.equal(f.context.cueDragRef.current.dragging, true);
    props.onPointerUp(f.pointer(f.center(3), pointerType));
    const seek = f.video.currentTime;
    props.onClick(f.pointer(f.center(3), pointerType));
    assert.equal(f.engine.getSnapshot().cueIndex, 5, 'Drag must not switch the scoring cue');
    assert.ok(Math.abs(seek - NPS_MATERIAL.cues[3].start) < 1e-10);
    assert.equal(f.video.currentTime, seek);
    assert.equal(f.context.suppressCueClickRef.current, false);
    assert.equal(f.context.cueDragRef.current, null);
    assert.equal(f.captures.size, 0);
    f.click(f.center(0), pointerType);
    assert.equal(f.engine.getSnapshot().cueIndex, 0, 'The next ordinary click is no longer suppressed');
  }
});

test('pointer clicks without usable live coordinates never fall back to the overlapping target index', () => {
  const f = setup(); f.engine.nextCue(5);
  f.buttons[1].props.onClick({ detail: 1, clientX: NaN });
  assert.equal(f.engine.getSnapshot().cueIndex, 5);
  f.stage.width = 0;
  f.buttons[1].props.onClick({ detail: 1, clientX: 0 });
  assert.equal(f.engine.getSnapshot().cueIndex, 5);
  f.context.stageRef.current = null;
  f.buttons[1].props.onClick({ detail: 1, clientX: 0 });
  assert.equal(f.engine.getSnapshot().cueIndex, 5);
});

test('original coffee marker positions and every ordinary cue selection remain unchanged', () => {
  for (const portrait of [false, true]) {
    const f = setup({ portrait, width: portrait ? 390 : 1182, material: CAFE_MATERIAL, duration: 72 });
    for (let index = 0; index < 12; index++) {
      assert.equal(f.markers[index].ratio, index / 12);
      assert.deepEqual(f.buttons[index].props.style, f.geometry.style(f.geometry.cueMarker(index / 12)));
      assert.equal(f.target(f.center(index)), index, 'Coffee cue centers do not overlap');
      f.click(f.center(index));
      assert.equal(f.engine.getSnapshot().cueIndex, index);
      assert.equal(f.video.currentTime, index * 6);
    }
  }
});

test('projected cue centers and actual drag handlers round-trip every scaled scene rail',()=>{
 for(const portrait of[false,true])for(const width of[320,560,640,960,1280,1672]){
  const f=setup({portrait,width,material:CAFE_MATERIAL});
  for(const ratio of[0,.25,.5,.75,1]){const r=f.geometry.cueMarker(ratio),clientX=f.stage.left+(r.x+r.w/2)/f.geometry.width*width;assert.ok(Math.abs(f.geometry.timelineProgress(clientX,f.stage.left,width)-ratio)<1e-9);f.context.dragTimeline(clientX);assert.ok(Math.abs(f.video.currentTime-ratio*f.video.duration)<1e-7)}
 }
});

test('drag routes only to the active displayed/listened media and leaves the training cue untouched',()=>{
 for(const mode of ['listen','type']){
  const f=setup(),before=JSON.stringify(f.engine.getSnapshot()),oldTime=f.video.currentTime;
  const state={active:true,mode,duration:60,position:4};const seeks:number[]=[];
  f.context.listening.playerRef.current={getState:()=>state,seek:(seconds:number)=>{state.position=seconds;seeks.push(seconds)}};
  const r=f.geometry.cueMarker(.5),clientX=f.stage.left+(r.x+r.w/2)/f.geometry.width*f.stage.width;
  f.context.dragTimeline(clientX);
  assert.equal(seeks.length,1);assert.ok(Math.abs(seeks[0]-30)<1e-9);assert.equal(f.video.currentTime,oldTime);
  assert.equal(JSON.stringify(f.engine.getSnapshot()),before);
 }
});
test('continuous-listening navigation follows the live media position even with reference hidden',()=>{
 const f=setup(),before=JSON.stringify(f.engine.getSnapshot());
 const state={active:true,mode:'listen',duration:f.video.duration,position:NPS_MATERIAL.cues[2].start,frame:{cueIndex:null,text:'',targetKey:null}};
 f.context.listening.playerRef.current={getState:()=>state,seek:(seconds:number)=>{state.position=seconds}};
 assert.equal(f.context.navigationCueIndex(),2);
 f.context.changeCue(f.context.navigationCueIndex()+1,false);assert.equal(state.position,NPS_MATERIAL.cues[3].start);
 f.context.changeCue(f.context.navigationCueIndex()+1,false);assert.equal(state.position,NPS_MATERIAL.cues[4].start);
 f.context.changeCue(f.context.navigationCueIndex()-1,false);assert.equal(state.position,NPS_MATERIAL.cues[3].start);
 state.position=state.duration;assert.equal(f.context.navigationCueIndex(),NPS_MATERIAL.cues.length-1);
 assert.equal(JSON.stringify(f.engine.getSnapshot()),before,'navigation does not mutate the scored cue or input');
 assert.deepEqual(state.frame,{cueIndex:null,text:'',targetKey:null});
 state.mode='type';assert.equal(f.context.navigationCueIndex(),f.engine.getSnapshot().cueIndex,'typing keeps the intentionally selected grading cue');
});
test('Canvas navigation reuses its current frame snapshot without another observation read',()=>{
 const f=setup(),before=JSON.stringify(f.engine.getSnapshot()),state={active:true,mode:'listen',position:NPS_MATERIAL.cues[3].start};let reads=0;
 f.context.listening.playerRef.current={getState:()=>{reads++;return state}};
 assert.equal(f.context.navigationCueIndex(state),3);assert.equal(reads,0);
 assert.equal(f.context.navigationCueIndex(),3);assert.equal(reads,1,'ordinary button navigation still reads current playback');
 state.mode='type';assert.equal(f.context.navigationCueIndex(state),f.engine.getSnapshot().cueIndex);assert.equal(reads,1);
 assert.equal(JSON.stringify(f.engine.getSnapshot()),before);
 assert.match(source,/v\.transportCueIndex=navigationCueIndex\(listeningState\)/);
});
