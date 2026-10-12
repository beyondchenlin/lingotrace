import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import CheckedAnswerReview from '../components/CheckedAnswerReview';
import {TrainingEngine,getDraft} from '../core/training';
import {getDraftFeedback} from '../core/draft-feedback';
import {readFile} from 'node:fs/promises';
test('checked difference surface exposes wrong and missing labels without changing the attempt',()=>{
 const e=new TrainingEngine();e.input('wrong');const attempt=e.submit()!,before=JSON.stringify(e.getSnapshot());
 const html=renderToStaticMarkup(React.createElement(CheckedAnswerReview,{attempt}));
 assert.match(html,/Review differences/);assert.match(html,/Errors:/);assert.ok(html.includes('Wrong:')||html.includes('Extra:'));assert.ok(html.includes('Missing:'));assert.ok(html.includes('class="missing"'));assert.equal(JSON.stringify(e.getSnapshot()),before);
});
test('main review entry is bound to the exact checked snapshot draft, not a previous result',async()=>{
 const e=new TrainingEngine();assert.equal(getDraftFeedback(e.getSnapshot(),e.draft).attempt,null);e.input('wrong');e.submit();assert.ok(getDraftFeedback(e.getSnapshot(),e.draft).attempt);e.input('edited');assert.equal(getDraftFeedback(e.getSnapshot(),getDraft(e.getSnapshot()).text).attempt,null);
 const source=await readFile(new URL('../components/Studio.tsx',import.meta.url),'utf8');assert.match(source,/const checkedReview=reviewSnapshot\?getDraftFeedback\(reviewSnapshot,getDraft\(reviewSnapshot\)\.text\)\.attempt:null/);assert.match(source,/checkedReview&&<CheckedAnswerReview attempt=\{checkedReview\}/);
});
