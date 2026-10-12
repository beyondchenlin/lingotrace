import { sceneRenderFailureCode } from '../scene/frame-loop.ts';
import { inactiveListeningTestScope } from '../core/inactive-listening-test-fixture.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { TrainingEngine } from '../core/training.ts';
import { ListeningPlayer } from './listening-player.ts';
import { ORIGINAL_COURSE_MEDIA } from './context-bookmark-media.ts';
import { isPracticePaused,setWholePracticePaused } from '../core/practice-pause.ts';
import { CompositionInputTail } from '../core/native-input-evidence.ts';
import { SceneRecorder, isNewRecordingTerminal } from './scene-recorder.ts';
import { recordingFailureMessage } from './recording-error-message.ts';
import { CourseAudioRouting } from './course-audio-routing.ts';
import { RecordingInputResources, RecordingPreparationCanceled } from './recording-input-resources.ts';

// Exercise the shipped Studio functions, not a test implementation of their lifecycle.
// Only devices, encoder and persistence are synthetic; no browser capture or network.
const swc = createRequire(import.meta.url)('next/dist/build/swc');
await swc.loadBindings();
const studioSource = await readFile(new URL('../components/Studio.tsx', import.meta.url), 'utf8');
function sourceBetween(first, last) {
  const begin = studioSource.indexOf(first), end = studioSource.indexOf(last, begin);
  assert.ok(begin >= 0 && end > begin, `Studio source boundaries exist: ${first}`);
  return studioSource.slice(begin, end);
}
const actualRenderingFailure=sourceBetween(' function failSceneRendering(', ' const[fontsReady,');
const actualBuiltinAnswerGuard=sourceBetween(' function builtinAnswerBlocked(', ' function contextRepository(');
const actualCoursePreparation=sourceBetween(' async function prepareCourseRouting()', ' function readViewport(');
const actualHelpers = sourceBetween(' function releaseMix(', ' function exitReplay(');
const actualSubscription = sourceBetween('let observedRecorder=recorder.getSnapshot();', 'recorder.prepare().then(');
const actualDownload = sourceBetween(' async function saveRecording(', ' function downloadScene(');
const actualPreviewClear=sourceBetween(' function clearRecordingPreview(', ' async function previewRecording(');
const actualPause=sourceBetween(' function pauseTraining(){',' async function chooseFile(');
const inputCode=sourceBetween('onInput={e=>{',' onKeyDown={').slice('onInput={'.length,-1);
const compositionEndCode=sourceBetween('onCompositionEnd={e=>{',' onInput={').slice('onCompositionEnd={'.length,-1);
const visualHelpers=['showCommittedInput'].map(name=>studioSource.split('\n').find(line=>line.startsWith(` function ${name}(`))).join('\n');
const { code } = await swc.transform(`${actualRenderingFailure}\n${visualHelpers}\n${actualBuiltinAnswerGuard}\n${actualCoursePreparation}\n${actualHelpers}\n${actualPreviewClear}\n${actualSubscription}\n${actualDownload}\n${actualPause}\nconst onInput=${inputCode};const onCompositionEnd=${compositionEndCode};` , {
  jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'commonjs' },
});

// Reuse the existing adapter/encoder fixtures without importing or registering its tests.
const recorderTests = await readFile(new URL('./scene-recorder.test.mjs', import.meta.url), 'utf8');
const firstTest = recorderTests.indexOf("test('");
assert.ok(firstTest > 0);
const fixtureSource = recorderTests.slice(0, firstTest).replace(/^import .*;\r?\n/gm, '');
const { setup, FakeTrack, FakeStream, FakeRecorder, tick } = vm.runInNewContext(
  `${fixtureSource}\n({setup,FakeTrack,FakeStream,FakeRecorder,tick})`,
  { SceneRecorder, isNewRecordingTerminal, assert, EventTarget, Event, Blob, DOMException, setImmediate, queueMicrotask },
);
FakeTrack.prototype.clone = function () { return new FakeTrack(this.kind); };
FakeStream.prototype.addTrack = function (track) { this.tracks.push(track); };
const ref = current => ({ current });
const microphone = () => new FakeStream([new FakeTrack('audio')]);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class AudioNode {
  constructor(stream = null) { this.stream = stream; this.connections = new Set(); this.disconnects = []; }
  connect(target) { this.connections.add(target); }
  disconnect(target) {
    this.disconnects.push(target);
    if (target) this.connections.delete(target); else this.connections.clear();
  }
}

