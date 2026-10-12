import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStudioViewport, fitStudioSurface, splitToolbarHeight, type StudioViewportInput } from './studio-viewport';
import {resolvePortraitHeight} from './responsive-layout';

const resolve = (width: number, height: number, options: Omit<StudioViewportInput, 'layoutViewport'> = {}) =>
  resolveStudioViewport({ layoutViewport: { width, height }, ...options });

test('auto uses the available CSS aspect ratio, including wide portrait tablets and small landscape windows', () => {
  for (const [width, height, portrait] of [
    [390, 844, true], [1024, 1366, true], [900, 500, false],
    [1920, 1080, false], [844, 390, false], [500, 500, true],
  ] as const) {
    const state = resolve(width, height);
    assert.equal(state.portrait, portrait, `${width}×${height}`);
    assert.equal(state.usableWidth, width);
    assert.equal(state.usableHeight, height);
    assert.equal(state.keyboardSuppressed, false);
  }
});

test('focused layout-viewport height shrink preserves the unoccluded portrait baseline', () => {
  const initial = resolve(390, 844);
  const keyboard = resolve(390, 330, { previous: initial, editableFocused: true });
  assert.equal(keyboard.portrait, true);
  assert.equal(keyboard.usableHeight, 330);
  assert.equal(keyboard.stableHeight, 844);
  assert.equal(keyboard.keyboardSuppressed, true);
  const continuing = resolve(391, 350, { previous: keyboard, editableFocused: true });
  assert.equal(continuing.portrait, true);
  assert.equal(continuing.stableWidth, 390);
  assert.equal(continuing.stableHeight, 844);
  assert.equal(continuing.keyboardSuppressed, true);
  const restored = resolve(390, 844, { previous: continuing, editableFocused: true });
  assert.equal(restored.keyboardSuppressed, false);
});

test('focused visual-viewport occlusion keeps usable bounds separate from orientation bounds', () => {
  const initial = resolve(390, 844);
  const visualViewport = { width: 390, height: 330, scale: 1 };
  for (const previous of [undefined, initial]) {
    const keyboard = resolve(390, 844, { previous, editableFocused: true, visualViewport });
    assert.equal(keyboard.portrait, true);
    assert.equal(keyboard.usableHeight, 330);
    assert.equal(keyboard.stableHeight, 844);
    assert.equal(keyboard.keyboardSuppressed, true);
  }
});

test('successive small focused height changes do not erase the baseline', () => {
  let previous = resolve(390, 844);
  for (const height of [800, 720, 600, 440, 380, 330]) {
    previous = resolve(390, height, { previous, editableFocused: true });
    assert.equal(previous.stableHeight, 844);
    assert.equal(previous.portrait, true);
  }
  const square = resolve(390, 390);
  assert.equal(resolve(390, 389, { previous: square, editableFocused: true }).portrait, true);
});

test('rotation and actual width changes release the keyboard baseline even while an input stays focused', () => {
  const initial = resolve(390, 844, { orientationAngle: 0 });
  const keyboard = resolve(390, 330, { previous: initial, editableFocused: true, orientationAngle: 0 });
  for (const orientationAngle of [undefined, 90]) {
    const rotated = resolve(844, 390, { previous: keyboard, editableFocused: true, orientationAngle });
    assert.equal(rotated.portrait, false);
    assert.equal(rotated.stableHeight, 390);
    assert.equal(rotated.keyboardSuppressed, false);
  }
  const changedAngle = resolve(390, 330, { previous: keyboard, editableFocused: true, orientationAngle: 90 });
  assert.equal(changedAngle.portrait, false);
  assert.equal(changedAngle.keyboardSuppressed, false);
});

test('unfocused resize and fullscreen-like resize use current geometry while blur waits for keyboard closure', () => {
  const initial = resolve(390, 844);
  assert.equal(resolve(390, 330, { previous: initial }).portrait, false);
  const keyboard = resolve(390, 330, { previous: initial, editableFocused: true });
  const blur = resolve(390, 330, { previous: keyboard, editableFocused: false });
  assert.equal(blur.portrait, true);
  assert.equal(blur.keyboardSuppressed, true);
  const closed=resolve(390,844,{previous:blur,editableFocused:false});
  assert.equal(closed.portrait,true);assert.equal(closed.keyboardSuppressed,false);
  assert.equal(resolve(1920, 1080, { previous: keyboard }).portrait, false);
  assert.equal(resolve(1024, 1366, { previous: keyboard }).portrait, true);
});

