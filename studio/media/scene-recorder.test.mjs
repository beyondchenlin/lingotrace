import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SceneRecorder } from './scene-recorder.ts';

const DAY = 86400000;
const tick = () => new Promise(resolve => setImmediate(resolve));
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
class FakeTrack extends EventTarget {
  constructor(kind) { super(); this.kind = kind; this.readyState = 'live'; this.stopCount = 0; }
  stop() { this.stopCount++; this.readyState = 'ended'; }
  interrupt() { this.readyState = 'ended'; this.dispatchEvent(new Event('ended')); }
}
class FakeStream {
  constructor(tracks = [new FakeTrack('video')]) { this.tracks = tracks; }
  getTracks() { return [...this.tracks]; }
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
}
class FakeRecorder extends EventTarget {
  static instances = [];
  static isTypeSupported(type) { return type.startsWith('video/webm'); }
  constructor(stream, options) {
    super(); this.stream = stream; this.options = options; this.mimeType = options.mimeType;
    this.state = 'inactive'; this.finalText = ''; this.emitStop = true; FakeRecorder.instances.push(this);
  }
  start(timeslice) { this.timeslice = timeslice; this.state = 'recording'; }
  data(text) {
    const event = new Event('dataavailable'); event.data = new Blob([text], { type: this.mimeType });
    this.dispatchEvent(event);
  }
  stop() {
    this.state = 'inactive';
    if (!this.emitStop) return;
    queueMicrotask(() => { this.data(this.finalText); this.dispatchEvent(new Event('stop')); });
  }
}
class FakeStore {
  records = new Map();
  chunks = new Map();
  appendCalls = [];
  removes = [];
  activeWrites = 0;
  maxActiveWrites = 0;
  closed = false;
  async open() { this.closed = false; }
  async probe() {}
  async list() { return [...this.records.values()].map(record => ({ ...record })); }
  async get(id) { return this.records.has(id) ? { ...this.records.get(id) } : null; }
  async create(meta) {
    await this.beforeCreate?.();
    this.records.set(meta.id, { ...meta }); this.chunks.set(meta.id, []); return { ...meta };
  }
  async update(id, mutate) {
    if (this.failUpdate) throw new DOMException('Quota full', 'QuotaExceededError');
    if (!this.records.has(id)) throw Error('Missing record');
    const next = mutate({ ...this.records.get(id) }); this.records.set(id, next); return { ...next };
  }
  async append(id, sequence, chunk, committedAt) {
    this.activeWrites++; this.maxActiveWrites = Math.max(this.maxActiveWrites, this.activeWrites);
    try {
      this.appendCalls.push(sequence);
      await this.beforeAppend?.(sequence);
      if (sequence === this.quotaAt) throw new DOMException('Quota full', 'QuotaExceededError');
      const data = await chunk.arrayBuffer();
      const old = this.records.get(id);
      assert.equal(old.status, 'recording'); assert.equal(old.chunkCount, sequence);
      const next = { ...old, bytes: old.bytes + data.byteLength, chunkCount: sequence + 1, lastCommittedAt: committedAt };
      this.chunks.get(id).push(data); this.records.set(id, next); return { ...next };
    } finally { this.activeWrites--; }
  }
  async remove(id, options = {}) {
    this.removes.push([id, options]);
    const row = this.records.get(id);
    if (!row) return false;
    if (options.expiredAt != null && row.status !== 'deleting' &&
      (row.retained || row.status === 'recording' || row.expiresAt == null || row.expiresAt > options.expiredAt)) return false;
    this.records.delete(id); this.chunks.delete(id); return true;
  }
  async readChunks(id, maxBytes) {
    const chunks = this.chunks.get(id) ?? [];
    assert.ok(chunks.reduce((total, chunk) => total + chunk.byteLength, 0) <= maxBytes);
    return chunks;
  }
  close() { this.closed = true; }
}
function setup(config = {}) {
  const store = new FakeStore();
  const recorder = new SceneRecorder({ store, recorderClass: FakeRecorder, locks: null,
    uuid: () => `record-${FakeRecorder.instances.length}`, finalizeTimeoutMs: 50, ...config });
  return { store, recorder };
}
const start = async (recorder, stream = new FakeStream(), audioLabel = '无音频') => {
  await recorder.start(stream, { audioLabel, source: 'canvas-composite' });
  return { stream, media: FakeRecorder.instances.at(-1) };
};

