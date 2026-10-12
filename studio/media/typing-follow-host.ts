import { createTypingFollowState, reduceTypingFollow, sameTypingFollowIdentity, TYPING_FOLLOW_TUNING, type TypingFollowState, type TypingFollowEnvironment, type TypingFollowEvent, type TypingFollowIntent, type TypingFollowScope, type TypingFollowInterrupt, type TypingFollowAppend } from '../core/typing-follow-policy.ts';

type Media = Pick<HTMLMediaElement, 'currentSrc' | 'currentTime' | 'playbackRate' | 'paused' | 'pause' | 'seekable' | 'readyState' | 'error'>;
type RateWrite = { ownerId: string; epoch: number; commandId: number; expected: number };
type NativeKind = 'play' | 'playing' | 'pause' | 'seeking' | 'ratechange';
type Ticket = { kind: NativeKind; scope: TypingFollowScope; commandId: number; value?: number };
export interface TypingFollowPorts {
  media(): Media | null;
  context(): Omit<TypingFollowEnvironment, 'rateWriteOwner'>;
  /** Revoke previous request and claim a new lease BEFORE issuing any media command. */
  claim(): void;
  /** Existing source-authenticated guard must check current before/after every await. */
  play(intent: TypingFollowIntent, current: () => boolean, prepare: () => boolean, issued: () => void, pause: () => void): Promise<boolean>;
  /** Clear only the matching authenticated owner; do not touch a newer request. */
  release(scope: TypingFollowScope): void;
  changed(state: TypingFollowState, nativeRate: number | null): void;
  schedule(callback: () => void, ms: number): unknown;
  unschedule(handle: unknown): void;
}
/** Serial native adapter. All authority is scoped to identity, source URL, epoch and command. */
export class TypingFollowHost {
  private state = createTypingFollowState();
  private rateWrite: RateWrite | null = null;
  private source: { scope: TypingFollowScope; url: string } | null = null;
  private buffering: TypingFollowScope | null = null;
  private initialSeek: { scope: TypingFollowScope; commandId: number; prepared: boolean; durationSeconds: number } | null = null;
  private tickets: Ticket[] = [];
  private timer: unknown = null;
  private queue: TypingFollowEvent[] = [];
  private reducing = false;
  private disposed = false;
  private lastPlayCommand = 0;
  private lastAnnouncement = '';
  constructor(private readonly ports: TypingFollowPorts) {}
  get snapshot() { return this.state; }
  get active() { return !!this.state.active; }
  private context(): TypingFollowEnvironment {
    const env = this.ports.context(), write = this.rateWrite, media = this.ports.media();
    const mediaBuffering = !!this.buffering && this.state.phase === 'following' && !this.state.active?.pendingPlay &&
      this.state.active?.scope.epoch === this.buffering.epoch && this.ownsWith(this.buffering, env) &&
      !!media && media.readyState >= 1 && !media.error && !media.paused;
    // Restored frame readiness does not end the original command's ownership
    // checks. Keep its rate and metadata guard until pending play settles.
    const initialSeekValid = this.ownsInitialSeek(env);
    return { ...env, mediaReady: env.mediaReady && !!media && media.readyState >= 2 && !media.error && (!this.initialSeek || initialSeekValid), mediaBuffering, mediaInitialSeekCommandId: initialSeekValid ? this.initialSeek!.commandId : null, rateWriteOwner: write && Math.abs(env.mediaRate - write.expected) < 1e-6 ? write : null };
  }
  private ownsInitialSeek(env: Omit<TypingFollowEnvironment, 'rateWriteOwner'>) {
    const seek = this.initialSeek, active = this.state.active, pending = active?.pendingPlay, media = this.ports.media();
    return !!seek && this.state.phase === 'starting' && !!active && !!pending && pending.initial &&
      pending.commandId === seek.commandId && active.scope.epoch === seek.scope.epoch && this.ownsWith(seek.scope, env) &&
      Number.isFinite(env.nowMs) && env.nowMs >= pending.issuedMs &&
      Number.isFinite(env.mediaDurationSeconds) && Math.abs(env.mediaDurationSeconds - seek.durationSeconds) <= TYPING_FOLLOW_TUNING.durationToleranceSeconds &&
      !!media && media.readyState >= 1 && !media.error &&
      // Position admission remains in playable(), and terminal positions must reach
      // the reducer's sentence-ended/outside-cue handling at play settlement.
      (seek.prepared ? this.ownsCurrentRate() : media.playbackRate === active.baseRate);
  }
  private ownsWith(scope: TypingFollowScope, env: Omit<TypingFollowEnvironment, 'rateWriteOwner'>) {
    return !this.disposed && env.playbackOwnerId === scope.ownerId &&
      sameTypingFollowIdentity(env.identity, scope.identity) &&
      this.source?.scope.epoch === scope.epoch && this.source.scope.ownerId === scope.ownerId &&
      this.ports.media()?.currentSrc === this.source.url;
  }
  private owns(scope: TypingFollowScope) { return this.ownsWith(scope, this.ports.context()); }
  private eligible(scope: TypingFollowScope, observedBuffering = false) {
    if (!this.owns(scope) || this.state.active?.scope.epoch !== scope.epoch) return false;
    const env = this.context();
    return env.referenceShown && env.mode === 'legacy-typing' && !env.listeningPlayerActive &&
      env.recording === 'idle' && !env.composing && env.focused && env.visible && env.practiceActive &&
      !env.blocked && env.sourceVerified && env.inputProvenanceAvailable && (env.mediaReady || observedBuffering || (env.mediaInitialSeekCommandId != null && env.mediaInitialSeekCommandId === this.state.active?.pendingPlay?.commandId)) &&
      Number.isFinite(env.mediaDurationSeconds) && env.mediaDurationSeconds >= scope.identity.cueEndSeconds;
  }
  private ownsCurrentRate() {
    const active = this.state.active, write = this.rateWrite, media = this.ports.media();
    return !!active && !!write && !!media && write.ownerId === active.scope.ownerId && write.epoch === active.scope.epoch &&
      write.commandId === active.rateWrite.commandId && Math.abs(media.playbackRate - write.expected) < 1e-6;
  }
  private playable(intent: TypingFollowIntent, settling = false) {
    const media = this.ports.media();
    return (!settling || (this.ports.context().mediaReady && !!media && media.readyState >= 2 && !media.error)) &&
      this.eligible(intent.scope) && this.state.active?.pendingPlay?.commandId === intent.commandId &&
      !!media && media.currentTime >= intent.scope.identity.cueStartSeconds && media.currentTime < intent.scope.identity.cueEndSeconds;
  }
  start(explicitUserGesture: boolean, initialEdit?: TypingFollowAppend) {
    if (this.disposed || !explicitUserGesture) return;
    if (this.active) this.stop();
    this.ports.claim();
    this.send({ type: 'start', explicitUserGesture, ...(initialEdit ? { initialEdit } : {}) });
  }
  stop(reason: TypingFollowInterrupt = 'manual-pause') { this.send({ type: 'interrupt', epoch: this.state.epoch, reason }); }
  input(edit: TypingFollowAppend) { this.send({ type: 'input', epoch: this.state.epoch, edit }); }
  compositionStart(id: number) { this.send({ type: 'composition-start', epoch: this.state.epoch, compositionId: id }); }
  compositionCancel(id: number) { this.send({ type: 'composition-cancel', epoch: this.state.epoch, compositionId: id }); }
  tick() { this.send({ type: 'tick', epoch: this.state.epoch }); }
  private send(event: TypingFollowEvent) {
    if (this.disposed) return;
    this.queue.push(event); if (this.reducing) return;
    this.reducing = true;
    try {
      while (this.queue.length) {
        const next = this.queue.shift()!, previous = this.state;
        const decision = reduceTypingFollow(previous, next, this.context());
        this.state = decision.state;
        if (this.state.phase !== 'following' || !this.state.active || this.buffering?.epoch !== this.state.active.scope.epoch ||
          this.buffering.ownerId !== this.state.active.scope.ownerId) this.buffering = null;
        if (this.state.phase !== 'starting' || this.state.active?.pendingPlay?.commandId !== this.initialSeek?.commandId ||
          this.state.active?.scope.epoch !== this.initialSeek?.scope.epoch) this.initialSeek = null;
        if (next.type === 'start' && this.state.active) this.source = { scope: this.state.active.scope, url: this.ports.media()?.currentSrc ?? '' };
        for (const intent of decision.intents) this.apply(intent);
        if (previous.active && !this.state.active) { this.ports.release(previous.active.scope); this.rateWrite = null; }
      }
    } finally { this.reducing = false; this.publish(); this.arm(); }
  }
  private expect(kind: NativeKind, intent: TypingFollowIntent, value?: number) {
    this.tickets.push({ kind, scope: intent.scope, commandId: intent.commandId, value });
    if (this.tickets.length > 24) this.tickets.splice(0, this.tickets.length - 24);
  }
  private writeRate(intent: TypingFollowIntent & { rate: number }) {
    const media = this.ports.media(); if (!media || !this.owns(intent.scope)) return false;
    if (media.playbackRate !== intent.rate) this.expect('ratechange', intent, intent.rate);
    this.rateWrite = { ownerId: intent.scope.ownerId, epoch: intent.scope.epoch, commandId: intent.commandId, expected: intent.rate };
    try { media.playbackRate = intent.rate; } catch { this.rateWrite = null; return false; }
    return Math.abs(media.playbackRate - intent.rate) < 1e-6;
  }
  private pause(intent: TypingFollowIntent) {
    const media = this.ports.media(); if (!media || !this.owns(intent.scope)) return;
    if (!media.paused) this.expect('pause', intent);
    media.pause();
  }
  private apply(intent: TypingFollowIntent) {
    const media = this.ports.media(); if (!media || !this.owns(intent.scope)) return;
    if (intent.type === 'pause') { this.pause(intent); return; }
    if (intent.type === 'restore-base-rate') {
      const write = this.rateWrite;
      if (write?.ownerId === intent.scope.ownerId && write.epoch === intent.scope.epoch &&
        write.commandId === intent.onlyIfRateCommandId && write.expected === intent.onlyIfRateEquals && Math.abs(media.playbackRate - intent.onlyIfRateEquals) < 1e-6) this.writeRate(intent);
      return;
    }
    if (intent.type === 'set-rate') {
      if (!this.eligible(intent.scope, this.context().mediaBuffering === true)) { this.stop('unattributed-native-event'); return; }
      const write = this.rateWrite;
      if (!write || write.ownerId !== intent.scope.ownerId || write.epoch !== intent.scope.epoch || write.commandId !== intent.onlyIfRateCommandId || write.expected !== intent.onlyIfRateEquals || Math.abs(media.playbackRate - intent.onlyIfRateEquals) >= 1e-6) { this.stop('manual-rate'); return; }
      if (!this.writeRate(intent)) { this.pause(intent); this.stop('media-error'); return; }
      this.send({ type: 'rate-applied', epoch: intent.scope.epoch, commandId: intent.commandId }); return;
    }
    // Revoke audible ordinary playback synchronously, before source admission can await.
    if (intent.type === 'start-cue') this.pause(intent);
    this.lastPlayCommand = intent.commandId;
    const current = () => {
      const pending = this.state.active?.pendingPlay, now = this.ports.context().nowMs;
      return this.eligible(intent.scope) && pending?.commandId === intent.commandId &&
        Number.isFinite(now) && now >= pending.issuedMs && now - pending.issuedMs < TYPING_FOLLOW_TUNING.playTimeoutMs;
    };
    const prepare = () => {
      if (!current()) return false;
      if (intent.type === 'start-cue') {
        if (media.playbackRate !== this.state.active?.baseRate) { this.stop('manual-rate'); return false; }
        let seekable = false;
        for (let i = 0; i < media.seekable.length; i++) if (intent.atSeconds >= media.seekable.start(i) && intent.atSeconds <= media.seekable.end(i)) seekable = true;
        if (!seekable) return false;
        // Readiness was required above. Only this admitted, original seek may
        // temporarily drop to HAVE_METADATA while its bounded play decodes.
        this.initialSeek = { scope: intent.scope, commandId: intent.commandId, prepared: false, durationSeconds: this.ports.context().mediaDurationSeconds };
        this.expect('seeking', intent, intent.atSeconds);
        media.currentTime = intent.atSeconds; // The only Follow position write.
        if (!current() || !this.writeRate(intent)) { this.initialSeek = null; return false; }
        if (this.initialSeek?.commandId === intent.commandId) this.initialSeek.prepared = true;
      }
      if (!this.playable(intent)) return false;
      if (media.paused) { this.expect('play', intent); this.expect('playing', intent); }
      return true;
    };
    let nativeStarted = false;
    const issued = () => { nativeStarted = !media.paused; };
    const forgetUnfulfilledPlay = () => { this.tickets = this.tickets.filter(ticket => ticket.commandId !== intent.commandId || ticket.scope.epoch !== intent.scope.epoch || ticket.scope.ownerId !== intent.scope.ownerId || (ticket.kind !== 'playing' && (ticket.kind !== 'play' || nativeStarted))); };
    void this.ports.play(intent, current, prepare, issued, () => this.pause(intent)).then(ok => {
      if (!ok) forgetUnfulfilledPlay();
      if (!this.owns(intent.scope)) return;
      if (!current()) { if (this.lastPlayCommand === intent.commandId) this.pause(intent); return; }
      this.send({ type: 'play-result', epoch: intent.scope.epoch, commandId: intent.commandId, ok: ok && this.playable(intent, true) });
    }, () => {
      forgetUnfulfilledPlay();
      if (this.owns(intent.scope) && current()) this.send({ type: 'play-result', epoch: intent.scope.epoch, commandId: intent.commandId, ok: false });
    });
  }
  /** Real native event attribution, never a process-wide suppress-events Boolean. */
  native(kind: NativeKind | 'error' | 'emptied' | 'waiting' | 'stalled', attributed?: (scope: TypingFollowScope, currentOwner: boolean) => void): boolean {
    if (kind === 'emptied') {
      // Native load discards old queued media tasks. Their tickets must not claim new events.
      if (this.active) this.stop('media-error');
      this.tickets = []; this.source = null; this.rateWrite = null; this.buffering = null; this.initialSeek = null; return false;
    }
    if (kind === 'error') { if (this.active) this.stop('media-error'); return false; }
    const media = this.ports.media();
    if (kind === 'waiting' || kind === 'stalled') {
      const active = this.state.active;
      // A valid in-flight native play can wait for decoding before its promise
      // settles. Preserve that request's existing guards/timeout, but do not mint
      // a recovery admission before playback has actually succeeded.
      if (active && this.state.phase === 'starting' && active.pendingPlay && media &&
        media.readyState >= 1 && !media.error && this.eligible(active.scope)) return false;
      // Only an observed gap in an already successful ongoing play can authorize
      // recovery. HAVE_NOTHING, source errors, pending play and paused scopes cannot.
      if (active && this.state.phase === 'following' && !active.pendingPlay && media && !media.paused &&
        media.readyState >= 1 && !media.error && this.eligible(active.scope, true) && this.ownsCurrentRate() &&
        media.currentTime >= active.scope.identity.cueStartSeconds && media.currentTime < active.scope.identity.cueEndSeconds) {
        this.buffering = active.scope; attributed?.(active.scope, true); this.tick(); return true;
      }
      if (this.active) this.stop('unattributed-native-event');
      return false;
    }
    // Background/frozen native tasks can arrive arbitrarily late. Keep bounded issued
    // tickets until consumed, explicitly rejected, or discarded by a source load.
    // Native play/pause tasks may arrive after the next command changed paused.
    // Attribute FIFO scoped command tickets, rather than reading a later transport state.
    const index = this.tickets.findIndex(ticket => ticket.kind === kind);
    if (index < 0) {
      const scope = this.buffering;
      // Buffer recovery emits playing again, not a new user play command. Recheck
      // all current authority and the latest rate token, not the pre-buffer rate.
      if (kind === 'playing' && scope && this.state.phase === 'following' && !this.state.active?.pendingPlay &&
        media && !media.paused && media.readyState >= 2 && !media.error && this.eligible(scope) && this.ownsCurrentRate() &&
        media.currentTime >= scope.identity.cueStartSeconds && media.currentTime < scope.identity.cueEndSeconds) {
        this.buffering = null; attributed?.(scope, true); this.tick(); return true;
      }
      if (this.active) this.stop(kind === 'ratechange' ? 'manual-rate' : 'unattributed-native-event'); return false;
    }
    const ticket = this.tickets.splice(index, 1)[0];
    // A queued event from an explicitly issued, revoked command is consumed only.
    // It cannot tick, pause, restore or retune its replacement source/owner.
    if (!this.owns(ticket.scope)) { attributed?.(ticket.scope, false); return true; }
    if (kind === 'playing') this.buffering = null;
    // Events have no historical value. Compare current rate to the latest owned write,
    // not an older queued event's value; A then B may both report native B.
    if (kind === 'ratechange' && this.active && (!this.rateWrite || Math.abs((media?.playbackRate ?? NaN) - this.rateWrite.expected) >= 1e-6)) { this.stop('manual-rate'); return false; }
    if (kind === 'seeking' && this.active && (!media || media.currentTime < ticket.scope.identity.cueStartSeconds || media.currentTime >= ticket.scope.identity.cueEndSeconds)) { this.stop('manual-seek'); return false; }
    if ((kind === 'play' || kind === 'playing') && (!this.active || this.state.phase === 'waiting') && media && !media.paused) this.pause({type:'pause',scope:ticket.scope,commandId:ticket.commandId,reason:'stale-play'});
    attributed?.(ticket.scope, true);
    if (this.active && (kind === 'playing' || kind === 'play')) this.tick();
    return true;
  }
  /** The ordinary cue-loop handler calls this first so an ended Follow cannot rewind. */
  boundary(): boolean {
    const scope = this.source?.scope;
    if (!scope || !this.owns(scope) || (!this.active && this.state.phase !== 'ended')) return false;
    if (this.active) this.tick();
    return true;
  }
  private publish() {
    const env = this.context();
    const actual = env.referenceShown && this.active && this.rateWrite && Math.abs(env.mediaRate - this.rateWrite.expected) < 1e-6 ? env.mediaRate : null;
    const key = `${this.state.phase}/${this.state.reason}/${actual?.toFixed(2) ?? ''}`;
    if (key !== this.lastAnnouncement) { this.lastAnnouncement = key; this.ports.changed(this.state, actual); }
  }
  private arm() {
    if (this.timer !== null) this.ports.unschedule(this.timer); this.timer = null;
    if (!this.active || this.disposed) return;
    const env = this.context(), remaining = (env.identity.cueEndSeconds - env.mediaPositionSeconds) / Math.max(.1, env.mediaRate) * 1000;
    this.timer = this.ports.schedule(() => { this.timer = null; this.tick(); }, Math.max(4, Math.min(50, remaining)));
  }
  dispose() { this.stop('unmount'); this.disposed = true; if (this.timer !== null) this.ports.unschedule(this.timer); this.timer = null; this.tickets = []; this.source = null; this.buffering = null; this.initialSeek = null; }
}
