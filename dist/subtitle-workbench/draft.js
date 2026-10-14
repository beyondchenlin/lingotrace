/**
 * C1 local, unreviewed subtitle draft data. This module has no network, storage,
 * player, training, or DOM dependencies. Imported strings are never executable.
 * Every public mutating operation constructs, validates, and freezes a new value.
 */
export const LIMITS = Object.freeze({
  mediaBytes: 32 * 1024 * 1024, mediaSeconds: 60, subtitleBytes: 1024 * 1024,
  jsonBytes: 8 * 1024 * 1024, rawWords: 10000, cues: 500, edits: 2000,
  textUnits: 16000, totalTextUnits: 1000000,
});
export const DRAFT_VERSION = 'subtitle-draft.v1';
// Boundary edits have different history semantics. Keep text-only drafts v1;
// an older v1 reader must reject the explicitly versioned timing protocol.
export const TIMING_DRAFT_VERSION = 'subtitle-draft.v2';
export const ASR_PROFILE = Object.freeze({
  model: 'tiny.en_timestamped', revision: 'aeaa13760958b03fac5062f457d317d3319c3168',
  dtype: 'q8', runtime: 'Transformers.js 3.7.1', device: 'wasm',
});
export class DraftError extends Error {
  constructor(code, message, details = []) { super(message); this.name = 'DraftError'; this.code = code; this.details = details; }
}
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const fail = (code, message, details) => { throw new DraftError(code, message, details); };
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const clone = value => JSON.parse(JSON.stringify(value));
// JSON object member order is not provenance. Arrays and scalar values remain exact.
function equal(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => equal(value, b[index]));
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => own(b, key) && equal(a[key], b[key]));
}
const id = (prefix, index) => `${prefix}-${String(index + 1).padStart(6, '0')}`;
const byteLength = text => encoder.encode(text).byteLength;
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function shape(value, keys, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
    fail('schema', `${path} must be a plain object.`);
  const got = Object.keys(value);
  if (got.length !== keys.length || got.some(key => !keys.includes(key))) fail('schema', `${path} has missing or unknown fields.`);
}
function string(value, path, max = LIMITS.textUnits) {
  if (typeof value !== 'string' || value.length > max) fail('limit', `${path} must be text of at most ${max} UTF-16 units.`);
}
function integer(value, path, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('schema', `${path} must be an integer in range.`);
}
function oneOf(value, values, path) { if (!values.includes(value)) fail('schema', `${path} is not an allowed value.`); }
function sha(value, path) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('schema', `${path} must be a lowercase SHA-256.`); }
function array(value, path, max) { if (!Array.isArray(value) || value.length > max) fail('limit', `${path} exceeds its item limit or is not an array.`); }
function finite(value, path, min = 0, max = Number.MAX_VALUE) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0) || value < min || value > max) fail('schema', `${path} must be a finite number in range.`);
}
/** Reject getters, prototypes, holes, cycles and values JSON would silently erase. */
function checkJSONData(value) {
  let units = 0; const seen = new Set();
  function visit(item, depth) {
    if (depth > 24) fail('schema', 'Draft nesting is too deep.');
    if (typeof item === 'string') { units += item.length; if (units > LIMITS.totalTextUnits) fail('limit', 'All draft text exceeds 1,000,000 UTF-16 units.'); return; }
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number') { if (!Number.isFinite(item) || Object.is(item, -0)) fail('schema', 'Use an explicit JSON-safe anomaly for non-finite or negative-zero values.'); return; }
    if (!item || typeof item !== 'object' || seen.has(item)) fail('schema', 'Draft contains an unrepresentable or cyclic value.');
    const isArray = Array.isArray(item);
    if (isArray && item.length > LIMITS.rawWords) fail('limit', 'A data array exceeds the 10,000-item safety bound.');
    if (!isArray && Object.keys(item).length > 32) fail('schema', 'A data object has too many fields.');
    if (!isArray && Object.getPrototypeOf(item) !== Object.prototype) fail('schema', 'Only plain JSON objects are accepted.');
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!own(descriptor, 'value') || (!descriptor.enumerable && !(isArray && key === 'length')) || ['__proto__', 'constructor', 'prototype'].includes(key)) fail('schema', 'Draft has unsafe object properties.');
    }
    if (Object.getOwnPropertySymbols(item).length) fail('schema', 'Symbol properties are not JSON data.');
    if (isArray && (Object.keys(item).length !== item.length || Object.keys(item).some((key, index) => key !== String(index)))) fail('schema', 'Sparse or decorated arrays are not accepted.');
    seen.add(item); for (const child of Object.values(item)) visit(child, depth + 1); seen.delete(item);
  }
  visit(value, 0);
  const bytes = byteLength(JSON.stringify(value));
  if (bytes > LIMITS.jsonBytes) fail('limit', 'Draft JSON exceeds 8 MiB.');
  return { textUnits: units, jsonBytes: bytes };
}
function measurements(input, path = 'measurements') {
  const result = {
    mediaDuration: input.mediaDuration,
    decodedSampleRate: input.decodedSampleRate ?? null,
    decodedSampleCount: input.decodedSampleCount ?? null,
  };
  finite(result.mediaDuration, `${path}.mediaDuration`, Number.MIN_VALUE, LIMITS.mediaSeconds);
  if ((result.decodedSampleRate === null) !== (result.decodedSampleCount === null)) fail('schema', 'Decoded sample rate and count must both be known or both be null.');
  if (result.decodedSampleRate !== null) {
    integer(result.decodedSampleRate, 'decodedSampleRate', 1, 768000);
    integer(result.decodedSampleCount, 'decodedSampleCount', 1, Math.ceil(LIMITS.mediaSeconds * result.decodedSampleRate));
  }
  return result;
}
function validateMedia(media) {
  shape(media, ['name', 'mediaSHA256', 'size', 'mime', 'mediaDuration', 'decodedSampleRate', 'decodedSampleCount'], 'media');
  string(media.name, 'media.name', 1024); string(media.mime, 'media.mime', 256);
  sha(media.mediaSHA256, 'media.mediaSHA256'); integer(media.size, 'media.size', 1, LIMITS.mediaBytes);
  measurements(media);
}
// Synchronous SHA-256 keeps every ingest/edit/export validation equally strict.
// Media hashing uses Web Crypto; this bounded implementation hashes subtitle text only.
const SHA_K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
function sha256Text(text) {
  const bytes = encoder.encode(text), size = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(size); padded.set(bytes); padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer); view.setUint32(size - 8, Math.floor(bytes.length / 0x20000000)); view.setUint32(size - 4, bytes.length * 8);
  const hash = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]), w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < size; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      w[i] = w[i - 16] + (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) + w[i - 7] + (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10));
    }
    let [a,b,c,d,e,f,g,h] = hash;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    for (const [i, value] of [a,b,c,d,e,f,g,h].entries()) hash[i] += value;
  }
  return Array.from(hash, value => value.toString(16).padStart(8, '0')).join('');
}
export async function sha256Bytes(bytes) {
  if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) fail('schema', 'SHA input must be bytes.');
  if (!globalThis.crypto?.subtle) fail('crypto-unavailable', 'This browser cannot verify local SHA-256 identities.');
  const data = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
}
export async function identifyMedia(file, measured) {
  if (!file || typeof file.arrayBuffer !== 'function') fail('media', 'Choose a local media file.');
  integer(file.size, 'file.size', 1, LIMITS.mediaBytes);
  const actual = measurements(measured ?? {});
  const bytes = await file.arrayBuffer();
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== file.size) fail('media', 'The media bytes changed while being read.');
  const result = { name: file.name ?? '', mediaSHA256: await sha256Bytes(bytes), size: bytes.byteLength, mime: file.type ?? '', ...actual };
  validateMedia(result); return freeze(result);
}
const ANOMALY_TYPES = ['null', 'undefined', 'number', 'string', 'boolean'];
const ANOMALY_REASONS = ['missing', 'non-finite', 'negative-zero', 'invalid-type', 'invalid-syntax'];
function anomaly(value, reason) {
  const type = value === null ? 'null' : typeof value;
  if (!ANOMALY_TYPES.includes(type)) fail('schema', 'A timestamp has an unrepresentable value.');
  return { type, value: Object.is(value, -0) ? '-0' : String(value), reason };
}
function timeValue(value) {
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return { time: value, anomaly: null };
  const reason = value == null ? 'missing' : typeof value === 'number' ? Object.is(value, -0) ? 'negative-zero' : 'non-finite' : 'invalid-type';
  return { time: null, anomaly: anomaly(value, reason) };
}
function validateTime(time, invalid, path) {
  if (time !== null) { finite(time, path, -Number.MAX_VALUE); if (invalid !== null) fail('schema', `${path} cannot have both a time and an anomaly.`); return; }
  shape(invalid, ['type', 'value', 'reason'], `${path}.anomaly`);
  oneOf(invalid.type, ANOMALY_TYPES, `${path}.anomaly.type`); oneOf(invalid.reason, ANOMALY_REASONS, `${path}.anomaly.reason`); string(invalid.value, `${path}.anomaly.value`);
  const { type, value, reason } = invalid;
  if ((reason === 'missing' && !((type === 'null' && value === 'null') || (type === 'undefined' && value === 'undefined'))) ||
      (reason === 'non-finite' && !(type === 'number' && ['NaN', 'Infinity', '-Infinity'].includes(value))) ||
      (reason === 'negative-zero' && !(type === 'number' && value === '-0')) ||
      (reason === 'invalid-type' && !['string', 'boolean'].includes(type)) ||
      (reason === 'invalid-syntax' && type !== 'string')) fail('schema', `${path} has an inconsistent anomaly marker.`);
}
function checkTimes(value, path) {
  shape(value.anomalies, ['start', 'end'], `${path}.anomalies`);
  validateTime(value.start, value.anomalies.start, `${path}.start`); validateTime(value.end, value.anomalies.end, `${path}.end`);
}
function timeFlags(value) {
  const flags = [];
  if (value.start === null || value.end === null) flags.push('missing-time');
  if ([value.start, value.end].some(time => time !== null && (typeof time !== 'number' || !Number.isFinite(time))) || Object.values(value.anomalies).some(item => item && item.reason !== 'missing')) flags.push('invalid-time');
  if (value.start !== null && value.start < 0 || value.end !== null && value.end < 0) flags.push('negative-time');
  if (value.start !== null && value.end !== null) {
    if (value.end === value.start) flags.push('zero-duration');
    if (value.end < value.start) flags.push('reversed-time');
    if (value.start >= 0 && value.end > value.start && Math.floor(value.start / 30) !== Math.floor((value.end - 1e-9) / 30)) flags.push('crosses-window');
  }
  return flags;
}
function parseTime(token, format) {
  const match = (format === 'srt' ? /^(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})$/ : /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/).exec(token);
  if (!match) return { time: null, anomaly: anomaly(token, 'invalid-syntax') };
  const time = Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
  if (!Number.isSafeInteger(Number(match[1] ?? 0)) || !Number.isFinite(time)) return { time: null, anomaly: anomaly(token, 'invalid-syntax') };
  return { time, anomaly: null };
}
/** Raw source order is preserved, including duplicate source identifiers. */
export function parseSubtitleText(text, format) {
  oneOf(format, ['srt', 'vtt'], 'subtitle format'); string(text, 'subtitle source', LIMITS.totalTextUnits);
  if (byteLength(text) > LIMITS.subtitleBytes) fail('limit', 'Subtitle source exceeds 1 MiB.');
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks = normalized.replace(/\n+$/, '').split(/\n[ \t]*\n(?:[ \t]*\n)*/).filter(block => block.trim().length);
  if (format === 'vtt') {
    if (!blocks.length || !/^WEBVTT(?:[ \t][^\n]*)?(?:\n|$)/.test(blocks[0]) || blocks[0].split('\n')[0].includes('-->')) fail('subtitle-syntax', 'WebVTT must begin with its WEBVTT header.');
    const headerLines = blocks.shift().split('\n');
    if (headerLines.slice(1).some(line => line.includes('-->'))) fail('subtitle-syntax', 'A blank line is required after the WebVTT header.');
  }
  const cues = [];
  for (const block of blocks) {
    if (format === 'vtt' && /^(NOTE(?:[ \t\n]|$)|STYLE(?:\n|$)|REGION(?:\n|$))/.test(block)) continue;
    if (cues.length >= LIMITS.cues) fail('limit', 'Subtitle source exceeds 500 cues.');
    const lines = block.split('\n');
    const timingIndex = lines[0].includes('-->') ? 0 : lines[1]?.includes('-->') ? 1 : -1;
    const sourceCueId = timingIndex === 1 ? lines[0] : null;
    const timingText = timingIndex >= 0 ? lines[timingIndex] : '';
    const match = /^([^\s]+)[ \t]+-->[ \t]+([^\s]+)(?:[ \t]+(.*))?$/.exec(timingText);
    let start, end;
    if (match) { start = parseTime(match[1], format); end = parseTime(match[2], format); }
    else { start = { time: null, anomaly: anomaly(timingText, 'invalid-syntax') }; end = { ...start }; }
    const cue = {
      id: id('source-cue', cues.length), sourceCueId, sourceOrder: cues.length,
      start: start.time, end: end.time, text: timingIndex < 0 ? block : lines.slice(timingIndex + 1).join('\n'),
      timingText, settings: match?.[3] ?? '', anomalies: { start: start.anomaly, end: end.anomaly }, flags: [],
    };
    string(cue.text, `source cue ${cues.length + 1} text`); string(cue.timingText, 'source timing');
    cue.flags = [...timeFlags(cue), ...(!match ? ['invalid-syntax'] : [])];
    cues.push(cue);
  }
  if (!cues.length) fail('subtitle-empty', 'The subtitle source contains no cues.');
  return freeze({ format, cues, warnings: cues.flatMap(cue => cue.flags.map(flag => ({ sourceOrder: cue.sourceOrder, sourceCueId: cue.sourceCueId, flag }))) });
}
function makeSource(media, kind, subtitle) {
  validateMedia(media);
  return { ...clone(media), originalMediaDuration: media.mediaDuration, originalDecodedSampleRate: media.decodedSampleRate, originalDecodedSampleCount: media.decodedSampleCount, kind, declaration: 'user-selected-local-unverified', subtitle };
}
function canonicalRun(input = {}) {
  const supplied = { ...input };
  const phaseMs = { read: 0, decode: 0, download: 0, verify: 0, modelLoad: 0, inference: 0, workerTotal: 0, ...(supplied.phaseMs ?? {}) };
  delete supplied.phaseMs;
  const result = { ...ASR_PROFILE, parameters: { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 }, phaseMs, ...supplied };
  validateRun(result); return result;
}
function validateRun(run) {
  shape(run, ['model', 'revision', 'dtype', 'runtime', 'device', 'parameters', 'phaseMs'], 'run');
  for (const [key, value] of Object.entries(ASR_PROFILE)) if (run[key] !== value) fail('schema', `Unsupported run ${key}.`);
  shape(run.parameters, ['return_timestamps', 'chunk_length_s', 'stride_length_s'], 'run.parameters');
  if (run.parameters.return_timestamps !== 'word' || run.parameters.chunk_length_s !== 30 || run.parameters.stride_length_s !== 5) fail('schema', 'Unsupported ASR parameters.');
  shape(run.phaseMs, ['read', 'decode', 'download', 'verify', 'modelLoad', 'inference', 'workerTotal'], 'run.phaseMs');
  for (const [key, value] of Object.entries(run.phaseMs)) finite(value, `run.phaseMs.${key}`);
}
function rawWordFlags(word) { return [...timeFlags(word), ...(word.start !== null && word.end !== null && word.end - word.start >= 1 ? ['long-word-span'] : [])]; }
function rawText(words) { return words.map(word => word.text).join('').trim(); }
function blankCandidate(index, input) {
  return { id: id('draft-cue', index), rawWordIds: [], sourceRawCueId: null, sourceCueId: null, sourceOrder: index,
    start: null, end: null, text: '', anomalies: { start: null, end: null }, alignment: 'unavailable', flags: [], revision: 0,
    reviewStatus: 'needs-review', segmentation: { kind: 'source-cue', rule: 'source-order' }, ...input };
}
function initialCandidates(raw, kind, originalDuration) {
  if (kind !== 'asr') return raw.cues.map((cue, index) => blankCandidate(index, {
    sourceRawCueId: cue.id, sourceCueId: cue.sourceCueId, sourceOrder: cue.sourceOrder,
    start: cue.start, end: cue.end, text: cue.text, anomalies: clone(cue.anomalies),
  }));
  const groups = []; let group = [];
  for (let index = 0; index < raw.words.length; index++) {
    const word = raw.words[index], previous = group.at(-1), first = group[0];
    if (group.length && (group.length >= 24 || /[.!?]["'”’]?\s*$/.test(previous.text) ||
        previous.end !== null && word.start !== null && word.start - previous.end >= 0.75 ||
        first.start !== null && word.end !== null && word.end - first.start > 6)) { groups.push(group); group = []; }
    group.push(word);
  }
  if (group.length) groups.push(group);
  if (groups.length > LIMITS.cues) fail('limit', 'ASR segmentation exceeds 500 candidate cues.');
  return groups.map((words, index) => {
    const first = words[0], last = words.at(-1);
    const valid = words.every(word => !timeFlags(word).some(flag => BLOCKING_TIME.includes(flag)) && word.start <= originalDuration && word.end <= originalDuration) && words.every((word, i) => i === 0 || word.start >= words[i - 1].end);
    return blankCandidate(index, {
      rawWordIds: words.map(word => word.id), start: first.start, end: last.end, text: rawText(words),
      anomalies: { start: clone(first.anomalies.start), end: clone(last.anomalies.end) }, alignment: valid ? 'valid' : 'unavailable',
      segmentation: { kind: 'asr-rule', rule: 'pause-punctuation-24words-6seconds-v1' },
    });
  });
}
const BLOCKING_TIME = ['missing-time', 'invalid-time', 'negative-time', 'zero-duration', 'reversed-time', 'out-of-bounds'];
const flagContexts = new WeakMap();
function flagContext(draft) {
  let context = flagContexts.get(draft);
  if (!context) { context = { words: new Map(draft.raw.words.map(word => [word.id, word])), cues: new Map(draft.raw.cues.map(cue => [cue.id, cue])) }; if (Object.isFrozen(draft)) flagContexts.set(draft, context); }
  return context;
}
function candidateFlags(candidate, draft, context = flagContext(draft)) {
  const flags = timeFlags(candidate);
  if (candidate.start !== null && candidate.start > draft.source.mediaDuration || candidate.end !== null && candidate.end > draft.source.mediaDuration) flags.push('out-of-bounds');
  if (!candidate.text.trim()) flags.push('empty-text');
  const sourceCue = candidate.sourceRawCueId === null ? null : context.cues.get(candidate.sourceRawCueId);
  if (draft.version === TIMING_DRAFT_VERSION) {
    // Original source risks remain visible after a manual boundary repair, but
    // only the candidate's current range determines playback/export safety.
    for (const flag of sourceCue?.flags ?? []) flags.push(`raw-${flag}`);
    if (sourceCue && Object.values(sourceCue.anomalies).some(item => item?.reason === 'invalid-syntax')) flags.push('raw-invalid-syntax');
    if (Object.values(candidate.anomalies).some(item => item?.reason === 'invalid-syntax')) flags.push('invalid-syntax');
    if (sourceCue && exceedsDuration(sourceCue, draft.source.mediaDuration)) flags.push('raw-out-of-bounds');
    if (sourceCue && exceedsDuration(sourceCue, draft.source.originalMediaDuration)) flags.push('raw-original-out-of-bounds');
  } else if (sourceCue?.flags.includes('invalid-syntax')) flags.push('invalid-syntax');
  const words = candidate.rawWordIds.map(wordId => context.words.get(wordId)).filter(Boolean);
  for (const word of words) for (const flag of word.flags) flags.push(`raw-${flag}`);
  if (words.some(word => word.start !== null && word.start > draft.source.mediaDuration || word.end !== null && word.end > draft.source.mediaDuration)) flags.push('raw-out-of-bounds');
  if (draft.version === TIMING_DRAFT_VERSION && words.some(word => exceedsDuration(word, draft.source.originalMediaDuration))) flags.push('raw-original-out-of-bounds');
  if (words.some((word, index) => index && word.start !== null && words[index - 1].end !== null && word.start < words[index - 1].end)) flags.push('raw-overlap');
  if (candidate.start !== null && candidate.end !== null && draft.candidates.some(other => other.id !== candidate.id && other.start !== null && other.end !== null && Math.max(other.start, candidate.start) < Math.min(other.end, candidate.end))) flags.push('overlap');
  if (candidate.start !== null && draft.candidates.some(other => other.sourceOrder < candidate.sourceOrder && other.start !== null && other.start > candidate.start)) flags.push('out-of-order');
  if (draft.source.mediaDuration !== draft.source.originalMediaDuration) flags.push('duration-revalidated');
  if (draft.source.decodedSampleRate !== draft.source.originalDecodedSampleRate || draft.source.decodedSampleCount !== draft.source.originalDecodedSampleCount) flags.push(draft.source.decodedSampleRate === null ? 'samples-not-redecoded' : 'samples-revalidated');
  return [...new Set(flags)].sort();
}
function exceedsDuration(value, duration) { return value.start !== null && value.start > duration || value.end !== null && value.end > duration; }
function refreshFlags(draft) {
  const context = flagContext(draft);
  for (const cue of draft.candidates) cue.flags = candidateFlags(cue, draft, context);
  return draft;
}
function finish(draft) { refreshFlags(draft); validateDraft(draft); return freeze(draft); }
export async function createSubtitleDraft({ media, text, format, language = '', track = null }) {
  const parsed = parseSubtitleText(text, format);
  string(language, 'language', 256);
  if (track !== null) validateTrack(track);
  const raw = { text: parsed.cues.map(cue => cue.text).join('\n'), words: [], cues: clone(parsed.cues) };
  const draft = { version: DRAFT_VERSION, label: '待审核初稿', source: makeSource(media, track === null ? 'subtitle-file' : 'text-track',
    { format, text, sha256: await sha256Bytes(encoder.encode(text)), language, track: clone(track) }), run: null, raw,
    candidates: initialCandidates(raw, 'subtitle-file', media.mediaDuration), edits: [] };
  return finish(draft);
}
/** A browser-exposed track snapshot; these are not claimed container source bytes. */
export async function createTextTrackDraft({ media, cues, track }) {
  validateTrack(track); array(cues, 'native text track cues', LIMITS.cues);
  if (!cues.length) fail('subtitle-empty', 'The readable text track contains no cues.');
  const sourceCues = cues.map((input, index) => {
    shape(input, ['id', 'text', 'start', 'end'], 'native cue'); string(input.id, 'native cue id'); string(input.text, 'native cue text');
    const start = timeValue(input.start), end = timeValue(input.end);
    const cue = { id: id('source-cue', index), sourceCueId: input.id, sourceOrder: index, start: start.time, end: end.time,
      text: input.text, timingText: '', settings: '', anomalies: { start: start.anomaly, end: end.anomaly }, flags: [] };
    cue.timingText = JSON.stringify({ start: cue.start, end: cue.end, anomalies: cue.anomalies }); cue.flags = timeFlags(cue);
    return cue;
  });
  const text = JSON.stringify({ format: 'native-text-track.snapshot.v1', track: clone(track), cues: sourceCues });
  const raw = { text: sourceCues.map(cue => cue.text).join('\n'), words: [], cues: sourceCues };
  return finish({ version: DRAFT_VERSION, label: '待审核初稿', source: makeSource(media, 'text-track',
    { format: 'text-track', text, sha256: await sha256Bytes(encoder.encode(text)), language: track.language, track: clone(track) }), run: null, raw,
    candidates: initialCandidates(raw, 'text-track', media.mediaDuration), edits: [] });
}
function parseNativeTrackSnapshot(text, track) {
  let snapshot;
  try { snapshot = JSON.parse(text); } catch { fail('schema', 'Native text track snapshot is not JSON data.'); }
  rejectDuplicateKeys(text); checkJSONData(snapshot);
  shape(snapshot, ['format', 'track', 'cues'], 'native track snapshot');
  if (snapshot.format !== 'native-text-track.snapshot.v1' || !equal(snapshot.track, track)) fail('schema', 'Native text track metadata no longer matches its snapshot.');
  validateRaw({ text: '', words: [], cues: snapshot.cues });
  for (const cue of snapshot.cues) {
    if (cue.sourceCueId === null || cue.settings !== '' || !equal(cue.flags, timeFlags(cue)) ||
        cue.timingText !== JSON.stringify({ start: cue.start, end: cue.end, anomalies: cue.anomalies })) fail('schema', 'Native cue timing provenance is inconsistent.');
  }
  return { cues: snapshot.cues };
}
export function createASRDraft({ media, output, run = {} }) {
  if (!output || typeof output !== 'object' || typeof output.text !== 'string') fail('asr-output', 'ASR output must contain its original text and word timestamps.');
  string(output.text, 'raw.text', LIMITS.totalTextUnits);
  const incoming = output.chunks ?? output.words;
  array(incoming, 'ASR words', LIMITS.rawWords);
  if (!incoming.length) fail('asr-empty', 'ASR returned no words; the previous draft is unchanged.');
  const words = incoming.map((word, index) => {
    string(word.text, `raw word ${index + 1} text`);
    const start = timeValue(own(word, 'timestamp') ? word.timestamp?.[0] : word.start);
    const end = timeValue(own(word, 'timestamp') ? word.timestamp?.[1] : word.end);
    const item = { id: id('raw-word', index), text: word.text, start: start.time, end: end.time, anomalies: { start: start.anomaly, end: end.anomaly }, flags: [] };
    item.flags = rawWordFlags(item); return item;
  });
  const raw = { text: output.text, words, cues: [] };
  return finish({ version: DRAFT_VERSION, label: '待审核初稿', source: makeSource(media, 'asr', null), run: canonicalRun(run), raw,
    candidates: initialCandidates(raw, 'asr', media.mediaDuration), edits: [] });
}
function validateTrack(track) {
  shape(track, ['id', 'label', 'language', 'kind'], 'source.subtitle.track');
  for (const key of ['id', 'label', 'language', 'kind']) string(track[key], `track.${key}`, 1024);
}
function validateSource(source) {
  shape(source, ['name', 'mediaSHA256', 'size', 'mime', 'mediaDuration', 'decodedSampleRate', 'decodedSampleCount', 'originalMediaDuration', 'originalDecodedSampleRate', 'originalDecodedSampleCount', 'kind', 'declaration', 'subtitle'], 'source');
  const { originalMediaDuration, originalDecodedSampleRate, originalDecodedSampleCount, kind, declaration, subtitle, ...media } = source;
  validateMedia(media); finite(originalMediaDuration, 'source.originalMediaDuration', Number.MIN_VALUE, LIMITS.mediaSeconds);
  measurements({ mediaDuration: originalMediaDuration, decodedSampleRate: originalDecodedSampleRate, decodedSampleCount: originalDecodedSampleCount }, 'source.originalMeasurements');
  oneOf(kind, ['asr', 'subtitle-file', 'text-track'], 'source.kind');
  if (declaration !== 'user-selected-local-unverified') fail('schema', 'Imported drafts cannot upgrade source verification.');
  if (kind === 'asr') { if (subtitle !== null) fail('schema', 'ASR source cannot supply a subtitle-file identity.'); }
  else {
    shape(subtitle, ['format', 'text', 'sha256', 'language', 'track'], 'source.subtitle');
    oneOf(subtitle.format, ['srt', 'vtt', 'text-track'], 'source.subtitle.format');
    if (subtitle.format === 'text-track' && kind !== 'text-track') fail('schema', 'A native track snapshot must retain its track provenance.'); string(subtitle.text, 'source.subtitle.text', LIMITS.totalTextUnits);
    if (byteLength(subtitle.text) > LIMITS.subtitleBytes) fail('limit', 'Subtitle source exceeds 1 MiB.');
    sha(subtitle.sha256, 'source.subtitle.sha256');
    if (sha256Text(subtitle.text) !== subtitle.sha256) fail('source-identity', 'Subtitle SHA-256 does not match the preserved source text.');
    string(subtitle.language, 'source.subtitle.language', 256);
    if (kind === 'text-track') validateTrack(subtitle.track); else if (subtitle.track !== null) fail('schema', 'File subtitles cannot claim an embedded track.');
  }
}
function flagsArray(flags, path) { array(flags, path, 32); if (flags.some(flag => typeof flag !== 'string') || new Set(flags).size !== flags.length) fail('schema', `${path} must have unique text flags.`); }
function validateRaw(raw) {
  shape(raw, ['text', 'words', 'cues'], 'raw'); string(raw.text, 'raw.text', LIMITS.totalTextUnits);
  array(raw.words, 'raw.words', LIMITS.rawWords); array(raw.cues, 'raw.cues', LIMITS.cues);
  raw.words.forEach((word, index) => {
    shape(word, ['id', 'text', 'start', 'end', 'anomalies', 'flags'], 'raw.word');
    if (word.id !== id('raw-word', index)) fail('schema', 'Raw word IDs must be unique internal IDs in stable order.');
    string(word.text, 'raw.word.text'); checkTimes(word, 'raw.word'); flagsArray(word.flags, 'raw.word.flags');
    if (!equal(word.flags, rawWordFlags(word))) fail('schema', 'Raw word anomaly flags do not match its original times.');
  });
  raw.cues.forEach((cue, index) => {
    shape(cue, ['id', 'sourceCueId', 'sourceOrder', 'start', 'end', 'text', 'timingText', 'settings', 'anomalies', 'flags'], 'raw.cue');
    if (cue.id !== id('source-cue', index) || cue.sourceOrder !== index) fail('schema', 'Source cue internal IDs and order must be stable and unique.');
    if (cue.sourceCueId !== null) string(cue.sourceCueId, 'raw.cue.sourceCueId');
    string(cue.text, 'raw.cue.text'); string(cue.timingText, 'raw.cue.timingText'); string(cue.settings, 'raw.cue.settings'); checkTimes(cue, 'raw.cue'); flagsArray(cue.flags, 'raw.cue.flags');
  });
}
function timingSnapshot(cue) { return { start: cue.start, end: cue.end, anomalies: clone(cue.anomalies) }; }
function snapshot(cue, version = DRAFT_VERSION) {
  return { ...(version === TIMING_DRAFT_VERSION ? timingSnapshot(cue) : {}), text: cue.text, alignment: cue.alignment, revision: cue.revision };
}
function validateSnapshot(value, path, version) {
  shape(value, [...(version === TIMING_DRAFT_VERSION ? ['start', 'end', 'anomalies'] : []), 'text', 'alignment', 'revision'], path);
  if (version === TIMING_DRAFT_VERSION) checkTimes(value, path);
  string(value.text, `${path}.text`);
  oneOf(value.alignment, ['valid', 'stale', 'unavailable'], `${path}.alignment`); integer(value.revision, `${path}.revision`, 0, LIMITS.edits);
}
function validateTimingRange(start, end, duration) {
  finite(duration, 'timing mediaDuration', Number.MIN_VALUE, LIMITS.mediaSeconds);
  finite(start, 'timing start', 0, duration); finite(end, 'timing end', 0, duration);
  if (end <= start) fail('timing-range', 'The end must be later than the start.');
}
function expandedLegacyEdit(edit, baseline) {
  return { ...clone(edit), old: { ...timingSnapshot(baseline), ...clone(edit.old) }, new: { ...timingSnapshot(baseline), ...clone(edit.new) }, mediaDuration: null };
}
function replayEdits(draft, baselines) {
  const timing = draft.version === TIMING_DRAFT_VERSION;
  const baselineById = new Map(baselines.map(cue => [cue.id, cue]));
  if (timing) {
    array(draft.legacyEdits, 'legacyEdits', LIMITS.edits);
    // Preserve the exact v1 history, and prove that its v2 prefix is only a
    // deterministic expansion with original immutable timing snapshots.
    replayEdits({ version: DRAFT_VERSION, edits: draft.legacyEdits }, baselines);
    if (draft.edits.length <= draft.legacyEdits.length || draft.edits[draft.legacyEdits.length]?.kind !== 'timing') fail('schema', 'A v2 draft must begin its new history with a boundary edit.');
    draft.legacyEdits.forEach((edit, index) => {
      if (!equal(draft.edits[index], expandedLegacyEdit(edit, baselineById.get(edit.cueId)))) fail('schema', 'The v2 history must preserve every original v1 edit without changing its meaning.');
    });
  }
  const state = new Map(baselines.map(cue => [cue.id, snapshot(cue, draft.version)]));
  const maxRevision = new Map(baselines.map(cue => [cue.id, 0])); const stack = [];
  draft.edits.forEach((edit, index) => {
    shape(edit, ['id', 'cueId', 'kind', 'old', 'new', 'undoOf', ...(timing ? ['mediaDuration'] : [])], `edits[${index}]`);
    if (edit.id !== id('edit', index) || !state.has(edit.cueId)) fail('schema', 'Edit has an invalid internal ID or candidate reference.');
    oneOf(edit.kind, timing ? ['text', 'timing', 'undo'] : ['text', 'undo'], 'edit.kind');
    validateSnapshot(edit.old, 'edit.old', draft.version); validateSnapshot(edit.new, 'edit.new', draft.version);
    if (timing && edit.kind !== 'timing' && edit.mediaDuration !== null) fail('schema', 'Only a boundary edit may record its validation-time media duration.');
    if (!equal(edit.old, state.get(edit.cueId))) fail('schema', 'Edit history does not match its previous revision.');
    if (edit.kind === 'text' || edit.kind === 'timing') {
      if (edit.undoOf !== null || edit.new.alignment !== 'stale' || edit.new.revision !== maxRevision.get(edit.cueId) + 1) fail('schema', 'Edits must create a stale, distinct new revision.');
      if (edit.kind === 'text') {
        if (edit.new.text === edit.old.text || timing && !equal(timingSnapshot(edit.old), timingSnapshot(edit.new))) fail('schema', 'A text edit must change only the text and its alignment/revision.');
      } else {
        validateTimingRange(edit.new.start, edit.new.end, edit.mediaDuration);
        if (edit.new.text !== edit.old.text || edit.new.start === edit.old.start && edit.new.end === edit.old.end ||
            !equal(edit.new.anomalies, { start: null, end: null })) fail('schema', 'A boundary edit must change only the range and its anomaly/alignment/revision state.');
      }
      maxRevision.set(edit.cueId, edit.new.revision); stack.push(edit);
    } else {
      const original = stack.pop();
      if (!original || edit.undoOf !== original.id || edit.cueId !== original.cueId || !equal(edit.new, original.old)) fail('schema', 'Undo must restore the exact previous time, anomaly, text, and alignment revision.');
    }
    state.set(edit.cueId, edit.new);
  });
  return { state, stack, maxRevision };
}
/** Strict closed schema, provenance, flags, bounds, and complete history validation. */
export function validateDraft(draft) {
  const budget = checkJSONData(draft);
  shape(draft, ['version', 'label', 'source', 'run', 'raw', 'candidates', 'edits', ...(draft?.version === TIMING_DRAFT_VERSION ? ['legacyEdits'] : [])], 'draft');
  if (![DRAFT_VERSION, TIMING_DRAFT_VERSION].includes(draft.version) || draft.label !== '待审核初稿') fail('schema', 'Only unreviewed subtitle-draft.v1 and subtitle-draft.v2 formats are accepted.');
  validateSource(draft.source); validateRaw(draft.raw);
  array(draft.candidates, 'candidates', LIMITS.cues); array(draft.edits, 'edits', LIMITS.edits);
  if (!draft.candidates.length) fail('schema', 'A draft must contain at least one candidate cue.');
  if (draft.source.kind === 'asr') { validateRun(draft.run); if (!draft.raw.words.length || draft.raw.cues.length) fail('schema', 'ASR drafts must preserve raw words only.'); }
  else {
    if (draft.run !== null || draft.raw.words.length) fail('schema', 'Subtitle drafts cannot claim an ASR run.');
    const parsed = draft.source.subtitle.format === 'text-track' ? parseNativeTrackSnapshot(draft.source.subtitle.text, draft.source.subtitle.track) : parseSubtitleText(draft.source.subtitle.text, draft.source.subtitle.format);
    if (!equal(draft.raw.cues, parsed.cues) || draft.raw.text !== parsed.cues.map(cue => cue.text).join('\n')) fail('schema', 'Raw cues must exactly preserve the imported subtitle source.');
  }
  const baselines = initialCandidates(draft.raw, draft.source.kind, draft.source.originalMediaDuration);
  if (baselines.length !== draft.candidates.length) fail('schema', 'Candidate segmentation no longer matches its raw provenance.');
  const history = replayEdits(draft, baselines);
  const context = flagContext(draft);
  draft.candidates.forEach((cue, index) => {
    shape(cue, ['id', 'rawWordIds', 'sourceRawCueId', 'sourceCueId', 'sourceOrder', 'start', 'end', 'text', 'anomalies', 'alignment', 'flags', 'revision', 'reviewStatus', 'segmentation'], 'candidate');
    checkTimes(cue, 'candidate'); string(cue.text, 'candidate.text'); flagsArray(cue.flags, 'candidate.flags');
    const baseline = baselines[index];
    for (const key of ['id', 'rawWordIds', 'sourceRawCueId', 'sourceCueId', 'sourceOrder', ...(draft.version === DRAFT_VERSION ? ['start', 'end', 'anomalies'] : []), 'reviewStatus', 'segmentation']) {
      if (!equal(cue[key], baseline[key])) fail('schema', `Candidate ${index + 1} has invalid ${key} provenance.`);
    }
    if (!equal(snapshot(cue, draft.version), history.state.get(cue.id))) fail('schema', 'Candidate time, anomaly, text, alignment, or revision does not match its edit history.');
    if (!equal(cue.flags, candidateFlags(cue, draft, context))) fail('schema', 'Candidate risks are missing, forged, or stale.');
  });
  validateRevalidationBudget(draft, budget);
  return freeze(draft);
}
// A successful export must reopen after any permitted fresh duration/sample
// measurement. Reserve the worst-case derived metadata growth up front rather
// than truncating source/history or relaxing the published limits at reopen.
const REVALIDATION_FLAGS = ['out-of-bounds', 'raw-out-of-bounds', 'duration-revalidated'];
function revalidationReserve(draft) {
  let textUnits = 0, jsonBytes = 0;
  for (const cue of draft.candidates) {
    const possible = [...REVALIDATION_FLAGS];
    if (!cue.rawWordIds.length && !(draft.version === TIMING_DRAFT_VERSION && cue.sourceRawCueId !== null)) possible.splice(possible.indexOf('raw-out-of-bounds'), 1);
    // These two sample warnings are mutually exclusive. Reserve the longer one.
    possible.push('samples-not-redecoded');
    const maximumText = possible.reduce((sum, flag) => sum + flag.length, 0);
    const actual = cue.flags.filter(flag => REVALIDATION_FLAGS.includes(flag) || flag === 'samples-revalidated' || flag === 'samples-not-redecoded');
    textUnits += maximumText - actual.reduce((sum, flag) => sum + flag.length, 0);
    const stable = cue.flags.filter(flag => !actual.includes(flag));
    jsonBytes += byteLength(JSON.stringify([...stable, ...possible])) - byteLength(JSON.stringify(cue.flags));
  }
  // JSON-number representations can grow while source strings remain unchanged.
  // 32 bytes conservatively bounds finite positive duration <= 60; sample fields
  // are either null or bounded integers (rate <= 768000; count <= 46080000).
  jsonBytes += 32 - JSON.stringify(draft.source.mediaDuration).length;
  jsonBytes += 6 - JSON.stringify(draft.source.decodedSampleRate).length;
  jsonBytes += 8 - JSON.stringify(draft.source.decodedSampleCount).length;
  return { textUnits, jsonBytes };
}
function validateRevalidationBudget(draft, budget) {
  const reserved = revalidationReserve(draft);
  if (budget.textUnits + reserved.textUnits > LIMITS.totalTextUnits) fail('limit', 'Draft text plus reserved measurement diagnostics exceeds 1,000,000 UTF-16 units. The current draft is unchanged.');
  if (budget.jsonBytes + reserved.jsonBytes > LIMITS.jsonBytes) fail('limit', 'Draft JSON plus reserved measurement diagnostics exceeds 8 MiB. The current draft is unchanged.');
  return reserved;
}
export function getDraftBudget(draft) {
  validateDraft(draft);
  const actual = checkJSONData(draft), reserved = revalidationReserve(draft);
  return freeze({ ...actual, reservedTextUnits: reserved.textUnits, reservedJSONBytes: reserved.jsonBytes, textLimit: LIMITS.totalTextUnits, jsonByteLimit: LIMITS.jsonBytes });
}
export function serializeDraft(draft) {
  validateDraft(draft); const json = JSON.stringify(draft);
  if (byteLength(json) > LIMITS.jsonBytes) fail('limit', 'Draft JSON exceeds 8 MiB.');
  return json;
}
// JSON.parse accepts duplicate keys by silently discarding earlier values.
// Scan valid JSON first so the closed import format never discards such data.
function rejectDuplicateKeys(text) {
  let index = 0;
  const whitespace = () => { while (/\s/.test(text[index] ?? '') && index < text.length) index++; };
  const quoted = () => {
    const start = index++;
    while (index < text.length) { const char = text[index++]; if (char === '\\') index++; else if (char === '"') break; }
    return JSON.parse(text.slice(start, index));
  };
  function value(depth) {
    if (depth > 24) fail('schema', 'Draft nesting is too deep.');
    whitespace();
    if (text[index] === '{') {
      index++; whitespace(); const keys = new Set();
      if (text[index] === '}') { index++; return; }
      while (index < text.length) {
        whitespace(); const key = quoted();
        if (keys.has(key)) fail('schema', 'Duplicate JSON object fields are not accepted.');
        keys.add(key); whitespace(); index++; value(depth + 1); whitespace();
        if (text[index++] === '}') return;
      }
    } else if (text[index] === '[') {
      index++; whitespace(); if (text[index] === ']') { index++; return; }
      while (index < text.length) { value(depth + 1); whitespace(); if (text[index++] === ']') return; }
    } else if (text[index] === '"') quoted();
    else { while (index < text.length && !/[\s,}\]]/.test(text[index])) index++; }
  }
  value(0);
}
/** Validate before reading the selected media. The caller swaps its state only on success. */
export async function reopenDraft(jsonOrBytes, mediaFile, measured) {
  let text;
  if (typeof jsonOrBytes === 'string') {
    if (byteLength(jsonOrBytes) > LIMITS.jsonBytes) fail('limit', 'Draft JSON exceeds 8 MiB.'); text = jsonOrBytes;
  } else {
    let bytes;
    if (jsonOrBytes && typeof jsonOrBytes.arrayBuffer === 'function') {
      integer(jsonOrBytes.size, 'draft file size', 1, LIMITS.jsonBytes); bytes = new Uint8Array(await jsonOrBytes.arrayBuffer());
      if (bytes.byteLength !== jsonOrBytes.size) fail('schema', 'Draft bytes changed while being read.');
    } else if (jsonOrBytes instanceof ArrayBuffer) bytes = new Uint8Array(jsonOrBytes);
    else if (ArrayBuffer.isView(jsonOrBytes)) bytes = new Uint8Array(jsonOrBytes.buffer, jsonOrBytes.byteOffset, jsonOrBytes.byteLength);
    else fail('schema', 'Draft input must be UTF-8 JSON text or bytes.');
    if (bytes.byteLength > LIMITS.jsonBytes) fail('limit', 'Draft JSON exceeds 8 MiB.');
    try { text = decoder.decode(bytes); } catch { fail('encoding', 'Draft is not valid UTF-8.'); }
  }
  text = text.replace(/^\uFEFF/, '');
  let parsed; try { parsed = JSON.parse(text); } catch { fail('json', 'Draft is not valid JSON.'); }
  rejectDuplicateKeys(text);
  validateDraft(parsed);
  if (parsed.source.subtitle && await sha256Bytes(encoder.encode(parsed.source.subtitle.text)) !== parsed.source.subtitle.sha256) fail('source-identity', 'The subtitle source SHA-256 does not match its preserved source text.');
  const media = await identifyMedia(mediaFile, measured);
  if (media.size !== parsed.source.size || media.mediaSHA256 !== parsed.source.mediaSHA256) fail('media-identity', 'Select the identical media bytes: both SHA-256 and size must match.');
  return revalidateDuration(parsed, media);
}
export function revalidateDuration(draft, measured) {
  validateDraft(draft); const actual = measurements(measured); const next = clone(draft);
  Object.assign(next.source, actual);
  return finish(next);
}
export function editCueText(draft, cueId, text) {
  validateDraft(draft); string(text, 'edited cue text');
  const original = draft.candidates.find(cue => cue.id === cueId);
  if (!original) fail('cue', 'The selected cue does not exist.');
  if (text === original.text) return draft;
  if (draft.edits.length >= LIMITS.edits) fail('limit', 'The 2,000-edit limit is reached. The current draft is unchanged.');
  const history = replayEdits(draft, initialCandidates(draft.raw, draft.source.kind, draft.source.originalMediaDuration));
  const next = clone(draft), cue = next.candidates.find(candidate => candidate.id === cueId);
  const old = snapshot(cue, next.version); cue.text = text; cue.alignment = 'stale'; cue.revision = history.maxRevision.get(cueId) + 1;
  next.edits.push({ id: id('edit', next.edits.length), cueId, kind: 'text', old, new: snapshot(cue, next.version), undoOf: null, ...(next.version === TIMING_DRAFT_VERSION ? { mediaDuration: null } : {}) });
  return finish(next);
}
/** Atomically save a measured range; neither source times nor word times move. */
export function editCueTiming(draft, cueId, range) {
  validateDraft(draft); checkJSONData(range); shape(range, ['start', 'end'], 'edited cue timing');
  validateTimingRange(range.start, range.end, draft.source.mediaDuration);
  const original = draft.candidates.find(cue => cue.id === cueId);
  if (!original) fail('cue', 'The selected cue does not exist.');
  if (range.start === original.start && range.end === original.end) return draft;
  if (draft.edits.length >= LIMITS.edits) fail('limit', 'The 2,000-edit limit is reached. The current draft is unchanged.');
  const baselines = initialCandidates(draft.raw, draft.source.kind, draft.source.originalMediaDuration);
  const history = replayEdits(draft, baselines), next = clone(draft);
  if (next.version === DRAFT_VERSION) {
    const baselineById = new Map(baselines.map(cue => [cue.id, cue]));
    next.version = TIMING_DRAFT_VERSION;
    next.legacyEdits = clone(next.edits);
    next.edits = next.edits.map(edit => expandedLegacyEdit(edit, baselineById.get(edit.cueId)));
  }
  const cue = next.candidates.find(candidate => candidate.id === cueId), old = snapshot(cue, next.version);
  cue.start = range.start; cue.end = range.end; cue.anomalies = { start: null, end: null };
  cue.alignment = 'stale'; cue.revision = history.maxRevision.get(cueId) + 1;
  next.edits.push({ id: id('edit', next.edits.length), cueId, kind: 'timing', old, new: snapshot(cue, next.version), undoOf: null, mediaDuration: draft.source.mediaDuration });
  return finish(next);
}
export function undoLastEdit(draft) {
  validateDraft(draft);
  const { stack } = replayEdits(draft, initialCandidates(draft.raw, draft.source.kind, draft.source.originalMediaDuration));
  const original = stack.at(-1);
  if (!original) fail('no-undo', 'There is no text or boundary edit to undo.');
  if (draft.edits.length >= LIMITS.edits) fail('limit', 'The 2,000-edit limit is reached. The current draft is unchanged.');
  const next = clone(draft), cue = next.candidates.find(item => item.id === original.cueId), old = snapshot(cue, next.version);
  Object.assign(cue, clone(original.old));
  next.edits.push({ id: id('edit', next.edits.length), cueId: cue.id, kind: 'undo', old, new: snapshot(cue, next.version), undoOf: original.id, ...(next.version === TIMING_DRAFT_VERSION ? { mediaDuration: null } : {}) });
  return finish(next);
}
/** Current, measured range checks; overlap and source ordering are informational. */
export function getCueIssues(draft, cueId) {
  const cue = draft.candidates.find(item => item.id === cueId);
  if (!cue) fail('cue', 'The selected cue does not exist.');
  return candidateFlags(cue, draft);
}
export function canUndo(draft) { return replayEdits(draft, initialCandidates(draft.raw, draft.source.kind, draft.source.originalMediaDuration)).stack.length > 0; }
export function canPlayCue(draft, cueId) { return !getCueIssues(draft, cueId).some(flag => BLOCKING_TIME.includes(flag) || flag === 'invalid-syntax'); }
function vttIssues(cue, draft) {
  const issues = candidateFlags(cue, draft).filter(flag => [...BLOCKING_TIME, 'invalid-syntax', 'empty-text'].includes(flag));
  if (/\n[ \t]*\n/.test(cue.text.replace(/\r\n?/g, '\n')) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(cue.text)) issues.push('vtt-unrepresentable-text');
  if (!issues.length && (Math.round(cue.end * 1000) <= Math.round(cue.start * 1000) || Math.round(cue.end * 1000) / 1000 > draft.source.mediaDuration)) issues.push('vtt-millisecond-precision');
  return issues;
}
function timestamp(seconds) {
  const ms = Math.round(seconds * 1000), hours = Math.floor(ms / 3600000), minutes = Math.floor(ms / 60000) % 60, secs = Math.floor(ms / 1000) % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
export function exportVTT(draft) {
  validateDraft(draft);
  const blockers = draft.candidates.map(cue => ({ id: cue.id, sourceCueId: cue.sourceCueId, sourceOrder: cue.sourceOrder, issues: vttIssues(cue, draft) })).filter(item => item.issues.length);
  if (blockers.length) fail('invalid-cues', `${blockers.length} candidate range(s) block the whole VTT export. JSON preserves all originals and risks.`, blockers);
  const cues = [...draft.candidates].sort((a, b) => a.start - b.start || a.sourceOrder - b.sourceOrder);
  const escaped = text => text.replace(/\r\n?/g, '\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `WEBVTT\n\nNOTE 待审核初稿 · needs-review · source-order retained in JSON; playback sorted by start then source order.\n\n${cues.map(cue => `${cue.id}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${escaped(cue.text)}\n`).join('\n')}`;
}
