import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,gate,until,tick} from './studio-host-test-fixture';
import {CAFE_MATERIAL} from './training';
import {NPS_MATERIAL} from './builtin-material';

async function fixture(t:Parameters<typeof setup>[0]){
 const f=await setup(t,{courseSources:true});await f.ctx.startBuiltinPractice(NPS_MATERIAL);
 const prior=f.engine.getSnapshot(),save=f.repo.saveSession.bind(f.repo),first=gate(),second=gate();let calls=0;
 t.after(()=>{first.resolve();second.resolve()});
 f.repo.saveSession=async snapshot=>{if(snapshot.sessionId!==prior.sessionId){const call=++calls;if(call===1)await first.promise;else if(call===2)await second.promise;}await save(snapshot)};
 let outcome='pending';const transition=f.ctx.startBuiltinPractice(CAFE_MATERIAL);transition.then(()=>outcome='resolved',()=>outcome='rejected');
 await until(()=>calls===1,'new-course admission write');
 return{...f,prior,first,second,transition,save,calls:()=>calls,outcome:()=>outcome};
}
async function preserved(f:Awaited<ReturnType<typeof fixture>>){assert.deepEqual((await f.repo.loadHistorySession(f.prior.sessionId))!.snapshot,f.prior)}

test('actual course admission awaits overlapping permitted flushes before reporting success',async t=>{
 const f=await fixture(t),debounced=f.history.flush();await until(()=>f.calls()===2,'late queued debounce flush');f.first.resolve();await until(()=>f.history.getSnapshot().pendingWrites===1,'first write committed');await tick();
 assert.equal(f.outcome(),'pending','one outstanding permitted write is not a failed restore');assert.equal(f.ctx.restoreFailedRef.current,false);assert.equal(f.history.getSnapshot().dirty,false);assert.equal(f.history.getSnapshot().error,null);
 const admitted=f.engine.getSnapshot();assert.deepEqual((await f.repo.loadHistorySession(admitted.sessionId))!.snapshot,admitted);await preserved(f);
 f.second.resolve();await Promise.all([f.transition,debounced]);assert.equal(f.ctx.restoreFailedRef.current,false);assert.equal(f.history.getSnapshot().pendingWrites,0);assert.equal(f.ctx.courseError,'');await f.history.flush();assert.deepEqual((await f.repo.loadHistorySession(f.engine.getSnapshot().sessionId))!.snapshot,f.engine.getSnapshot());await preserved(f);
});

test('actual course admission retains a late overlapping rejection and does not retry it',async t=>{
 const f=await fixture(t),normal=f.repo.saveSession.bind(f.repo);let rejected=false;
 f.repo.saveSession=async snapshot=>{if(snapshot.sessionId!==f.prior.sessionId&&f.calls()===1){rejected=true;await f.second.promise;throw Error('injected late quota failure')}return normal(snapshot)};
 const late=f.history.flush();await until(()=>rejected,'late rejecting flush');f.first.resolve();await until(()=>f.history.getSnapshot().pendingWrites===1,'first write committed');assert.equal(f.outcome(),'pending');const committed=f.engine.getSnapshot();f.second.resolve();await late;await assert.rejects(f.transition,/尚未保存|保存/);
 assert.equal(f.ctx.restoreFailedRef.current,true);assert.ok(f.history.getSnapshot().error);assert.equal(f.calls(),1,'no automatic retry after a real failure');assert.deepEqual((await f.repo.loadHistorySession(committed.sessionId))!.snapshot,committed);await preserved(f);
});

test('admission remembers a failed overlapping write even if a later success clears its status',async t=>{
 const f=await fixture(t),normal=f.repo.saveSession.bind(f.repo);let rejectNext=true;
 f.repo.saveSession=async snapshot=>{if(snapshot.sessionId!==f.prior.sessionId&&rejectNext){rejectNext=false;throw Error('injected overlapping failure')}return normal(snapshot)};
 await f.history.flush();assert.ok(f.history.getSnapshot().error);const later=f.history.flush();await until(()=>f.calls()===2,'success after rejection');f.second.resolve();await later;assert.equal(f.history.getSnapshot().error,null);f.first.resolve();await assert.rejects(f.transition,/尚未保存|保存/);assert.equal(f.ctx.restoreFailedRef.current,true);assert.equal(f.calls(),2);await preserved(f);
});

