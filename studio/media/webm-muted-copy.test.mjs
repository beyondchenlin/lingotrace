import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMutedWebmCopy, inspectWebm, MAX_MUTED_WEBM_BYTES, WebmMutedCopyError } from './webm-muted-copy.ts';

// Synthetic EBML samples test container mechanics, not video decoding. Real
// Studio MediaRecorder recordings can be checked without retaining user content
// in this repository: WEBM_MEDIARECORDER_FIXTURE=/path/to/recording.webm node
// --experimental-strip-types --test studio/media/webm-muted-copy.test.mjs
const concat = (...parts) => Buffer.concat(parts.flat(Infinity).map(p => Buffer.from(typeof p === 'number' ? [p] : p)));
const id = n => Buffer.from(n.toString(16).padStart(Math.ceil(n.toString(16).length / 2) * 2, '0'), 'hex');
const vint = (n, width) => {
  if (!width) for (width = 1; n >= 2 ** (7 * width) - 1; width++);
  const bytes = Buffer.alloc(width); let value = BigInt(n);
  for (let i = width - 1; i >= 0; i--) { bytes[i] = Number(value & 255n); value >>= 8n; }
  bytes[0] |= 1 << (8 - width); return bytes;
};
const unknown = Buffer.from([1, 255, 255, 255, 255, 255, 255, 255]);
const el = (i, data, size) => { const payload = concat(data); return concat(id(i), size ?? vint(payload.length), payload); };
const u = (i, n) => {
  let value = BigInt(n), bytes = [];
  do { bytes.unshift(Number(value & 255n)); value >>= 8n; } while (value);
  return el(i, bytes);
};
const str = (i, s) => el(i, Buffer.from(s));
const fl = (i, n) => { const b = Buffer.alloc(8); b.writeDoubleBE(n); return el(i, b); };
const header = (extra = []) => el(0x1a45dfa3, concat(u(0x4286, 1), u(0x42f7, 1), u(0x42f2, 4), u(0x42f3, 8), str(0x4282, 'webm'), u(0x4287, 4), u(0x4285, 2), extra));
const info = (extra = []) => el(0x1549a966, concat(u(0x2ad7b1, 1_000_000), str(0x4d80, 'test'), str(0x5741, 'test'), extra));
function track(number, type = 1, options = {}) {
  const video = el(0xe0, concat(u(0xb0, 160), u(0xba, 90), options.videoExtra ?? []));
  const audio = el(0xe1, concat(fl(0xb5, 48000), u(0x9f, 2)));
  return el(0xae, concat(u(0xd7, number), u(0x73c5, options.uid ?? number), u(0x83, type), str(0x86, options.codec ?? (type === 1 ? 'V_VP8' : 'A_OPUS')),
    type === 1 ? video : audio, options.defaultDuration ? u(0x23e383, options.defaultDuration) : [], options.extra ?? []));
}
const tracks = (...entries) => el(0x1654ae6b, concat(...entries));
const videoFrame = n => Buffer.from(`encoded-video-frame-${n}-\xa3\xae\x16\x54\xae\x6b`, 'latin1');
const audioFrame = n => Buffer.from(`private-audio-payload-${n}-never-retain`);
function block(number, time = 0, payload = videoFrame(0), options = {}) {
  const timing = Buffer.alloc(3); timing.writeInt16BE(time, 0); timing[2] = options.flags ?? (options.group ? 0 : 0x80);
  return el(options.group ? 0xa1 : 0xa3, concat(options.trackVint ?? vint(number), timing, payload));
}
const group = (b, extra = []) => el(0xa0, concat(b, extra));
const cluster = (time, blocks, streaming = false, extra = []) => el(0x1f43b675, concat(u(0xe7, time), extra, blocks), streaming ? unknown : undefined);
const webm = (body, streaming = false, h = header()) => concat(h, el(0x18538067, concat(body), streaming ? unknown : undefined));
function sample(options = {}) {
  const v = options.videoNumber ?? 1, a = options.audioNumber ?? 2;
  return webm([info(options.infoExtra), options.tracks ?? tracks(track(v, 1, { defaultDuration: options.defaultDuration, codec: options.codec }), track(a, 2)),
    options.clusters ?? cluster(0, [block(a, -7, audioFrame('before')), block(v, 0, videoFrame(0)), block(a, 10, audioFrame('between')),
      block(v, 33, videoFrame(1)), block(a, 34, audioFrame('after'))], options.streaming)], options.streaming);
}
const copy = bytes => createMutedWebmCopy(new Blob([bytes], { type: 'video/webm;codecs=vp8,opus' }));
async function provePreserved(input, output) {
  const bytes = Buffer.from(await output.blob.arrayBuffer());
  assert.equal(bytes.length, input.length);
  assert.equal(output.after.audioTrackCount, 0);
  assert.equal(output.after.audioBlockCount, 0);
  assert.deepEqual(output.after.videoFrames, output.before.videoFrames);
  assert.deepEqual(output.after.videoTracks, output.before.videoTracks);
  for (const f of output.before.videoFrames) assert.deepEqual(bytes.subarray(f.offset, f.offset + f.byteLength), input.subarray(f.offset, f.offset + f.byteLength));
  assert.deepEqual(inspectWebm(bytes), output.after);
  return bytes;
}
const invalid = (bytes, match) => assert.throws(() => inspectWebm(bytes), error => error instanceof WebmMutedCopyError && (!match || match.test(error.message)));

