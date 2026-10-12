/** LingoTrace 06: local, event-sourced practice data. No network or UI dependency. */
export const SCHEMA_VERSION = 'lingotrace-session-v1';
export const RULE_VERSION = 'word-alignment-v3';
export const PACE_RULE_VERSION = 'grapheme-exp-3s-v1';
// Weak references authenticate this module's already-validated immutable snapshots,
// without retaining abandoned sessions or trusting merely matching IDs/sequences.
const validatedSnapshots = new WeakSet<object>();

export interface Cue { readonly id: string; readonly text: string; readonly start: number; readonly end: number }
export interface Material { readonly id: string; readonly version: string; readonly title: string; readonly rights: string; readonly cues: readonly Cue[] }
export const CAFE_MATERIAL: Material = deepFreeze({
  id: 'cafe-original', version: 'cafe-studio-v1', title: '咖啡馆会话',
  rights: '原创练习短句。场景为合成视觉内容，不是真实拍摄。',
  cues: [
    'Could I have a coffee, please?', 'Would you like it hot or iced?',
    'I would like a small hot coffee.', 'Do you have any oat milk?',
    'Yes, we can add some for you.', 'Could I have less sugar, please?',
    'Would you like anything to eat?', 'A slice of bread would be nice.',
    'You can take a seat by the window.', 'I will bring your order over soon.',
    'Thank you for your help today.', 'You are welcome. Enjoy your coffee.',
  ].map((text, index) => ({ id: `cafe-studio-${index + 1}`, text, start: index * 6, end: (index + 1) * 6 })),
});
export const MATERIAL = CAFE_MATERIAL;
export type InputSource = 'typed' | 'paste' | 'ime';
export type FreezeReason = 'idle' | 'paused' | 'listening' | 'composition' | 'background' | 'modal' | 'checking' | 'review';
export interface Conditions {
  readonly exposure: 'first' | 'retry'; readonly hinted: boolean; readonly revealed: boolean;
  readonly pasted: boolean; readonly inputSource: InputSource;
}
export interface AlignmentToken { readonly kind: 'match' | 'replace' | 'missing' | 'extra'; readonly position: number | null; readonly expected: string; readonly actual: string }
export interface AlignmentResult { readonly words: number; readonly errors: number; readonly accuracy: number; readonly alignment: readonly AlignmentToken[] }
export interface Attempt extends AlignmentResult {
  readonly attemptId: string; readonly sessionId: string; readonly roundId: string; readonly cueId: string;
  readonly materialId: string; readonly materialVersion: string; readonly ruleVersion: string;
  readonly reference: string; readonly answer: string; readonly inputVersion: number;
  readonly conditions: Conditions; readonly gain: number; readonly firstCompletion: boolean;
  readonly activeMs: number; readonly wallTime: string; readonly dataset: 'local_interactive';
}
interface EventMeta {
  readonly eventId: string; readonly sessionId: string; readonly sequence: number; readonly wallTime: string;
  /** Active time immediately BEFORE this event; timeAdvanced carries the elapsed delta. */
  readonly activeMs: number; readonly cueId: string; readonly inputVersion: number;
  readonly schemaVersion: typeof SCHEMA_VERSION; readonly ruleVersion: typeof RULE_VERSION;
  readonly paceRuleVersion: typeof PACE_RULE_VERSION; readonly materialId: string; readonly materialVersion: string;
}
export type EventPayload =
  | { readonly type: 'sessionStarted'; readonly material: Material }
  | { readonly type: 'timeAdvanced'; readonly deltaMs: number }
  | { readonly type: 'inputCommitted'; readonly text: string; readonly source: InputSource }
  | { readonly type: 'compositionStarted' }
  | { readonly type: 'compositionEnded' }
  | { readonly type: 'freezeChanged'; readonly reason: FreezeReason; readonly on: boolean }
  | { readonly type: 'cueChanged'; readonly index: number }
  | { readonly type: 'hintExposed'; readonly kind: 'hint' | 'reveal' }
  | { readonly type: 'submitRequested'; readonly attemptId: string; readonly answer: string; readonly draftVersion: number }
  | { readonly type: 'judgmentApplied'; readonly attemptId: string };
