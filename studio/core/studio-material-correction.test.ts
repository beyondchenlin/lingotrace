import {translate,translateKnownUi} from '../i18n/locale';
import { inactiveListeningTestScope } from './inactive-listening-test-fixture.mjs';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { IDBFactory } from 'fake-indexeddb';
import { TrainingEngine, CAFE_MATERIAL, hasScorableReference, type Material, type TrainingSnapshot } from './training';
import { IndexedDBTrainingRepository, readTrainingHistorySegment } from './repository';
import { TrainingHistoryRecorder } from './training-history-recorder';
import { NPS_MATERIAL, NPS_COURSE_MEDIA, builtinCourseForMaterial, isBuiltinMaterial } from './builtin-material';
import { IndexedDBLocalReferenceRepository, LOCAL_REFERENCE_DATABASE_NAME, LOCAL_REFERENCE_STORE_NAME } from './local-reference-repository';
import { buildLocalReferenceStructureProposal, buildLocalReferenceProposal, canonicalLocalReferenceJSON, LOCAL_REFERENCE_MEDIA_ID, LOCAL_REFERENCE_MEDIA_SHA256 } from './local-reference';
import { flushReferenceTransition, assertReferenceTransitionBoundary } from './reference-transition';
import { exportStudioSession as exportSession } from './session-export';
import { CompositionInputTail } from './native-input-evidence';
import { isPracticePaused } from './practice-pause';
import { correctedReferenceMediaError } from '../media/corrected-reference-media';
import { createContextBookmarkPreviewController, type OriginalCourseMediaLease } from '../media/context-bookmark-media';
import {fixedReviewDurationMatches,fixedReviewTargetMatches,reviewMediaDiagnostic,reviewDurationDiagnostic,reviewRangeDiagnostic} from '../media/fixed-review-media';

const require = createRequire(import.meta.url), parser = require('next/dist/compiled/babel/parser'), swc = require('next/dist/build/swc');
await swc.loadBindings();
const source = await readFile(new URL('../components/Studio.tsx', import.meta.url), 'utf8');
const ast = parser.parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
const studio = ast.program.body.find((node: any) => node.type === 'FunctionDeclaration' && node.id?.name === 'StudioContent');
assert.ok(studio, 'Locate the actual Studio component by its TypeScript AST');
const names = ['interruptPracticeRecording','showCommittedInput','builtinAnswerBlocked', 'coursePool', 'strictCourse', 'prepareCoursePoster', 'referenceRepository', 'referenceBlocked', 'sameMaterial', 'currentCorrectedMediaError', 'bookmarkRecordingBlocked', 'releaseOriginalMedia',
  'loadDemo', 'refreshReferenceLibrary', 'isKnownReference', 'openReferenceLibrary', 'saveEditedReference', 'verifySelectedReferenceMedia',
  'showReferenceConfirmation', 'continueReferencePractice', 'startSavedReference', 'loadCorrectedMaterial', 'openPanel', 'closePanel', 'submit', 'changeCue', 'toggleCorrectedPlay', 'togglePlay'];
const functions = names.map(name => {
  const node = studio.body.body.find((item: any) => item.type === 'FunctionDeclaration' && item.id.name === name);
  assert.ok(node, `Missing actual Studio function ${name}`); return source.slice(node.start, node.end);
}).join('\n');
let confirmationExpression: string | undefined, inputExpression: string | undefined;
const callbacks = new Map<string, string>();
function visit(node: any): void {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'VariableDeclarator' && ['visibility', 'onPlay', 'onPause', 'onDuration'].includes(node.id?.name) && node.init?.type === 'ArrowFunctionExpression') callbacks.set(node.id.name, source.slice(node.init.start, node.init.end));
  if (node.type === 'JSXAttribute' && node.name?.name === 'onInput') inputExpression = source.slice(node.value.expression.start, node.value.expression.end);
  if (node.type === 'JSXExpressionContainer' && source.slice(node.expression.start, node.expression.end).startsWith("panel==='reference-confirm'")) confirmationExpression = source.slice(node.expression.start, node.expression.end);
  for (const [key, value] of Object.entries(node)) if (!['loc', 'tokens', 'comments'].includes(key)) {
    if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
  }
}
visit(studio); assert.ok(confirmationExpression, 'Locate the real confirmation JSX, not a replacement renderer');
const hostCallbacks = [...callbacks].map(([name, text]) => `const ${name} = ${text};`).join('\n');
assert.equal(callbacks.size, 4); assert.ok(inputExpression);
const { code } = await swc.transform(`${functions}\n${hostCallbacks}\nconst inputHandler = ${inputExpression};\nfunction renderConfirmation(){return (${confirmationExpression})}`, {
  jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2022' }, module: { type: 'commonjs' },
});
// Same-realm evaluation is deliberate: production canonical validation rejects
// foreign Object prototypes. Only browser/React host primitives are substituted;
// every extracted Studio function, engine, recorder and IDB adapter below is real.
const install = new Function('scope', `with(scope){${code}\nreturn {${names.join(',')},${[...callbacks.keys()].join(',')},inputHandler,renderConfirmation};}`);
const noop = () => {};
const ref = <T,>(current: T) => ({ current });
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function gate() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
// Real WebCrypto and IndexedDB scheduling can outlive 100 immediate turns under the full parallel suite.
async function until(predicate: () => boolean, label: string) { const deadline=Date.now()+5000; while(Date.now()<deadline) { if (predicate()) return; await new Promise(resolve=>setTimeout(resolve,1)); } assert.fail(`Did not reach ${label}`); }
const media = { id: LOCAL_REFERENCE_MEDIA_ID, sha256: LOCAL_REFERENCE_MEDIA_SHA256, durationSeconds: 72 };
const edited = { text: 'Would you prefer this coffee hot or iced today?', start: 6.15, end: 11.85, verifiedDurationSeconds: 72, saveRequestId: 'studio-correction-save' };
const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
const revealEvents = (snapshot: TrainingSnapshot) => snapshot.events.filter(event => event.type === 'hintExposed' && event.kind === 'reveal');
const learning = (snapshot: TrainingSnapshot) => Object.fromEntries(['sessionId', 'roundId', 'material', 'cueIndex', 'drafts', 'attempts', 'earnedWords', 'confirmedPositions', 'completedCueIds', 'pendingAttempts'].map(key => [key, snapshot[key as keyof TrainingSnapshot]]));

