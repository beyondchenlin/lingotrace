import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {translate, translateKnownUi} from '../i18n/locale';
import {TrainingEngine, getDraft, RULE_VERSION, PACE_RULE_VERSION, type EventPayload} from './training';
import {ListeningConditions} from './listening-flow';
import {captureListeningConditions, readListeningSession, type ListeningSessionRecord} from './listening-session';
import * as sessionModule from './listening-session';
import * as exportModule from './listening-session-export';

const require = createRequire(import.meta.url), swc = require('next/dist/build/swc');
await swc.loadBindings();
const source = await readFile(new URL('../components/ListeningSessionHistory.tsx', import.meta.url), 'utf8');
const {code} = await swc.transform(source, {jsc: {parser: {syntax: 'typescript', tsx: true}, transform: {react: {runtime: 'automatic'}}, target: 'es2022'}, module: {type: 'commonjs'}});
const tick = () => new Promise(resolve => setImmediate(resolve));
function gate<T = void>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject}; }
function walk(node: any, out: any[] = []): any[] { if (Array.isArray(node)) {node.forEach(value => walk(value, out)); return out;} if (!node || typeof node !== 'object') return out; out.push(node); walk(node.props?.children, out); return out; }
function textOf(node: any): string { if (node == null || typeof node === 'boolean') return ''; if (typeof node === 'string' || typeof node === 'number') return String(node); if (Array.isArray(node)) return node.map(textOf).join(''); return textOf(node.props?.children); }
const labels = {refresh: 'Refresh listening conditions history', reading: 'Reading…', back: 'Back to listening conditions list', json: 'Download complete conditions JSON', csv: 'Download conditions package CSV'};

/** Real Training events and validated wrapper: old attempt/receipt, assisted and
 * clean retained attempts, one discarded submission and one pending submission. */
function record(sessionId: string): ListeningSessionRecord {
  let serial = 0;
  const stamp = '2026-10-12T08:00:00.000Z';
  const engine = new TrainingEngine({sessionId, clock: {now: () => 0, wallTime: () => stamp, id: () => `${sessionId}-event-${++serial}`}});
  engine.input(`pre-B answer ${sessionId}`); engine.submit();
  const before = engine.getSnapshot(), referenceVersion = `reference-${sessionId}`;
  const conditions = new ListeningConditions({sessionId, roundId: before.roundId, materialId: before.material.id, materialVersion: before.material.version, referenceVersion}, 'complete-to-submit');
  const emit = (payload: EventPayload) => {const snapshot = engine.getSnapshot(); engine.dispatch({...payload, eventId: `${sessionId}-manual-${++serial}`, sessionId, sequence: snapshot.sequence + 1, wallTime: stamp, activeMs: snapshot.activeMs, cueId: engine.cue.id, inputVersion: getDraft(snapshot).version, schemaVersion: snapshot.schemaVersion, ruleVersion: RULE_VERSION, paceRuleVersion: PACE_RULE_VERSION, materialId: snapshot.material.id, materialVersion: snapshot.material.version});};
  const submit = () => {const capture = conditions.capture(engine.getSnapshot()); engine.submit(); conditions.complete(capture, engine.getSnapshot());};
  engine.nextCue(1); conditions.present(engine.cue.id, 'subtitle', true, referenceVersion); engine.input(`assisted answer ${sessionId}`); submit();
  engine.nextCue(2); engine.input(`clean answer ${sessionId}`); submit();
  engine.nextCue(3); engine.input('discard this submission');
  let capture = conditions.capture(engine.getSnapshot());
  emit({type: 'submitRequested', attemptId: `${sessionId}-discarded`, answer: engine.draft, draftVersion: getDraft(engine.getSnapshot()).version});
  conditions.complete(capture, engine.getSnapshot()); engine.input('newer draft'); emit({type: 'judgmentApplied', attemptId: `${sessionId}-discarded`}); conditions.reconcile(engine.getSnapshot());
  engine.nextCue(4); engine.input('leave this submission pending'); capture = conditions.capture(engine.getSnapshot());
  emit({type: 'submitRequested', attemptId: `${sessionId}-pending`, answer: engine.draft, draftVersion: getDraft(engine.getSnapshot()).version}); conditions.complete(capture, engine.getSnapshot());
  const snapshot = engine.getSnapshot();
  return readListeningSession({version: 'listening-session-v1', sessionId, sequence: snapshot.sequence, updatedAt: stamp, snapshot: {schemaVersion: 'listening-session-v1', events: null}, trainingSnapshot: snapshot, preBRecord: {sessionId, sequence: before.sequence, snapshot: before, updatedAt: stamp}, scope: {scopeId: `scope-${sessionId}`, startedAt: stamp, referenceVersion, admittedSequence: before.sequence, generation: 0, revision: 4}, conditions: captureListeningConditions(conditions.snapshot())});
}
const target = record('exact-target'), other = record('unrelated-record');