async function fixture(t, { requests = [], resumes = [], micAudio = true, lessonAudio = false, promptAudio=false, cueController={cancel(){},attachRecordingTarget(){return()=>{}}}, seed } = {}) {
  let practiceNow=0,serial=0;
  const { recorder, store } = setup({ capacityEstimate: null,now:()=>1700000000000+practiceNow });
  await recorder.prepare();
  if (seed) {
    const prior = new FakeStream();
    await recorder.start(prior, { source: 'canvas-composite', audioLabel: '无音频' });
    FakeRecorder.instances.at(-1).data('previous');
    await tick();
    if (seed === 'error') prior.getVideoTracks()[0].interrupt();
    await recorder.stop();
    assert.equal(recorder.getSnapshot().state, seed);
  }
  const engine=new TrainingEngine({clock:{now:()=>practiceNow,wallTime:()=>new Date(1700000000000+practiceNow).toISOString(),id:()=>`practice-${++serial}`}});
  const videos = [], destinations = [], audioContexts = [], nodes = [], microphoneCalls = [];
  const notices = [], starting = [], recordStates = [], downloads = [], panels = [], beforeDispose = [];
  class AudioContext extends EventTarget {
    callbacks=[];
    addEventListener(type,fn,...args){if(type==='statechange')this.callbacks.push(fn);super.addEventListener(type,fn,...args)}
    state = 'running';
    currentTime = 0;
    createGain(){const node=new AudioNode();node.context=this;node.gain={value:0,cancelScheduledValues(){},setValueAtTime(v){this.value=v},setTargetAtTime(v){this.value=v}};return node;}
    destination = new AudioNode();
    constructor() { super(); audioContexts.push(this); }
    resume() { return resumes.shift()?.promise ?? Promise.resolve(); }
    createMediaStreamDestination() {
      const node = new AudioNode(microphone()); node.context=this; destinations.push(node); return node;
    }
    createMediaStreamSource(stream) { const node = new AudioNode(stream); nodes.push(node); return node; }
    createMediaElementSource() { const node = new AudioNode(); nodes.push(node); return node; }
  }
  const context = vm.createContext({ ...inactiveListeningTestScope(),
    sceneRenderFailureCode,sceneRenderPhaseRef:ref('scene-paint'),setSceneFailureCode(value){context.sceneFailureCode=value},sceneFailureRef:ref(false),stageRef:ref({dataset:{}}),setSceneFailure(value){context.sceneFailure=value},t:key=>({'studio.displayInterrupted':'Display interrupted. Retry display.','studio.displayRecordingStopped':'The display was interrupted and recording stopped. The recording may be incomplete.'}[key]??key),reviewTransitionRef:ref(false),reviewStartFailureRef:ref(null),
    referenceBlocked:()=>false,referenceTransitionRef:ref(false),referenceConfirmationRef:ref(null),referencePanelRef:ref(false),referenceActionRef:ref(0),referencePreviewRef:ref(null),referenceVerificationRef:ref(null),
    Error, console, URL, setTimeout, clearTimeout, requestAnimationFrame: callback => callback(), AudioContext,
    document: { activeElement: null },
    recordingFailureMessage, CourseAudioRouting, RecordingInputResources, RecordingPreparationCanceled, isNewRecordingTerminal, isPracticePaused, setWholePracticePaused, recorder,
    navigator: { mediaDevices: { getUserMedia(constraints) {
      microphoneCalls.push({ audio: constraints.audio, video: constraints.video });
      const request = requests.shift();
      assert.ok(request, 'No unexpected microphone request');
      return request.promise;
    } } },
    fixture: false, replaySnapshot: ref(null), layoutTransactionsRef:ref({active:false}),layoutEditingRef:ref(false),
    canvasRef: ref({ captureStream(fps) {
      assert.equal(fps, 30); const stream = new FakeStream(); videos.push(stream); return stream;
    } }),
    bookmarkPreviewRef:ref(null),bookmarkRecordingBlocked:()=>false,recordStopRef:ref(null),recorderRef: ref(recorder), storageReady: true, recordPreparing: ref(false), recordRequestToken: ref(0),
    recordInputRef: ref(null), activeRecordInputRef: ref(null), audioRef: ref(null), courseRoutingRef: ref(null), monitorPrefs:ref({volume:.8,courseMuted:false,allMuted:false}),promptAudio,whiteNoise:{setEnabled(){}},submissionSound:{audio:ref(cueController)},
    disposed: ref(false), visualRef: ref({ fixture: false }), lessonRef: ref({pauses:0,pause(){this.pauses++}}), lessonAudio, micAudio,
    previewURL: ref(null), lastFocus: ref(null), engineRef: ref(engine), inputRef:ref({value:''}), standbyPausedRef:ref(false), compositionEnterRef:ref(-Infinity),committedUntilRef:ref(0),performance:{now:()=>0},composing:ref(false),pasting:ref(false), interruptedCompositionRef:ref(false), compositionTailRef:ref(new CompositionInputTail()),syncFeedback(){},setPaused(value){context.paused=value},
    setStartingRecord: value => starting.push(value), setRecordState: value => recordStates.push(value),
    notify: message => notices.push(message), download: (filename, blob) => downloads.push({ filename, blob }),
    setToolsOpen() {}, setPanel: value => panels.push(value), setRecordings() {},
    recordingPreviewRequest:ref(0),INITIAL_PREVIEW_INFO:{},setPreviewInfo(){},setMutedRecord(){},setPreview() {}, setDeleteId() {}, setResetPrompt() {},
  });
  vm.runInContext(code, context);
  t.after(async () => {
    context.disposed.current = true;
    for (const release of beforeDispose) release();
    await recorder.dispose();
    context.releaseMix();
    vm.runInContext('unsubRecorder()', context);
  });
  return { c: context, engine, advance(ms){practiceNow+=ms}, recorder, store, videos, destinations, audioContexts, nodes,
    microphoneCalls, notices, starting, recordStates, downloads, panels, beforeDispose };
}
function live(stream) { assert.ok(stream.getTracks().every(track => track.readyState === 'live')); }
function stoppedOnce(stream) {
  for (const track of stream.getTracks()) {
    assert.equal(track.readyState, 'ended'); assert.equal(track.stopCount, 1);
  }
}

for (const outcome of ['resolve', 'reject']) {
  test(`canceled mic request A may ${outcome} after B starts without stopping or rewriting B`, { timeout: 3000 }, async t => {
    const a = deferred(), b = deferred();
    const { c, recorder, videos, destinations, notices, microphoneCalls } = await fixture(t, { requests: [a, b] });
    const first = c.startRecording(); await tick();
    const inputsA = c.recordInputRef.current;
    c.closePanel();
    assert.equal(c.recordPreparing.current, false); stoppedOnce(videos[0]);
    const second = c.startRecording(); await tick();
    const inputsB = c.recordInputRef.current, micB = microphone();
    b.resolve(micB); await second;
    assert.equal(recorder.getSnapshot().state, 'recording');
    const activeId = recorder.getSnapshot().recordingId, noticeCount = notices.length;
    const micA = microphone();
    if (outcome === 'resolve') a.resolve(micA); else a.reject(new DOMException('Permission denied', 'NotAllowedError'));
    await first;
    assert.equal(recorder.getSnapshot().state, 'recording');
    assert.equal(recorder.getSnapshot().recordingId, activeId);
    assert.equal(c.recordInputRef.current, inputsB); assert.equal(c.activeRecordInputRef.current, inputsB);
    assert.equal(c.recordPreparing.current, false); assert.equal(notices.length, noticeCount);
    c.releaseMix(inputsA); // Repeated old-request cleanup must also preserve the new owner.
    live(videos[1]); live(micB); live(destinations[1].stream);
    stoppedOnce(videos[0]); stoppedOnce(destinations[0].stream);
    if (outcome === 'resolve') stoppedOnce(micA);
    assert.deepEqual(microphoneCalls, [{ audio: true, video: false }, { audio: true, video: false }]);
    FakeRecorder.instances.at(-1).data('new recording');
    await c.stopRecording();
    stoppedOnce(videos[1]); stoppedOnce(micB); stoppedOnce(destinations[1].stream);
    assert.equal(c.recordInputRef.current, null); assert.equal(c.activeRecordInputRef.current, null);
  });
}

for (const seed of ['saved', 'error']) {
  test(`closing pending mic after an earlier ${seed} recording cancels the new request`, { timeout: 3000 }, async t => {
    const request = deferred();
    const { c, recorder, videos, destinations, notices } = await fixture(t, { requests: [request], seed });
    const prior = recorder.getSnapshot(), encoderCount = FakeRecorder.instances.length;
    const pending = c.startRecording(); await tick();
    assert.equal(c.recordPreparing.current, true);
    await recorder.refreshStorageEstimate();
    live(videos[0]); // A terminal-state estimate notification must not release a pending request.
    c.closePanel();
    assert.equal(c.recordPreparing.current, false); assert.equal(c.recordInputRef.current, null);
    stoppedOnce(videos[0]); stoppedOnce(destinations[0].stream);
    const mic = microphone(); request.resolve(mic); await pending;
    stoppedOnce(mic);
    assert.equal(FakeRecorder.instances.length, encoderCount);
    assert.equal(recorder.getSnapshot().state, seed);
    assert.equal(recorder.getSnapshot().recordingId, prior.recordingId);
    assert.equal(notices.length, 0);
  });
}

