import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecordingInputResources, RecordingPreparationCanceled } from './recording-input-resources.ts';

const track = () => ({ readyState: 'live', stops: 0, stop() { this.stops++; this.readyState = 'ended'; } });
const stream = (...tracks) => ({ getTracks: () => tracks });

test('release stops each owned live track once, including tracks shared by owned streams', () => {
  const inputs = new RecordingInputResources();
  const shared = track(), video = track(), alreadyEnded = track();
  alreadyEnded.stop();
  const first = stream(shared, video, alreadyEnded);
  assert.equal(inputs.ownStream(first), first);
  inputs.ownStream(first);
  inputs.ownStream(stream(shared));
  inputs.release(); inputs.release();
  assert.deepEqual([shared.stops, video.stops, alreadyEnded.stops], [1, 1, 1]);
  assert.throws(() => inputs.assertActive(), RecordingPreparationCanceled);
});

test('release runs cleanups in reverse order and continues after cleanup or track errors', () => {
  const inputs = new RecordingInputResources(), calls = [];
  const live = track();
  inputs.cleanup(() => calls.push('first'));
  inputs.cleanup(() => { calls.push('second'); throw Error('disconnected'); });
  inputs.cleanup(() => calls.push('third'));
  inputs.ownStream(stream({ readyState: 'live', stop() { throw Error('gone'); } }, live));
  inputs.release(); inputs.release();
  assert.deepEqual(calls, ['third', 'second', 'first']);
  assert.equal(live.stops, 1);
});

test('late microphone delivery is immediately stopped and cannot reactivate a canceled request', () => {
  const inputs = new RecordingInputResources(), mic = track(), extra = track();
  inputs.release();
  const late = stream(mic, extra);
  assert.throws(() => inputs.ownStream(late), RecordingPreparationCanceled);
  assert.throws(() => inputs.ownStream(late), RecordingPreparationCanceled);
  assert.deepEqual([mic.stops, extra.stops], [1, 1]);
  let disconnected = 0;
  assert.throws(() => inputs.cleanup(() => disconnected++), RecordingPreparationCanceled);
  inputs.release();
  assert.equal(disconnected, 1);
});

test('releasing canceled request A and its late stream never stops request B', () => {
  const a = new RecordingInputResources(), b = new RecordingInputResources();
  const earlyA = track(), lateA = track(), liveB = track();
  a.ownStream(stream(earlyA)); a.release();
  b.ownStream(stream(liveB));
  assert.throws(() => a.ownStream(stream(lateA)), RecordingPreparationCanceled);
  a.release(); b.assertActive();
  assert.deepEqual([earlyA.stops, lateA.stops, liveB.stops], [1, 1, 0]);
  b.release();
  assert.equal(liveB.stops, 1);
});