// CRC-32 test implementation independent of production lookup table.
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); }
  const result = Buffer.alloc(4); result.writeUInt32LE((c ^ 0xffffffff) >>> 0); return result;
}
const withCRC = (i, children, position = 0) => {
  const payload = concat(children), crc = el(0xbf, crc32(payload));
  return el(i, concat(payload.subarray(0, position), crc, payload.subarray(position)));
};

test('audio before, between and after video is zeroed without changing original or any video bytes', async () => {
  const input = sample(), snapshot = Buffer.from(input), source = new Blob([input], { type: 'video/webm' });
  const output = await createMutedWebmCopy(source);
  const bytes = await provePreserved(input, output);
  assert.equal(output.removedAudioTracks, 1); assert.equal(output.removedAudioBlocks, 3);
  assert.equal(output.after.videoFrameCount, 2); assert.deepEqual(output.after.dimensions, [{ trackNumber: 1, width: 160, height: 90 }]);
  assert.equal(output.after.firstVideoTimestampSeconds, 0); assert.equal(output.after.lastVideoTimestampSeconds, .033);
  assert.equal(output.after.durationSeconds, null); assert.equal(output.after.containerDurationSeconds, null);
  for (const n of ['before', 'between', 'after']) assert.equal(bytes.indexOf(audioFrame(n)), -1);
  assert.equal(bytes.indexOf(Buffer.from('A_OPUS')), -1);
  assert.deepEqual(input, snapshot); assert.deepEqual(Buffer.from(await source.arrayBuffer()), snapshot);
  assert.notEqual(output.blob, source); assert.equal(output.blob.type, 'video/webm');
});

test('removed payloads are entirely zero-filled across Void size-width boundaries', async () => {
  for (const length of [1, 120, 121, 122, 123, 124, 125, 126, 127, 128, 16380, 16381, 16382, 16383, 16384, 20000]) {
    const audio = block(2, 0, Buffer.alloc(length, 0x7b));
    const input = sample({ clusters: cluster(0, [block(1), audio]) });
    const output = await copy(input), bytes = await provePreserved(input, output);
    const start = input.indexOf(audio); assert.equal(bytes[start], 0xec);
    let width = 1, bit = 0x80; while (!(bytes[start + 1] & bit)) { bit >>= 1; width++; }
    let payloadLength = bytes[start + 1] & (bit - 1);
    for (let i = 1; i < width; i++) payloadLength = payloadLength * 256 + bytes[start + 1 + i];
    assert.equal(1 + width + payloadLength, audio.length);
    assert.ok(bytes.subarray(start + 1 + width, start + audio.length).every(b => b === 0));
  }
});