class Video extends EventTarget {
  src = ''; currentSrc = ''; duration = 72; readyState = 1; currentTime = 0; paused = true; muted = true; volume = .8; autoplay = false; loop = false; preload = 'metadata'; playbackRate = 1;
  onerror: (() => void) | null = null; onloadedmetadata: (() => void) | null = null;
  plays = 0; pauses = 0; loads = 0; metadataGate: ReturnType<typeof gate> | null = null;
  load() { this.loads++; this.currentSrc = this.src; if (this.src) { const src = this.src; void (this.metadataGate?.promise ?? Promise.resolve()).then(() => { if (this.src === src) this.metadata(); }); } }
  metadata() { this.currentSrc = this.src; this.dispatchEvent(new Event('loadedmetadata')); this.onloadedmetadata?.(); }
  play() { this.plays++; this.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve(); }
  pause() { this.pauses++; this.paused = true; }
  removeAttribute(name: string) { if (name === 'src') { this.src = ''; this.currentSrc = ''; } }
}

type Mode = 'legacy' | 'segment' | 'off' | 'awaiting';
async function setup(t: TestContext, mode: Mode = 'legacy') {
  let serial = 0;
  const factory = new IDBFactory(), dbName = `studio-reference-${crypto.randomUUID()}`;
  const repo = new IndexedDBTrainingRepository({ indexedDB: factory, dbName });
  const library = new IndexedDBLocalReferenceRepository({ original: CAFE_MATERIAL, indexedDB: factory, digest });
  const clock = { now: () => 0, wallTime: () => '2026-10-10T08:00:00.000Z', id: () => `host-event-${++serial}` };
  const engine = new TrainingEngine({ clock });
  engine.nextCue(1); engine.input('old incorrect answer'); engine.submit(); engine.input('OLD_DRAFT_RETAINED');
  const history = new TrainingHistoryRecorder(repo, { clock, writerInstanceId: 'studio-reference-writer' });
  const trace: string[] = [], notices: string[] = [], views: { html: string; sequence: number; reveals: number; mode: string }[] = [];
  const video = new Video(), auxiliaryVideos: Video[] = [], controllers: ReturnType<typeof createContextBookmarkPreviewController>[] = [];
  let acquisitions = 0, releases = 0, queued = 0;
  let acquireGate: ReturnType<typeof gate> | null = null;
  let leaseOverride: Partial<OriginalCourseMediaLease> = {};
  const pool = { async acquire() {
    acquisitions++; trace.push('media.acquire'); if (acquireGate) await acquireGate.promise;
    let released = false;
    return { url: 'blob:host-verified', mediaId: media.id, mediaSha256: media.sha256, actualSha256: media.sha256, verified: true, verificationError: null, ...leaseOverride,
      release() { if (!released) { released = true; releases++; trace.push('media.release'); } } };
  } };
  const ctx: any = { ...inactiveListeningTestScope(),locale:'zh-CN',localeRef:{current:'zh-CN'},t:translate.bind(null,'zh-CN'),ui:translateKnownUi.bind(null,'zh-CN'), courseLoadRequest: ref(0), reviewMediaRequestRef: ref(null), reviewVerificationRef:ref(null),reviewTransitionRef:ref(false),reviewStartFailureRef:ref(null),reviewMediaRef:ref(null),reviewBindingRef:ref(null),observeReviewAttempt:noop,stopReviewTracking:noop,require, exports: {}, Error, AbortController, Image: class { src = ''; }, NPS_MATERIAL, NPS_COURSE_MEDIA, builtinCourseForMaterial, isBuiltinMaterial, CAFE_MATERIAL, canonicalLocalReferenceJSON, buildLocalReferenceStructureProposal, buildLocalReferenceProposal, flushReferenceTransition, assertReferenceTransitionBoundary,
    correctedReferenceMediaError, fixedReviewDurationMatches, fixedReviewTargetMatches, reviewMediaDiagnostic,reviewDurationDiagnostic,reviewRangeDiagnostic, IndexedDBLocalReferenceRepository, exportSession, isPracticePaused, hasScorableReference,
    lesson: video, history, engineRef: ref(engine), historyRef: ref(history), repoRef: ref(repo), referenceRepositoryRef: ref(library), referencePreviewRef: ref(null), referenceVerificationRef: ref(null),
    referenceTransitionRef: ref(false), referenceActionRef: ref(0), referencePanelRef: ref(false), referenceTargetRef: ref(null), referenceConfirmationRef: ref(null),
    historyBindingPausedRef: ref(false), correctedMediaRef: ref(null), correctedPlayRequest: ref(0), correctedPlayOwner: ref(0), originalMediaRequest: ref(null), originalMediaLease: ref(null),
    restoreFailedRef: ref(false), disposed: ref(false), life: ref(1), recordInputRef: ref(null), activeRecordInputRef: ref(null), recordPreparing: ref(false), recorderRef: ref({ getSnapshot: () => ({ state: 'idle' }) }), committedUntilRef:ref(0),composing: ref(false), pasting: ref(false), interruptedCompositionRef: ref(false), compositionTailRef: ref(new CompositionInputTail()), syncFeedback: noop, courseRoutingRef: ref(null), prepareCourseRouting: async () => {},
    fixture: false, replaySnapshot: ref(null), visualRef: ref({ ready: false }), mediaRef: ref({ kind: 'demo', name: '' }), lessonRef: ref(video), mediaToken: ref(0), localURL: ref(null), pendingSeek: ref(null),
    originalMediaPool: pool, mediaKind: 'demo', document: { hidden: false, activeElement: { focus: noop }, createElement: (name: string) => { assert.equal(name, 'video'); const v = new Video(); auxiliaryVideos.push(v); return v; } },
    videoPalette: { sourceChanged: noop }, notify: (text: string) => notices.push(text), performance: { now: () => 0 },
    panel: null, referenceConfirmation: null, referenceTarget: null, referenceEntries: [], referenceError: '', referenceUnreadable: 0, referenceBusy: false,
    setReferenceTarget: (value: any) => { ctx.referenceTarget = value; }, setReferenceEntries: (value: any) => { ctx.referenceEntries = value; },
    setReferenceError: (value: any) => { ctx.referenceError = value; }, setReferenceUnreadable: (value: any) => { ctx.referenceUnreadable = value; },
    setReferenceBusy: (value: any) => { ctx.referenceBusy = value; },
    setReferenceConfirmation: (value: any) => { ctx.referenceConfirmation = value; trace.push(value?.exposed ? 'confirmation.exposed' : 'confirmation.hidden'); captureView(); },
    setPanel: (value: any) => { ctx.panel = value; captureView(); },
    setMediaDuration: (value: number) => { ctx.mediaDuration = value; }, setMediaKind: (value: string) => { ctx.mediaKind = value; }, setCourseError: noop, setMediaName: noop,
    setBuiltinMediaReady: noop, setBookmarkMediaReady: (value: boolean) => { ctx.bookmarkMediaReady = value; }, setShowSubtitle: noop,
    seekTo: (value: number) => { video.currentTime = value; return true; }, syncDraft: noop, setPaused: noop,
    restoredSessionRef: ref(null), pageInputGateRef: ref({ begin: () => trace.push('input.begin') }), setTemporaryHistory: (value: boolean) => { ctx.temporary = value; },
    mediaInteractedRef: ref(false), standbyPausedRef: ref(false), sceneMotionRef: ref({}), queueSave: () => { queued++; },
    inputRef: ref({ focus: noop }), submissionSound: { audio: ref({ cancel: noop, play: noop }) }, setResult: (value: any) => { ctx.result = value; },
    layoutTransactionsRef: ref({ active: false }), startLayoutPreview: () => true, cancelLayoutPreview: noop, setMutedRecord: noop, clearRecordingPreview: noop, cancelRecordingPreparation: noop,
    lastFocus: ref(null), setReviewSnapshot: noop, exportRef: ref(null), setRecordings: noop, setToolsOpen: noop, previewURL: ref(null), setPreview: noop, setPreviewInfo: noop,
    setDeleteId: noop, setResetPrompt: noop, requestAnimationFrame: (callback: () => void) => callback(), URL: { revokeObjectURL: noop }, INITIAL_PREVIEW_INFO: {},
  };
  ctx.createContextBookmarkPreviewController = (deps: any) => {
    const controller = createContextBookmarkPreviewController({ ...deps, lifecycle: { isHidden: () => ctx.document.hidden }, metadataTimeoutMs: 1000 });
    controllers.push(controller); return controller;
  };
  Object.assign(ctx, install(ctx));
  video.addEventListener('play', ctx.onPlay); video.addEventListener('pause', ctx.onPause); video.addEventListener('durationchange', ctx.onDuration);
  function captureView() { views.push({ html: renderToStaticMarkup(ctx.renderConfirmation()), sequence: engine.getSnapshot().sequence, reveals: revealEvents(engine.getSnapshot()).length, mode: history.getSnapshot().mode }); }
  const unsubscribe = engine.subscribe(() => {
    if (!ctx.historyBindingPausedRef.current) history.observe(engine.getSnapshot());
    const event = engine.getSnapshot().events.at(-1); if (event?.type === 'hintExposed') trace.push(`reveal:${event.cueId}`);
  });
  history.connect(engine.getSnapshot(), await repo.readAutomaticHistoryControl()); await history.flush();
  if (mode !== 'legacy') await history.turnOff();
  if (mode === 'segment') await history.turnOn();
  if (mode === 'awaiting') { const control = await repo.enableAutomaticHistory(history.getSnapshot().control!.generation); history.connect(engine.getSnapshot(), control); }
  const flush = history.flush.bind(history); history.flush = async () => { trace.push('history.flush.begin'); await flush(); trace.push('history.flush.end'); };
  const start = engine.startReferenceSession.bind(engine); engine.startReferenceSession = (...args) => { trace.push('engine.start'); return start(...args); };
  const admit = repo.beginTrainingHistorySegment.bind(repo); repo.beginTrainingHistorySegment = async (...args) => { trace.push('permit.begin'); const result = await admit(...args); trace.push('permit.end'); return result; };
  t.after(async () => { ctx.disposed.current = true; ctx.life.current++; unsubscribe(); history.dispose(); controllers.forEach(controller => controller.dispose()); ctx.releaseOriginalMedia(); await library.close(); await repo.close(); });
  return { engine, history, repo, library, ctx, trace, notices, views, video, auxiliaryVideos, controllers, factory, dbName,
    get acquisitions() { return acquisitions; }, get releases() { return releases; }, get queued() { return queued; },
    setAcquireGate: (value: ReturnType<typeof gate> | null) => { acquireGate = value; }, setLease: (value: Partial<OriginalCourseMediaLease>) => { leaseOverride = value; },
    async saved(name = 'selected-reference') { return (await library.save(await buildLocalReferenceProposal({ original: CAFE_MATERIAL, parent: CAFE_MATERIAL, editedCueId: CAFE_MATERIAL.cues[1].id,
      text: edited.text, start: edited.start, end: edited.end, media, saveRequestId: name, createdAt: clock.wallTime() }, digest))).entry; },
    async prepareEdit(input=edited) {
      await ctx.openReferenceLibrary(true);
      const previewVideo = new Video(), controller = ctx.createContextBookmarkPreviewController({ video: previewVideo, pool, validateReference: () => null });
      ctx.referencePreviewRef.current = controller;
      controller.select({ materialId: engine.getSnapshot().material.id, materialVersion: engine.getSnapshot().material.version, cueId: engine.cue.id,
        text: input.text, startSeconds: input.start, endSeconds: input.end, mediaId: media.id, mediaSha256: media.sha256 });
      await controller.load(); assert.equal(controller.getState().phase, 'ready'); return controller;
    },
    async segments() {
      const list = await repo.listTrainingHistorySegments();
      return Promise.all(list.entries.map(async entry => (await repo.loadTrainingHistorySegment(entry.segmentId))!));
    },
  };
}

