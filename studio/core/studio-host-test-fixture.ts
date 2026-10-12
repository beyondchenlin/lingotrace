import {translate,translateKnownUi} from '../i18n/locale';
import { inactiveListeningTestScope } from './inactive-listening-test-fixture.mjs';
import {NPS_PLAYBACK_MEDIA} from '../media/nps-playback.ts';
// Test-only shared fixture: executes the shipped Studio handlers in their host realm.
import { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { IDBFactory } from 'fake-indexeddb';
import { TrainingEngine, CAFE_MATERIAL, hasScorableReference, getDraft, type TrainingSnapshot } from './training';
import { IndexedDBTrainingRepository } from './repository';
import { TrainingHistoryRecorder } from './training-history-recorder';
import { NPS_MATERIAL, NPS_COURSE_MEDIA, builtinCourseForMaterial, isBuiltinMaterial } from './builtin-material';
import { IndexedDBLocalReferenceRepository } from './local-reference-repository';
import { buildLocalReferenceProposal, canonicalLocalReferenceJSON, LOCAL_REFERENCE_MEDIA_ID, LOCAL_REFERENCE_MEDIA_SHA256 } from './local-reference';
import { buildReviewTarget, reviewSame } from './review-tasks';
import { reviewAttemptSource } from './review-task-source';
import { resolveReviewLocalTime } from './review-due-time';
import { flushReferenceTransition, assertReferenceTransitionBoundary } from './reference-transition';
import { CompositionInputTail } from './native-input-evidence';
import { FixedPaceFinishObserver } from './fixed-pace-finish';
import { TypingFollowInput } from './typing-follow-input';
import { qualifyingTypingFollowAppend } from './typing-follow-policy';
import { exportStudioSession as exportSession } from './session-export';
import { isPracticePaused } from './practice-pause';
import { correctedReferenceMediaError } from '../media/corrected-reference-media';
import { createContextBookmarkPreviewController, isExactNativeAACError, isVerifiedCourseMediaLease, ORIGINAL_COURSE_MEDIA, type OriginalCourseMediaLease } from '../media/context-bookmark-media';
import {fixedReviewDurationMatches,fixedReviewTargetMatches,reviewMediaDiagnostic,reviewDurationDiagnostic,reviewRangeDiagnostic} from '../media/fixed-review-media';

// Execute the shipped host functions, not a second implementation of their
// workflow. Same-realm evaluation preserves the strict plain-JSON validators.
const require = createRequire(import.meta.url), parser = require('next/dist/compiled/babel/parser'), swc = require('next/dist/build/swc');
await swc.loadBindings();
const source = await readFile(new URL('../components/Studio.tsx', import.meta.url), 'utf8');
const ast = parser.parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
const studio = ast.program.body.find((node: any) => node.type === 'FunctionDeclaration' && node.id?.name === 'StudioContent');
assert.ok(studio, 'Locate the real Studio component');
const names = ['fixedPaceFrame','clearFixedPace','invalidateFixedPace','beginFixedPace','captureFixedPaceInput','observeFixedPaceInput','observeFixedPaceMedia','observeFixedPaceFollow','checkFixedPace','choosePacingStrategy','chooseFixedRate','renderFixedPaceResult','fixedPaceDeltaLabel','interruptPracticeRecording','disarmFollowAutoEntry','armFollowAutoEntry','handleFollowNative','followAutoEntryMatches','prepareFollowInput','commitFollowInput','cancelFollow','startFollow','followSourceQualified','followReferenceShown','followEnvironment','clearKeyboardFeedback','showCommittedInput','handleAnswerKeyDown','handleAnswerBeforeInput','builtinAnswerBlocked', 'coursePool', 'strictCourse', 'prepareCoursePoster', 'referenceRepository', 'referenceBlocked', 'sameMaterial', 'currentCorrectedMediaError', 'bookmarkRecordingBlocked', 'releaseOriginalMedia', 'isKnownReference',
  'stopReviewTracking', 'refreshReviewTasks', 'verifyReviewMedia', 'saveReviewTask', 'reviewMediaError', 'loadReviewMaterial', 'startReviewTask', 'leaveFailedReviewStart',
  'changeReviewTask', 'observeReviewAttempt', 'flushReviewResults', 'restoreSavedReviewBinding', 'closePanel', 'submit', 'changeCue', 'reveal', 'changeHistoryRecording', 'startBuiltinPractice', 'cancelCourseSelection', 'loadBuiltinMaterial', 'loadDemo', 'beginNewRound', 'openPanel', 'openSubtitleWorkbench', 'togglePlay', 'toggleCorrectedPlay'];
const functions = names.map(name => {
  const node = studio.body.body.find((item: any) => item.type === 'FunctionDeclaration' && item.id.name === name);
  assert.ok(node, `Missing actual Studio function ${name}`); return source.slice(node.start, node.end);
}).join('\n');
const callbacks = new Map<string, string>(); let inputExpression: string | undefined, mediaExpression: string | undefined, courseErrorExpression: string | undefined;
function visit(node: any): void {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'VariableDeclarator' && ['visibility', 'pageHide', 'onPlay', 'onPause', 'onDuration', 'onTime'].includes(node.id?.name) && node.init?.type === 'ArrowFunctionExpression') callbacks.set(node.id.name, source.slice(node.init.start, node.init.end));
  if (node.type === 'JSXExpressionContainer' && source.slice(node.expression.start, node.expression.end).startsWith("panel==='media'")) mediaExpression = source.slice(node.expression.start, node.expression.end);
  if (node.type === 'JSXExpressionContainer' && source.slice(node.expression.start, node.expression.end).startsWith("courseError&&!builtinMediaReady")) courseErrorExpression = source.slice(node.expression.start, node.expression.end);
  if (node.type === 'JSXAttribute' && node.name?.name === 'onInput') inputExpression = source.slice(node.value.expression.start, node.value.expression.end);
  for (const [key, value] of Object.entries(node)) if (!['loc', 'tokens', 'comments'].includes(key)) {
    if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
  }
}
visit(studio); assert.equal(callbacks.size, 6); assert.ok(inputExpression); assert.ok(mediaExpression); assert.ok(courseErrorExpression);
const { code } = await swc.transform(`${functions}\n${[...callbacks].map(([name, body]) => `const ${name} = ${body};`).join('\n')}\nconst inputHandler = ${inputExpression};\nfunction renderMediaPanel(){return (${mediaExpression})}\nfunction renderCourseError(){return (${courseErrorExpression})}`, {
  jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2022' }, module: { type: 'commonjs' },
});
const install = new Function('scope', `with(scope){${code}\nreturn {${names.join(',')},${[...callbacks.keys()].join(',')},inputHandler,renderMediaPanel,renderCourseError};}`);
export const noop = () => {};
export const HOST_MEDIA_ORIGIN = 'https://lingotrace-training-demo.beyond-chenlin.chatgpt.site';
export const ref = <T,>(current: T) => ({ current });
export const tick = () => new Promise<void>(resolve => setImmediate(resolve));
export function gate() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
export async function until(predicate: () => boolean, label: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 1)); }
  assert.fail(`Did not reach ${label}`);
}
const media = { id: LOCAL_REFERENCE_MEDIA_ID, sha256: LOCAL_REFERENCE_MEDIA_SHA256, durationSeconds: 72 };
export const due = resolveReviewLocalTime('2026-10-12T10:00', 'UTC')[0], nextDue = resolveReviewLocalTime('2026-10-19T15:30', 'Asia/Shanghai')[0];
export const reveals = (s: TrainingSnapshot) => s.events.filter(e => e.type === 'hintExposed' && e.kind === 'reveal');
export const learning = (s: TrainingSnapshot) => ({ sessionId: s.sessionId, roundId: s.roundId, material: s.material, cueIndex: s.cueIndex,
  drafts: s.drafts, attempts: s.attempts, earnedWords: s.earnedWords, completedCueIds: s.completedCueIds, pendingAttempts: s.pendingAttempts });

