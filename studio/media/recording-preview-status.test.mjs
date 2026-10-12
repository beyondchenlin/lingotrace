import {test} from 'node:test';
import assert from 'node:assert/strict';
import {INITIAL_PREVIEW_INFO,recordingPreviewInfo} from './recording-preview-status.ts';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';

test('unknown WebM duration can become known without guessed elapsed time',()=>{
  assert.equal(INITIAL_PREVIEW_INFO.status,'loading');
  for(const duration of [NaN,Infinity,-Infinity,-1]){
    const info=recordingPreviewInfo(duration);
    assert.equal(info.status,'unknown');assert.match(info.message,/暂未识别/);
    assert.doesNotMatch(info.message,/Infinity|NaN|已损坏/);
  }
  const info=recordingPreviewInfo(3.125);
  assert.equal(info.status,'known');assert.match(info.message,/3\.13 秒/);
  assert.equal(recordingPreviewInfo(0).status,'known');
});

test('ended and error states do not fabricate a finite duration or promise playback',()=>{
  assert.match(recordingPreviewInfo(Infinity,true).message,/已结束.*仍未提供/);
  assert.equal(recordingPreviewInfo(3.1,true).status,'known');
  for(const duration of [3.1,Infinity,NaN]){
    const info=recordingPreviewInfo(duration,false,true);
    assert.equal(info.status,'error');assert.doesNotMatch(info.message,/可点击播放|总时长：/);
  }
});

test('actual Studio metadata events ignore stale previews and never seek or start playback',async()=>{
  const source=await readFile(new URL('../components/Studio.tsx',import.meta.url),'utf8');
  const begin=source.indexOf(' function updatePreviewInfo('),end=source.indexOf(' async function previewRecording(',begin);
  assert.ok(begin>=0&&end>begin);
  const swc=createRequire(import.meta.url)('next/dist/build/swc');await swc.loadBindings();
  const {code}=await swc.transform(source.slice(begin,end),{jsc:{parser:{syntax:'typescript'},target:'es2022'},module:{type:'commonjs'}});
  const states=[],current={current:'blob:first'};
  const context=vm.createContext({previewURL:current,setPreviewInfo:info=>states.push(info),INITIAL_PREVIEW_INFO,recordingPreviewInfo});
  vm.runInContext(code,context);
  const video=(url,duration)=>({duration,ended:false,error:null,getAttribute:()=>url,
    play(){assert.fail('metadata must not autoplay')},set currentTime(_){assert.fail('metadata must not seek')}});
  assert.equal(context.updatePreviewInfo(video('blob:first',Infinity),'metadata'),true);
  assert.equal(states.at(-1).status,'unknown');
  current.current='blob:second';
  context.updatePreviewInfo(video('blob:second',3.12),'metadata');
  assert.equal(states.at(-1).status,'known');
  assert.equal(context.updatePreviewInfo(video('blob:first',Infinity),'error'),false);
  assert.equal(states.length,2);
  current.current=null;
  assert.equal(context.updatePreviewInfo(video('blob:second',3.12),'ended'),false);
  assert.equal(states.length,2);
});
