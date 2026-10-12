# Local practice data v1: canonical events and replay

Status: opt-in development data layer. The existing studio UI, its `TrainingEngine`, its database, media recorder, and existing grading algorithm are unchanged. This module installs no keyboard, DOM, timer, storage, or network listeners. It does not migrate legacy records or become the ordinary user's persistence path.

The first batch implements versioned materials, logical attempts, immutable first submissions and append-only revisions, unit exposure within explicit rounds, and practice/video pause separation. Assessment selection, credits/awards, review generation, deletion semantics, privacy gates, and production wiring belong to a later batch. There are no placeholder implementations for those features.

## One fact stream

`studio/core/practice.ts` exports:

- `PRACTICE_SCHEMA_VERSION = 'lingotrace-practice-v1'`
- `PracticeEvent`, `PracticeEventPayload`, `PracticeSnapshot`, and their projection types
- `PracticeEngine({ clock?, sessionId?, catalog?, snapshot? })`
- `replayPracticeEvents(events): PracticeSnapshot`
- `validatePracticeSnapshot(snapshot): PracticeSnapshot`
- `ORIGINAL_PRACTICE_MATERIAL`, an explicit developer fixture with three original units in an 18-second logical material

An engine created without a catalog contains no materials or attempts. The fixture is installed only when explicitly passed. Its text and time ranges do not claim that an audio or video recording exists.

The event stream is the sole source of truth. Projections are disposable, immutable read models reconstructed from that stream. There is no second submission, exposure, draft, time, or result fact log. Input text appears in `inputCommitted`; `submissionCommitted` refers to the current committed draft version rather than duplicating its answer. The first answer, later answers, source flags, alignment, and exposure conditions are reconstructed from prior events.

```ts
interface PracticeSnapshot {
  schemaVersion: 'lingotrace-practice-v1';
  sessionId: string;
  sequence: number;
  events: readonly PracticeEvent[];
  projections: PracticeProjections;
}

interface PracticeEvent {
  schemaVersion: 'lingotrace-practice-v1';
  eventId: string;
  sequence: number; // one-based, contiguous after exact duplicate removal
  sessionId: string;
  occurredAt: string; // ISO UTC timestamp of the observed action
  recordedAt: string; // ISO UTC timestamp of recording that action
  payload: PracticeEventPayload;
}
```

Engine-generated local events set both timestamps to the injected wall clock. Replay uses sequence for ordering and explicit `timeAdvanced` deltas for duration. Wall-clock subtraction is never used to invent practice time. A timestamp alone does not prove attention, exposure, or media playback.

Example event JSON:

```json
{
  "schemaVersion": "lingotrace-practice-v1",
  "eventId": "event-5",
  "sequence": 5,
  "sessionId": "session-1",
  "occurredAt": "2026-10-08T08:00:00.000Z",
  "recordedAt": "2026-10-08T08:00:00.000Z",
  "payload": {
    "type": "inputCommitted",
    "attemptId": "attempt-1",
    "text": "Could I have a coffee, please?",
    "source": "typed"
  }
}
```

Runtime validation rejects missing/extra event fields, unknown schemas/payloads, non-JSON values, invalid IDs, malformed timestamps, invalid transitions, sequence gaps, and references to the wrong session/round/current attempt. Stable IDs are 1–200 ASCII letters/digits/dot/underscore/colon/hyphen, starting with a letter or digit; `__proto__`, `constructor`, and `prototype` are rejected. Ordinary names such as `toString`, `valueOf`, and `hasOwnProperty` remain valid IDs: all round/attempt/exposure dictionary reads use own-property checks, including after JSON restore, so inherited methods can never be mistaken for stored facts.

Repeating the exact same event ID and content is idempotent, independent of object-key order. Reusing an ID with changed content is a conflict. `replayPracticeEvents` canonicalizes exact duplicate deliveries. Persisted snapshots must contain the canonical deduplicated history. `validatePracticeSnapshot` fully replays imported snapshots and rejects mismatched projections or envelope metadata, then returns the canonical deeply frozen snapshot. Internally proven immutable snapshots can be validated in constant time.

## Material and immutable reference identity

```ts
interface PracticeMaterial {
  materialId: string;
  title: string;
  rights: string;
  durationSeconds: number | null;
  units: readonly {
    unitId: string;
    references: readonly {
      referenceVersion: string;
      text: string;
      startSeconds: number;
      endSeconds: number;
    }[];
  }[];
}
```

A reference identity is `(materialId, unitId, referenceVersion)`. Its text and time range are immutable. Registering identical versions is harmless; reusing an identity with changed text or timing rejects the command. To edit a reference, register a new version. Material title, rights, and duration are stable for the material ID in this contract. Use another material identity if those intrinsic facts change.