test('final data is drained serially before tracks are released; exporting never pins', async () => {
  const { recorder, store } = setup();
  const independentCamera = new FakeTrack('video');
  await recorder.prepare();
  const { stream, media } = await start(recorder, new FakeStream([new FakeTrack('video'), new FakeTrack('audio')]), '课程音频');
  assert.equal(media.timeslice, 1000);
  assert.equal(recorder.getSnapshot().audioLabel, '课程音频');
  const hold = gate(); store.beforeAppend = () => hold.promise;
  media.data('first'); media.finalText = '-last';
  const stopped = recorder.stop();
  await tick();
  assert.equal(recorder.getSnapshot().state, 'stopping');
  assert.equal(recorder.getSnapshot().bytes, 0);
  assert.ok(stream.getTracks().every(track => track.readyState === 'live'));
  hold.release();
  const metadata = await stopped;
  assert.equal(metadata.bytes, 10); assert.equal(metadata.chunkCount, 2); assert.equal(metadata.complete, true);
  assert.equal(metadata.source, 'canvas-composite'); assert.equal(metadata.captureSource, 'canvas-composite');
  assert.equal(store.maxActiveWrites, 1); assert.deepEqual(store.appendCalls, [0, 1]);
  assert.ok(stream.getTracks().every(track => track.stopCount === 1));
  assert.equal(independentCamera.stopCount, 0);
  assert.equal(await (await recorder.blob(metadata.id)).text(), 'first-last');
  assert.equal((await store.get(metadata.id)).retained, false);
  assert.equal(metadata.expiresAt - metadata.endedAt, 7 * DAY);
  assert.equal(recorder.getSnapshot().state, 'saved');
  assert.match(recorder.getSnapshot().warning, /Web Locks/);
  assert.deepEqual(await recorder.stop(), metadata);
  await recorder.dispose();
});

test('queue overflow preserves accepted chunks, discards excess, marks incomplete', async () => {
  const { recorder, store } = setup({ maxPendingBytes: 4 });
  await recorder.prepare(); const { media, stream } = await start(recorder);
  const hold = gate(); store.beforeAppend = () => hold.promise;
  media.data('1234'); media.data('5');
  assert.equal(recorder.getSnapshot().error.code, 'WRITE_BACKLOG');
  const finished = recorder.stop(); hold.release();
  const metadata = await finished;
  assert.equal(metadata.bytes, 4); assert.equal(metadata.complete, false); assert.equal(metadata.status, 'incomplete');
  assert.equal(recorder.getSnapshot().state, 'error');
  assert.ok(stream.getTracks().every(track => track.stopCount === 1));
  await recorder.dispose();
});

test('quota failure preserves committed bytes and prevents later queue writes', async () => {
  const { recorder, store } = setup();
  await recorder.prepare(); const { media } = await start(recorder);
  media.data('saved'); await tick();
  store.quotaAt = 1; media.data('bad'); media.data('later');
  const metadata = await recorder.stop();
  assert.equal(metadata.bytes, 5); assert.equal(metadata.chunkCount, 1); assert.equal(metadata.complete, false);
  assert.deepEqual(store.appendCalls, [0, 1]);
  assert.equal(recorder.getSnapshot().error.code, 'QuotaExceededError');
  assert.equal(await (await recorder.blob(metadata.id)).text(), 'saved');
  await recorder.dispose();
});

test('size boundary stops automatically; an extra final chunk is incomplete', async () => {
  const { recorder } = setup({ maxExportBytes: 4 });
  await recorder.prepare(); const { media } = await start(recorder);
  media.finalText = 'x'; media.data('1234');
  const metadata = await recorder.stop();
  assert.equal(metadata.bytes, 4); assert.equal(metadata.complete, false);
  assert.equal(recorder.getSnapshot().error.code, 'SIZE_LIMIT');
  assert.match(recorder.getSnapshot().warning, /Web Locks/);
  await recorder.dispose();
});

test('duration boundary includes final chunk without an error', async () => {
  const { recorder } = setup({ maxDurationMs: 5 });
  await recorder.prepare(); const { media } = await start(recorder);
  media.finalText = 'final';
  await new Promise(resolve => setTimeout(resolve, 15));
  const metadata = await recorder.stop();
  assert.equal(metadata.complete, true); assert.equal(metadata.stopReason, '达到时长上限');
  await recorder.dispose();
});

test('missing stop event times out, releases owned tracks and leaves committed data incomplete', async () => {
  const { recorder } = setup({ finalizeTimeoutMs: 5 });
  await recorder.prepare(); const { media, stream } = await start(recorder);
  media.data('saved'); media.emitStop = false;
  const metadata = await recorder.stop();
  assert.equal(metadata.bytes, 5); assert.equal(metadata.complete, false);
  assert.equal(recorder.getSnapshot().error.code, 'FINALIZE_TIMEOUT');
  assert.ok(stream.getTracks().every(track => track.stopCount === 1));
  await recorder.dispose();
});