test('actual editor reveal and cancel retain the draft, old result and old attempt conditions', async t => {
  const f = await setup(t), before = f.engine.getSnapshot(), originalAttempt = copy(before.attempts[0]);
  await f.ctx.openReferenceLibrary(false); assert.equal(revealEvents(f.engine.getSnapshot()).length, 0); assert.equal(f.ctx.referenceTarget, null);
  await f.ctx.openReferenceLibrary(true); assert.equal(revealEvents(f.engine.getSnapshot()).length, 1); assert.equal(f.ctx.referenceTarget.cueId, before.material.cues[1].id);
  assert.deepEqual({ ...learning(f.engine.getSnapshot()), drafts: undefined }, { ...learning(before), drafts: undefined }); assert.equal(f.engine.draft, 'OLD_DRAFT_RETAINED'); f.ctx.closePanel(false);
  assert.equal(f.engine.draft, 'OLD_DRAFT_RETAINED'); assert.deepEqual(f.engine.getSnapshot().attempts[0], originalAttempt);
  f.ctx.submit(); const next = f.engine.getSnapshot().attempts.at(-1)!;
  assert.equal(next.conditions.revealed, true); assert.deepEqual(f.engine.getSnapshot().attempts[0], originalAttempt); assert.equal(revealEvents(f.engine.getSnapshot()).length, 1);
});

test('actual save is an immutable, idempotent library write and never starts or regrades a round', async t => {
  const f = await setup(t); await f.prepareEdit(); await f.history.flush();
  const before = f.engine.getSnapshot(), old = await f.repo.loadHistorySession(before.sessionId);
  const [left, right] = await Promise.all([f.ctx.saveEditedReference(edited), f.ctx.saveEditedReference(edited)]);
  assert.equal(left.entry.material.version, right.entry.material.version); assert.equal((await f.library.list()).entries.length, 1);
  assert.deepEqual(f.engine.getSnapshot(), before); assert.deepEqual(await f.repo.loadHistorySession(before.sessionId), old);
  assert.equal(f.trace.includes('engine.start'), false); assert.equal(left.entry.material.cues[1].text, edited.text); assert.notEqual(left.entry.material.version, before.material.version);
  assert.ok(Object.isFrozen(left.entry.material.cues[1]));
  const reloaded = new IndexedDBLocalReferenceRepository({ original: CAFE_MATERIAL, indexedDB: f.factory, digest });
  assert.deepEqual((await reloaded.load(left.entry.material.id, left.entry.material.version))!.material, left.entry.material); await reloaded.close();
});