test('canceling delayed AudioContext.resume does not request a mic or release a later recording', { timeout: 3000 }, async t => {
  const resumeA = deferred(), requestB = deferred();
  const { c, recorder, videos, microphoneCalls, audioContexts, destinations } = await fixture(t, {
    requests: [requestB], resumes: [resumeA],
  });
  const first = c.startRecording(); await tick();
  assert.equal(microphoneCalls.length, 0); assert.equal(destinations.length, 0);
  c.closePanel(); stoppedOnce(videos[0]);
  const second = c.startRecording(); await tick();
  const micB = microphone(); requestB.resolve(micB); await second;
  resumeA.resolve(); await first;
  assert.equal(audioContexts.length, 1); assert.equal(microphoneCalls.length, 1);
  assert.equal(destinations.length, 1); assert.equal(recorder.getSnapshot().state, 'recording');
  live(videos[1]); live(micB); live(destinations[0].stream);
  FakeRecorder.instances.at(-1).data('after resume cancellation'); await c.stopRecording();
});

test('closing during store.create waits for controller cleanup and never starts that encoder', { timeout: 3000 }, async t => {
  const request = deferred(), created = deferred();
  const { c, recorder, store, videos, destinations, notices, beforeDispose } = await fixture(t, { requests: [request] });
  store.beforeCreate = () => created.promise;
  beforeDispose.push(created.resolve);
  const pending = c.startRecording(); await tick();
  const mic = microphone(); request.resolve(mic); await tick();
  const media = FakeRecorder.instances.at(-1);
  assert.equal(media.state, 'inactive'); assert.equal(c.recordPreparing.current, true);
  c.closePanel();
  assert.equal(c.recordPreparing.current, false); assert.equal(recorder.getSnapshot().state, 'stopping');
  live(videos[0]); live(mic);
  created.resolve(); await pending;
  assert.equal(media.state, 'inactive'); assert.equal(media.timeslice, undefined);
  assert.equal(recorder.getSnapshot().state, 'error');
  assert.equal(recorder.getSnapshot().error.code, 'START_INTERRUPTED');
  const [record] = await recorder.list();
  assert.equal(record.complete, false); assert.equal(record.bytes, 0);
  stoppedOnce(videos[0]); stoppedOnce(mic); stoppedOnce(destinations[0].stream);
  assert.equal(c.recordInputRef.current, null); assert.equal(c.activeRecordInputRef.current, null);
  assert.equal(notices.length, 0);
});

test('raw mic ending interrupts a still-live mix and preserves accepted chunks for actual Studio download', { timeout: 3000 }, async t => {
  const request = deferred(), write = deferred();
  const { c, recorder, store, videos, destinations, downloads, beforeDispose } = await fixture(t, { requests: [request] });
  beforeDispose.push(write.resolve);
  const pending = c.startRecording(); await tick();
  const mic = microphone(); request.resolve(mic); await pending;
  const media = FakeRecorder.instances.at(-1), raw = mic.getAudioTracks()[0];
  media.data('committed'); await tick();
  store.beforeAppend = () => write.promise;
  media.data('-queued'); await tick();
  raw.interrupt();
  assert.equal(recorder.getSnapshot().error.code, 'SOURCE_INTERRUPTED');
  assert.equal(recorder.getSnapshot().state, 'stopping');
  live(videos[0]); live(destinations[0].stream);
  const finished = recorder.stop();
  write.resolve(); const record = await finished;
  assert.equal(recorder.getSnapshot().state, 'error');
  assert.equal(record.complete, false); assert.equal(record.status, 'incomplete');
  assert.equal(record.chunkCount, 2); assert.equal(record.audioLabel, '含麦克风');
  assert.equal(c.recordInputRef.current, null); assert.equal(c.activeRecordInputRef.current, null);
  stoppedOnce(videos[0]); stoppedOnce(destinations[0].stream);
  assert.equal(raw.readyState, 'ended'); assert.equal(raw.stopCount, 0);
  await c.saveRecording(record);
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].filename, `lingotrace-studio-${record.id}.${record.extension}`);
  assert.equal(await downloads[0].blob.text(), 'committed-queued');
  assert.equal((await store.get(record.id)).retained, false);
});

test('moving to the recording library cancels a pending microphone request', { timeout: 3000 }, async t => {
  const request = deferred();
  const { c, recorder, videos, destinations, panels, notices } = await fixture(t, { requests: [request] });
  const encoderCount = FakeRecorder.instances.length;
  const pending = c.startRecording(); await tick();
  await c.openPanel('library');
  assert.equal(panels.at(-1), 'library'); assert.equal(c.recordPreparing.current, false);
  stoppedOnce(videos[0]); stoppedOnce(destinations[0].stream);
  const mic = microphone(); request.resolve(mic); await pending;
  stoppedOnce(mic);
  assert.equal(FakeRecorder.instances.length, encoderCount);
  assert.equal(recorder.getSnapshot().state, 'idle'); assert.equal(notices.length, 0);
});

test('a completed old stop cannot release a new recording or display its stale stop notice', { timeout: 3000 }, async t => {
  const { c, recorder, videos, notices } = await fixture(t, { micAudio: false });
  await c.startRecording();
  FakeRecorder.instances.at(-1).data('first recording'); await tick();
  notices.length = 0;
  let next, restarted = false;
  const unsubscribe = recorder.subscribe(() => {
    if (!restarted && recorder.getSnapshot().state === 'saved') {
      restarted = true;
      next = c.startRecording();
    }
  });
  t.after(unsubscribe);
  await c.stopRecording(); await next;
  assert.equal(restarted, true); assert.equal(recorder.getSnapshot().state, 'recording');
  stoppedOnce(videos[0]); live(videos[1]);
  assert.equal(notices.length, 1); assert.match(notices[0], /已开始录制/);
  FakeRecorder.instances.at(-1).data('second recording'); await c.stopRecording();
});

for (const lessonAudio of [true, false]) {
  test(`${lessonAudio ? 'course-only' : 'silent'} recording never requests a microphone and saves normally`, { timeout: 3000 }, async t => {
    const { c, recorder, store, videos, destinations, microphoneCalls, nodes, audioContexts } = await fixture(t, {
      micAudio: false, lessonAudio,
    });
    await c.startRecording();
    assert.equal(recorder.getSnapshot().state, 'recording');
    assert.equal(recorder.getSnapshot().audioLabel, lessonAudio ? '含课程音频' : '无音频');
    assert.equal(microphoneCalls.length, 0); assert.equal(audioContexts.length, lessonAudio ? 1 : 0);
    FakeRecorder.instances.at(-1).data('normal'); await c.stopRecording();
    const [record] = await recorder.list();
    assert.equal(record.complete, true); assert.equal(await (await recorder.blob(record.id)).text(), 'normal');
    assert.equal((await store.get(record.id)).retained, false); stoppedOnce(videos[0]);
    if (lessonAudio) {
      stoppedOnce(destinations[0].stream);
      assert.equal([...nodes[0].connections].some(n=>n.connections.has(audioContexts[0].destination)), true);
      assert.equal(nodes[0].connections.has(destinations[0]), false);
    }
  });
}

