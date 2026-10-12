import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { CAFE_MATERIAL, TrainingEngine } from './training';
import * as refs from './local-reference';
import { IndexedDBLocalReferenceRepository } from './local-reference-repository';
const digest=async(value:string)=>createHash('sha256').update(value).digest('hex');
const media={id:refs.LOCAL_REFERENCE_MEDIA_ID,sha256:refs.LOCAL_REFERENCE_MEDIA_SHA256,durationSeconds:72};
const build=(options:any={})=>(refs as any).buildLocalReferenceStructureProposal({original:CAFE_MATERIAL,parent:CAFE_MATERIAL,editedCueId:CAFE_MATERIAL.cues[0].id,operation:'merge',text:'Could I have a coffee, please? Would you like it hot or iced?',media,saveRequestId:'merge-1',createdAt:'2026-10-12T00:00:00.000Z',...options},digest);
async function sign(row:any){const value={...row,materialDigest:await refs.canonicalMaterialDigest(row.material,digest)};const {receiptDigest:_,...unsigned}=value;return {...value,receiptDigest:await digest(refs.canonicalLocalReferenceJSON(unsigned))}}
test('merge produces an immutable new unit with two parents and unchanged unrelated cues',async()=>{
 const old=JSON.stringify(CAFE_MATERIAL),row=await build(),binding=row.material.localReference;
 assert.equal(binding.version,'local-reference-v2');assert.deepEqual(binding.lineage,{operation:'merge',parentUnitIds:CAFE_MATERIAL.cues.slice(0,2).map(c=>c.id),unitIds:[row.change.cueId]});
 assert.equal(row.material.cues.length,CAFE_MATERIAL.cues.length-1);assert.equal(row.change.before.id,CAFE_MATERIAL.cues[0].id);assert.equal(row.change.after.id,row.change.cueId);
 assert.ok(!CAFE_MATERIAL.cues.some(c=>c.id===row.change.cueId));assert.deepEqual(row.material.cues.slice(1),CAFE_MATERIAL.cues.slice(2));
 assert.equal(row.material.cues[0].start,CAFE_MATERIAL.cues[0].start);assert.equal(row.material.cues[0].end,CAFE_MATERIAL.cues[1].end);
 assert.equal(JSON.stringify(CAFE_MATERIAL),old);assert.ok(Object.isFrozen(row.material.localReference.lineage.unitIds));
 assert.deepEqual(await refs.validateLocalReferenceReceipt(row,CAFE_MATERIAL,CAFE_MATERIAL,digest),row);
});
test('split requires explicit text and an internal time point; both children replace the parent identity',async()=>{
 const row=await build({operation:'split',text:'Could I have',secondText:'a coffee, please?',splitAt:3,saveRequestId:'split-1'}),cues=row.material.cues;
 assert.equal(cues.length,CAFE_MATERIAL.cues.length+1);assert.deepEqual(cues.slice(0,2).map((c:any)=>[c.text,c.start,c.end]),[['Could I have',0,3],['a coffee, please?',3,6]]);
 assert.deepEqual(row.material.localReference.lineage,{operation:'split',parentUnitIds:[CAFE_MATERIAL.cues[0].id],unitIds:cues.slice(0,2).map((c:any)=>c.id)});
 assert.equal(new Set(cues.map((c:any)=>c.id)).size,cues.length);assert.ok(!cues.some((c:any)=>c.id===CAFE_MATERIAL.cues[0].id));
});
for(const patch of [{operation:'split',splitAt:0,secondText:'coffee'},{operation:'split',splitAt:6,secondText:'coffee'},{operation:'split',splitAt:3,secondText:''},{operation:'split',splitAt:NaN,secondText:'coffee'},{text:''},{operation:'unknown'},{editedCueId:CAFE_MATERIAL.cues.at(-1)!.id},{media:{...media,durationSeconds:5}}])test(`structure refuses invalid proposal ${JSON.stringify(patch)}`,async()=>{await assert.rejects(build(patch))});
test('structure rejects overlap with adjacent unaffected cues and refuses changing other metadata',async()=>{
 const overlap=structuredClone(CAFE_MATERIAL);(overlap.cues[1] as any).start=5;
 await assert.rejects(build({parent:overlap,original:overlap}));
 const row=await build(),changed=structuredClone(row);changed.material.cues[1].text='unrequested';
 await assert.rejects(refs.validateLocalReferenceReceipt(await sign(changed),CAFE_MATERIAL,CAFE_MATERIAL,digest));
});
test('signed tampered lineage, recycled IDs, altered split coverage and child metadata fail closed',async()=>{
 const row=await build({operation:'split',text:'Could I have',secondText:'a coffee, please?',splitAt:3,saveRequestId:'split-1'});
 for(const mutate of [(r:any)=>r.material.localReference.lineage.parentUnitIds.reverse().push('foreign'),(r:any)=>r.material.localReference.lineage.unitIds.reverse(),(r:any)=>{r.material.cues[1].id='cafe-01';r.material.localReference.lineage.unitIds[1]='cafe-01'},(r:any)=>r.material.cues[1].start=2,(r:any)=>r.material.cues[1].end=7,(r:any)=>r.material.cues[1].translation='invented']){
  const changed=structuredClone(row);mutate(changed);await assert.rejects(refs.validateLocalReferenceReceipt(await sign(changed),CAFE_MATERIAL,CAFE_MATERIAL,digest));
 }
});
test('repository saves merge → split → text correction, rereads lineage and retries without modifying original attempt scores',async()=>{
 const repository=new IndexedDBLocalReferenceRepository({original:CAFE_MATERIAL,indexedDB:new IDBFactory(),digest});
 try{const engine=new TrainingEngine();engine.input('Could I have a coffee, please?');engine.submit();const before=JSON.stringify(engine.getSnapshot());
  const merged=await build();assert.equal((await repository.save(merged)).disposition,'saved');assert.equal((await repository.save(merged)).disposition,'already-present');
  const split=await build({parent:merged.material,editedCueId:merged.change.cueId,operation:'split',text:'Could I have a coffee, please?',secondText:'Would you like it hot or iced?',splitAt:6,saveRequestId:'split-child'});await repository.save(split);
  const correction=await refs.buildLocalReferenceProposal({original:CAFE_MATERIAL,parent:split.material,editedCueId:split.change.cueId,text:'Could I have a small coffee, please?',start:0,end:6,media,saveRequestId:'edit-child'},digest);await repository.save(correction);
  assert.equal((await repository.list()).entries.length,3);assert.deepEqual((await repository.load(split.material.id,split.material.version))?.material,split.material);
  assert.equal(JSON.stringify(engine.getSnapshot()),before);
 }finally{await repository.close()}
});

test('unknown per-unit metadata is retained by rejecting structural edits rather than silently dropping it',async()=>{
 const original={...CAFE_MATERIAL,cues:CAFE_MATERIAL.cues.map((cue,i)=>i===0?{...cue,translation:'用户原备注'}:cue)};
 await assert.rejects(build({original,parent:original}),{code:'invalid-edit'});assert.equal((original.cues[0] as any).translation,'用户原备注');
});
test('retired ancestors cannot be resurrected through a reused version even after another split',async()=>{
 const repository=new IndexedDBLocalReferenceRepository({original:CAFE_MATERIAL,indexedDB:new IDBFactory(),digest});
 try{const first=await build();await repository.save(first);
 const split=await build({parent:first.material,editedCueId:first.change.cueId,operation:'split',text:'Could I have coffee?',secondText:'Hot or iced?',splitAt:6,saveRequestId:'child'});await repository.save(split);
 const recycle=await build({parent:split.material,editedCueId:split.change.cueId,version:first.material.version,saveRequestId:'recycle'});
 await assert.rejects(repository.save(recycle));assert.equal((await repository.list()).entries.length,2);
 }finally{await repository.close()}
});