test('actual non-first-cue start flushes the old round before reset; actual submit uses the new reference without changing old history or exports', async t => {
  const f = await setup(t), selected = await f.saved(); await f.ctx.openReferenceLibrary(false);
  const old = f.engine.getSnapshot(), oldExport = exportSession(old, '2026-10-10T08:15:00.000Z');
  await f.ctx.startSavedReference(selected); await tick();
  const fresh = f.engine.getSnapshot(); assert.notEqual(fresh.sessionId, old.sessionId); assert.equal(fresh.cueIndex, 1); assert.equal(fresh.material.version, selected.material.version);
  assert.ok(f.trace.indexOf('history.flush.end') < f.trace.indexOf('engine.start')); assert.ok(f.trace.indexOf('engine.start') < f.trace.indexOf(`reveal:${fresh.material.cues[1].id}`));
  assert.equal(fresh.attempts.length, 0); assert.equal(revealEvents(fresh).length, 1); assert.equal(revealEvents(fresh)[0].cueId, fresh.material.cues[1].id);
  assert.equal((revealEvents(fresh)[0] as any).referenceExposure.surface, 'corrected-version-confirmation');
  for (const view of f.views.filter(view => view.html.includes(edited.text))) assert.equal(view.reveals, 1, 'Actual JSX cannot show text before the actual reveal event');
  f.ctx.showReferenceConfirmation(); assert.equal(revealEvents(f.engine.getSnapshot()).length, 1);
  f.ctx.continueReferencePractice(); assert.equal(renderToStaticMarkup(f.ctx.renderConfirmation()), '');
  f.engine.input(edited.text); f.ctx.submit(); const attempt = f.engine.getSnapshot().attempts[0];
  assert.equal(attempt.errors, 0); assert.equal(attempt.reference, edited.text); assert.equal(attempt.materialVersion, selected.material.version); assert.equal(attempt.conditions.revealed, true); await f.history.flush();
  const storedOld = (await f.repo.loadHistorySession(old.sessionId))!.snapshot;
  assert.deepEqual(storedOld, old); assert.deepEqual(exportSession(storedOld, '2026-10-10T08:15:00.000Z'), oldExport);
  assert.equal((await f.repo.loadLatest())!.material.version, selected.material.version);
});

for (const mode of ['segment', 'off', 'awaiting'] as const) test(`actual ${mode} new-version transition preserves permission and does not backfill old exposure`, async t => {
  const f = await setup(t, mode), selected = await f.saved(); await f.ctx.openReferenceLibrary(true);
  const oldSession = f.engine.getSnapshot().sessionId, control = await f.repo.readAutomaticHistoryControl(); await f.ctx.startSavedReference(selected); await f.history.flush();
  assert.deepEqual(await f.repo.readAutomaticHistoryControl(), control); assert.equal(revealEvents(f.engine.getSnapshot()).length, 1);
  if (mode === 'segment') {
    assert.equal(f.history.getSnapshot().mode, 'segment'); assert.ok(f.trace.indexOf('permit.end') < f.trace.lastIndexOf(`reveal:${f.engine.cue.id}`));
    const segments = await f.segments(), fresh = segments.find(segment => segment.sessionId !== oldSession)!;
    assert.ok(fresh); const reveals = fresh.facts.filter(fact => fact.type === 'hintExposed'); assert.equal(reveals.length, 1); assert.equal(reveals[0].cueId, f.engine.cue.id);
    assert.equal(Object.hasOwn(reveals[0], 'referenceExposure'), false); assert.equal(Object.hasOwn(fresh.material, 'cues'), false);
    assert.deepEqual(readTrainingHistorySegment(copy(fresh)), fresh);
    for (const view of f.views.filter(view => view.html.includes(edited.text))) assert.equal(view.mode, 'segment');
  } else {
    assert.equal(f.history.getSnapshot().mode, mode === 'off' ? 'off' : 'awaiting-segment'); assert.equal(f.trace.includes('permit.begin'), false); assert.equal((await f.segments()).length, 0);
    f.ctx.continueReferencePractice(); await f.history.turnOn(); await f.history.flush();
    const fresh = (await f.segments())[0]; assert.equal(fresh.facts.some(fact => fact.type === 'hintExposed'), false, 'Later ON cannot backfill the prior real OFF/awaiting confirmation');
  }
});

test('actual new segment confirmation waits for the genuine permit, and duplicate start cannot create another session', async t => {
  const f = await setup(t, 'segment'), selected = await f.saved(); await f.ctx.openReferenceLibrary(false);
  const held = gate(), admission = f.repo.beginTrainingHistorySegment.bind(f.repo); let admitting = false;
  f.repo.beginTrainingHistorySegment = async (...args) => { admitting = true; await held.promise; return admission(...args); };
  const start = f.ctx.startSavedReference(selected); await until(() => admitting, 'new-round permit request');
  const session = f.engine.getSnapshot().sessionId; assert.equal(f.history.getSnapshot().mode, 'enabling'); assert.equal(revealEvents(f.engine.getSnapshot()).length, 0);
  assert.equal(renderToStaticMarkup(f.ctx.renderConfirmation()).includes(edited.text), false); assert.equal(f.ctx.referenceConfirmationRef.current, null);
  await assert.rejects(f.ctx.startSavedReference(selected), /当前状态/); f.ctx.submit(); f.ctx.changeCue(0); assert.equal(f.engine.cue.id, selected.change.cueId);
  held.resolve(); await start; assert.equal(f.engine.getSnapshot().sessionId, session); assert.equal(revealEvents(f.engine.getSnapshot()).length, 1); assert.equal(f.trace.filter(value => value === 'engine.start').length, 1);
});

test('actual failed permit allows only a clearly temporary real reveal, never an assertion of saved history or an OFF backfill', async t => {
  const f = await setup(t, 'segment'), selected = await f.saved(); await f.ctx.openReferenceLibrary(false);
  const admission = f.repo.beginTrainingHistorySegment.bind(f.repo); f.repo.beginTrainingHistorySegment = async () => { throw Error('Quota at new permit'); };
  await f.ctx.startSavedReference(selected); assert.equal(f.history.getSnapshot().mode, 'off'); assert.equal(revealEvents(f.engine.getSnapshot()).length, 1);
  assert.match(f.ctx.referenceConfirmation.message, /临时/); assert.doesNotMatch(f.ctx.referenceConfirmation.message, /随完整|本片段只记录/); assert.match(f.notices.at(-1)!, /未能开启/);
  f.ctx.continueReferencePractice(); f.repo.beginTrainingHistorySegment = admission; await f.history.turnOn(); await f.history.flush();
  const fresh = (await f.segments()).find(segment => segment.sessionId === f.engine.getSnapshot().sessionId)!; assert.equal(fresh.facts.some(fact => fact.type === 'hintExposed'), false);
});