test('whole-practice pause cuts owned inputs immediately, drains final bytes once, and resume preserves practice without restarting capture', {timeout:3000}, async t=>{
  const {c,engine,advance,recorder,store,videos,downloads,beforeDispose}=await fixture(t,{micAudio:false});
  engine.input(engine.cue.text);engine.submit();engine.input('unfinished revision');advance(1000);
  await c.startRecording();const media=FakeRecorder.instances.at(-1),write=deferred();beforeDispose.push(write.resolve);
  media.data('committed');await tick();store.beforeAppend=()=>write.promise;media.data('-queued');media.finalText='-final';
  const before=engine.getSnapshot();advance(100);c.pauseTraining();
  assert.equal(isPracticePaused(engine),true);assert.equal(c.paused,true);assert.equal(c.lessonRef.current.pauses,1);
  assert.equal(recorder.getSnapshot().state,'stopping');stoppedOnce(videos[0]);
  const stopA=c.stopRecording(),stopB=c.stopRecording();assert.equal(stopA,stopB);assert.equal(media.stopCalls,1);
  const frozen=engine.getSnapshot();advance(20000);engine.sampleClock();assert.equal(engine.getSnapshot().activeMs,frozen.activeMs);
  assert.equal(engine.draft,'unfinished revision');assert.deepEqual(engine.getSnapshot().attempts,before.attempts);assert.equal(engine.getSnapshot().earnedWords,before.earnedWords);
  c.pauseTraining();assert.equal(isPracticePaused(engine),false);assert.equal(FakeRecorder.instances.at(-1),media);assert.equal(media.state,'inactive');
  write.resolve();await stopA;const [record]=await recorder.list();assert.equal(record.stopReason,'练习暂停');assert.equal(record.endedAt,1700000001100);assert.equal(record.complete,true);
  assert.equal(await(await recorder.blob(record.id)).text(),'committed-queued-final');assert.equal(downloads.length,0);
  await c.saveRecording(record);assert.equal(downloads.length,1);assert.equal(await downloads[0].blob.text(),'committed-queued-final');
  await c.startRecording();assert.equal(recorder.getSnapshot().state,'recording');live(videos[1]);
  FakeRecorder.instances.at(-1).data('new explicit segment');await c.stopRecording();assert.equal((await recorder.list()).length,2);
});

test('pause cancels pending permission; resume and a new explicit request survive the late old stream', {timeout:3000}, async t=>{
  const a=deferred(),b=deferred();const {c,recorder,videos,microphoneCalls}=await fixture(t,{requests:[a,b]});
  const first=c.startRecording();await tick();c.pauseTraining();stoppedOnce(videos[0]);
  await c.startRecording();assert.equal(microphoneCalls.length,1);
  c.pauseTraining();assert.equal(microphoneCalls.length,1);const second=c.startRecording();await tick();
  const micB=microphone();b.resolve(micB);await second;const activeId=recorder.getSnapshot().recordingId;
  const micA=microphone();a.resolve(micA);await first;stoppedOnce(micA);live(micB);live(videos[1]);assert.equal(recorder.getSnapshot().recordingId,activeId);
  FakeRecorder.instances.at(-1).data('kept');await c.stopRecording();
});

test('pause during metadata creation cuts inputs and prevents a late encoder start after resume', {timeout:3000}, async t=>{
  const {c,recorder,store,videos,notices,beforeDispose}=await fixture(t,{micAudio:false});const created=deferred();beforeDispose.push(created.resolve);store.beforeCreate=()=>created.promise;
  const pending=c.startRecording();await tick();const media=FakeRecorder.instances.at(-1);c.pauseTraining();stoppedOnce(videos[0]);assert.equal(recorder.getSnapshot().state,'stopping');
  c.pauseTraining();created.resolve();await pending;await c.recordStopRef.current?.promise;
  assert.equal(media.timeslice,undefined);assert.equal(media.state,'inactive');assert.equal(recorder.getSnapshot().state,'error');
  assert.equal((await recorder.list())[0].complete,false);assert.ok(notices.some(n=>n.includes('未完整收尾')));assert.ok(!notices.some(n=>n.includes('已开始录制')));
});

test('late native input and canceled composition cannot rewrite the preserved draft while paused or after resume', {timeout:3000}, async t=>{
  const {c,engine}=await fixture(t,{micAudio:false});engine.input('saved draft');c.inputRef.current.value=engine.draft;
  c.composing.current=true;engine.beginComposition();c.pauseTraining();const before=engine.getSnapshot();
  c.event={currentTarget:{value:'unexpected'},nativeEvent:{inputType:'insertText',data:'x'}};vm.runInContext('onInput(event)',c);assert.equal(c.event.currentTarget.value,'saved draft');assert.equal(engine.getSnapshot(),before);
  c.pauseTraining();const resumed=engine.getSnapshot();c.event={currentTarget:{value:'saved draft旧合成'},nativeEvent:{inputType:'insertCompositionText',isComposing:true}};vm.runInContext('onInput(event)',c);assert.equal(engine.getSnapshot(),resumed);assert.equal(c.event.currentTarget.value,'saved draft');c.event={currentTarget:{value:'saved draft迟到'},data:'迟到'};vm.runInContext('onCompositionEnd(event)',c);assert.equal(engine.getSnapshot(),resumed);assert.equal(c.event.currentTarget.value,'saved draft');
  c.event={currentTarget:{value:'saved draft迟到'},nativeEvent:{inputType:'insertFromComposition'}};vm.runInContext('onInput(event)',c);assert.equal(engine.getSnapshot(),resumed);assert.equal(c.event.currentTarget.value,'saved draft');
  c.event={currentTarget:{value:'saved draft!'},nativeEvent:{inputType:'insertText',data:'!'}};vm.runInContext('onInput(event)',c);assert.equal(engine.draft,'saved draft!');assert.equal(engine.getSnapshot().attempts.length,0);
});

test('pause then reset and disposal while the old segment drains cannot submit, export, or alter the new session', {timeout:3000}, async t=>{
  const {c,engine,recorder,store,videos,downloads,beforeDispose}=await fixture(t,{micAudio:false});await c.startRecording();const media=FakeRecorder.instances.at(-1),write=deferred();beforeDispose.push(write.resolve);
  store.beforeAppend=()=>write.promise;media.data('before pause');media.finalText='-tail';c.pauseTraining();const stopped=c.stopRecording();
  engine.resetSession();const next=engine.getSnapshot();const disposal=recorder.dispose();stoppedOnce(videos[0]);write.resolve();await stopped;await disposal;
  assert.equal(engine.getSnapshot(),next);assert.equal(next.attempts.length,0);assert.equal(next.earnedWords,0);assert.equal(downloads.length,0);assert.equal(media.stopCalls,1);
  const [record]=await store.list();assert.equal(record.stopReason,'练习暂停');assert.equal(record.complete,true);assert.equal(record.chunkCount,2);
});

