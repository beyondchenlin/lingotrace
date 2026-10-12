import {isFreshPreviewSnapshot,validateSnapshot,type TrainingSnapshot} from './training.ts';
import { TrainingHistorySegmentProjector, type TrainingHistorySegment } from './training-history-segment.ts';
import { HistoryWriterBarrierBlockedError, type AutomaticHistoryControl } from './automatic-history-control.ts';
import type { TrainingHistorySegmentPermit } from './repository.ts';

export interface TrainingHistoryRecordingAccess {
  saveSession(snapshot: TrainingSnapshot): Promise<void>;
  enableAutomaticHistory(expectedGeneration: number): Promise<AutomaticHistoryControl>;
  disableAutomaticHistory(expectedGeneration?: number): Promise<void | AutomaticHistoryControl>;
  readAutomaticHistoryControl(): Promise<AutomaticHistoryControl>;
  beginTrainingHistorySegment(segment: TrainingHistorySegment, expectedGeneration: number): Promise<{ permit: TrainingHistorySegmentPermit; segment: TrainingHistorySegment }>;
  saveTrainingHistorySegment(permit: TrainingHistorySegmentPermit, segment: TrainingHistorySegment): Promise<TrainingHistorySegment>;
  revokeTrainingHistorySegment(permit: TrainingHistorySegmentPermit): void;
}
export interface TrainingHistoryRecorderStatus {
  readonly mode: 'unprepared' | 'legacy' | 'off' | 'enabling' | 'segment' | 'awaiting-segment' | 'disposed';
  readonly control: AutomaticHistoryControl | null;
  readonly dirty: boolean;
  readonly pendingWrites: number;
  readonly error: string | null;
}
interface RecorderClock { id(): string; wallTime(): string }
const clock: RecorderClock = { id: () => crypto.randomUUID(), wallTime: () => new Date().toISOString() };

/** Persistence-side adapter only. It never calls an engine command, reducer,
 * clock sample, score function, or replay. Capture is synchronous; only sanitized
 * flushing is asynchronous. No timer is needed for this contract. */