test('audio-first track order, multiple audio tracks, VP9 and large track VINTs', async () => {
  const input = webm([info(), tracks(track(3, 2), track(128, 1, { codec: 'V_VP9' }), track(4, 2, { codec: 'A_VORBIS' })),
    cluster(200, [block(3, -20, audioFrame(1)), block(128, -10, videoFrame(0)), block(4, 20, audioFrame(2)), block(128, 30, videoFrame(1))])]);
  const result = await copy(input); await provePreserved(input, result);
  assert.equal(result.removedAudioTracks, 2); assert.equal(result.removedAudioBlocks, 2); assert.equal(result.after.videoTracks[0].trackNumber, 128);
  assert.equal(result.after.firstVideoTimestampSeconds, .19);
});

test('Block TrackNumber all-one VINT is a legal track number, not an unknown element size', async () => {
  const input = sample({ videoNumber: 127, clusters: cluster(0, [block(127, 0, videoFrame(0), { trackVint: Buffer.from([255]) })]) });
  await provePreserved(input, await copy(input));
});

test('unknown Segment and consecutive unknown Clusters close at schema boundaries', async () => {
  const input = sample({ streaming: true, clusters: [cluster(0, [block(1), block(2, 20, audioFrame(1))], true),
    cluster(1000, [block(2, 0, audioFrame(2)), block(1, 40, videoFrame(1))], true), cluster(2000, [block(1, 10, videoFrame(2))])] });
  const result = await copy(input); await provePreserved(input, result);
  assert.equal(result.after.videoFrameCount, 3); assert.equal(result.after.lastVideoTimestampSeconds, 2.0100000000000002);
});

test('whole audio BlockGroup is removed; video BlockGroup, references and explicit duration survive', async () => {
  const audio = group(block(2, 5, audioFrame(1), { group: true }), [u(0x9b, 20), el(0x75a2, Buffer.from([0xff])), u(0xfa, 0)]);
  const video = group(block(1, 0, videoFrame(0), { group: true }), u(0x9b, 40));
  const video2 = group(block(1, 40, videoFrame(1), { group: true }), [u(0x9b, 40), el(0xfb, Buffer.from([0xff]))]);
  const input = sample({ clusters: cluster(0, [audio, video, video2]) });
  const result = await copy(input), bytes = await provePreserved(input, result);
  assert.equal(result.after.durationSeconds, .08); assert.equal(result.removedAudioBlocks, 1);
  assert.equal(result.after.videoFrames[0].keyframe, true); assert.equal(result.after.videoFrames[1].keyframe, false);
  const offset = input.indexOf(audio); assert.equal(bytes[offset], 0xec);
  assert.equal(bytes.subarray(offset, offset + audio.length).indexOf(audioFrame(1)), -1);
});

test('explicit default frame duration is measured; container duration is reported separately', async () => {
  const result = await copy(sample({ defaultDuration: 33_000_000, infoExtra: fl(0x4489, 100) }));
  assert.equal(result.after.durationSeconds, .066); assert.equal(result.after.containerDurationSeconds, .1);
  assert.equal(result.after.videoTracks[0].defaultDurationNs, 33_000_000);
});

test('already video-only input yields an independent valid Blob and zero removal counts', async () => {
  const input = webm([info(), tracks(track(1)), cluster(0, [block(1)])]);
  const result = await copy(input), bytes = await provePreserved(input, result);
  assert.equal(result.removedAudioTracks, 0); assert.equal(result.removedAudioBlocks, 0); assert.deepEqual(bytes, input);
});

test('Chrome native MaxBlockAdditionID, alpha marker, colour metadata and 64-bit UID are retained', async () => {
  const video = track(1, 1, { uid: 0xffffffffffffffffn, extra: u(0x55ee, 1), videoExtra: [u(0x53c0, 1), el(0x55b0, u(0x55b1, 1))] });
  const input = webm([info(), tracks(video), cluster(0, [block(1)])]);
  await provePreserved(input, await copy(input));
});