export type TrainingEvent = EventMeta & EventPayload;
export interface Draft { readonly text: string; readonly version: number; readonly source: InputSource; readonly hinted: boolean; readonly revealed: boolean; readonly pasted: boolean }
interface PendingAttempt { readonly attemptId: string; readonly cueId: string; readonly answer: string; readonly inputVersion: number; readonly conditions: Conditions }
export interface TrainingSnapshot {
  readonly schemaVersion: typeof SCHEMA_VERSION; readonly sessionId: string; readonly roundId: string;
  readonly material: Material; readonly sequence: number; readonly createdAt: string; readonly cueIndex: number;
  readonly activeMs: number; readonly pace: number; readonly earnedWords: number;
  readonly confirmedPositions: readonly string[]; readonly completedCueIds: readonly string[];
  readonly drafts: Readonly<Record<string, Draft>>; readonly frozenReasons: readonly FreezeReason[];
  readonly pendingAttempts: Readonly<Record<string, PendingAttempt>>; readonly discardedJudgmentIds: readonly string[];
  readonly attempts: readonly Attempt[]; readonly events: readonly TrainingEvent[];
}
const EMPTY_DRAFT: Draft = Object.freeze({ text: '', version: 0, source: 'typed', hinted: false, revealed: false, pasted: false });
export function getDraft(snapshot: TrainingSnapshot): Draft { return snapshot.drafts[snapshot.material.cues[snapshot.cueIndex].id] ?? EMPTY_DRAFT; }
export function getCurrentResult(snapshot: TrainingSnapshot): Attempt | null {
  const cueId = snapshot.material.cues[snapshot.cueIndex].id;
  return [...snapshot.attempts].reverse().find(a => a.cueId === cueId && a.inputVersion === getDraft(snapshot).version) ?? null;
}
export function tokens(text: string): string[] {
  return text.normalize('NFKC').replace(/[’‘ʼ]/g, "'").toLowerCase().match(/[a-z0-9]+(?:'[a-z0-9]+)*/g) ?? [];
}
/** Minimum word edit distance, then maximum genuinely matching target positions. */
export function align(reference: string, answer: string): AlignmentResult {
  const expected = tokens(reference), actual = tokens(answer);
  type Cell = { cost: number; matches: number; kind: AlignmentToken['kind'] };
  const cells: Cell[][] = Array.from({ length: expected.length + 1 }, () => []);
  cells[0][0] = { cost: 0, matches: 0, kind: 'match' };
  for (let i = 1; i <= expected.length; i++) cells[i][0] = { cost: i, matches: 0, kind: 'missing' };
  for (let j = 1; j <= actual.length; j++) cells[0][j] = { cost: j, matches: 0, kind: 'extra' };
  for (let i = 1; i <= expected.length; i++) for (let j = 1; j <= actual.length; j++) {
    const same = expected[i - 1] === actual[j - 1];
    const choices: Cell[] = [
      { cost: cells[i - 1][j - 1].cost + (same ? 0 : 1), matches: cells[i - 1][j - 1].matches + (same ? 1 : 0), kind: same ? 'match' : 'replace' },
      { cost: cells[i - 1][j].cost + 1, matches: cells[i - 1][j].matches, kind: 'missing' },
      { cost: cells[i][j - 1].cost + 1, matches: cells[i][j - 1].matches, kind: 'extra' },
    ];
    // Stable tie order: diagonal, missing, extra after cost and actual match count.
    choices.sort((a, b) => a.cost - b.cost || b.matches - a.matches);
    cells[i][j] = choices[0];
  }
  let i = expected.length, j = actual.length;
  const alignment: AlignmentToken[] = [];
  while (i || j) {
    const kind = cells[i][j].kind;
    if (kind === 'match' || kind === 'replace') { alignment.push({ kind, position: i - 1, expected: expected[--i], actual: actual[--j] }); }
    else if (kind === 'missing') alignment.push({ kind, position: i - 1, expected: expected[--i], actual: '' });
    else alignment.push({ kind, position: null, expected: '', actual: actual[--j] });
  }
  const errors = cells[expected.length][actual.length].cost;
  return { words: expected.length, errors, accuracy: Math.max(0, Math.round(100 * (1 - errors / Math.max(1, expected.length)))), alignment: alignment.reverse() };
}
export function graphemes(text: string): string[] {
  if (typeof Intl.Segmenter === 'function') return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].map(part => part.segment);
  return Array.from(text); // Older runtimes without Segmenter: documented Unicode code-point fallback.
}
export function addedGraphemes(before: string, after: string): number {
  const a = graphemes(before), b = graphemes(after);
  let start = 0, tail = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (tail < a.length - start && tail < b.length - start && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return b.length - start - tail;
}
export function createInitialSnapshot(sessionId: string, material: Material = CAFE_MATERIAL): TrainingSnapshot {
  if (!sessionId || !material.cues.length) throw new Error('A session ID and at least one cue are required.');
  return freezeSnapshot({ schemaVersion: SCHEMA_VERSION, sessionId, roundId: sessionId, material: clone(material), sequence: 0, createdAt: '', cueIndex: 0,
    activeMs: 0, pace: 0, earnedWords: 0, confirmedPositions: [], completedCueIds: [], drafts: {}, frozenReasons: ['idle'], pendingAttempts: {}, discardedJudgmentIds: [], attempts: [], events: [] });
}
function withReason(reasons: readonly FreezeReason[], reason: FreezeReason, on: boolean): FreezeReason[] {
  return on ? [...new Set([...reasons, reason])] : reasons.filter(value => value !== reason);
}
function positionKey(state: TrainingSnapshot, cueId: string, position: number): string {
  return JSON.stringify([state.roundId, state.material.id, state.material.version, cueId, position]);
}
/** Pure immutable reducer. Duplicate IDs are ignored BEFORE all validation or mutation. */
export function reduceTraining(state: TrainingSnapshot, incoming: TrainingEvent): TrainingSnapshot {
  if (state.events.some(event => event.eventId === incoming.eventId)) return state;
  const event = clone(incoming);
  if (!event.eventId || event.sessionId !== state.sessionId || event.sequence !== state.sequence + 1) throw new Error('Invalid session, event ID, or noncontiguous sequence.');
  if (event.schemaVersion !== SCHEMA_VERSION || event.ruleVersion !== RULE_VERSION || event.paceRuleVersion !== PACE_RULE_VERSION) throw new Error('Unsupported event schema or rule version.');
  if (event.materialId !== state.material.id || event.materialVersion !== state.material.version || !Number.isFinite(event.activeMs) || Math.abs(event.activeMs - state.activeMs) > 0.000001) throw new Error('Event material or active-time mismatch.');
  if (!Number.isFinite(Date.parse(event.wallTime))) throw new Error('Invalid wall timestamp.');
  if (!state.events.length && event.type !== 'sessionStarted') throw new Error('The first event must start the session.');
  const cue = state.material.cues[state.cueIndex], draft = getDraft(state);
  if (event.cueId !== cue.id || event.inputVersion !== draft.version) throw new Error('Event cue or input version mismatch.');
  let next: TrainingSnapshot = { ...state, sequence: event.sequence, events: [...state.events, event] };
  switch (event.type) {
    case 'sessionStarted':
      if (state.sequence !== 0 || JSON.stringify(event.material) !== JSON.stringify(state.material)) throw new Error('Invalid session start.');
      next = { ...next, createdAt: event.wallTime }; break;
    case 'timeAdvanced':
      if (!Number.isFinite(event.deltaMs) || event.deltaMs < 0) throw new Error('Elapsed time must be finite and nonnegative.');
      if (!state.frozenReasons.length) next = { ...next, activeMs: state.activeMs + event.deltaMs, pace: state.pace * Math.exp(-event.deltaMs / 3000) };
      break;
    case 'freezeChanged': next = { ...next, frozenReasons: withReason(state.frozenReasons, event.reason, event.on) }; break;
    case 'compositionStarted': next = { ...next, frozenReasons: withReason(state.frozenReasons, 'composition', true) }; break;
    case 'compositionEnded': next = { ...next, frozenReasons: withReason(state.frozenReasons, 'composition', false) }; break;
    case 'inputCommitted': {
      if (state.frozenReasons.includes('composition')) throw new Error('Commit input only after compositionEnded.');
      if (!['typed', 'paste', 'ime'].includes(event.source)) throw new Error('Invalid input source.');
      if (event.text === draft.text) break;
      const reasons = state.frozenReasons.filter(reason => reason !== 'idle' && reason !== 'review');
      const boost = event.source !== 'paste' && !reasons.length ? addedGraphemes(draft.text, event.text) * 20 : 0;
      next = { ...next, pace: state.pace + boost, frozenReasons: reasons, drafts: { ...state.drafts, [cue.id]: {
        ...draft, text: event.text, version: draft.version + 1, source: event.source, pasted: draft.pasted || event.source === 'paste',
      } } }; break;
    }
    case 'cueChanged':
      if (!Number.isInteger(event.index) || event.index < 0 || event.index >= state.material.cues.length) throw new Error('Invalid cue index.');
      next = { ...next, cueIndex: event.index, frozenReasons: withReason(state.frozenReasons.filter(reason => !['review', 'composition'].includes(reason)), 'idle', true) }; break;
    case 'hintExposed': next = { ...next, drafts: { ...state.drafts, [cue.id]: { ...draft, hinted: draft.hinted || event.kind === 'hint', revealed: draft.revealed || event.kind === 'reveal' } } }; break;
    case 'submitRequested': {
      if (!event.attemptId || state.attempts.some(a => a.attemptId === event.attemptId) || state.pendingAttempts[event.attemptId] || state.discardedJudgmentIds.includes(event.attemptId)) break;
      if (event.draftVersion !== draft.version || event.answer !== draft.text || !event.answer.trim() || state.frozenReasons.includes('composition')) throw new Error('Submission does not match the committed draft.');
      const conditions: Conditions = { exposure: state.attempts.some(a => a.cueId === cue.id) ? 'retry' : 'first', hinted: draft.hinted, revealed: draft.revealed, pasted: draft.pasted, inputSource: draft.source };
      next = { ...next, pendingAttempts: { ...state.pendingAttempts, [event.attemptId]: { attemptId: event.attemptId, cueId: cue.id, answer: event.answer, inputVersion: draft.version, conditions } }, frozenReasons: withReason(state.frozenReasons, 'checking', true) }; break;
    }
    case 'judgmentApplied': {
      const pending = state.pendingAttempts[event.attemptId];
      if (!pending) break;
      const pendingAttempts = { ...state.pendingAttempts }; delete pendingAttempts[event.attemptId];
      const reasons = withReason(state.frozenReasons, 'checking', Object.keys(pendingAttempts).length > 0);
      // Both a newer draft and navigating away invalidate the asynchronous judgment.
      if (pending.cueId !== cue.id || pending.inputVersion !== draft.version || pending.answer !== draft.text) {
        next = { ...next, pendingAttempts, frozenReasons: reasons, discardedJudgmentIds: [...state.discardedJudgmentIds, event.attemptId] }; break;
      }
      const result = align(cue.text, pending.answer), confirmed = new Set(state.confirmedPositions);
      let gain = 0;
      for (const token of result.alignment) if (token.kind === 'match' && token.position !== null) {
        const key = positionKey(state, cue.id, token.position); if (!confirmed.has(key)) { confirmed.add(key); gain++; }
      }
      const fullCorrect = result.errors === 0 && result.words > 0;
      const firstCompletion = fullCorrect && !state.completedCueIds.includes(cue.id);
      const attempt: Attempt = { ...result, attemptId: pending.attemptId, sessionId: state.sessionId, roundId: state.roundId, cueId: cue.id,
        materialId: state.material.id, materialVersion: state.material.version, ruleVersion: RULE_VERSION, reference: cue.text, answer: pending.answer,
        inputVersion: pending.inputVersion, conditions: pending.conditions, gain, firstCompletion, activeMs: state.activeMs, wallTime: event.wallTime, dataset: 'local_interactive' };
      next = { ...next, pendingAttempts, frozenReasons: withReason(reasons, 'review', true), confirmedPositions: [...confirmed], earnedWords: state.earnedWords + gain,
        completedCueIds: firstCompletion ? [...state.completedCueIds, cue.id] : state.completedCueIds, attempts: [...state.attempts, attempt] }; break;
    }
  }
  return freezeSnapshot(next, validatedSnapshots.has(state));
}
export const reducer = reduceTraining;
export function replay(events: readonly TrainingEvent[], material?: Material): TrainingSnapshot {
  if (!events.length) throw new Error('Replay requires the sessionStarted event.');
  const first = events[0];
  if (first.type !== 'sessionStarted') throw new Error('Replay requires sessionStarted first.');
  return events.reduce(reduceTraining, createInitialSnapshot(first.sessionId, material ?? first.material));
}
/** O(1) for snapshots proven by this reducer; imported/constructed data is replayed. */
export function validateSnapshot(snapshot: TrainingSnapshot): TrainingSnapshot {
  if (!snapshot.events.length || snapshot.events[0].type !== 'sessionStarted') throw new Error('A persistable snapshot requires sessionStarted.');
  if (validatedSnapshots.has(snapshot)) return snapshot;
  const canonical = replay(snapshot.events, snapshot.material);
  if (canonical.sessionId !== snapshot.sessionId || canonical.sequence !== snapshot.sequence) throw new Error('Snapshot metadata does not match its event log.');
  return canonical;
}
export interface EngineClock { now(): number; wallTime(): string; id(): string }
const defaultClock: EngineClock = { now: () => performance.now(), wallTime: () => new Date().toISOString(), id: () => globalThis.crypto.randomUUID() };
export interface EngineOptions { snapshot?: TrainingSnapshot; material?: Material; sessionId?: string; clock?: EngineClock }
/** useRef + useSyncExternalStore-friendly. Snapshots are referentially stable until an event. */
export class TrainingEngine {
  private snapshot: TrainingSnapshot; private listeners = new Set<() => void>(); private clock: EngineClock; private anchor: number;
  constructor(options: EngineOptions = {}) {
    this.clock = options.clock ?? defaultClock; this.anchor = this.clock.now();
    this.snapshot = options.snapshot ? replay(options.snapshot.events, options.snapshot.material) : createInitialSnapshot(options.sessionId ?? this.clock.id(), options.material);
    if (!options.snapshot) this.emit({ type: 'sessionStarted', material: this.snapshot.material });
    else {
      // Refresh ends a browser composition; only its last committed text survives.
      if (this.snapshot.frozenReasons.includes('composition')) this.emit({ type: 'compositionEnded' });
      // Local deterministic judgments can finish safely after an interrupted transaction.
      for (const attemptId of Object.keys(this.snapshot.pendingAttempts)) this.emit({ type: 'judgmentApplied', attemptId });
      if (!Object.keys(this.snapshot.pendingAttempts).length && this.snapshot.frozenReasons.includes('checking')) this.emit({ type: 'freezeChanged', reason: 'checking', on: false });
    }
  }
  getSnapshot = (): TrainingSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get cue(): Cue { return this.snapshot.material.cues[this.snapshot.cueIndex]; }
  get draft(): string { return getDraft(this.snapshot).text; }
  get currentResult(): Attempt | null { return getCurrentResult(this.snapshot); }
  dispatch = (event: TrainingEvent): TrainingSnapshot => {
    const next = reduceTraining(this.snapshot, event);
    if (next !== this.snapshot) { this.snapshot = next; for (const listener of this.listeners) listener(); }
    return this.snapshot;
  };
  private emit(payload: EventPayload): TrainingSnapshot {
    return this.dispatch({ ...payload, eventId: this.clock.id(), sessionId: this.snapshot.sessionId, sequence: this.snapshot.sequence + 1,
      wallTime: this.clock.wallTime(), activeMs: this.snapshot.activeMs, cueId: this.cue.id, inputVersion: getDraft(this.snapshot).version,
      schemaVersion: SCHEMA_VERSION, ruleVersion: RULE_VERSION, paceRuleVersion: PACE_RULE_VERSION, materialId: this.snapshot.material.id, materialVersion: this.snapshot.material.version });
  }
  /** Sample once a second, and automatically before every real action. Never call from RAF. */
  sampleClock = (): void => {
    const now = this.clock.now(), delta = Math.max(0, now - this.anchor); this.anchor = now;
    if (delta > 0 && !this.snapshot.frozenReasons.length) this.emit({ type: 'timeAdvanced', deltaMs: delta });
  };
  /** Explicit deterministic elapsed delta for a caller-owned monotonic driver or tests. */
  tick = (deltaMs: number): void => {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new Error('Elapsed time must be finite and nonnegative.');
    this.anchor = this.clock.now();
    if (deltaMs > 0 && !this.snapshot.frozenReasons.length) this.emit({ type: 'timeAdvanced', deltaMs });
  };
  input = (text: string, source: InputSource = 'typed'): void => { this.sampleClock(); if (text !== this.draft) this.emit({ type: 'inputCommitted', text, source }); };
  beginComposition = (): void => { this.sampleClock(); if (!this.snapshot.frozenReasons.includes('composition')) this.emit({ type: 'compositionStarted' }); };
  endComposition = (text: string): void => { this.sampleClock(); this.emit({ type: 'compositionEnded' }); this.input(text, 'ime'); };
  setFrozen = (reason: FreezeReason, on: boolean): void => { this.sampleClock(); if (this.snapshot.frozenReasons.includes(reason) !== on) this.emit({ type: 'freezeChanged', reason, on }); };
  exposeHint = (kind: 'hint' | 'reveal'): void => { this.sampleClock(); this.emit({ type: 'hintExposed', kind }); };
  submit = (): Attempt | null => {
    this.sampleClock();
    if (!this.draft.trim() || this.snapshot.frozenReasons.includes('composition')) return null;
    if (this.currentResult) return this.currentResult;
    const attemptId = this.clock.id();
    this.emit({ type: 'submitRequested', attemptId, answer: this.draft, draftVersion: getDraft(this.snapshot).version });
    this.emit({ type: 'judgmentApplied', attemptId });
    return this.snapshot.attempts.find(attempt => attempt.attemptId === attemptId) ?? null;
  };
  nextCue = (index = (this.snapshot.cueIndex + 1) % this.snapshot.material.cues.length): void => {
    this.sampleClock(); if (index !== this.snapshot.cueIndex) this.emit({ type: 'cueChanged', index });
  };
  resetSession = (): void => {
    this.sampleClock(); this.snapshot = createInitialSnapshot(this.clock.id(), this.snapshot.material); this.anchor = this.clock.now();
    this.emit({ type: 'sessionStarted', material: this.snapshot.material });
  };
}
export const METRIC_DEFINITIONS = deepFreeze({
  earnedWords: 'Cumulative distinct matched target positions per session/round and versioned material; retries and corrections never remove credit. Hinted, revealed and pasted conditions remain attached to attempts.',
  completedCues: 'A cue completes only at zero word edit errors, including zero extra words. Case, Unicode compatibility, curly apostrophes and punctuation are normalized.',
  attemptAccuracy: 'max(0, round(100 × (1 − minimum word edit errors / target word count))). Per-attempt transcript comparison, not proficiency, attention, retention or capability.',
  activeMs: 'Monotonic elapsed time while no freeze reason is set. Idle, pause, listening, IME composition, background, modal, judging and review freeze it. This is not an attention measurement.',
  pace: 'Temporary visual energy: +20 per committed typed/IME grapheme added; paste/deletion add no energy. Decays by exp(−activeSeconds / 3). Frozen with active time. Never a durable reward.',
  curves: 'Only observed local attempts/events. No synthetic history and no inferred mastery. First attempts, retries, hint, reveal and paste conditions are preserved separately.',
});
export function deriveCurves(snapshot: TrainingSnapshot) {
  let earnedWords = 0;
  return snapshot.attempts.map(attempt => ({ attemptId: attempt.attemptId, cueId: attempt.cueId, activeMs: attempt.activeMs,
    wallTime: attempt.wallTime, accuracy: attempt.accuracy, earnedWords: earnedWords += attempt.gain, conditions: attempt.conditions }));
}
export interface ExportSnapshot {
  readonly exportVersion: 'lingotrace-export-v1'; readonly exportedAt: string; readonly material: Material;
  readonly metricDefinitions: typeof METRIC_DEFINITIONS; readonly rawEvents: readonly TrainingEvent[];
  readonly attempts: readonly Attempt[]; readonly conditions: readonly { attemptId: string; conditions: Conditions }[];
  readonly session: TrainingSnapshot; readonly curves: ReturnType<typeof deriveCurves>;
}
export function captureExport(snapshot: TrainingSnapshot, exportedAt = new Date().toISOString()): ExportSnapshot {
  return deepFreeze(clone({ exportVersion: 'lingotrace-export-v1' as const, exportedAt, material: snapshot.material, metricDefinitions: METRIC_DEFINITIONS,
    rawEvents: snapshot.events, attempts: snapshot.attempts, conditions: snapshot.attempts.map(a => ({ attemptId: a.attemptId, conditions: a.conditions })), session: snapshot, curves: deriveCurves(snapshot) }));
}
export function csvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
/** Every export component is represented; payload_json preserves the lossless structured record. */
export function makeCSV(snapshot: ExportSnapshot): string {
  type Row = Record<string, unknown>;
  const base = { session_id: snapshot.session.sessionId, material_id: snapshot.material.id, material_version: snapshot.material.version, exported_at: snapshot.exportedAt };
  const rows: Row[] = [
    { ...base, record_type: 'export_metadata', payload_json: JSON.stringify({ exportVersion: snapshot.exportVersion, exportedAt: snapshot.exportedAt }) },
    { ...base, record_type: 'material', payload_json: JSON.stringify(snapshot.material) },
    { ...base, record_type: 'metric_definitions', payload_json: JSON.stringify(snapshot.metricDefinitions) },
    { ...base, record_type: 'session', payload_json: JSON.stringify({ ...snapshot.session, events: undefined, attempts: undefined }) },
    ...snapshot.rawEvents.map(e => ({ ...base, record_type: 'event', id: e.eventId, cue_id: e.cueId, sequence: e.sequence, wall_time: e.wallTime, active_ms: e.activeMs, payload_json: JSON.stringify(e) })),
    ...snapshot.attempts.map(a => ({ ...base, record_type: 'attempt', id: a.attemptId, cue_id: a.cueId, wall_time: a.wallTime, active_ms: a.activeMs, reference: a.reference, answer: a.answer, words: a.words, errors: a.errors, accuracy: a.accuracy, gain: a.gain,
      exposure: a.conditions.exposure, hinted: a.conditions.hinted, revealed: a.conditions.revealed, pasted: a.conditions.pasted, input_source: a.conditions.inputSource, payload_json: JSON.stringify(a) })),
    ...snapshot.conditions.map(c => ({ ...base, record_type: 'conditions', id: c.attemptId, payload_json: JSON.stringify(c) })),
    ...snapshot.curves.map(c => ({ ...base, record_type: 'curve_point', id: c.attemptId, payload_json: JSON.stringify(c) })),
  ];
  const columns = ['record_type', 'session_id', 'material_id', 'material_version', 'exported_at', 'id', 'cue_id', 'sequence', 'wall_time', 'active_ms', 'reference', 'answer', 'words', 'errors', 'accuracy', 'gain', 'exposure', 'hinted', 'revealed', 'pasted', 'input_source', 'payload_json'];
  return '\uFEFF' + [columns.map(csvCell).join(','), ...rows.map(row => columns.map(column => csvCell(row[column])).join(','))].join('\r\n') + '\r\n';
}
/** Build both downloads in one call to guarantee the same event boundary and export timestamp. */
export function exportSession(snapshot: TrainingSnapshot, exportedAt?: string) {
  const captured = captureExport(snapshot, exportedAt);
  return { snapshot: captured, json: JSON.stringify(captured, null, 2), csv: makeCSV(captured) };
}
function clone<T>(value: T): T { return structuredClone(value); }
function freezeSnapshot(value: TrainingSnapshot, validated = true): TrainingSnapshot {
  deepFreeze(value); if (validated) validatedSnapshots.add(value); return value;
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); }
  return value;
}