// Browser-only boundary: metadata is asynchronous and src assignment initiates
// loading, as HTMLVideoElement does. Hash verification is the pool's contract;
// the actual preview controller and Studio fixed-version checks still execute.
class Video extends EventTarget {
  private value = ''; sources: string[] = []; durationForSource: ((source: string) => number) | null = null; currentSrc = ''; duration = 72; readyState = 1; currentTime = 0; paused = true; muted = true; volume = .8; autoplay = false; loop = false; preload = 'metadata'; playbackRate = 1;
  onerror: (() => void) | null = null; onloadedmetadata: (() => void) | null = null;
  metadataGate: ReturnType<typeof gate> | null = null; plays = 0; error: { code: number; message?: string } | null = null;
  get src() { return this.value; }
  set src(value: string) { this.error = null; this.value = value; this.sources.push(value); if (this.durationForSource) this.duration = this.durationForSource(value); this.load(); }
  load() { const value = this.value; this.currentSrc = value; if (value) void (this.metadataGate?.promise ?? Promise.resolve()).then(() => { if (this.value === value) { this.dispatchEvent(new Event('loadedmetadata')); this.onloadedmetadata?.(); } }); }
  fail() { this.error = { code: 3 }; this.dispatchEvent(new Event('error')); this.onerror?.(); }
  play() { this.plays++; this.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve(); }
  pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event('pause')); } }
  removeAttribute(name: string) { if (name === 'src') { this.value = ''; this.currentSrc = ''; } }
}

