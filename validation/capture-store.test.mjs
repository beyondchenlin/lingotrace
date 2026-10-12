import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptureController, IndexedDBRecordingStore, CAPTURE_DEFAULTS, recordingExtension } from '../dist/hud/capture-store.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const later = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
class Track extends EventTarget {
  constructor(kind, surface) { super(); this.kind = kind; this.surface = surface; this.readyState = 'live'; this.stops = 0; }
  stop() { this.readyState = 'ended'; this.stops++; }
  end() { this.readyState = 'ended'; this.dispatchEvent(new Event('ended')); }
  getSettings() { return { displaySurface: this.surface }; }
}
class Stream {
  constructor(tracks = []) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
}
class Recorder extends EventTarget {
  static instances = [];
  static isTypeSupported(type) { return type.startsWith('video/webm'); }
  constructor(stream, options) { super(); this.stream = stream; this.mimeType = options.mimeType; this.state = 'inactive'; this.finalData = 'end'; Recorder.instances.push(this); }
  start(timeslice) { this.state = 'recording'; this.timeslice = timeslice; }
  emit(value) { const event = new Event('dataavailable'); event.data = new Blob([value], { type: this.mimeType }); this.dispatchEvent(event); }
  stop() { this.state = 'inactive'; queueMicrotask(() => { if (this.finalData) this.emit(this.finalData); this.dispatchEvent(new Event('stop')); }); }
}
class Timers {
  constructor() { this.entries = new Map(); this.id = 0; }
  setTimeout(fn, ms) { const id = ++this.id; this.entries.set(id, { fn, ms, interval: false }); return id; }
  clearTimeout(id) { this.entries.delete(id); }
  setInterval(fn, ms) { const id = ++this.id; this.entries.set(id, { fn, ms, interval: true }); return id; }
  clearInterval(id) { this.entries.delete(id); }
  fire(ms) { for (const [id, item] of [...this.entries]) if (item.ms === ms) { if (!item.interval) this.entries.delete(id); item.fn(); } }
}
class MemoryStore {
  constructor(records = []) { this.records = new Map(records.map(r => [r.id, { ...r }])); this.parts = new Map(); this.calls = []; this.appendGate = null; this.failSequence = null; }
  async open() { this.calls.push('open'); }
  async probe() { this.calls.push('probe'); if (this.probeError) throw this.probeError; }
  async list() { return [...this.records.values()].map(r => ({ ...r })); }
  async get(id) { return this.records.has(id) ? { ...this.records.get(id) } : null; }
  async create(record) { this.records.set(record.id, { ...record }); return { ...record }; }
  async update(id, mutate) { if (this.updateError) throw this.updateError; const next = mutate({ ...this.records.get(id) }); this.records.set(id, next); return { ...next }; }
  async append(id, sequence, blob, committedAt) {
    this.calls.push(`append:${sequence}`);
    if (this.appendGate) await this.appendGate.promise;
    if (sequence === this.failSequence) throw new DOMException('Quota reached', 'QuotaExceededError');
    const old = this.records.get(id);
    assert.equal(sequence, old.chunkCount);
    const chunks = this.parts.get(id) || [];
    chunks.push(blob);
    this.parts.set(id, chunks);
    const next = { ...old, bytes: old.bytes + blob.size, chunkCount: sequence + 1, lastCommittedAt: committedAt };
    this.records.set(id, next); return { ...next };
  }
  async remove(id, { expiredAt } = {}) {
    if (!this.records.has(id)) return false;
    const old = this.records.get(id);
    if (expiredAt != null && old.status !== 'deleting' && (old.retained || old.status === 'recording' || old.expiresAt == null || old.expiresAt > expiredAt)) return false;
    this.records.get(id).status = 'deleting';
    if (this.removeError) throw this.removeError;
    this.records.delete(id); this.parts.delete(id); return true;
  }
  async readChunks(id, maxBytes) { this.calls.push('readChunks'); const parts = this.parts.get(id) || []; if (parts.reduce((n, p) => n + p.size, 0) > maxBytes) throw new Error('Too large'); return parts; }
  close() { this.calls.push('close'); }
}
function harness(config = {}, overrides = {}) {
  let now = 1700000000000;
  let nextId = 0;
  const calls = [];
  const display = new Stream([new Track('video', 'browser')]);
  const camera = new Stream([new Track('video')]);
  const mic = new Stream([new Track('audio')]);
  const store = overrides.store || new MemoryStore();
  const timers = new Timers();
  const media = {
    getDisplayMedia(options) { calls.push(['screen', options]); return Promise.resolve(display); },
    getUserMedia(options) { calls.push(['user', options]); return Promise.resolve(options.audio ? mic : camera); },
    async enumerateDevices() { return [{ kind: 'videoinput', deviceId: 'cam-1', label: '' }, { kind: 'audioinput', deviceId: 'mic-1' }]; },
  };
  const controller = new CaptureController(config, { store, timers, mediaDevices: media,
    MediaRecorder: Recorder, MediaStream: Stream, locks: null, isSecureContext: true,
    storage: { async estimate() { return { usage: 0, quota: 10e9 }; } }, now: () => now,
    uuid: () => `recording-${++nextId}`, ...overrides });
  return { controller, store, timers, calls, media, display, camera, mic,
    advance(ms) { now += ms; }, get now() { return now; }, get recorder() { return Recorder.instances.at(-1); } };
}