type List = () => Promise<readonly ListeningSessionRecord[]>;
type Deliver = (id: string, expected: ListeningSessionRecord, deliver: () => void) => Promise<void>;
/** Compile the real component and drive its actual state/effects/handlers.
 * Only React scheduling and the repository I/O boundary are simulated. */
function setup(options: {records?: readonly ListeningSessionRecord[]; props?: Record<string, unknown>; list?: List; deliver?: Deliver} = {}) {
  const cells: any[] = []; let cursor = 0, dirty = true, mounted = true, rendering = false, effects: (() => void)[] = [], tree: any = null, lateStateUpdates = 0;
  let list: List = options.list ?? (async () => options.records ?? [other, target]);
  let deliver: Deliver = options.deliver ?? (async (_id, _expected, sink) => {sink();});
  const deliveries: {id: string; expected: ListeningSessionRecord}[] = [], downloads: {name: string; blob: Blob}[] = []; let reads = 0;
  const repository = {async listListeningSessions() {reads++; return list();}, async deliverListeningSession(id: string, expected: ListeningSessionRecord, sink: () => void) {deliveries.push({id, expected}); return deliver(id, expected, sink);}};
  let props: any = {repository, download: (name: string, blob: Blob) => downloads.push({name, blob}), ...options.props};
  const sameDeps = (a: any, b: any) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {...React,
    useRef(initial: any) {const index = cursor++; if (!cells[index]) cells[index] = {kind: 'ref', value: {current: initial}}; return cells[index].value;},
    useState(initial: any) {const index = cursor++; if (!cells[index]) {const cell: any = {kind: 'state', value: typeof initial === 'function' ? initial() : initial}; cell.set = (next: any) => {if (!mounted) {lateStateUpdates++; return;} const value = typeof next === 'function' ? next(cell.value) : next; if (!Object.is(value, cell.value)) {cell.value = value; dirty = true;}}; cells[index] = cell;} return [cells[index].value, cells[index].set];},
    useEffect(effect: any, deps: any) {const index = cursor++, prior = cells[index]; if (!prior || !sameDeps(prior.deps, deps)) {const next = {kind: 'effect', deps, cleanup: prior?.cleanup}; cells[index] = next; effects.push(() => {next.cleanup?.(); next.cleanup = effect();});}},
    useCallback(callback: any, deps: any) {const index = cursor++, prior = cells[index]; if (!prior || !sameDeps(prior.deps, deps)) cells[index] = {kind: 'callback', deps, value: callback}; return cells[index].value;},
  };
  const exports: any = {};
  vm.runInNewContext(code, {exports, Error, Blob, require: (name: string) => name === 'react' ? hooks : name === '../i18n/react' ? {useStudioLocale: () => ({locale: 'en', t: (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('en', key, params), ui: (message: string) => translateKnownUi('en', message)})} : name === '../core/listening-session' ? sessionModule : name === '../core/listening-session-export' ? exportModule : require(name)});
  const flush = () => {if (!mounted || rendering) return; rendering = true; try {let turns = 0; while (dirty || effects.length) {if (++turns > 100) throw Error('Hook render loop'); if (dirty) {dirty = false; cursor = 0; tree = exports.default(props);} const queued = effects; effects = []; for (const effect of queued) effect();}} finally {rendering = false;}};
  const settle = async () => {for (let index = 0; index < 4; index++) {flush(); await tick();} flush();};
  const findButton = (label: string) => {flush(); return walk(tree).find(node => node.type === 'button' && textOf(node) === label);};
  const button = (label: string) => {const result = findButton(label); assert.ok(result, `Missing button ${label}`); return result;};
  const click = (label: string) => {const node = button(label); assert.equal(!!node.props.disabled, false, `Disabled button ${label}`); node.props.onClick(); flush();};
  const update = (patch: Record<string, unknown>) => {props = {...props, ...patch}; dirty = true; flush();};
  const unmount = () => {if (!mounted) return; mounted = false; for (const cell of cells) if (cell?.kind === 'effect') cell.cleanup?.(); effects = []; dirty = false;};
  flush(); return {settle, flush, button, findButton, click, update, unmount, deliveries, downloads, setList: (fn: List) => {list = fn;}, setDeliver: (fn: Deliver) => {deliver = fn;}, get reads() {return reads;}, get lateStateUpdates() {return lateStateUpdates;}, get tree() {flush(); return tree;}, get text() {flush(); return textOf(tree);}, get html() {flush(); return renderToStaticMarkup(tree);}};
}
const detail = (options: Parameters<typeof setup>[0] = {}) => setup({...options, props: {initialSessionId: target.sessionId, detailOnly: true, ...options.props}});
function assertNoDetail(p: ReturnType<typeof setup>) {assert.equal(p.findButton(labels.json), undefined); assert.equal(p.findButton(labels.csv), undefined); assert.doesNotMatch(p.text, /assisted answer|pre-B answer|clean answer/); assert.doesNotMatch(p.html, /class="history-entry"/);}

test('exact initial target opens full assistance detail and receipt without exposing another row or internal Back', async () => {
  const p = detail(); try {await p.settle(); assert.match(p.text, /assisted answer exact-target/); assert.doesNotMatch(p.text, /unrelated-record/); assert.equal(p.findButton(labels.back), undefined); assert.doesNotMatch(p.html, /class="history-entry"/);
    assert.match(p.text, /actual attempts 3 · pending 1 · discarded 1/); assert.match(p.text, /Reference assistance/); assert.match(p.text, /No observed assistance/); assert.match(p.text, /Assistance unknown/); assert.match(p.text, /Complete evidence through submission/); assert.match(p.text, /Evidence coverage unknown/); assert.match(p.text, /Pending· sentence cafe-studio-5/); assert.match(p.text, /Discarded· sentence cafe-studio-4/); assert.match(p.text, /Original save sequence 4· original attempts 1/); assert.match(p.text, /no B-conditions boundary/);
  } finally {p.unmount();}
});

test('both existing export formats deliver the exact full wrapper and preserve pre-B, pending and discarded facts', async () => {
  const p = detail(); try {await p.settle(); for (const format of ['json', 'csv'] as const) {p.click(labels[format]); await p.settle(); const output = p.downloads.at(-1)!; assert.deepEqual(p.deliveries.at(-1), {id: target.sessionId, expected: target}); const expected = exportModule.listeningSessionExport(target, format); assert.equal(output.name, expected.name); assert.equal(output.blob.type, expected.mime); assert.equal(await output.blob.text(), expected.text);}
    assert.deepEqual(exportModule.readListeningSessionExport(JSON.parse(await p.downloads[0].blob.text())), target); assert.equal(p.downloads.length, 2);
  } finally {p.unmount();}
});

for (const initialSessionId of ['missing-target', undefined]) test(`detail-only missing target ${String(initialSessionId)} never falls back to unrelated records`, async () => {
  const p = detail({props: {initialSessionId}}); try {await p.settle(); assertNoDetail(p); assert.match(p.text, /record is no longer/); assert.equal(p.findButton(labels.back), undefined); assert.equal(p.deliveries.length, 0); p.click(labels.refresh); await p.settle(); assertNoDetail(p);} finally {p.unmount();}
});

test('empty exact-target result reports missing selection instead of presenting it as empty history', async () => {
  const p = detail({records: []}); try {await p.settle(); assertNoDetail(p); assert.match(p.text, /record is no longer/); assert.doesNotMatch(p.text, /No complete saved listening/);} finally {p.unmount();}
});

for (const outcome of ['changed identity', 'read failed', 'removed']) test(`refresh removes old detail immediately and remains fail-closed for ${outcome}, then explicit retry recovers`, async () => {
  const p = detail(); try {await p.settle(); const staleExport = p.button(labels.json).props.onClick, pending = gate<readonly ListeningSessionRecord[]>(); p.setList(() => pending.promise); p.click(labels.refresh); assertNoDetail(p); staleExport(); await p.settle(); assert.equal(p.deliveries.length, 0);
    if (outcome === 'removed') pending.resolve([other]); else pending.reject(Error(outcome)); await p.settle(); assertNoDetail(p); assert.match(p.text, outcome === 'removed' ? /record is no longer/ : new RegExp(outcome)); staleExport(); await p.settle(); assert.equal(p.downloads.length, 0); assert.equal(p.deliveries.length, 0);
    const retry = gate<readonly ListeningSessionRecord[]>(); p.setList(() => retry.promise); p.click(labels.refresh); assertNoDetail(p); staleExport(); await p.settle(); assert.equal(p.deliveries.length, 0); retry.resolve([target]); await p.settle(); assert.ok(p.findButton(labels.json)); p.click(labels.json); await p.settle(); assert.equal(p.downloads.length, 1);
  } finally {p.unmount();}
});

test('same-render double export callbacks are synchronously fenced until delivery finishes', async () => {
  const held = gate(); const p = detail({deliver: async (_id, _expected, sink) => {await held.promise; sink();}}); try {await p.settle(); const json = p.button(labels.json).props.onClick, csv = p.button(labels.csv).props.onClick; json(); csv(); p.flush(); assert.equal(p.deliveries.length, 1); assert.equal(p.button(labels.json).props.disabled, true); held.resolve(); await p.settle(); assert.equal(p.downloads.length, 1);} finally {p.unmount();}
});

for (const cancel of ['refresh', 'unmount', 'target change']) test(`pending export cannot download after ${cancel}`, async () => {
  const held = gate(); const p = detail({deliver: async (_id, _expected, sink) => {await held.promise; sink();}}); try {await p.settle(); const staleExport = p.button(labels.json).props.onClick; p.click(labels.json);
    if (cancel === 'refresh') {p.setList(async () => {throw Error('changed identity');}); p.click(labels.refresh);} else if (cancel === 'unmount') p.unmount(); else p.update({initialSessionId: other.sessionId});
    held.resolve(); await p.settle(); staleExport(); await p.settle(); assert.equal(p.downloads.length, 0); assert.equal(p.deliveries.length, 1); assert.equal(p.lateStateUpdates, 0); if (cancel === 'target change') {assert.match(p.text, /assisted answer unrelated-record/); assert.doesNotMatch(p.text, /assisted answer exact-target/);}
  } finally {p.unmount();}
});

test('repository replacement supersedes an unresolved read and ignores its late result', async () => {
  const old = gate<readonly ListeningSessionRecord[]>(); const p = detail({list: () => old.promise}); try {p.update({repository: {listListeningSessions: async () => [other], deliverListeningSession: async () => {throw Error('unexpected export');}}}); await p.settle(); assertNoDetail(p); old.resolve([target]); await p.settle(); assertNoDetail(p); assert.equal(p.lateStateUpdates, 0);} finally {p.unmount();}
});

test('normal history still opens as a list, supports choosing/back, and accepts an optional initial selection', async () => {
  const p = setup(); try {await p.settle(); assert.match(p.html, /class="history-entry"/); assert.equal(p.findButton(labels.json), undefined); const rows = walk(p.tree).filter(node => node.props?.className === 'history-entry'); walk(rows[1]).find(node => node.type === 'button').props.onClick(); p.flush(); assert.match(p.text, /assisted answer exact-target/); p.click(labels.back); assert.match(p.html, /class="history-entry"/);} finally {p.unmount();}
  const selected = setup({props: {initialSessionId: target.sessionId}}); try {await selected.settle(); assert.match(selected.text, /assisted answer exact-target/); assert.ok(selected.findButton(labels.back));} finally {selected.unmount();}
});

test('ordinary list selection change fences a pending export', async () => {
  const held = gate(); const p = setup({props: {initialSessionId: target.sessionId}, deliver: async (_id, _expected, sink) => {await held.promise; sink();}}); try {await p.settle(); const staleExport = p.button(labels.json).props.onClick; p.click(labels.json); p.click(labels.back); staleExport(); held.resolve(); await p.settle(); assert.equal(p.deliveries.length, 1); assert.equal(p.downloads.length, 0); assert.match(p.html, /class="history-entry"/);} finally {p.unmount();}
});

test('unmount invalidates pending read success and failure without post-unmount state writes', async () => {
  for (const outcome of ['resolve', 'reject']) {const pending = gate<readonly ListeningSessionRecord[]>(), p = detail({list: () => pending.promise}); p.unmount(); if (outcome === 'resolve') pending.resolve([target]); else pending.reject(Error('late read failure')); await p.settle(); assert.equal(p.lateStateUpdates, 0); assert.equal(p.downloads.length, 0);}
});

test('an export delivery failure remains visible and a fresh refresh never keeps its stale wrapper', async () => {
  const p = detail({deliver: async () => {throw Error('The saved wrapper changed.');}}); try {await p.settle(); p.click(labels.json); await p.settle(); assert.match(p.text, /Export did not complete.*saved wrapper changed/); assert.equal(p.downloads.length, 0);
    const reread = gate<readonly ListeningSessionRecord[]>(); p.setList(() => reread.promise); p.click(labels.refresh); assertNoDetail(p); reread.reject(Error('revalidation failed')); await p.settle(); assertNoDetail(p); assert.match(p.text, /revalidation failed/); assert.equal(p.downloads.length, 0);
  } finally {p.unmount();}
});

test('late export rejection cannot replace the newly selected exact detail or its notice', async () => {
  const held = gate(); const p = detail({deliver: async (_id, _expected, sink) => {await held.promise; sink();}}); try {await p.settle(); p.click(labels.json); p.update({initialSessionId: other.sessionId}); await p.settle(); held.reject(Error('obsolete export failure')); await p.settle(); assert.match(p.text, /assisted answer unrelated-record/); assert.doesNotMatch(p.text, /obsolete export failure/); assert.equal(p.downloads.length, 0); assert.equal(p.button(labels.json).props.disabled, false);} finally {p.unmount();}
});