test('actual start refuses a pending ON admission while retaining the original round and draft', async t => {
  const f = await setup(t, 'off'), selected = await f.saved(); await f.ctx.openReferenceLibrary(false);
  const held = gate(), enable = f.repo.enableAutomaticHistory.bind(f.repo); f.repo.enableAutomaticHistory = async (...args) => { await held.promise; return enable(...args); };
  const pending = f.history.turnOn(), old = f.engine.getSnapshot(); await assert.rejects(f.ctx.startSavedReference(selected), /等待|重试/);
  assert.strictEqual(f.engine.getSnapshot(), old); assert.equal(f.ctx.referenceTransitionRef.current, false); held.resolve(); await pending;
});

for (const mutation of ['input', 'reveal', 'cue'] as const) test(`actual safe old flush rejects a new ${mutation} tail without resetting or losing facts`, async t => {
  const f = await setup(t), selected = await f.saved(); await f.ctx.openReferenceLibrary(false);
  const held = gate(), save = f.repo.saveSession.bind(f.repo); let saving = false;
  f.repo.saveSession = async snapshot => { saving = true; await held.promise; return save(snapshot); };
  const old = f.engine.getSnapshot().sessionId, pending = f.ctx.startSavedReference(selected), rejected = assert.rejects(pending, /变化|尚未保存/);
  await until(() => saving, 'old-round save');
  if (mutation === 'input') f.engine.input('NEW_UNSAVED_TAIL'); else if (mutation === 'reveal') f.engine.exposeHint('reveal'); else f.engine.nextCue(2);
  held.resolve(); await rejected; assert.equal(f.engine.getSnapshot().sessionId, old); assert.equal(f.history.getSnapshot().dirty, true); assert.equal(f.ctx.referenceConfirmationRef.current, null);
  if (mutation === 'input') assert.equal(f.engine.draft, 'NEW_UNSAVED_TAIL'); if (mutation === 'reveal') assert.equal(revealEvents(f.engine.getSnapshot()).length, 1);
  f.repo.saveSession = save; await f.history.flush(); assert.deepEqual((await f.repo.loadHistorySession(old))!.snapshot, f.engine.getSnapshot());
});

for (const invalidation of ['selected receipt', 'selection token', 'source cue', 'privacy generation'] as const) test(`actual start rejects stale ${invalidation} before replacing the original round`, async t => {
  const f = await setup(t), selected = await f.saved(); await f.ctx.openReferenceLibrary(false);
  const old = f.engine.getSnapshot().sessionId;
  if (invalidation === 'selected receipt') {
    await assert.rejects(f.ctx.startSavedReference({ ...selected, createdAt: '2026-10-11T08:00:00.000Z' }), /已改变|不可读取/);
  } else {
    const held = gate(); f.setAcquireGate(held); const acquisitions = f.acquisitions;
    const pending = f.ctx.startSavedReference(selected), rejected = assert.rejects(pending, /变化|未开始|尚未保存/); await until(() => f.acquisitions > acquisitions, 'target media verification');
    if (invalidation === 'selection token') f.ctx.referenceActionRef.current++; else if (invalidation === 'source cue') f.engine.nextCue(2);
    else { const peer = new IndexedDBTrainingRepository({ indexedDB: f.factory, dbName: f.dbName }); await peer.disableAutomaticHistory(0); await peer.close(); }
    held.resolve(); await rejected;
  }
  assert.equal(f.engine.getSnapshot().sessionId, old); assert.equal(f.ctx.referenceConfirmationRef.current, null); assert.equal(f.trace.includes('engine.start'), false);
});

for (const invalidation of ['closed', 'hidden', 'cue', 'media hash', 'preview duration'] as const) test(`actual save rejects stale ${invalidation} and retains the old material`, async t => {
  const f = await setup(t); await f.prepareEdit(); const old = f.engine.getSnapshot().material;
  if (invalidation === 'preview duration') {
    await assert.rejects(f.ctx.saveEditedReference({ ...edited, verifiedDurationSeconds: 71 }), /变化/);
  } else {
    const held = gate(); f.setAcquireGate(held); const before = f.acquisitions;
    const pending = f.ctx.saveEditedReference(edited), rejected = assert.rejects(pending, /没有保存|没有提交/); await until(() => f.acquisitions > before, 'save media lease');
    if (invalidation === 'closed') f.ctx.closePanel(false); else if (invalidation === 'hidden') f.ctx.document.hidden = true; else if (invalidation === 'cue') f.engine.nextCue(2); else f.setLease({ actualSha256: '0'.repeat(64), verified: false });
    held.resolve(); await rejected;
  }
  assert.strictEqual(f.engine.getSnapshot().material, old); assert.equal((await f.library.list()).entries.length, 0);
});

