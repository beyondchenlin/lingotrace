# LingoTrace 06 typed local training core

The three source modules are standalone assets for the formal React/Next app. They have no UI, Canvas, network, AI, camera, recording, or localStorage dependency. Copy `training.ts` and `repository.ts` into the app together. If its TypeScript configuration rejects `.ts` import suffixes, change the repository import to `./training`.

## Integration contract

```ts
const repository = new IndexedDBTrainingRepository();
const restored = await repository.loadLatest().catch(() => null);
const engine = new TrainingEngine({ snapshot: restored ?? undefined });
const stopSaving = engine.subscribe(() => {
  repository.saveSession(engine.getSnapshot()).catch(() => {
    // Render repository.getStatus().error. Keep export controls usable.
  });
});
await repository.saveSession(engine.getSnapshot()).catch(() => {});
const interval = setInterval(engine.sampleClock, 1000);
// Component: useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot)
// Cleanup: clearInterval(interval); stopSaving(); repository.close();
```

Keep the engine in `useRef` and initialize once after restore. Keep restore/loading visible until complete so a fresh session cannot overwrite the saved session during hydration. Handle database failure explicitly in the UI. Do not label an in-memory or pending state as saved. On restore, synchronize background, listening, and modal freeze reasons with actual browser/UI state. The engine itself ends an interrupted IME composition and resolves interrupted local pending judgments through explicit new events; committed draft text survives and no offline time is added.

- `getSnapshot()` gives a deeply immutable, stable snapshot until the next event.
- `engine.cue`, `.draft`, `.currentResult` give current cue, committed draft, and result for this exact draft version. `getDraft(snapshot)` and `getCurrentResult(snapshot)` are equivalent pure selectors.
- `input(text, 'typed' | 'paste' | 'ime')` commits actual input. Use paste event/inputType handling to label paste. Do not invoke during composition.
- `beginComposition()` freezes time. Keep intermediate composition text in React state. `endComposition(finalText)` ends composition and commits once; the following identical change event is a no-op. IME committed graphemes earn typed energy; composition duration earns none.
- `setFrozen('paused' | 'listening' | 'background' | 'modal' | 'review' | 'idle' | 'checking' | 'composition', boolean)` flushes the previous timing interval before changing the freeze state. Wire visibilitychange to background, audio play/ended to listening, and dialog open/close to modal. Initial state is idle; the first changed input starts active time.
- `submit()` emits separate submit/judgment events, returns `Attempt | null`, and freezes in review. Repeated submit of an unchanged draft returns the existing attempt. Subsequent input clears review. A correction/retry retains earned words.
- `nextCue(index?)` selects an explicit zero-based index or cycles to the next cue. Starts idle. `resetSession()` creates a new session/round with zero real results; previous sessions remain in IndexedDB.
- `sampleClock()` samples monotonic elapsed time. Call once per second, not from RAF. Every real action samples first, so input/pause/listening/IME/background boundaries are accurate even between interval ticks. Frozen intervals do not emit time events. Canvas may interpolate the displayed pace between snapshots without mutating data.
- `tick(deltaMs)` is for an explicit caller-owned monotonic driver or deterministic tests. It reanchors automatic sampling. Do not both pass an already-accounted delta and sample it again. No clock is read by the reducer.
- `dispatch(TrainingEvent)` accepts complete explicit envelopes. Duplicated event IDs return the exact previous snapshot before validation or mutation. Sequences must be contiguous after dedupe. For asynchronous judgments, preserve the submitted draft version/answer and dispatch `judgmentApplied`; stale drafts or changed cues discard the result without credit.
- `replay(events)` reproduces exactly the snapshot. `deriveCurves(snapshot)` returns observed attempts only, preserving first/retry and help/source conditions. Before an attempt, it returns `[]`.
- `exportSession(snapshot)` returns `{snapshot, json, csv}` from one immutable capture. Download JSON and CSV from the same result to retain identical event boundary/timestamp. CSV has BOM, CRLF, quoted cells, and spreadsheet-formula guards. It includes material, events, attempts, conditions, actual curve points, and definitions. No synthetic legacy records are imported.

`snapshot.earnedWords` is durable cumulative matched target positions for this round/versioned material. `completedCueIds.length` counts cues with full word correctness including zero extras. `snapshot.pace` is only temporary visual energy; it adds 20 per newly committed typed grapheme and decays with a 3-second active-time constant. `activeMs` is measured active practice time, not attention. None of these is an English capability score.

## Persistence

`IndexedDBTrainingRepository({dbName?, indexedDB?})` exposes `loadLatest()`, `saveSession(snapshot)`, `subscribe()`, `getStatus()`, and `close()`. Status has `state: 'in-memory' | 'pending' | 'persisted' | 'error'`, pending count, last persisted session/sequence, and a recoverable error string. Writes are serialized. One transaction writes events, snapshot, and latest pointer. Old snapshots cannot overwrite newer ones; diverging same-session history from another tab fails visibly. There is no localStorage fallback. A failed write leaves the training engine and exports intact, and future save calls can retry.

Saving uses `validateSnapshot`: snapshots produced by this module's reducer from validated prior state are deeply frozen and carry private WeakSet provenance, so validation is O(1). Imported, copied, or manually constructed snapshots are fully replayed. Merely reusing a session ID, sequence, or frozen object does not bypass validation, and reducing a forged prior state cannot acquire trusted provenance. Database reads, snapshot serialization, and persisted-prefix comparison remain O(event count); debounce writes 250–400 ms during bursts, keep elapsed sampling at 1 Hz, and begin a new session for long-running daily practice. All raw history is retained; there is no lossy compaction.

## Tests

On Node 24+, run `node --experimental-strip-types training.test.ts` from this folder. No package installation is needed. Tests cover replay/deduplication, tie alignment, monotonic freezes, graphemes/paste/deletion, immutable snapshots, condition separation, cumulative rewards, full correctness, stale judgments, round reset, and consistent safe exports. IndexedDB browser integration should additionally be checked in the app by entering text, refreshing, comparing sequence/rewards, then simulating storage failure and confirming visible error plus usable export.