test('verified nested CRCs, including all changed ancestors, are safely removed', async () => {
  const trackPayload = concat(track(1), track(2, 2));
  const trackContainer = withCRC(0x1654ae6b, trackPayload);
  const audio = withCRC(0xa0, [block(2, 0, audioFrame(1), { group: true }), u(0x9b, 20)]);
  const clusterPayload = [u(0xe7, 0), audio, block(1)];
  const checksummedCluster = withCRC(0x1f43b675, clusterPayload, u(0xe7, 0).length);
  const input = concat(header(), withCRC(0x18538067, [info(), trackContainer, checksummedCluster]));
  const result = await copy(input); await provePreserved(input, result);
  assert.equal(result.removedAudioBlocks, 1);
});

test('bad CRC and duplicate CRC fail closed instead of blessing corrupted input', () => {
  const valid = concat(header(), withCRC(0x18538067, [info(), tracks(track(1)), cluster(0, [block(1)])]));
  const bad = Buffer.from(valid); bad[bad.length - 1] ^= 1; invalid(bad, /CRC/);
  invalid(webm([info(), tracks(track(1)), el(0xbf, Buffer.alloc(4)), el(0xbf, Buffer.alloc(4)), cluster(0, [block(1)])]), /CRC/);
});

test('unsupported codecs, encryption, metadata references, lacing and transformations fail closed', () => {
  invalid(sample({ codec: 'V_AV1' }), /VP8 and VP9/);
  invalid(sample({ tracks: tracks(track(1), track(2, 2, { codec: 'A_AAC' })) }), /Opus and Vorbis/);
  invalid(sample({ tracks: tracks(track(1, 1, { extra: el(0x6d80, []) }), track(2, 2)) }), /Unsupported/);
  invalid(webm([info(), tracks(track(1)), el(0x1c53bb6b, []), cluster(0, [block(1)])]), /Unsupported Segment/);
  invalid(webm([info(), tracks(track(1)), el(0x114d9b74, []), cluster(0, [block(1)])]), /Unsupported Segment/);
  for (const flags of [0x82, 0x84, 0x86]) {
    invalid(sample({ clusters: cluster(0, [block(1, 0, videoFrame(0), { flags })]) }), /Laced/);
    invalid(sample({ clusters: cluster(0, [block(1), block(2, 0, audioFrame(0), { flags })]) }), /Laced/);
  }
  invalid(sample({ tracks: tracks(track(1, 1, { videoExtra: u(0x54aa, 1) }), track(2, 2)) }), /Cropped/);
  invalid(sample({ tracks: tracks(track(1, 1, { videoExtra: u(0x54b0, 320) }), track(2, 2)) }), /geometry/);
  invalid(sample({ tracks: tracks(track(1, 1, { extra: u(0x56aa, 10) }), track(2, 2)) }), /Delayed video/);
});

test('truncated headers and every truncation of finite-size recording fail closed', () => {
  const input = sample();
  for (let end = 0; end < input.length; end++) invalid(input.subarray(0, end));
  invalid(concat(input, [0]));
});

test('unknown child sizes, unsafe sizes, zero VINTs and reserved flags fail closed', () => {
  invalid(webm([info(), tracks(track(1)), cluster(0, [el(0xa3, [0x81, 0, 0, 0x80, 1], unknown)])]), /Unknown size/);
  invalid(concat(header(), id(0x18538067), Buffer.from([1, 0x20, 0, 0, 0, 0, 0, 0])), /safe bounds/);
  invalid(concat(header(), id(0x18538067), [0]));
  invalid(sample({ clusters: cluster(0, [block(1, 0, videoFrame(0), { flags: 0x90 })]) }), /reserved/);
  invalid(sample({ clusters: cluster(0, [group(block(1, 0, videoFrame(0), { group: true, flags: 0x80 }))]) }), /reserved/);
});

