import {translate,translateKnownUi} from '../i18n/locale';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ReviewDueTimeInput from '../components/ReviewDueTimeInput';
import * as dueTime from './review-due-time';
import type {ReviewDueTimeInputProps} from '../components/ReviewDueTimeInput';
const require = createRequire(import.meta.url), swc = require('next/dist/build/swc');
await swc.loadBindings();
const source = await readFile(new URL('../components/ReviewDueTimeInput.tsx', import.meta.url), 'utf8');
const {code} = await swc.transform(source, {jsc: {parser: {syntax: 'typescript', tsx: true}, transform: {react: {runtime: 'automatic'}}, target: 'es2022'}, module: {type: 'commonjs'}});

/** Exercise actual component handlers and effects, without adding a DOM/test dependency. */
function mount(initial: Partial<ReviewDueTimeInputProps> = {}) {
  const output: (dueTime.ReviewDueTime | null)[] = [];
  let props: ReviewDueTimeInputProps = {value: null, onChange(value) {output.push(value); props = {...props, value};}, ...initial};
  const states: any[] = [], refs: any[] = [], memos: any[] = [], effectDeps: any[] = [];
  let si = 0, ri = 0, mi = 0, ei = 0, changed = false;
  let effects: (() => void)[] = [];
  const equal = (left: any[] | undefined, right: any[]) => !!left && left.length === right.length && left.every((item, i) => Object.is(item, right[i]));
  const exports: any = {};
  const context = vm.createContext({exports, Date, Intl, Error, require: (name: string) => name === '../i18n/react' ? {useStudioLocale: () => ({locale: 'zh-CN', t: (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('zh-CN', key, params), ui: (message: string) => translateKnownUi('zh-CN', message)})} : name === 'react' ? {...React,
    useId: () => 'due-test',
    useState: (initialValue: any) => {const index = si++; if (!(index in states)) states[index] = typeof initialValue === 'function' ? initialValue() : initialValue; return [states[index], (value: any) => {const next = typeof value === 'function' ? value(states[index]) : value; if (!Object.is(states[index], next)) {states[index] = next; changed = true;}}];},
    useRef: (initialValue: any) => {const index = ri++; return refs[index] ??= {current: initialValue};},
    useMemo: (fn: () => any, deps: any[]) => {const index = mi++; if (!memos[index] || !equal(memos[index].deps, deps)) memos[index] = {deps, value: fn()}; return memos[index].value;},
    useEffect: (fn: () => void, deps: any[]) => {const index = ei++; if (!equal(effectDeps[index], deps)) {effectDeps[index] = deps; effects.push(fn);}},
  } : name.includes('review-due-time') ? dueTime : require(name)});
  vm.runInContext(code, context);
  let element: any, nodes: any[] = [];
  function render() {
    let attempts = 0;
    do {
      assert.ok(++attempts < 10, 'effects should settle');
      si = ri = mi = ei = 0; changed = false; effects = [];
      element = exports.default(props);
      for (const effect of effects) effect();
    } while (changed);
    nodes = [];
    function walk(node: any) {if (!node || typeof node !== 'object') return; if (Array.isArray(node)) {node.forEach(walk); return;} nodes.push(node); walk(node.props?.children);}
    walk(element);
  }
  render();
  return {
    output,
    html: () => renderToStaticMarkup(element),
    inputs: () => nodes.filter(node => node.type === 'input'),
    radios: () => nodes.filter(node => node.type === 'input' && node.props.type === 'radio'),
    edit(type: 'datetime-local' | 'text', value: string) {nodes.find(node => node.type === 'input' && node.props.type === type).props.onChange({target: {value}}); render();},
    choose(index: number) {nodes.filter(node => node.type === 'input' && node.props.type === 'radio')[index].props.onChange(); render();},
    clear() {nodes.find(node => node.type === 'button').props.onClick(); render();},
    setProps(next: Partial<ReviewDueTimeInputProps>) {props = {...props, ...next}; render();},
  };
}

test('SSR starts without a chosen date or output, keeps UTC explicit and never preselects tomorrow', () => {
  let changes = 0;
  const html = renderToStaticMarkup(React.createElement(ReviewDueTimeInput, {value: null, onChange() {changes++;}}));
  assert.equal(changes, 0); assert.ok(html.includes(translate('en', 'reviewDue.unselected'))); assert.match(html, /value="UTC"/);
  assert.match(html, /type="datetime-local"[^>]+value=""/); assert.doesNotMatch(html, /明天|今天|下周|24 小时/);
  assert.doesNotMatch(source, /localStorage|indexedDB|TrainingEngine|saveSession|setDate\(|setHours\(/);
});

test('actual user input emits only a complete matching date/zone/offset and timezone edits change the instant', () => {
  const view = mount(); assert.equal(view.output.length, 0);
  view.edit('datetime-local', '2026-10-10T12:34');
  assert.deepEqual(view.output.at(-1), {instant: '2026-10-10T12:34:00.000Z', localTime: '2026-10-10T12:34', timeZone: 'UTC', offsetMinutes: 0});
  view.edit('text', 'Asia/Shanghai');
  assert.deepEqual(view.output.at(-1), {instant: '2026-10-10T04:34:00.000Z', localTime: '2026-10-10T12:34', timeZone: 'Asia/Shanghai', offsetMinutes: 480});
  assert.match(view.html(), /Asia\/Shanghai · UTC\+08:00/);
  view.edit('text', 'UTC'); assert.equal(view.output.at(-1)?.instant, '2026-10-10T12:34:00.000Z');
});

test('gap and invalid input clear previous valid output and explain why without normalizing', () => {
  const view = mount(); view.edit('text', 'America/Los_Angeles'); view.edit('datetime-local', '2026-03-08T01:30');
  assert.ok(view.output.at(-1));
  view.edit('datetime-local', '2026-03-08T02:30'); assert.equal(view.output.at(-1), null);
  assert.match(view.html(), /时钟跳过/); assert.match(view.html(), /不会自动顺延/);
  assert.equal(view.inputs()[0].props.value, '2026-03-08T02:30');
  view.edit('datetime-local', '2026-02-29T12:30'); assert.equal(view.output.at(-1), null); assert.match(view.html(), /闰年/);
  view.edit('datetime-local', '2026-03-09T12:30'); view.edit('text', 'Mars/Unknown');
  assert.equal(view.output.at(-1), null); assert.match(view.html(), /不支持所填 IANA 时区/);
  assert.equal(view.inputs()[1].props.value, 'Mars/Unknown');
});

test('fold requires explicit offset selection, retains it on controlled echo and invalidates it on edits', () => {
  const view = mount(); view.edit('text', 'America/Los_Angeles'); view.edit('datetime-local', '2026-11-01T01:30');
  assert.equal(view.output.at(-1), null); assert.equal(view.radios().length, 2);
  assert.ok(view.radios().every(radio => !radio.props.checked));
  assert.match(view.html(), /UTC-07:00/); assert.match(view.html(), /UTC-08:00/); assert.match(view.html(), /尚未选择 UTC 偏移/);
  view.choose(1); assert.equal(view.output.at(-1)?.instant, '2026-11-01T09:30:00.000Z');
  assert.equal(view.radios()[1].props.checked, true);
  view.edit('datetime-local', '2026-11-01T01:45'); assert.equal(view.output.at(-1), null);
  assert.ok(view.radios().every(radio => !radio.props.checked));
  view.choose(0); assert.equal(view.output.at(-1)?.offsetMinutes, -420);
  view.edit('text', 'UTC'); assert.equal(view.output.at(-1)?.instant, '2026-11-01T01:45:00.000Z');
});

test('past times are valid and explicitly described as due, while clear removes only the date', () => {
  const view = mount(); view.edit('text', 'Asia/Shanghai'); view.edit('datetime-local', '2000-02-29T12:00');
  assert.ok(view.output.at(-1)); assert.match(view.html(), /已到期，仍可按此时间保存/);
  view.clear(); assert.equal(view.output.at(-1), null); assert.equal(view.inputs()[0].props.value, '');
  assert.equal(view.inputs()[1].props.value, 'Asia/Shanghai'); assert.match(view.html(), /尚未选择到期日期和时间/);
});

test('external value reload and reset update the control without emitting or losing a known fold choice', () => {
  const value = dueTime.resolveReviewLocalTime('2026-11-01T01:30', 'America/Los_Angeles')[1];
  const view = mount({value}); assert.equal(view.output.length, 0); assert.equal(view.radios()[1].props.checked, true);
  const updated = dueTime.resolveReviewLocalTime('2027-01-01T12:00', 'Asia/Shanghai')[0];
  view.setProps({value: updated}); assert.equal(view.output.length, 0);
  assert.equal(view.inputs()[0].props.value, updated.localTime); assert.equal(view.inputs()[1].props.value, updated.timeZone);
  view.setProps({value: null}); assert.equal(view.inputs()[0].props.value, ''); assert.equal(view.output.length, 0);
});

test('disabled fieldset blocks all actual handlers, supports accessible custom label and does not change output', () => {
  const value = dueTime.resolveReviewLocalTime('2026-11-01T01:30', 'America/Los_Angeles')[0];
  const view = mount({value, disabled: true, label: '下一次明确到期时间'});
  assert.match(view.html(), /fieldset disabled=""/); assert.match(view.html(), /下一次明确到期时间/);
  assert.match(view.html(), /aria-live="polite"/);
  view.edit('datetime-local', '2027-01-01T12:00'); view.edit('text', 'UTC'); view.choose(1); view.clear();
  assert.equal(view.output.length, 0); assert.equal(view.inputs()[0].props.value, value.localTime);
  assert.equal(view.radios()[0].props.checked, true);
});