async function mutateSavedRow(f: { factory: IDBFactory }, update: (row: any) => any): Promise<void> {
  const connection = await new Promise<IDBDatabase>((resolve, reject) => { const request = f.factory.open(LOCAL_REFERENCE_DATABASE_NAME); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try { await new Promise<void>((resolve, reject) => {
    const tx = connection.transaction(LOCAL_REFERENCE_STORE_NAME, 'readwrite'), store = tx.objectStore(LOCAL_REFERENCE_STORE_NAME), request = store.openCursor();
    request.onsuccess = () => { const cursor = request.result; if (!cursor) return; const row = update(cursor.value); if (row === null) cursor.delete(); else cursor.update(row); cursor.continue(); };
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error);
  }); } finally { connection.close(); }
}

async function corrected(t: TestContext) {
  const f = await setup(t), selected = await f.saved();
  f.ctx.historyBindingPausedRef.current = true; f.engine.startReferenceSession(selected.material as Material, 1); f.ctx.historyBindingPausedRef.current = false;
  f.history.connect(f.engine.getSnapshot(), (await f.repo.readAutomaticHistoryControl())); return Object.assign(f, { material: f.engine.getSnapshot().material });
}
for (const failure of ['missing library', 'hash', 'duration', 'unknown duration', 'source', 'decode'] as const) test(`actual corrected load fails closed for ${failure} and never falls back to an ordinary URL`, async t => {
  const f = await corrected(t), before = learning(f.engine.getSnapshot());
  if (failure === 'missing library') await mutateSavedRow(f, row => null);
  if (failure === 'hash') f.setLease({ verified: false, actualSha256: '0'.repeat(64) });
  await f.ctx.loadCorrectedMaterial(f.material);
  if (failure === 'duration') f.video.duration = 71; if (failure === 'unknown duration') f.video.duration = Infinity;
  if (failure === 'source') { f.video.currentSrc = '/studio-assets/06-cafe.mp4'; f.video.onloadedmetadata?.(); }
  else if (failure === 'decode') { f.video.currentSrc = f.video.src; f.video.onerror?.(); }
  else f.video.metadata();
  assert.equal(f.ctx.correctedMediaRef.current, null); assert.equal(f.ctx.visualRef.current.ready, false); assert.equal(f.ctx.mediaDuration, 0);
  assert.notEqual(f.video.src, '/studio-assets/06-cafe.mp4'); assert.equal(f.video.plays, 0); assert.deepEqual(learning(f.engine.getSnapshot()), before); assert.ok(f.notices.length);
  assert.notEqual(f.ctx.currentCorrectedMediaError(), null);
});

test('actual corrected load accepts only the saved exact reference and verified source/duration; original load keeps its existing compatibility fallback', async t => {
  const f = await corrected(t); await f.ctx.loadCorrectedMaterial(f.material); f.video.metadata();
  assert.equal(f.ctx.currentCorrectedMediaError(), null); assert.equal(f.ctx.mediaDuration, 72); assert.equal(f.ctx.visualRef.current.ready, true); assert.equal(f.video.currentTime, edited.start);
  const original = await setup(t); original.ctx.loadDemo(); await tick(); original.video.metadata(); assert.equal(original.ctx.visualRef.current.ready, true);
  assert.equal(original.video.src, 'blob:host-verified'); original.video.onerror?.(); assert.equal(original.video.src, '/studio-assets/06-cafe.mp4');
  assert.equal(original.engine.getSnapshot().material.version, CAFE_MATERIAL.version);
});

test('actual corrected loader drops a late source after the engine version changed', async t => {
  const f = await corrected(t), held = gate(); f.setAcquireGate(held); const before = f.acquisitions;
  const pending = f.ctx.loadCorrectedMaterial(f.material); await until(() => f.acquisitions > before, 'corrected source acquire');
  f.ctx.engineRef.current = new TrainingEngine(); held.resolve(); await pending;
  assert.equal(f.video.src, ''); assert.equal(f.ctx.correctedMediaRef.current, null); assert.equal(f.ctx.visualRef.current.ready, false);
});

for (const phase of ['target verification', 'new permit'] as const) test(`actual close while ${phase} is pending keeps the transition lock and cannot silently cancel an accepted start`, async t => {
  const f = await setup(t, 'segment'), selected = await f.saved(); await f.ctx.openReferenceLibrary(false);
  const held = gate(); let waiting = false;
  if (phase === 'target verification') f.setAcquireGate(held);
  else { const admission = f.repo.beginTrainingHistorySegment.bind(f.repo); f.repo.beginTrainingHistorySegment = async (...args) => { waiting = true; await held.promise; return admission(...args); }; }
  const start = f.ctx.startSavedReference(selected); await until(() => phase === 'target verification' ? f.acquisitions > 0 : waiting, phase);
  assert.equal(f.ctx.referenceTransitionRef.current, true); const token = f.ctx.referenceActionRef.current;
  f.ctx.closePanel(false); assert.equal(f.ctx.panel, 'references'); assert.equal(f.ctx.referenceActionRef.current, token); assert.equal(f.ctx.referencePanelRef.current, true);
  held.resolve(); await start; assert.equal(f.ctx.referenceTransitionRef.current, false); assert.equal(f.ctx.panel, 'reference-confirm'); assert.equal(revealEvents(f.engine.getSnapshot()).length, 1);
});

test('actual visibility handler cancels target verification before start, retaining the complete original round', async t => {
  const f = await setup(t), selected = await f.saved(); await f.ctx.openReferenceLibrary(false);
  const old = f.engine.getSnapshot().sessionId, held = gate(); f.setAcquireGate(held);
  const start = f.ctx.startSavedReference(selected), rejected = assert.rejects(start, /变化|原片|时长|未开始/); await until(() => f.acquisitions > 0, 'target media');
  f.ctx.document.hidden = true; f.ctx.visibility(); held.resolve(); await rejected;
  assert.equal(f.engine.getSnapshot().sessionId, old); assert.equal(f.ctx.referenceConfirmationRef.current, null); assert.equal(f.trace.includes('engine.start'), false);
  assert.equal(revealEvents(f.engine.getSnapshot()).length, 0); await f.history.flush(); assert.equal((await f.repo.loadHistorySession(old))!.snapshot.drafts[f.engine.cue.id].text, 'OLD_DRAFT_RETAINED');
});

test('actual hidden-after-reset permit completion stays unexposed, blocks input/close and requires a visible explicit confirmation', async t => {
  const f = await setup(t, 'segment'), selected = await f.saved(); await f.ctx.openReferenceLibrary(false);
  const held = gate(), admission = f.repo.beginTrainingHistorySegment.bind(f.repo); let waiting = false;
  f.repo.beginTrainingHistorySegment = async (...args) => { waiting = true; await held.promise; return admission(...args); };
  const start = f.ctx.startSavedReference(selected); await until(() => waiting, 'new permit');
  f.ctx.document.hidden = true; f.ctx.visibility(); held.resolve(); await start;
  assert.equal(f.ctx.referenceConfirmationRef.current.exposed, false); assert.equal(revealEvents(f.engine.getSnapshot()).length, 0);
  assert.equal(renderToStaticMarkup(f.ctx.renderConfirmation()).includes(edited.text), false);
  const attempted = { currentTarget: { value: 'ILLEGAL_PRECONFIRMATION_DRAFT' }, nativeEvent: { inputType: 'insertText', data: 'ILLEGAL_PRECONFIRMATION_DRAFT' } };
  f.ctx.inputHandler(attempted); assert.equal(attempted.currentTarget.value, ''); assert.equal(f.engine.draft, '');
  f.ctx.closePanel(false); assert.equal(f.ctx.panel, 'reference-confirm'); f.ctx.showReferenceConfirmation(); assert.equal(revealEvents(f.engine.getSnapshot()).length, 0);
  f.ctx.document.hidden = false; f.ctx.visibility(); assert.equal(revealEvents(f.engine.getSnapshot()).length, 0);
  f.ctx.showReferenceConfirmation(); assert.equal(revealEvents(f.engine.getSnapshot()).length, 1); assert.ok(renderToStaticMarkup(f.ctx.renderConfirmation()).includes(edited.text));
  f.ctx.continueReferencePractice(); f.ctx.inputHandler({ currentTarget: { value: edited.text }, nativeEvent: { inputType: 'insertText', data: edited.text } });
  f.ctx.submit(); assert.equal(f.engine.getSnapshot().attempts[0].conditions.revealed, true); assert.equal(f.engine.getSnapshot().attempts[0].errors, 0);
});

test('actual disposed host never publishes a late new-permit confirmation', async t => {
  const f = await setup(t, 'segment'), selected = await f.saved(); await f.ctx.openReferenceLibrary(false);
  const held = gate(), admission = f.repo.beginTrainingHistorySegment.bind(f.repo); let waiting = false;
  f.repo.beginTrainingHistorySegment = async (...args) => { waiting = true; await held.promise; return admission(...args); };
  const start = f.ctx.startSavedReference(selected); await until(() => waiting, 'new permit');
  const views = f.views.length; f.ctx.disposed.current = true; f.ctx.life.current++; held.resolve(); await start;
  assert.equal(f.views.length, views); assert.equal(f.ctx.referenceConfirmationRef.current, null); assert.equal(revealEvents(f.engine.getSnapshot()).length, 0);
});

for (const mutation of ['missing', 'same version different bytes'] as const) test(`actual explicit corrected playback re-reads the library and rejects a ${mutation} row`, async t => {
  const f = await corrected(t); await f.ctx.loadCorrectedMaterial(f.material); f.video.metadata();
  await f.ctx.toggleCorrectedPlay(); assert.equal(f.video.plays, 1); assert.equal(f.video.paused, false);
  await f.ctx.toggleCorrectedPlay(); assert.equal(f.video.paused, true);
  await mutateSavedRow(f, row => mutation === 'missing' ? null : { ...row, material: { ...row.material, title: 'same ID with corrupted bytes' } });
  const before = learning(f.engine.getSnapshot()); await f.ctx.toggleCorrectedPlay();
  assert.equal(f.video.plays, 1); assert.equal(f.video.paused, true); assert.equal(f.ctx.correctedPlayOwner.current, null); assert.match(f.notices.at(-1)!, /缺失|改变/);
  assert.deepEqual(learning(f.engine.getSnapshot()), before);
});

test('actual rapid corrected-play requests give playback only to the newest exact-row read', async t => {
  const f = await corrected(t); await f.ctx.loadCorrectedMaterial(f.material); f.video.metadata();
  const held = gate(), exact = f.library.isExactSavedMaterial.bind(f.library); let reads = 0;
  f.library.isExactSavedMaterial = async material => { if (++reads === 1) await held.promise; return exact(material); };
  const older = f.ctx.toggleCorrectedPlay(); await until(() => reads === 1, 'old play read'); await f.ctx.toggleCorrectedPlay();
  assert.equal(f.video.plays, 1); const owner = f.ctx.correctedPlayOwner.current; held.resolve(); await older;
  assert.equal(f.video.plays, 1); assert.strictEqual(f.ctx.correctedPlayOwner.current, owner); assert.equal(f.video.paused, false);
});

for (const invalidation of ['hidden', 'cue', 'source'] as const) test(`actual pending corrected-play read drops a stale ${invalidation} request`, async t => {
  const f = await corrected(t); await f.ctx.loadCorrectedMaterial(f.material); f.video.metadata();
  const held = gate(), exact = f.library.isExactSavedMaterial.bind(f.library); let reading = false;
  f.library.isExactSavedMaterial = async material => { reading = true; await held.promise; return exact(material); };
  const playing = f.ctx.toggleCorrectedPlay(); await until(() => reading, 'play row read');
  if (invalidation === 'hidden') { f.ctx.document.hidden = true; f.ctx.visibility(); }
  else if (invalidation === 'cue') f.ctx.changeCue(0); else f.video.currentSrc = '/studio-assets/06-cafe.mp4';
  held.resolve(); await playing; assert.equal(f.video.plays, 0); assert.equal(f.video.paused, true); assert.equal(f.ctx.correctedPlayOwner.current, null);
});

test('actual host save must reject a preview whose live source proof is revoked during media acquisition', async t => {
  const f = await setup(t), controller = await f.prepareEdit(), held = gate(); f.setAcquireGate(held); const acquisitions = f.acquisitions;
  const saving = f.ctx.saveEditedReference(edited); await until(() => f.acquisitions > acquisitions, 'save lease'); controller.close(); held.resolve();
  await assert.rejects(saving, /变化|校验|没有保存|没有提交/); assert.equal((await f.library.list()).entries.length, 0);
});

test('actual late editor open after cancel cannot expose or set an obsolete target', async t => {
  const f = await setup(t), held = gate(), list = f.library.list.bind(f.library); let listing = false;
  f.library.list = async () => { listing = true; await held.promise; return list(); };
  const opening = f.ctx.openReferenceLibrary(true); await until(() => listing, 'editor library list'); f.ctx.closePanel(false); held.resolve(); await opening;
  assert.equal(f.ctx.referenceTarget, null); assert.equal(f.ctx.referenceTargetRef.current, null); assert.equal(revealEvents(f.engine.getSnapshot()).length, 0); assert.equal(f.ctx.panel, null);
});

test('actual missing corrected library row leaves restored text, scores and draft readable without editor exposure', async t => {
  const f = await corrected(t); f.engine.input('RETAINED_CORRECTED_DRAFT'); f.engine.submit(); const before = f.engine.getSnapshot();
  await mutateSavedRow(f, () => null); await f.ctx.openReferenceLibrary(true);
  assert.match(f.ctx.referenceError, /缺失|不匹配/); assert.equal(f.ctx.referenceTarget, null); assert.equal(revealEvents(f.engine.getSnapshot()).length, 0);
  assert.deepEqual(learning(f.engine.getSnapshot()), learning(before)); assert.equal(exportSession(f.engine.getSnapshot()).json.includes('RETAINED_CORRECTED_DRAFT'), true);
});

test('actual failed old-round write never starts a corrected session and the old round remains exportable and retryable', async t => {
  const f = await setup(t), selected = await f.saved(); await f.ctx.openReferenceLibrary(false);
  const before = f.engine.getSnapshot(), save = f.repo.saveSession.bind(f.repo); f.repo.saveSession = async () => { throw Error('Injected old-round CAS or quota failure'); };
  await assert.rejects(f.ctx.startSavedReference(selected), /尚未保存/); assert.strictEqual(f.engine.getSnapshot(), before); assert.equal(f.ctx.referenceConfirmationRef.current, null);
  assert.equal(f.history.getSnapshot().dirty, true); assert.match(f.history.getSnapshot().error!, /尚未保存/); assert.equal(exportSession(f.engine.getSnapshot()).json.includes('OLD_DRAFT_RETAINED'), true);
  f.repo.saveSession = save; await f.history.flush(); await f.ctx.startSavedReference(selected); assert.equal(f.engine.getSnapshot().material.version, selected.material.version);
});

// Independent review regression: this deliberately injects a real engine fact
// at the helper/caller microtask boundary. UI locking alone is not a commit gate.
for (const mode of ['legacy','segment','off','awaiting'] as const) test(`actual ${mode} version switch rejects a fact appended after helper validation and before reset`, async t => {
  const f = await setup(t, mode), selected = await f.saved(); await f.ctx.openReferenceLibrary(false);
  const read = f.repo.readAutomaticHistoryControl.bind(f.repo); let inserted = false;
  f.repo.readAutomaticHistoryControl = async () => {
    const control = await read(); queueMicrotask(() => queueMicrotask(() => { inserted = true; f.engine.exposeHint('reveal'); })); return control;
  };
  const old = f.engine.getSnapshot(), oldReveals = revealEvents(old).length;
  await assert.rejects(f.ctx.startSavedReference(selected), /变化|尚未保存/);
  assert.equal(inserted, true); assert.equal(f.engine.getSnapshot().sessionId, old.sessionId);
  assert.equal(f.engine.getSnapshot().material.version, old.material.version);
  assert.deepEqual(f.engine.getSnapshot().drafts, {...old.drafts,[f.engine.cue.id]:{...old.drafts[f.engine.cue.id],revealed:true}}); assert.deepEqual(f.engine.getSnapshot().attempts, old.attempts);
  assert.equal(revealEvents(f.engine.getSnapshot()).length, oldReveals + 1); assert.equal(f.ctx.referenceConfirmationRef.current, null);
});

for (const newerPlay of [false,true]) test(`actual late native corrected play after cue switch ${newerPlay ? 'does not stop a new explicit owner' : 'cannot resume the old intent'}`, async t => {
  const f = await corrected(t); await f.ctx.loadCorrectedMaterial(f.material); f.video.metadata();
  const held = gate(); let calls = 0;
  f.video.play = () => {
    f.video.plays++;
    if (++calls === 1) return held.promise.then(() => { f.video.paused = false; f.video.dispatchEvent(new Event('play')); });
    f.video.paused = false; f.video.dispatchEvent(new Event('play')); return Promise.resolve();
  };
  const pending = f.ctx.toggleCorrectedPlay(); await until(() => calls === 1, 'native play pending');
  f.ctx.changeCue(2); assert.equal(f.video.paused, true);
  if (newerPlay) await f.ctx.toggleCorrectedPlay();
  const owner = f.ctx.correctedPlayOwner.current; held.resolve(); await pending;
  assert.equal(f.video.paused, !newerPlay);
  if (newerPlay) assert.strictEqual(f.ctx.correctedPlayOwner.current, owner);
  else assert.equal(f.ctx.correctedPlayOwner.current, null);
});

test('actual corrected scene duration has no 72-second default while original display remains compatible', () => {
  let expression = '';
  function find(node: any): void {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'AssignmentExpression' && source.slice(node.left.start,node.left.end) === 'v.playbackDuration') expression = source.slice(node.right.start,node.right.end);
    for (const [key,value] of Object.entries(node)) if (!['loc','tokens','comments'].includes(key)) {
      if (Array.isArray(value)) value.forEach(find); else if (value && typeof value === 'object') find(value);
    }
  }
  find(studio); assert.ok(expression);
  const { strictCourse } = install({ require, exports: {} });
  const evaluate = new Function('strictCourse','activeLesson','e','v={ready:true}',`return (${expression})`);
  const read = evaluate.bind(null, strictCourse);
  const correctedEngine = {getSnapshot: () => ({material: {localReference: {}}})};
  const originalEngine = {getSnapshot: () => ({material: {}})};
  for (const duration of [NaN,Infinity,-1,0]) assert.equal(read({duration},correctedEngine),0);
  assert.equal(read({duration:72},correctedEngine),72); assert.equal(read({duration:72},correctedEngine,{ready:false}),0);
  assert.equal(read({duration:NaN},originalEngine),72); assert.equal(read({duration:50},originalEngine),50);
});

