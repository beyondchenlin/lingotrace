/**
 * A deliberately bounded WebM recorder profile, not a general-purpose remuxer.
 * Audio TrackEntries and audio blocks become equal-length, zero-filled EBML Void
 * elements. The original Blob is immutable; all video bytes and offsets survive.
 *
 * References: RFC 8794 (VINT, unknown-sized masters, Void and CRC-32),
 * https://www.matroska.org/technical/elements.html and /technical/notes.html.
 * Unsupported structures/codecs/lacing/encryption fail closed. Decoding the
 * returned video in the browser is a separate, required caller-side check.
 */
export const MAX_MUTED_WEBM_BYTES = 256 * 1024 * 1024;
const MAX_ELEMENTS = 500_000, MAX_BLOCKS = 200_000, MAX_TRACKS = 16;
const CHUNK_BYTES = 1024 * 1024;
export class WebmMutedCopyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'WebmMutedCopyError'; this.code = code; }
}
export interface WebmVideoTrack {
  readonly trackNumber: number;
  readonly codec: 'V_VP8' | 'V_VP9';
  readonly width: number;
  readonly height: number;
  readonly defaultDurationNs: number | null;
}
export interface WebmVideoFrame {
  readonly trackNumber: number;
  readonly timestampSeconds: number;
  /** Encoded frame payload only, not its container block header. */
  readonly offset: number;
  readonly byteLength: number;
  readonly keyframe: boolean;
  readonly durationSeconds: number | null;
}
export interface WebmInspection {
  readonly byteLength: number;
  readonly videoTrackCount: number;
  readonly audioTrackCount: number;
  readonly videoFrameCount: number;
  readonly audioBlockCount: number;
  readonly timestampScaleNs: number;
  readonly videoTracks: readonly WebmVideoTrack[];
  readonly dimensions: readonly Readonly<{ trackNumber: number; width: number; height: number }>[];
  readonly videoFrames: readonly WebmVideoFrame[];
  readonly firstVideoTimestampSeconds: number;
  readonly lastVideoTimestampSeconds: number;
  /** Exact final video frame end only when its duration is explicit. */
  readonly durationSeconds: number | null;
  /** Container Duration can include audio tail; it is not a measured video end. */
  readonly containerDurationSeconds: number | null;
}
export interface MutedWebmCopy {
  readonly blob: Blob;
  readonly before: WebmInspection;
  readonly after: WebmInspection;
  readonly removedAudioTracks: number;
  readonly removedAudioBlocks: number;
}
interface Element { id: number; start: number; data: number; end: number; unknown: boolean }
interface Track { number: number; type: number; codec: string; width: number; height: number; defaultDurationNs: number | null; element: Element }
interface Range { start: number; end: number }
interface Parsed { inspection: WebmInspection; removals: Range[] }
const ID = {
  EBML: 0x1a45dfa3, Segment: 0x18538067, Info: 0x1549a966, Tracks: 0x1654ae6b,
  TrackEntry: 0xae, Cluster: 0x1f43b675, SimpleBlock: 0xa3, BlockGroup: 0xa0,
  Block: 0xa1, Void: 0xec, CRC: 0xbf,
};
// Recognizing unsupported Segment children is necessary to close an unknown
// Cluster at a schema boundary. It does not make those structures supported.
const SEGMENT_IDS = new Set([ID.Info, ID.Tracks, ID.Cluster, 0x114d9b74, 0x1c53bb6b, 0x1941a469, 0x1043a770, 0x1254c367]);
function fail(code: string, message: string): never { throw new WebmMutedCopyError(code, message); }
function requireValue(value: boolean, message: string): asserts value { if (!value) fail('INVALID_WEBM', message); }
function unsupported(message: string): never { return fail('UNSUPPORTED_WEBM', message); }
function abort(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException('Muted copy canceled.', 'AbortError'); }
function checkLimit(size: number, maxBytes = MAX_MUTED_WEBM_BYTES): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_MUTED_WEBM_BYTES) throw new TypeError('Invalid WebM byte limit.');
  if (!Number.isSafeInteger(size) || size <= 0) fail('INVALID_WEBM', 'The recording is empty.');
  if (size > maxBytes) fail('WEBM_TOO_LARGE', 'The recording exceeds the bounded muted-copy size limit.');
}
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let b = 0; b < 8; b++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[i] = c >>> 0; }
  return table;
})();
class Parser {
  private elements = 0;
  private blocks = 0;
  private tracks = new Map<number, Track>();
  private uids = new Set<string>();
  private frames: WebmVideoFrame[] = [];
  private removals: Range[] = [];
  private crcByParent = new Map<Element, Element>();
  private scale = 1_000_000;
  private duration: number | null = null;
  private audioBlocks = 0;
  private infoSeen = false;
  private tracksSeen = false;
  private maxSizeLength = 8;
  private readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) { this.bytes = bytes; }

  private vint(pos: number, end: number, id = false, trackNumber = false): { value: number; length: number; unknown: boolean } {
    requireValue(pos < end, 'Truncated EBML integer.');
    const first = this.bytes[pos];
    let mask = 0x80, length = 1;
    while (length <= 8 && !(first & mask)) { mask >>>= 1; length++; }
    requireValue(length <= (id ? 4 : trackNumber ? 8 : this.maxSizeLength) && pos + length <= end, 'Invalid or truncated EBML integer.');
    let value = id ? first : first & (mask - 1);
    let unknown = !id && !trackNumber && value === mask - 1;
    for (let i = 1; i < length; i++) {
      unknown = unknown && this.bytes[pos + i] === 255;
      // Unknown-size VINTs may contain 56 value bits. Recognize them without
      // converting an unsafe integer; any finite size above MAX_SAFE is invalid.
      value = value * 256 + this.bytes[pos + i];
    }
    if (!unknown) requireValue(Number.isSafeInteger(value), 'EBML integer exceeds safe bounds.');
    if (id) {
      const data = first & (mask - 1);
      let allZero = data === 0, allOne = data === mask - 1;
      for (let i = 1; i < length; i++) { allZero &&= this.bytes[pos + i] === 0; allOne &&= this.bytes[pos + i] === 255; }
      requireValue(!allZero && !allOne, 'Reserved EBML element ID.');
    }
    return { value: unknown ? -1 : value, length, unknown };
  }
  private element(pos: number, end: number): Element {
    if (++this.elements > MAX_ELEMENTS) fail('WEBM_TOO_COMPLEX', 'Too many WebM elements.');
    const id = this.vint(pos, end, true), size = this.vint(pos + id.length, end);
    const data = pos + id.length + size.length;
    if (size.unknown) {
      if (id.value !== ID.Segment && id.value !== ID.Cluster) unsupported('Unknown size is supported only for Segment and Cluster.');
      return { id: id.value, start: pos, data, end, unknown: true };
    }
    requireValue(size.value <= end - data, 'Truncated WebM element payload.');
    return { id: id.value, start: pos, data, end: data + size.value, unknown: false };
  }
  private *children(parent: Element, allowed: readonly number[], repeat: readonly number[] = []): Generator<Element> {
    const seen = new Set<number>();
    for (let pos = parent.data; pos < parent.end;) {
      const child = this.element(pos, parent.end);
      requireValue(!child.unknown, 'Unknown-sized nested WebM element.');
      if (child.id === ID.Void) { pos = child.end; yield child; continue; }
      if (child.id === ID.CRC) {
        requireValue(child.end - child.data === 4 && !this.crcByParent.has(parent), 'Invalid or repeated WebM CRC-32.');
        this.crcByParent.set(parent, child);
      } else {
        if (!allowed.includes(child.id)) unsupported(`Unsupported WebM element 0x${child.id.toString(16)}.`);
        requireValue(!seen.has(child.id) || repeat.includes(child.id), 'Repeated singleton WebM element.');
        seen.add(child.id);
      }
      pos = child.end;
      yield child;
    }
  }
  private uint(el: Element, positive = false): number {
    const length = el.end - el.data;
    requireValue(length > 0 && length <= 8, 'Invalid unsigned WebM integer.');
    let value = 0;
    for (let p = el.data; p < el.end; p++) value = value * 256 + this.bytes[p];
    requireValue(Number.isSafeInteger(value) && (!positive || value > 0), 'WebM integer is out of range.');
    return value;
  }
  private sint(el: Element): number {
    const length = el.end - el.data;
    requireValue(length > 0 && length <= 8, 'Invalid signed WebM integer.');
    let value = this.bytes[el.data] & 128 ? -1 : 0;
    for (let p = el.data; p < el.end; p++) value = value * 256 + this.bytes[p];
    requireValue(Number.isSafeInteger(value), 'Signed WebM integer exceeds safe bounds.');
    return value;
  }
  private float(el: Element): number {
    const length = el.end - el.data;
    requireValue(length === 4 || length === 8, 'Invalid WebM float.');
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + el.data, length);
    const value = length === 4 ? view.getFloat32(0) : view.getFloat64(0);
    requireValue(Number.isFinite(value), 'Non-finite WebM float.');
    return value;
  }
  private text(el: Element): string {
    requireValue(el.end - el.data <= 4096, 'WebM string exceeds supported bounds.');
    const raw = this.bytes.subarray(el.data, el.end);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(raw).replace(/\0+$/, ''); }
    catch { return fail('INVALID_WEBM', 'Invalid WebM string.'); }
  }
  private boolean(el: Element): number { const value = this.uint(el); requireValue(value === 0 || value === 1, 'Invalid WebM flag.'); return value; }
  private *crc(parent: Element): Generator<void> {
    const el = this.crcByParent.get(parent);
    if (!el) return;
    let crc = 0xffffffff;
    for (let p = parent.data; p < parent.end; p++) {
      if (p === el.start) p = el.end;
      if (p >= parent.end) break;
      crc = CRC_TABLE[(crc ^ this.bytes[p]) & 255] ^ (crc >>> 8);
      if ((p & 0xffff) === 0) yield;
    }
    const stored = new DataView(this.bytes.buffer, this.bytes.byteOffset + el.data, 4).getUint32(0, true);
    requireValue(((crc ^ 0xffffffff) >>> 0) === stored, 'WebM CRC-32 does not match its content.');
    // Removing all verified optional checksums also removes every affected
    // ancestor checksum, without retaining a stale checksum in the copy.
    this.removals.push({ start: el.start, end: el.end });
    this.crcByParent.delete(parent);
  }
  private *header(el: Element): Generator<void> {
    let docType = '';
    for (const c of this.children(el, [0x4286, 0x42f7, 0x42f2, 0x42f3, 0x4282, 0x4287, 0x4285])) {
      yield;
      if (c.id === ID.Void || c.id === ID.CRC) continue;
      if (c.id === 0x4282) docType = this.text(c);
      else {
        const value = this.uint(c, true);
        if (c.id === 0x42f2 && value !== 4) unsupported('Unsupported EBML maximum ID length.');
        if (c.id === 0x42f3) { if (value > 8) unsupported('Unsupported EBML size length.'); this.maxSizeLength = value; }
        if ((c.id === 0x4286 || c.id === 0x42f7) && value !== 1) unsupported('Unsupported EBML version.');
        if ((c.id === 0x4287 || c.id === 0x4285) && value > 4) unsupported('Unsupported WebM document version.');
      }
    }
    requireValue(docType === 'webm', 'The recording is not a WebM document.');
    yield* this.crc(el);
  }
  private *info(el: Element): Generator<void> {
    for (const c of this.children(el, [0x2ad7b1, 0x4489, 0x4d80, 0x5741, 0x4461, 0x73a4])) {
      yield;
      if (c.id === 0x2ad7b1) { this.scale = this.uint(c, true); requireValue(this.scale <= 1_000_000_000, 'Unsupported timestamp scale.'); }
      else if (c.id === 0x4489) { this.duration = this.float(c); requireValue(this.duration > 0, 'Invalid WebM duration.'); }
      else if (c.id === 0x4d80 || c.id === 0x5741) this.text(c);
      else if (c.id === 0x4461) requireValue(c.end - c.data === 8, 'Invalid WebM date.');
      else if (c.id === 0x73a4) requireValue(c.end - c.data === 16, 'Invalid WebM segment UID.');
    }
    yield* this.crc(el);
  }
  private *colour(el: Element): Generator<void> {
    for (const c of this.children(el, [0x55b1, 0x55b2, 0x55b3, 0x55b4, 0x55b5, 0x55b6, 0x55b7, 0x55b8, 0x55b9, 0x55ba, 0x55bb, 0x55bc, 0x55bd, 0x55d0])) {
      yield;
      if (c.id === 0x55d0) {
        for (const m of this.children(c, [0x55d1, 0x55d2, 0x55d3, 0x55d4, 0x55d5, 0x55d6, 0x55d7, 0x55d8, 0x55d9, 0x55da])) {
          yield; if (m.id !== ID.Void && m.id !== ID.CRC) requireValue(this.float(m) >= 0, 'Invalid video colour metadata.');
        }
        yield* this.crc(c);
      } else if (c.id !== ID.Void && c.id !== ID.CRC) this.uint(c);
    }
    yield* this.crc(el);
  }
  private *video(el: Element): Generator<void, { width: number; height: number }> {
    let width = 0, height = 0, displayWidth: number | null = null, displayHeight: number | null = null;
    for (const c of this.children(el, [0xb0, 0xba, 0x54b0, 0x54ba, 0x54b2, 0x54aa, 0x54bb, 0x54cc, 0x54dd, 0x9a, 0x53b8, 0x53c0, 0x55b0])) {
      yield;
      if (c.id === ID.Void || c.id === ID.CRC) continue;
      if (c.id === 0x55b0) { yield* this.colour(c); continue; }
      const value = this.uint(c);
      if (c.id === 0xb0) width = value;
      else if (c.id === 0xba) height = value;
      else if (c.id === 0x54b0) displayWidth = value;
      else if (c.id === 0x54ba) displayHeight = value;
      else if (c.id === 0x9a) { if (value !== 0 && value !== 2) unsupported('Interlaced video is not supported.'); }
      else if (c.id === 0x53c0) requireValue(value === 0 || value === 1, 'Invalid video alpha flag.');
      else if (value !== 0) unsupported('Cropped, transformed, stereo or alpha video is not supported.');
    }
    requireValue(width > 0 && height > 0 && width <= 16384 && height <= 16384, 'Invalid video dimensions.');
    if ((displayWidth !== null && displayWidth !== width) || (displayHeight !== null && displayHeight !== height)) unsupported('Non-square display geometry is not supported.');
    yield* this.crc(el);
    return { width, height };
  }
  private *audio(el: Element): Generator<void> {
    for (const c of this.children(el, [0xb5, 0x78b5, 0x9f, 0x6264])) {
      yield;
      if (c.id === 0xb5 || c.id === 0x78b5) requireValue(this.float(c) > 0, 'Invalid audio sampling frequency.');
      else if (c.id === 0x9f || c.id === 0x6264) this.uint(c, true);
    }
    yield* this.crc(el);
  }
  private *track(el: Element): Generator<void> {
    let number = 0, type = 0, codec = '', width = 0, height = 0, uid = '', hasAudio = false, hasVideo = false;
    let defaultDurationNs: number | null = null, codecDelay = 0;
    for (const c of this.children(el, [0xd7, 0x73c5, 0x83, 0xb9, 0x88, 0x55aa, 0x9c, 0x23e383, 0x86, 0x63a2, 0xe0, 0xe1, 0x536e, 0x22b59c, 0x22b59d, 0x258688, 0x56aa, 0x56bb, 0x55ee])) {
      yield;
      if (c.id === 0xd7) number = this.uint(c, true);
      else if (c.id === 0x83) type = this.uint(c, true);
      else if (c.id === 0x73c5) {
        requireValue(c.end > c.data && c.end - c.data <= 8, 'Invalid track UID.');
        uid = Array.from(this.bytes.subarray(c.data, c.end), b => b.toString(16).padStart(2, '0')).join('').replace(/^0+/, '');
        requireValue(uid.length > 0, 'Track UID must be nonzero.');
      } else if (c.id === 0x86) codec = this.text(c);
      else if (c.id === 0xe0) { ({ width, height } = yield* this.video(c)); hasVideo = true; }
      else if (c.id === 0xe1) { yield* this.audio(c); hasAudio = true; }
      else if (c.id === 0x23e383) defaultDurationNs = this.uint(c, true);
      else if ([0xb9, 0x88, 0x55aa, 0x9c].includes(c.id)) { const value = this.boolean(c); if (c.id === 0xb9 && !value) unsupported('Disabled tracks are not supported.'); }
      else if ([0x536e, 0x22b59c, 0x22b59d, 0x258688].includes(c.id)) this.text(c);
      else if (c.id === 0x56aa) codecDelay = this.uint(c);
      else if (c.id === 0x56bb || c.id === 0x55ee) this.uint(c);
      else if (c.id === 0x63a2) requireValue(c.end > c.data && c.end - c.data <= CHUNK_BYTES, 'Invalid codec private data.');
    }
    requireValue(number > 0 && !!uid && !this.tracks.has(number) && !this.uids.has(uid), 'Missing or duplicate track identity.');
    if (type === 1) {
      if (codecDelay !== 0) unsupported('Delayed video tracks are not supported.');
      if (codec !== 'V_VP8' && codec !== 'V_VP9') unsupported('Only VP8 and VP9 video are supported.');
      requireValue(hasVideo && !hasAudio, 'Invalid video track settings.');
    } else if (type === 2) {
      if (codec !== 'A_OPUS' && codec !== 'A_VORBIS') unsupported('Only Opus and Vorbis audio tracks are supported.');
      requireValue(hasAudio && !hasVideo, 'Invalid audio track settings.');
      this.removals.push({ start: el.start, end: el.end });
    } else unsupported('Only video and audio tracks are supported.');
    if (this.tracks.size >= MAX_TRACKS) fail('WEBM_TOO_COMPLEX', 'Too many recording tracks.');
    this.tracks.set(number, { number, type, codec, width, height, defaultDurationNs, element: el });
    this.uids.add(uid);
    yield* this.crc(el);
  }
  private block(el: Element, clusterTime: number, group: Element | null, duration: number | null, hasReference: boolean): void {
    if (++this.blocks > MAX_BLOCKS) fail('WEBM_TOO_COMPLEX', 'Too many recording blocks.');
    const trackId = this.vint(el.data, el.end, false, true);
    requireValue(!trackId.unknown && trackId.value > 0, 'Invalid block track number.');
    const track = this.tracks.get(trackId.value);
    requireValue(!!track, 'Block references a missing track.');
    const header = el.data + trackId.length;
    requireValue(el.end - header >= 4, 'Truncated or empty recording block.');
    const flags = this.bytes[header + 2];
    if (flags & 0x06) unsupported('Laced recording blocks are not supported.');
    requireValue((flags & (group ? 0xf1 : 0x70)) === 0, 'Invalid reserved block flags.');
    let relative = this.bytes[header] * 256 + this.bytes[header + 1];
    if (relative & 0x8000) relative -= 0x10000;
    const timestamp = clusterTime + relative;
    requireValue(Number.isSafeInteger(timestamp), 'Block timestamp exceeds safe bounds.');
    if (track.type === 2) {
      this.audioBlocks++;
      this.removals.push({ start: (group ?? el).start, end: (group ?? el).end });
    } else {
      requireValue(timestamp >= 0, 'Negative video timestamp is unsupported.');
      const seconds = timestamp * (this.scale / 1e9);
      requireValue(Number.isFinite(seconds), 'Invalid video timestamp.');
      this.frames.push(Object.freeze({ trackNumber: track.number, timestampSeconds: seconds, offset: header + 3,
        byteLength: el.end - header - 3, keyframe: group ? !hasReference : !!(flags & 0x80),
        durationSeconds: duration === null ? (track.defaultDurationNs === null ? null : track.defaultDurationNs / 1e9) : duration * (this.scale / 1e9) }));
    }
  }
  private *group(el: Element, time: number): Generator<void> {
    let block: Element | null = null, duration: number | null = null, reference = false, padding = 0;
    for (const c of this.children(el, [ID.Block, 0x9b, 0xfb, 0xfa, 0x75a2], [0xfb])) {
      yield;
      if (c.id === ID.Block) block = c;
      else if (c.id === 0x9b) duration = this.uint(c, true);
      else if (c.id === 0xfb) { this.sint(c); reference = true; }
      else if (c.id === 0xfa) this.uint(c);
      else if (c.id === 0x75a2) padding = this.sint(c);
    }
    requireValue(!!block, 'BlockGroup has no Block.');
    if (padding && this.tracks.get(this.vint(block.data, block.end, false, true).value)?.type !== 2) unsupported('Video discard padding is not supported.');
    this.block(block, time, el, duration, reference);
    yield* this.crc(el);
  }
  private *cluster(el: Element): Generator<void, number> {
    let time: number | null = null;
    const seen = new Set<number>();
    for (let pos = el.data; pos < el.end;) {
      const c = this.element(pos, el.end);
      yield;
      if (el.unknown && SEGMENT_IDS.has(c.id)) { el.end = pos; break; }
      requireValue(!c.unknown, 'Unexpected unknown-sized Cluster child.');
      if (c.id === 0xe7 || c.id === 0xa7 || c.id === 0xab || c.id === ID.CRC) {
        requireValue(!seen.has(c.id), 'Repeated singleton Cluster element.'); seen.add(c.id);
      }
      if (c.id === 0xe7) time = this.uint(c);
      else if (c.id === ID.SimpleBlock || c.id === ID.BlockGroup) {
        requireValue(time !== null, 'Cluster timestamp must precede its recording blocks.');
        if (c.id === ID.SimpleBlock) this.block(c, time, null, null, false);
        else yield* this.group(c, time);
      } else if (c.id === 0xa7 || c.id === 0xab) this.uint(c);
      else if (c.id === ID.CRC) { requireValue(c.end - c.data === 4, 'Invalid Cluster CRC-32.'); this.crcByParent.set(el, c); }
      else if (c.id !== ID.Void) unsupported(`Unsupported Cluster element 0x${c.id.toString(16)}.`);
      pos = c.end;
    }
    requireValue(time !== null, 'Cluster has no timestamp.');
    yield* this.crc(el);
    return el.end;
  }
  *parse(): Generator<void, Parsed> {
    const header = this.element(0, this.bytes.length);
    requireValue(header.id === ID.EBML && !header.unknown, 'The recording has no valid EBML header.');
    yield* this.header(header);
    let pos = header.end;
    let segment = this.element(pos, this.bytes.length);
    while (segment.id === ID.Void) { pos = segment.end; segment = this.element(pos, this.bytes.length); yield; }
    requireValue(segment.id === ID.Segment && segment.end === this.bytes.length, 'Expected exactly one complete WebM Segment.');
    let clustered = false;
    for (pos = segment.data; pos < segment.end;) {
      const c = this.element(pos, segment.end);
      yield;
      if (c.id === ID.Info) {
        requireValue(!this.infoSeen && !clustered, 'Repeated or late WebM Info.'); this.infoSeen = true; yield* this.info(c);
      } else if (c.id === ID.Tracks) {
        requireValue(!this.tracksSeen && !clustered, 'Repeated or late WebM Tracks.'); this.tracksSeen = true;
        for (const t of this.children(c, [ID.TrackEntry], [ID.TrackEntry])) { yield; if (t.id === ID.TrackEntry) yield* this.track(t); }
        yield* this.crc(c);
      } else if (c.id === ID.Cluster) {
        requireValue(this.infoSeen && this.tracksSeen, 'Info and Tracks must precede Clusters.'); clustered = true; yield* this.cluster(c);
      } else if (c.id === ID.CRC) {
        requireValue(c.end - c.data === 4 && !this.crcByParent.has(segment), 'Invalid Segment CRC-32.'); this.crcByParent.set(segment, c);
      } else if (c.id !== ID.Void) unsupported(`Unsupported Segment element 0x${c.id.toString(16)}.`);
      pos = c.end;
    }
    yield* this.crc(segment);
    requireValue(this.infoSeen && this.tracksSeen && this.frames.length > 0, 'WebM has no usable video recording frames.');
    const videoTracks = Array.from(this.tracks.values()).filter(t => t.type === 1).map(t => Object.freeze({ trackNumber: t.number,
      codec: t.codec as 'V_VP8' | 'V_VP9', width: t.width, height: t.height, defaultDurationNs: t.defaultDurationNs }));
    requireValue(videoTracks.length > 0, 'WebM has no supported video track.');
    let first = Infinity, last = -Infinity, videoEnd = 0, endKnown = true;
    for (const frame of this.frames) {
      first = Math.min(first, frame.timestampSeconds); last = Math.max(last, frame.timestampSeconds);
      if (frame.durationSeconds === null) endKnown = false;
      else videoEnd = Math.max(videoEnd, frame.timestampSeconds + frame.durationSeconds);
    }
    const containerDurationSeconds = this.duration === null ? null : this.duration * (this.scale / 1e9);
    requireValue(containerDurationSeconds === null || (Number.isFinite(containerDurationSeconds) && containerDurationSeconds >= last), 'Container duration is shorter than its video timeline.');
    return { inspection: Object.freeze({ byteLength: this.bytes.length, videoTrackCount: videoTracks.length,
      audioTrackCount: this.tracks.size - videoTracks.length, videoFrameCount: this.frames.length, audioBlockCount: this.audioBlocks,
      timestampScaleNs: this.scale, videoTracks: Object.freeze(videoTracks), dimensions: Object.freeze(videoTracks.map(t => Object.freeze({ trackNumber: t.trackNumber, width: t.width, height: t.height }))),
      videoFrames: Object.freeze(this.frames), firstVideoTimestampSeconds: first, lastVideoTimestampSeconds: last,
      durationSeconds: endKnown ? videoEnd : null, containerDurationSeconds }), removals: this.removals };
  }
}
/** Pure structural inspection; does not decode compressed video or mutate bytes. */
export function inspectWebm(bytes: Uint8Array): WebmInspection {
  checkLimit(bytes.byteLength);
  const steps = new Parser(bytes).parse();
  for (;;) { const next = steps.next(); if (next.done) return next.value.inspection; }
}
function abortableRead(promise: Promise<ArrayBuffer>, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(new DOMException('Muted copy canceled.', 'AbortError')); };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) onAbort();
  });
}
async function yieldControl(signal?: AbortSignal): Promise<void> {
  abort(signal);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  abort(signal);
}
async function parseAsync(bytes: Uint8Array, signal?: AbortSignal): Promise<Parsed> {
  const steps = new Parser(bytes).parse();
  for (let work = 0;; work++) {
    abort(signal);
    const next = steps.next();
    if (next.done) return next.value;
    if (work % 512 === 511) await yieldControl(signal);
  }
}
/** Size-preserving EBML Void header. The rest of its original region is zeroed. */
function voidHeader(length: number): Uint8Array {
  for (let width = 1; width <= 8; width++) {
    const payload = length - 1 - width;
    if (payload < 0 || payload >= 2 ** (7 * width) - 1) continue;
    const result = new Uint8Array(width + 1); result[0] = ID.Void;
    let n = payload;
    for (let i = width; i > 0; i--) { result[i] = n % 256; n = Math.floor(n / 256); }
    result[1] |= 1 << (8 - width);
    return result;
  }
  return fail('INVALID_WEBM', 'Cannot replace a WebM element safely.');
}
/**
 * Makes an independent browser-local copy. Bound: 256 MiB input; one mutable
 * input-sized buffer plus the returned Blob, 1 MiB read scratch and bounded
 * metadata. No fetch, recorder, audio graph, storage writes or re-encoding.
 */