test('prepare recovers interrupted rows; list cleanup respects pins and adapter remove options', async () => {
  let now = 20 * DAY;
  const { recorder, store } = setup({ now: () => now });
  const base = { status: 'complete', complete: true, retained: false, startedAt: DAY,
    endedAt: DAY, lastCommittedAt: DAY, expiresAt: 8 * DAY, bytes: 3, chunkCount: 1,
    mimeType: 'video/webm', extension: 'webm', captureSource: 'canvas-composite', audioLabel: '无音频', stopReason: null };
  for (const record of [{ ...base, id: 'expired' }, { ...base, id: 'pinned', retained: true },
    { ...base, id: 'unfinished', status: 'recording', startedAt: 19 * DAY, lastCommittedAt: 19 * DAY,
      expiresAt: null, endedAt: null, complete: false }]) store.records.set(record.id, record);
  await recorder.prepare();
  assert.equal(await store.get('expired'), null);
  assert.ok(await store.get('pinned'));
  const recovered = await store.get('unfinished');
  assert.equal(recovered.status, 'interrupted'); assert.equal(recovered.expiresAt, 26 * DAY);
  assert.deepEqual(store.removes[0], ['expired', { expiredAt: 20 * DAY }]);
  await recorder.retain('pinned', false);
  now = 27 * DAY;
  assert.deepEqual(await recorder.list(), []);
  await recorder.dispose();
});

test('metadata finalization failure is explicit and recoverable on next prepare', async () => {
  const { recorder, store } = setup();
  await recorder.prepare(); const { media } = await start(recorder);
  media.data('saved'); await tick(); store.failUpdate = true;
  const metadata = await recorder.stop();
  assert.equal(metadata.metadataFinalizationFailed, true); assert.equal(metadata.complete, false);
  assert.equal((await store.get(metadata.id)).status, 'recording');
  await recorder.dispose();
  store.failUpdate = false;
  const retry = new SceneRecorder({ store, recorderClass: FakeRecorder, locks: null });
  await retry.prepare();
  assert.equal((await store.get(metadata.id)).status, 'interrupted');
  await retry.dispose();
});

test('stop during metadata creation waits for recovery and releases stream without starting encoder', async () => {
  const { recorder, store } = setup();
  await recorder.prepare(); const hold = gate(); store.beforeCreate = () => hold.promise;
  const stream = new FakeStream();
  const started = recorder.start(stream, { source: 'canvas-composite', audioLabel: '无音频' });
  const rejected = assert.rejects(started, { code: 'START_INTERRUPTED' });
  const stopped = recorder.stop(); hold.release();
  await rejected; const metadata = await stopped;
  assert.equal(metadata.complete, false); assert.equal(metadata.bytes, 0);
  assert.equal(FakeRecorder.instances.at(-1).state, 'inactive');
  assert.equal(stream.getTracks()[0].stopCount, 1);
  await recorder.dispose();
});

test('Web Lock guard prevents another instance recovery until disposal', async () => {
  let held = false;
  const locks = { async request(name, options, callback) {
    assert.equal(name, 'shared-db:capture-controller'); assert.equal(options.ifAvailable, true);
    if (held) return callback(null);
    held = true; try { return await callback({ name }); } finally { held = false; }
  } };
  const { recorder: first } = setup({ locks, dbName: 'shared-db' });
  const { recorder: second } = setup({ locks, dbName: 'shared-db' });
  await first.prepare();
  assert.equal(first.getSnapshot().warning, null);
  await assert.rejects(second.prepare(), { code: 'ANOTHER_TAB' });
  await first.dispose(); await second.prepare(); await second.dispose();
});

test('snapshot is stable between updates; active removal is blocked; no default audio', async () => {
  const { recorder, store } = setup();
  let updates = 0; const unsubscribe = recorder.subscribe(() => { updates++; });
  const snapshot = recorder.getSnapshot(); assert.equal(snapshot, recorder.getSnapshot()); assert.ok(Object.isFrozen(snapshot));
  await recorder.prepare(); const { media } = await start(recorder, new FakeStream(), '课程音频');
  assert.equal(recorder.getSnapshot().audioLabel, '无音频');
  assert.equal(media.options.audioBitsPerSecond, undefined);
  const id = recorder.getSnapshot().recordingId;
  await assert.rejects(recorder.remove(id), { code: 'RECORDING_ACTIVE' });
  media.data('okay'); const metadata = await recorder.stop();
  await recorder.retain(metadata.id, true); assert.equal((await store.get(id)).retained, true);
  assert.equal(await recorder.remove(id), true); assert.equal(await recorder.remove(id), false);
  assert.ok(updates > 1); unsubscribe(); await recorder.dispose();
});

test('track interruptions mark incomplete and dispose drains a recording', async () => {
  const { recorder } = setup();
  await recorder.prepare(); const { media, stream } = await start(recorder);
  media.data('bytes'); stream.getTracks()[0].interrupt();
  const metadata = await recorder.stop();
  assert.equal(metadata.complete, false); assert.equal(recorder.getSnapshot().error.code, 'SOURCE_INTERRUPTED');
  const next = await start(recorder); next.media.data('second');
  await recorder.dispose();
  assert.equal(recorder.getSnapshot().state, 'saved');
  assert.equal(next.stream.getTracks()[0].stopCount, 1);
  assert.throws(() => recorder.prepare(), { code: 'DISPOSED' });
});
