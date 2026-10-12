import test from 'node:test';
import assert from 'node:assert/strict';
import { readTrainingHistoryBootstrap } from './training-history-bootstrap.ts';
import { TrainingEngine } from './training.ts';
import type { AutomaticHistoryControl } from './automatic-history-control.ts';

test('ordinary untouched legacy history restores the exact snapshot', async () => {
  const saved = new TrainingEngine().getSnapshot();
  const result = await readTrainingHistoryBootstrap({ readAutomaticHistoryControl: async () => ({state:'legacy-default',generation:0}), loadLatest:async()=>saved });
  assert.strictEqual(result.saved,saved); assert.equal(result.temporary,false);
});
for (const state of ['off','segment-off','segment-on'] as const) test(`${state} never loads an old prefix or replays a partial segment`, async()=>{
  let loads=0;
  const result=await readTrainingHistoryBootstrap({readAutomaticHistoryControl:async()=>({state,generation:3}),loadLatest:async()=>{loads++;throw Error('must not run');}});
  assert.equal(loads,0);assert.equal(result.saved,null);assert.equal(result.temporary,true);
});
test('peer OFF during restore discards only the loaded projection, without altering retained history', async()=>{
  let reads=0; const saved=new TrainingEngine().getSnapshot();
  const result=await readTrainingHistoryBootstrap({readAutomaticHistoryControl:async():Promise<AutomaticHistoryControl>=>++reads===1?{state:'legacy-default',generation:0}:{state:'segment-off',generation:1},loadLatest:async()=>saved});
  assert.equal(result.saved,null);assert.equal(result.temporary,true);assert.ok(saved.events.length>0);
});
test('unknown settings fail visibly instead of assuming permission or falling back to a fresh saved session', async()=>{
  let loads=0;
  await assert.rejects(readTrainingHistoryBootstrap({readAutomaticHistoryControl:async()=>{throw Error('read unavailable');},loadLatest:async()=>{loads++;return null;}}));assert.equal(loads,0);
});