test('constructor and prepare never request media; prepare verifies storage', async () => {
  const h = harness();
  assert.deepEqual(h.calls, []);
  await h.controller.prepare();
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.store.calls.slice(0, 2), ['open', 'probe']);
  assert.equal(h.controller.snapshot.prepared, true);
  await h.controller.dispose();
});

test('screen chooser is called synchronously, with all audio off by default', async () => {
  const h = harness(); await h.controller.prepare();
  const starting = h.controller.startRecording();
  assert.deepEqual(h.calls, [['screen', { video: true, audio: false }]]);
  await starting;
  assert.equal(h.controller.snapshot.audioLabel, '无音频');
  assert.equal(h.controller.snapshot.captureSource, 'browser');
  assert.equal(h.recorder.stream.getAudioTracks().length, 0);
  await h.controller.dispose();
});

test('stop waits for the final data event and all serialized durable commits', async () => {
  const h = harness(); await h.controller.prepare(); await h.controller.startRecording();
  h.store.appendGate = later();
  h.recorder.emit('one');
  h.advance(1000);
  const stopping = h.controller.stopRecording();
  let resolved = false; stopping.then(() => { resolved = true; });
  await tick();
  assert.equal(resolved, false);
  assert.equal(h.controller.snapshot.recordingState, 'stopping');
  h.store.appendGate.resolve();
  const record = await stopping;
  assert.equal(record.status, 'complete');
  assert.equal(record.bytes, 6);
  assert.equal(record.chunkCount, 2);
  assert.equal(record.expiresAt, h.now + CAPTURE_DEFAULTS.retentionMs);
  assert.deepEqual(h.store.calls.filter(c => c.startsWith('append:')), ['append:0', 'append:1']);
  assert.equal(h.store.calls.includes('readChunks'), false);
  const blob = await h.controller.getRecordingBlob(record.id);
  assert.equal(await blob.text(), 'oneend');
  assert.equal(h.store.records.get(record.id).retained, false, 'export does not pin or delete');
  await h.controller.dispose();
});

test('camera and screen are independent; external camera ended clears preview', async () => {
  const h = harness(); await h.controller.prepare(); await h.controller.openCamera(); await h.controller.startRecording();
  await h.controller.stopRecording();
  assert.equal(h.camera.getVideoTracks()[0].readyState, 'live');
  assert.equal(h.controller.snapshot.cameraState, 'open');
  h.camera.getVideoTracks()[0].end();
  assert.equal(h.controller.snapshot.cameraState, 'closed');
  assert.equal(h.controller.snapshot.cameraStream, null);
  await h.controller.dispose();
});

test('close camera does not stop active screen; list cameras makes no permission request', async () => {
  const h = harness(); await h.controller.prepare(); await h.controller.startRecording(); await h.controller.openCamera();
  h.controller.closeCamera();
  assert.equal(h.controller.snapshot.recordingState, 'recording');
  const requests = h.calls.length;
  assert.deepEqual(await h.controller.listCameras(), [{ deviceId: 'cam-1', label: '摄像头 1', groupId: undefined }]);
  assert.equal(h.calls.length, requests);
  await h.controller.dispose();
});

test('closing a pending camera request releases a stream arriving later', async () => {
  const h = harness(); const request = later(); h.media.getUserMedia = () => request.promise;
  const opening = h.controller.openCamera(); h.controller.closeCamera(); request.resolve(h.camera);
  assert.equal(await opening, null);
  assert.equal(h.camera.getVideoTracks()[0].readyState, 'ended');
  assert.equal(h.controller.snapshot.cameraState, 'closed');
  await h.controller.dispose();
});