export async function createMutedWebmCopy(source: Blob, options: { signal?: AbortSignal; maxBytes?: number } = {}): Promise<MutedWebmCopy> {
  const { signal } = options;
  abort(signal);
  checkLimit(source.size, options.maxBytes);
  const mime = source.type.split(';', 1)[0].trim().toLowerCase();
  if (mime && mime !== 'video/webm' && mime !== 'audio/webm' && mime !== 'application/octet-stream') unsupported('Only WebM recordings can be copied without audio.');
  const bytes = new Uint8Array(source.size);
  for (let offset = 0; offset < source.size; offset += CHUNK_BYTES) {
    abort(signal);
    const part = new Uint8Array(await abortableRead(source.slice(offset, Math.min(source.size, offset + CHUNK_BYTES)).arrayBuffer(), signal));
    abort(signal); bytes.set(part, offset);
    await yieldControl(signal);
  }
  const parsed = await parseAsync(bytes, signal), before = parsed.inspection;
  // Keep outermost ranges; nested CRCs in removed tracks/groups are redundant.
  const ranges = parsed.removals.sort((a, b) => a.start - b.start || b.end - a.end);
  const removals: Range[] = [];
  for (const range of ranges) {
    const previous = removals[removals.length - 1];
    if (previous && range.start < previous.end) { requireValue(range.end <= previous.end, 'Overlapping WebM removal ranges.'); continue; }
    removals.push(range);
  }
  // A disjoint interval proof guarantees no encoded video byte can be modified.
  // The second inspection below also proves headers and timestamps are unchanged.
  const frames = [...before.videoFrames].sort((a, b) => a.offset - b.offset);
  for (let f = 0, r = 0; f < frames.length && r < removals.length;) {
    const frame = frames[f], range = removals[r];
    if (frame.offset + frame.byteLength <= range.start) f++;
    else if (range.end <= frame.offset) r++;
    else fail('INVALID_WEBM', 'An audio removal overlaps encoded video.');
  }
  for (let i = 0; i < removals.length; i++) {
    const range = removals[i];
    for (let p = range.start; p < range.end; p += CHUNK_BYTES) {
      bytes.fill(0, p, Math.min(p + CHUNK_BYTES, range.end));
      if (range.end - range.start > CHUNK_BYTES) await yieldControl(signal);
    }
    bytes.set(voidHeader(range.end - range.start), range.start);
    if (i % 256 === 255) await yieldControl(signal);
  }
  const after = (await parseAsync(bytes, signal)).inspection;
  requireValue(after.audioTrackCount === 0 && after.audioBlockCount === 0 && after.videoFrameCount === before.videoFrameCount, 'Muted WebM verification failed.');
  requireValue(after.videoTracks.length === before.videoTracks.length && after.timestampScaleNs === before.timestampScaleNs, 'Video track verification failed.');
  for (let i = 0; i < before.videoFrames.length; i++) {
    const a = before.videoFrames[i], b = after.videoFrames[i];
    requireValue(a.offset === b.offset && a.byteLength === b.byteLength && a.trackNumber === b.trackNumber && a.timestampSeconds === b.timestampSeconds && a.durationSeconds === b.durationSeconds && a.keyframe === b.keyframe, 'Video timeline verification failed.');
    if (i % 2048 === 2047) await yieldControl(signal);
  }
  abort(signal);
  const blob = new Blob([bytes], { type: 'video/webm' });
  abort(signal);
  return Object.freeze({ blob, before, after, removedAudioTracks: before.audioTrackCount, removedAudioBlocks: before.audioBlockCount });
}
