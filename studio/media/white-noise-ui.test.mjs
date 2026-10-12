import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url),swc=require('next/dist/build/swc');await swc.loadBindings();
// The VM keeps React hook doubles, but uses the shipped English presentation translators.
const {translate,translateKnownUi}=require('tsx/cjs/api').require('../i18n/locale.ts',import.meta.url);
const localeHook={useStudioLocale:()=>({locale:'en',t:translate.bind(null,'en'),ui:translateKnownUi.bind(null,'en')})};
const source=await readFile(new URL('../components/WhiteNoiseSettings.tsx',import.meta.url),'utf8');
const {code}=await swc.transform(source,{jsc:{parser:{syntax:'typescript',tsx:true},transform:{react:{runtime:'automatic'}},target:'es2022'},module:{type:'commonjs'}});
const initial={enabled:false,enabling:false,volume:0.3,error:null,disableReason:null};
function setup(){
 const effects=[],calls=[],instances=[],states=[];
 class Audio {constructor(){instances.push(this)}getSnapshot(){return initial}subscribe(listener){this.listener=listener;calls.push(['subscribe']);return()=>calls.push(['unsubscribe'])}enable(){calls.push(['enable']);return Promise.resolve()}disable(reason){calls.push(['disable',reason])}setVolume(value){calls.push(['volume',value])}dispose(){calls.push(['dispose'])}}
 const exports={};vm.runInNewContext(code,{exports,require:name=>name==='../i18n/react'?localeHook:name==='react'?{...React,useRef:value=>({current:value}),useState:value=>[value,s=>states.push(s)],useEffect:fn=>effects.push(fn)}:name.includes('white-noise-audio')?{WhiteNoiseAudio:Audio,INITIAL_WHITE_NOISE_SNAPSHOT:initial}:require(name)});
 return {exports,effects,calls,instances,states};
}
function view(patch={},reducedMotion=false){const env=setup(),calls=[];const el=env.exports.default({control:{state:{...initial,...patch},reducedMotion,setEnabled:value=>calls.push(['enable',value]),setVolume:value=>calls.push(['volume',value])}}),nodes=[];function walk(n){if(!n||typeof n!=='object')return;if(Array.isArray(n)){n.forEach(walk);return}nodes.push(n);walk(n.props?.children)}walk(el);return{nodes,calls,html:renderToStaticMarkup(el)}}
test('white-noise settings start OFF with bounded independent volume and honest routing scope',()=>{
 const v=view(),toggle=v.nodes.find(n=>n.type==='input'&&n.props.type==='checkbox'),slider=v.nodes.find(n=>n.type==='input'&&n.props.type==='range');
 assert.equal(toggle.props.checked,false);assert.equal(slider.props.min,'0');assert.equal(slider.props.max,'1');assert.equal(slider.props.value,0.3);
 for(const phrase of ['off by default','not typing speed','not directly mixed into recordings','microphone','Course mute and standby sounds are independent','returning does not restart it'])assert.ok(v.html.includes(phrase),phrase);
 assert.equal(v.calls.length,0);assert.doesNotMatch(v.html,/提升专注|保证听到|入片选项|improves focus|guarantees hearing|recording inclusion/i);
 toggle.props.onChange({target:{checked:true}});slider.props.onChange({target:{value:'0.75'}});assert.deepEqual(v.calls,[['enable',true],['volume',0.75]]);
});
test('enabling remains cancelable; errors and hidden-stop states are truthful',()=>{
 const pending=view({enabling:true});const toggle=pending.nodes.find(n=>n.props?.type==='checkbox');assert.equal(toggle.props.checked,true);assert.equal(toggle.props.disabled,false);
 toggle.props.onChange({target:{checked:false}});assert.deepEqual(pending.calls,[['enable',false]]);
 assert.ok(view({error:{message:'启音被拒绝'}}).html.includes('启音被拒绝'));
 for(const disableReason of ['hidden','pagehide','interrupted'])assert.ok(view({disableReason}).html.includes('Enable it again explicitly'));
 const reduced=view({},true);assert.equal(reduced.nodes.find(n=>n.props?.type==='checkbox').props.disabled,true);assert.ok(reduced.html.includes('white noise stays off'));
});
test('actual hook never enables on mount, subscribes, and fully disposes on Studio unmount',()=>{
 const env=setup(),control=env.exports.useWhiteNoiseAudio(false);assert.equal(env.instances.length,0);const cleanup=env.effects[0]();env.effects[1]();
 assert.deepEqual(env.calls,[['subscribe']]);assert.deepEqual(env.states,[initial]);
 control.setVolume(0);assert.deepEqual(env.calls.at(-1),['volume',0]);assert.equal(env.calls.some(c=>c[0]==='enable'),false);
 control.setEnabled(true);assert.deepEqual(env.calls.at(-1),['enable']);control.setEnabled(false);assert.deepEqual(env.calls.at(-1),['disable','user']);
 cleanup();assert.deepEqual(env.calls.slice(-2),[['unsubscribe'],['dispose']]);control.setEnabled(true);assert.equal(env.calls.at(-1)[0],'dispose');
});
test('reduced-motion effect disables sound without a later auto-enable',()=>{
 const env=setup(),control=env.exports.useWhiteNoiseAudio(true);env.effects[0]();env.effects[1]();assert.deepEqual(env.calls.at(-1),['disable','reduced_motion']);control.setEnabled(true);assert.equal(env.calls.some(c=>c[0]==='enable'),false);
});
test('Studio owns the hook outside settings; recording graph does not gain noise connections',async()=>{
 const studio=await readFile(new URL('../components/Studio.tsx',import.meta.url),'utf8');
 assert.match(studio,/const whiteNoise=useWhiteNoiseAudio\(reducedMotion\)/);assert.match(studio,/<WhiteNoiseSettings control=\{whiteNoise\}\/\>/);
 const graph=studio.slice(studio.indexOf(' async function startRecording('),studio.indexOf(' function stopRecording('));
 assert.ok(graph.length>0);assert.doesNotMatch(graph,/whiteNoise|WhiteNoise/);assert.doesNotMatch(source,/getUserMedia|createMediaStreamDestination|recorderRef|TrainingEngine|localStorage|indexedDB/);
});