test('cancel pending screen request stops a later stream without starting a recorder', async () => {
  const h = harness(); const request = later(); h.media.getDisplayMedia = () => request.promise;
  await h.controller.prepare(); const starting = h.controller.startRecording(); const stopping = h.controller.stopRecording();
  request.resolve(h.display); assert.equal(await starting, null); assert.equal(await stopping, null);
  assert.equal(h.display.getVideoTracks()[0].readyState, 'ended');
  assert.equal(h.controller.snapshot.recordingState, 'idle');
  assert.equal((await h.controller.listRecordings()).length, 0);
  await h.controller.dispose();
});

test('screen rejection is recoverable and creates no phantom recording', async () => {
  const h = harness(); h.media.getDisplayMedia = () => Promise.reject(new DOMException('Cancelled', 'NotAllowedError'));
  await h.controller.prepare(); await assert.rejects(h.controller.startRecording(), { name: 'NotAllowedError' });
  assert.equal(h.controller.snapshot.recordingState, 'error');
  assert.equal(h.controller.snapshot.error.stage, 'recording');
  assert.equal((await h.controller.listRecordings()).length, 0);
  await h.controller.dispose();
});

test('microphone denied stops screen tracks; no silent capture continues', async () => {
  const h = harness(); h.media.getUserMedia = () => Promise.reject(new DOMException('Denied', 'NotAllowedError'));
  await h.controller.prepare(); await assert.rejects(h.controller.startRecording({ microphone: true }));
  assert.equal(h.display.getVideoTracks()[0].readyState, 'ended');
  assert.equal(h.controller.snapshot.recordingState, 'error');
  await h.controller.dispose();
});

test('microphone-only recording reports actual track and releases it', async () => {
  const h = harness(); await h.controller.prepare(); await h.controller.startRecording({ microphone: true });
  assert.equal(h.controller.snapshot.audioLabel, '含麦克风');
  assert.equal(h.recorder.stream.getAudioTracks().length, 1);
  assert.deepEqual(h.calls[1], ['user', { video: false, audio: true }]);
  await h.controller.stopRecording(); assert.equal(h.mic.getAudioTracks()[0].readyState, 'ended');
  await h.controller.dispose();
});

test('system plus microphone uses one mixed audio track without speaker connection', async () => {
  const contexts = [];
  class AudioContext {
    constructor() { this.state = 'suspended'; this.connections = []; this.destination = { speakers: true }; contexts.push(this); }
    createMediaStreamDestination() { this.output = { stream: new Stream([new Track('audio')]), disconnect() {} }; return this.output; }
    createMediaStreamSource(stream) { return { connect: target => this.connections.push({ stream, target }), disconnect() {} }; }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
  }
  const h = harness({}, { AudioContext }); h.display.tracks.push(new Track('audio'));
  await h.controller.prepare(); await h.controller.startRecording({ systemAudio: true, microphone: true });
  assert.equal(h.controller.snapshot.audioLabel, '含标签页音频与麦克风');
  assert.equal(h.recorder.stream.getAudioTracks().length, 1);
  assert.equal(contexts[0].connections.length, 2);
  assert.ok(contexts[0].connections.every(c => c.target === contexts[0].output));
  await h.controller.stopRecording(); assert.equal(contexts[0].state, 'closed');
  await h.controller.dispose();
});

test('audio request without a supplied track warns and records silent video honestly', async () => {
  const h = harness(); await h.controller.prepare(); await h.controller.startRecording({ systemAudio: true });
  assert.equal(h.controller.snapshot.audioLabel, '无音频');
  assert.match(h.controller.snapshot.warning, /未提供共享音频/);
  await h.controller.dispose();
});

test('write quota failure immediately stops capture and preserves only committed chunks', async () => {
  const h = harness(); await h.controller.prepare(); await h.controller.startRecording();
  h.recorder.emit('kept'); await tick();
  h.store.failSequence = 1; h.recorder.emit('lost'); await tick(); await tick();
  assert.equal(h.display.getVideoTracks()[0].readyState, 'ended');
  const [record] = await h.controller.listRecordings();
  assert.equal(record.status, 'incomplete'); assert.equal(record.complete, false); assert.equal(record.bytes, 4);
  assert.equal(h.controller.snapshot.recordingState, 'incomplete');
  assert.equal(h.controller.snapshot.error.name, 'QuotaExceededError');
  assert.equal(await (await h.controller.getRecordingBlob(record.id)).text(), 'kept');
  await h.controller.dispose();
});

