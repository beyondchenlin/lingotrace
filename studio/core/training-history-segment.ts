import { BUILTIN_TRAINING_SCHEMA } from './builtin-material.ts';
import { validateTrainingProfile, RULE_VERSION, PACE_RULE_VERSION, type AlignmentToken, type FreezeReason, type InputSource, type TrainingEvent, type TrainingSnapshot, type TrainingSchemaVersion } from './training.ts';

/** A partial observation of one live session, never a replayable TrainingSnapshot. */
export const TRAINING_HISTORY_SEGMENT_VERSION = 'lingotrace-history-segment-v1';
export type TrainingHistoryRedactionReason = 'draft-predates-segment' | 'composition-crossed-boundary' | 'unknown-edit' | 'undo-redo' | 'request-outside-segment' | 'answer-provenance-unknown';
interface FactOrigin {
  readonly sourceEventId: string;
  /** Starts at one in this segment; never the source event's sequence. */
  readonly ordinal: number;
  readonly wallTime: string;
  readonly cueId: string;
}
type AnswerFact = { readonly retention: 'recorded'; readonly answer: string } | { readonly retention: 'redacted'; readonly redactionReason: TrainingHistoryRedactionReason };
export interface TrainingHistoryResult {
  readonly answer: string;
  readonly words: number;
  readonly errors: number;
  readonly accuracy: number;
  readonly alignment: readonly AlignmentToken[];
}
export type TrainingHistoryFact = FactOrigin & (
  | { readonly type: 'timeAdvanced'; readonly deltaMs: number | null; readonly durationCoverage: 'observed' | 'boundary-unknown' | 'frozen' }
  | { readonly type: 'inputObservationSampled' | 'compositionStarted' | 'compositionEnded' }
  | ({ readonly type: 'inputCommitted'; readonly source: InputSource } & ({ readonly retention: 'recorded'; readonly text: string } | { readonly retention: 'redacted'; readonly redactionReason: TrainingHistoryRedactionReason }))
  | { readonly type: 'freezeChanged'; readonly reason: FreezeReason; readonly on: boolean }
  | { readonly type: 'cueChanged'; readonly index: number }
  | { readonly type: 'hintExposed'; readonly kind: 'hint' | 'reveal' }
  | ({ readonly type: 'submitRequested'; readonly attemptId: string } & AnswerFact)
  | ({ readonly type: 'judgmentApplied'; readonly attemptId: string } & (
    | { readonly retention: 'recorded'; readonly result: TrainingHistoryResult }
    | { readonly retention: 'redacted'; readonly redactionReason: TrainingHistoryRedactionReason }
    | { readonly retention: 'unavailable'; readonly reason: 'judgment-not-applied' }
  ))
);
export interface TrainingHistorySegment {
  readonly schemaVersion: typeof TRAINING_HISTORY_SEGMENT_VERSION;
  readonly sessionId: string;
  readonly segmentId: string;
  readonly writerInstanceId: string;
  readonly generation: number;
  readonly material: { readonly id: string; readonly version: string };
  readonly rules: { readonly trainingSchemaVersion: TrainingSchemaVersion; readonly ruleVersion: typeof RULE_VERSION; readonly paceRuleVersion: typeof PACE_RULE_VERSION };
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly coverage: 'partial';
  readonly replayable: false;
  readonly facts: readonly TrainingHistoryFact[];
}
export interface TrainingHistorySegmentOptions {
  readonly segmentId: string;
  readonly writerInstanceId: string;
  readonly generation: number;
  readonly startedAt: string;
}

