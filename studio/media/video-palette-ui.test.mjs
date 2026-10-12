import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const require = createRequire(import.meta.url), swc = require('next/dist/build/swc');
await swc.loadBindings();
// The VM keeps React hook doubles, but uses the shipped English presentation translators.
const {translate,translateKnownUi}=require('tsx/cjs/api').require('../i18n/locale.ts',import.meta.url);
const localeHook={useStudioLocale:()=>({locale:'en',t:translate.bind(null,'en'),ui:translateKnownUi.bind(null,'en')})};
const source = await readFile(new URL('../components/VideoPaletteSettings.tsx', import.meta.url), 'utf8');
const {code} = await swc.transform(source, {jsc: {parser: {syntax: 'typescript', tsx: true}, transform: {react: {runtime: 'automatic'}}, target: 'es2022'}, module: {type: 'commonjs'}});
const initial = {mode:'off', status:'off', locked:false, hasPalette:false, message:'已关闭，保持原配色。'};
function setup() {
  const effects = [], calls = [], states = [], instances = [];
  class Controller {
    constructor(video, options) {this.options = options; instances.push(this); calls.push(['construct',video]);}
    getSnapshot() {return initial;}
    setMode(value) {calls.push(['mode',value]);}
    sourceChanged(value) {calls.push(['source',value]);}
    setReducedMotion(value) {calls.push(['reduced',value]);}
    lock() {calls.push(['lock']);}
    unlock() {calls.push(['unlock']);}
    dispose() {calls.push(['dispose']);}
  }
  const exports = {};
  vm.runInNewContext(code, {exports, require: name => name === '../i18n/react' ? localeHook : name === 'react'
    ? {...React, useRef:value=>({current:value}), useState:value=>[value,next=>states.push(next)], useEffect:effect=>effects.push(effect)}
    : name.includes('video-palette') ? {VideoPaletteController:Controller, INITIAL_VIDEO_PALETTE_STATE:initial} : require(name)});
  return {exports,effects,calls,states,instances};
}
function view(patch = {}, reducedMotion = false) {
  const env = setup(), calls = [];
  const element = env.exports.default({control:{state:{...initial,...patch},reducedMotion,
    setMode:mode=>calls.push(['mode',mode]),lock:()=>calls.push(['lock']),unlock:()=>calls.push(['unlock'])}});
  const nodes = [];
  function walk(node) {if (!node || typeof node !== 'object') return; if (Array.isArray(node)) {node.forEach(walk); return;} nodes.push(node); walk(node.props?.children);}
  walk(element);
  return {nodes,calls,html:renderToStaticMarkup(element)};
}
test('video palette settings are explicit default-off controls with honest local-only scope', () => {
  const v = view(), select = v.nodes.find(n=>n.type==='select');
  assert.equal(select.props.value,'off');
  assert.deepEqual(v.nodes.filter(n=>n.type==='option').map(n=>n.props.value),['off','frame','follow']);
  assert.equal(v.calls.length,0);
  select.props.onChange({target:{value:'frame'}}); assert.deepEqual(v.calls,[['mode','frame']]);
  for (const text of ['Off by default','layout, and motion remain unchanged','does not automatically play or seek media','frames are not uploaded','Images and camera video are excluded','preference applies only to this page','recordings retain only colors already drawn at the time']) assert.ok(v.html.includes(text),text);
  assert.equal(v.nodes.filter(n=>n.type==='button').every(n=>n.props.disabled),true);
});
test('palette lock/unlock controls and failure/reduced-motion states expose their real state', () => {
  const ready = view({mode:'follow',status:'active',hasPalette:true});
  const buttons = ready.nodes.filter(n=>n.type==='button');
  assert.equal(buttons[0].props.disabled,false); buttons[0].props.onClick(); assert.deepEqual(ready.calls,[['lock']]);
  const fixed = view({mode:'follow',status:'locked',hasPalette:true,locked:true});
  const lockedButtons = fixed.nodes.filter(n=>n.type==='button');
  assert.equal(lockedButtons[0].props.disabled,true); assert.equal(lockedButtons[1].props.disabled,false); lockedButtons[1].props.onClick();
  assert.deepEqual(fixed.calls,[['unlock']]);
  assert.ok(view({mode:'follow',status:'unavailable',message:'此素材不能读取像素，已回到原配色。'}).html.includes('notice warn'));
  assert.ok(view({mode:'follow'},true).html.includes('colors remain static instead of continuously following video'));
});
test('actual palette hook does not enable on mount and sends samples to the existing scene ref only', () => {
  const env = setup(), video = {current:{name:'lesson'}}, original = {draft:'retained draft',snapshot:{earnedWords:6,events:['original']}};
  const visual = {current:{...original}}, control = env.exports.useVideoPalette(video,visual,false);
  assert.equal(env.instances.length,0);
  const cleanup = env.effects[0](); env.effects[1]();
  assert.equal(env.calls.some(c=>c[0]==='mode'),false);
  const palette = {frame:'#adcde2',glassTop:'#18222d',glassBottom:'#111a24',glow:'#a9c8de'};
  const count = env.states.length;
  env.instances[0].options.onPalette(palette); env.instances[0].options.onPalette(null);
  assert.equal(env.states.length,count,'palette samples must not render React at sampling cadence');
  assert.equal(visual.current.draft,original.draft); assert.strictEqual(visual.current.snapshot,original.snapshot);
  control.setMode('follow');control.sourceChanged('video');control.lock();control.unlock();
  assert.deepEqual(env.calls.slice(-4),[['mode','follow'],['source','video'],['lock'],['unlock']]);
  cleanup();const after = env.states.length;env.instances[0].options.onPalette(palette);env.instances[0].options.onState({...initial,mode:'frame'});
  assert.equal(visual.current.palette,null);assert.equal(env.states.length,after);
  const calls = env.calls.length;control.setMode('frame');assert.equal(env.calls.length,calls);
});
test('actual hook forwards reduced motion, handles missing element, and never requests capture or persistence', () => {
  const env = setup();env.exports.useVideoPalette({current:{}},{current:{}},true);env.effects[0]();env.effects[1]();
  assert.deepEqual(env.calls.at(-1),['reduced',true]);
  const empty = setup();empty.exports.useVideoPalette({current:null},{current:null},false);assert.equal(empty.effects[0](),undefined);empty.effects[1]();assert.equal(empty.instances.length,0);
  assert.doesNotMatch(source,/getUserMedia|fetch\(|createMediaStreamDestination|localStorage|indexedDB|TrainingEngine|\.play\(|currentTime\s*=/);
});
test('formal Studio integrates one persistent palette owner and resets source before replacing media', async () => {
  const studio = await readFile(new URL('../components/Studio.tsx',import.meta.url),'utf8');
  assert.equal((studio.match(/useVideoPalette\(lessonRef,visualRef,reducedMotion\)/g)||[]).length,1);
  assert.match(studio,/<VideoPaletteSettings control=\{videoPalette\}\/\>/);
  const demo = studio.slice(studio.indexOf(' function loadDemo(){'),studio.indexOf(' function stopCamera('));
  assert.ok(demo.indexOf("videoPalette.sourceChanged('demo')")<demo.indexOf('video.src='));
  const local = studio.slice(studio.indexOf(' async function chooseFile('),studio.indexOf(' useEffect(()=>{disposed.current=false'));
  assert.ok(local.includes('videoPalette.sourceChanged(kind)'));
  assert.ok(local.indexOf('videoPalette.sourceChanged(kind)')<local.indexOf('video.src='));
  const recording = studio.slice(studio.indexOf(' async function startRecording('),studio.indexOf(' function stopRecording('));
  assert.doesNotMatch(recording,/videoPalette|VideoPalette/);
  assert.match(studio,/paintTransparentScene\(canvas,m,v,/);
});