test('bounded queue stops on backlog and drains accepted writes without keeping all chunks', async () => {
  const h = harness({ maxPendingBytes: 4 }); await h.controller.prepare(); await h.controller.startRecording();
  h.store.appendGate = later(); h.recorder.emit('abc'); h.recorder.emit('def');
  assert.equal(h.display.getVideoTracks()[0].readyState, 'ended');
  const stopping = h.controller.stopRecording(); h.store.appendGate.resolve(); const record = await stopping;
  assert.equal(record.bytes, 3); assert.equal(record.status, 'incomplete');
  assert.equal(h.controller.snapshot.error.code, 'WRITE_BACKLOG');
  await h.controller.dispose();
});

test('external screen end stops once and finalizes the final chunk', async () => {
  const h = harness(); await h.controller.prepare(); await h.controller.startRecording();
  h.display.getVideoTracks()[0].end(); const first = h.controller.stopRecording(); const second = h.controller.stopRecording();
  assert.equal(first, second); const record = await first;
  assert.equal(record.status, 'complete'); assert.equal(record.bytes, 3); assert.equal(record.stopReason, '共享已结束');
  await h.controller.dispose();
});

test('inactive recorder still waits for its pending final data and stop events', async () => {
  const h = harness(); await h.controller.prepare(); await h.controller.startRecording();
  h.recorder.state = 'inactive';
  const stopping = h.controller.stopRecording();
  let resolved = false; stopping.then(() => { resolved = true; }); await tick();
  assert.equal(resolved, false);
  h.recorder.emit('last'); h.recorder.dispatchEvent(new Event('stop'));
  const record = await stopping; assert.equal(record.bytes, 4); assert.equal(record.status, 'complete');
  await h.controller.dispose();
});

test('startup marks interrupted recordings and expiration uses last commit, retaining pinned records', async () => {
  const base = 1700000000000;
  const records = [
    { id: 'old', startedAt: base - 10 * 86400000, lastCommittedAt: base - 8 * 86400000, status: 'recording', retained: false, bytes: 3 },
    { id: 'recent', startedAt: base - 86400000, lastCommittedAt: base - 1000, status: 'recording', retained: false, bytes: 3 },
    { id: 'pinned', startedAt: 1, expiresAt: 2, status: 'complete', retained: true },
    { id: 'deletion', startedAt: base, expiresAt: base + 10000, status: 'deleting', retained: false },
  ];
  const h = harness({}, { store: new MemoryStore(records) }); await h.controller.prepare();
  assert.equal(h.store.records.has('old'), false); assert.equal(h.store.records.has('deletion'), false);
  assert.equal(h.store.records.get('recent').status, 'interrupted');
  assert.equal(h.store.records.get('recent').expiresAt, base - 1000 + CAPTURE_DEFAULTS.retentionMs);
  assert.equal(h.store.records.has('pinned'), true);
  await h.controller.setRetained('pinned', false); await h.controller.cleanupExpired();
  assert.equal(h.store.records.has('pinned'), false, 'unpin keeps the original expiration date');
  await h.controller.dispose();
});

test('failed deletion keeps retry marker and later cleanup completes it', async () => {
  const h = harness(); await h.controller.prepare(); await h.controller.startRecording(); const record = await h.controller.stopRecording();
  h.store.removeError = new Error('temporary storage failure');
  await assert.rejects(h.controller.deleteRecording(record.id));
  assert.equal(h.store.records.get(record.id).status, 'deleting');
  h.store.removeError = null; assert.deepEqual(await h.controller.cleanupExpired(), [record.id]);
  assert.equal(h.store.records.has(record.id), false);
  await h.controller.dispose();
});

test('unavailable storage fails before any permission request; no memory fallback', async () => {
  const h = harness(); h.store.probeError = new DOMException('Denied', 'SecurityError');
  await assert.rejects(h.controller.prepare());
  assert.throws(() => h.controller.startRecording(), { code: 'NOT_PREPARED' });
  assert.deepEqual(h.calls, []); assert.equal(h.controller.snapshot.prepared, false);
  await assert.rejects(new IndexedDBRecordingStore({ indexedDB: null, IDBKeyRange: null }).open(), { code: 'STORAGE_UNAVAILABLE' });
  await h.controller.dispose();
});