// Provenance for write admission, not a deserialization or replay facility. Cloning a
// segment deliberately loses this capability; repositories must check before cloning.
const writableSegments = new WeakSet<object>();
export function assertWritableTrainingHistorySegment(value: unknown): asserts value is TrainingHistorySegment {
  if (!value || typeof value !== 'object' || !writableSegments.has(value)) throw new Error('A writable history segment must come from the live projector.');
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
function authenticate(segment: TrainingHistorySegment): TrainingHistorySegment {
  freeze(segment); writableSegments.add(segment); return segment;
}
function timestamp(value: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error('A valid segment timestamp is required.');
}
interface CuePrivacy { text: string; reason: TrainingHistoryRedactionReason | null }
interface ObservedRequest { cueId: string; answer: string | null; reason: TrainingHistoryRedactionReason | null }
interface Composition { cueId: string; crossedBoundary: boolean; ended: boolean }

/**
 * Attach at recording ON and synchronously observe each subsequent live snapshot.
 * Only allowlisted post-cursor facts can leave this class. It never calls the engine,
 * reducer, alignment, clock sampler, submit, reset, or any persistence method.
 */
export class TrainingHistorySegmentProjector {
  private segment: TrainingHistorySegment;
  private cursor: number;
  private lastSourceEventId: string | null;
  private seen = new Set<string>();
  private cues = new Map<string, CuePrivacy>();
  private requests = new Map<string, ObservedRequest>();
  private pending = new Set<string>();
  private resolved = new Set<string>();
  private frozen = new Set<FreezeReason>();
  private composition: Composition | null = null;
  private sawTimeBoundary = false;
  private disposed = false;

  constructor(snapshot: TrainingSnapshot, options: TrainingHistorySegmentOptions) {
    timestamp(options.startedAt);
    if (!options.segmentId || !options.writerInstanceId || !Number.isSafeInteger(options.generation) || options.generation < 0) throw new Error('Segment identity and a nonnegative generation are required.');
    validateTrainingProfile(snapshot);
    if (!snapshot.sessionId || !snapshot.material.cues.length || snapshot.events.some(event => event.schemaVersion !== snapshot.schemaVersion)) throw new Error('A live supported Training profile with matching events is required.');
    if (snapshot.schemaVersion === BUILTIN_TRAINING_SCHEMA) {
      const first = snapshot.events[0];
      if (!first || first.type !== 'sessionStarted') throw new Error('A built-in observation requires its bound session start.');
      validateTrainingProfile({ schemaVersion: first.schemaVersion, material: first.material });
    }
    this.cursor = snapshot.events.length;
    this.lastSourceEventId = snapshot.events.at(-1)?.eventId ?? null;
    for (const event of snapshot.events) this.seen.add(event.eventId);
    for (const cue of snapshot.material.cues) {
      const text = snapshot.drafts[cue.id]?.text ?? '';
      this.cues.set(cue.id, { text, reason: text ? 'draft-predates-segment' : null });
    }
    this.pending = new Set(Object.keys(snapshot.pendingAttempts));
    this.resolved = new Set([...snapshot.attempts.map(attempt => attempt.attemptId), ...snapshot.discardedJudgmentIds]);
    this.frozen = new Set(snapshot.frozenReasons);
    if (this.frozen.has('composition')) this.composition = { cueId: snapshot.material.cues[snapshot.cueIndex].id, crossedBoundary: true, ended: false };
    this.segment = authenticate({
      schemaVersion: TRAINING_HISTORY_SEGMENT_VERSION, sessionId: snapshot.sessionId,
      segmentId: options.segmentId, writerInstanceId: options.writerInstanceId, generation: options.generation,
      material: { id: snapshot.material.id, version: snapshot.material.version },
      rules: { trainingSchemaVersion: snapshot.schemaVersion, ruleVersion: RULE_VERSION, paceRuleVersion: PACE_RULE_VERSION },
      startedAt: options.startedAt, endedAt: null, coverage: 'partial', replayable: false, facts: [],
    });
  }

  getSegment = (): TrainingHistorySegment => this.segment;

  observe = (snapshot: TrainingSnapshot): TrainingHistorySegment => {
    if (this.disposed || this.segment.endedAt !== null) throw new Error('This history segment is no longer observing.');
    validateTrainingProfile(snapshot);
    if (snapshot.schemaVersion !== this.segment.rules.trainingSchemaVersion || snapshot.events.some(event => event.schemaVersion !== this.segment.rules.trainingSchemaVersion)) throw new Error('A history segment cannot cross Training schema profiles.');
    if (snapshot.schemaVersion === BUILTIN_TRAINING_SCHEMA) {
      const first = snapshot.events[0];
      if (!first || first.type !== 'sessionStarted') throw new Error('A built-in observation requires its bound session start.');
      validateTrainingProfile({ schemaVersion: first.schemaVersion, material: first.material });
    }
    if (snapshot.sessionId !== this.segment.sessionId || snapshot.material.id !== this.segment.material.id || snapshot.material.version !== this.segment.material.version) throw new Error('A history segment cannot cross sessions or materials.');
    if (snapshot.events.length < this.cursor) return this.segment; // A stale notification contributes no facts.
    if (this.cursor && snapshot.events[this.cursor - 1]?.eventId !== this.lastSourceEventId) throw new Error('History observation requires an append-only source log.');
    if (snapshot.events.length === this.cursor) return this.segment;
    const appended = snapshot.events.slice(this.cursor);
    const facts: TrainingHistoryFact[] = [];
    for (const event of appended) {
      if (this.seen.has(event.eventId)) continue;
      if (event.sessionId !== this.segment.sessionId || event.type === 'sessionStarted') throw new Error('History observation cannot start another session.');
      const fact = this.project(event, snapshot, this.segment.facts.length + facts.length + 1);
      facts.push(fact);
      this.seen.add(event.eventId);
    }
    this.cursor = snapshot.events.length;
    this.lastSourceEventId = snapshot.events.at(-1)?.eventId ?? null;
    if (facts.length) this.segment = authenticate({ ...this.segment, facts: [...this.segment.facts, ...facts] });
    return this.segment;
  };

  /** Closing only seals this projection; it emits no training event or judgment. */
  close = (endedAt: string): TrainingHistorySegment => {
    if (this.disposed) throw new Error('This history projector has been disposed.');
    if (this.segment.endedAt !== null) return this.segment;
    timestamp(endedAt);
    if (Date.parse(endedAt) < Date.parse(this.segment.startedAt)) throw new Error('A segment cannot close before it starts.');
    this.segment = authenticate({ ...this.segment, endedAt });
    this.clearPrivacyState();
    return this.segment;
  };

  dispose = (): void => { this.clearPrivacyState(); this.disposed = true; };

  private clearPrivacyState(): void {
    this.cues.clear(); this.requests.clear(); this.pending.clear(); this.resolved.clear(); this.frozen.clear(); this.seen.clear();
    this.composition = null; this.lastSourceEventId = null; this.cursor = 0; this.sawTimeBoundary = false;
  }

  private project(event: Exclude<TrainingEvent, { type: 'sessionStarted' }>, snapshot: TrainingSnapshot, ordinal: number): TrainingHistoryFact {
    const origin: FactOrigin = { sourceEventId: event.eventId, ordinal, wallTime: event.wallTime, cueId: event.cueId };
    const cue = this.cues.get(event.cueId);
    if (!cue) throw new Error('Unknown cue in history observation.');
    switch (event.type) {
      case 'timeAdvanced': {
        const durationCoverage = !this.sawTimeBoundary ? 'boundary-unknown' : this.frozen.size ? 'frozen' : 'observed';
        this.sawTimeBoundary = true;
        return { ...origin, type: event.type, deltaMs: durationCoverage === 'observed' ? event.deltaMs : null, durationCoverage };
      }
      case 'inputObservationSampled': return { ...origin, type: event.type };
      case 'compositionStarted':
        this.frozen.add('composition');
        this.composition = { cueId: event.cueId, crossedBoundary: false, ended: false };
        return { ...origin, type: event.type };
      case 'compositionEnded':
        this.frozen.delete('composition');
        if (this.composition?.cueId === event.cueId) this.composition.ended = true;
        return { ...origin, type: event.type };
      case 'freezeChanged':
        if (event.on) this.frozen.add(event.reason); else this.frozen.delete(event.reason);
        return { ...origin, type: event.type, reason: event.reason, on: event.on };
      case 'cueChanged':
        this.frozen.delete('review'); this.frozen.delete('composition'); this.frozen.add('idle'); this.composition = null;
        return { ...origin, type: event.type, index: event.index };
      case 'hintExposed': return { ...origin, type: event.type, kind: event.kind };
      case 'inputCommitted': {
        const previousText = cue.text;
        const composition = this.composition?.cueId === event.cueId ? this.composition : null;
        if (event.text === '') cue.reason = null; // An observed empty draft establishes a new privacy boundary.
        else if (event.source === 'ime' && composition?.crossedBoundary) cue.reason = 'composition-crossed-boundary';
        else if (event.nativeEdit?.inputType === 'historyUndo' || event.nativeEdit?.inputType === 'historyRedo') cue.reason = 'undo-redo';
        else if (cue.reason === null && !knownEdit(event, previousText, composition)) cue.reason = 'unknown-edit';
        cue.text = event.text;
        // The source engine's two input wake-up cases, only for duration eligibility.
        const native = event.nativeEdit;
        const inserted = native && typeof native.data === 'string' && native.data.length > 0 && ((event.source === 'typed' && native.kind === 'input' && native.inputType === 'insertText') || (event.source === 'ime' && native.kind === 'compositionend' && native.inputType === null));
        if (previousText !== event.text || inserted) { this.frozen.delete('idle'); this.frozen.delete('review'); }
        this.composition = null;
        return cue.reason === null
          ? { ...origin, type: event.type, source: event.source, retention: 'recorded', text: event.text }
          : { ...origin, type: event.type, source: event.source, retention: 'redacted', redactionReason: cue.reason };
      }
      case 'submitRequested': {
        const reason = cue.reason ?? (cue.text === event.answer ? null : 'answer-provenance-unknown');
        // Repeated requests are occurrences, not new accepted attempts or freeze boundaries.
        // Read the source disposition instead of reproducing its submission/scoring rules.
        const sourceAccepted = !!snapshot.pendingAttempts[event.attemptId] || snapshot.attempts.some(attempt => attempt.attemptId === event.attemptId) || snapshot.discardedJudgmentIds.includes(event.attemptId);
        if (sourceAccepted && !this.resolved.has(event.attemptId) && !this.pending.has(event.attemptId)) {
          this.requests.set(event.attemptId, { cueId: event.cueId, answer: reason === null ? event.answer : null, reason });
          this.pending.add(event.attemptId); this.frozen.add('checking');
        }
        return reason === null
          ? { ...origin, type: event.type, attemptId: event.attemptId, retention: 'recorded', answer: event.answer }
          : { ...origin, type: event.type, attemptId: event.attemptId, retention: 'redacted', redactionReason: reason };
      }
      case 'judgmentApplied': {
        const request = this.requests.get(event.attemptId);
        if (!this.pending.has(event.attemptId)) return { ...origin, type: event.type, attemptId: event.attemptId, retention: 'unavailable', reason: 'judgment-not-applied' };
        this.pending.delete(event.attemptId);
        this.resolved.add(event.attemptId); this.requests.delete(event.attemptId);
        if (!this.pending.size) this.frozen.delete('checking');
        const attempt = snapshot.attempts.find(value => value.attemptId === event.attemptId);
        if (attempt) this.frozen.add('review');
        const reason = !request ? 'request-outside-segment' : request.reason ?? cue.reason ?? (request.cueId !== event.cueId ? 'answer-provenance-unknown' : null);
        if (reason) return { ...origin, type: event.type, attemptId: event.attemptId, retention: 'redacted', redactionReason: reason };
        if (!attempt) return { ...origin, type: event.type, attemptId: event.attemptId, retention: 'unavailable', reason: 'judgment-not-applied' };
        if (attempt.sessionId !== this.segment.sessionId || attempt.cueId !== request!.cueId || attempt.answer !== request!.answer || attempt.materialId !== this.segment.material.id || attempt.materialVersion !== this.segment.material.version || attempt.ruleVersion !== RULE_VERSION) return { ...origin, type: event.type, attemptId: event.attemptId, retention: 'redacted', redactionReason: 'answer-provenance-unknown' };
        return { ...origin, type: event.type, attemptId: event.attemptId, retention: 'recorded', result: {
          answer: attempt.answer, words: attempt.words, errors: attempt.errors, accuracy: attempt.accuracy,
          alignment: attempt.alignment.map(token => ({ kind: token.kind, position: token.position, expected: token.expected, actual: token.actual })),
        } };
      }
    }
  }
}

/** Recognize only native edits with enough evidence, and never cleanse a tainted draft. */
function knownEdit(event: Extract<TrainingEvent, { type: 'inputCommitted' }>, before: string, composition: Composition | null): boolean {
  const native = event.nativeEdit;
  if (!native || native.version !== 'dom-edit-v1') return false;
  if (event.source === 'ime') return !!composition && !composition.crossedBoundary && composition.ended && native.kind === 'compositionend' && native.inputType === null && typeof native.data === 'string' && isReplacement(before, event.text, native.data);
  if (native.kind !== 'input') return false;
  if (event.source === 'paste') return native.inputType === 'insertFromPaste';
  if (native.inputType === 'insertText' && typeof native.data === 'string' && native.data.length > 0) return isReplacement(before, event.text, native.data);
  if (['deleteContentBackward', 'deleteContentForward', 'deleteWordBackward', 'deleteWordForward', 'deleteByCut'].includes(native.inputType ?? '')) return isReplacement(before, event.text, '');
  return false;
}

/** A possible contiguous native replacement of already-clean text; selection is not inferred. */
function isReplacement(before: string, after: string, inserted: string): boolean {
  for (let start = 0; start <= before.length && start <= after.length; start++) {
    if (start && before[start - 1] !== after[start - 1]) break;
    if (!after.startsWith(inserted, start)) continue;
    const suffix = after.slice(start + inserted.length);
    if (before.length - suffix.length >= start && before.endsWith(suffix)) return true;
  }
  return false;
}