All ranges require finite `0 <= startSeconds < endSeconds`. A known duration must be positive and finite, and every end must be within it. Unknown duration is explicitly `null`; the range remains unverified against duration. No decoder or media duration probe runs here.

A new attempt selects the explicitly requested reference version, or the most recently registered version for that unit. The attempt freezes `materialId`, `unitId`, `referenceVersion`, text, start/end seconds, `materialDurationSeconds`, and `rangeVerification: 'verified' | 'duration-unknown'`. Registering later versions cannot retarget an existing attempt. Retry and mode-switch commands preserve the linked attempt's reference version. A new round can select a newer version.

## Rounds, attempts, drafts, and first answers

The session may contain multiple rounds. A round begins explicitly, including any preparation, correction, or shadowing before an attempt. It must be explicitly ended before a new round is created. Refresh restores the current open round and its exposure; it never silently resets either.

`projections.rounds` is keyed by `practiceRoundId`. Each round retains its material, start/end timestamps, active time, attempt IDs, and `unitExposure` keyed by unit ID. A new round starts empty local exposure while prior rounds stay in the event history.

`projections.attempts` is keyed by `attemptId`. Each logical attempt has:

- One fixed mode: `dictation` or `recording-comparison`
- One frozen reference snapshot
- `relation: null | { kind: 'retry' | 'mode-switch', attemptId }`
- Its current `draft`, immutable `firstSubmission`, and append-only `revisions`
- Separate practice/evaluation/target states and observed active time

The draft has `text`, `version`, latest `source`, distinct cumulative `sources`, a sticky `pasted` flag, and cumulative `addedTypedGraphemes`. `typed`, `paste`, and committed `ime` are the only input sources. Grapheme increments reuse `addedGraphemes` from `training.ts`; paste and deletion add no typed effort. The caller commits final IME text exactly once and owns any composition buffer. Identical committed text is a no-op.

This new protocol requires `Intl.Segmenter`. Construction, replay, and snapshot validation explicitly reject unsupported runtimes before using the legacy code-point fallback; live input also rejects if support disappears. A recorded `👩‍💻` grapheme must not become three counted code points during restore. The old `training.ts` fallback is unchanged for legacy consumers. This gate does not claim complete compatibility across different Unicode/ICU versions; supported runtime versions must still be qualified before production rollout.

Typing and submitting X creates `firstSubmission.answer === 'X'`. Editing and submitting Y keeps the same logical attempt and records `revisions[0].answer === 'Y'`; the first answer never changes. Repeated submission of the identical draft version returns the existing submission without another event. A retry or mode switch creates a linked new attempt with an empty draft. Starting an unrelated second attempt for an already attempted unit in the same round is rejected.

A submission contains its event/sequence/time identity; frozen answer and draft version; input source history; paste flag; cumulative unit exposure at submission; active time; and any supported local alignment. All snapshots and returned entities are deeply immutable.

## Unit exposure and its first-submission boundary

Exposure kinds are `hint`, `reveal`, `reference`, `translation`, `correction`, and `shadowing`. A caller records an exposure only when it actually happened. Selecting a mode alone does not fabricate an exposure.

`exposeUnitReference(unitId, kind)` records preparation exposure without requiring an attempt. Its payload and projected occurrence use `attemptId: null`. `exposeReference(kind)` records exposure against the current attempt and its unit. Both append the same `referenceExposed` fact shape:

```json
{
  "type": "referenceExposed",
  "unitId": "cafe-order",
  "attemptId": null,
  "kind": "correction"
}
```

Within each round/unit, `unitExposure` preserves:

- `firstSubmissionSequence`: the first actual submission for that unit, or `null`
- `beforeFirstSubmission`: observed exposures before that boundary
- `afterFirstSubmission`: observed exposures after that boundary

Each occurrence includes event ID, sequence, observed timestamp, unit ID, optional attempt ID, and kind. A submission's `exposureAtSubmission` includes all previously observed exposures for its unit in the round, including preparation and earlier attempts/modes. Future exposure cannot change old submissions. A retry's first submission can therefore include exposure that happened after an earlier attempt's first submission. The per-round unit boundary and each immutable submission's capture answer those two different questions explicitly.

## Completion and evaluation are separate

`practiceComplete` records that an actual supported submission occurred in this logical attempt. Once true, editing its draft does not revoke that historical fact.

`evaluationComplete` and `targetMet` on the attempt describe its current draft. Editing resets them to `false` and `null` until the new draft is submitted. Immutable older submissions keep their own evaluation and target states.