test('explicit prompt attachment failure never starts encoder or reports success and releases every input',async t=>{
 const {c,recorder,videos,destinations,notices,microphoneCalls}=await fixture(t,{micAudio:false,promptAudio:true,cueController:{cancel(){},attachRecordingTarget(){throw Error('提示音接入失败')}}});
 const count=FakeRecorder.instances.length;await c.startRecording();assert.equal(FakeRecorder.instances.length,count);assert.equal(recorder.getSnapshot().state,'idle');assert.equal(c.recordPreparing.current,false);assert.equal(c.recordInputRef.current,null);stoppedOnce(videos[0]);stoppedOnce(destinations[0].stream);assert.deepEqual(microphoneCalls,[]);assert.deepEqual(notices,['提示音接入失败']);
});
test('explicit prompt recording owns one bridge and cleanup without requesting microphone or enabling cues',async t=>{
 let attachments=0,releases=0;const {c,recorder,destinations,microphoneCalls}=await fixture(t,{micAudio:false,promptAudio:true,cueController:{cancel(){},attachRecordingTarget(context,destination){attachments++;assert.equal(destination.context,context);return()=>{releases++}}}});
 await c.startRecording();assert.equal(recorder.getSnapshot().state,'recording');assert.equal(attachments,1);assert.equal(releases,0);assert.deepEqual(microphoneCalls,[]);FakeRecorder.instances.at(-1).data('prompt recording');await c.stopRecording();assert.equal(releases,1);stoppedOnce(destinations[0].stream);c.releaseMix();assert.equal(releases,1);
});
test('layout preview or active editor rejects recording before capture, audio or storage work',async t=>{
 const h=await fixture(t,{requests:[]});for(const state of ['preview','editor']){h.c.layoutTransactionsRef.current.active=state==='preview';h.c.layoutEditingRef.current=state==='editor';await h.c.startRecording();assert.equal(h.videos.length,0);assert.equal(h.microphoneCalls.length,0);assert.equal(h.audioContexts.length,0);assert.equal(h.c.recordPreparing.current,false);assert.match(h.notices.at(-1),/先应用或取消/);}h.c.layoutTransactionsRef.current.active=false;h.c.layoutEditingRef.current=false;
});

test('actual recording startup blocks context preview before any capture and never attaches it to the audio graph',async t=>{
 const h=await fixture(t,{micAudio:false,lessonAudio:false}),order=[];
 h.c.bookmarkPreviewRef.current={setRecordingBlocked(value){order.push(value?'block-preview':'unblock-preview')}};
 const capture=h.c.canvasRef.current.captureStream;h.c.canvasRef.current.captureStream=(fps)=>{order.push('capture-canvas');return capture(fps)};
 await h.c.startRecording();
 assert.equal(order[0],'block-preview');assert.equal(order[1],'capture-canvas');assert.equal(h.recorder.getSnapshot().state,'recording');
 assert.equal(h.microphoneCalls.length,0);assert.equal(h.nodes.length,0);assert.equal(h.destinations.length,0);
 await h.c.stopRecording();
});

// F03 regression: a live MediaStream track does not prove its mix is processing.
test('prompt-only preparation rejects a resume that resolves without running',async t=>{
 const h=await fixture(t,{micAudio:false,promptAudio:true});const ac=new h.c.AudioContext();ac.state='suspended';h.c.audioRef.current=ac;
 await h.c.startRecording();assert.notEqual(h.recorder.getSnapshot().state,'recording');assert.equal(h.destinations.length,0);assert.equal(h.microphoneCalls.length,0);assert.match(h.notices.at(-1),/录制音频.*未能/);
});
for(const state of ['suspended','interrupted','closed'])test(`mix ${state} stops capture and preserves committed bytes without resuming`,async t=>{
 const h=await fixture(t,{micAudio:false,promptAudio:true});await h.c.startRecording();FakeRecorder.instances.at(-1).data('before mix interruption');await tick();
 const ac=h.audioContexts[0],before=h.recorder.getSnapshot().bytes;let resumes=0;ac.resume=()=>{resumes++;return Promise.resolve()};ac.state=state;ac.dispatchEvent(new Event('statechange'));await tick();await tick();
 assert.equal(h.recorder.getSnapshot().state,'error');assert.ok(h.recorder.getSnapshot().bytes>=before);assert.equal(h.recorder.getSnapshot().error.code,'AUDIO_MIX_INTERRUPTED');assert.equal(resumes,0);stoppedOnce(h.videos[0]);stoppedOnce(h.destinations[0].stream);assert.match(h.notices.join(' '),/混音.*中断/);
 const rows=await h.recorder.list();assert.equal(rows.length,1);assert.equal(rows[0].complete,false);assert.ok(rows[0].bytes>0);assert.match(rows[0].stopReason,/混音.*中断/);
});
test('mix interruption during pending microphone permission rejects late input without affecting a later request',async t=>{
 const permission=deferred();const h=await fixture(t,{requests:[permission]});const pending=h.c.startRecording();await tick();const ac=h.audioContexts[0];ac.state='suspended';ac.dispatchEvent(new Event('statechange'));await tick();
 h.c.micAudio=false;h.c.promptAudio=false;await h.c.startRecording();const next=h.recorder.getSnapshot().recordingId;const mic=microphone();permission.resolve(mic);await pending;
 assert.equal(h.recorder.getSnapshot().state,'recording');assert.equal(h.recorder.getSnapshot().recordingId,next);stoppedOnce(mic);live(h.videos[1]);
});

test('mix interruption drains committed queued and final bytes before classifying incomplete',async t=>{
 const h=await fixture(t,{micAudio:false,promptAudio:true});await h.c.startRecording();const media=FakeRecorder.instances.at(-1),write=deferred();h.beforeDispose.push(write.resolve);
 media.data('committed');await tick();h.store.beforeAppend=()=>write.promise;media.data('-queued');media.finalText='-final';
 const ac=h.audioContexts[0];ac.state='suspended';ac.dispatchEvent(new Event('statechange'));const ending=h.c.recordStopRef.current.promise;
 assert.equal(h.recorder.getSnapshot().state,'stopping');assert.equal(media.stopCalls,1);stoppedOnce(h.videos[0]);stoppedOnce(h.destinations[0].stream);
 ac.dispatchEvent(new Event('statechange'));ac.state='running';ac.dispatchEvent(new Event('statechange'));write.resolve();await ending;
 const [row]=await h.recorder.list();assert.equal(await(await h.recorder.blob(row.id)).text(),'committed-queued-final');assert.equal(row.complete,false);assert.equal(media.stopCalls,1);assert.match(h.notices.at(-1),/混音.*中断/);
 const old=ac.callbacks[0];h.c.promptAudio=false;await h.c.startRecording();const id=h.recorder.getSnapshot().recordingId;ac.state='suspended';old();assert.equal(h.recorder.getSnapshot().recordingId,id);live(h.videos[1]);
});
test('mix interruption while metadata create is pending prevents encoder start and stale success',async t=>{
 const h=await fixture(t,{micAudio:false,promptAudio:true}),created=deferred();h.beforeDispose.push(created.resolve);h.store.beforeCreate=()=>created.promise;
 const pending=h.c.startRecording();await tick();const media=FakeRecorder.instances.at(-1),ac=h.audioContexts[0];ac.state='suspended';ac.dispatchEvent(new Event('statechange'));stoppedOnce(h.videos[0]);assert.equal(h.recorder.getSnapshot().state,'stopping');
 const ending=h.c.recordStopRef.current.promise;created.resolve();await pending;await ending;assert.equal(media.timeslice,undefined);assert.equal(h.recorder.getSnapshot().state,'error');assert.ok(!h.notices.some(n=>n.includes('已开始录制')));
});
test('normal stop keeps original outcome if mix suspends while final bytes drain',async t=>{
 const h=await fixture(t,{micAudio:false,promptAudio:true});await h.c.startRecording();const media=FakeRecorder.instances.at(-1),write=deferred();h.beforeDispose.push(write.resolve);h.store.beforeAppend=()=>write.promise;media.data('normal');
 const ending=h.c.stopRecording();const ac=h.audioContexts[0];ac.state='suspended';ac.dispatchEvent(new Event('statechange'));write.resolve();await ending;
 const [row]=await h.recorder.list();assert.equal(row.complete,true);assert.equal(row.stopReason,'用户停止');assert.ok(!h.notices.some(n=>/混音.*中断/.test(n)));
});
test('callback from replaced recorder does not interrupt the current owner',async t=>{
 const h=await fixture(t,{micAudio:false,promptAudio:true});await h.c.startRecording();const original=h.c.recorderRef.current,ac=h.audioContexts[0],count=h.notices.length;
 h.c.recorderRef.current={getSnapshot(){throw Error('stale listener consulted replacement')}};ac.state='suspended';ac.callbacks[0]();assert.equal(h.notices.length,count);live(h.videos[0]);h.c.recorderRef.current=original;
});

