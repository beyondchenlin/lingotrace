import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {TrainingEngine,hasScorableReference,type Material} from './training';
import {getDraftFeedback} from './draft-feedback';
import {isPracticePaused} from './practice-pause';
import {inactiveListeningTestScope} from './inactive-listening-test-fixture.mjs';
import {translate,type StudioLocale} from '../i18n/locale';

// Exercise the shipped submit, restore/feedback synchronization, mode effect and
// actual accessibility JSX. React rendering here is not a real screen-reader run.
const require=createRequire(import.meta.url),React=require('react'),parser=require('next/dist/compiled/babel/parser'),swc=require('next/dist/build/swc');
await swc.loadBindings();
const source=await readFile(new URL('../components/Studio.tsx',import.meta.url),'utf8');
const ast=parser.parse(source,{sourceType:'module',plugins:['typescript','jsx']});
const studio=ast.program.body.find((n:any)=>n.type==='FunctionDeclaration'&&n.id?.name==='StudioContent');
assert.ok(studio);
const names=['builtinAnswerBlocked','submit','syncFeedback','exitReplay'];
const functions=names.map(name=>{const n=studio.body.body.find((n:any)=>n.type==='FunctionDeclaration'&&n.id.name===name);assert.ok(n,name);return source.slice(n.start,n.end)}).join('\n');
const sync=studio.body.body.find((n:any)=>n.type==='VariableDeclaration'&&n.declarations.some((d:any)=>d.id?.name==='syncDraft'));
assert.ok(sync);
const nodes=new Map<string,string>();let invalidateAnnouncement='()=>{}';
function visit(n:any){
 if(!n||typeof n!=='object')return;
 if(n.type==='JSXElement'){
  const id=n.openingElement.attributes.find((a:any)=>a.type==='JSXAttribute'&&a.name?.name==='id')?.value?.value;
  if(['entry-status','submission-announcement'].includes(id))nodes.set(id,source.slice(n.start,n.end));
 }
 if(n.type==='CallExpression'&&n.callee?.name==='useEffect'&&n.arguments[0]&&source.slice(n.arguments[0].start,n.arguments[0].end).includes('current?.announcement'))invalidateAnnouncement=source.slice(n.arguments[0].start,n.arguments[0].end);
 for(const [key,value]of Object.entries(n))if(!['loc','tokens','comments'].includes(key)){if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value)}
}
visit(studio);assert.ok(nodes.has('entry-status'));
const {code}=await swc.transform(`${functions}\n${source.slice(sync.start,sync.end)}\nfunction renderStatus(){return <>${[...nodes.values()].join('')}</>}\nconst invalidateAnnouncement=${invalidateAnnouncement};\nglobalThis.handlers={${names.join(',')},syncDraft,renderStatus,invalidateAnnouncement};`,{jsc:{parser:{syntax:'typescript',tsx:true},target:'es2022',transform:{react:{runtime:'classic'}}},module:{type:'commonjs'}});
const material:Material={id:'accessibility-original',version:'1',title:'Original fixture',rights:'Original',cues:[{id:'a',text:'A cup please.',start:0,end:2},{id:'b',text:'Thank you.',start:2,end:4}]};
function harness(options:{engine?:TrainingEngine;material?:Material;locale?:StudioLocale;sound?:boolean}={}){
 let id=0;const engine=options.engine??new TrainingEngine({material:options.material??material,clock:{now:()=>0,wallTime:()=>new Date(0).toISOString(),id:()=>`accessibility-${++id}`}}),sounds:any[][]=[],notices:string[]=[];
 const c:any={...inactiveListeningTestScope(),locale:options.locale??'en',React,require,getDraftFeedback,isPracticePaused,hasScorableReference,result:null,fixture:false,replayIndex:null,replaySnapshot:{current:null},engineRef:{current:engine},visualRef:{current:{gain:0,rewardAttemptId:null}},inputRef:{current:{value:engine.draft,focus(){}}},composing:{current:false},mediaKind:'demo',referenceBlocked:()=>false,observeReviewAttempt(){},resetExpiredInputGuide(){},setCurrentCue(){},syncNativeFeedback(){},setReplayIndex(value:number|null){c.replayIndex=value},setResult(value:any){c.result=typeof value==='function'?value(c.result):value},notify:(s:string)=>notices.push(s),performance:{now:()=>0},t:(key:any,args?:any)=>translate(c.locale,key,args),submissionSound:{audio:{current:{getSnapshot:()=>({enabled:options.sound!==false}),play:(...args:any[])=>sounds.push(args)}}},changeCue(index:number){engine.nextCue(index);c.syncDraft()}};
 vm.createContext(c);vm.runInContext(code,c);Object.assign(c,c.handlers);
 const render=()=>flatten(c.renderStatus());
 return {c,engine,sounds,notices,render,input(text:string){engine.input(text);c.inputRef.current.value=text;c.syncFeedback()},live(){return render().filter(n=>n.props?.role==='status'||n.props?.['aria-live']==='polite')},description(){return render().find(n=>n.props?.id==='entry-status')},mode(mode:'fixture'|'replay',on:boolean){if(mode==='fixture')c.fixture=on;else{c.replayIndex=on?1:null;c.replaySnapshot.current=on?engine.getSnapshot():null}c.invalidateAnnouncement()}};
}
function flatten(node:any):any[]{if(!node||typeof node!=='object')return[];const kids=node.props?.children;return[node,...(Array.isArray(kids)?kids:[kids]).flatMap(flatten)]}
function text(node:any):string{if(node==null||typeof node==='boolean')return'';if(typeof node!=='object')return String(node);const children=node.props?.children;return(Array.isArray(children)?children:[children]).map(text).join('')}
const liveText=(h:ReturnType<typeof harness>)=>h.live().map(text).join('');

