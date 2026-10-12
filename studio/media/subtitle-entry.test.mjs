import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../components/Studio.tsx',import.meta.url),'utf8');
const handler=source.slice(source.indexOf(' function openSubtitleWorkbench(){'),source.indexOf(' function exitReplay()'));
function fixture({state='idle',preparing=false,reference=false}={}){
 const calls=[];
 const open=vm.runInNewContext(`${handler};openSubtitleWorkbench`,{cancelFollow(){},recorderRef:{current:{getSnapshot:()=>({state})}},cancelTypingErrorFeedback(){},recordPreparing:{current:preparing},referenceBlocked:()=>reference,notify:m=>calls.push(['notice',m]),lessonRef:{current:{pause:()=>calls.push(['pause'])}},submissionSound:{audio:{current:{cancel:()=>calls.push(['cancelCue'])}}},window:{open:(...args)=>calls.push(['open',...args])}});
 return {open,calls};
}
for(const state of ['recording','stopping'])test(`workbench entry rejects live ${state}`,()=>{const f=fixture({state});f.open();assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'notice')});
test('workbench entry rejects synchronous prepare before React state',()=>{const f=fixture({preparing:true});f.open();assert.equal(f.calls[0][0],'notice');assert.equal(f.calls.length,1)});
test('workbench entry respects existing reference transaction',()=>{const f=fixture({reference:true});f.open();assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'notice')});
test('workbench opens fixed same-origin isolated page after explicit pause without data mutation',()=>{const f=fixture();f.open();assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[['pause'],['cancelCue'],['open','/subtitle-workbench/','_blank','noopener,noreferrer']]);assert.doesNotMatch(handler,/resetSession|submit\(|fetch\(|queueSave|turnOn|turnOff|setItem|indexedDB/)});
test('build copies independent workbench without replacing old routes',async()=>{const build=await readFile(new URL('../../scripts/assemble-site.mjs',import.meta.url),'utf8');assert.match(build,/'subtitle-workbench'/);assert.match(build,/'studio-assets'/);assert.match(source,/disabled=\{referenceBusy\|\|activeRecord\|\|startingRecord\|\|restoreFailed\} onClick=\{openSubtitleWorkbench\}/)});
