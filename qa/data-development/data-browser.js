"use strict";
var PracticeDataQA = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // scripts/data-browser-entry.ts
  var data_browser_entry_exports = {};
  __export(data_browser_entry_exports, {
    runPracticeDataBatchOneQA: () => runPracticeDataBatchOneQA,
    runPracticeDataBatchTwoAQA: () => runPracticeDataBatchTwoAQA,
    runPracticeDataBatchTwoBQA: () => runPracticeDataBatchTwoBQA,
    verifyPracticeDataReload: () => verifyPracticeDataReload,
    verifyPracticeFencesReload: () => verifyPracticeFencesReload,
    verifyPracticeRedactionReload: () => verifyPracticeRedactionReload
  });

  // studio/core/training.ts
  var SCHEMA_VERSION = "lingotrace-session-v1";
  var RULE_VERSION = "word-alignment-v3";
  var PACE_RULE_VERSION = "grapheme-exp-3s-v1";
  var validatedSnapshots = /* @__PURE__ */ new WeakSet();
  var CAFE_MATERIAL = deepFreeze({
    id: "cafe-original",
    version: "cafe-studio-v1",
    title: "\u5496\u5561\u9986\u4F1A\u8BDD",
    rights: "\u539F\u521B\u7EC3\u4E60\u77ED\u53E5\u3002\u573A\u666F\u4E3A\u5408\u6210\u89C6\u89C9\u5185\u5BB9\uFF0C\u4E0D\u662F\u771F\u5B9E\u62CD\u6444\u3002",
    cues: [
      "Could I have a coffee, please?",
      "Would you like it hot or iced?",
      "I would like a small hot coffee.",
      "Do you have any oat milk?",
      "Yes, we can add some for you.",
      "Could I have less sugar, please?",
      "Would you like anything to eat?",
      "A slice of bread would be nice.",
      "You can take a seat by the window.",
      "I will bring your order over soon.",
      "Thank you for your help today.",
      "You are welcome. Enjoy your coffee."
    ].map((text, index) => ({ id: `cafe-studio-${index + 1}`, text, start: index * 6, end: (index + 1) * 6 }))
  });
  var EMPTY_DRAFT = Object.freeze({ text: "", version: 0, source: "typed", hinted: false, revealed: false, pasted: false });
  function getDraft(snapshot) {
    return snapshot.drafts[snapshot.material.cues[snapshot.cueIndex].id] ?? EMPTY_DRAFT;
  }
  function getCurrentResult(snapshot) {
    const cue = snapshot.material.cues[snapshot.cueIndex];
    if (!hasScorableReference(cue.text)) return null;
    return [...snapshot.attempts].reverse().find((a) => a.cueId === cue.id && a.inputVersion === getDraft(snapshot).version && a.words > 0) ?? null;
  }
  function tokens(text) {
    return text.normalize("NFKC").replace(/[’‘ʼ]/g, "'").toLowerCase().match(/[a-z0-9]+(?:'[a-z0-9]+)*/g) ?? [];
  }
  function hasScorableReference(reference) {
    return tokens(reference).length > 0;
  }
  function align(reference, answer) {
    const expected = tokens(reference), actual = tokens(answer);
    const cells = Array.from({ length: expected.length + 1 }, () => []);
    cells[0][0] = { cost: 0, matches: 0, kind: "match" };
    for (let i2 = 1; i2 <= expected.length; i2++) cells[i2][0] = { cost: i2, matches: 0, kind: "missing" };
    for (let j2 = 1; j2 <= actual.length; j2++) cells[0][j2] = { cost: j2, matches: 0, kind: "extra" };
    for (let i2 = 1; i2 <= expected.length; i2++) for (let j2 = 1; j2 <= actual.length; j2++) {
      const same = expected[i2 - 1] === actual[j2 - 1];
      const choices = [
        { cost: cells[i2 - 1][j2 - 1].cost + (same ? 0 : 1), matches: cells[i2 - 1][j2 - 1].matches + (same ? 1 : 0), kind: same ? "match" : "replace" },
        { cost: cells[i2 - 1][j2].cost + 1, matches: cells[i2 - 1][j2].matches, kind: "missing" },
        { cost: cells[i2][j2 - 1].cost + 1, matches: cells[i2][j2 - 1].matches, kind: "extra" }
      ];
      choices.sort((a, b) => a.cost - b.cost || b.matches - a.matches);
      cells[i2][j2] = choices[0];
    }
    let i = expected.length, j = actual.length;
    const alignment = [];
    while (i || j) {
      const kind = cells[i][j].kind;
      if (kind === "match" || kind === "replace") {
        alignment.push({ kind, position: i - 1, expected: expected[--i], actual: actual[--j] });
      } else if (kind === "missing") alignment.push({ kind, position: i - 1, expected: expected[--i], actual: "" });
      else alignment.push({ kind, position: null, expected: "", actual: actual[--j] });
    }
    const errors = cells[expected.length][actual.length].cost;
    return { words: expected.length, errors, accuracy: expected.length ? Math.max(0, Math.round(100 * (1 - errors / expected.length))) : 0, alignment: alignment.reverse() };
  }
  function graphemes(text) {
    if (typeof Intl.Segmenter === "function") return [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)].map((part) => part.segment);
    return Array.from(text);
  }
  function addedGraphemes(before, after) {
    const a = graphemes(before), b = graphemes(after);
    let start = 0, tail = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    while (tail < a.length - start && tail < b.length - start && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
    return b.length - start - tail;
  }
  function createInitialSnapshot(sessionId, material = CAFE_MATERIAL) {
    if (!sessionId || !material.cues.length) throw new Error("A session ID and at least one cue are required.");
    return freezeSnapshot({
      schemaVersion: SCHEMA_VERSION,
      sessionId,
      roundId: sessionId,
      material: clone(material),
      sequence: 0,
      createdAt: "",
      cueIndex: 0,
      activeMs: 0,
      pace: 0,
      earnedWords: 0,
      confirmedPositions: [],
      completedCueIds: [],
      drafts: {},
      frozenReasons: ["idle"],
      pendingAttempts: {},
      discardedJudgmentIds: [],
      attempts: [],
      events: []
    });
  }
  function withReason(reasons, reason, on) {
    return on ? [.../* @__PURE__ */ new Set([...reasons, reason])] : reasons.filter((value) => value !== reason);
  }
  function positionKey(state, cueId, position) {
    return JSON.stringify([state.roundId, state.material.id, state.material.version, cueId, position]);
  }
  function reduceTraining(state, incoming) {
    if (state.events.some((event2) => event2.eventId === incoming.eventId)) return state;
    const event = clone(incoming);
    if (!event.eventId || event.sessionId !== state.sessionId || event.sequence !== state.sequence + 1) throw new Error("Invalid session, event ID, or noncontiguous sequence.");
    if (event.schemaVersion !== SCHEMA_VERSION || event.ruleVersion !== RULE_VERSION || event.paceRuleVersion !== PACE_RULE_VERSION) throw new Error("Unsupported event schema or rule version.");
    if (event.materialId !== state.material.id || event.materialVersion !== state.material.version || !Number.isFinite(event.activeMs) || Math.abs(event.activeMs - state.activeMs) > 1e-6) throw new Error("Event material or active-time mismatch.");
    if (!Number.isFinite(Date.parse(event.wallTime))) throw new Error("Invalid wall timestamp.");
    if (!state.events.length && event.type !== "sessionStarted") throw new Error("The first event must start the session.");
    const cue = state.material.cues[state.cueIndex], draft = getDraft(state);
    if (event.cueId !== cue.id || event.inputVersion !== draft.version) throw new Error("Event cue or input version mismatch.");
    let next2 = { ...state, sequence: event.sequence, events: [...state.events, event] };
    switch (event.type) {
      case "sessionStarted":
        if (state.sequence !== 0 || JSON.stringify(event.material) !== JSON.stringify(state.material)) throw new Error("Invalid session start.");
        next2 = { ...next2, createdAt: event.wallTime };
        break;
      case "timeAdvanced":
        if (!Number.isFinite(event.deltaMs) || event.deltaMs < 0) throw new Error("Elapsed time must be finite and nonnegative.");
        if (!state.frozenReasons.length) next2 = { ...next2, activeMs: state.activeMs + event.deltaMs, pace: state.pace * Math.exp(-event.deltaMs / 3e3) };
        break;
      case "freezeChanged":
        next2 = { ...next2, frozenReasons: withReason(state.frozenReasons, event.reason, event.on) };
        break;
      case "compositionStarted":
        next2 = { ...next2, frozenReasons: withReason(state.frozenReasons, "composition", true) };
        break;
      case "compositionEnded":
        next2 = { ...next2, frozenReasons: withReason(state.frozenReasons, "composition", false) };
        break;
      case "inputCommitted": {
        if (state.frozenReasons.includes("composition")) throw new Error("Commit input only after compositionEnded.");
        if (!["typed", "paste", "ime"].includes(event.source)) throw new Error("Invalid input source.");
        if (event.text === draft.text) break;
        const reasons = state.frozenReasons.filter((reason) => reason !== "idle" && reason !== "review");
        const boost = event.source !== "paste" && !reasons.length ? addedGraphemes(draft.text, event.text) * 20 : 0;
        next2 = { ...next2, pace: state.pace + boost, frozenReasons: reasons, drafts: { ...state.drafts, [cue.id]: {
          ...draft,
          text: event.text,
          version: draft.version + 1,
          source: event.source,
          pasted: draft.pasted || event.source === "paste"
        } } };
        break;
      }
      case "cueChanged":
        if (!Number.isInteger(event.index) || event.index < 0 || event.index >= state.material.cues.length) throw new Error("Invalid cue index.");
        next2 = { ...next2, cueIndex: event.index, frozenReasons: withReason(state.frozenReasons.filter((reason) => !["review", "composition"].includes(reason)), "idle", true) };
        break;
      case "hintExposed":
        next2 = { ...next2, drafts: { ...state.drafts, [cue.id]: { ...draft, hinted: draft.hinted || event.kind === "hint", revealed: draft.revealed || event.kind === "reveal" } } };
        break;
      case "submitRequested": {
        if (!event.attemptId || state.attempts.some((a) => a.attemptId === event.attemptId) || state.pendingAttempts[event.attemptId] || state.discardedJudgmentIds.includes(event.attemptId)) break;
        if (event.draftVersion !== draft.version || event.answer !== draft.text || !event.answer.trim() || state.frozenReasons.includes("composition")) throw new Error("Submission does not match the committed draft.");
        if (!hasScorableReference(cue.text)) break;
        const conditions = { exposure: state.attempts.some((a) => a.cueId === cue.id) ? "retry" : "first", hinted: draft.hinted, revealed: draft.revealed, pasted: draft.pasted, inputSource: draft.source };
        next2 = { ...next2, pendingAttempts: { ...state.pendingAttempts, [event.attemptId]: { attemptId: event.attemptId, cueId: cue.id, answer: event.answer, inputVersion: draft.version, conditions } }, frozenReasons: withReason(state.frozenReasons, "checking", true) };
        break;
      }
      case "judgmentApplied": {
        const pending = state.pendingAttempts[event.attemptId];
        if (!pending) break;
        const pendingAttempts = { ...state.pendingAttempts };
        delete pendingAttempts[event.attemptId];
        const reasons = withReason(state.frozenReasons, "checking", Object.keys(pendingAttempts).length > 0);
        if (pending.cueId !== cue.id || pending.inputVersion !== draft.version || pending.answer !== draft.text || !hasScorableReference(cue.text)) {
          next2 = { ...next2, pendingAttempts, frozenReasons: reasons, discardedJudgmentIds: [...state.discardedJudgmentIds, event.attemptId] };
          break;
        }
        const result = align(cue.text, pending.answer), confirmed = new Set(state.confirmedPositions);
        let gain = 0;
        for (const token of result.alignment) if (token.kind === "match" && token.position !== null) {
          const key = positionKey(state, cue.id, token.position);
          if (!confirmed.has(key)) {
            confirmed.add(key);
            gain++;
          }
        }
        const fullCorrect = result.errors === 0 && result.words > 0;
        const firstCompletion = fullCorrect && !state.completedCueIds.includes(cue.id);
        const attempt = {
          ...result,
          attemptId: pending.attemptId,
          sessionId: state.sessionId,
          roundId: state.roundId,
          cueId: cue.id,
          materialId: state.material.id,
          materialVersion: state.material.version,
          ruleVersion: RULE_VERSION,
          reference: cue.text,
          answer: pending.answer,
          inputVersion: pending.inputVersion,
          conditions: pending.conditions,
          gain,
          firstCompletion,
          activeMs: state.activeMs,
          wallTime: event.wallTime,
          dataset: "local_interactive"
        };
        next2 = {
          ...next2,
          pendingAttempts,
          frozenReasons: withReason(reasons, "review", true),
          confirmedPositions: [...confirmed],
          earnedWords: state.earnedWords + gain,
          completedCueIds: firstCompletion ? [...state.completedCueIds, cue.id] : state.completedCueIds,
          attempts: [...state.attempts, attempt]
        };
        break;
      }
    }
    return freezeSnapshot(next2, validatedSnapshots.has(state));
  }
  function replay(events, material) {
    if (!events.length) throw new Error("Replay requires the sessionStarted event.");
    const first = events[0];
    if (first.type !== "sessionStarted") throw new Error("Replay requires sessionStarted first.");
    return events.reduce(reduceTraining, createInitialSnapshot(first.sessionId, material ?? first.material));
  }
  function validateSnapshot(snapshot) {
    if (!snapshot.events.length || snapshot.events[0].type !== "sessionStarted") throw new Error("A persistable snapshot requires sessionStarted.");
    if (validatedSnapshots.has(snapshot)) return snapshot;
    const canonical = replay(snapshot.events, snapshot.material);
    if (canonical.sessionId !== snapshot.sessionId || canonical.sequence !== snapshot.sequence) throw new Error("Snapshot metadata does not match its event log.");
    return canonical;
  }
  var defaultClock = { now: () => performance.now(), wallTime: () => (/* @__PURE__ */ new Date()).toISOString(), id: () => globalThis.crypto.randomUUID() };
  var TrainingEngine = class {
    snapshot;
    listeners = /* @__PURE__ */ new Set();
    clock;
    anchor;
    constructor(options = {}) {
      this.clock = options.clock ?? defaultClock;
      this.anchor = this.clock.now();
      this.snapshot = options.snapshot ? replay(options.snapshot.events, options.snapshot.material) : createInitialSnapshot(options.sessionId ?? this.clock.id(), options.material);
      if (!options.snapshot) this.emit({ type: "sessionStarted", material: this.snapshot.material });
      else {
        if (this.snapshot.frozenReasons.includes("composition")) this.emit({ type: "compositionEnded" });
        for (const attemptId of Object.keys(this.snapshot.pendingAttempts)) this.emit({ type: "judgmentApplied", attemptId });
        if (!Object.keys(this.snapshot.pendingAttempts).length && this.snapshot.frozenReasons.includes("checking")) this.emit({ type: "freezeChanged", reason: "checking", on: false });
      }
    }
    getSnapshot = () => this.snapshot;
    subscribe = (listener) => {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    };
    get cue() {
      return this.snapshot.material.cues[this.snapshot.cueIndex];
    }
    get draft() {
      return getDraft(this.snapshot).text;
    }
    get currentResult() {
      return getCurrentResult(this.snapshot);
    }
    dispatch = (event) => {
      const next2 = reduceTraining(this.snapshot, event);
      if (next2 !== this.snapshot) {
        this.snapshot = next2;
        for (const listener of this.listeners) listener();
      }
      return this.snapshot;
    };
    emit(payload) {
      return this.dispatch({
        ...payload,
        eventId: this.clock.id(),
        sessionId: this.snapshot.sessionId,
        sequence: this.snapshot.sequence + 1,
        wallTime: this.clock.wallTime(),
        activeMs: this.snapshot.activeMs,
        cueId: this.cue.id,
        inputVersion: getDraft(this.snapshot).version,
        schemaVersion: SCHEMA_VERSION,
        ruleVersion: RULE_VERSION,
        paceRuleVersion: PACE_RULE_VERSION,
        materialId: this.snapshot.material.id,
        materialVersion: this.snapshot.material.version
      });
    }
    /** Sample once a second, and automatically before every real action. Never call from RAF. */
    sampleClock = () => {
      const now = this.clock.now(), delta = Math.max(0, now - this.anchor);
      this.anchor = now;
      if (delta > 0 && !this.snapshot.frozenReasons.length) this.emit({ type: "timeAdvanced", deltaMs: delta });
    };
    /** Explicit deterministic elapsed delta for a caller-owned monotonic driver or tests. */
    tick = (deltaMs) => {
      if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new Error("Elapsed time must be finite and nonnegative.");
      this.anchor = this.clock.now();
      if (deltaMs > 0 && !this.snapshot.frozenReasons.length) this.emit({ type: "timeAdvanced", deltaMs });
    };
    input = (text, source = "typed") => {
      this.sampleClock();
      if (text !== this.draft) this.emit({ type: "inputCommitted", text, source });
    };
    beginComposition = () => {
      this.sampleClock();
      if (!this.snapshot.frozenReasons.includes("composition")) this.emit({ type: "compositionStarted" });
    };
    endComposition = (text) => {
      this.sampleClock();
      this.emit({ type: "compositionEnded" });
      this.input(text, "ime");
    };
    setFrozen = (reason, on) => {
      this.sampleClock();
      if (this.snapshot.frozenReasons.includes(reason) !== on) this.emit({ type: "freezeChanged", reason, on });
    };
    exposeHint = (kind) => {
      this.sampleClock();
      this.emit({ type: "hintExposed", kind });
    };
    submit = () => {
      this.sampleClock();
      if (!hasScorableReference(this.cue.text) || !this.draft.trim() || this.snapshot.frozenReasons.includes("composition")) return null;
      if (this.currentResult) return this.currentResult;
      const attemptId = this.clock.id();
      this.emit({ type: "submitRequested", attemptId, answer: this.draft, draftVersion: getDraft(this.snapshot).version });
      this.emit({ type: "judgmentApplied", attemptId });
      return this.snapshot.attempts.find((attempt) => attempt.attemptId === attemptId) ?? null;
    };
    nextCue = (index = (this.snapshot.cueIndex + 1) % this.snapshot.material.cues.length) => {
      this.sampleClock();
      if (index !== this.snapshot.cueIndex) this.emit({ type: "cueChanged", index });
    };
    resetSession = () => {
      this.sampleClock();
      this.snapshot = createInitialSnapshot(this.clock.id(), this.snapshot.material);
      this.anchor = this.clock.now();
      this.emit({ type: "sessionStarted", material: this.snapshot.material });
    };
  };
  var METRIC_DEFINITIONS = deepFreeze({
    earnedWords: "Cumulative distinct matched target positions per session/round and versioned material; retries and corrections never remove credit. Hinted, revealed and pasted conditions remain attached to attempts.",
    completedCues: "A cue completes only at zero word edit errors, including zero extra words. Case, Unicode compatibility, curly apostrophes and punctuation are normalized.",
    attemptAccuracy: "max(0, round(100 \xD7 (1 \u2212 minimum word edit errors / target word count))). Per-attempt transcript comparison, not proficiency, attention, retention or capability.",
    activeMs: "Monotonic elapsed time while no freeze reason is set. Idle, pause, listening, IME composition, background, modal, judging and review freeze it. This is not an attention measurement.",
    pace: "Temporary visual energy: +20 per committed typed/IME grapheme added; paste/deletion add no energy. Decays by exp(\u2212activeSeconds / 3). Frozen with active time. Never a durable reward.",
    curves: "Only observed local attempts/events. No synthetic history and no inferred mastery. First attempts, retries, hint, reveal and paste conditions are preserved separately."
  });
  function csvCell(value) {
    let text = String(value ?? "");
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function clone(value) {
    return structuredClone(value);
  }
  function freezeSnapshot(value, validated = true) {
    deepFreeze(value);
    if (validated) validatedSnapshots.add(value);
    return value;
  }
  function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const item of Object.values(value)) deepFreeze(item);
    }
    return value;
  }

  // studio/core/practice.ts
  var PRACTICE_SCHEMA_VERSION = "lingotrace-practice-v1";
  var PRACTICE_SCHEMA_VERSION_V2 = "lingotrace-practice-v2";
  var PRACTICE_ALIGNMENT_RULE_VERSION = "word-alignment-v3";
  var ORIGINAL_PRACTICE_MATERIAL = freeze({
    materialId: "original-cafe-data-v1",
    title: "Three original caf\xE9 exchanges",
    rights: "Original practice text; no source recording or audio assessment.",
    durationSeconds: 18,
    units: [
      { unitId: "cafe-order", references: [{ referenceVersion: "v1", text: "Could I have a coffee, please?", startSeconds: 0, endSeconds: 6 }] },
      { unitId: "cafe-choice", references: [{ referenceVersion: "v1", text: "I would like a small hot coffee.", startSeconds: 6, endSeconds: 12 }] },
      { unitId: "cafe-thanks", references: [{ referenceVersion: "v1", text: "Thank you for your help today.", startSeconds: 12, endSeconds: 18 }] }
    ]
  });
  var trustedSnapshots = /* @__PURE__ */ new WeakSet();
  var modes = ["dictation", "recording-comparison"];
  var sources = ["typed", "paste", "ime"];
  var exposureKinds = ["hint", "reveal", "reference", "translation", "correction", "shadowing"];
  var emptyDraft = freeze({ text: "", version: 0, source: "typed", sources: [], pasted: false, addedTypedGraphemes: 0 });
  var emptyExposure = freeze({ firstSubmissionSequence: null, beforeFirstSubmission: [], afterFirstSubmission: [] });
  function requireThat(value, message2) {
    if (!value) throw new Error(message2);
  }
  function requireGraphemeSupport() {
    requireThat(typeof Intl === "object" && typeof Intl.Segmenter === "function", "Unsupported practice environment: Intl.Segmenter is required; code-point fallback cannot replay this schema.");
  }
  function object(value) {
    requireThat(value !== null && typeof value === "object" && !Array.isArray(value), "Expected a JSON object.");
  }
  function keys(value, expected) {
    const actual = Object.keys(value).sort();
    requireThat(actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]), "Unexpected or missing JSON fields.");
  }
  function id(value) {
    requireThat(typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value) && !["constructor", "prototype", "__proto__"].includes(value), "Invalid stable ID.");
  }
  function timestamp(value) {
    requireThat(typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, "Invalid ISO timestamp.");
  }
  function integer(value) {
    requireThat(Number.isSafeInteger(value) && value >= 0, "Expected a nonnegative safe integer.");
  }
  function plainJSON(value, ancestors = /* @__PURE__ */ new Set()) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number") {
      requireThat(Number.isFinite(value), "Nonfinite JSON number.");
      return;
    }
    requireThat(typeof value === "object" && value !== null && !ancestors.has(value), "Expected acyclic JSON data.");
    requireThat(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, "Expected plain JSON data.");
    const next2 = new Set(ancestors);
    next2.add(value);
    if (Array.isArray(value)) {
      requireThat(Object.keys(value).length === value.length, "Sparse or extended JSON arrays are unsupported.");
      value.forEach((item) => plainJSON(item, next2));
    } else Object.values(value).forEach((item) => plainJSON(item, next2));
  }
  function stable(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  function freeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.values(value).forEach(freeze);
    }
    return value;
  }
  function verified(snapshot) {
    freeze(snapshot);
    trustedSnapshots.add(snapshot);
    return snapshot;
  }
  function validateMaterial(value) {
    object(value);
    keys(value, ["materialId", "title", "rights", "durationSeconds", "units"]);
    id(value.materialId);
    requireThat(typeof value.title === "string" && value.title.trim() && typeof value.rights === "string" && value.rights.trim(), "Material title and rights are required.");
    requireThat(value.durationSeconds === null || typeof value.durationSeconds === "number" && Number.isFinite(value.durationSeconds) && value.durationSeconds > 0, "Duration must be positive finite seconds or explicitly null.");
    requireThat(Array.isArray(value.units) && value.units.length > 0, "Material requires units.");
    const unitIds = /* @__PURE__ */ new Set();
    for (const unit of value.units) {
      object(unit);
      keys(unit, ["unitId", "references"]);
      id(unit.unitId);
      requireThat(!unitIds.has(unit.unitId), "Duplicate unit ID.");
      unitIds.add(unit.unitId);
      requireThat(Array.isArray(unit.references) && unit.references.length > 0, "Unit requires reference versions.");
      const versions = /* @__PURE__ */ new Set();
      for (const reference of unit.references) {
        object(reference);
        keys(reference, ["referenceVersion", "text", "startSeconds", "endSeconds"]);
        id(reference.referenceVersion);
        requireThat(typeof reference.text === "string" && reference.text.trim().length > 0, "Reference text is required.");
        requireThat(typeof reference.startSeconds === "number" && Number.isFinite(reference.startSeconds) && reference.startSeconds >= 0 && typeof reference.endSeconds === "number" && Number.isFinite(reference.endSeconds) && reference.endSeconds > reference.startSeconds, "Reference range must satisfy 0 <= start < end.");
        requireThat(value.durationSeconds === null || reference.endSeconds <= value.durationSeconds, "Reference end exceeds known material duration.");
        requireThat(!versions.has(reference.referenceVersion), "Duplicate reference version.");
        versions.add(reference.referenceVersion);
      }
    }
  }
  function mergeMaterial(catalog, material) {
    validateMaterial(material);
    const prior = catalog.find((item) => item.materialId === material.materialId);
    if (!prior) return [...catalog, material];
    requireThat(prior.title === material.title && prior.rights === material.rights && prior.durationSeconds === material.durationSeconds, "Stable material metadata cannot be replaced.");
    const units = [...prior.units];
    for (const unit of material.units) {
      const index = units.findIndex((item) => item.unitId === unit.unitId);
      if (index === -1) {
        units.push(unit);
        continue;
      }
      const references = [...units[index].references];
      for (const reference of unit.references) {
        const existing = references.find((item) => item.referenceVersion === reference.referenceVersion);
        requireThat(!existing || existing.text === reference.text && existing.startSeconds === reference.startSeconds && existing.endSeconds === reference.endSeconds, "Reference version content conflict; create a new version.");
        if (!existing) references.push(reference);
      }
      units[index] = { ...units[index], references };
    }
    return catalog.map((item) => item === prior ? { ...prior, units } : item);
  }
  function validateEvent(value) {
    plainJSON(value);
    object(value);
    if (value.schemaVersion === PRACTICE_SCHEMA_VERSION_V2) {
      keys(value, ["schemaVersion", "eventId", "sequence", "sessionId", "payload"]);
      id(value.eventId);
      id(value.sessionId);
      integer(value.sequence);
      requireThat(value.sequence > 0, "Event sequence starts at one.");
      object(value.payload);
      const p2 = value.payload;
      switch (p2.type) {
        case "erasedSlot":
          keys(p2, ["type"]);
          break;
        case "redactedAttemptBoundary":
          keys(p2, ["type", "attemptId", "lineage"]);
          id(p2.attemptId);
          if (p2.lineage !== null) {
            object(p2.lineage);
            keys(p2.lineage, ["unitId", "mode", "referenceVersion"]);
            id(p2.lineage.unitId);
            id(p2.lineage.referenceVersion);
            requireThat(modes.includes(p2.lineage.mode), "Unsupported redaction lineage mode.");
          }
          break;
        case "redactedFirstSubmissionBoundary":
          keys(p2, ["type", "attemptId", "unitId"]);
          id(p2.attemptId);
          id(p2.unitId);
          break;
        case "redactedExposureBoundary":
          keys(p2, ["type", "attemptId", "unitId", "kind"]);
          id(p2.attemptId);
          id(p2.unitId);
          requireThat(exposureKinds.includes(p2.kind), "Invalid redacted exposure kind.");
          break;
        case "redactedControlBoundary":
          keys(p2, ["type", "manualPaused", "videoPaused"]);
          requireThat(typeof p2.manualPaused === "boolean" && typeof p2.videoPaused === "boolean", "Redacted control flags must be boolean.");
          break;
        case "attemptRedactionCommitted":
          keys(p2, ["type", "attemptId", "redactionId"]);
          id(p2.attemptId);
          id(p2.redactionId);
          break;
        default:
          throw new Error("Unsupported redaction event type.");
      }
      return;
    }
    keys(value, ["schemaVersion", "eventId", "sequence", "sessionId", "occurredAt", "recordedAt", "payload"]);
    requireThat(value.schemaVersion === PRACTICE_SCHEMA_VERSION, "Unsupported practice event schema.");
    id(value.eventId);
    id(value.sessionId);
    integer(value.sequence);
    requireThat(value.sequence > 0, "Event sequence starts at one.");
    timestamp(value.occurredAt);
    timestamp(value.recordedAt);
    object(value.payload);
    const p = value.payload;
    switch (p.type) {
      case "sessionStarted":
        keys(p, ["type", "catalog"]);
        requireThat(Array.isArray(p.catalog), "Catalog must be an array.");
        p.catalog.forEach(validateMaterial);
        break;
      case "materialRegistered":
        keys(p, ["type", "material"]);
        validateMaterial(p.material);
        break;
      case "roundStarted":
        keys(p, ["type", "practiceRoundId", "materialId"]);
        id(p.practiceRoundId);
        id(p.materialId);
        break;
      case "roundEnded":
        keys(p, ["type", "practiceRoundId"]);
        id(p.practiceRoundId);
        break;
      case "attemptStarted":
        keys(p, ["type", "attemptId", "unitId", "mode", "referenceVersion", "relation"]);
        id(p.attemptId);
        id(p.unitId);
        id(p.referenceVersion);
        requireThat(modes.includes(p.mode), "Unsupported practice mode.");
        if (p.relation !== null) {
          object(p.relation);
          keys(p.relation, ["kind", "attemptId"]);
          id(p.relation.attemptId);
          requireThat(["retry", "mode-switch"].includes(p.relation.kind), "Invalid attempt relation.");
        }
        break;
      case "inputCommitted":
        keys(p, ["type", "attemptId", "text", "source"]);
        id(p.attemptId);
        requireThat(typeof p.text === "string" && sources.includes(p.source), "Invalid committed input or source.");
        break;
      case "submissionCommitted":
        keys(p, ["type", "attemptId", "submissionId", "draftVersion"]);
        id(p.attemptId);
        id(p.submissionId);
        integer(p.draftVersion);
        break;
      case "referenceExposed":
        keys(p, ["type", "unitId", "attemptId", "kind"]);
        id(p.unitId);
        if (p.attemptId !== null) id(p.attemptId);
        requireThat(exposureKinds.includes(p.kind), "Invalid exposure kind.");
        break;
      case "practicePauseChanged":
      case "videoPauseChanged":
        keys(p, ["type", "paused"]);
        requireThat(typeof p.paused === "boolean", "Pause flag must be boolean.");
        break;
      case "timeAdvanced":
        keys(p, ["type", "deltaMs"]);
        requireThat(typeof p.deltaMs === "number" && Number.isFinite(p.deltaMs) && p.deltaMs > 0, "Elapsed time must be positive and finite.");
        break;
      default:
        throw new Error("Unsupported practice event type.");
    }
  }
  function ownValue(map, key) {
    return Object.hasOwn(map, key) ? map[key] : void 0;
  }
  function currentRound(p) {
    const round = p.currentRoundId ? ownValue(p.rounds, p.currentRoundId) : void 0;
    requireThat(round && round.endedAt === null, "An open practice round is required.");
    return round;
  }
  function currentAttempt(p, expectedId) {
    currentRound(p);
    const attempt = p.currentAttemptId ? ownValue(p.attempts, p.currentAttemptId) : void 0;
    requireThat(attempt && (!expectedId || attempt.attemptId === expectedId), "The current attempt is required.");
    return attempt;
  }
  function editable(p) {
    requireThat(!p.manualPaused, "Practice is manually paused; input and submission are blocked.");
  }
  function active(p) {
    return !p.manualPaused && p.currentRoundId !== null && ownValue(p.rounds, p.currentRoundId)?.endedAt === null && p.currentAttemptId !== null;
  }
  function redactionFacts(events) {
    if (!events.some((event) => event.schemaVersion === PRACTICE_SCHEMA_VERSION_V2)) return void 0;
    const commits = /* @__PURE__ */ new Map(), redactionIds = /* @__PURE__ */ new Set();
    const lineageTargets = /* @__PURE__ */ new Set(), units = /* @__PURE__ */ new Map(), boundaries = /* @__PURE__ */ new Set();
    for (const event of events) if (event.payload.type === "attemptRedactionCommitted") {
      const { attemptId, redactionId } = event.payload;
      requireThat(!commits.has(attemptId) && !redactionIds.has(redactionId), "Duplicate redaction target or redaction ID.");
      commits.set(attemptId, { sequence: event.sequence, redactionId });
      redactionIds.add(redactionId);
    }
    requireThat(commits.size > 0, "Synthetic events require a committed redaction.");
    for (const event of events) {
      if (event.schemaVersion === PRACTICE_SCHEMA_VERSION) {
        const p = event.payload;
        if ("attemptId" in p && p.attemptId !== null) requireThat(!commits.has(p.attemptId), "Ordinary facts for a deleted attempt are forbidden.");
        if (p.type === "attemptStarted" && p.relation && commits.has(p.relation.attemptId)) lineageTargets.add(p.relation.attemptId);
      } else {
        const p = event.payload;
        if (!("attemptId" in p) || p.type === "attemptRedactionCommitted") continue;
        const commit = commits.get(p.attemptId);
        requireThat(commit && event.sequence < commit.sequence, "Redaction boundary requires a later matching commit.");
        if (p.type === "redactedAttemptBoundary") {
          requireThat(!boundaries.has(p.attemptId), "Duplicate redacted attempt boundary.");
          boundaries.add(p.attemptId);
        }
        const unitId = "unitId" in p ? p.unitId : p.type === "redactedAttemptBoundary" ? p.lineage?.unitId : void 0;
        if (unitId !== void 0) {
          requireThat(!units.has(p.attemptId) || units.get(p.attemptId) === unitId, "Conflicting redacted unit boundaries.");
          units.set(p.attemptId, unitId);
        }
      }
    }
    for (const attemptId of commits.keys()) requireThat(boundaries.has(attemptId), "Redaction commit has no attempt boundary.");
    for (const event of events) if (event.payload.type === "redactedAttemptBoundary") {
      requireThat(event.payload.lineage !== null === lineageTargets.has(event.payload.attemptId), "Retain lineage only for a surviving direct relation.");
    }
    return { commits, lineageTargets, units };
  }
  function closeRedactedCursor(p) {
    return p.redaction ? { ...p, redaction: { ...p.redaction, currentAnchorId: null } } : p;
  }
  function applyRedaction(p, event, facts) {
    const context = p.redaction;
    const payload = event.payload;
    requireThat(context, "Redaction records require an explicit v2 container.");
    if (payload.type === "redactedAttemptBoundary") {
      const round2 = currentRound(p);
      editable(p);
      requireThat(!ownValue(context.anchors, payload.attemptId) && !ownValue(p.attempts, payload.attemptId), "Redacted attempt ID already exists.");
      if (payload.lineage) {
        const unit = p.catalog.find((material2) => material2.materialId === round2.materialId)?.units.find((unit2) => unit2.unitId === payload.lineage.unitId);
        requireThat(unit?.references.some((reference) => reference.referenceVersion === payload.lineage.referenceVersion), "Unknown redacted lineage reference.");
      }
      return { ...p, currentAttemptId: null, redaction: {
        ...context,
        currentAnchorId: payload.attemptId,
        anchors: { ...context.anchors, [payload.attemptId]: { practiceRoundId: round2.practiceRoundId, lineage: payload.lineage } }
      } };
    }
    if (payload.type === "attemptRedactionCommitted") {
      requireThat(ownValue(context.anchors, payload.attemptId) && !context.targets.some((target) => target.attemptId === payload.attemptId), "Orphan or duplicate redaction commit.");
      return { ...p, redaction: {
        ...context,
        targets: [...context.targets, { attemptId: payload.attemptId, redactionId: payload.redactionId }],
        currentAnchorId: context.currentAnchorId === payload.attemptId ? null : context.currentAnchorId
      } };
    }
    requireThat(context.currentAnchorId !== null && p.currentAttemptId === null, "Redaction marker requires the current redacted interval.");
    currentRound(p);
    requireThat(facts.commits.get(context.currentAnchorId).sequence > event.sequence, "Redacted interval has already committed.");
    if (payload.type === "erasedSlot") return p;
    if (payload.type === "redactedControlBoundary") return { ...p, manualPaused: payload.manualPaused, videoPaused: payload.videoPaused };
    requireThat(payload.attemptId === context.currentAnchorId, "Redaction marker does not belong to the current anchor.");
    const round = currentRound(p), material = p.catalog.find((item) => item.materialId === round.materialId);
    requireThat(material.units.some((unit) => unit.unitId === payload.unitId), "Unknown redacted exposure unit.");
    const prior = ownValue(round.unitExposure, payload.unitId) ?? emptyExposure;
    let updated;
    if (payload.type === "redactedFirstSubmissionBoundary") {
      requireThat(ownValue(context.anchors, payload.attemptId)?.lineage?.mode !== "recording-comparison", "Recording comparison cannot supply a submission boundary.");
      requireThat(prior.firstSubmissionSequence === null, "Only the first unit submission boundary may be retained.");
      updated = { ...prior, firstSubmissionSequence: event.sequence };
    } else {
      const exposure = { redacted: true, unitId: payload.unitId, kind: payload.kind };
      updated = prior.firstSubmissionSequence === null ? { ...prior, beforeFirstSubmission: [...prior.beforeFirstSubmission, exposure] } : { ...prior, afterFirstSubmission: [...prior.afterFirstSubmission, exposure] };
    }
    return { ...p, rounds: { ...p.rounds, [round.practiceRoundId]: { ...round, unitExposure: { ...round.unitExposure, [payload.unitId]: updated } } } };
  }
  function initial(sessionId, schemaVersion = PRACTICE_SCHEMA_VERSION) {
    return { schemaVersion, sessionId, sequence: 0, events: [], projections: {
      catalog: [],
      rounds: {},
      attempts: {},
      currentRoundId: null,
      currentAttemptId: null,
      manualPaused: false,
      videoPaused: false,
      activeMs: 0,
      ...schemaVersion === PRACTICE_SCHEMA_VERSION_V2 ? { redaction: { targets: [], anchors: {}, currentAnchorId: null } } : {}
    } };
  }
  function apply(state, event, facts) {
    requireThat(event.sessionId === state.sessionId && event.sequence === state.sequence + 1, "Session mismatch or noncontiguous event sequence.");
    let p = state.projections;
    requireThat(state.sequence > 0 || event.payload.type === "sessionStarted", "Session start must be the first event.");
    if (event.schemaVersion === PRACTICE_SCHEMA_VERSION_V2) {
      requireThat(facts, "Synthetic records may only be applied by validated replay.");
      p = applyRedaction(p, event, facts);
    } else {
      const payload = event.payload;
      if (p.redaction?.currentAnchorId) {
        requireThat(!["timeAdvanced", "practicePauseChanged", "videoPauseChanged"].includes(payload.type), "Deleted attempt timing and controls must be redacted.");
        if (payload.type === "referenceExposed" && payload.attemptId === null) {
          requireThat(facts?.units.get(p.redaction.currentAnchorId) !== payload.unitId, "Target-unit exposure inside a redacted interval requires a minimal boundary.");
        }
      }
      switch (payload.type) {
        case "sessionStarted": {
          requireThat(state.sequence === 0, "Session already started.");
          let catalog = [];
          payload.catalog.forEach((material) => {
            catalog = mergeMaterial(catalog, material);
          });
          p = { ...p, catalog };
          break;
        }
        case "materialRegistered":
          p = { ...p, catalog: mergeMaterial(p.catalog, payload.material) };
          break;
        case "roundStarted": {
          requireThat(!p.currentRoundId || ownValue(p.rounds, p.currentRoundId)?.endedAt !== null, "Explicitly end the current round before starting another.");
          requireThat(!ownValue(p.rounds, payload.practiceRoundId), "Practice round ID already exists.");
          requireThat(p.catalog.some((material) => material.materialId === payload.materialId), "Unknown material.");
          const round = { practiceRoundId: payload.practiceRoundId, materialId: payload.materialId, startedAt: event.occurredAt, endedAt: null, activeMs: 0, attemptIds: [], unitExposure: {} };
          p = closeRedactedCursor({ ...p, rounds: { ...p.rounds, [round.practiceRoundId]: round }, currentRoundId: round.practiceRoundId, currentAttemptId: null, manualPaused: false });
          break;
        }
        case "roundEnded": {
          const round = currentRound(p);
          requireThat(round.practiceRoundId === payload.practiceRoundId, "Round mismatch.");
          p = closeRedactedCursor({ ...p, rounds: { ...p.rounds, [round.practiceRoundId]: { ...round, endedAt: event.occurredAt } }, currentAttemptId: null, manualPaused: false });
          break;
        }
        case "attemptStarted": {
          const round = currentRound(p);
          editable(p);
          requireThat(!ownValue(p.attempts, payload.attemptId) && !(p.redaction && ownValue(p.redaction.anchors, payload.attemptId)), "Attempt ID already exists or was deleted.");
          const material = p.catalog.find((item) => item.materialId === round.materialId);
          const unit = material.units.find((item) => item.unitId === payload.unitId);
          const reference = unit?.references.find((item) => item.referenceVersion === payload.referenceVersion);
          requireThat(reference, "Unknown unit or reference version.");
          if (payload.relation) {
            const anchor = p.redaction && ownValue(p.redaction.anchors, payload.relation.attemptId);
            if (anchor) {
              requireThat(p.currentAttemptId === null && p.redaction.currentAnchorId === payload.relation.attemptId && anchor.lineage, "Related redacted attempt must be the current lineage anchor.");
              requireThat(anchor.practiceRoundId === round.practiceRoundId && anchor.lineage.unitId === payload.unitId && anchor.lineage.referenceVersion === payload.referenceVersion, "Related attempts retain the original unit and reference.");
              requireThat(payload.relation.kind === "retry" ? anchor.lineage.mode === payload.mode : anchor.lineage.mode !== payload.mode, "Retry keeps the mode; a mode switch changes it.");
            } else {
              const prior = currentAttempt(p, payload.relation.attemptId);
              requireThat(prior.practiceRoundId === round.practiceRoundId && prior.reference.unitId === payload.unitId && prior.reference.referenceVersion === payload.referenceVersion, "Related attempts retain the original unit and reference.");
              requireThat(payload.relation.kind === "retry" ? prior.mode === payload.mode : prior.mode !== payload.mode, "Retry keeps the mode; a mode switch changes it.");
            }
          } else {
            requireThat(!round.attemptIds.some((attemptId) => ownValue(p.attempts, attemptId)?.reference.unitId === payload.unitId), "Use an explicit retry or mode switch for this unit in this round.");
            requireThat(!p.redaction?.currentAnchorId || facts?.units.get(p.redaction.currentAnchorId) !== payload.unitId, "Use an explicit relation to the current redacted unit.");
          }
          const attempt = {
            attemptId: payload.attemptId,
            practiceRoundId: round.practiceRoundId,
            mode: payload.mode,
            reference: { materialId: round.materialId, unitId: payload.unitId, ...reference, materialDurationSeconds: material.durationSeconds, rangeVerification: material.durationSeconds === null ? "duration-unknown" : "verified" },
            relation: payload.relation,
            startedAt: event.occurredAt,
            startedSequence: event.sequence,
            activeMs: 0,
            draft: emptyDraft,
            firstSubmission: null,
            revisions: [],
            practiceComplete: false,
            evaluationComplete: false,
            targetMet: null
          };
          p = closeRedactedCursor({ ...p, currentAttemptId: attempt.attemptId, attempts: { ...p.attempts, [attempt.attemptId]: attempt }, rounds: { ...p.rounds, [round.practiceRoundId]: { ...round, attemptIds: [...round.attemptIds, attempt.attemptId] } } });
          break;
        }
        case "inputCommitted": {
          requireGraphemeSupport();
          editable(p);
          const attempt = currentAttempt(p, payload.attemptId);
          const draft = attempt.draft;
          requireThat(payload.text !== draft.text, "Input event must change the committed draft.");
          const nextDraft = {
            text: payload.text,
            version: draft.version + 1,
            source: payload.source,
            sources: [.../* @__PURE__ */ new Set([...draft.sources, payload.source])],
            pasted: draft.pasted || payload.source === "paste",
            addedTypedGraphemes: draft.addedTypedGraphemes + (payload.source === "paste" ? 0 : addedGraphemes(draft.text, payload.text))
          };
          p = { ...p, attempts: { ...p.attempts, [attempt.attemptId]: { ...attempt, draft: nextDraft, evaluationComplete: false, targetMet: null } } };
          break;
        }
        case "submissionCommitted": {
          editable(p);
          const attempt = currentAttempt(p, payload.attemptId);
          const round = currentRound(p);
          requireThat(attempt.mode !== "recording-comparison", "Recording comparison requires real media evidence; submission is not implemented.");
          requireThat(attempt.draft.version === payload.draftVersion && attempt.draft.text.trim(), "Submission requires the exact nonempty committed draft.");
          const latest = attempt.revisions.at(-1) ?? attempt.firstSubmission;
          requireThat(latest?.draftVersion !== payload.draftVersion, "This draft version is already submitted.");
          requireThat(!Object.values(p.attempts).some((item) => [item.firstSubmission, ...item.revisions].some((submission2) => submission2?.submissionId === payload.submissionId)), "Submission ID already exists.");
          const exposure = ownValue(round.unitExposure, attempt.reference.unitId) ?? emptyExposure;
          requireThat(RULE_VERSION === PRACTICE_ALIGNMENT_RULE_VERSION, "Practice v1 requires its original alignment rule; use a new schema for changed grading.");
          const result = tokens(attempt.reference.text).length ? align(attempt.reference.text, attempt.draft.text) : null;
          const evaluationComplete = result !== null;
          const submission = {
            submissionId: payload.submissionId,
            eventId: event.eventId,
            sequence: event.sequence,
            occurredAt: event.occurredAt,
            answer: attempt.draft.text,
            draftVersion: attempt.draft.version,
            inputSource: attempt.draft.source,
            inputSources: attempt.draft.sources,
            pasted: attempt.draft.pasted,
            exposureAtSubmission: [...exposure.beforeFirstSubmission, ...exposure.afterFirstSubmission],
            activeMs: attempt.activeMs,
            alignment: evaluationComplete ? result : null,
            ruleVersion: evaluationComplete ? RULE_VERSION : null,
            practiceComplete: true,
            evaluationComplete,
            targetMet: evaluationComplete ? result.errors === 0 : null
          };
          const updated = {
            ...attempt,
            firstSubmission: attempt.firstSubmission ?? submission,
            revisions: attempt.firstSubmission ? [...attempt.revisions, submission] : [],
            practiceComplete: submission.practiceComplete,
            evaluationComplete,
            targetMet: submission.targetMet
          };
          p = { ...p, attempts: { ...p.attempts, [attempt.attemptId]: updated }, rounds: { ...p.rounds, [round.practiceRoundId]: { ...round, unitExposure: { ...round.unitExposure, [attempt.reference.unitId]: { ...exposure, firstSubmissionSequence: exposure.firstSubmissionSequence ?? event.sequence } } } } };
          break;
        }
        case "referenceExposed": {
          editable(p);
          const round = currentRound(p);
          const material = p.catalog.find((item) => item.materialId === round.materialId);
          requireThat(material.units.some((unit) => unit.unitId === payload.unitId), "Unknown exposure unit.");
          if (payload.attemptId !== null) requireThat(currentAttempt(p, payload.attemptId).reference.unitId === payload.unitId, "Exposure unit does not match the current attempt.");
          const prior = ownValue(round.unitExposure, payload.unitId) ?? emptyExposure;
          const exposure = { eventId: event.eventId, sequence: event.sequence, occurredAt: event.occurredAt, unitId: payload.unitId, attemptId: payload.attemptId, kind: payload.kind };
          const updated = prior.firstSubmissionSequence === null ? { ...prior, beforeFirstSubmission: [...prior.beforeFirstSubmission, exposure] } : { ...prior, afterFirstSubmission: [...prior.afterFirstSubmission, exposure] };
          p = { ...p, rounds: { ...p.rounds, [round.practiceRoundId]: { ...round, unitExposure: { ...round.unitExposure, [payload.unitId]: updated } } } };
          break;
        }
        case "practicePauseChanged":
          currentRound(p);
          requireThat(p.manualPaused !== payload.paused, "Practice pause already has this value.");
          p = { ...p, manualPaused: payload.paused };
          break;
        case "videoPauseChanged":
          requireThat(p.videoPaused !== payload.paused, "Video pause already has this value.");
          p = { ...p, videoPaused: payload.paused };
          break;
        case "timeAdvanced": {
          requireThat(active(p), "Elapsed practice time cannot advance while paused or without an active attempt.");
          const round = currentRound(p), attempt = currentAttempt(p);
          requireThat(Number.isFinite(p.activeMs + payload.deltaMs), "Elapsed time overflow.");
          p = {
            ...p,
            activeMs: p.activeMs + payload.deltaMs,
            rounds: { ...p.rounds, [round.practiceRoundId]: { ...round, activeMs: round.activeMs + payload.deltaMs } },
            attempts: { ...p.attempts, [attempt.attemptId]: { ...attempt, activeMs: attempt.activeMs + payload.deltaMs } }
          };
          break;
        }
      }
    }
    return verified({ schemaVersion: state.schemaVersion, sessionId: state.sessionId, sequence: event.sequence, events: [...state.events, event], projections: p });
  }
  function replayPracticeEvents(events) {
    requireGraphemeSupport();
    requireThat(Array.isArray(events) && events.length > 0, "Replay requires a sessionStarted event.");
    const unique = [];
    const seen = /* @__PURE__ */ new Map();
    for (const incoming of events) {
      validateEvent(incoming);
      const duplicate = seen.get(incoming.eventId);
      if (duplicate) {
        requireThat(stable(duplicate) === stable(incoming), "Conflicting duplicate event ID.");
        continue;
      }
      const event = structuredClone(incoming);
      unique.push(event);
      seen.set(event.eventId, event);
    }
    const facts = redactionFacts(unique);
    let state = initial(unique[0].sessionId, facts ? PRACTICE_SCHEMA_VERSION_V2 : PRACTICE_SCHEMA_VERSION);
    for (const event of unique) state = apply(state, event, facts);
    return state;
  }
  function validatePracticeSnapshot(snapshot) {
    requireGraphemeSupport();
    if (snapshot.schemaVersion === PRACTICE_SCHEMA_VERSION && trustedSnapshots.has(snapshot)) return snapshot;
    plainJSON(snapshot);
    object(snapshot);
    keys(snapshot, ["schemaVersion", "sessionId", "sequence", "events", "projections"]);
    requireThat(snapshot.schemaVersion === PRACTICE_SCHEMA_VERSION || snapshot.schemaVersion === PRACTICE_SCHEMA_VERSION_V2, "Unsupported practice snapshot schema.");
    const canonical = replayPracticeEvents(snapshot.events);
    requireThat(stable(canonical) === stable(snapshot), "Snapshot does not match its canonical event replay.");
    return canonical;
  }
  function redactPracticeAttempt(snapshot, options) {
    const canonical = validatePracticeSnapshot(snapshot);
    id(options.attemptId);
    id(options.redactionId);
    requireThat(typeof options.eventId === "function", "A fresh event ID factory is required.");
    const context = canonical.projections.redaction;
    if (context?.targets.some((target2) => target2.attemptId === options.attemptId)) return canonical;
    const target = ownValue(canonical.projections.attempts, options.attemptId);
    requireThat(target, "Unknown attempt to redact.");
    requireThat(!context?.targets.some((item) => item.redactionId === options.redactionId), "Redaction ID already exists.");
    requireThat(!canonical.events.some((event) => event.eventId === options.redactionId), "Redaction ID must not retain an existing event ID.");
    const survivingRelations = new Set(canonical.events.flatMap((event) => event.payload.type === "attemptStarted" && event.payload.attemptId !== target.attemptId && event.payload.relation ? [event.payload.relation.attemptId] : []));
    const facts = redactionFacts(canonical.events);
    let state = initial(canonical.sessionId, canonical.schemaVersion);
    const replacements = /* @__PURE__ */ new Map();
    let finalControl = null;
    for (let index = 0; index < canonical.events.length; index++) {
      const event = canonical.events[index], payload = event.payload;
      const targetCurrent = state.projections.currentAttemptId === target.attemptId;
      if (payload.type === "attemptStarted" && payload.attemptId === target.attemptId) {
        replacements.set(index, {
          type: "redactedAttemptBoundary",
          attemptId: target.attemptId,
          lineage: survivingRelations.has(target.attemptId) ? { unitId: target.reference.unitId, mode: target.mode, referenceVersion: target.reference.referenceVersion } : null
        });
      } else if (payload.type === "inputCommitted" && payload.attemptId === target.attemptId) {
        replacements.set(index, { type: "erasedSlot" });
      } else if (payload.type === "submissionCommitted" && payload.attemptId === target.attemptId) {
        const exposure = ownValue(currentRound(state.projections).unitExposure, target.reference.unitId) ?? emptyExposure;
        replacements.set(index, exposure.firstSubmissionSequence === null ? { type: "redactedFirstSubmissionBoundary", attemptId: target.attemptId, unitId: target.reference.unitId } : { type: "erasedSlot" });
      } else if (payload.type === "referenceExposed" && (payload.attemptId === target.attemptId || payload.attemptId === null && targetCurrent && payload.unitId === target.reference.unitId)) {
        replacements.set(index, { type: "redactedExposureBoundary", attemptId: target.attemptId, unitId: payload.unitId, kind: payload.kind });
      } else if (targetCurrent && ["timeAdvanced", "practicePauseChanged", "videoPauseChanged"].includes(payload.type)) {
        replacements.set(index, { type: "erasedSlot" });
      } else if (payload.type === "redactedAttemptBoundary" && payload.lineage && !survivingRelations.has(payload.attemptId)) {
        replacements.set(index, { type: "redactedAttemptBoundary", attemptId: payload.attemptId, lineage: null });
      }
      state = apply(state, event, facts);
      if (targetCurrent && (payload.type === "practicePauseChanged" || payload.type === "videoPauseChanged")) {
        finalControl = { index, manualPaused: state.projections.manualPaused, videoPaused: state.projections.videoPaused };
      }
    }
    if (finalControl) replacements.set(finalControl.index, { type: "redactedControlBoundary", manualPaused: finalControl.manualPaused, videoPaused: finalControl.videoPaused });
    const usedIds = new Set(canonical.events.map((event) => event.eventId));
    const freshId = () => {
      const next2 = options.eventId();
      id(next2);
      requireThat(!usedIds.has(next2), "Redaction event IDs must be fresh and unique.");
      usedIds.add(next2);
      return next2;
    };
    const events = canonical.events.map((event, index) => {
      const payload = replacements.get(index);
      return payload ? { schemaVersion: PRACTICE_SCHEMA_VERSION_V2, eventId: freshId(), sequence: event.sequence, sessionId: canonical.sessionId, payload } : event;
    });
    events.push({
      schemaVersion: PRACTICE_SCHEMA_VERSION_V2,
      eventId: freshId(),
      sequence: canonical.sequence + 1,
      sessionId: canonical.sessionId,
      payload: { type: "attemptRedactionCommitted", attemptId: target.attemptId, redactionId: options.redactionId }
    });
    return replayPracticeEvents(events);
  }
  var defaultClock2 = { now: () => performance.now(), wallTime: () => (/* @__PURE__ */ new Date()).toISOString(), id: () => globalThis.crypto.randomUUID() };
  var PracticeEngine = class {
    snapshot;
    clock;
    anchor;
    listeners = /* @__PURE__ */ new Set();
    constructor(options = {}) {
      requireGraphemeSupport();
      this.clock = options.clock ?? defaultClock2;
      this.anchor = this.clock.now();
      requireThat(Number.isFinite(this.anchor), "Clock must be finite.");
      if (options.snapshot) {
        requireThat(options.catalog === void 0, "Restore does not accept an overriding catalog; register new versions explicitly.");
        this.snapshot = validatePracticeSnapshot(options.snapshot);
        requireThat(options.sessionId === void 0 || options.sessionId === this.snapshot.sessionId, "Restored session ID mismatch.");
      } else {
        const sessionId = options.sessionId ?? this.clock.id();
        id(sessionId);
        this.snapshot = initial(sessionId);
        this.emit({ type: "sessionStarted", catalog: options.catalog ?? [] });
      }
    }
    getSnapshot = () => this.snapshot;
    subscribe = (listener) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    };
    emit(payload) {
      const at = this.clock.wallTime();
      return this.dispatch({
        schemaVersion: PRACTICE_SCHEMA_VERSION,
        eventId: this.clock.id(),
        sequence: this.snapshot.sequence + 1,
        sessionId: this.snapshot.sessionId,
        occurredAt: at,
        recordedAt: at,
        payload
      });
    }
    dispatch(event) {
      validateEvent(event);
      requireThat(event.schemaVersion === PRACTICE_SCHEMA_VERSION, "Synthetic redaction records cannot be dispatched by a live engine.");
      const duplicate = this.snapshot.events.find((item) => item.eventId === event.eventId);
      if (duplicate) {
        requireThat(stable(duplicate) === stable(event), "Conflicting duplicate event ID.");
        return this.snapshot;
      }
      this.snapshot = apply(this.snapshot, structuredClone(event));
      this.listeners.forEach((listener) => listener());
      return this.snapshot;
    }
    sampleClock = () => {
      const now = this.clock.now();
      requireThat(Number.isFinite(now) && now >= this.anchor, "Monotonic clock must not move backwards.");
      const elapsed = now - this.anchor;
      this.anchor = now;
      if (elapsed > 0 && active(this.snapshot.projections)) this.emit({ type: "timeAdvanced", deltaMs: elapsed });
      return this.snapshot;
    };
    registerMaterial(material) {
      plainJSON(material);
      mergeMaterial(this.snapshot.projections.catalog, material);
      this.sampleClock();
      return this.emit({ type: "materialRegistered", material });
    }
    startRound(options) {
      const p = this.snapshot.projections;
      requireThat(!p.currentRoundId || ownValue(p.rounds, p.currentRoundId)?.endedAt !== null, "Explicitly end the current round before starting another.");
      this.sampleClock();
      return this.emit({ type: "roundStarted", materialId: options.materialId, practiceRoundId: options.practiceRoundId ?? this.clock.id() });
    }
    endRound() {
      const round = currentRound(this.snapshot.projections);
      this.sampleClock();
      return this.emit({ type: "roundEnded", practiceRoundId: round.practiceRoundId });
    }
    startAttempt(options) {
      return this.beginAttempt(options, null);
    }
    beginAttempt(options, relation) {
      const p = this.snapshot.projections;
      editable(p);
      const round = currentRound(p);
      const unit = p.catalog.find((item) => item.materialId === round.materialId)?.units.find((item) => item.unitId === options.unitId);
      requireThat(unit, "Unknown unit.");
      const referenceVersion = options.referenceVersion ?? unit.references.at(-1).referenceVersion;
      this.sampleClock();
      const attemptId = options.attemptId ?? this.clock.id();
      this.emit({ type: "attemptStarted", attemptId, unitId: options.unitId, mode: options.mode, referenceVersion, relation });
      return ownValue(this.snapshot.projections.attempts, attemptId);
    }
    retryAttempt() {
      const attempt = currentAttempt(this.snapshot.projections);
      return this.beginAttempt({ unitId: attempt.reference.unitId, referenceVersion: attempt.reference.referenceVersion, mode: attempt.mode }, { kind: "retry", attemptId: attempt.attemptId });
    }
    switchMode(mode) {
      const attempt = currentAttempt(this.snapshot.projections);
      requireThat(mode !== attempt.mode, "A mode switch must change mode.");
      return this.beginAttempt({ unitId: attempt.reference.unitId, referenceVersion: attempt.reference.referenceVersion, mode }, { kind: "mode-switch", attemptId: attempt.attemptId });
    }
    input(text, source = "typed") {
      requireGraphemeSupport();
      const p = this.snapshot.projections;
      editable(p);
      const attempt = currentAttempt(p);
      requireThat(typeof text === "string" && sources.includes(source), "Invalid committed input or source.");
      if (attempt.draft.text === text) return this.snapshot;
      this.sampleClock();
      return this.emit({ type: "inputCommitted", attemptId: attempt.attemptId, text, source });
    }
    submit() {
      const p = this.snapshot.projections;
      editable(p);
      const attempt = currentAttempt(p);
      requireThat(attempt.mode !== "recording-comparison", "Recording comparison requires real media evidence; submission is not implemented.");
      requireThat(attempt.draft.text.trim(), "Submission requires a nonempty committed draft.");
      const latest = attempt.revisions.at(-1) ?? attempt.firstSubmission;
      if (latest?.draftVersion === attempt.draft.version) return latest;
      this.sampleClock();
      this.emit({ type: "submissionCommitted", attemptId: attempt.attemptId, submissionId: this.clock.id(), draftVersion: attempt.draft.version });
      const updated = ownValue(this.snapshot.projections.attempts, attempt.attemptId);
      return updated.revisions.at(-1) ?? updated.firstSubmission;
    }
    exposeReference(kind) {
      const p = this.snapshot.projections;
      editable(p);
      const attempt = currentAttempt(p);
      this.sampleClock();
      return this.emit({ type: "referenceExposed", unitId: attempt.reference.unitId, attemptId: attempt.attemptId, kind });
    }
    exposeUnitReference(unitId, kind) {
      editable(this.snapshot.projections);
      currentRound(this.snapshot.projections);
      this.sampleClock();
      return this.emit({ type: "referenceExposed", unitId, attemptId: null, kind });
    }
    pausePractice() {
      currentRound(this.snapshot.projections);
      if (this.snapshot.projections.manualPaused) return this.snapshot;
      this.sampleClock();
      return this.emit({ type: "practicePauseChanged", paused: true });
    }
    resumePractice() {
      currentRound(this.snapshot.projections);
      if (!this.snapshot.projections.manualPaused) return this.snapshot;
      this.sampleClock();
      return this.emit({ type: "practicePauseChanged", paused: false });
    }
    setVideoPaused(paused) {
      requireThat(typeof paused === "boolean", "Pause flag must be boolean.");
      if (this.snapshot.projections.videoPaused === paused) return this.snapshot;
      this.sampleClock();
      return this.emit({ type: "videoPauseChanged", paused });
    }
  };

  // studio/core/practice-repository.ts
  function canonicalJson(value) {
    if (value === null || typeof value !== "object") {
      const encoded = JSON.stringify(value);
      if (encoded === void 0) throw new Error("Practice facts must contain JSON-safe values.");
      return encoded;
    }
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  var PracticeStorageConflict = class extends Error {
    constructor(message2 = "\u76F8\u540C\u4E8B\u4EF6\u8EAB\u4EFD\u7684\u5185\u5BB9\u4E0D\u540C\uFF0C\u5F53\u524D\u672C\u673A\u8BB0\u5F55\u672A\u88AB\u8986\u76D6\u3002") {
      super(message2);
      this.name = "PracticeStorageConflict";
    }
  };
  var DevelopmentPracticeRepository = class {
    database = null;
    tail = Promise.resolve();
    state = Object.freeze({ state: "idle", pending: 0, error: null, readError: null, lastLoadedSequence: null });
    listeners = /* @__PURE__ */ new Set();
    factory;
    databaseName;
    constructor(options) {
      if (false) throw new Error("Practice data batch1 is disabled in production until privacy and deletion fences are accepted.");
      if (!/^lingotrace-dev-data-[a-zA-Z0-9_-]+$/.test(options.databaseName)) throw new Error("This batch requires an explicit isolated lingotrace-dev-data-* database.");
      this.databaseName = options.databaseName;
      this.factory = options.indexedDB ?? globalThis.indexedDB;
    }
    getStatus = () => this.state;
    subscribe = (listener) => {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    };
    status(patch) {
      this.state = Object.freeze({ ...this.state, ...patch });
      for (const listener of this.listeners) listener();
    }
    open() {
      if (false) return Promise.reject(new Error("Practice data batch1 is disabled in production."));
      if (this.database) return this.database;
      this.database = new Promise((resolve, reject) => {
        if (!this.factory) {
          reject(new Error("IndexedDB unavailable; no durable save occurred."));
          return;
        }
        const request = this.factory.open(this.databaseName, 1);
        let rejected2 = false;
        request.onupgradeneeded = () => {
          const db = request.result;
          const events = db.createObjectStore("events", { keyPath: ["sessionId", "sequence"] });
          events.createIndex("bySession", "sessionId");
          events.createIndex("byEventId", ["sessionId", "eventId"], { unique: true });
          db.createObjectStore("heads", { keyPath: "sessionId" });
        };
        request.onerror = () => {
          rejected2 = true;
          reject(request.error ?? new Error("Could not open isolated storage."));
        };
        request.onblocked = () => {
          rejected2 = true;
          reject(new Error("Isolated database is blocked by another connection."));
        };
        request.onsuccess = () => {
          if (rejected2) {
            request.result.close();
            return;
          }
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            this.database = null;
          };
          resolve(db);
        };
      }).catch((error) => {
        this.database = null;
        throw error;
      });
      return this.database;
    }
    save(snapshot) {
      let captured;
      try {
        captured = validatePracticeSnapshot(snapshot);
      } catch (error) {
        this.status({ state: "error", error: error instanceof Error ? error.message : "Invalid practice snapshot." });
        return Promise.reject(error);
      }
      this.status({ state: "pending", pending: this.state.pending + 1, error: null });
      const write = this.tail.then(async () => {
        const db = await this.open();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(["events", "heads"], "readwrite"), events = tx.objectStore("events"), heads = tx.objectStore("heads");
          let failure = null, receipt;
          const request = events.index("bySession").getAll(captured.sessionId);
          request.onsuccess = () => {
            try {
              const previous = request.result.sort((a, b) => a.sequence - b.sequence);
              for (let i = 0; i < Math.min(previous.length, captured.events.length); i++) if (canonicalJson(previous[i]) !== canonicalJson(captured.events[i])) throw new PracticeStorageConflict();
              if (previous.length >= captured.events.length) {
                receipt = { sessionId: captured.sessionId, storedSequence: previous.at(-1)?.sequence ?? 0, disposition: previous.length === captured.events.length ? "already-present" : "newer-preserved" };
                return;
              }
              for (const event of captured.events.slice(previous.length)) events.add(event);
              heads.put({ sessionId: captured.sessionId, schemaVersion: captured.schemaVersion, sequence: captured.sequence, eventCount: captured.events.length });
              receipt = { sessionId: captured.sessionId, storedSequence: captured.sequence, disposition: "appended" };
            } catch (error) {
              failure = error;
              tx.abort();
            }
          };
          tx.oncomplete = () => resolve(receipt);
          tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? new Error("Practice transaction did not commit."));
        });
      }).then((receipt) => {
        this.status({ pending: this.state.pending - 1, state: this.state.pending > 1 ? "pending" : "saved", error: null });
        return receipt;
      }, (error) => {
        this.status({ pending: Math.max(0, this.state.pending - 1), state: "error", error: error instanceof Error ? error.message : "Practice save failed." });
        throw error;
      });
      this.tail = write.then(() => {
      }, () => {
      });
      return write;
    }
    async load(sessionId) {
      try {
        await this.tail;
        const db = await this.open();
        const stored = await new Promise((resolve, reject) => {
          const tx = db.transaction(["events", "heads"], "readonly");
          let events = [], head;
          const rows = tx.objectStore("events").index("bySession").getAll(sessionId), metadata = tx.objectStore("heads").get(sessionId);
          rows.onsuccess = () => {
            events = rows.result;
          };
          metadata.onsuccess = () => {
            head = metadata.result;
          };
          tx.oncomplete = () => resolve({ events, head });
          tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Practice read failed."));
        });
        if (!stored.head && !stored.events.length) return null;
        if (!stored.head || stored.head.eventCount !== stored.events.length) throw new Error("Practice event/head count mismatch.");
        const snapshot = replayPracticeEvents(stored.events.sort((a, b) => a.sequence - b.sequence));
        if (snapshot.sessionId !== sessionId || snapshot.sequence !== stored.head.sequence || snapshot.schemaVersion !== stored.head.schemaVersion) throw new Error("Practice head does not match its facts.");
        this.status({ readError: null, lastLoadedSequence: snapshot.sequence });
        return snapshot;
      } catch (error) {
        this.status({ readError: error instanceof Error ? error.message : "Practice read failed." });
        throw error;
      }
    }
    async close() {
      await this.tail;
      if (this.database) {
        (await this.database).close();
        this.database = null;
      }
    }
  };

  // studio/core/practice-export.ts
  var PRACTICE_EXPORT_VERSION = "lingotrace-practice-export-v1";
  var PRACTICE_EXPORT_VERSION_V2 = "lingotrace-practice-export-v2";
  function exportPracticeSnapshot(input, exportedAt) {
    if (!Number.isFinite(Date.parse(exportedAt))) throw new Error("An explicit valid export timestamp is required.");
    const snapshot = validatePracticeSnapshot(input);
    const rows = [
      { recordType: "session", recordId: snapshot.sessionId, sessionId: snapshot.sessionId, sequence: snapshot.sequence, payload: { schemaVersion: snapshot.schemaVersion, sessionId: snapshot.sessionId, sequence: snapshot.sequence } },
      ...snapshot.events.map((event) => ({ recordType: "event", recordId: event.eventId, sessionId: snapshot.sessionId, sequence: event.sequence, payload: event })),
      { recordType: "projections", recordId: snapshot.sessionId, sessionId: snapshot.sessionId, sequence: snapshot.sequence, payload: snapshot.projections }
    ];
    const document = { exportVersion: snapshot.schemaVersion === "lingotrace-practice-v2" ? PRACTICE_EXPORT_VERSION_V2 : PRACTICE_EXPORT_VERSION, exportedAt, snapshot, rows };
    const columns = ["record_type", "record_id", "session_id", "sequence", "exported_at", "payload_json"];
    const csv = "\uFEFF" + [columns.map(csvCell).join(","), ...rows.map((row) => [row.recordType, row.recordId, row.sessionId, row.sequence, exportedAt, JSON.stringify(row.payload)].map(csvCell).join(","))].join("\r\n") + "\r\n";
    return { snapshot, rows, json: JSON.stringify(document, null, 2), csv };
  }

  // studio/core/repository.ts
  var IndexedDBTrainingRepository = class {
    factory;
    dbName;
    database = null;
    queue = Promise.resolve();
    listeners = /* @__PURE__ */ new Set();
    status = Object.freeze({ state: "in-memory", pendingWrites: 0, lastPersistedSessionId: null, lastPersistedSequence: null, error: null });
    constructor(options = {}) {
      this.dbName = options.dbName ?? "lingotrace-studio-v1";
      try {
        this.factory = options.indexedDB ?? globalThis.indexedDB;
      } catch {
        this.factory = void 0;
      }
    }
    getStatus = () => this.status;
    subscribe = (listener) => {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    };
    update(patch) {
      this.status = Object.freeze({ ...this.status, ...patch });
      for (const listener of this.listeners) listener();
    }
    open() {
      if (this.database) return this.database;
      this.database = new Promise((resolve, reject) => {
        if (!this.factory) {
          reject(new Error("IndexedDB is unavailable. This session remains in memory; export JSON/CSV to keep it."));
          return;
        }
        const request = this.factory.open(this.dbName, 1);
        let rejected2 = false;
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "sessionId" });
          if (!db.objectStoreNames.contains("events")) db.createObjectStore("events", { keyPath: ["sessionId", "eventId"] });
          if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
        };
        request.onerror = () => {
          rejected2 = true;
          reject(request.error ?? new Error("Could not open IndexedDB."));
        };
        request.onblocked = () => {
          rejected2 = true;
          reject(new Error("Database upgrade is blocked by another tab. Close older tabs and retry saving, or export this session."));
        };
        request.onsuccess = () => {
          if (rejected2) {
            request.result.close();
            return;
          }
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            this.database = null;
          };
          resolve(db);
        };
      }).catch((error) => {
        this.database = null;
        throw error;
      });
      return this.database;
    }
    async loadLatest() {
      await this.queue;
      try {
        const db = await this.open();
        const record = await new Promise((resolve, reject) => {
          const transaction = db.transaction(["sessions", "meta"], "readonly");
          let value = null;
          const latest = transaction.objectStore("meta").get("latest");
          latest.onsuccess = () => {
            if (!latest.result?.sessionId) return;
            const session = transaction.objectStore("sessions").get(latest.result.sessionId);
            session.onsuccess = () => {
              value = session.result ?? null;
            };
          };
          transaction.oncomplete = () => resolve(value);
          transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error("Could not restore the saved session."));
        });
        if (!record) return null;
        const snapshot = replay(record.snapshot.events, record.snapshot.material);
        if (snapshot.sessionId !== record.sessionId || snapshot.sequence !== record.sequence) throw new Error("Saved session metadata does not match its event log.");
        this.update({ state: this.status.pendingWrites ? "pending" : "persisted", lastPersistedSessionId: snapshot.sessionId, lastPersistedSequence: snapshot.sequence, error: null });
        return snapshot;
      } catch (error) {
        this.update({ state: "error", error: errorText(error) });
        throw error;
      }
    }
    /** Serial writes; a single transaction stores the event log, snapshot, and latest pointer. */
    saveSession(snapshot) {
      let captured;
      try {
        captured = validateSnapshot(snapshot);
      } catch (error) {
        this.update({ state: "error", error: errorText(error) });
        return Promise.reject(error);
      }
      this.update({ state: "pending", pendingWrites: this.status.pendingWrites + 1, error: null });
      const write = this.queue.then(async () => {
        const db = await this.open();
        const stored = await new Promise((resolve, reject) => {
          const transaction = db.transaction(["sessions", "events", "meta"], "readwrite");
          const sessions = transaction.objectStore("sessions");
          let result;
          let failure = null;
          const existing = sessions.get(captured.sessionId);
          existing.onsuccess = () => {
            try {
              const previous = existing.result;
              if (previous) {
                const shared = Math.min(previous.snapshot.events.length, captured.events.length);
                for (let i = 0; i < shared; i++) {
                  if (JSON.stringify(previous.snapshot.events[i]) !== JSON.stringify(captured.events[i])) throw new Error("This session was changed in another tab. Export this in-memory session before starting a new round.");
                }
                if (previous.sequence >= captured.sequence) {
                  result = previous;
                  return;
                }
              }
              result = { sessionId: captured.sessionId, sequence: captured.sequence, snapshot: captured, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
              const events = transaction.objectStore("events");
              for (const event of captured.events.slice(previous?.snapshot.events.length ?? 0)) events.add(event);
              sessions.put(result);
              transaction.objectStore("meta").put({ key: "latest", sessionId: captured.sessionId });
            } catch (error) {
              failure = error instanceof Error ? error : new Error(String(error));
              transaction.abort();
            }
          };
          transaction.oncomplete = () => resolve(result);
          transaction.onerror = transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("Session save failed; the in-memory session can still be exported."));
        });
        this.update({
          pendingWrites: this.status.pendingWrites - 1,
          state: this.status.pendingWrites > 1 ? "pending" : "persisted",
          lastPersistedSessionId: stored.sessionId,
          lastPersistedSequence: stored.sequence,
          error: null
        });
      }).catch((error) => {
        this.update({ pendingWrites: Math.max(0, this.status.pendingWrites - 1), state: "error", error: errorText(error) });
        throw error;
      });
      this.queue = write.catch(() => {
      });
      return write;
    }
    async close() {
      await this.queue;
      if (this.database) (await this.database).close();
      this.database = null;
    }
  };
  function errorText(error) {
    return error instanceof Error ? error.message : String(error);
  }

  // scripts/data-batch1-browser.ts
  function check(condition, message2) {
    if (!condition) throw new Error(`Data QA failed: ${message2}`);
  }
  function current(snapshot) {
    return snapshot.projections.attempts[snapshot.projections.currentAttemptId];
  }
  function parseCSV(input) {
    const rows = [];
    let row = [], cell = "", quoted = false;
    const text = input.replace(/^\uFEFF/, "");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") {
        row.push(cell);
        cell = "";
      } else if (c === "\n") {
        row.push(cell.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        cell = "";
      } else cell += c;
    }
    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }
  async function digest(snapshot) {
    const bytes = new TextEncoder().encode(canonicalJson(snapshot));
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  async function runPracticeDataBatchOneQA() {
    check(!!globalThis.indexedDB, "real browser IndexedDB required");
    const suffix = crypto.randomUUID(), databaseName = `lingotrace-dev-data-browser-${suffix}`, legacyName = `lingotrace-dev-data-legacy-${suffix}`;
    let now = 0, serial = 0;
    const clock = { now: () => now, wallTime: () => new Date(Date.UTC(2026, 9, 8, 8) + now).toISOString(), id: () => `fixture-${++serial}` };
    const material = ORIGINAL_PRACTICE_MATERIAL, unitId = material.units[0].unitId, answerX = "Could I have coffee, please?", answerY = "Could I have a coffee, please?";
    const engine = new PracticeEngine({ clock, sessionId: `fixture-session-${suffix}`, catalog: [material] });
    engine.startRound({ materialId: material.materialId });
    engine.startAttempt({ unitId, mode: "dictation", attemptId: "a1" });
    engine.input(answerX);
    now = 1e4;
    engine.sampleClock();
    engine.submit();
    engine.pausePractice();
    const paused = engine.getSnapshot(), frozenSequence = paused.sequence;
    now = 3e4;
    let inputRejected = false, submitRejected = false;
    try {
      engine.input("must not be accepted");
    } catch {
      inputRejected = true;
    }
    try {
      engine.submit();
    } catch {
      submitRejected = true;
    }
    check(inputRejected && submitRejected, "manual pause rejects input and submission");
    check(engine.getSnapshot().sequence === frozenSequence, "paused callbacks cannot append facts");
    const repository = new DevelopmentPracticeRepository({ databaseName });
    await repository.save(paused);
    await repository.close();
    const reopened = new DevelopmentPracticeRepository({ databaseName }), storedPause = await reopened.load(paused.sessionId);
    check(storedPause && canonicalJson(storedPause) === canonicalJson(paused), "closed/reopened real IDB restores paused snapshot");
    const restored = new PracticeEngine({ snapshot: storedPause, clock });
    restored.resumePractice();
    restored.exposeReference("hint");
    now = 35e3;
    restored.sampleClock();
    restored.input(answerY);
    restored.submit();
    let state = restored.getSnapshot(), a1 = state.projections.attempts.a1;
    check(a1.firstSubmission?.answer === answerX && a1.revisions[0]?.answer === answerY, "first answer fixed, revision belongs to same attempt");
    check(a1.activeMs === 15e3, "20seconds manual pause excluded from10+5seconds practice");
    check(a1.firstSubmission.exposureAtSubmission.length === 0 && a1.revisions[0].exposureAtSubmission.length === 1, "post-answer hint cannot rewrite first-answer conditions");
    restored.setVideoPaused(true);
    now = 37e3;
    restored.sampleClock();
    check(current(restored.getSnapshot()).activeMs === 17e3, "video-only pause does not freeze practice");
    const updated = { ...material, units: material.units.map((unit) => unit.unitId === unitId ? { ...unit, references: [...unit.references, { referenceVersion: "v2", text: "Could I have some coffee, please?", startSeconds: 0, endSeconds: 6 }] } : unit) };
    restored.registerMaterial(updated);
    check(restored.getSnapshot().projections.attempts.a1.reference.referenceVersion === "v1", "reference update cannot retarget old attempt");
    const audioAttempt = restored.switchMode("recording-comparison");
    check(audioAttempt.relation?.attemptId === "a1" && audioAttempt.reference.referenceVersion === "v1", "mode switch is a related new fixed-reference attempt");
    let noFakeAudio = false;
    try {
      restored.submit();
    } catch {
      noFakeAudio = true;
    }
    check(noFakeAudio, "text submission cannot fabricate audio evidence/completion");
    check(!current(restored.getSnapshot()).practiceComplete && !current(restored.getSnapshot()).evaluationComplete && current(restored.getSnapshot()).targetMet === null, "recording practice and evaluation remain uncompleted/unassessed");
    restored.switchMode("dictation");
    restored.input(answerY);
    const sameRound = restored.submit();
    check(sameRound.exposureAtSubmission.length === 1, "exposure survives mode changes in same round");
    restored.endRound();
    restored.startRound({ materialId: material.materialId });
    restored.startAttempt({ unitId, mode: "dictation", referenceVersion: "v2" });
    restored.input("Could I have some coffee, please?");
    const freshRound = restored.submit();
    check(freshRound.exposureAtSubmission.length === 0, "explicit next round clears only round-local exposure");
    state = restored.getSnapshot();
    await reopened.save(state);
    await reopened.close();
    const third = new DevelopmentPracticeRepository({ databaseName });
    const read = await third.load(state.sessionId);
    check(read && canonicalJson(read) === canonicalJson(state), "second save/reopen reconstructs exact final state");
    const exported = exportPracticeSnapshot(read, "2026-10-08T08:30:00.000Z"), json = JSON.parse(exported.json), csv = parseCSV(exported.csv), headers = csv.shift();
    const eventRows = csv.filter((row) => row[headers.indexOf("record_type")] === "event").map((row) => JSON.parse(row[headers.indexOf("payload_json")]));
    check(canonicalJson(eventRows) === canonicalJson(read.events) && canonicalJson(json.snapshot) === canonicalJson(read), "CSV and JSON use same exact facts and projection boundary");
    const raw2 = await new Promise((resolve, reject) => {
      const open = indexedDB.open(databaseName, 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction(["heads", "events"], "readonly");
        let head, eventCount = 0;
        const h = tx.objectStore("heads").get(read.sessionId), c = tx.objectStore("events").index("bySession").count(read.sessionId);
        h.onsuccess = () => {
          head = h.result;
        };
        c.onsuccess = () => {
          eventCount = c.result;
        };
        tx.oncomplete = () => {
          resolve({ head, eventCount, stores: Array.from(db.objectStoreNames) });
          db.close();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
    });
    check(raw2.eventCount === read.events.length && raw2.head.sequence === read.sequence && !("snapshot" in raw2.head), "only one fact store; heads contain revision metadata only");
    const legacy = new TrainingEngine({ clock, sessionId: "legacy-compatibility" });
    legacy.input("Could I have a coffee, please?");
    legacy.submit();
    const legacyBefore = legacy.getSnapshot();
    const oldWriter = new IndexedDBTrainingRepository({ dbName: legacyName });
    await oldWriter.saveSession(legacyBefore);
    await oldWriter.close();
    await third.save(read);
    const oldReader = new IndexedDBTrainingRepository({ dbName: legacyName });
    check(canonicalJson(await oldReader.loadLatest()) === canonicalJson(legacyBefore), "old v22 format remains readable unchanged in isolated compatibility DB");
    await oldReader.close();
    await third.close();
    return { passed: true, sourceBaseline: "3921e15e2b43a02509c6f288b1099c0fe6982f1f", databaseName, legacyName, sessionId: read.sessionId, snapshotSHA256: await digest(read), eventCount: read.events.length, attemptCount: Object.keys(read.projections.attempts).length, firstAnswer: a1.firstSubmission.answer, revision: a1.revisions[0].answer, pausedMsExcluded: 2e4, practiceMsBeforeModeChange: 17e3, rawStores: raw2.stores, browser: navigator.userAgent, executionEnvironment: typeof window === "undefined" ? "non-browser-harness" : "browser", boundary: "IndexedDB evidence depends on the reported execution environment. Deterministic fixture input commands are not a connected user UI, native keyboard or audio capture. Privacy/delete/review/regrade gates remain next batch." };
  }
  async function verifyPracticeDataReload(expected) {
    const repository = new DevelopmentPracticeRepository({ databaseName: expected.databaseName });
    const snapshot = await repository.load(expected.sessionId);
    check(snapshot, "saved fixture survives actual page reload");
    const actual = await digest(snapshot);
    check(actual === expected.snapshotSHA256, "snapshot digest after reload");
    await repository.close();
    return { passed: true, sessionId: snapshot.sessionId, sequence: snapshot.sequence, snapshotSHA256: actual };
  }

  // studio/core/practice-fenced-repository.ts
  var legacyStores = ["control", "tombstones", "heads", "events"];
  var allStores = [...legacyStores, "attemptTombstones"];
  var message = (error) => error instanceof Error ? error.message : "Isolated practice storage failed.";
  function devOnly() {
    if (false) throw new Error("Practice data batch2A is disabled in production.");
  }
  function stableId(id2) {
    if (typeof id2 !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id2) || ["constructor", "prototype", "__proto__"].includes(id2)) throw new Error("Invalid stable session ID.");
  }
  function next(value) {
    if (!Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) throw new Error("Invalid or exhausted deletion generation.");
    return value + 1;
  }
  function controlValue(value) {
    if (!value || value.key !== "recording" || typeof value.recordingEnabled !== "boolean" || ![value.globalGeneration, value.deletionWatermark, value.clearWatermark].every((n) => Number.isSafeInteger(n) && n >= 0)) throw new Error("Missing or invalid durable recording control.");
    return value;
  }
  var PracticeWriteFenceError = class extends Error {
    constructor(message2 = "Practice write permit was revoked; a new recorded session is required.") {
      super(message2);
      this.name = "PracticeWriteFenceError";
    }
  };
  var FencedPracticeRepository = class {
    databaseName;
    factory;
    initialRecordingEnabled;
    exportFormatter;
    database = null;
    preparation = null;
    tail = Promise.resolve();
    prepared = false;
    closed = false;
    pageEnabled = false;
    pageEpoch = 0;
    settingOperation = 0;
    operation = 0;
    sessionEpochs = /* @__PURE__ */ new Map();
    usedIds = /* @__PURE__ */ new Set();
    blockedIds = /* @__PURE__ */ new Set();
    permits = /* @__PURE__ */ new WeakMap();
    activeWrites = /* @__PURE__ */ new Set();
    exportEpoch = 0;
    sessionExportEpochs = /* @__PURE__ */ new Map();
    exportHandles = /* @__PURE__ */ new WeakMap();
    activeExports = /* @__PURE__ */ new Set();
    listeners = /* @__PURE__ */ new Set();
    state = Object.freeze({ state: "idle", pending: 0, error: null, readError: null, lastLoadedSequence: null, prepared: false, recordingEnabled: false, durableRecordingEnabled: null, settingsState: "unprepared", settingsError: null, requiresNewRecordedSession: true });
    constructor(options) {
      devOnly();
      if (!options || !/^lingotrace-dev-fenced-[A-Za-z0-9_-]+$/.test(options.databaseName)) throw new Error("An explicit isolated lingotrace-dev-fenced-* database is required.");
      if (options.initialRecordingEnabled !== void 0 && typeof options.initialRecordingEnabled !== "boolean") throw new Error("Initial recording preference must be boolean.");
      if (options.exportFormatter !== void 0 && typeof options.exportFormatter !== "function") throw new Error("Export formatter must be a function.");
      this.databaseName = options.databaseName;
      this.factory = options.indexedDB ?? globalThis.indexedDB;
      this.initialRecordingEnabled = options.initialRecordingEnabled === true;
      this.exportFormatter = options.exportFormatter ?? (async (snapshot, exportedAt) => {
        const { json, csv } = exportPracticeSnapshot(snapshot, exportedAt);
        return { json, csv };
      });
    }
    getStatus = () => this.state;
    subscribe = (listener) => {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    };
    status(patch) {
      this.state = Object.freeze({ ...this.state, ...patch });
      for (const listener of this.listeners) {
        try {
          listener();
        } catch {
        }
      }
    }
    abortWrites(sessionId) {
      for (const item of this.activeWrites) if (sessionId === void 0 || item.sessionId === sessionId) {
        try {
          item.tx.abort();
        } catch {
        }
      }
    }
    invalidateExports(sessionId) {
      if (sessionId === void 0) this.exportEpoch++;
      else this.sessionExportEpochs.set(sessionId, (this.sessionExportEpochs.get(sessionId) ?? 0) + 1);
      for (const context of this.activeExports) if (sessionId === void 0 || context.sessionId === sessionId) {
        context.valid = false;
        context.payload = null;
        context.boundary = null;
        this.activeExports.delete(context);
      }
    }
    assertOpen() {
      devOnly();
      if (this.closed) throw new PracticeWriteFenceError("This repository is closed.");
    }
    open() {
      try {
        this.assertOpen();
      } catch (error) {
        return Promise.reject(error);
      }
      if (this.database) return this.database;
      this.database = new Promise((resolve, reject) => {
        if (!this.factory) {
          reject(new Error("IndexedDB unavailable; no durable change occurred."));
          return;
        }
        const request = this.factory.open(this.databaseName, 2);
        let rejected2 = false;
        request.onupgradeneeded = (event) => {
          try {
            if (rejected2 || this.closed) throw new Error("Isolated storage opening was canceled.");
            const db = request.result;
            if (event.oldVersion === 0) {
              const events = db.createObjectStore("events", { keyPath: ["sessionId", "sequence"] });
              events.createIndex("bySession", "sessionId");
              events.createIndex("byEventId", ["sessionId", "eventId"], { unique: true });
              db.createObjectStore("heads", { keyPath: "sessionId" });
              db.createObjectStore("tombstones", { keyPath: "sessionId" });
              db.createObjectStore("control", { keyPath: "key" }).add({ key: "recording", recordingEnabled: this.initialRecordingEnabled, globalGeneration: 0, deletionWatermark: 0, clearWatermark: 0 });
            } else if (event.oldVersion !== 1 || !legacyStores.every((name) => db.objectStoreNames.contains(name))) throw new Error("Unexpected fenced database schema.");
            db.createObjectStore("attemptTombstones", { keyPath: ["sessionId", "attemptId"] }).createIndex("bySession", "sessionId");
          } catch (error) {
            rejected2 = true;
            reject(error);
            request.transaction?.abort();
          }
        };
        request.onerror = () => {
          rejected2 = true;
          reject(request.error ?? new Error("Could not open isolated storage."));
        };
        request.onblocked = () => {
          rejected2 = true;
          reject(new Error("Isolated database is blocked by another connection."));
        };
        request.onsuccess = () => {
          const db = request.result;
          if (rejected2 || this.closed) {
            db.close();
            reject(new Error("Isolated storage opening was canceled."));
            return;
          }
          if (!allStores.every((name) => db.objectStoreNames.contains(name))) {
            db.close();
            reject(new Error("Unexpected fenced database schema."));
            return;
          }
          db.onversionchange = () => {
            db.close();
            this.database = null;
            this.pageEnabled = false;
            this.pageEpoch++;
            this.abortWrites();
            this.invalidateExports();
            this.status({ recordingEnabled: false, requiresNewRecordedSession: true });
          };
          resolve(db);
        };
      }).catch((error) => {
        this.database = null;
        throw error;
      });
      return this.database;
    }
    enqueue(job, pendingStatus = {}) {
      const ticket = ++this.operation;
      const work = this.tail.then(job).then((value) => {
        this.status({ pending: Math.max(0, this.state.pending - 1), ...ticket === this.operation ? { state: "saved", error: null } : {} });
        return value;
      }, (error) => {
        this.status({ pending: Math.max(0, this.state.pending - 1), ...ticket === this.operation ? { state: "error", error: message(error) } : {} });
        throw error;
      });
      this.tail = work.then(() => {
      }, () => {
      });
      this.status({ pending: this.state.pending + 1, state: "pending", error: null, ...pendingStatus });
      return work;
    }
    fail(error) {
      ++this.operation;
      this.status({ state: "error", error: message(error) });
      return Promise.reject(error);
    }
    transact(db, stores, mode, work, sessionId) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(stores, mode);
        let failure, result, ready = false;
        const active2 = sessionId === void 0 ? null : { tx, sessionId };
        if (active2) this.activeWrites.add(active2);
        const cleanup = () => {
          if (active2) this.activeWrites.delete(active2);
        };
        const guard = (callback) => {
          try {
            callback();
          } catch (error) {
            failure = error;
            try {
              tx.abort();
            } catch {
            }
          }
        };
        tx.oncomplete = () => {
          cleanup();
          if (ready) resolve(result);
          else reject(new Error("Transaction completed without a result."));
        };
        tx.onabort = tx.onerror = () => {
          cleanup();
          reject(failure ?? tx.error ?? new PracticeWriteFenceError("Practice transaction aborted; no durable change occurred."));
        };
        guard(() => work(tx, guard, (value) => {
          result = value;
          ready = true;
        }));
      });
    }
    /** All these requests belong to the SAME transaction that will write the facts/head. */
    boundary(tx, id2, guard, ready) {
      const requests = [tx.objectStore("control").get("recording"), tx.objectStore("heads").get(id2), tx.objectStore("tombstones").get(id2), tx.objectStore("events").index("bySession").getAll(id2), tx.objectStore("attemptTombstones").index("bySession").getAll(id2)];
      let count = requests.length;
      for (const request of requests) request.onsuccess = () => guard(() => {
        if (--count === 0) ready(controlValue(requests[0].result), requests[1].result, requests[2].result, requests[3].result.sort((a, b) => a.sequence - b.sequence), requests[4].result);
      });
    }
    assertPage(epoch, id2, sessionEpoch) {
      this.assertOpen();
      if (!this.prepared || !this.pageEnabled || epoch !== this.pageEpoch || sessionEpoch !== (this.sessionEpochs.get(id2) ?? 0) || this.blockedIds.has(id2)) throw new PracticeWriteFenceError();
    }
    assertHead(id2, head, events) {
      if (!head || head.sessionId !== id2 || head.eventCount !== events.length || head.sequence !== events.at(-1)?.sequence || !Number.isSafeInteger(head.sessionGeneration) || head.sessionGeneration < 0 || !Number.isSafeInteger(head.globalGeneration) || head.globalGeneration < 0) throw new PracticeWriteFenceError("Missing or invalid session head; save cannot recreate a session.");
    }
    canonicalSnapshot(id2, head, events, attempts) {
      this.assertHead(id2, head, events);
      const snapshot = replayPracticeEvents(events);
      if (snapshot.sessionId !== id2 || snapshot.sequence !== head.sequence || snapshot.schemaVersion !== head.schemaVersion) throw new Error("Practice head does not match its canonical facts.");
      const targets = snapshot.projections.redaction?.targets ?? [];
      if (targets.length !== attempts.length) throw new PracticeWriteFenceError("Attempt deletion lineage does not match canonical facts.");
      for (const row of attempts) {
        if (canonicalJson(Object.keys(row).sort()) !== canonicalJson(["attemptId", "deletionWatermark", "sessionGeneration", "sessionId"]) || row.sessionId !== id2 || !Number.isSafeInteger(row.sessionGeneration) || row.sessionGeneration <= 0 || row.sessionGeneration > head.sessionGeneration || !Number.isSafeInteger(row.deletionWatermark) || row.deletionWatermark <= 0 || !targets.some((target) => target.attemptId === row.attemptId)) throw new PracticeWriteFenceError("Invalid attempt deletion lineage.");
      }
      return snapshot;
    }
    prepare() {
      if (this.prepared) return Promise.resolve(this.state);
      if (this.preparation) return this.preparation;
      const setting = ++this.settingOperation;
      this.preparation = this.enqueue(async () => {
        const db = await this.open();
        const control = await this.transact(db, ["control"], "readonly", (tx, guard, result) => {
          const read = tx.objectStore("control").get("recording");
          read.onsuccess = () => guard(() => result(controlValue(read.result)));
        });
        this.prepared = true;
        if (setting === this.settingOperation && !this.closed) {
          this.pageEnabled = control.recordingEnabled;
          this.status({ prepared: true, recordingEnabled: this.pageEnabled, durableRecordingEnabled: control.recordingEnabled, settingsState: "persisted", settingsError: null });
        } else this.status({ prepared: true });
        return this.state;
      }).then(() => this.state).catch((error) => {
        this.preparation = null;
        throw error;
      });
      return this.preparation;
    }
    beginRecordedSession(initialSnapshot) {
      let captured;
      const epoch = this.pageEpoch;
      try {
        captured = validatePracticeSnapshot(initialSnapshot);
        stableId(captured.sessionId);
        const previouslyUsed = this.usedIds.has(captured.sessionId);
        this.usedIds.add(captured.sessionId);
        if (!this.pageEnabled) this.blockedIds.add(captured.sessionId);
        this.assertPage(epoch, captured.sessionId, this.sessionEpochs.get(captured.sessionId) ?? 0);
        if (captured.sequence !== 1 || captured.events.length !== 1 || captured.events[0].payload.type !== "sessionStarted" || previouslyUsed) throw new PracticeWriteFenceError("A fresh sessionStarted-only snapshot with a never-used ID is required; off-period practice cannot be backfilled.");
      } catch (error) {
        return this.fail(error);
      }
      const sessionEpoch = this.sessionEpochs.get(captured.sessionId) ?? 0;
      return this.enqueue(async () => {
        this.assertPage(epoch, captured.sessionId, sessionEpoch);
        const db = await this.open();
        this.assertPage(epoch, captured.sessionId, sessionEpoch);
        const context = await this.transact(db, allStores, "readwrite", (tx, guard, result) => {
          this.boundary(tx, captured.sessionId, guard, (control, head, tombstone, events, attempts) => {
            this.assertPage(epoch, captured.sessionId, sessionEpoch);
            if (!control.recordingEnabled) throw new PracticeWriteFenceError("Durable recording is disabled.");
            if (head || tombstone || events.length || attempts.length) throw new PracticeWriteFenceError("Session ID already exists or was deleted; a new recorded session is required.");
            const context2 = { sessionId: captured.sessionId, pageEpoch: epoch, sessionEpoch, globalGeneration: control.globalGeneration, sessionGeneration: 0 };
            tx.objectStore("events").add(captured.events[0]);
            tx.objectStore("heads").add({ sessionId: captured.sessionId, schemaVersion: captured.schemaVersion, sequence: 1, eventCount: 1, globalGeneration: context2.globalGeneration, sessionGeneration: 0 });
            result(context2);
          });
        }, captured.sessionId);
        this.assertPage(epoch, captured.sessionId, sessionEpoch);
        const permit = Object.freeze({});
        this.permits.set(permit, context);
        this.status({ requiresNewRecordedSession: false });
        this.assertPage(epoch, captured.sessionId, sessionEpoch);
        return permit;
      });
    }
    save(snapshot, permit) {
      let captured, context;
      try {
        captured = validatePracticeSnapshot(snapshot);
        this.usedIds.add(captured.sessionId);
        if (!this.pageEnabled) this.blockedIds.add(captured.sessionId);
        const stored = permit && typeof permit === "object" ? this.permits.get(permit) : void 0;
        if (!stored || stored.sessionId !== captured.sessionId) throw new PracticeWriteFenceError("Unknown or wrong-session write permit.");
        context = stored;
        this.assertPage(context.pageEpoch, context.sessionId, context.sessionEpoch);
      } catch (error) {
        return this.fail(error);
      }
      return this.enqueue(async () => {
        this.assertPage(context.pageEpoch, context.sessionId, context.sessionEpoch);
        const db = await this.open();
        this.assertPage(context.pageEpoch, context.sessionId, context.sessionEpoch);
        const receipt = await this.transact(db, allStores, "readwrite", (tx, guard, result) => {
          this.boundary(tx, captured.sessionId, guard, (control, head, tombstone, events, attempts) => {
            this.assertPage(context.pageEpoch, context.sessionId, context.sessionEpoch);
            if (!control.recordingEnabled || control.globalGeneration !== context.globalGeneration || tombstone) throw new PracticeWriteFenceError("Durable recording or deletion generation revoked this permit.");
            this.assertHead(context.sessionId, head, events);
            if (head.globalGeneration !== context.globalGeneration || head.sessionGeneration !== context.sessionGeneration || head.schemaVersion !== captured.schemaVersion) throw new PracticeWriteFenceError("Session generation changed.");
            const durable = this.canonicalSnapshot(context.sessionId, head, events, attempts);
            if (canonicalJson(durable.projections.redaction?.targets ?? []) !== canonicalJson(captured.projections.redaction?.targets ?? [])) throw new PracticeWriteFenceError("Only deleteAttempt can change attempt deletion lineage.");
            for (let i = 0; i < Math.min(events.length, captured.events.length); i++) if (canonicalJson(events[i]) !== canonicalJson(captured.events[i])) throw new PracticeStorageConflict();
            if (events.length >= captured.events.length) {
              result({ sessionId: captured.sessionId, storedSequence: head.sequence, disposition: events.length === captured.events.length ? "already-present" : "newer-preserved" });
              return;
            }
            for (const event of captured.events.slice(events.length)) tx.objectStore("events").add(event);
            tx.objectStore("heads").put({ ...head, sequence: captured.sequence, eventCount: captured.events.length });
            result({ sessionId: captured.sessionId, storedSequence: captured.sequence, disposition: "appended" });
          });
        }, captured.sessionId);
        this.assertPage(context.pageEpoch, context.sessionId, context.sessionEpoch);
        return receipt;
      });
    }
    setRecordingEnabled(enabled) {
      if (typeof enabled !== "boolean") return this.fail(new Error("Recording preference must be boolean."));
      const setting = ++this.settingOperation;
      this.pageEnabled = false;
      this.pageEpoch++;
      this.abortWrites();
      return this.enqueue(async () => {
        try {
          if (!this.prepared) throw new PracticeWriteFenceError("Call prepare before changing recording preference.");
          const db = await this.open();
          const updated = await this.transact(db, ["control"], "readwrite", (tx, guard, result) => {
            const store = tx.objectStore("control"), read = store.get("recording");
            read.onsuccess = () => guard(() => {
              const before = controlValue(read.result);
              const after = { ...before, recordingEnabled: enabled, globalGeneration: next(before.globalGeneration) };
              store.put(after);
              result(after);
            });
          });
          if (setting === this.settingOperation && !this.closed) {
            this.pageEnabled = enabled;
            this.status({ recordingEnabled: enabled, durableRecordingEnabled: updated.recordingEnabled, settingsState: "persisted", settingsError: null });
          }
          return this.state;
        } catch (error) {
          if (setting === this.settingOperation) {
            this.pageEnabled = false;
            this.status({ recordingEnabled: false, settingsState: "not-persisted", settingsError: `Recording setting was not persisted; this page stays OFF. No other-tab or reload guarantee: ${message(error)}` });
          }
          throw error;
        }
      }, { recordingEnabled: false, requiresNewRecordedSession: true, settingsState: "pending", settingsError: null }).then(() => this.state);
    }
    deleteSession(sessionId) {
      try {
        stableId(sessionId);
      } catch (error) {
        return this.fail(error);
      }
      this.blockedIds.add(sessionId);
      this.sessionEpochs.set(sessionId, (this.sessionEpochs.get(sessionId) ?? 0) + 1);
      this.abortWrites(sessionId);
      this.invalidateExports(sessionId);
      return this.enqueue(async () => {
        const db = await this.open();
        return this.transact(db, allStores, "readwrite", (tx, guard, result) => {
          this.boundary(tx, sessionId, guard, (control, head, tombstone, events, attempts) => {
            const deletionWatermark = next(control.deletionWatermark), sessionGeneration = next(tombstone?.sessionGeneration ?? head?.sessionGeneration ?? 0);
            tx.objectStore("control").put({ ...control, deletionWatermark });
            for (const event of events) tx.objectStore("events").delete([sessionId, event.sequence]);
            for (const attempt of attempts) tx.objectStore("attemptTombstones").delete([sessionId, attempt.attemptId]);
            tx.objectStore("heads").delete(sessionId);
            tx.objectStore("tombstones").put({ sessionId, sessionGeneration, deletionWatermark });
            result({ sessionId, deleted: true, sessionGeneration, deletionWatermark });
          });
        });
      }, { requiresNewRecordedSession: true });
    }
    /** Captured live facts may extend the durable prefix only under the permit
     * that was valid immediately BEFORE this synchronous deletion fence. */
    deleteAttempt(options) {
      let sessionId, attemptId, redactionId;
      try {
        ({ sessionId, attemptId, redactionId } = options);
        stableId(sessionId);
        stableId(attemptId);
        stableId(redactionId);
      } catch (error) {
        return this.fail(error);
      }
      const pageEpoch = this.pageEpoch, oldSessionEpoch = this.sessionEpochs.get(sessionId) ?? 0;
      const previous = options.permit && typeof options.permit === "object" ? this.permits.get(options.permit) : void 0;
      const context = previous ? { ...previous } : void 0;
      const wasWritable = this.prepared && this.pageEnabled && !this.closed && !this.blockedIds.has(sessionId);
      const sessionEpoch = oldSessionEpoch + 1;
      this.sessionEpochs.set(sessionId, sessionEpoch);
      this.abortWrites(sessionId);
      this.invalidateExports(sessionId);
      const historyEpoch = this.exportEpoch, historySessionEpoch = this.sessionExportEpochs.get(sessionId) ?? 0;
      let live;
      try {
        this.assertOpen();
        if (options.liveSnapshot !== void 0) {
          live = validatePracticeSnapshot(options.liveSnapshot);
          if (live.sessionId !== sessionId) throw new PracticeWriteFenceError("Live snapshot belongs to another session.");
        }
      } catch (error) {
        return this.fail(error);
      }
      return this.enqueue(async () => {
        const db = await this.open();
        const committed = await this.transact(db, allStores, "readwrite", (tx, guard, result) => {
          this.boundary(tx, sessionId, guard, (control, head, tombstone, events, attempts) => {
            this.assertOpen();
            if (tombstone) throw new PracticeWriteFenceError("Deleted parent session cannot be recreated.");
            this.assertHead(sessionId, head, events);
            let snapshot = this.canonicalSnapshot(sessionId, head, events, attempts);
            const permitContext = { sessionId, pageEpoch, sessionEpoch, globalGeneration: control.globalGeneration, sessionGeneration: head.sessionGeneration };
            const renewAllowed = wasWritable && context !== void 0 && context.sessionId === sessionId && context.pageEpoch === pageEpoch && context.sessionEpoch === oldSessionEpoch && context.globalGeneration === control.globalGeneration && context.sessionGeneration === head.sessionGeneration && head.globalGeneration === context.globalGeneration && control.recordingEnabled;
            if (attempts.some((row) => row.attemptId === attemptId)) {
              result({ snapshot, context: permitContext, deletionWatermark: control.deletionWatermark, renewAllowed });
              return;
            }
            if (live) {
              for (let i = 0; i < Math.min(events.length, live.events.length); i++) if (canonicalJson(events[i]) !== canonicalJson(live.events[i])) throw new PracticeStorageConflict();
              if (live.events.length > events.length) {
                this.assertPage(pageEpoch, sessionId, sessionEpoch);
                if (!renewAllowed) throw new PracticeWriteFenceError("The captured live tail has no current recorded-session permit.");
                if (canonicalJson(snapshot.projections.redaction?.targets ?? []) !== canonicalJson(live.projections.redaction?.targets ?? [])) throw new PracticeWriteFenceError("Captured live facts cannot introduce attempt deletion lineage.");
                const active2 = { tx, sessionId };
                this.activeWrites.add(active2);
                const cleanup = () => this.activeWrites.delete(active2);
                tx.addEventListener("complete", cleanup, { once: true });
                tx.addEventListener("abort", cleanup, { once: true });
                snapshot = live;
              }
            }
            const occupied = new Set(snapshot.events.map((event) => event.eventId));
            const eventId = () => {
              let id2;
              do {
                id2 = `redaction-${globalThis.crypto?.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`}`;
              } while (occupied.has(id2));
              occupied.add(id2);
              return id2;
            };
            const redacted = redactPracticeAttempt(snapshot, { attemptId, redactionId, eventId });
            const sessionGeneration = next(head.sessionGeneration), deletionWatermark = next(control.deletionWatermark);
            const nextHead = { sessionId, schemaVersion: redacted.schemaVersion, sequence: redacted.sequence, eventCount: redacted.events.length, globalGeneration: control.globalGeneration, sessionGeneration };
            for (const event of events) tx.objectStore("events").delete([sessionId, event.sequence]);
            for (const event of redacted.events) tx.objectStore("events").add(event);
            tx.objectStore("heads").put(nextHead);
            tx.objectStore("attemptTombstones").put({ sessionId, attemptId, sessionGeneration, deletionWatermark });
            tx.objectStore("control").put({ ...control, deletionWatermark });
            result({ snapshot: redacted, context: { ...permitContext, sessionGeneration }, deletionWatermark, renewAllowed });
          });
        });
        const renewal = await this.renewAfterDeletion(db, committed.context, committed.renewAllowed);
        return { sessionId, attemptId, deleted: true, sessionGeneration: committed.context.sessionGeneration, deletionWatermark: committed.deletionWatermark, snapshot: renewal.superseded ? null : committed.snapshot, permit: renewal.permit, superseded: renewal.superseded };
      }, { requiresNewRecordedSession: true }).then((receipt) => {
        if (!this.historyCurrent(sessionId, historyEpoch, historySessionEpoch)) return { ...receipt, snapshot: null, permit: null, superseded: true };
        return receipt;
      });
    }
    async renewAfterDeletion(db, context, renewAllowed) {
      let current2 = false;
      try {
        this.assertOpen();
        const checked = await this.transact(db, ["control", "heads", "tombstones"], "readonly", (tx, guard, result) => {
          const control = tx.objectStore("control").get("recording"), head = tx.objectStore("heads").get(context.sessionId), tombstone = tx.objectStore("tombstones").get(context.sessionId);
          let pending = 3;
          const ready = () => guard(() => {
            if (--pending) return;
            const durable = controlValue(control.result), stored = head.result;
            const unchanged = !tombstone.result && stored?.sessionGeneration === context.sessionGeneration;
            result({ current: unchanged, eligible: renewAllowed && unchanged && durable.recordingEnabled && durable.globalGeneration === context.globalGeneration && stored?.globalGeneration === context.globalGeneration });
          });
          control.onsuccess = head.onsuccess = tombstone.onsuccess = ready;
        });
        current2 = checked.current;
        if (!current2) return { permit: null, superseded: true };
        this.assertPage(context.pageEpoch, context.sessionId, context.sessionEpoch);
        if (!checked.eligible) return { permit: null, superseded: false };
        const permit = Object.freeze({});
        this.permits.set(permit, context);
        this.status({ requiresNewRecordedSession: false });
        this.assertPage(context.pageEpoch, context.sessionId, context.sessionEpoch);
        return { permit, superseded: false };
      } catch {
        return { permit: null, superseded: !current2 };
      }
    }
    clearPracticeData() {
      this.pageEpoch++;
      this.abortWrites();
      this.invalidateExports();
      return this.enqueue(async () => {
        const db = await this.open();
        return this.transact(db, allStores, "readwrite", (tx, guard, result) => {
          const control = tx.objectStore("control").get("recording"), heads = tx.objectStore("heads").getAll(), tombstones = tx.objectStore("tombstones").getAll(), eventKeys = tx.objectStore("events").getAllKeys(), attemptKeys = tx.objectStore("attemptTombstones").getAllKeys();
          let count = 5;
          const ready = () => guard(() => {
            if (--count) return;
            const before = controlValue(control.result), globalGeneration = next(before.globalGeneration), deletionWatermark = next(before.deletionWatermark), clearWatermark = next(before.clearWatermark);
            const prior = new Map(tombstones.result.map((row) => [row.sessionId, row]));
            const generations = new Map(heads.result.map((head) => [head.sessionId, head.sessionGeneration]));
            for (const key of [...eventKeys.result, ...attemptKeys.result]) {
              if (!Array.isArray(key) || typeof key[0] !== "string") throw new Error("Unexpected practice fact key.");
              if (!generations.has(key[0])) generations.set(key[0], 0);
            }
            for (const [sessionId, generation] of generations) tx.objectStore("tombstones").put({ sessionId, sessionGeneration: next(Math.max(generation, prior.get(sessionId)?.sessionGeneration ?? 0)), deletionWatermark });
            tx.objectStore("events").clear();
            tx.objectStore("heads").clear();
            tx.objectStore("attemptTombstones").clear();
            tx.objectStore("control").put({ ...before, globalGeneration, deletionWatermark, clearWatermark });
            result({ cleared: true, globalGeneration, clearWatermark });
          });
          control.onsuccess = heads.onsuccess = tombstones.onsuccess = eventKeys.onsuccess = attemptKeys.onsuccess = ready;
        });
      }, { requiresNewRecordedSession: true });
    }
    async load(sessionId) {
      const epoch = this.exportEpoch, sessionEpoch = this.sessionExportEpochs.get(sessionId) ?? 0;
      const check4 = () => {
        this.assertOpen();
        if (!this.historyCurrent(sessionId, epoch, sessionEpoch)) throw new PracticeWriteFenceError("History read was invalidated by deletion, clear, or close.");
      };
      try {
        stableId(sessionId);
        check4();
        await this.tail;
        check4();
        const db = await this.open();
        check4();
        const snapshot = await this.transact(db, allStores, "readonly", (tx, guard, result) => {
          this.boundary(tx, sessionId, guard, (_control, head, tombstone, events, attempts) => {
            if (tombstone) {
              if (head || events.length || attempts.length) throw new Error("Deleted session still contains facts.");
              result(null);
              return;
            }
            if (!head && !events.length && !attempts.length) {
              result(null);
              return;
            }
            result(this.canonicalSnapshot(sessionId, head, events, attempts));
          });
        });
        check4();
        this.status({ readError: null, lastLoadedSequence: snapshot?.sequence ?? null });
        check4();
        return snapshot;
      } catch (error) {
        this.status({ readError: message(error) });
        throw error;
      }
    }
    historyCurrent(sessionId, epoch, sessionEpoch) {
      return !this.closed && epoch === this.exportEpoch && sessionEpoch === (this.sessionExportEpochs.get(sessionId) ?? 0);
    }
    assertExport(context) {
      this.assertOpen();
      if (!context.valid || !this.historyCurrent(context.sessionId, context.epoch, context.sessionEpoch)) throw new PracticeWriteFenceError("Prepared history export was invalidated by deletion, clear, or close.");
    }
    exportCheck(tx, context, guard, ready) {
      const control = tx.objectStore("control").get("recording"), head = tx.objectStore("heads").get(context.sessionId), tombstone = tx.objectStore("tombstones").get(context.sessionId);
      let pending = 3;
      const checked = () => guard(() => {
        if (--pending) return;
        this.assertExport(context);
        const current2 = controlValue(control.result), boundary = context.boundary;
        if (!boundary || tombstone.result || !head.result || current2.globalGeneration !== boundary.globalGeneration || current2.deletionWatermark !== boundary.deletionWatermark || current2.clearWatermark !== boundary.clearWatermark || canonicalJson(head.result) !== canonicalJson(boundary.head)) throw new PracticeWriteFenceError("Durable history changed after export preparation.");
        ready();
      });
      control.onsuccess = head.onsuccess = tombstone.onsuccess = checked;
    }
    /** Prepare from current repository facts, never from a caller-owned snapshot.
     * Formatting is outside the queue so deletion can proceed while it is pending. */
    async prepareHistoryExport(sessionId, exportedAt) {
      this.assertOpen();
      stableId(sessionId);
      if (typeof exportedAt !== "string" || !Number.isFinite(Date.parse(exportedAt))) throw new Error("An explicit valid export timestamp is required.");
      const context = { sessionId, epoch: this.exportEpoch, sessionEpoch: this.sessionExportEpochs.get(sessionId) ?? 0, valid: true, boundary: null, payload: null };
      this.activeExports.add(context);
      let snapshot = null, payload = null;
      try {
        await this.tail;
        this.assertExport(context);
        const db = await this.open();
        this.assertExport(context);
        snapshot = await this.transact(db, allStores, "readonly", (tx, guard, result) => {
          this.boundary(tx, sessionId, guard, (control, head, tombstone, events, attempts) => {
            this.assertExport(context);
            if (tombstone) throw new PracticeWriteFenceError("Deleted history cannot be exported.");
            const canonical = this.canonicalSnapshot(sessionId, head, events, attempts);
            context.boundary = { globalGeneration: control.globalGeneration, deletionWatermark: control.deletionWatermark, clearWatermark: control.clearWatermark, head: { ...head } };
            result(canonical);
          });
        });
        this.assertExport(context);
        const formatting = this.exportFormatter(snapshot, exportedAt);
        snapshot = null;
        payload = await formatting;
        this.assertExport(context);
        const json = payload?.json, csv = payload?.csv;
        payload = null;
        this.assertExport(context);
        if (typeof json !== "string" || typeof csv !== "string") throw new Error("History formatter must return JSON and CSV strings.");
        await this.transact(db, allStores, "readonly", (tx, guard, result) => this.exportCheck(tx, context, guard, () => result(void 0)));
        this.assertExport(context);
        context.payload = Object.freeze({ json, csv });
        const handle = Object.freeze({});
        this.exportHandles.set(handle, context);
        return handle;
      } catch (error) {
        context.valid = false;
        context.payload = null;
        context.boundary = null;
        this.activeExports.delete(context);
        throw error;
      } finally {
        snapshot = null;
        payload = null;
      }
    }
    /** The sink MUST synchronously consume/copy JSON and CSV. The final check and
     * handoff share one readonly transaction, locking out foreign deletion commits.
     * Already handed-off bytes/external downloads cannot subsequently be revoked. */
    async deliverHistoryExport(handle, synchronousSink) {
      const context = handle && typeof handle === "object" ? this.exportHandles.get(handle) : void 0;
      if (!context) throw new PracticeWriteFenceError("Unknown, foreign, or already-used history export handle.");
      this.exportHandles.delete(handle);
      try {
        this.assertExport(context);
        if (typeof synchronousSink !== "function" || Object.prototype.toString.call(synchronousSink) === "[object AsyncFunction]") throw new PracticeWriteFenceError("History export requires a synchronous sink; async sinks are not supported.");
        const db = await this.open();
        this.assertExport(context);
        await this.transact(db, allStores, "readonly", (tx, guard, result) => {
          this.exportCheck(tx, context, guard, () => {
            const payload = context.payload;
            if (!payload) throw new PracticeWriteFenceError("History export payload is no longer available.");
            context.payload = null;
            context.valid = false;
            this.activeExports.delete(context);
            const returned = synchronousSink(payload);
            if (returned !== null && (typeof returned === "object" || typeof returned === "function") && typeof returned.then === "function") {
              void Promise.resolve(returned).catch(() => {
              });
              throw new PracticeWriteFenceError("History export sink returned a Promise; it must complete synchronously.");
            }
            result(void 0);
          });
        });
      } finally {
        context.valid = false;
        context.payload = null;
        context.boundary = null;
        this.activeExports.delete(context);
      }
    }
    async close() {
      this.closed = true;
      this.pageEnabled = false;
      this.pageEpoch++;
      this.abortWrites();
      this.invalidateExports();
      this.status({ recordingEnabled: false, requiresNewRecordedSession: true });
      await this.tail;
      if (this.database) {
        try {
          (await this.database).close();
        } finally {
          this.database = null;
        }
      }
    }
  };

  // scripts/data-batch2a-browser.ts
  function check2(condition, message2) {
    if (!condition) throw new Error(`Data fence QA failed: ${message2}`);
  }
  async function rejected(work) {
    try {
      await work;
      return false;
    } catch {
      return true;
    }
  }
  function fixture(sessionId) {
    let id2 = 0;
    const engine = new PracticeEngine({ sessionId, catalog: [ORIGINAL_PRACTICE_MATERIAL], clock: { now: () => 0, wallTime: () => "2026-10-08T09:00:00.000Z", id: () => `${sessionId}-event-${++id2}` } });
    return { engine, start: () => {
      engine.startRound({ materialId: ORIGINAL_PRACTICE_MATERIAL.materialId });
      engine.startAttempt({ unitId: ORIGINAL_PRACTICE_MATERIAL.units[0].unitId, mode: "dictation" });
    } };
  }
  async function digest2(snapshot) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(snapshot)));
    return [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  async function raw(databaseName) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const stores = ["events", "heads", "tombstones", "control"], rows = {}, tx = db.transaction(stores, "readonly");
        for (const name of stores) {
          const request = tx.objectStore(name).getAll();
          request.onsuccess = () => {
            rows[name] = request.result;
          };
        }
        tx.oncomplete = () => resolve(rows);
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }
  async function runPracticeDataBatchTwoAQA() {
    check2(!!globalThis.indexedDB && !!globalThis.IDBObjectStore, "IndexedDB required");
    const databaseName = `lingotrace-dev-fenced-browser-${crypto.randomUUID()}`, repository = new FencedPracticeRepository({ databaseName, initialRecordingEnabled: true });
    const peer = new FencedPracticeRepository({ databaseName });
    let requestAbortChecked = false, settingsFailureChecked = false;
    const originalAdd = IDBObjectStore.prototype.add, originalPut = IDBObjectStore.prototype.put;
    try {
      await repository.prepare();
      await peer.prepare();
      const first = fixture("first-recorded-session");
      const permit = await repository.beginRecordedSession(first.engine.getSnapshot());
      first.start();
      first.engine.input("Could I have coffee, please?");
      first.engine.submit();
      await repository.save(first.engine.getSnapshot(), permit);
      const saved = first.engine.getSnapshot();
      const off = repository.setRecordingEnabled(false);
      check2(!repository.getStatus().recordingEnabled, "OFF acts synchronously");
      first.engine.input("QA PRIVATE OFF-PERIOD ANSWER");
      const temporary = first.engine.getSnapshot();
      check2(await rejected(repository.save(temporary, permit)), "OFF rejects late autosave");
      await off;
      check2(canonicalJson(await repository.load(saved.sessionId)) === canonicalJson(saved), "OFF preserves prior history");
      await repository.setRecordingEnabled(true);
      check2(repository.getStatus().requiresNewRecordedSession, "ON requires an explicit new recording boundary");
      check2(canonicalJson(first.engine.getSnapshot()) === canonicalJson(temporary), "ON does not mutate practice");
      check2(await rejected(repository.save(temporary, permit)) && await rejected(repository.beginRecordedSession(temporary)), "ON never re-admits practiced off-period content");
      const active2 = fixture("transaction-abort-session");
      const activePermit = await repository.beginRecordedSession(active2.engine.getSnapshot());
      active2.start();
      await repository.save(active2.engine.getSnapshot(), activePermit);
      const before = active2.engine.getSnapshot();
      active2.engine.input("QA ABORT THIS PENDING FACT");
      let triggered = false, lateOff;
      IDBObjectStore.prototype.add = function(...args) {
        const request = originalAdd.apply(this, args);
        if (this.name === "events" && !triggered) {
          triggered = true;
          request.addEventListener("success", () => {
            lateOff = repository.setRecordingEnabled(false);
            void lateOff.catch(() => {
            });
          });
        }
        return request;
      };
      check2(await rejected(repository.save(active2.engine.getSnapshot(), activePermit)), "OFF during request success aborts facts transaction");
      await lateOff;
      IDBObjectStore.prototype.add = originalAdd;
      check2(triggered && canonicalJson(await repository.load(before.sessionId)) === canonicalJson(before), "request success was not mistaken for commit");
      requestAbortChecked = true;
      await repository.setRecordingEnabled(true);
      IDBObjectStore.prototype.put = function(...args) {
        if (this.name === "control") throw new DOMException("QA injected setting failure", "QuotaExceededError");
        return originalPut.apply(this, args);
      };
      const failedOff = repository.setRecordingEnabled(false);
      check2(!repository.getStatus().recordingEnabled, "failed preference still immediately fences page");
      check2(await rejected(failedOff), "injected setting failure reported");
      IDBObjectStore.prototype.put = originalPut;
      const status = repository.getStatus();
      check2(status.settingsState === "not-persisted" && !status.recordingEnabled && status.durableRecordingEnabled === true, "setting status distinguishes page OFF from unpersisted preference");
      check2((status.settingsError ?? "").includes("No other-tab or reload guarantee"), "no false cross-page privacy promise");
      settingsFailureChecked = true;
      await repository.setRecordingEnabled(true);
      const remote = fixture("cross-instance-session");
      const remotePermit = await repository.beginRecordedSession(remote.engine.getSnapshot());
      remote.start();
      remote.engine.input("cross-instance saved draft");
      await repository.save(remote.engine.getSnapshot(), remotePermit);
      await peer.setRecordingEnabled(false);
      await peer.setRecordingEnabled(true);
      remote.engine.input("stale generation callback");
      check2(await rejected(repository.save(remote.engine.getSnapshot(), remotePermit)), "remote OFF/ON revokes old generation");
      await peer.deleteSession(saved.sessionId);
      check2(await repository.load(saved.sessionId) === null, "session deletion reads null");
      check2(await rejected(repository.save(saved, permit)), "deleted old snapshot cannot return");
      let stores = await raw(databaseName);
      check2(!JSON.stringify(stores).includes("QA PRIVATE OFF-PERIOD ANSWER"), "off-period input never persisted");
      check2(!JSON.stringify(stores).includes("QA ABORT THIS PENDING FACT"), "aborted transaction left no answer");
      await peer.clearPracticeData();
      stores = await raw(databaseName);
      check2(stores.events.length === 0 && stores.heads.length === 0 && stores.tombstones.length === 3, "clear removes facts and retains answer-free IDs");
      check2(stores.tombstones.every((row) => Object.keys(row).sort().join(",") === "deletionWatermark,sessionGeneration,sessionId"), "minimal deletion lineage only");
      check2(await rejected(peer.beginRecordedSession(fixture(saved.sessionId).engine.getSnapshot())), "clear cannot re-admit deleted IDs");
      for (const latest of [false, true]) {
        let entered = false, nested;
        const unsubscribe = peer.subscribe(() => {
          if (!entered && peer.getStatus().settingsState === "pending") {
            entered = true;
            nested = peer.setRecordingEnabled(latest);
            void nested.catch(() => {
            });
          }
        });
        await peer.setRecordingEnabled(!latest);
        await nested;
        unsubscribe();
        const verify = new FencedPracticeRepository({ databaseName });
        await verify.prepare();
        check2(entered && peer.getStatus().recordingEnabled === latest && verify.getStatus().recordingEnabled === latest, "reentrant latest preference matches actual durable state");
        await verify.close();
      }
      const final = fixture("reload-surviving-session");
      const finalPermit = await peer.beginRecordedSession(final.engine.getSnapshot());
      final.start();
      final.engine.input("Could I have a coffee, please?");
      final.engine.submit();
      const snapshot = final.engine.getSnapshot();
      await peer.save(snapshot, finalPermit);
      const exported = exportPracticeSnapshot(snapshot, "2026-10-08T09:00:00.000Z");
      check2(canonicalJson(JSON.parse(exported.json).snapshot) === canonicalJson(snapshot), "export has exact committed snapshot");
      await repository.close();
      await peer.close();
      return { passed: true, databaseName, sessionId: snapshot.sessionId, snapshotSHA256: await digest2(snapshot), eventCount: snapshot.events.length, deletedSessionIds: [saved.sessionId, active2.engine.getSnapshot().sessionId, remote.engine.getSnapshot().sessionId], requestAbortChecked, settingsFailureChecked, reentrantSettingsChecked: true, browser: typeof navigator === "undefined" ? "unavailable" : navigator.userAgent, executionEnvironment: typeof window === "undefined" ? "non-browser-harness" : "browser", boundary: "Whole-session fences only in random development databases. Quota and transaction faults are injected. No product UI, native typing, real capacity failure, capture, per-attempt deletion or production integration is implied." };
    } finally {
      IDBObjectStore.prototype.add = originalAdd;
      IDBObjectStore.prototype.put = originalPut;
      await repository.close();
      await peer.close();
    }
  }
  async function verifyPracticeFencesReload(expected) {
    const repository = new FencedPracticeRepository({ databaseName: expected.databaseName });
    try {
      await repository.prepare();
      const snapshot = await repository.load(expected.sessionId);
      check2(snapshot, "explicit final recorded session survived reload");
      const actual = await digest2(snapshot);
      check2(actual === expected.snapshotSHA256, "exact snapshot digest after reload");
      for (const id2 of expected.deletedSessionIds) {
        check2(await repository.load(id2) === null, "deleted session remains absent after reload");
        check2(await rejected(repository.beginRecordedSession(fixture(id2).engine.getSnapshot())), "durable tombstone prevents old ID reuse after reload");
      }
      return { passed: true, sessionId: snapshot.sessionId, snapshotSHA256: actual, deletedSessionCount: expected.deletedSessionIds.length };
    } finally {
      await repository.close();
    }
  }

  // scripts/data-batch2b-browser.ts
  function check3(condition, message2) {
    if (!condition) throw new Error(`Attempt erasure QA failed: ${message2}`);
  }
  async function rejects(work) {
    try {
      await work;
      return false;
    } catch {
      return true;
    }
  }
  async function digest3(snapshot) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(snapshot)));
    return [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  function deferred() {
    let resolve;
    const promise = new Promise((yes) => {
      resolve = yes;
    });
    return { promise, resolve };
  }
  function exercise(sessionId) {
    let serial = 0, now = 0;
    const clock = { now: () => now, wallTime: () => new Date(Date.UTC(2026, 9, 8) + now).toISOString(), id: () => `${sessionId}-event-${++serial}` };
    return { engine: new PracticeEngine({ sessionId, catalog: [ORIGINAL_PRACTICE_MATERIAL], clock }), clock, tick: (ms) => {
      now += ms;
    } };
  }
  async function inspect(databaseName) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const names = Array.from(db.objectStoreNames), out = {}, tx = db.transaction(names, "readonly");
        for (const name of names) {
          const read = tx.objectStore(name).getAll();
          read.onsuccess = () => {
            out[name] = read.result;
          };
        }
        tx.oncomplete = () => resolve(out);
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }
  async function runPracticeDataBatchTwoBQA() {
    check3(!!globalThis.indexedDB && !!globalThis.IDBObjectStore, "native IndexedDB required");
    const databaseName = `lingotrace-dev-fenced-redaction-${crypto.randomUUID()}`, repository = new FencedPracticeRepository({ databaseName, initialRecordingEnabled: true });
    const originalPut = IDBObjectStore.prototype.put;
    let peer;
    try {
      await repository.prepare();
      const { engine, clock, tick } = exercise("redaction-browser-session"), permit = await repository.beginRecordedSession(engine.getSnapshot());
      engine.startRound({ materialId: ORIGINAL_PRACTICE_MATERIAL.materialId, practiceRoundId: "r1" });
      engine.startAttempt({ unitId: "cafe-order", mode: "dictation", attemptId: "a1" });
      engine.exposeReference("hint");
      engine.input("REMOVE_PRIVATE_A1_BROWSER_CANARY", "paste");
      tick(12007);
      engine.submit();
      engine.exposeReference("correction");
      engine.retryAttempt();
      const a2 = engine.getSnapshot().projections.currentAttemptId;
      engine.input("Could I have a coffee, please?");
      tick(5e3);
      engine.submit();
      await repository.save(engine.getSnapshot(), permit);
      const durable = engine.getSnapshot(), beforeStores = await inspect(databaseName);
      peer = new FencedPracticeRepository({ databaseName });
      await peer.prepare();
      IDBObjectStore.prototype.put = function(...args) {
        if (this.name === "attemptTombstones") throw new DOMException("QA injected erasure transaction failure", "QuotaExceededError");
        return originalPut.apply(this, args);
      };
      check3(await rejects(peer.deleteAttempt({ sessionId: durable.sessionId, attemptId: "a1", redactionId: "failed-redaction" })), "injected delete transaction rejects");
      IDBObjectStore.prototype.put = originalPut;
      check3(canonicalJson(await inspect(databaseName)) === canonicalJson(beforeStores), "every store rolls back on deletion failure");
      await peer.close();
      peer = void 0;
      const staleHandle = await repository.prepareHistoryExport(durable.sessionId, "2026-10-08T10:00:00.000Z");
      const receipt = await repository.deleteAttempt({ sessionId: durable.sessionId, attemptId: "a1", redactionId: "successful-redaction", permit });
      check3(receipt.snapshot && receipt.permit && !receipt.superseded, "committed erasure returns current sanitized state and continuation permit");
      const sanitized = receipt.snapshot;
      check3(!Object.hasOwn(sanitized.projections.attempts, "a1"), "a1 absent from normal attempts");
      const survivor = sanitized.projections.attempts[a2];
      check3(survivor.activeMs === 5e3 && survivor.firstSubmission?.targetMet === true, "a2 keeps its own measured duration and word result");
      check3(canonicalJson(survivor.firstSubmission.exposureAtSubmission.map((item) => item.kind)) === canonicalJson(["hint", "correction"]), "assistance survives as redacted summaries");
      let called = false;
      check3(await rejects(repository.deliverHistoryExport(staleHandle, () => {
        called = true;
      })) && !called, "prepared deleted history cannot be handed off");
      check3(await rejects(repository.save(durable, permit)), "old save permit cannot resurrect a1");
      const raw2 = await inspect(databaseName);
      check3(!JSON.stringify(raw2).includes("REMOVE_PRIVATE_A1_BROWSER_CANARY"), "no persistent store contains the original answer");
      check3(raw2.attemptTombstones.length === 1, "minimal attempt deletion lineage exists");
      const continuation = new PracticeEngine({ snapshot: sanitized, clock });
      continuation.input("A2 browser draft retained after erasure");
      await repository.save(continuation.getSnapshot(), receipt.permit);
      const final = continuation.getSnapshot();
      const currentHandle = await repository.prepareHistoryExport(final.sessionId, "2026-10-08T10:00:00.000Z");
      let json = "", csv = "";
      await repository.deliverHistoryExport(currentHandle, (payload) => {
        json = payload.json;
        csv = payload.csv;
      });
      check3(canonicalJson(JSON.parse(json).snapshot) === canonicalJson(final) && !csv.includes("REMOVE_PRIVATE_A1_BROWSER_CANARY"), "authorized JSON/CSV contain only sanitized current history");
      check3(await rejects(repository.deliverHistoryExport(currentHandle, () => {
      })), "export handle is one-shot");
      const started = deferred(), finish = deferred();
      peer = new FencedPracticeRepository({ databaseName, exportFormatter: async (snapshot, at) => {
        started.resolve();
        await finish.promise;
        const value = exportPracticeSnapshot(snapshot, at);
        return { json: value.json, csv: value.csv };
      } });
      await peer.prepare();
      const temporary = exercise("async-export-fixture"), temporaryPermit = await repository.beginRecordedSession(temporary.engine.getSnapshot());
      temporary.engine.startRound({ materialId: ORIGINAL_PRACTICE_MATERIAL.materialId });
      temporary.engine.startAttempt({ unitId: "cafe-choice", mode: "dictation", attemptId: "temporary-attempt" });
      temporary.engine.input("ASYNC PRIVATE FIXTURE");
      await repository.save(temporary.engine.getSnapshot(), temporaryPermit);
      const pending = peer.prepareHistoryExport(temporary.engine.getSnapshot().sessionId, "2026-10-08T10:00:00.000Z"), lateFailure = rejects(pending);
      await started.promise;
      await repository.deleteSession(temporary.engine.getSnapshot().sessionId);
      finish.resolve();
      check3(await lateFailure, "remote deletion during async formatting rejects before publishing a handle");
      await peer.close();
      await repository.close();
      return { passed: true, databaseName, sessionId: final.sessionId, deletedAttemptId: "a1", survivingAttemptId: a2, snapshotSHA256: await digest3(final), eventCount: final.events.length, attemptCount: Object.keys(final.projections.attempts).length, rollbackChecked: true, asyncExportRevocationChecked: true, allStoresInspected: Object.keys(raw2), executionEnvironment: typeof window === "undefined" ? "non-browser-harness" : "browser", browser: typeof navigator === "undefined" ? "unavailable" : navigator.userAgent, boundary: "Original fixture commands and isolated IndexedDB only. Transaction failure is injected. No public UI, actual native typing, device collection, real disk failure, or independent external-copy erasure is implied." };
    } finally {
      IDBObjectStore.prototype.put = originalPut;
      await peer?.close();
      await repository.close();
    }
  }
  async function verifyPracticeRedactionReload(expected) {
    const repository = new FencedPracticeRepository({ databaseName: expected.databaseName });
    try {
      await repository.prepare();
      const snapshot = await repository.load(expected.sessionId);
      check3(snapshot, "sanitized session exists after actual page reload");
      check3(await digest3(snapshot) === expected.snapshotSHA256, "sanitized canonical snapshot digest survives reload");
      check3(!Object.hasOwn(snapshot.projections.attempts, expected.deletedAttemptId) && !!snapshot.projections.attempts[expected.survivingAttemptId], "deleted attempt stays absent and a2 remains");
      const all = await inspect(expected.databaseName);
      check3(!JSON.stringify(all).includes("REMOVE_PRIVATE_A1_BROWSER_CANARY"), "no restored store recovers erased answer");
      return { passed: true, sessionId: snapshot.sessionId, snapshotSHA256: expected.snapshotSHA256, attemptCount: Object.keys(snapshot.projections.attempts).length };
    } finally {
      await repository.close();
    }
  }
  return __toCommonJS(data_browser_entry_exports);
})();