export async function setup(t: TestContext, options: { corrected?: boolean; courseSources?: boolean } = {}) {
  let serial = 0, acquired = 0, released = 0;
  const factory = new IDBFactory(), dbName = `studio-review-${crypto.randomUUID()}`;
  const repo = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  const library = new IndexedDBLocalReferenceRepository({ original: CAFE_MATERIAL, indexedDB: factory });
  const clock = { now: () => 0, wallTime: () => '2026-10-10T10:00:00.000Z', id: () => `studio-review-${++serial}` };
  let material = CAFE_MATERIAL;
  if (options.corrected) material = (await library.save(await buildLocalReferenceProposal({ original: CAFE_MATERIAL, parent: CAFE_MATERIAL,
    editedCueId: CAFE_MATERIAL.cues[1].id, text: 'Would you like hot coffee or iced coffee today?', start: 6.1, end: 11.9,
    media, saveRequestId: 'review-corrected-reference', createdAt: clock.wallTime() }))).entry.material;
  const engine = new TrainingEngine({ clock, inputObservation: { runId: 'host-review-input' } });
  const targetIndex = 3;
  engine.startReferenceSession(material, targetIndex); engine.input('source genuine wrong answer'); engine.submit(); engine.input('OLD_DRAFT_RETAINED');
  engine.setFrozen('modal', true); engine.setFrozen('idle', true);
  const history = new TrainingHistoryRecorder(repo, { clock, writerInstanceId: 'studio-review-writer' });
  const trace: string[] = [], notices: string[] = [], video = new Video();
  const controllers: ReturnType<typeof createContextBookmarkPreviewController>[] = [];
  const extraRepositories: IndexedDBTrainingRepository[] = [], extraHistories: TrainingHistoryRecorder[] = [], subscriptions: (() => void)[] = [];
  let npsLeaseOverride: Partial<OriginalCourseMediaLease> = {}, npsAcquired = 0, npsReleased = 0, npsDuration = NPS_COURSE_MEDIA.durationSeconds, npsGate: ReturnType<typeof gate> | null = null;
  let leaseOverride: Partial<OriginalCourseMediaLease> = {}, acquireGate: ReturnType<typeof gate> | null = null;
  const pool = { async acquire() {
    acquired++; trace.push('media.acquire'); if (acquireGate) await acquireGate.promise;
    let done = false;
    return { url: 'blob:review-verified-original', mediaId: media.id, mediaSha256: media.sha256, actualSha256: media.sha256,
      verified: true, verificationError: null, ...leaseOverride, release() { if (!done) { done = true; released++; trace.push('media.release'); } } };
  } };
  const npsPool = { async acquire() {
    npsAcquired++; trace.push('nps.acquire'); if (npsGate) await npsGate.promise; let done = false;
    return { url: 'blob:review-verified-nps', mediaId: NPS_COURSE_MEDIA.mediaId, mediaSha256: NPS_COURSE_MEDIA.mediaSha256, actualSha256: NPS_PLAYBACK_MEDIA.playbackVariant.mediaSha256, playbackVariant: NPS_PLAYBACK_MEDIA.playbackVariant,
      verified: true, verificationError: null, ...npsLeaseOverride, release() { if (!done) { done = true; npsReleased++; trace.push('nps.release'); } } };
  } };
  const auxiliary: Video[] = [];
  const prepareVideo = (v: Video) => { v.durationForSource = source => source === 'blob:review-verified-nps' ? npsDuration : options.courseSources ? 72 : v.duration; return v; };
  prepareVideo(video);
  const recorder = { getSnapshot: () => ({ state: 'idle' }), dispose: async () => {} };
  const ctx: any = { ...inactiveListeningTestScope(), getDraft,
    fixedPaceObserverRef:ref(new FixedPaceFinishObserver()),fixedPaceInputRef:ref(new TypingFollowInput()),fixedPaceScopeRef:ref(null),fixedPaceResult:null,
    setFixedPaceResult:(value:any)=>{ctx.fixedPaceResult=value},setPacingStrategy:(value:any)=>{ctx.pacingStrategy=value},setFixedRate:(value:number)=>{ctx.fixedRate=value},
    monitorPrefs:ref({volume:.8,courseMuted:false,allMuted:false}),audioRef:ref(null),locale:'zh-CN',localeRef:{current:'zh-CN'},t:translate.bind(null,'zh-CN'),ui:translateKnownUi.bind(null,'zh-CN'),
    qualifyingTypingFollowAppend, followRef:ref(null),followInputRef:ref(new TypingFollowInput()),followAutoSessionRef:ref(null),followAutoEntryRef:ref(null),followAutoEpochRef:ref(0),followAutoArmed:false,setFollowAutoArmed:(value:boolean)=>{ctx.followAutoArmed=value},
    require, exports: {}, Error, AbortController, Image: class { src = ''; }, NPS_MATERIAL, NPS_COURSE_MEDIA, NPS_PLAYBACK_MEDIA, isExactNativeAACError, isVerifiedCourseMediaLease: (lease:any, descriptor:any) => isVerifiedCourseMediaLease(lease,descriptor,HOST_MEDIA_ORIGIN), ORIGINAL_COURSE_MEDIA, builtinCourseForMaterial, isBuiltinMaterial, CAFE_MATERIAL, IndexedDBLocalReferenceRepository, canonicalLocalReferenceJSON, buildReviewTarget, reviewSame, reviewAttemptSource, exportSession,
    flushReferenceTransition, assertReferenceTransitionBoundary, LOCAL_REFERENCE_MEDIA_ID, LOCAL_REFERENCE_MEDIA_SHA256, isPracticePaused, hasScorableReference, correctedReferenceMediaError, fixedReviewDurationMatches, fixedReviewTargetMatches, reviewMediaDiagnostic,reviewDurationDiagnostic,reviewRangeDiagnostic,
    history, engineRef: ref(engine), historyRef: ref(history), repoRef: ref(repo), referenceRepositoryRef: ref(library), originalMediaPool: pool, npsMediaPool: npsPool,
    courseSwitchRef: ref(null), courseLoadRequest: ref(0), reviewTransitionRef: ref(false), reviewActionRef: ref(0), reviewListRequest: ref(0), reviewResultBusy: ref(false), reviewBindingRef: ref(null), reviewPendingRef: ref(new Map()),
    reviewVerifyRequestRef: ref(0), reviewVerificationRef: ref(null), reviewMediaRequestRef: ref(null), reviewMediaRef: ref(null), reviewStartFailureRef: ref(''), historyBindingPausedRef: ref(false), historyPageInactiveRef: ref(false),
    referenceTransitionRef: ref(false), referenceConfirmationRef: ref(null), referencePanelRef: ref(false), referenceActionRef: ref(0), referencePreviewRef: ref(null), referenceVerificationRef: ref(null),
    correctedMediaRef: ref(null), correctedPlayRequest: ref(0), correctedPlayOwner: ref(null), originalMediaLease: ref(null), originalMediaRequest: ref(null),
    lesson: video, lessonRef: ref(video), recorder, recorderRef: ref(recorder), recordInputRef: ref(null), activeRecordInputRef: ref(null), recordPreparing: ref(false), disposed: ref(false), life: ref(1), restoreFailedRef: ref(false),
    pressedKeysRef: ref(new Map()), committedUntilRef: ref(0), compositionEnterRef: ref(-Infinity), enterIntentRef: ref({at:-Infinity,shift:false,handled:false}), composing: ref(false), pasting: ref(false), interruptedCompositionRef: ref(false), compositionTailRef: ref(new CompositionInputTail()), fixture: false, replaySnapshot: ref(null),
    visualRef: ref({ ready: true, fixture: false }), mediaRef: ref({ kind: 'demo', name: '' }), mediaKind: 'demo', localURL: ref(null), mediaToken: ref(0), pendingSeek: ref(null),
    mediaInteractedRef: ref(false), standbyPausedRef: ref(false), sceneMotionRef: ref({}), restoredSessionRef: ref(null), pageInputGateRef: ref({ begin: () => trace.push('input.begin') }),
    document: { hidden: false, activeElement: null, createElement: (name: string) => { assert.equal(name, 'video'); const v = prepareVideo(new Video()); auxiliary.push(v); return v; } }, performance: { now: () => 0 },
    videoPalette: { sourceChanged: noop }, panel: 'review-tasks', showSubtitle: false, reviewBusy: false, reviewStartFailure: '', reviewTrackingMessage: '',
    courseRoutingRef: ref(null), prepareCourseRouting: async()=>{}, newRoundBusy: false, referenceBusy: false, courseChoice: null, courseError: '', builtinMediaReady: false, mediaName: '', restoreFailed: false, activeRecord: false, startingRecord: false,
    setReferenceBusy: (value: boolean) => { ctx.referenceBusy = value; }, setCourseChoice: (value: any) => { ctx.courseChoice = value; }, setCourseError: (value: string) => { ctx.courseError = value; },
    setNewRoundBusy: (value: boolean) => { ctx.newRoundBusy = value; }, setRestoreFailed: (value: boolean) => { ctx.restoreFailed = value; },
    setPanel: (value: any) => { ctx.panel = value; trace.push(`panel:${value}`); },
    setReviewBusy: (value: boolean) => { ctx.reviewBusy = value; }, setReviewStartFailure: (value: string) => { ctx.reviewStartFailure = value; ctx.reviewStartFailureRef.current = value; },
    setReviewTrackingMessage: (value: string) => { ctx.reviewTrackingMessage = value; }, setReviewPendingCount: (value: number) => { ctx.reviewPendingCount = value; },
    setReviewTasks: (value: any) => { ctx.reviewTasks = value; }, setReviewRows: (value: any) => { ctx.reviewRows = value; }, setReviewUnreadable: (value: number) => { ctx.reviewUnreadable = value; },
    setReviewLoading: noop, setReviewError: (value: string) => { ctx.reviewError = value; }, setMediaDuration: (value: number) => { ctx.mediaDuration = value; },
    setBuiltinMediaReady: (value: boolean) => { ctx.builtinMediaReady = value; }, setMediaKind: (value: string) => { ctx.mediaKind = value; }, setMediaName: (value: string) => { ctx.mediaName = value; }, setBookmarkMediaReady: (value: boolean) => { ctx.bookmarkMediaReady = value; },
    setShowSubtitle: (value: boolean) => { ctx.showSubtitle = value; }, setPaused: noop, setTemporaryHistory: (value: boolean) => { ctx.temporary = value; },
    seekTo: (value: number) => { video.currentTime = value; return true; }, syncDraft: () => { ctx.inputRef.current.value = ctx.engineRef.current.draft; }, syncFeedback: noop,
    queueSave: () => { if (!ctx.historyBindingPausedRef.current) ctx.historyRef.current.observe(ctx.engineRef.current.getSnapshot()); },
    inputRef: ref({ value: engine.draft, focus: noop }), submissionSound: { audio: ref({ getSnapshot:()=>({enabled:false}), cancel: noop, play: noop }) }, setResult: (value: any) => { ctx.result = value; }, notify: (value: string) => notices.push(value),
    layoutTransactionsRef: ref({ active: false }), cancelLayoutPreview: noop, setMutedRecord: noop, clearRecordingPreview: noop, setToolsOpen: noop, cancelRecordingPreparation: noop,
    setReferenceConfirmation: noop, previewURL: ref(null), setPreview: noop, setPreviewInfo: noop, INITIAL_PREVIEW_INFO: {}, setDeleteId: noop, setResetPrompt: noop,
    requestAnimationFrame: (callback: () => void) => callback(), lastFocus: ref(null), exportRef: ref(null), setReviewSnapshot: noop, setRecordings: noop, startLayoutPreview: () => true, URL: { revokeObjectURL: noop },
    historyActionRef: ref(0), historyChannelRef: ref(null), saveTimer: ref(null), soundRequestRef: ref(0), standbyAudioRef: ref(null), setSoundEnabled: noop,
    recordRequestToken: ref(0), setStartingRecord: noop, cameraToken: ref(0), cameraStreamRef: ref(null), releaseMix: noop, exitHistorySave: null,
  };
  ctx.createContextBookmarkPreviewController = (deps: any) => {
    const controller = createContextBookmarkPreviewController({ ...deps, origin:HOST_MEDIA_ORIGIN, lifecycle: { isHidden: () => ctx.document.hidden }, metadataTimeoutMs: 1000 });
    controllers.push(controller); return controller;
  };
  Object.assign(ctx, install(ctx));
  video.addEventListener('play', ctx.onPlay); video.addEventListener('pause', ctx.onPause); video.addEventListener('durationchange', ctx.onDuration);
  subscriptions.push(engine.subscribe(ctx.queueSave));
  history.connect(engine.getSnapshot(), await repo.readAutomaticHistoryControl()); await history.flush();
  const flush = history.flush.bind(history); history.flush = async () => { trace.push('history.flush.begin'); await flush(); trace.push('history.flush.end'); };
  const start = engine.startReferenceSession.bind(engine); engine.startReferenceSession = (...args) => { trace.push('engine.start'); return start(...args); };
  const bind = repo.bindReviewSession.bind(repo); repo.bindReviewSession = async (...args) => { trace.push('binding.begin'); const result = await bind(...args); trace.push('binding.end'); return result; };
  const admit = repo.beginTrainingHistorySegment.bind(repo); repo.beginTrainingHistorySegment = async (...args) => { trace.push('permit.begin'); const result = await admit(...args); trace.push('permit.end'); return result; };
  const commit = repo.commitReviewResult.bind(repo); repo.commitReviewResult = async (...args) => { trace.push('relation.begin'); const result = await commit(...args); trace.push(`relation.${result.disposition}`); return result; };
  t.after(async () => {
    ctx.disposed.current = true; ctx.life.current++; ctx.stopReviewTracking(); ctx.releaseOriginalMedia();
    subscriptions.forEach(unsubscribe => unsubscribe()); controllers.forEach(controller => controller.dispose());
    history.dispose(); extraHistories.forEach(h => h.dispose()); await library.close(); await repo.close(); for (const r of extraRepositories) await r.close();
  });
  const saved = await ctx.saveReviewTask(material.cues[targetIndex].id, due, 'host-save-review'); assert.equal(saved.disposition, 'saved');
  const task = (await repo.listReviewTasks()).entries[0];
  const row = { taskId: task.taskId, revision: task.revision };
  trace.length = 0;
  return { engine, history, repo, library, ctx, video, trace, notices, task, row, targetIndex, factory, dbName, controllers, auxiliary,
    get npsAcquired() { return npsAcquired; }, get npsReleased() { return npsReleased; },
    setNpsDuration: (value: number) => { npsDuration = value; },
    setNpsAcquireGate: (value: ReturnType<typeof gate> | null) => { npsGate = value; }, setNpsLease: (value: Partial<OriginalCourseMediaLease>) => { npsLeaseOverride = value; },
    get acquired() { return acquired; }, get released() { return released; }, setLease: (value: Partial<OriginalCourseMediaLease>) => { leaseOverride = value; }, setAcquireGate: (value: ReturnType<typeof gate> | null) => { acquireGate = value; },
    async start() { await ctx.startReviewTask(row, nextDue); },
    async settle() { await until(() => !ctx.reviewResultBusy.current, 'review result flush'); },
    input(text: string) { ctx.inputRef.current.value = text; ctx.inputHandler({ currentTarget: ctx.inputRef.current, nativeEvent: { inputType: 'insertText', data: text } }); },
    async restore() {
      await history.flush(); const snapshot = (await repo.loadHistorySession(engine.getSnapshot().sessionId))!.snapshot;
      const restoredRepo = new IndexedDBTrainingRepository({ indexedDB: factory, dbName }); extraRepositories.push(restoredRepo);
      const restored = new TrainingEngine({ snapshot, restoredReadOnly: true, clock, inputObservation: { runId: 'host-review-refresh' } }); const restoredHistory = new TrainingHistoryRecorder(restoredRepo, { clock }); extraHistories.push(restoredHistory);
      restoredHistory.connectRestoredBaseline(restored.getSnapshot(), await restoredRepo.readAutomaticHistoryControl(), snapshot);
      ctx.stopReviewTracking(); ctx.repoRef.current = restoredRepo; ctx.history = restoredHistory; ctx.historyRef.current = restoredHistory; ctx.engineRef.current = restored;
      subscriptions.push(restored.subscribe(ctx.queueSave));
      return { engine: restored, history: restoredHistory, repo: restoredRepo, snapshot: restored.getSnapshot() };
    },
  };
}

