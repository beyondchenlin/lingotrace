# Automatic history recording segments — unintegrated candidate

This historical note describes the pre-integration candidate. The integrated contract and connection-version barrier are documented in `automatic-history-recording-v42.md`.

Public baseline: v41, source `816f186840f8b36dcaa1b420ebda34d77437fdb2`.
Work branch: `history-segments-candidate`; the earlier OFF-only candidate is preserved separately. No part of this candidate is published or connected to the production UI yet.

## Requirement and current authority

PRD v1.4.6, retaining the v1.4.1 contract, says: “关记录请求立即在当前页生效；设置落盘失败提示本页已停止但设置未保存，不声称其他标签或下次打开已关闭。” It also says: “关闭期不落盘、重新开启不追补” and “临时数据离开即释放，配置不夹带作答。”

On 2026-10-09 the user explicitly asked ordinary recording details to be handled autonomously using best practices. The bounded implementation direction is OFF stops new persistence; ON retains only subsequent practice facts, preserves existing history, and does not require a new live round. The earlier proposal to make ON effective only on a new round is not the requirement. This does not approve Practice-engine adoption, score changes, rewriting legacy history, or permanent deletion.

## Why a boolean is unsafe

Training v1 saves an entire snapshot with its full event log. Resuming that writer after an OFF interval would backfill full draft text, raw native input, answers, alignment, inherited conditions, cumulative time and outcomes from the private interval. A segment therefore is a permission-filtered projection of existing source events, not a second training fact engine. It has a version, source event references, local ordinals, explicit partial coverage and `replayable:false`. It never creates credit, recalculates a judgment or changes the live attempt.

## Two bounded implementation steps

1. Candidate capture and storage: synchronous observation, conservative text provenance, allowlisted segment facts, same-transaction generation/permit checks, safe errors and readonly retained-segment reads/exports. Existing complete snapshots are never overwritten by truncated data. New data uses existing v1 `meta` storage, so the original database version and historical tables remain intact.
2. Production adapter and controls after independent review: route every automatic-save path through this capture adapter, expose truthful local saving state and partial history, verify actual browser persistence and lifecycle behavior, then publish a complete usable increment. The current candidate APIs alone do not satisfy step 2.

## Candidate data boundaries

- Capture starts after successful explicit ON configuration/admission; pending-enable activity is not retrospectively captured. The live engine remains unchanged throughout.
- A nonempty inherited draft is of unknown provenance. It stays redacted until a committed empty draft establishes a clean base; ambiguous operations, undo/redo, and IME crossing the boundary taint it again. Arbitrary selection replacement is not certified by this first conservative implementation.
- Clean entirely ON-built answers may copy the existing judged accuracy, error count and alignment. Mixed-provenance answers or pre-ON requests do not acquire a score in the retained segment. Missing outcomes remain unavailable, never zero.
- Inherited gain, first completion, first/retry, hint/reveal and paste flags cannot be assumed known. No cumulative score/time, full snapshot, nativeEdit.data, original sequence/inputVersion or original observation counters are copied.
- The first timing interval can straddle ON and is marked unknown. Partial recorded intervals are not a complete calendar, a complete CPM window, or the total real practice duration.
- A readonly policy read does not create a write permit. Old batches cannot be retried under a newer generation. Explicit historical downloads remain available while recording is OFF.

## Refresh and compatibility limits

Partial segments cannot reconstruct an exact draft, pending judgment or cumulative engine state. They must never be passed to Training replay, or silently replaced by a stale prefix and called a full continuation. The UI must clearly distinguish a temporary unrestored current page from retained partial history. ON in the current page does not reset, submit, end or award anything. Refresh recovery and new-page admission still need the controlled production adapter and tests; APIs here do not implement that user path.

The new protocol can fence compatible current code. Already-open pre-feature code and an old rollback build do not read its metadata and cannot be promised to honor OFF. Any future rollback after enabling this feature must retain the control/segment protection. Broadcast notification is only a responsiveness aid, not the transaction safety boundary.

## Verification status

Actual TrainingEngine projector tests and controller tests run with isolated inputs. Storage uses isolated fake-indexeddb tests. Independent privacy/storage review is in progress. This is not real-browser OFF/ON acceptance, complete privacy implementation, full coverage/calendar delivery, or formal Practice adoption. The accepted stage, renderer, media/recording, story and published UI remain unchanged.
