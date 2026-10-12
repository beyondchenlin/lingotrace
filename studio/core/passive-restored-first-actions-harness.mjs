import { inactiveListeningTestScope } from './inactive-listening-test-fixture.mjs';
/** Test-only harness. Compiles and invokes candidate Studio handlers, not copies of them. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import vm from 'node:vm';

export const artifactRoot = fileURLToPath(new URL('.', import.meta.url));
export const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
const source = path => import(pathToFileURL(join(sourceRoot, path)).href);
export const {TrainingEngine, getDraft, replay, hasScorableReference, captureExport, makeCSV} = await source('studio/core/training.ts');
export const {deriveInputRateTimeline} = await source('studio/core/input-rate-timeline.ts');
export const {PageInputGate} = await source('studio/scene/transparent-presentation.ts');
export const {CompositionInputTail} = await source('studio/core/native-input-evidence.ts');
export const {isPracticePaused, setWholePracticePaused} = await source('studio/core/practice-pause.ts');
export const {roundReviewCueIndex} = await source('studio/core/round-review.ts');
export const {exportStudioSession} = await source('studio/core/session-export.ts');
const {translate,translateKnownUi} = await source('studio/i18n/locale.ts');
export const studio = await readFile(join(sourceRoot, 'studio/components/Studio.tsx'), 'utf8');
const require = createRequire(join(sourceRoot, 'package.json'));
const swc = require('next/dist/build/swc');
await swc.loadBindings();
const compile = async text => (await swc.transform(text, {
  jsc: {parser: {syntax: 'typescript'}, target: 'es2022'}, module: {type: 'commonjs'},
})).code;
function between(start, end, text=studio) {
  const a=text.indexOf(start), b=text.indexOf(end,a+start.length);
  assert.ok(a>=0 && b>a, `Candidate source marker missing: ${start} ... ${end}`);
  return text.slice(a,b);
}
const strictCourse = between(' function strictCourse(', ' function prepareCoursePoster(');
const builtinAnswerBlocked = between(' function builtinAnswerBlocked(', ' function contextRepository(');
const body = between(' function submit(', ' async function chooseFile(');
const seek = between(' function seekTo(', ' function dragTimeline(');
const entry = between('<textarea id="studio-answer"', '<button className="submit-hit');
const names = ['onFocus','onBlur','onCompositionStart','onCompositionEnd','onInput'];
const next = ['onBlur','onCompositionStart','onCompositionEnd','onInput','onKeyDown'];
const handlers = names.map((name,index) => {
  const start=` ${name}={`, raw=between(start,`} ${next[index]}=`,entry).slice(start.length);
  return `${name}:(${raw})`;
});
const hintStart="onClick={()=>{if(referenceBlocked())return;engineRef.current?.exposeHint('hint');";
const hint=between(hintStart,'} disabled={readonly}',studio).slice('onClick={'.length);
const mediaCallbacks=between('const onPlay=(event:Event)=>{',';const onReady=');
const visualHelpers=['clearKeyboardFeedback','showCommittedInput'].map(name=>studio.split('\n').find(line=>line.startsWith(` function ${name}(`))).join('\n');
const program = await compile(`${visualHelpers}\n${strictCourse}\n${builtinAnswerBlocked}\n${seek}\n${body}\n${mediaCallbacks};\nglobalThis.commands={submit,changeCue,continueRoundReview,togglePlay,reveal,pauseTraining};\nglobalThis.handlers={${handlers.join(',')},hint:(${hint})};\nglobalThis.mediaCallbacks={onPlay,onPause};`);

export const MATERIAL = Object.freeze({id:'first-action-qa',version:'first-action-v1',title:'First action fixture',rights:'Original regression text',cues:[
  {id:'cup',text:'A cup please.',start:0,end:2},{id:'thanks',text:'Thank you.',start:2,end:4},
]});
export const native = data => ({version:'dom-edit-v1',kind:'input',inputType:'insertText',data});
export const ime = data => ({version:'dom-edit-v1',kind:'compositionend',inputType:null,data});
export function fixture({restored=false,seed,observed=true,readOnly=true}={}) {
  let now=0,id=0;
  const clock={now:()=>now,wallTime:()=>new Date(Date.UTC(2026,9,10)+now).toISOString(),id:()=>`qa-${++id}`};
  let engine=new TrainingEngine({material:MATERIAL,sessionId:'first-action-session',clock,...observed?{inputObservation:{runId:'old-page'}}:{}});
  seed?.(engine,{advance(ms){now+=ms}});
  const saved=engine.getSnapshot();
  if(restored)engine=new TrainingEngine({snapshot:saved,clock,inputObservation:{runId:'restored-page'},restoredReadOnly:readOnly});
  const calls=[],timeouts=[];
  const video={paused:true,currentTime:0,duration:4,seekable:{length:1,start:()=>0,end:()=>4},
    pause(){calls.push(['pauseLesson']);if(!this.paused){this.paused=true;state.mediaCallbacks.onPause()}},
    play(){calls.push(['playLesson']);this.paused=false;state.mediaCallbacks.onPlay();return Promise.resolve()},
  };
  const target={value:engine.draft,focus(){calls.push(['focus'])}};
  const gate=new PageInputGate();gate.begin(engine.getSnapshot());
  engine.subscribe(()=>gate.observe(engine.getSnapshot()));
  const state={ ...inactiveListeningTestScope(),locale:'en',t:translate.bind(null,'en'),ui:translateKnownUi.bind(null,'en'),
    // No active review-task binding in the existing first-action fixtures.
    reviewMediaRef:{current:null},reviewBindingRef:{current:null},observeReviewAttempt(){},
    referenceBlocked:()=>false,engineRef:{current:engine},visualRef:{current:{}},fixture:false,replaySnapshot:{current:null},
    restoreFailedRef:{current:false},isPracticePaused,setWholePracticePaused,hasScorableReference,
    responsive:false,pressedKeysRef:{current:new Map()},committedUntilRef:{current:0},compositionEnterRef:{current:-Infinity},mediaKind:'demo',mediaRef:{current:{kind:'demo'}},composing:{current:false},pasting:{current:false},
    interruptedCompositionRef:{current:false},compositionTailRef:{current:new CompositionInputTail()},
    notify:message=>calls.push(['notice',message]),inputRef:{current:target},setResult:result=>calls.push(['result',result?.attemptId]),
    performance:{now:()=>now},submissionSound:{audio:{current:{cancel:()=>calls.push(['cancelSound']),play:(...args)=>calls.push(['sound',...args])}}},
    lesson:video,lessonRef:{current:video},pendingSeek:{current:null},mediaInteractedRef:{current:false},
    showSubtitle:false,setShowSubtitle:value=>{state.showSubtitle=value;calls.push(['subtitle',value])},
    syncDraft(){target.value=engine.draft;calls.push(['syncDraft',engine.draft])},syncFeedback(){calls.push(['feedback'])},
    panel:null,reviewSnapshot:null,roundReviewCueIndex,dialogRef:{current:{close:()=>calls.push(['dialogClose'])}},
    closePanel(restore=true){calls.push(['closePanel',restore]);state.panel=null;engine.setFrozen('modal',false)},
    courseRoutingRef:{current:null},prepareCourseRouting:()=>Promise.resolve(),
    whiteNoise:{setEnabled:value=>calls.push(['whiteNoise',value])},interruptPracticeRecording:()=>calls.push(['interruptRecording']),
    standbyPausedRef:{current:false},setPaused:value=>calls.push(['paused',value]),
    setTimeout(callback){timeouts.push(callback);return timeouts.length},
  };
  vm.createContext(state);vm.runInContext(program,state);
  return {engine,clock,saved,state,calls,video,target,gate,
    advance(ms){now+=ms},tick(ms=1000){now+=ms;engine.sampleClock()},now:()=>now,
    expireTails(){for(const callback of timeouts.splice(0))callback()},
    input(text,data='x',inputType='insertText'){target.value=text;state.handlers.onInput({currentTarget:target,nativeEvent:{inputType,data,isComposing:false}})},
    startIME(){state.handlers.onCompositionStart({nativeEvent:{isTrusted:true}})},endIME(text,data){target.value=text;state.handlers.onCompositionEnd({currentTarget:target,data,nativeEvent:{isTrusted:true}})},
    suffix(){return engine.getSnapshot().events.slice(saved.events.length)},
    read(){return deriveInputRateTimeline(engine.getSnapshot())},
  };
}
export const latest = h => h.read().points.at(-1);
export const types = events => events.map(e=>e.type);
export function assertPrefix(h) {assert.deepEqual(h.engine.getSnapshot().events.slice(0,h.saved.events.length),h.saved.events)}