test('admission flushes one same-session tail without losing actual facts',async t=>{
 const f=await fixture(t);f.engine.setFrozen('listening',true);const tail=f.engine.getSnapshot();f.first.resolve();await until(()=>f.calls()===2,'one bounded tail capture');f.second.resolve();await f.transition;
 const stored=(await f.repo.loadHistorySession(tail.sessionId))!.snapshot;assert.deepEqual(stored.events.slice(0,tail.sequence),tail.events);assert.equal(f.calls(),2);assert.equal(f.ctx.restoreFailedRef.current,false);assert.deepEqual(stored.attempts,tail.attempts);await preserved(f);
});

test('admission does not loop when new facts arrive during its final tail write',async t=>{
 const f=await fixture(t);f.engine.setFrozen('listening',true);f.first.resolve();await until(()=>f.calls()===2,'final tail capture');f.engine.setFrozen('listening',false);f.second.resolve();await assert.rejects(f.transition,/尚未完成允许内容的保存/);assert.equal(f.calls(),2);assert.equal(f.history.getSnapshot().dirty,true);assert.equal(f.ctx.restoreFailedRef.current,true);await preserved(f);
});

for(const action of ['off','identity','hidden','dispose']as const)test(`admission ${action} while write is pending settles and removes observers`,async t=>{
 const f=await fixture(t);assert.ok((f.history as any).listeners.size>0);
 if(action==='off')await f.history.turnOff();
 if(action==='identity'){f.ctx.historyBindingPausedRef.current=true;try{f.engine.startReferenceSession(NPS_MATERIAL,0)}finally{f.ctx.historyBindingPausedRef.current=false}f.history.connect(f.engine.getSnapshot(),await f.repo.readAutomaticHistoryControl())}
 if(action==='hidden'){f.ctx.document.hidden=true;f.ctx.visibility()}
 if(action==='dispose'){f.ctx.disposed.current=true;f.ctx.life.current++;f.history.dispose()}
 await until(()=>f.outcome()==='rejected',`canceled ${action} admission`);await assert.rejects(f.transition);assert.equal((f.history as any).listeners.size,0,'transition wait and sticky-error observers removed before pending write settles');f.first.resolve();await tick();await tick();await preserved(f);
 if(action==='off'){assert.equal(f.history.getSnapshot().mode,'off');assert.equal(await f.repo.loadHistorySession(f.engine.getSnapshot().sessionId),null,'OFF never admits the queued new snapshot')}
});

test('cancellation during final permission read does not wait for that read or leak observers',async t=>{
 const f=await fixture(t),read=f.repo.readAutomaticHistoryControl.bind(f.repo),held=gate();let reading=false;t.after(held.resolve);
 f.repo.readAutomaticHistoryControl=async()=>{reading=true;await held.promise;return read()};f.first.resolve();await until(()=>reading,'final permission read');f.ctx.document.hidden=true;f.ctx.visibility();await until(()=>f.outcome()==='rejected','aborted permission read');await assert.rejects(f.transition);assert.equal((f.history as any).listeners.size,0);held.resolve();await preserved(f);
});

test('a changed stored history generation fails even before local notification arrives',async t=>{
 const f=await fixture(t),read=f.repo.readAutomaticHistoryControl.bind(f.repo);f.repo.readAutomaticHistoryControl=async()=>{const control=await read();return{state:'off' as const,generation:control.generation+1}};f.first.resolve();await assert.rejects(f.transition,/历史许可已变化/);assert.equal(f.ctx.restoreFailedRef.current,true);assert.equal((f.history as any).listeners.size,0);await preserved(f);
});

