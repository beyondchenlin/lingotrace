import {translate,translateKnownUi} from '../i18n/locale';
import { listeningAssistanceLabel, exportListeningPage } from './listening-export';
import { inactiveListeningTestScope } from './inactive-listening-test-fixture.mjs';
import {projectAttemptReferenceExposure} from './reference-exposure';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { renderToStaticMarkup } from 'react-dom/server';
import { TrainingEngine, CAFE_MATERIAL, deriveCurves, hasScorableReference, type Material } from './training';
import { isPracticePaused } from './practice-pause';
import RoundReview from '../components/RoundReview';
import ContextBookmarkComposer from '../components/ContextBookmarkComposer';
import ReviewTaskComposer from '../components/ReviewTaskComposer';
import {getBookmarkReference} from './context-bookmark';
import { projectLegacyHistoryHud } from './legacy-history-hud';
import { readLegacyHistoryRecord } from './legacy-history';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDBTrainingRepository } from './repository';

const source = await readFile(new URL('../components/Studio.tsx', import.meta.url), 'utf8');
const require = createRequire(import.meta.url), swc = require('next/dist/build/swc'); await swc.loadBindings();
const strictCourseSource = source.slice(source.indexOf(' function strictCourse('), source.indexOf(' function prepareCoursePoster('));
const { code: strictCourseCode } = await swc.transform(strictCourseSource + source.slice(source.indexOf(' function builtinAnswerBlocked('), source.indexOf(' function contextRepository(')), { jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'commonjs' } });
const material: Material = { id: 'retained-original', version: 'original-two-cues-v1', title: '保留的两句素材', rights: 'Original test text', cues: [
  { id: 'retained-1', text: 'First retained sentence.', start: 0, end: 3 },
  { id: 'retained-2', text: 'Second retained sentence.', start: 3, end: 8 },
] };
function fixture(selectedMaterial = material) {
  let id = 0;
  const engine = new TrainingEngine({ material: selectedMaterial, sessionId: 'material-boundary-test', clock: { now: () => 0, wallTime: () => '2026-10-09T11:00:00.000Z', id: () => `material-${++id}` } });
  engine.nextCue(selectedMaterial.cues.length - 1); engine.input(engine.cue.text); engine.submit();
  return engine;
}
async function context(engine: TrainingEngine) {
  const context = vm.createContext({ ...inactiveListeningTestScope(),checkedReview:null,locale:'en',t:translate.bind(null,'en'),ui:translateKnownUi.bind(null,'en'),listeningAssistanceLabel,exportListeningPage,courseChoice:null,courseError:'',referenceBusy:false,reviewBindingRef:{current:null},ReviewTaskComposer,reviewBusy:false,historyStatus:{mode:'legacy'},saveReviewTask(){throw Error('Render cannot save')},referenceBlocked:()=>false,projectAttemptReferenceExposure,submissionSound:{audio:{current:{cancel(){},play(){}}}}, require, exports: {}, panel: 'review', reviewSnapshot: engine.getSnapshot(), CAFE_MATERIAL, deriveCurves,
    engineRef: { current: engine }, visualRef: { current: {} }, replaySnapshot: { current: null }, fixture: false, mediaKind: 'demo', composing: { current: false },
    isPracticePaused, hasScorableReference, mediaRef: { current: { kind: 'demo' } }, mediaInteractedRef: { current: false }, lessonRef: { current: { pause() {} } },
    inputRef: { current: { focus() {} } }, seekTo() {}, setShowSubtitle() {}, syncDraft() {}, notify() {}, setResult() {}, performance: { now: () => 0 },
    RoundReview,ContextBookmarkComposer,getBookmarkReference,bookmarkMediaReady:false,saveContextBookmark(){throw Error('Render cannot save')},openSubtitleWorkbench(){throw Error('Render cannot open')},openPanel(){}, continueRoundReview() {}, restoreFailed: false, paused: false, PaceTimeline: () => null, fmt: (n: number) => String(n), activeRecord: false, startingRecord: false, replayIndex: null, mediaName: 'retained media',
  });
  vm.runInContext(strictCourseCode, context);
  return context;
}
async function renderSection(engine: TrainingEngine, panel: 'review' | 'media') {
  const start = source.indexOf(`{panel==='${panel}'`), end = source.indexOf('\n {panel===', start + 1);
  assert.ok(start >= 0 && end > start);
  const jsx = source.slice(start, end).trim().slice(1, -1);
  const { code } = await swc.transform(`function renderSection(){return (${jsx});}`, { jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2022' }, module: { type: 'commonjs' } });
  const c = await context(engine); c.panel = panel; vm.runInContext(code, c);
  return renderToStaticMarkup(c.renderSection());
}

test('actual review JSX uses retained material denominator and cue identity, matching saved history', async () => {
  const engine = fixture(), snapshot = engine.getSnapshot(), before = JSON.stringify(snapshot);
  const saved = readLegacyHistoryRecord({ sessionId: snapshot.sessionId, sequence: snapshot.sequence, snapshot, updatedAt: snapshot.createdAt });
  const hud = projectLegacyHistoryHud(saved), html = await renderSection(engine, 'review');
  assert.equal(hud.completion.denominator, 2); assert.equal(hud.completion.numerator, 1);
  assert.ok(html.includes('<small>/2</small>'), 'Review denominator must be the retained two-cue material');
  assert.ok(html.includes('<summary>'+translate('en','studio.sentencePrefix')+'2'+translate('en','studio.sentenceSuffix')), 'Review must not show cue zero from the current catalogue lookup');
  assert.equal(JSON.stringify(snapshot), before);
});

test('actual material chooser renders exactly the current retained cue set and completion', async () => {
  const engine = fixture(), html = await renderSection(engine, 'media');
  const grid = html.match(/<div class="cue-grid">([\s\S]*?)<\/div>/)?.[1] ?? '';
  assert.equal((grid.match(/<button/g) ?? []).length, 2);
  assert.ok(html.includes('保留的两句素材')); assert.ok(grid.includes(translate('en','media.completed')));
});

test('actual successful-submit navigation wraps within the retained material without extra attempt or reward', async () => {
  for (const selectedMaterial of [material, { ...material, version: 'one-cue-v1', cues: material.cues.slice(0, 1) }, CAFE_MATERIAL]) {
    const engine = fixture(selectedMaterial), before = engine.getSnapshot(), c = await context(engine);
    const start = source.indexOf(' function submit('), end = source.indexOf(' function togglePlay(', start);
    assert.ok(start >= 0 && end > start);
    const { code } = await swc.transform(source.slice(start, end), { jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'commonjs' } });
    vm.runInContext(code, c); c.submit();
    assert.equal(engine.getSnapshot().cueIndex, 0, `must wrap the actual ${selectedMaterial.cues.length}-cue material`);
    assert.deepEqual(engine.getSnapshot().attempts, before.attempts); assert.equal(engine.getSnapshot().earnedWords, before.earnedWords);
    assert.equal(engine.getSnapshot().material, before.material);
  }
});

test('current 12-cue course retains existing denominator, numbering and completion', async () => {
  const engine = fixture(CAFE_MATERIAL), html = await renderSection(engine, 'review'), media = await renderSection(engine, 'media');
  assert.ok(html.includes('<small>/12</small>')); assert.ok(html.includes('<summary>'+translate('en','studio.sentencePrefix')+'12'+translate('en','studio.sentenceSuffix')));
  const grid = media.match(/<div class="cue-grid">([\s\S]*?)<\/div>/)?.[1] ?? '';
  assert.equal((grid.match(/<button/g) ?? []).length, 12);
});

test('repository restoration preserves versioned reordered material and review matches saved history', async () => {
  const selected = { ...CAFE_MATERIAL, version: 'retained-reordered-cafe-v1', cues: [CAFE_MATERIAL.cues[3], CAFE_MATERIAL.cues[0]] };
  const engine = fixture(selected), before = engine.getSnapshot();
  const repo = new IndexedDBTrainingRepository({ indexedDB: new IDBFactory(), dbName: 'retained-material-isolated-check' });
  try {
    await repo.saveSession(before); const loaded = await repo.loadLatest(); assert.deepEqual(loaded, before);
    const restored = new TrainingEngine({ snapshot: loaded! }), html = await renderSection(restored, 'review');
    assert.ok(html.includes('<small>/2</small>')); assert.ok(html.includes('<summary>'+translate('en','studio.sentencePrefix')+'2'+translate('en','studio.sentenceSuffix')));
    const history = await repo.loadHistorySession(before.sessionId); assert.ok(history);
    assert.equal(projectLegacyHistoryHud(history).completion.denominator, 2);
    assert.deepEqual(await repo.loadLatest(), before);
  } finally { await repo.close(); }
});