for (const phase of ['microphone','encoder']) test(`independent: current mix state checked after pending ${phase} before success`, async t=>{
 const permission=deferred();
 const h=await fixture(t,{micAudio:phase==='microphone',promptAudio:true,requests:phase==='microphone'?[permission]:[]});
 let release;
 if(phase==='encoder'){
   const real=h.recorder.start.bind(h.recorder), gate=deferred(); release=gate.resolve;h.beforeDispose.push(release);
   h.recorder.start=async(...args)=>{await real(...args);await gate.promise;};
 }
 const pending=h.c.startRecording();await tick();const ac=h.audioContexts[0];
 ac.state='suspended'; // Real state is visible before its queued statechange callback is delivered.
 if(phase==='microphone')permission.resolve(microphone());else release();
 await pending;
 const falseSuccess=h.notices.some(n=>n.includes('已开始录制'));
 const stateBeforeEvent=h.recorder.getSnapshot().state;
 ac.dispatchEvent(new Event('statechange'));await tick();await tick();
 console.log(JSON.stringify({case:phase,stateBeforeEvent,falseSuccess,afterEvent:h.recorder.getSnapshot().state}));
 assert.equal(falseSuccess,false,'must not report healthy recording from non-running current mix');
 assert.notEqual(stateBeforeEvent,'recording','visible suspended current state must stop/reject before success');
});

function attachNativeListening(t,h){
 let now=0,hidden=false;
 class Media extends EventTarget{src='';preload='';playsInline=false;playbackRate=1;currentTime=0;duration=72;readyState=4;paused=true;ended=false;seeking=false;muted=false;volume=1;plays=0;async play(){this.plays++;this.paused=false;this.dispatchEvent(new Event('playing'))}pause(){if(!this.paused){this.paused=true;this.dispatchEvent(new Event('pause'))}}removeAttribute(){this.src=''}load(){}}
 const media=new Media(),s=h.engine.getSnapshot(),player=new ListeningPlayer({media,lease:{url:'blob:verified-native-listening',mediaId:ORIGINAL_COURSE_MEDIA.mediaId,mediaSha256:ORIGINAL_COURSE_MEDIA.mediaSha256,actualSha256:ORIGINAL_COURSE_MEDIA.mediaSha256,verified:true,verificationError:null,release(){}},descriptor:ORIGINAL_COURSE_MEDIA,material:s.material,identity:{runId:'listening-pause-test',sessionId:s.sessionId,roundId:s.roundId,materialId:s.material.id,materialVersion:s.material.version,referenceVersion:s.material.version,mediaId:ORIGINAL_COURSE_MEDIA.mediaId,mediaSha256:ORIGINAL_COURSE_MEDIA.mediaSha256},now:()=>now,hidden:()=>hidden,beforeListen(){h.engine.setFrozen('listening',true)},changed(){},blocked:()=>isPracticePaused(h.engine)});
 h.c.listening.playerRef.current=player;t.after(()=>player.dispose());
 return{player,media,tick(ms,seconds){now=ms;media.currentTime=seconds;media.dispatchEvent(new Event('timeupdate'))},hide(){hidden=true;player.visibilityChanged()}};
}
test('actual whole-practice pause stops B native owner and does not resume it or change real results',async t=>{
 const h=await fixture(t,{micAudio:false});h.engine.input(h.engine.cue.text);h.engine.submit();h.engine.input('preserved real draft');const{player,media,tick,hide}=attachNativeListening(t,h);player.enter(0);await player.play();tick(500,.5);tick(1000,1);const before=h.engine.getSnapshot();h.c.pauseTraining();assert.equal(media.paused,true);const cutoff=player.getState().observation.totals.listeningMs;hide();tick(12000,1);assert.equal(player.getState().observation.totals.listeningMs,cutoff);h.c.pauseTraining();assert.equal(media.paused,true,'practice resume is not playback authorization');assert.equal(media.plays,1);assert.equal(h.engine.draft,'preserved real draft');assert.deepEqual(h.engine.getSnapshot().attempts,before.attempts);assert.equal(h.engine.getSnapshot().earnedWords,before.earnedWords);assert.equal(h.videos.length,0);assert.equal(h.nodes.length,0);assert.equal(h.microphoneCalls.length,0);
});
test('actual whole-practice pause cancels B delayed repeat even after immediate practice resume',async t=>{
 const h=await fixture(t,{micAudio:false});const{player,media,tick}=attachNativeListening(t,h);player.enter(0);player.repeatCurrent(2,.01);await Promise.resolve();tick(1000,h.engine.cue.end);h.c.pauseTraining();h.c.pauseTraining();await new Promise(r=>setTimeout(r,25));assert.equal(media.paused,true);assert.equal(media.plays,1);assert.equal(media.currentTime,h.engine.cue.end);assert.equal(h.engine.getSnapshot().attempts.length,0);assert.equal(h.engine.getSnapshot().earnedWords,0);const preserved=h.engine.getSnapshot();await player.play();assert.equal(media.currentTime,h.engine.cue.start);tick(1500,h.engine.cue.start+.5);assert.equal(media.paused,false);assert.equal(media.plays,2);assert.equal(h.engine.getSnapshot(),preserved,'explicit repeat resumption creates no Training events or attempt');
});

