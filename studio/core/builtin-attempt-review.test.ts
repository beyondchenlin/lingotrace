import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TrainingEngine, SCHEMA_VERSION } from './training.ts';
import { BUILTIN_TRAINING_SCHEMA, NPS_MATERIAL } from './builtin-material.ts';
import { readLegacyHistoryRecord } from './legacy-history.ts';
import { projectLegacyAttemptReview } from './legacy-attempt-review.ts';
import LegacyAttemptReview from '../components/LegacyAttemptReview';

function fixture() {
  let id = 0;
  const engine = new TrainingEngine({ material: NPS_MATERIAL, sessionId: 'nps-review-test', clock: { now: () => 0, wallTime: () => '2026-10-10T00:00:00.000Z', id: () => `nps-review-${++id}` } });
  engine.input('Hi, someone.'); engine.submit();
  const snapshot = structuredClone(engine.getSnapshot()) as any;
  snapshot.attempts[0].ruleVersion = 'historical-nps-rule';
  snapshot.attempts[0].accuracy = 13; snapshot.attempts[0].errors = 19; snapshot.attempts[0].gain = 7; snapshot.earnedWords = 72;
  return { snapshot, attempt: snapshot.attempts[0] };
}

test('NPS saved attempt drill-down retains source text, interval and historical alignment without rescoring', () => {
  const f = fixture(), saved = readLegacyHistoryRecord({ sessionId: f.snapshot.sessionId, sequence: f.snapshot.sequence, snapshot: f.snapshot, updatedAt: f.snapshot.createdAt });
  const before = JSON.stringify(saved), review = projectLegacyAttemptReview(saved.snapshot, saved.snapshot.attempts[0]);
  assert.equal(saved.snapshot.schemaVersion, BUILTIN_TRAINING_SCHEMA);
  assert.equal(review.reference, NPS_MATERIAL.cues[0].text); assert.equal(review.answer, 'Hi, someone.');
  assert.equal(review.materialId, NPS_MATERIAL.id); assert.equal(review.materialVersion, NPS_MATERIAL.version);
  assert.equal(review.ruleVersion, 'historical-nps-rule'); assert.equal(review.alignment.status, 'saved'); assert.deepEqual(review.issues, []);
  assert.deepEqual(review.cueInterval, { start: 0.77, end: 1.53 });
  assert.deepEqual(review.alignment.tokens.map(token => token.status === 'saved' ? { kind: token.kind, position: token.position, expected: token.expected, actual: token.actual } : null), saved.snapshot.attempts[0].alignment);
  assert.equal(saved.snapshot.attempts[0].accuracy, 13); assert.equal(saved.snapshot.attempts[0].errors, 19); assert.equal(saved.snapshot.attempts[0].gain, 7); assert.equal(saved.snapshot.earnedWords, 72);
  assert.equal(JSON.stringify(saved), before);
  const rendered = renderToStaticMarkup(createElement(LegacyAttemptReview, { snapshot: saved.snapshot, attempt: saved.snapshot.attempts[0] }));
  assert.ok(rendered.includes('Hi, everybody.')); assert.ok(rendered.includes('Hi, someone.')); assert.ok(rendered.includes('historical-nps-rule'));
  assert.ok(rendered.includes('0.77s to 1.53s')); assert.ok(rendered.includes('has not loaded and verified the original media'));
  assert.doesNotMatch(rendered, /legacy Training v1 record lacks|<video|<audio|<button|<iframe|<a\s/);
});

test('NPS drill-down refuses missing, altered and downgraded source bindings while retaining readable saved text', () => {
  const edits: ((s: any) => void)[] = [
    s => { delete s.material.builtinReference; }, s => { s.material.builtinReference.media.sha256 = '0'.repeat(64); },
    s => { s.material.builtinReference.sentenceMapSha256 = '0'.repeat(64); }, s => { s.material.cues[0].end = 7; },
    s => { s.schemaVersion = SCHEMA_VERSION; }, s => { s.schemaVersion = 'unknown-profile'; },
    s => { s.events[1].schemaVersion = SCHEMA_VERSION; }, s => { s.events[0].material = structuredClone(s.material); delete s.events[0].material.builtinReference; },
    s => { s.events[0].materialId = 'cafe-original'; }, s => { s.events = []; },
  ];
  for (const edit of edits) {
    const { snapshot, attempt } = fixture(); edit(snapshot);
    const before = JSON.stringify(snapshot), review = projectLegacyAttemptReview(snapshot, attempt);
    assert.equal(review.reference, 'Hi, everybody.'); assert.equal(review.answer, 'Hi, someone.');
    assert.equal(review.alignment.status, 'unavailable'); assert.equal(review.cueInterval, null); assert.ok(review.issues.length > 0);
    assert.equal(JSON.stringify(snapshot), before);
  }
});

test('NPS source and event accessors are never executed by defensive display admission', () => {
  for (const target of ['binding', 'events', 'eventSchema'] as const) {
    const { snapshot, attempt } = fixture(); let invoked = false;
    const getter = { get() { invoked = true; throw new Error('Untrusted getter'); } };
    if (target === 'binding') Object.defineProperty(snapshot.material, 'builtinReference', getter);
    else if (target === 'events') Object.defineProperty(snapshot, 'events', getter);
    else Object.defineProperty(snapshot.events[1], 'schemaVersion', getter);
    const review = projectLegacyAttemptReview(snapshot, attempt);
    assert.equal(invoked, false); assert.equal(review.alignment.status, 'unavailable');
    assert.equal(review.reference, attempt.reference); assert.equal(review.answer, attempt.answer);
  }
});
