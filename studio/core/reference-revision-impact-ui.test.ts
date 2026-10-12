import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {translate, translateKnownUi, type StudioLocale} from '../i18n/locale';
import {CAFE_MATERIAL, TrainingEngine} from './training';
import {buildLocalReferenceProposal, LOCAL_REFERENCE_MEDIA_ID, LOCAL_REFERENCE_MEDIA_SHA256, type LocalReferenceMaterial} from './local-reference';
import type {LocalReferenceList} from './local-reference-repository';
import * as impactModule from './reference-revision-impact';

const require = createRequire(import.meta.url), swc = require('next/dist/build/swc'); await swc.loadBindings();
const source = await readFile(new URL('../components/HistoryReferenceImpact.tsx', import.meta.url), 'utf8');
const {code} = await swc.transform(source, {jsc: {parser: {syntax: 'typescript', tsx: true}, transform: {react: {runtime: 'automatic'}}, target: 'es2022'}, module: {type: 'commonjs'}});
const panelSource = await readFile(new URL('../components/LegacyHistoryPanel.tsx', import.meta.url), 'utf8');
const {code: panelCode} = await swc.transform(panelSource, {jsc: {parser: {syntax: 'typescript', tsx: true}, transform: {react: {runtime: 'automatic'}}, target: 'es2022'}, module: {type: 'commonjs'}});
const media = {id: LOCAL_REFERENCE_MEDIA_ID, sha256: LOCAL_REFERENCE_MEDIA_SHA256, durationSeconds: 72};
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function localeContext(locale: StudioLocale) {return {locale, t: (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate(locale, key, params), ui: (message: string) => translateKnownUi(locale, message)};}
function harness(repository: impactModule.ReferenceRevisionImpactAccess, locale: StudioLocale = 'en') {
  const states: any[] = [], memos: {deps: unknown[]; value: any}[] = [], effects: {deps: unknown[]; fn: () => void | (() => void); cleanup?: () => void}[] = [];
  let stateIndex = 0, memoIndex = 0, effectIndex = 0, material = CAFE_MATERIAL as LocalReferenceMaterial;
  const queued = new Set<number>(), windowTarget = new EventTarget(), documentTarget = Object.assign(new EventTarget(), {hidden: false});
  const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((value, index) => value === b[index]);
  const hooks = {...React,
    useState: (initial: any) => {const index = stateIndex++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], (value: any) => {states[index] = typeof value === 'function' ? value(states[index]) : value;}];},
    useMemo: (fn: () => unknown, deps: unknown[]) => {const index = memoIndex++; if (!memos[index] || !same(memos[index].deps, deps)) memos[index] = {deps, value: fn()}; return memos[index].value;},
    useLayoutEffect: (fn: () => void | (() => void), deps: unknown[]) => {const index = effectIndex++; if (!effects[index] || !same(effects[index].deps, deps)) {effects[index]?.cleanup?.(); effects[index] = {deps, fn}; queued.add(index);}},
  };
  const exports: Record<string, any> = {};
  vm.runInNewContext(code, {exports, window: windowTarget, document: documentTarget, require: (name: string) => name === 'react' ? hooks : name === '../i18n/react' ? {useStudioLocale: () => localeContext(locale)} : name.includes('reference-revision-impact') ? impactModule : require(name)});
  const render = () => {stateIndex = memoIndex = effectIndex = 0; return exports.default({repository, material});};
  const html = () => renderToStaticMarkup(render());
  return {html, render, setMaterial: (next: LocalReferenceMaterial) => {material = next;}, flush: () => {for (const index of queued) {const cleanup = effects[index].fn(); effects[index].cleanup = typeof cleanup === 'function' ? cleanup : undefined;} queued.clear();},
    unmount: () => {for (const effect of effects) effect.cleanup?.();}, windowTarget, documentTarget,
    ready: async () => {for (let index = 0; index < 100; index++) {if (/data-reference-revision-status="(ready|unavailable)"/.test(html())) return; await tick();} throw Error('View did not settle');},
  };
}
function nodes(node: any, type: any): any[] {if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(item => nodes(item, type)); return [...(node.type === type ? [node] : []), ...nodes(node.props?.children, type)];}
async function revision() {return buildLocalReferenceProposal({original: CAFE_MATERIAL, parent: CAFE_MATERIAL, editedCueId: CAFE_MATERIAL.cues[1].id, text: 'Secret replacement text never shown in history.', start: 6.1, end: 12, media, saveRequestId: 'safe-history-notice'});}

test('actual impact component is render-inert, localized and shows affected sentence numbers without corrected text', async () => {
  const row = await revision();
  for (const locale of ['en', 'zh-CN'] as const) {
    let reads = 0;
    const view = harness({list: async () => {reads++; return {entries: [row], unreadableCount: 0};}, subscribe: () => () => {}}, locale);
    assert.equal(view.html().includes('safe-history-notice'), false); assert.equal(reads, 0);
    view.flush(); await view.ready(); const html = view.html();
    assert.match(html, /safe-history-notice/); assert.match(html, locale === 'en' ? /Direct revision/ : /直接修订/);
    assert.match(html, locale === 'en' ? /Reference text and timing changed/ : /参考文字和起止时间已修订/);
    assert.match(html, locale === 'en' ? /saved record: 2/ : /第 2 句/); assert.doesNotMatch(html, /Secret replacement text|Would you like it/);
    view.unmount();
  }
});