export class TrainingHistoryRecorder {
  private readonly repository: TrainingHistoryRecordingAccess;
  private readonly clock: RecorderClock;
  private readonly writerInstanceId: string;
  private epoch = 0;
  private failureSerial = 0;
  private lastFailure: string | null = null;
  private latest: TrainingSnapshot | null = null;
  private sourceValid = true;
  private projector: TrainingHistorySegmentProjector | null = null;
  private permit: TrainingHistorySegmentPermit | null = null;
  private enabling: Promise<void> | null = null;
  private stopping: Promise<AutomaticHistoryControl | null> | null = null;
  private hasConnected = false;
  private freshPreview = false;
  get isFreshPreview(): boolean { return this.freshPreview; }
  private storedReadOnlyBaseline: TrainingSnapshot | null = null;
  private listeners = new Set<() => void>();
  private state: TrainingHistoryRecorderStatus = Object.freeze({ mode: 'unprepared', control: null, dirty: false, pendingWrites: 0, error: null });
  constructor(repository: TrainingHistoryRecordingAccess, options: { clock?: RecorderClock; writerInstanceId?: string } = {}) {
    this.repository = repository; this.clock = options.clock ?? clock;
    this.writerInstanceId = options.writerInstanceId ?? this.clock.id();
  }
  getSnapshot = (): TrainingHistoryRecorderStatus => this.state;
  /** A read-only locator for already committed normal history. This is not a
   * writer permit or proof of any answer: the review repository must reread and
   * validate the actual saved source under its own privacy transaction. */
  getCommittedReviewSession = (): Readonly<{kind:'full';sessionId:string;generation:0}|{kind:'partial';sessionId:string;segmentId:string;generation:number}> | null => {
    if (!this.latest || !this.sourceValid || this.state.dirty || this.state.pendingWrites || this.state.error) return null;
    if (this.state.mode === 'legacy' && this.state.control?.state === 'legacy-default' && !this.freshPreview) {
      return Object.freeze({kind:'full',sessionId:this.latest.sessionId,generation:0});
    }
    if (this.state.mode !== 'segment' || !this.projector || !this.permit || this.state.control?.state !== 'segment-on') return null;
    const segment=this.projector.getSegment();
    if(segment.sessionId!==this.latest.sessionId||segment.generation!==this.state.control.generation||segment.endedAt!==null)return null;
    return Object.freeze({kind:'partial',sessionId:segment.sessionId,segmentId:segment.segmentId,generation:segment.generation});
  };
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<TrainingHistoryRecorderStatus>) {
    if (patch.error) { this.failureSerial++; this.lastFailure = patch.error; }
    this.state = Object.freeze({ ...this.state, ...patch });
    for (const listener of this.listeners) { try { listener(); } catch { /* Observers cannot undo a privacy fence. */ } }
  }
  private current(token: number) { return this.state.mode !== 'disposed' && this.epoch === token; }
  private detach() {
    if (this.permit) this.repository.revokeTrainingHistorySegment(this.permit);
    this.permit = null; this.projector?.dispose(); this.projector = null;
  }
  /** Called only after the host resolves storage/restore. Reading saved ON does
   * not itself create a segment permit or resume an old partial session. */
  connect(snapshot: TrainingSnapshot, control: AutomaticHistoryControl): void {
    this.storedReadOnlyBaseline = null;
    this.freshPreview = false;
    this.connectSnapshot(snapshot, control, control.state === 'legacy-default');
  }
  /** A new unsaved empty practice may display media without creating history.
   * This is not a saved baseline and cannot produce a committed-source locator.
   * Reconnection is only for this same untouched preview after lifecycle changes. */
  connectFreshPreview(snapshot: TrainingSnapshot, control: AutomaticHistoryControl): void {
    const empty = snapshot.activeMs === 0 && snapshot.attempts.length === 0 && snapshot.earnedWords === 0
      && !Object.keys(snapshot.pendingAttempts).length && !snapshot.events.some(event => event.type === 'inputCommitted' && event.text.length > 0);
    const samePreview = this.freshPreview && this.latest?.sessionId === snapshot.sessionId
      && this.latest.sequence <= snapshot.sequence && JSON.stringify(snapshot.events.slice(0,this.latest.sequence)) === JSON.stringify(this.latest.events);
    if (!empty || !isFreshPreviewSnapshot(snapshot) || JSON.stringify(validateSnapshot(snapshot)) !== JSON.stringify(snapshot) || this.state.mode === 'disposed'
      || this.state.dirty || this.state.pendingWrites || this.state.error || (this.hasConnected && !samePreview)) {
      throw new Error('A fresh preview requires a verified empty practice and cannot discard pending or stored work.');
    }
    this.storedReadOnlyBaseline = null; this.freshPreview = true;
    this.connectSnapshot(snapshot, control, false);
  }
  /** Only the initial, positively loaded complete legacy snapshot can enter
   * clean. Recovery events, generic reconnection and privacy gaps cannot use
   * this entry to erase a dirty or in-flight write. */
  connectRestoredBaseline(snapshot: TrainingSnapshot, control: AutomaticHistoryControl, stored: TrainingSnapshot): void {
    if (this.hasConnected || this.latest || this.state.mode !== 'unprepared' || this.state.dirty || this.state.pendingWrites ||
        control.state !== 'legacy-default' || JSON.stringify(snapshot) !== JSON.stringify(stored)) {
      throw new Error('A clean restore requires the untouched, verified initial stored baseline.');
    }
    this.storedReadOnlyBaseline = snapshot;
    this.connectSnapshot(snapshot, control, false);
  }
  /** bfcache may keep the original passive baseline clean, but may never
   * grant a fresh clean admission. The host also verifies the engine is still
   * passive; any observed fact, write or settings transition revokes this. */
  resumeRestoredBaseline(snapshot: TrainingSnapshot, control: AutomaticHistoryControl): boolean {
    if (!this.storedReadOnlyBaseline || snapshot !== this.storedReadOnlyBaseline || this.latest !== snapshot ||
        this.state.mode !== 'unprepared' || this.state.dirty || this.state.pendingWrites || control.state !== 'legacy-default') return false;
    this.connectSnapshot(snapshot, control, false);
    return true;
  }
  private connectSnapshot(snapshot: TrainingSnapshot, control: AutomaticHistoryControl, dirty: boolean): void {
    if (this.state.mode === 'disposed') throw new Error('The history recorder is disposed.');
    this.hasConnected = true;
    ++this.epoch; this.enabling = null; this.stopping = null; this.detach(); this.latest = snapshot; this.sourceValid = true;
    const mode = control.state === 'legacy-default' ? 'legacy' : control.state === 'segment-on' ? 'awaiting-segment' : 'off';
    this.update({ mode, control, dirty, pendingWrites: 0, error: null });
  }
  observe(snapshot: TrainingSnapshot): void {
    if (this.state.mode === 'disposed' || !this.latest || !this.sourceValid) return;
    if (snapshot.sessionId !== this.latest.sessionId) throw new Error('Connect the new practice explicitly before recording it.');
    // Old observer callbacks may arrive after newer private edits. They must not
    // rewind the baseline used by the next ON projector and backfill those edits.
    if (snapshot.sequence <= this.latest.sequence) return;
    this.storedReadOnlyBaseline = null;
    const rejectSource = () => {
      ++this.epoch; this.enabling = null; this.detach(); this.sourceValid = false;
      this.update({ mode: 'off', dirty: false, pendingWrites: 0, error: '练习记录来源不连续，已停止本页自动记录。当前练习仍可继续。' });
    };
    if (snapshot.material.id !== this.latest.material.id || snapshot.material.version !== this.latest.material.version || snapshot.events.length !== snapshot.sequence || (this.latest.sequence && snapshot.events[this.latest.sequence - 1]?.eventId !== this.latest.events.at(-1)?.eventId)) { rejectSource(); return; }
    const changed = snapshot !== this.latest;
    if(this.freshPreview&&snapshot.events.slice(this.latest.sequence).some(event=>event.type==='inputCommitted'&&event.text.length>0))this.freshPreview=false;
    if (this.projector) {
      try {
        const before = this.projector.getSegment(), next = this.projector.observe(snapshot);
        this.latest = snapshot;
        if (next !== before) this.update({ dirty: true });
      } catch { rejectSource(); }
    } else {
      this.latest = snapshot;
      if (changed && this.state.mode === 'legacy' && !this.freshPreview) this.update({ dirty: true });
    }
  }
  /** Local capture stops before any asynchronous configuration write. */
  turnOff(expectedGeneration = this.state.control?.generation): Promise<void> {
    if (this.state.mode === 'disposed') return Promise.resolve();
    this.storedReadOnlyBaseline = null;
    const token = ++this.epoch; this.enabling = null; this.detach();
    // Set local mode without notifying until the storage fence/queue is reserved.
    this.state = Object.freeze({ ...this.state, mode: 'off', dirty: false, pendingWrites: 0, error: null });
    let resolveReceipt!: (value: AutomaticHistoryControl | null) => void;
    const receipt = new Promise<AutomaticHistoryControl | null>(resolve => { resolveReceipt = resolve; });
    this.stopping = receipt;
    try {
      const request = this.repository.disableAutomaticHistory(expectedGeneration);
      void request.then(async ownControl => {
        // Explicit-generation writes return their own committed receipt. The
        // compatibility no-argument call cannot grant a subsequent ON intent.
        const control = ownControl ?? null;
        if (expectedGeneration !== undefined && !control) throw new Error('OFF did not return its committed configuration receipt.');
        if (this.current(token)) this.update({ control: control ?? this.state.control, error: null });
        resolveReceipt(control);
      }).catch(error => {
        if (this.current(token)) this.update({ error: error instanceof HistoryWriterBarrierBlockedError ? '本页已停止，设置未保存。请关闭旧版训练标签页后重试；其他页面尚未确认停止。' : '本页已停止，设置未保存' });
        resolveReceipt(null);
      });
    } catch {
      if (this.current(token)) this.update({ error: '本页已停止，设置未保存' });
      resolveReceipt(null);
    }
    if (this.current(token)) this.update({});
    return receipt.then(() => { if (this.stopping === receipt) this.stopping = null; });
  }
  /** Explicit ON intent. Starting the projector after configuration commits
   * excludes old OFF events and the pending-enable interval. The host must show
   * that pending state; it must never claim those events were retained. */
  turnOn(expectedGeneration = this.state.control?.generation): Promise<void> {
    if (this.state.mode === 'disposed') return Promise.resolve();
    this.storedReadOnlyBaseline = null;
    if (this.enabling) return this.enabling;
    if (this.state.mode === 'legacy' || this.state.mode === 'segment') return Promise.resolve();
    if (!this.sourceValid) return Promise.reject(new Error('Reconnect a verified practice source before recording.'));
    if (!this.latest || expectedGeneration === undefined) return Promise.reject(new Error('Read recording settings before enabling.'));
    this.freshPreview = false;
    const token = ++this.epoch, precedingOff = this.stopping; this.detach();
    const operation = Promise.resolve().then(async () => {
      if (!this.current(token)) return;
      const ownOff = precedingOff ? await precedingOff : null;
      if (!this.current(token)) return;
      if (precedingOff && !ownOff) throw new Error('The preceding OFF setting was not committed.');
      const control = await this.repository.enableAutomaticHistory(ownOff?.generation ?? expectedGeneration);
      if (!this.current(token) || !this.latest) return;
      if (control.state !== 'segment-on') throw new Error('Recording permission was not granted.');
      // Keep our committed setting receipt even if admission later hits quota.
      // A retry compares against this generation; it grants no segment by itself.
      this.update({ control });
      if (!this.current(token) || !this.latest) return;
      const projector = new TrainingHistorySegmentProjector(this.latest, { segmentId: this.clock.id(), writerInstanceId: this.writerInstanceId,
        generation: control.generation, startedAt: this.clock.wallTime() });
      this.projector = projector;
      const admitted = await this.repository.beginTrainingHistorySegment(projector.getSegment(), control.generation);
      if (!this.current(token)) { this.repository.revokeTrainingHistorySegment(admitted.permit); return; }
      this.permit = admitted.permit;
      this.update({ mode: 'segment', control, dirty: projector.getSegment().facts.length > admitted.segment.facts.length, error: null });
    }).catch(error => {
      if (this.current(token)) { this.detach(); this.update({ mode: 'off', dirty: false, error: error instanceof HistoryWriterBarrierBlockedError ? '记录尚未开启。请关闭旧版训练标签页后重试；当前练习仍可继续。' : '记录未能开启，当前练习仍可继续。请重试，未补录关闭期间内容。' }); }
    }).finally(() => { if (this.enabling === operation) this.enabling = null; });
    this.enabling = operation;
    this.update({ mode: 'enabling', dirty: false, pendingWrites: 0, error: null });
    return operation;
  }
  async flush(): Promise<void> {
    const token = this.epoch, mode = this.state.mode, legacy = this.latest;
    const segment = this.projector?.getSegment(), permit = this.permit;
    if (!this.state.dirty || !legacy || (mode !== 'legacy' && mode !== 'segment')) return;
    if (mode === 'segment' && (!segment || !permit)) return;
    this.storedReadOnlyBaseline = null;
    this.update({ pendingWrites: this.state.pendingWrites + 1, error: null });
    if (!this.current(token)) return;
    try {
      if (mode === 'legacy') await this.repository.saveSession(legacy);
      else await this.repository.saveTrainingHistorySegment(permit!, segment!);
      if (this.current(token)) this.update({ pendingWrites: Math.max(0, this.state.pendingWrites - 1), dirty: mode === 'legacy' ? this.latest !== legacy : this.projector?.getSegment() !== segment });
    } catch {
      if (this.current(token)) this.update({ pendingWrites: Math.max(0, this.state.pendingWrites - 1), dirty: true, error: '这段练习尚未保存。当前练习仍在本页，请重试保存。' });
    }
  }
  /** Admission-only barrier. Ordinary flush callers keep their existing semantics.
   * Drain overlapping writes before judging the new course, then allow one tail
   * capture. Failures are sticky for this barrier even if another writer clears
   * the status later. This never retries a failed write or loops until clean. */
  async flushForTransition(isCurrent: () => boolean, readControl: () => Promise<AutomaticHistoryControl>, signal?: AbortSignal): Promise<() => void> {
    const token = this.epoch, initial = this.latest, mode = this.state.mode, control = this.state.control;
    if (!initial || !control) throw new Error('课程保存边界尚未建立。');
    const material = JSON.stringify(initial.material);
    const failureSerial = this.failureSerial, initialError = this.state.error;
    const checkOwner = () => {
      if (signal?.aborted || !isCurrent() || !this.current(token) || !this.sourceValid || !this.latest ||
          this.latest.sessionId !== initial.sessionId || this.latest.roundId !== initial.roundId ||
          this.latest.cueIndex !== initial.cueIndex || JSON.stringify(this.latest.material) !== material ||
          this.state.mode !== mode || this.state.control?.state !== control.state ||
          this.state.control.generation !== control.generation) throw new Error('课程保存边界已变化，请重新打开恢复；原已存记录保留。');
    };
    const check = () => {
      checkOwner();
      if (initialError || this.failureSerial !== failureSerial) throw new Error(initialError ?? this.lastFailure!);
    };
    const awaitOwned = <T,>(operation: Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
      let finished = false;
      const cleanup = () => { release(); signal?.removeEventListener('abort', ownerChanged); };
      const ownerChanged = () => {
        if (finished) return;
        try { checkOwner(); } catch (error) { finished = true; cleanup(); reject(error); }
      };
      const release = this.subscribe(ownerChanged);
      signal?.addEventListener('abort', ownerChanged, {once: true});
      operation.then(value => { if (!finished) { finished = true; cleanup(); resolve(value); } },
        error => { if (!finished) { finished = true; cleanup(); reject(error); } });
      ownerChanged();
    });
    const settle = async () => {
      if (this.current(token) && !signal?.aborted && isCurrent() && this.state.pendingWrites) await new Promise<void>(resolve => {
        const complete = () => { release(); signal?.removeEventListener('abort', complete); resolve(); };
        const release = this.subscribe(() => {
          if (!this.current(token) || signal?.aborted || !isCurrent() || !this.state.pendingWrites) complete();
        });
        signal?.addEventListener('abort', complete, {once: true});
      });
      check();
    };
    const capture = async () => {
      check();
      await awaitOwned(this.flush());
      await settle();
    };
    check();
    await settle();
    await capture();
    if (this.state.dirty) await capture();
    check();
    const currentControl = await awaitOwned(readControl());
    await settle();
    if (currentControl.state !== control.state || currentControl.generation !== control.generation)
      throw new Error('课程的历史许可已变化，请重新打开恢复；原已存记录保留。');
    // The host must invoke this synchronously after await: a queued callback can
    // revoke ownership or record a failure between our return and its continuation.
    return check;
  }
  /** A navigation or restored bfcache page loses its old local capability.
   * This is not a global OFF setting and never changes the live practice. */
  suspend(): void {
    if (this.state.mode === 'disposed') return;
    if (this.state.dirty || this.state.pendingWrites || this.state.error || !['legacy', 'unprepared'].includes(this.state.mode)) this.storedReadOnlyBaseline = null;
    ++this.epoch; this.enabling = null; this.stopping = null; this.detach();
    this.update({mode:'unprepared',dirty:false,pendingWrites:0,error:null});
  }
  dispose(): void {
    if (this.state.mode === 'disposed') return;
    this.storedReadOnlyBaseline = null;
    ++this.epoch; this.enabling = null; this.stopping = null; this.detach(); this.latest = null;
    this.update({ mode: 'disposed', dirty: false, pendingWrites: 0 }); this.listeners.clear();
  }
}