test('container constraints bound usable width and can make a wide window use portrait', () => {
  const constrained = resolve(1920, 1080, { containerWidth: 700 });
  assert.equal(constrained.portrait, true);
  assert.equal(constrained.usableWidth, 700);
  assert.equal(resolve(900, 500, { containerWidth: 2000 }).usableWidth, 900);
  const narrow = resolve(900, 800, { containerWidth: 390 });
  const keyboard = resolve(900, 330, { previous: narrow, containerWidth: 390, editableFocused: true });
  assert.equal(keyboard.portrait, true);
  const changedContainer = resolve(900, 330, { previous: keyboard, containerWidth: 700, editableFocused: true });
  assert.equal(changedContainer.portrait, false);
  assert.equal(changedContainer.keyboardSuppressed, false);
  const changedWindow = resolve(1200, 330, { previous: keyboard, containerWidth: 390, editableFocused: true });
  assert.equal(changedWindow.portrait, false);
  assert.equal(changedWindow.keyboardSuppressed, false);
});

test('pinch zoom reports visible CSS pixels without treating their shrinkage as a layout change', () => {
  const initial = resolve(900, 500);
  const pinched = resolve(900, 500, {
    previous: initial,
    containerWidth: 600,
    visualViewport: { width: 225, height: 125, scale: 4 },
  });
  assert.equal(pinched.usableWidth, 225);
  assert.equal(pinched.usableHeight, 125);
  assert.equal(pinched.stableWidth, 600);
  assert.equal(pinched.stableHeight, 500);
  assert.equal(pinched.portrait, false);
  assert.equal(pinched.keyboardSuppressed, false);
  const phone = resolve(390, 844, { visualViewport: { width: 195, height: 200, scale: 2 } });
  assert.equal(phone.portrait, true);
  assert.equal(phone.stableHeight, 844);
  const rotated = resolve(844, 390, { previous: phone, visualViewport: { width: 422, height: 195, scale: 2 } });
  assert.equal(rotated.portrait, false);
});

test('unzoomed visual-viewport geometry constrains auto layout without editable focus', () => {
  const result = resolve(900, 800, { visualViewport: { width: 800, height: 400, scale: 1 } });
  assert.equal(result.portrait, false);
  assert.equal(result.usableWidth, 800);
  assert.equal(result.stableHeight, 400);
});

test('manual mode overrides orientation without contaminating the next auto baseline', () => {
  const manualLandscape = resolve(390, 844, { manualMode: 'landscape' });
  assert.equal(manualLandscape.portrait, false);
  const keyboardAuto = resolve(390, 330, { previous: manualLandscape, editableFocused: true, manualMode: 'auto' });
  assert.equal(keyboardAuto.portrait, true);
  assert.equal(resolve(1920, 1080, { manualMode: 'portrait' }).portrait, true);
  assert.equal(resolve(1920, 1080, { manualMode: 'auto' }).portrait, false);
});

test('invalid geometry safely reuses prior window dimensions or a documented initial 1px square', () => {
  for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
    const first = resolve(invalid, invalid, {
      containerWidth: invalid,
      visualViewport: { width: invalid, height: invalid, scale: invalid },
      orientationAngle: invalid === 0 ? NaN : invalid,
    });
    assert.equal(first.usableWidth, 1);
    assert.equal(first.usableHeight, 1);
    assert.equal(first.portrait, true);
    const previous = resolve(900, 500);
    const next = resolve(invalid, invalid, { previous, containerWidth: invalid });
    assert.equal(next.usableWidth, 900);
    assert.equal(next.usableHeight, 500);
    assert.equal(next.portrait, false);
    for (const field of ['usableWidth', 'usableHeight', 'stableWidth', 'stableHeight', 'layoutWidth', 'layoutHeight', 'stableLayoutWidth'] as const) {
      assert.ok(Number.isFinite(next[field]) && next[field] > 0);
    }
  }
});

test('normalized angle equivalents preserve the guard and inputs are never mutated', () => {
  const previous = Object.freeze(resolve(390, 844, { orientationAngle: 0 }));
  const layoutViewport = Object.freeze({ width: 390, height: 330 });
  const input = Object.freeze({ layoutViewport, previous, editableFocused: true, orientationAngle: 360 });
  const result = resolveStudioViewport(input);
  assert.equal(result.keyboardSuppressed, true);
  assert.equal(result.orientationAngle, 0);
  assert.equal(previous.stableHeight, 844);
  assert.equal(layoutViewport.height, 330);
  assert.deepEqual(resolveStudioViewport(input), result);
});

test('an already-shrunken first layout sample cannot establish an unseen keyboard baseline', () => {
  const result = resolve(390, 330, { editableFocused: true });
  assert.equal(result.portrait, false);
  assert.equal(result.keyboardSuppressed, false);
});


