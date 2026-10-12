import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createOriginalCourseMediaPool, createContextBookmarkPreviewController, isVerifiedCourseMediaLease } from './context-bookmark-media.ts';
import { captureBodyReadDiagnostic, reviewBodyReadDiagnostic } from './media-load-diagnostic.ts';

// Native Response/ReadableStream fixtures. No browser/network is exercised.
const origin = 'https://lesson.example';
const chunks = [new TextEncoder().encode('first fixture chunk'), new Uint8Array(1025).fill(173), new TextEncoder().encode('last fixture chunk')];
const allBytes = Buffer.concat(chunks);
const sha = createHash('sha256').update(allBytes).digest('hex');
const variant = { url: `/studio-assets/body/${sha}.mp4`, mediaId: 'body-fixture-playback', mediaSha256: sha };
const media = { url: '/studio-assets/body/original.mp4', mediaId: 'body-fixture-original', mediaSha256: 'a'.repeat(64), playbackVariant: variant, allowVerifiedDirect: true };
const tick = () => new Promise(resolve => setImmediate(resolve));
function response(body = allBytes, headers = {}) {
  const result = new Response(body, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(allBytes.length), ...headers } });
  // Synthetic identity only; keep native Response body getters/blob() behavior.
  Object.defineProperties(result, { type: { value: 'basic' }, url: { value: origin + variant.url } });
  return result;
}
function setup(makeResponse) {
  const calls = { fetches: 0, digests: 0, hashedBytes: 0, created: [], revoked: [], signal: null };
  const pool = createOriginalCourseMediaPool({ origin,
    fetch: async (url, { signal, redirect }) => {
      calls.fetches++; calls.signal = signal; assert.equal(url, origin + variant.url); assert.equal(redirect, 'error');
      return makeResponse(signal);
    },
    digest: async bytes => { calls.digests++; calls.hashedBytes += bytes.byteLength; return webcrypto.subtle.digest('SHA-256', bytes); },
    createObjectURL: blob => { calls.created.push(blob); return 'blob:verified-body-fixture'; },
    revokeObjectURL: url => calls.revoked.push(url),
  }, media);
  return { pool, calls };
}
async function bodyFailure(s, expected) {
  await assert.rejects(s.pool.acquire(), error => {
    assert.match(error.message, /^原片未能加载，请手动重试。 \[fetch; BODY\] \[body-v1;/);
    for (const field of expected) assert.ok(error.message.includes(field), `${field}: ${error.message}`);
    assert.doesNotMatch(error.message, /PRIVATE|https?:|cookie|answer|stack/);
    assert.ok(error.message.length < 240); return true;
  });
  await tick(); // No automatic retry or delayed URL/capability creation.
  assert.equal(s.calls.fetches, 1); assert.equal(s.calls.digests, 0); assert.deepEqual(s.calls.created, []); assert.deepEqual(s.calls.revoked, []);
}

for (const failure of [new TypeError('PRIVATE https://secret.example/?cookie=answer'), new RangeError('PRIVATE'), new DOMException('PRIVATE', 'AbortError'), { name: 'PRIVATE_NAME', message: 'PRIVATE' }]) {
  test(`native body rejection keeps a bounded kind ${failure.name}`, async () => {
    const r = response(new ReadableStream({ start(controller) { controller.error(failure); } }));
    const expectedKind = ['TypeError', 'RangeError', 'AbortError'].includes(failure.name) ? failure.name : 'other';
    await bodyFailure(setup(() => r), [`kind=${expectedKind}`, 'aborted=false', 'used=false', 'locked=false', 'status=200', `length=${allBytes.length}`, 'encoding=none']);
    assert.equal(r.bodyUsed, true); // Diagnostic retains pre-consumption state.
  });
}

test('partial native stream failure remains BODY and cannot hash or issue a media lease', async () => {
  let streamController;
  const r = response(new ReadableStream({ start(controller) { streamController = controller; } }));
  const s = setup(() => r), failed = bodyFailure(s, ['kind=TypeError', 'used=false', 'locked=false']);
  await tick(); assert.equal(r.bodyUsed, true);
  streamController.enqueue(chunks[0]); await tick();
  streamController.error(new TypeError('PRIVATE incomplete body')); await failed;
});

test('already consumed native response reports used=true without another fetch, digest or URL', async () => {
  const r = response(); await r.blob();
  await bodyFailure(setup(() => r), ['kind=TypeError', 'used=true', `locked=${r.body.locked}`]);
});

test('locked native stream reports locked=true and does not release the foreign reader', async () => {
  const r = response(), reader = r.body.getReader();
  try {
    await bodyFailure(setup(() => r), ['kind=TypeError', 'used=false', 'locked=true']);
    assert.equal(r.body.locked, true);
  } finally { reader.releaseLock(); }
});

test('last caller cancellation remains AbortError, with no BODY wrapper or late media resource', async () => {
  let streamController;
  const r = response(new ReadableStream({ start(controller) { streamController = controller; } }));
  const s = setup(signal => {
    signal.addEventListener('abort', () => streamController.error(new DOMException('PRIVATE', 'AbortError')), { once: true });
    return r;
  });
  const caller = new AbortController(), pending = s.pool.acquire({ signal: caller.signal });
  await tick(); assert.equal(r.bodyUsed, true); caller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError' && !error.message.includes('BODY'));
  await tick(); assert.equal(s.calls.signal.aborted, true); assert.equal(s.calls.fetches, 1); assert.equal(s.calls.digests, 0); assert.deepEqual(s.calls.created, []);
});

test('canceling one borrower retains a native full body for the other, with one real complete SHA', async () => {
  let streamController;
  const s = setup(() => response(new ReadableStream({ start(controller) { streamController = controller; } })));
  const caller = new AbortController(), canceled = s.pool.acquire({ signal: caller.signal }), kept = s.pool.acquire();
  await tick(); caller.abort(); await assert.rejects(canceled, { name: 'AbortError' });
  assert.equal(s.calls.signal.aborted, false);
  for (const chunk of chunks) streamController.enqueue(chunk); streamController.close();
  const lease = await kept;
  assert.equal(lease.verified, true); assert.equal(lease.actualSha256, sha); assert.equal(s.calls.fetches, 1); assert.equal(s.calls.digests, 1); assert.equal(s.calls.hashedBytes, allBytes.length);
  assert.deepEqual(Buffer.from(await s.calls.created[0].arrayBuffer()), allBytes);
  assert.equal(isVerifiedCourseMediaLease(lease.toVerifiedDirect(), media, origin), true);
  lease.release(); assert.deepEqual(s.calls.revoked, ['blob:verified-body-fixture']);
});

test('a complete native response with a changed byte still fails SHA and issues no direct capability', async () => {
  const changed = Buffer.from(allBytes); changed[0] ^= 1;
  const s = setup(() => response(changed)), lease = await s.pool.acquire();
  assert.equal(s.calls.fetches, 1); assert.equal(s.calls.digests, 1); assert.equal(s.calls.hashedBytes, changed.length);
  assert.equal(lease.verified, false); assert.match(lease.verificationError, /SHA256_MISMATCH/); assert.equal(lease.toVerifiedDirect, undefined); assert.equal(lease.verifiedResourceUrl, undefined); lease.release();
});

test('BODY detail survives the existing controller message flattening without source assignment or playback', async () => {
  const s = setup(() => response(new ReadableStream({ start(controller) { controller.error(new TypeError('PRIVATE')); } })));
  class Video extends EventTarget {
    src = ''; currentSrc = ''; duration = NaN; readyState = 0; plays = 0;
    pause() {} load() {} removeAttribute() { this.src = ''; } play() { this.plays++; return Promise.resolve(); }
  }
  const video = new Video(), controller = createContextBookmarkPreviewController({ pool: s.pool, video, media, origin, validateReference: () => null });
  controller.select({ materialId: 'fixture', materialVersion: 'v1', cueId: 'cue-1', text: 'PRIVATE answer', startSeconds: 0, endSeconds: 1, mediaId: media.mediaId, mediaSha256: media.mediaSha256 });
  await controller.load();
  assert.equal(controller.getState().phase, 'error'); assert.match(controller.getState().error, /\[fetch; BODY\] \[body-v1; kind=TypeError;/); assert.doesNotMatch(controller.getState().error, /PRIVATE|answer|https?:/);
  assert.equal(video.src, ''); assert.equal(video.plays, 0); assert.equal(s.calls.fetches, 1); assert.equal(s.calls.digests, 0); controller.dispose();
});

test('diagnostic captures only approved getters/headers, never reads or locks the stream', async () => {
  const r = response(), requested = [], forbidden = () => { throw Error('Unapproved read'); };
  const before = captureBodyReadDiagnostic({ bodyUsed: r.bodyUsed, body: r.body, status: r.status,
    headers: { get(name) { requested.push(name); return r.headers.get(name); } },
    get url() { return forbidden(); }, get cookie() { return forbidden(); }, get answer() { return forbidden(); },
  });
  assert.deepEqual(requested, ['content-length', 'content-encoding']); assert.equal(r.bodyUsed, false); assert.equal(r.body.locked, false);
  const diagnostic = reviewBodyReadDiagnostic({ name: 'TypeError', get message() { return forbidden(); }, get stack() { return forbidden(); }, get cause() { return forbidden(); } }, true, before);
  assert.match(diagnostic, /kind=TypeError; aborted=true; used=false; locked=false; status=200/);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), allBytes);
});

