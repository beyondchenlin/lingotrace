import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {TrainingEngine} from '../core/training';
import {DEFAULT_RECTS, REFERENCE_INSET, SPLIT_INSET, insetRect, parseArrangement, rectFor, rectStyle, type Arrangement, type Rect} from './layout';
import {DESIGN, paintScene, type SceneMedia, type SceneVisual} from './renderer';

const {createCanvas} = createRequire(import.meta.url)('@napi-rs/canvas');
const shiftedInset: Rect = {x:1378,y:108,w:273,h:218};
const originalInset: Rect = {x:1378,y:46,w:273,h:218};
const originalSplitInset: Rect = {x:1103,y:88,w:569,h:522};
const outputSizes = [[1672,941],[1920,1080]] as const;
const normalLayouts = ['lesson','camera'] as const;
const allLayouts = [...normalLayouts,'split'] as const;

test('fresh lesson and camera defaults move only the inset down to y108', () => {
  assert.deepEqual(DEFAULT_RECTS.inset, shiftedInset);
  for (const layout of normalLayouts) {
    assert.deepEqual(insetRect(layout), shiftedInset);
    assert.deepEqual(insetRect(layout, {}), rectFor('inset', {}));
  }
  assert.deepEqual(DEFAULT_RECTS.media, {x:0,y:0,w:1672,h:941});
  assert.deepEqual(DEFAULT_RECTS.subtitle, {x:453,y:521,w:766,h:73});
  assert.deepEqual(DEFAULT_RECTS.metrics, {x:0,y:754,w:1672,h:118});
});

test('default inset and its DOM hit rectangle clear the top band at both output sizes', () => {
  for (const layout of normalLayouts) for (const [width,height] of outputSizes) {
    const rect = insetRect(layout), style = rectStyle(rect);
    const x = Number.parseFloat(style.left)/100*width;
    const y = Number.parseFloat(style.top)/100*height;
    const w = Number.parseFloat(style.width)/100*width;
    const h = Number.parseFloat(style.height)/100*height;
    const scaleY = height/DESIGN.height;
    // Allow two logical pixels for the visible border around the inset.
    const clearance = y - (89+2)*scaleY;
    assert.ok(clearance >= 17*scaleY-1e-9, `${layout} at ${width}x${height}: ${clearance}px clearance`);
    assert.ok(x >= 0 && x+w <= width, 'inset stays within the right edge');
    assert.ok(y+h <= 610*scaleY, 'inset stays above the fixed input console');
    assert.ok(Math.abs(y-108*scaleY) < 1e-9, 'DOM target matches the Canvas y coordinate');
  }
});

test('saved original and custom inset rectangles round-trip without migration or mutation', () => {
  const savedRects: Rect[] = [originalInset, {x:903,y:177,w:400,h:320}, {x:35,y:12,w:250,h:200}];
  for (const savedRect of savedRects) {
    const saved = Object.freeze({inset:Object.freeze({...savedRect})});
    const restored = parseArrangement(JSON.parse(JSON.stringify(saved)));
    assert.deepEqual(restored, saved, 'valid stored geometry must survive parsing exactly');
    assert.notStrictEqual(restored.inset, saved.inset);
    for (const layout of allLayouts) {
      const resolved = insetRect(layout, restored);
      assert.deepEqual(resolved, savedRect, 'explicit geometry takes priority over every normal layout');
      assert.notStrictEqual(resolved, restored.inset);
      resolved.y = 599;
      resolved.w = 999;
      assert.deepEqual(restored.inset, savedRect, 'resolving and changing a copy cannot alter saved geometry');
    }
    assert.deepEqual(saved.inset, savedRect);
  }
});

test('removing an inset override restores the new default while retaining other layout edits', () => {
  const arrangement: Arrangement = parseArrangement({
    inset:originalInset,
    subtitle:{x:453,y:450,w:766,h:73},
    metrics:DEFAULT_RECTS.metrics,
  });
  const reset = {...arrangement};
  delete reset.inset;
  const restored = parseArrangement(JSON.parse(JSON.stringify(reset)));
  assert.equal(Object.hasOwn(restored, 'inset'), false);
  assert.deepEqual(restored.subtitle, arrangement.subtitle);
  assert.deepEqual(restored.metrics, arrangement.metrics);
  for (const layout of normalLayouts) {
    assert.deepEqual(insetRect(layout, restored), shiftedInset);
    assert.deepEqual(rectFor('inset', restored), shiftedInset, 'layout editor reset uses the same default');
  }
  assert.deepEqual(arrangement.inset, originalInset, 'reset does not mutate its prior arrangement');
});