test('cancellation queued before capture starts no new write',async t=>{
 const f=await setup(t,{courseSources:true});await f.ctx.startBuiltinPractice(NPS_MATERIAL);await f.history.flush();f.engine.input('real unsaved tail');
 const save=f.repo.saveSession.bind(f.repo);let writes=0;f.repo.saveSession=async snapshot=>{writes++;return save(snapshot)};
 const abort=new AbortController();queueMicrotask(()=>abort.abort());
 await assert.rejects(f.history.flushForTransition(()=>!abort.signal.aborted,()=>f.repo.readAutomaticHistoryControl(),abort.signal));assert.equal(writes,0);assert.equal(f.history.getSnapshot().dirty,true);assert.equal((f.history as any).listeners.size,0);
});

for(const mode of ['off','segment']as const)for(const lifecycle of ['hidden','pagehide']as const)test(`actual ${lifecycle} in ${mode} mode cancels a hanging final read`,async t=>{
 const f=await setup(t,{courseSources:true});await f.ctx.startBuiltinPractice(NPS_MATERIAL);await f.history.flush();const prior=f.engine.getSnapshot();await f.history.turnOff();if(mode==='segment')await f.history.turnOn();assert.equal(f.history.getSnapshot().mode,mode);
 const read=f.repo.readAutomaticHistoryControl.bind(f.repo),held=gate();let reading=false,outcome='pending';t.after(held.resolve);
 f.repo.readAutomaticHistoryControl=async()=>{if(f.engine.getSnapshot().sessionId!==prior.sessionId){reading=true;await held.promise}return read()};
 const transition=f.ctx.startBuiltinPractice(CAFE_MATERIAL);transition.then(()=>outcome='resolved',()=>outcome='rejected');await until(()=>reading,'final permission read');
 const abort=f.ctx.courseSwitchRef.current.abort;assert.equal(f.ctx.reviewMediaRequestRef.current,null,'completed media request cannot own transition cancellation');
 if(lifecycle==='hidden'){f.ctx.document.hidden=true;f.ctx.visibility()}else f.ctx.pageHide();
 await until(()=>outcome==='rejected','lifecycle cancellation');await assert.rejects(transition);assert.equal(abort.signal.aborted,true);assert.equal((f.history as any).listeners.size,0,'no admission listener awaits the hung read');assert.deepEqual((await f.repo.loadHistorySession(prior.sessionId))!.snapshot,prior);assert.equal(await f.repo.loadHistorySession(f.engine.getSnapshot().sessionId),null,'temporary or partial practice never becomes a full row');held.resolve();
});

for(const turns of [0,1,2,3,4])test(`host rechecks permission ownership after final-read microtask ${turns}`,async t=>{
 const f=await setup(t,{courseSources:true});await f.ctx.startBuiltinPractice(NPS_MATERIAL);const prior=f.engine.getSnapshot(),read=f.repo.readAutomaticHistoryControl.bind(f.repo);let injected=false,changedDuringAdmission=false;
 f.repo.readAutomaticHistoryControl=async()=>{const control=await read();if(!injected&&f.engine.getSnapshot().sessionId!==prior.sessionId){injected=true;const schedule=(remaining:number)=>queueMicrotask(()=>{if(remaining)schedule(remaining-1);else{changedDuringAdmission=!!f.ctx.courseSwitchRef.current?.committed;f.history.connect(f.engine.getSnapshot(),{state:'off',generation:control.generation+1})}});schedule(turns)}return control};
 let outcome='resolved';try{await f.ctx.startBuiltinPractice(CAFE_MATERIAL)}catch{outcome='rejected'}
 assert.equal(outcome,changedDuringAdmission?'rejected':'resolved','the synchronous host receipt covers the helper return/await continuation gap');if(changedDuringAdmission)assert.equal(f.ctx.restoreFailedRef.current,true);assert.equal((f.history as any).listeners.size,0);assert.deepEqual((await f.repo.loadHistorySession(prior.sessionId))!.snapshot,prior);
});