for (const [length, expected] of [['0', 0], ['19581425', 19581425], ['9007199254740991', 9007199254740991], ['9007199254740992', 'unknown'], ['1e7', 'unknown'], ['-1', 'unknown'], ['PRIVATE', 'unknown'], ['12345678901234567', 'unknown'], [null, 'unknown']]) {
  test(`content length allowlist ${length}`, () => {
    const captured = captureBodyReadDiagnostic({ headers: { get: key => key === 'content-length' ? length : null } });
    assert.equal(captured.length, expected); assert.equal(captured.encoding, 'none');
  });
}
for (const [encoding, expected] of [[null, 'none'], [undefined, 'unknown'], ['identity', 'identity'], ['gzip', 'gzip'], ['br', 'br'], ['deflate', 'deflate'], ['zstd', 'zstd'], [' GZIP ', 'gzip'], ['gzip, br', 'other'], ['PRIVATE https://secret.example', 'other']]) {
  test(`content encoding is an enum: ${encoding}`, () => {
    const captured = captureBodyReadDiagnostic({ headers: { get: () => encoding } });
    assert.equal(captured.encoding, expected); assert.doesNotMatch(reviewBodyReadDiagnostic({}, false, captured), /PRIVATE|https?:/);
  });
}
for (const status of [NaN, Infinity, -1, 0, 99, 600, 200.5, '200']) {
  test(`non-HTTP status is unknown: ${status}`, () => assert.equal(captureBodyReadDiagnostic({ status }).status, 'unknown'));
}

test('throwing or unavailable optional getters cannot mask BODY or affect a valid verified load', async () => {
  const throwing = { get bodyUsed() { throw Error('PRIVATE'); }, get body() { throw Error('PRIVATE'); }, get status() { throw Error('PRIVATE'); }, get headers() { throw Error('PRIVATE'); } };
  const captured = captureBodyReadDiagnostic(throwing);
  assert.deepEqual(captured, { used: 'unknown', locked: 'unknown', status: 'unknown', length: 'unknown', encoding: 'unknown' });
  assert.match(reviewBodyReadDiagnostic({ get name() { throw Error('PRIVATE'); } }, false, captured), /kind=other/);
  const r = response(); Object.defineProperty(r, 'bodyUsed', { get() { throw Error('PRIVATE'); } });
  const s = setup(() => r), lease = await s.pool.acquire(); assert.equal(lease.verified, true); assert.equal(s.calls.digests, 1); lease.release();
});