test('reference geometry takes priority over layout and custom inset overrides', () => {
  assert.deepEqual(REFERENCE_INSET, originalInset);
  for (const layout of allLayouts) for (const arrangement of [{}, {inset:shiftedInset}, {inset:{x:100,y:200,w:400,h:320}}]) {
    const resolved = insetRect(layout, arrangement, true);
    assert.deepEqual(resolved, originalInset);
    assert.notStrictEqual(resolved, REFERENCE_INSET);
    resolved.y = 0;
    assert.deepEqual(REFERENCE_INSET, originalInset);
  }
});

test('split keeps its existing geometry and all fallback rectangles are independent copies', () => {
  assert.deepEqual(SPLIT_INSET, originalSplitInset);
  assert.deepEqual(insetRect('split'), originalSplitInset);
  for (const layout of allLayouts) {
    const expected = layout === 'split' ? originalSplitInset : shiftedInset;
    const first = insetRect(layout), second = insetRect(layout);
    assert.notStrictEqual(first, second);
    first.x = 0;
    first.y = 0;
    assert.deepEqual(second, expected);
    assert.deepEqual(insetRect(layout), expected);
  }
  assert.deepEqual(DEFAULT_RECTS.inset, shiftedInset);
  assert.deepEqual(SPLIT_INSET, originalSplitInset);
});

function source(width:number, height:number) {
  const canvas = createCanvas(width, height);
  Object.assign(canvas, {readyState:4,videoWidth:width,videoHeight:height,paused:true});
  return canvas;
}

const view: SceneVisual = {
  layout:'lesson',fixture:false,showSubtitle:false,paused:false,reducedMotion:true,camera:'on',
  recording:false,recordingStarted:null,recordingBytes:0,draft:'',inputFocused:false,composition:false,
  caret:0,selectionEnd:0,scrollLeft:0,message:'',gain:0,rewardAt:0,lastResult:null,volume:.8,muted:false,
  ready:true,playbackTime:0,playbackDuration:3.12,renderTime:100,snapshot:new TrainingEngine().getSnapshot(),
};

test('painted preview and recorded scene use y108, preserve the 37px footer, and keep primary media and HUD in place', () => {
  for (const layout of normalLayouts) for (const recording of [false,true]) for (const [width,height] of outputSizes) {
    const primary = source(1672,941), inset = source(273,181);
    const image = {complete:false,naturalWidth:0};
    const media = {
      lesson:layout === 'lesson' ? primary : inset,
      camera:layout === 'lesson' ? inset : primary,
      poster:image,image,reference:image,kind:'video',name:'Synthetic geometry marker',
    } as unknown as SceneMedia;
    const canvas = createCanvas(width,height), ctx = canvas.getContext('2d');
    const imageCalls: {source:unknown;args:number[];scaleY:number}[] = [];
    const fills: number[][] = [];
    const labels: {text:string;x:number;y:number}[] = [];
    const drawImage = ctx.drawImage.bind(ctx), fillRect = ctx.fillRect.bind(ctx), fillText = ctx.fillText.bind(ctx);
    ctx.drawImage = (src:unknown, ...args:number[]) => {
      imageCalls.push({source:src,args,scaleY:ctx.getTransform().d});
      return drawImage(src,...args);
    };
    ctx.fillRect = (...args:number[]) => {fills.push(args);return fillRect(...args)};
    ctx.fillText = (text:string,x:number,y:number,...args:number[]) => {
      labels.push({text,x,y});
      return fillText(text,x,y,...args);
    };
    paintScene(canvas as HTMLCanvasElement, media, {...view,layout,recording,recordingStarted:Date.now()});
    const insetCalls = imageCalls.filter(call => call.source === inset);
    assert.equal(insetCalls.length, 1, 'inset is rendered once into the composed scene');
    assert.deepEqual(insetCalls[0].args, [1378,108,273,181]);
    assert.ok(Math.abs(insetCalls[0].scaleY-height/941) < 1e-6, 'inset uses output-resolution scaling');
    const primaryCalls = imageCalls.filter(call => call.source === primary);
    assert.ok(primaryCalls.length > 0);
    for (const call of primaryCalls) assert.deepEqual(call.args, [0,0,1672,941]);
    for (const rect of [[1378,289,273,37],[0,0,1672,89],[0,754,1672,118],[0,872,1672,69]]) {
      assert.ok(fills.some(call => call.every((value,index) => value === rect[index])), `required footer/HUD bounds: ${rect}`);
    }
    for (const expected of [{text:'WARM UP',x:28,y:78},{text:'REVIEW',x:1074,y:78},{text:'CONFIRMED',x:893,y:806}]) {
      assert.ok(labels.some(label => label.text === expected.text && label.x === expected.x && label.y === expected.y));
    }
    const status = labels.find(label => recording ? label.text.startsWith('REC ') : label.text === '摄像头预览 · 未开始录制');
    assert.ok(status, 'preview or recording status remains visible');
    assert.deepEqual({x:status.x,y:status.y}, {x:1417,y:311});
  }
});
