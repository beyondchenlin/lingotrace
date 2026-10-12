import test from 'node:test';
import assert from 'node:assert/strict';
import {TrainingEngine, type Material} from './training';
import {projectRoundReview, roundReviewCueIndex} from './round-review';
export function fixture(){
 let id=0;
 const material:Material={id:'round-qa',version:'ref-v1',title:'Original QA',rights:'Original',cues:[
  {id:'a',text:'A small cup please.',start:0,end:2},{id:'b',text:'Thank you very much.',start:2,end:4},{id:'c',text:'Hidden unused sentence.',start:4,end:6}]};
 return new TrainingEngine({material,clock:{now:()=>0,wallTime:()=>new Date(0).toISOString(),id:()=>`round-${++id}`}});
}
test('empty round exposes only cue identities and unsubmitted status, never references or drafts',()=>{
 const e=fixture();e.input('private pending draft');const view=projectRoundReview(e.getSnapshot());
 assert.equal(view.unsubmitted,3);assert.equal(view.matched,0);assert.equal(view.needsCorrection,0);
 assert.doesNotMatch(JSON.stringify(view),/Hidden unused|private pending|small cup/);
});
test('groups real submissions by cue in material order, first and latest never inferred from time',()=>{
 const e=fixture();e.nextCue(1);e.input('Thank you.');e.submit();e.nextCue(0);e.input('a cup');e.submit();e.exposeHint('hint');e.input('A small cup please.');e.submit();
 const before=JSON.stringify(e.getSnapshot()),view=projectRoundReview(e.getSnapshot());
 assert.equal(view.rows[0].submissions,2);assert.equal(view.rows[0].first?.answer,'a cup');assert.equal(view.rows[0].latest?.answer,'A small cup please.');
 assert.equal(view.rows[0].latest?.conditions.hinted,true);assert.equal(view.rows[1].status,'needs-correction');assert.equal(view.rows[2].status,'unsubmitted');
 assert.equal(view.matched,1);assert.equal(view.needsCorrection,1);assert.equal(JSON.stringify(e.getSnapshot()),before);
});
test('new unsent draft does not replace latest judged attempt',()=>{
 const e=fixture();e.input('A small cup please.');e.submit();e.input('new unsubmitted wrong words');
 const row=projectRoundReview(e.getSnapshot()).rows[0];assert.equal(row.status,'matched');assert.equal(row.latest?.answer,'A small cup please.');
});
test('a later wrong submission is a correction target even if the sentence was once completed',()=>{
 const e=fixture();e.input('A small cup please.');e.submit();e.input('other');e.submit();
 const s=e.getSnapshot();assert.equal(s.completedCueIds.length,1);assert.equal(projectRoundReview(s).rows[0].status,'needs-correction');
});
test('single attempt is one shared original, no synthetic revision or average',()=>{
 const e=fixture();e.input('a cup');e.submit();const row=projectRoundReview(e.getSnapshot()).rows[0];assert.equal(row.first,row.latest);assert.equal(row.submissions,1);
});
test('mixed identity, reference, rule, invalid score and duplicate IDs are unavailable, not zero',()=>{
 const e=fixture();e.input('a cup');e.submit();e.input('small cup');e.submit();const s=e.getSnapshot();
 for(const patch of [{materialVersion:'other'},{sessionId:'other'},{roundId:'other'},{reference:'changed'},{ruleVersion:'other'},{accuracy:NaN},{words:0},{errors:-1},{attemptId:s.attempts[0].attemptId}]){
  const bad={...s,attempts:[s.attempts[0],{...s.attempts[1],...patch}]};const row=projectRoundReview(bad).rows[0];assert.equal(row.status,'unavailable');assert.equal(row.first,null);assert.equal(row.latest,null);
 }
});
test('navigation captures exact round/reference and no copied/restored attempt array is silently substituted',()=>{
 const e=fixture();e.input('a cup');e.submit();const viewed=e.getSnapshot();
 assert.equal(roundReviewCueIndex(viewed,viewed,'a'),0);assert.equal(roundReviewCueIndex(viewed,viewed,'missing'),null);
 for(const current of [{...viewed,sessionId:'new'},{...viewed,roundId:'new'}, {...viewed,material:{...viewed.material,version:'v2'}}, {...viewed,attempts:structuredClone(viewed.attempts)}])assert.equal(roundReviewCueIndex(current,viewed,'a'),null);
});
test('new draft and modal toggles permit navigation without losing draft; newer submission rejects stale panel',()=>{
 const e=fixture();e.input('a cup');e.submit();const viewed=e.getSnapshot();e.setFrozen('modal',true);e.setFrozen('modal',false);e.input('new draft');
 assert.equal(roundReviewCueIndex(e.getSnapshot(),viewed,'b'),1);e.submit();assert.equal(roundReviewCueIndex(e.getSnapshot(),viewed,'b'),null);
});
test('changed cue text/time/ordering refuses old navigation target',()=>{
 const e=fixture(),viewed=e.getSnapshot();
 for(const patch of [{text:'changed'},{start:1},{end:99},{id:'other'}]){
  const current={...viewed,material:{...viewed.material,cues:[{...viewed.material.cues[0],...patch},...viewed.material.cues.slice(1)]}};
  assert.equal(roundReviewCueIndex(current,viewed,'a'),null);
 }
});
test('long legitimate round projects every attempt without spreads or truncation',()=>{
 const e=fixture();e.input('a cup');e.submit();const s=e.getSnapshot();const attempts=Array.from({length:20000},(_,i)=>({...s.attempts[0],attemptId:`long-${i}`}));
 const row=projectRoundReview({...s,attempts}).rows[0];assert.equal(row.submissions,20000);assert.equal(row.first?.attemptId,'long-0');assert.equal(row.latest?.attemptId,'long-19999');
});
