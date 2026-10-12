import { inactiveListeningTestScope } from './inactive-listening-test-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {NPS_MATERIAL} from './builtin-material.ts';

const source=fs.readFileSync(new URL('../components/Studio.tsx',import.meta.url),'utf8');
const start=source.indexOf(' function togglePlay(restart=false)'),end=source.indexOf(' async function toggleCorrectedPlay',start);
assert.ok(start>=0&&end>start);
const implementation=source.slice(start,end).trim();
function setup({hidden=false,recording=false,blocked=false,error='[metadata; MEDIA_4; ready=0; network=3]',ready=false}={}){
 const calls:unknown[]=[];
 const engine={getSnapshot:()=>({material:NPS_MATERIAL})};
 const scope={ ...inactiveListeningTestScope(),referenceBlocked:()=>blocked,engineRef:{current:engine},builtinMediaReady:ready,courseError:error,
  document:{hidden},bookmarkRecordingBlocked:()=>recording,loadBuiltinMaterial:async (material:unknown)=>{calls.push(['reload',material])},
  reviewMediaRef:{current:null},mediaRef:{current:{kind:'demo'}},strictCourse:()=>true,toggleCorrectedPlay:()=>{calls.push(['normal-play'])}};
 const toggle=new Function(...Object.keys(scope),`return (${implementation})`)(...Object.values(scope));
 return {calls,toggle};
}
test('actual play control retries the same failed NPS source without auto-playing or replacing the session',()=>{
 const f=setup();f.toggle();assert.equal(f.calls.length,1);assert.equal((f.calls[0] as unknown[])[0],'reload');assert.equal((f.calls[0] as unknown[])[1],NPS_MATERIAL);
});
for(const flag of ['hidden','recording','blocked'] as const)test(`NPS reload control fails closed while ${flag}`,()=>{
 const f=setup({[flag]:true});f.toggle();assert.deepEqual(f.calls,[]);
});
test('loading with no failure message does not start another load',()=>{const f=setup({error:''});f.toggle();assert.deepEqual(f.calls,[['normal-play']]);});
test('ready media continues through the ordinary user-gesture play path',()=>{const f=setup({ready:true});f.toggle();assert.deepEqual(f.calls,[['normal-play']]);});