test('limits are explicit: duration auto-stop and export cap reject before materializing parts', async () => {
  const h = harness({ maxDurationMs: 100, maxExportBytes: 10 }); await h.controller.prepare(); await h.controller.startRecording();
  h.timers.fire(100); const record = await h.controller.stopRecording(); assert.equal(record.status, 'complete');
  assert.equal(record.limits.maxDurationMs, 100); assert.equal(record.limits.maxExportBytes, 10);
  h.store.records.get(record.id).bytes = 11;
  await assert.rejects(h.controller.getRecordingBlob(record.id), { code: 'EXPORT_TOO_LARGE' });
  assert.equal(h.store.calls.includes('readChunks'), false);
  await h.controller.dispose();
});

test('oversized incoming chunk stops without pretending a complete file exists', async () => {
  const h = harness({ maxExportBytes: 5 }); await h.controller.prepare(); await h.controller.startRecording();
  h.recorder.emit('ok'); await tick(); h.recorder.emit('oversized'); const record = await h.controller.stopRecording();
  assert.equal(record.status, 'incomplete'); assert.equal(record.bytes, 2); assert.equal(h.controller.snapshot.error.code, 'SIZE_LIMIT');
  await h.controller.dispose();
});

test('metadata-finalization failure cannot report saved; startup can recover old marker', async () => {
  const h = harness(); await h.controller.prepare(); await h.controller.startRecording();
  h.store.updateError = new DOMException('No space', 'QuotaExceededError'); const record = await h.controller.stopRecording();
  assert.equal(record.status, 'incomplete'); assert.equal(record.metadataFinalizationFailed, true);
  assert.equal(h.store.records.get(record.id).status, 'recording'); assert.equal(h.controller.snapshot.recordingState, 'incomplete');
  await h.controller.dispose();
});

test('no data or encoder stop timeout is incomplete, never falsely saved', async () => {
  const h = harness({ finalizeTimeoutMs: 25 }); await h.controller.prepare(); await h.controller.startRecording();
  h.recorder.stop = function () { this.state = 'inactive'; };
  const stopping = h.controller.stopRecording(); h.timers.fire(25); const record = await stopping;
  assert.equal(record.complete, false); assert.equal(record.status, 'incomplete'); assert.equal(h.controller.snapshot.error.code, 'FINALIZE_TIMEOUT');
  await h.controller.dispose();
});

test('unsupported encoder does not open the capture chooser and actual extension matches type', async () => {
  class Unsupported extends Recorder { static isTypeSupported() { return false; } }
  const h = harness({}, { MediaRecorder: Unsupported }); await h.controller.prepare();
  await assert.rejects(h.controller.startRecording(), { code: 'ENCODER_UNAVAILABLE' }); assert.deepEqual(h.calls, []);
  assert.equal(recordingExtension('video/mp4;codecs=avc1'), 'mp4'); assert.equal(recordingExtension('video/webm'), 'webm');
  assert.throws(() => recordingExtension('video/unknown'), { code: 'UNSUPPORTED_MIME' }); await h.controller.dispose();
});

test('second page cannot recover the active first page when Web Locks is available', async () => {
  let held = false;
  const locks = { async request(_name, _options, callback) {
    if (held) return callback(null);
    held = true; try { return await callback({ name: 'test' }); } finally { held = false; }
  } };
  const first = harness({}, { locks }); const second = harness({}, { locks });
  await first.controller.prepare(); await assert.rejects(second.controller.prepare(), { code: 'ANOTHER_TAB' });
  await first.controller.dispose(); await tick(); await second.controller.prepare(); assert.equal(second.controller.snapshot.prepared, true);
  await second.controller.dispose();
});

test('dispose removes timers and releases camera plus recording; snapshots are independent objects', async () => {
  const h = harness(); await h.controller.prepare(); await h.controller.openCamera(); await h.controller.startRecording();
  const snapshot = h.controller.snapshot; snapshot.recordingState = 'hacked'; assert.equal(h.controller.snapshot.recordingState, 'recording');
  await h.controller.dispose(); assert.equal(h.camera.getVideoTracks()[0].readyState, 'ended'); assert.equal(h.display.getVideoTracks()[0].readyState, 'ended');
  assert.equal(h.timers.entries.size, 0); assert.equal(h.controller.snapshot.prepared, false);
  assert.throws(() => h.controller.startRecording(), { code: 'DISPOSED' });
});