for(const operation of ['merge','split'] as const)test(`actual ${operation} saves immutable lineage and explicitly starts with new identity while old scores/draft stay saved`,async t=>{
 const f=await setup(t),cue=f.engine.cue,next=CAFE_MATERIAL.cues[2];
 const firstText=operation==='merge'?'Would you like it hot or iced? Iced, please.':'Would you like',secondText='it hot or iced?';
 const input={text:operation==='split'?`${firstText} ${secondText}`:firstText,start:cue.start,end:operation==='merge'?next.end:cue.end,verifiedDurationSeconds:72,saveRequestId:`actual-${operation}`,structure:{operation,firstText,...(operation==='split'?{secondText,splitAt:9}:{}),confirmed:true as const}};
 await f.prepareEdit(input);await f.history.flush();const old=f.engine.getSnapshot(),before=JSON.stringify(old),oldExport=exportSession(old,'2026-10-12T00:00:00.000Z');
 const saved=await f.ctx.saveEditedReference(input);assert.equal(JSON.stringify(f.engine.getSnapshot()),before);assert.equal(saved.entry.material.localReference.lineage.operation,operation);
 assert.notEqual(saved.entry.change.cueId,cue.id);assert.equal(f.trace.includes('engine.start'),false);assert.deepEqual(exportSession((await f.repo.loadHistorySession(old.sessionId))!.snapshot,'2026-10-12T00:00:00.000Z'),oldExport);
 await f.ctx.startSavedReference(saved.entry);await tick();assert.equal(f.engine.cue.id,saved.entry.change.cueId);assert.equal(f.engine.getSnapshot().attempts.length,0);assert.equal(f.engine.getSnapshot().earnedWords,0);
 assert.deepEqual((await f.repo.loadHistorySession(old.sessionId))!.snapshot.attempts,old.attempts);assert.equal((await f.repo.loadHistorySession(old.sessionId))!.snapshot.drafts[cue.id].text,'OLD_DRAFT_RETAINED');
 await f.ctx.loadCorrectedMaterial(f.engine.getSnapshot().material);f.video.metadata();assert.equal(f.ctx.currentCorrectedMediaError(),null);
 f.ctx.continueReferencePractice();f.engine.input(firstText);f.engine.submit();assert.equal(f.engine.getSnapshot().attempts.at(-1)!.cueId,saved.entry.change.cueId);
});
test('actual host refuses unconfirmed or wrong preview structural payload without saving',async t=>{
 const f=await setup(t),input={...edited,start:6,end:12,text:'Would you like it hot or iced?',structure:{operation:'split',firstText:'Would you like',secondText:'it hot or iced?',splitAt:9,confirmed:true}};
 await f.prepareEdit(input);
 for(const structure of [{...input.structure,confirmed:false},{...input.structure,firstText:'changed'},{...input.structure,operation:'merge'}])await assert.rejects(f.ctx.saveEditedReference({...input,structure}));
 assert.equal((await f.library.list()).entries.length,0);
});