for(const outcome of ['saved','failed'])test(`simulated B transition ${outcome==='saved'?'resolution':'failure'} precedes canvas capture and selected recording audio`,async t=>{
 const h=await fixture(t,{micAudio:false,lessonAudio:true}),gate=deferred(),order=[];
 h.c.listening.hasScope=()=>true;h.c.listening.beforeTransition=async()=>{order.push('seal-B');await gate.promise;order.push('sealed-B')};
 const capture=h.c.canvasRef.current.captureStream;h.c.canvasRef.current.captureStream=fps=>{order.push('capture-canvas');return capture(fps)};
 const pending=h.c.startRecording();await tick();assert.deepEqual(order,['seal-B']);assert.equal(h.videos.length,0);assert.equal(h.audioContexts.length,0);assert.equal(h.microphoneCalls.length,0);
 if(outcome==='failed')gate.reject(Error('B scope save failed'));else gate.resolve();await pending;
 if(outcome==='failed'){assert.deepEqual(order,['seal-B']);assert.equal(h.videos.length,0);assert.equal(h.audioContexts.length,0);assert.equal(h.recorder.getSnapshot().state,'idle');assert.equal(h.c.recordPreparing.current,false);assert.match(h.notices.at(-1),/B scope save failed/)}
 else{assert.deepEqual(order,['seal-B','sealed-B','capture-canvas']);assert.equal(h.recorder.getSnapshot().audioLabel,'含课程音频');assert.equal(h.nodes.length,1);assert.equal(h.microphoneCalls.length,0);FakeRecorder.instances.at(-1).data('legacy-owner-recording');await h.c.stopRecording();stoppedOnce(h.videos[0]);stoppedOnce(h.destinations[0].stream)}
});


test('renderer interruption drains final chunks as incomplete and never restarts recording during display recovery',async t=>{
 const h=await fixture(t,{micAudio:false}),before=h.engine.getSnapshot();await h.c.startRecording();const media=FakeRecorder.instances.at(-1),write=deferred();h.beforeDispose.push(write.resolve);
 media.data('committed');await tick();h.store.beforeAppend=()=>write.promise;media.data('-queued');media.finalText='-final';h.c.inputRef.current.value='hello preserved';
 h.c.failSceneRendering(Error('injected painter failure'),false);const ending=h.c.recordStopRef.current.promise;
 assert.equal(h.recorder.getSnapshot().state,'stopping');assert.equal(media.stopCalls,1);h.c.failSceneRendering(Error('persistent'),true);assert.equal(media.stopCalls,1);assert.equal(h.c.sceneFailure,'failed');
 await h.c.startRecording();assert.equal(h.videos.length,1,'no new capture while Canvas failed');write.resolve();await ending;
 const[row]=await h.recorder.list();assert.equal(await(await h.recorder.blob(row.id)).text(),'committed-queued-final');assert.equal(row.complete,false);assert.match(row.stopReason,/画面渲染中断/);assert.equal(h.recorder.getSnapshot().error.code,'SCENE_RENDER_INTERRUPTED');assert.equal(h.c.inputRef.current.value,'hello preserved');assert.deepEqual(h.engine.getSnapshot(),before);
 h.c.recoverSceneRendering();assert.equal(h.c.sceneFailure,null);assert.equal(h.videos.length,1,'display recovery never resumes capture');assert.match(h.notices.join(' '),/recording stopped.*incomplete/);
});


// PRD 11: backgrounding interrupts this segment at the visibility cutoff.
// Execute the shipped visibility handler as well as the shipped recorder helpers.
const actualVisibility=sourceBetween('const visibility=()=>{','const beforeUnload=');
function setPageHidden(h,hidden=true){
 const c=h.c;
 if(!c.onVisibility){
  Object.assign(c,{courseSwitchRef:ref(null),courseLoadRequest:ref(0),reviewMediaRequestRef:ref(null),reviewVerificationRef:ref(null),stopReviewTracking(){},correctedPlayRequest:ref(0),correctedPlayOwner:ref(null),restoredSessionRef:ref(null),restoreFailedRef:ref(false),history:{flush:()=>Promise.resolve()},lesson:c.lessonRef.current,setCourseError(){}});
  vm.runInContext(actualVisibility+';this.onVisibility=visibility;',c);
 }
 c.document.hidden=hidden;c.onVisibility();
}

for(const tracks of ['silent','microphone','course and prompt'])test(`background cuts ${tracks} capture immediately and retains final bytes for download without automatic restart`,async t=>{
 const permission=deferred();let bridgeReleases=0;
 const h=await fixture(t,{micAudio:tracks==='microphone',lessonAudio:tracks==='course and prompt',promptAudio:tracks==='course and prompt',requests:[permission],cueController:{cancel(){},attachRecordingTarget(){return()=>{bridgeReleases++}}}});
 const camera=new FakeStream();h.c.cameraStreamRef=ref(camera);
 const pending=h.c.startRecording();await tick();const mic=microphone();permission.resolve(mic);await pending;
 const media=FakeRecorder.instances.at(-1),write=deferred();h.beforeDispose.push(write.resolve);
 media.data('committed');await tick();h.store.beforeAppend=()=>write.promise;media.data('-queued');media.finalText='-final';h.advance(1234);
 setPageHidden(h);const ending=h.c.recordStopRef.current?.promise;
 assert.equal(h.recorder.getSnapshot().state,'stopping');assert.equal(media.stopCalls,1);stoppedOnce(h.videos[0]);live(camera);
 if(tracks==='microphone')stoppedOnce(mic);
 if(tracks!=='silent')stoppedOnce(h.destinations[0].stream);
 if(tracks==='course and prompt'){assert.equal(bridgeReleases,1);assert.equal(h.nodes[0].connections.has(h.destinations[0]),false)}
 h.advance(30000);setPageHidden(h);setPageHidden(h,false);assert.equal(h.videos.length,1);assert.equal(media.stopCalls,1);
 write.resolve();await ending;const[row]=await h.recorder.list();
 assert.equal(row.endedAt,1700000001234);assert.equal(row.complete,false);assert.equal(row.status,'incomplete');assert.equal(h.recorder.getSnapshot().error.code,'PAGE_BACKGROUND_INTERRUPTED');
 assert.equal(await(await h.recorder.blob(row.id)).text(),'committed-queued-final');assert.equal(h.store.removes.length,0);
 await h.c.saveRecording(row);assert.equal(await h.downloads[0].blob.text(),'committed-queued-final');assert.equal((await h.store.get(row.id)).retained,false);
 const bytes=row.bytes;media.data('-too-late');await tick();assert.equal((await h.store.get(row.id)).bytes,bytes);
 assert.equal(h.videos.length,1,'foreground visibility does not authorize capture');assert.equal(h.notices.filter(n=>/已开始录制/.test(n)).length,1);assert.equal(h.notices.filter(n=>/后台.*已写入片段保留/.test(n)).length,1);
 h.c.micAudio=false;h.c.lessonAudio=false;h.c.promptAudio=false;await h.c.startRecording();assert.equal(h.recorder.getSnapshot().state,'recording');assert.equal(h.videos.length,2);live(h.videos[1]);
 FakeRecorder.instances.at(-1).data('explicit new segment');await h.c.stopRecording();
});