test('missing tracks, duplicated identity, missing video, empty payload, bad timing and bad groups fail closed', () => {
  invalid(sample({ clusters: cluster(0, [block(99)]) }), /missing track/);
  invalid(sample({ tracks: tracks(track(1), track(1, 2)) }), /duplicate/);
  invalid(sample({ tracks: tracks(track(1), track(2, 2, { uid: 1 })) }), /duplicate/);
  invalid(webm([info(), tracks(track(2, 2)), cluster(0, [block(2, 0, audioFrame(0))])]), /no usable video/);
  invalid(sample({ clusters: cluster(0, [block(1, 0, [])]) }), /empty/);
  invalid(sample({ clusters: el(0x1f43b675, [block(1)]) }), /timestamp/);
  invalid(sample({ clusters: cluster(0, [block(1, -1)]) }), /Negative/);
  invalid(sample({ clusters: cluster(0, [group(u(0x9b, 5))]) }), /no Block/);
  invalid(sample({ clusters: cluster(0, [group(block(1, 0, videoFrame(0), { group: true }), block(1, 1, videoFrame(1), { group: true }))]) }), /Repeated/);
  invalid(sample({ infoExtra: fl(0x4489, Number.NaN) }), /Non-finite/);
  invalid(sample({ infoExtra: fl(0x4489, 1) }), /shorter/);
});

test('foreign containers, MIME types, empty files and byte limits fail before export', async () => {
  await assert.rejects(copy(Buffer.from('not webm')), WebmMutedCopyError);
  await assert.rejects(copy(Buffer.alloc(0)), /empty/);
  await assert.rejects(createMutedWebmCopy(new Blob([sample()], { type: 'video/mp4' })), /Only WebM/);
  await assert.rejects(createMutedWebmCopy(new Blob([sample()]), { maxBytes: 5 }), e => e.code === 'WEBM_TOO_LARGE');
  for (const maxBytes of [0, -1, NaN, Infinity, MAX_MUTED_WEBM_BYTES + 1, 1.5]) await assert.rejects(createMutedWebmCopy(new Blob([sample()]), { maxBytes }), TypeError);
  let read = false;
  await assert.rejects(createMutedWebmCopy({ size: MAX_MUTED_WEBM_BYTES + 1, type: 'video/webm', slice() { read = true; } }), e => e.code === 'WEBM_TOO_LARGE');
  assert.equal(read, false);
});

test('pre-cancellation and cancellation while a Blob read is outstanding reject promptly', async () => {
  const early = new AbortController(); early.abort();
  await assert.rejects(createMutedWebmCopy(new Blob([sample()]), { signal: early.signal }), { name: 'AbortError' });
  const during = new AbortController(); let resolveRead;
  const pending = createMutedWebmCopy({ size: 12, type: 'video/webm', slice() { return { arrayBuffer: () => new Promise(r => { resolveRead = r; }) }; } }, { signal: during.signal });
  during.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  resolveRead(new ArrayBuffer(12));
});

test('large recording yields to cancellation without touching source bytes', async () => {
  const input = sample({ clusters: cluster(0, [block(1, 0, Buffer.alloc(3 * 1024 * 1024, 0x5a)), block(2, 1, audioFrame(1))]) });
  const before = Buffer.from(input), controller = new AbortController();
  const pending = createMutedWebmCopy(new Blob([input]), { signal: controller.signal });
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(pending, { name: 'AbortError' }); assert.deepEqual(input, before);
});

test('element-count resource bound rejects intentionally pathological files', () => {
  const tooMany = Buffer.alloc(1_000_010); for (let p = 0; p < tooMany.length; p += 2) { tooMany[p] = 0xec; tooMany[p + 1] = 0x80; }
  invalid(webm([info(), tracks(track(1)), cluster(0, [block(1)]), tooMany]), /Too many WebM elements/);
});

test('recorded MediaRecorder fixture: original and muted video bytes/timeline remain identical', { skip: !process.env.WEBM_MEDIARECORDER_FIXTURE }, async () => {
  const input = await readFile(process.env.WEBM_MEDIARECORDER_FIXTURE);
  const result = await copy(input); await provePreserved(input, result);
  assert.ok(result.before.videoFrameCount > 0);
  if (process.env.WEBM_MEDIARECORDER_REQUIRE_AUDIO) assert.ok(result.removedAudioTracks > 0 && result.removedAudioBlocks > 0);
});