test('no-match, partial and failed actual UI remain unknown, and retry only rereads references', async () => {
  let reads = 0;
  const view = harness({list: async () => {reads++; if (reads === 1) throw Error('sensitive raw failure'); return {entries: [], unreadableCount: 3};}, subscribe: () => () => {}});
  view.html(); view.flush(); await view.ready();
  assert.match(view.html(), /Revision impact is unknown/); assert.doesNotMatch(view.html(), /sensitive raw failure/);
  const retry = nodes(view.render(), 'button')[0]; assert.equal(retry.props.disabled, false); retry.props.onClick(); await view.ready();
  assert.equal(reads, 2); assert.match(view.html(), /3 local reference records could not be verified/); assert.match(view.html(), /does not establish that the reference was never changed/);
  view.unmount();
});

test('material navigation immediately hides old notices and ignores a late read after unmount', async () => {
  const row = await revision(); let resolve: ((value: LocalReferenceList) => void) | undefined, unsubscribed = 0, reads = 0;
  const view = harness({list: async () => {reads++; if (reads === 1) return {entries: [row], unreadableCount: 0}; return new Promise(done => {resolve = done;});}, subscribe: () => () => {unsubscribed++;}});
  view.html(); view.flush(); await view.ready(); assert.match(view.html(), /safe-history-notice/);
  view.setMaterial({...CAFE_MATERIAL, title: 'Different full identity'}); assert.doesNotMatch(view.html(), /safe-history-notice/); view.flush(); view.unmount();
  resolve?.({entries: [row], unreadableCount: 0}); await tick(); assert.doesNotMatch(view.html(), /safe-history-notice/); assert.equal(unsubscribed, 2);
});

test('focus and visible-page refresh revalidate notices; removed listeners do not reread after unmount', async () => {
  let reads = 0;
  const view = harness({list: async () => {reads++; return {entries: [], unreadableCount: 0};}, subscribe: () => () => {}});
  view.html(); view.flush(); await view.ready(); assert.equal(reads, 1);
  view.windowTarget.dispatchEvent(new Event('focus')); await view.ready(); assert.equal(reads, 2);
  view.documentTarget.hidden = true; view.documentTarget.dispatchEvent(new Event('visibilitychange')); assert.equal(reads, 2);
  view.documentTarget.hidden = false; view.documentTarget.dispatchEvent(new Event('visibilitychange')); await view.ready(); assert.equal(reads, 3);
  view.unmount(); view.windowTarget.dispatchEvent(new Event('focus')); view.documentTarget.dispatchEvent(new Event('visibilitychange')); assert.equal(reads, 3);
});

test('actual history panel passes only saved material and read-only reference capability to the separate notice', () => {
  const snapshot = new TrainingEngine({sessionId: 'saved-history'}).getSnapshot();
  const state = {list: null, selected: {snapshot, summary: {materialTitle: 'History', createdAt: snapshot.createdAt, schemaVersion: snapshot.schemaVersion, materialVersion: snapshot.material.version, ruleVersions: []}}, loading: false, downloading: false, paging: false, page: 1, error: null, canRetry: false};
  class Reader {getSnapshot = () => state;}
  const exports: Record<string, any> = {}, component = 'reference-impact-probe';
  vm.runInNewContext(panelCode, {exports, require: (name: string) => name === '../i18n/react' ? {useStudioLocale: () => localeContext('en')} : name === 'react' ? {...React, useState: (value: any) => [typeof value === 'function' ? value() : value, () => {}], useLayoutEffect: () => {}, useMemo: (fn: () => unknown) => fn()} : name.includes('legacy-history-reader') ? {LegacyHistoryReader: Reader, supportsLegacyHistoryExport: () => true} : name.includes('input-rate-timeline') ? {deriveInputRateTimeline: () => ({})} : name === './HistoryReferenceImpact' ? {__esModule: true, default: component} : name.startsWith('./') ? {__esModule: true, default: () => null} : require(name)});
  const referenceRepository = {list: async () => ({entries: [], unreadableCount: 0}), subscribe: () => () => {}};
  const props = {repository: {}, currentSessionId: null, download: () => {throw Error('No export');}, referenceRepository};
  const rendered = exports.default(props), notices = nodes(rendered, component);
  assert.equal(notices.length, 1); assert.equal(notices[0].props.material, snapshot.material); assert.equal(notices[0].props.repository, referenceRepository);
  assert.deepEqual(Object.keys(notices[0].props).sort(), ['material', 'repository']);
  assert.equal(nodes(exports.default({...props, referenceRepository: undefined}), component).length, 0);
});