For dictation, the existing `tokens`/`align` implementation and `RULE_VERSION` are reused unchanged. Practice v1 is explicitly bound to `word-alignment-v3`; if the imported rule version changes, replay/submission rejects rather than silently regrading old history. An intentional grading upgrade requires a new compatible schema/rule path. A supported submitted text can be practice-complete and evaluated while `targetMet` is false. Exact normalized word correctness with zero extra words produces `targetMet: true`; this is an observed local word-alignment result, not proficiency, an AI assessment, or an award. A reference with no scorable English tokens can have an actual submission with `practiceComplete: true`, `evaluationComplete: false`, `targetMet: null`, and no alignment result.

Recording comparison supports an in-progress attempt and a committed text note, but this batch has no recording-evidence submission contract. `submit()` rejects for that mode. It never invents an audio recording, waveform, duration, pronunciation result, AI score, completed practice, or target success. All three states remain false/false/null without supported evidence.

No assessment selector, score aggregation, credits, review scheduler, reward, or progress curve is implemented here.

## Pause and timing contract

Timing starts when an attempt is opened. Preparation exposure is retained, but this contract does not infer preparation duration. Active time is observed elapsed practice within an open attempt and round, not proof of attention. Time belongs to the session, round, and attempt projections, derived from the same time event.

`pausePractice()` samples the preceding active interval, records manual pause, and retains the round, attempt, draft, and reference. While paused, command methods and replay reject new input and submission. Preparation/reference exposure and starting related attempts are also blocked. `resumePractice()` reanchors the clock without charging the paused interval. Ten seconds of practice, twenty seconds of manual pause, then five seconds of practice yields exactly fifteen active seconds.

`setVideoPaused(true)` records only the independent video state. It does not freeze practice, block input, or block submission. Pausing practice and pausing media must not be conflated.

The controller will eventually stop relevant source playback/recording when manual practice pause is requested. Those media effects are an integration requirement only: this module neither operates recording code nor claims that media stopped. Public UI integration must implement and verify those effects separately.

`sampleClock()` observes an injected monotonic clock, rejects backward/nonfinite values, emits only positive active deltas, and keeps no offline elapsed time. Commands sample at transition boundaries. Restore resets the monotonic anchor to the current clock while preserving exact persisted state, including manual pause. A periodic caller may sample once per second; this module installs no timer. `dispatch` accepts complete caller-owned events for replay/import tests and does not derive implicit elapsed deltas; callers should use the command API for live timing.

## Opt-in integration example

```ts
import { PracticeEngine, ORIGINAL_PRACTICE_MATERIAL } from './practice.ts';

const engine = new PracticeEngine({ catalog: [ORIGINAL_PRACTICE_MATERIAL] });
engine.startRound({ materialId: ORIGINAL_PRACTICE_MATERIAL.materialId });
engine.exposeUnitReference('cafe-order', 'correction');
engine.startAttempt({ unitId: 'cafe-order', mode: 'dictation' });
engine.input('X', 'typed');
const first = engine.submit();
engine.input('Y', 'ime');
const revision = engine.submit();
// first.answer === 'X'; revision.answer === 'Y'; same attempt ID.
const captured = engine.getSnapshot();
const restored = new PracticeEngine({ snapshot: captured });
```

`getSnapshot()` is referentially stable until an event. `subscribe(listener)` returns an unsubscribe callback; it is an engine notification, not an input listener. A restore must not also supply a catalog; call `registerMaterial` explicitly for new reference versions. For production persistence, privacy and deletion fences must be completed first. Do not wire these examples into the ordinary user route as part of this batch.

## Event payload inventory

| Payload type | Fact |
| --- | --- |
| `sessionStarted` | Explicit initial catalog; first event only |
| `materialRegistered` | Additional immutable materials/reference versions |
| `roundStarted` | New explicit round and material selection |
| `roundEnded` | Explicitly ended current round |
| `attemptStarted` | Fixed mode/reference and optional retry/mode-switch relation |
| `inputCommitted` | Actual committed text and input source |
| `submissionCommitted` | Submission identity and exact draft version |
| `referenceExposed` | Actual unit exposure, optionally attached to the current attempt |
| `practicePauseChanged` | Manual pause/resume transition |
| `videoPauseChanged` | Independent video playback pause state |
| `timeAdvanced` | Positive observed active duration delta |

A future schema must define its own compatible transition/validation rules. Unknown versions are rejected rather than silently converted.

## Verification

Run `node --import tsx --test studio/core/practice.test.ts` and the repository TypeScript check. Focused tests cover original timed material, X→Y first-answer preservation, all input sources/graphemes, related attempts, preparation and cross-mode exposure, exact restore, manual-pause rejection and timing, independent video pause, explicit new-round reset, reference text/time conflicts and unknown duration, recording comparison without fabricated evidence, completion/evaluation distinctions, strict JSON validation, duplicate replay conflicts, monotonic timing, prototype-name IDs, reserved-key rejection, and an explicit missing-`Intl.Segmenter` rejection without rewriting grapheme counts.