test('blur before visual keyboard closes preserves shape through every closing frame',()=>{
 const initial=resolve(390,766,{orientationAngle:0});
 let previous=resolve(390,766,{previous:initial,editableFocused:true,visualViewport:{width:390,height:250}});
 for(const height of [250,350,500,650]){
  previous=resolve(390,766,{previous,editableFocused:false,visualViewport:{width:390,height}});
  assert.equal(previous.portrait,true);assert.equal(previous.stableHeight,766);assert.equal(previous.keyboardSuppressed,true);
 }
 const closed=resolve(390,766,{previous,editableFocused:false,visualViewport:{width:390,height:766}});
 assert.equal(closed.keyboardSuppressed,false);
 const actualResize=resolve(390,300,{previous:closed});
 assert.equal(actualResize.portrait,false);
});


test('one-screen fit respects actual available width and height including toolbar and safe areas',()=>{
 for(const [w,h,toolbar,safeTop,safeBottom] of [[390,844,48,0,34],[375,667,48,0,0],[500,757,48,0,0],[500,650,48,0,0],[430,932,48,44,34],[768,1024,58,0,0]]){
  const state=resolve(w,h-toolbar-safeTop-safeBottom);
  const logicalHeight=resolvePortraitHeight(Math.round(state.stableHeight*430/state.stableWidth));
  const fit=fitStudioSurface(state,430,logicalHeight);
  assert.ok(fit.width<=w);assert.ok(fit.height+toolbar+safeTop+safeBottom<=h+1e-8);
  assert.ok(Math.abs(fit.width/fit.height-430/logicalHeight)<1e-10);
 }
});

test('address bar resize refits without accumulating shrinkage and keyboard preserves the stable scene',()=>{
 let state=resolve(390,796);
 for(const h of [752,780,796,752,796]){state=resolve(390,h,{previous:state});const fit=fitStudioSurface(state,430,850);assert.ok(fit.height<=h);}
 const fitBefore=fitStudioSurface(state,430,850);
 const keyboard=resolve(390,796,{previous:state,editableFocused:true,visualViewport:{width:390,height:320}});
 assert.deepEqual(fitStudioSurface(keyboard,430,850),fitBefore);
 const blur=resolve(390,796,{previous:keyboard,visualViewport:{width:390,height:450}});
 assert.deepEqual(fitStudioSurface(blur,430,850),fitBefore);
 const closed=resolve(390,796,{previous:blur});assert.equal(closed.keyboardSuppressed,false);
});

test('short fit reports reduced affordance size rather than truncating or hiding components',()=>{
 const fit=fitStudioSurface(resolve(390,350),430,740);
 assert.equal(fit.compact,true);assert.ok(fit.height<=350);assert.ok(fit.width>0);
});


test('conditional compact notice cannot flip its own near-square orientation repeatedly',()=>{
 for(const [width,height] of [[390,450],[500,550],[500,545]]){
  let previous:ReturnType<typeof resolveStudioViewport>|undefined;
  let compact=false;
  const modes:boolean[]=[];
  for(let i=0;i<8;i++){
   const toolbar=splitToolbarHeight(compact?64:48,compact?12:0,4);
   previous=resolve(width,height-toolbar.orientationHeight,{previous});
   const bounds={stableWidth:previous.stableWidth,stableHeight:previous.stableHeight-toolbar.fitExtraHeight};
   const fit=fitStudioSurface(bounds,430,resolvePortraitHeight(bounds.stableHeight*430/bounds.stableWidth));
   compact=previous.portrait&&fit.compact;modes.push(previous.portrait);
   assert.ok(fit.height+(compact?64:48)<=height+16); // First notice paint is remeasured next turn.
  }
  assert.equal(new Set(modes).size,1);
  assert.equal(previous!.portrait,height-48>=width);
 }
});


test('notice predicate before reservation makes short-to-normal resize identical to a fresh normal window',()=>{
 const run=(heights:number[])=>{
  let previous:ReturnType<typeof resolveStudioViewport>|undefined,notice=false,result;
  for(const height of heights){
   const oldToolbar=splitToolbarHeight(notice?64:48,notice?12:0,4);
   previous=resolve(500,height-oldToolbar.orientationHeight,{previous});
   const naturalHeight=resolvePortraitHeight(Math.round(previous.stableHeight*430/previous.stableWidth));
   notice=previous.portrait&&fitStudioSurface(previous,430,naturalHeight).compact;
   const fitBounds={stableWidth:previous.stableWidth,stableHeight:previous.stableHeight-(notice?16:0)};
   result={notice,mode:previous.portrait,fit:fitStudioSurface(fitBounds,430,resolvePortraitHeight(Math.round(fitBounds.stableHeight*430/fitBounds.stableWidth)))};
  }
  return result;
 };
 assert.deepEqual(run([550,757]),run([757]));
 assert.deepEqual(run([550,757,757,757]),run([757]));
 assert.equal(run([550])!.notice,true);assert.equal(run([550,757])!.notice,false);
});