for(const outcome of ['resolve','reject'])test(`background cancels pending permission and a late ${outcome} cannot revive capture or stop a new explicit foreground request`,async t=>{
 const permission=deferred(),h=await fixture(t,{requests:[permission]});
 const first=h.c.startRecording();await tick();setPageHidden(h);const canceled=!h.c.recordPreparing.current;
 const oldVideoEnded=h.videos[0].getTracks().every(track=>track.readyState==='ended');
 setPageHidden(h,false);h.c.micAudio=false;await h.c.startRecording();const next=h.recorder.getSnapshot().recordingId;
 const mic=microphone();if(outcome==='resolve')permission.resolve(mic);else permission.reject(new DOMException('No permission','NotAllowedError'));await first;
 assert.equal(canceled,true);assert.equal(oldVideoEnded,true);assert.equal(h.recorder.getSnapshot().state,'recording');assert.equal(h.recorder.getSnapshot().recordingId,next);assert.equal(h.videos.length,2);live(h.videos[1]);
 if(outcome==='resolve')stoppedOnce(mic);
 assert.equal(h.notices.filter(n=>/已开始录制/.test(n)).length,1);assert.ok(!h.notices.some(n=>/No permission/.test(n)));
 FakeRecorder.instances.at(-1).data('new');await h.c.stopRecording();
});

test('background during deferred audio resume prevents a later microphone request',async t=>{
 const resume=deferred(),permission=deferred(),h=await fixture(t,{resumes:[resume],requests:[permission]});
 const pending=h.c.startRecording();await tick();assert.equal(h.microphoneCalls.length,0);setPageHidden(h);resume.resolve();await tick();permission.resolve(microphone());await pending;
 assert.equal(h.microphoneCalls.length,0);assert.equal(h.recorder.getSnapshot().state,'idle');assert.equal(h.c.recordPreparing.current,false);stoppedOnce(h.videos[0]);assert.equal(h.destinations.length,0);assert.equal(h.notices.length,0);
});

test('background start is rejected before canvas audio microphone or encoder allocation',async t=>{
 const h=await fixture(t,{micAudio:false});h.c.document.hidden=true;const before=FakeRecorder.instances.length;await h.c.startRecording();
 assert.equal(h.videos.length,0);assert.equal(h.audioContexts.length,0);assert.equal(h.microphoneCalls.length,0);assert.equal(FakeRecorder.instances.length,before);assert.equal(h.c.recordPreparing.current,false);
});

for(const phase of ['permission','encoder'])test(`background state is rechecked after delayed ${phase} even before visibility event delivery`,async t=>{
 const permission=deferred(),h=await fixture(t,{requests:[permission],micAudio:phase==='permission'}),gate=deferred();h.beforeDispose.push(gate.resolve);
 if(phase==='encoder'){const start=h.recorder.start.bind(h.recorder);h.recorder.start=async(...args)=>{await start(...args);await gate.promise}}
 const pending=h.c.startRecording();await tick();h.c.document.hidden=true;const mic=microphone();permission.resolve(mic);gate.resolve();await pending;
 assert.notEqual(h.recorder.getSnapshot().state,'recording');assert.ok(!h.notices.some(n=>/已开始录制/.test(n)));stoppedOnce(h.videos[0]);if(phase==='permission')stoppedOnce(mic);
 await h.c.recordStopRef.current?.promise;
});

test('background during metadata creation cancels encoder startup without deleting the recoverable row',async t=>{
 const h=await fixture(t,{micAudio:false}),created=deferred();h.beforeDispose.push(created.resolve);h.store.beforeCreate=()=>created.promise;
 const pending=h.c.startRecording();await tick();const media=FakeRecorder.instances.at(-1);setPageHidden(h);const canceled=!h.c.recordPreparing.current;created.resolve();await pending;await h.c.recordStopRef.current?.promise;
 assert.equal(canceled,true);assert.equal(media.timeslice,undefined);stoppedOnce(h.videos[0]);assert.equal(h.recorder.getSnapshot().error.code,'START_INTERRUPTED');assert.ok(!h.notices.some(n=>/已开始录制/.test(n)));
 const[row]=await h.store.list();assert.equal(row.complete,false);assert.equal(row.bytes,0);assert.equal(h.store.removes.length,0);
});

for(const prior of ['normal stop','write failure'])test(`background preserves a prior ${prior} while accepted bytes drain`,async t=>{
 const h=await fixture(t,{micAudio:false});await h.c.startRecording();const media=FakeRecorder.instances.at(-1),write=deferred();h.beforeDispose.push(write.resolve);
 media.data('committed');await tick();h.store.beforeAppend=()=>write.promise;media.data('-queued');if(prior==='write failure')h.store.quotaAt=1;
 const ending=h.c.stopRecording();setPageHidden(h);write.resolve();await ending;const[row]=await h.recorder.list();
 assert.equal(media.stopCalls,1);stoppedOnce(h.videos[0]);assert.equal(row.complete,prior==='normal stop');assert.equal(h.recorder.getSnapshot().error?.code,prior==='normal stop'?undefined:'QuotaExceededError');
 assert.equal(row.stopReason,prior==='normal stop'?'用户停止':'本机存储空间不足；已提交的数据保留为未完成录像，可能无法播放。');assert.ok(!h.notices.some(n=>/页面.*后台/.test(n)));
});

test('background without committed bytes never claims a preserved downloadable segment',async t=>{
 const h=await fixture(t,{micAudio:false});await h.c.startRecording();h.notices.length=0;setPageHidden(h);await h.c.recordStopRef.current?.promise;
 assert.equal(h.recorder.getSnapshot().state,'error');assert.equal(h.recorder.getSnapshot().error.code,'PAGE_BACKGROUND_INTERRUPTED');assert.match(h.notices.join(' '),/尚未确认有已写入/);assert.doesNotMatch(h.notices.join(' '),/已写入片段保留/);
});

for(const cause of ['SOURCE_INTERRUPTED','ENCODER_ERROR','normal cutoff'])test(`background toast preserves earlier autonomous ${cause} instead of attributing it to later visibility`,async t=>{
 const h=await fixture(t,{micAudio:false}),gate=deferred();h.beforeDispose.push(gate.resolve);
 await h.c.startRecording();const media=FakeRecorder.instances.at(-1);media.data('committed');await tick();h.store.beforeAppend=()=>gate.promise;media.data('-pending');await tick();h.notices.length=0;
 if(cause==='SOURCE_INTERRUPTED')h.videos[0].getVideoTracks()[0].interrupt();
 else if(cause==='ENCODER_ERROR'){const event=new Event('error');event.error={code:cause,message:'private-device-diagnostic'};media.dispatchEvent(event)}
 else void h.recorder.stop();
 assert.equal(h.recorder.getSnapshot().state,'stopping');assert.equal(h.c.recordStopRef.current,null);
 setPageHidden(h);const ending=h.c.recordStopRef.current.promise;gate.resolve();await ending;
 const[row]=await h.recorder.list();assert.equal(h.recorder.getSnapshot().error?.code,cause==='normal cutoff'?undefined:cause);assert.equal(row.complete,cause==='normal cutoff');assert.equal(await(await h.recorder.blob(row.id)).text(),'committed-pending');
 assert.doesNotMatch(h.notices.at(-1),/页面.*后台|private-device/);
 assert.match(h.notices.at(-1),cause==='SOURCE_INTERRUPTED'?/来源已断开/:cause==='ENCODER_ERROR'?/未能继续编码/:/录像已停止/);
});