for(const passive of [true,false])test(`actual ${passive?'passive':'active'} restore keeps old results readable without posting old gain to a live region`,()=>{
 const prior=harness();prior.input(prior.engine.cue.text);prior.c.submit();const saved=prior.engine.getSnapshot(),attempt=prior.engine.currentResult!;
 const restored=new TrainingEngine({snapshot:saved,restoredReadOnly:passive});const h=harness({engine:restored}),before=JSON.stringify(restored.getSnapshot());h.render();h.c.syncDraft();
 assert.equal(liveText(h),'','restoring an old attempt is not a submission announcement');
 assert.equal(h.description().props.role,undefined);assert.match(text(h.description()),/Last checked result/);assert.doesNotMatch(text(h.description()),/new correct words/);
 assert.equal(restored.currentResult?.attemptId,attempt.attemptId);assert.equal(JSON.stringify(restored.getSnapshot()),before);assert.equal(h.sounds.length,0);assert.equal(h.c.visualRef.current.gain,0);assert.equal(h.c.visualRef.current.rewardAttemptId,null);
});

for(const outcome of ['correction','firstCompletion','correct'])test(`actual ${outcome} submission has matching audio and accessible result in both locales without changing stored facts`,()=>{
 for(const locale of ['en','zh-CN'] as const){const h=harness({locale});if(outcome==='correct'){h.input(h.engine.cue.text);h.c.submit();h.input('A cup please!')}else h.input(outcome==='correction'?'A dog.':h.engine.cue.text);h.c.submit();
  const attempt=h.engine.currentResult!,before=JSON.stringify(h.engine.getSnapshot()),regions=h.live();assert.equal(regions.length,1);assert.equal(regions[0].props['aria-live'],'polite');assert.equal(regions[0].props['aria-atomic'],'true');
  const sound=h.sounds.at(-1);assert.ok(sound);assert.equal(sound[0],outcome);assert.equal(sound[1],attempt.attemptId);
  assert.match(liveText(h),locale==='en'?(outcome==='firstCompletion'?/First completion of this sentence/:outcome==='correct'?/Correct\./:/Review the differences/):(outcome==='firstCompletion'?/本会话首次完成本句/:outcome==='correct'?/正确。/:/检查差异/));
  assert.ok(liveText(h).includes(String(attempt.errors)));assert.ok(liveText(h).includes(String(attempt.gain)));assert.equal(JSON.stringify(h.engine.getSnapshot()),before);assert.equal(Object.hasOwn(attempt,'announcement'),false);assert.equal(h.c.visualRef.current.lastResult,attempt);
 }
});

test('sound disabled does not suppress the textual submission result',()=>{const h=harness({sound:false});h.input(h.engine.cue.text);h.c.submit();assert.match(liveText(h),/First completion/)});

test('Hidden unchecked drafts expose neither target words nor correctness across different references',()=>{
 let prior='';for(const target of ['Secret answer alpha.','A much longer hidden target with different words.']){const h=harness({material:{...material,cues:[{...material.cues[0],text:target}]}});h.c.referenceVisibleRef.current=false;h.input('my own unchecked input');const rendered=h.render().map(text).join('');assert.equal(liveText(h),'');assert.doesNotMatch(rendered,/Secret|alpha|hidden target|differences|correct|completed/);assert.equal(h.sounds.length,0);assert.equal(h.engine.getSnapshot().attempts.length,0);if(prior)assert.equal(rendered,prior);prior=rendered}
});

test('different real attempts with identical messages still replace the keyed announcement child',()=>{
 const h=harness();h.input(h.engine.cue.text);h.c.submit();h.input('A dog please.');h.c.submit();const a=h.live()[0].props.children;assert.ok(a);const key=a.key,message=text(a);h.input('A mug please.');h.c.submit();const b=h.live()[0].props.children;assert.ok(b);
 assert.equal(text(b),message);assert.notEqual(b.key,key);assert.equal(b.key,h.engine.currentResult?.attemptId);assert.notEqual(key,null);const sound=h.sounds.at(-1);assert.ok(sound);assert.equal(sound[0],'correction');
});

test('empty, duplicate and blocked submission paths never create a new announcement or attempt',()=>{
 const empty=harness();empty.c.submit();assert.equal(liveText(empty),'');assert.equal(empty.engine.getSnapshot().attempts.length,0);
 const h=harness();h.input('A dog.');h.c.submit();const first=h.live()[0].props.children,key=first.key,count=h.engine.getSnapshot().attempts.length,sounds=h.sounds.length;h.c.submit();assert.equal(h.live()[0].props.children.key,key);assert.equal(h.engine.getSnapshot().attempts.length,count);assert.equal(h.sounds.length,sounds);
 for(const mode of ['fixture','replay','composition','paused','image','reference']){const b=harness();b.input(b.engine.cue.text);if(mode==='fixture')b.c.fixture=true;if(mode==='replay'){b.c.replayIndex=1;b.c.replaySnapshot.current=b.engine.getSnapshot()}if(mode==='composition')b.c.composing.current=true;if(mode==='paused')b.engine.setFrozen('paused',true);if(mode==='image')b.c.mediaKind='image';if(mode==='reference')b.c.referenceBlocked=()=>true;b.c.submit();assert.equal(liveText(b),'',mode);assert.equal(b.engine.getSnapshot().attempts.length,0,mode);assert.equal(b.sounds.length,0,mode)}
});

test('feedback synchronization and canceled composition do not reannounce a checked attempt',()=>{
 const h=harness();h.input(h.engine.cue.text);h.c.submit();const saved=JSON.stringify(h.engine.getSnapshot());h.c.syncFeedback();assert.equal(liveText(h),'');assert.match(text(h.description()),/Last checked result/);assert.equal(JSON.stringify(h.engine.getSnapshot()),saved);
 h.engine.beginComposition();h.c.composing.current=true;h.c.syncFeedback();assert.equal(liveText(h),'');h.engine.endComposition(h.engine.draft);h.c.composing.current=false;h.c.syncFeedback();assert.equal(liveText(h),'');assert.equal(h.engine.getSnapshot().attempts.length,1);
});

for(const mode of ['fixture','replay'] as const)test(`entering and leaving ${mode} cannot revive a previous live announcement`,()=>{
 const h=harness();h.input(h.engine.cue.text);h.c.submit();assert.match(liveText(h),/First completion/);const count=h.sounds.length;h.mode(mode,true);assert.equal(liveText(h),'');h.mode(mode,false);assert.equal(liveText(h),'');assert.equal(h.sounds.length,count);assert.equal(h.engine.getSnapshot().attempts.length,1);
});

test('decorative reward values and unchanged render passes cannot generate or alter submission announcements',()=>{
 const h=harness();h.c.visualRef.current.gain=999;h.c.visualRef.current.rewardAttemptId='decorative';h.c.visualRef.current.lastResult={errors:0,firstCompletion:true};assert.equal(liveText(h),'');
 h.input(h.engine.cue.text);h.c.submit();const before=liveText(h),key=h.live()[0].props.children.key;h.c.visualRef.current.gain=999;h.c.visualRef.current.rewardAttemptId='other';assert.equal(liveText(h),before);assert.equal(h.live()[0].props.children.key,key);assert.doesNotMatch(before,/999/);
});

test('a genuine new submit after passive restoration can announce without replaying its saved success',()=>{
 const first=harness();first.input(first.engine.cue.text);first.c.submit();const restored=new TrainingEngine({snapshot:first.engine.getSnapshot(),restoredReadOnly:true});const h=harness({engine:restored});h.c.syncDraft();assert.equal(liveText(h),'');h.input('A cup please!');h.c.submit();assert.match(liveText(h),/Correct\./);assert.doesNotMatch(liveText(h),/First completion/);assert.equal(h.engine.getSnapshot().attempts.length,2);assert.equal(h.sounds.length,1);
});


test('changing interface language cannot translate or revive an old submission announcement',()=>{
 const h=harness();h.input(h.engine.cue.text);h.c.submit();const saved=JSON.stringify(h.engine.getSnapshot()),sounds=h.sounds.length;
 assert.match(liveText(h),/First completion/);
 h.c.locale='zh-CN';assert.equal(liveText(h),'','hide old-locale announcements before effects run');h.c.invalidateAnnouncement();assert.equal(liveText(h),'');
 h.c.locale='en';assert.equal(liveText(h),'');h.c.invalidateAnnouncement();assert.equal(liveText(h),'');
 assert.equal(JSON.stringify(h.engine.getSnapshot()),saved);assert.equal(h.sounds.length,sounds);
 h.c.locale='zh-CN';h.c.invalidateAnnouncement();h.input('A cup please!');h.c.submit();assert.match(liveText(h),/正确。/);assert.doesNotMatch(liveText(h),/首次完成/);assert.equal(h.sounds.length,sounds+1);
});
