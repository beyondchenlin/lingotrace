# Automatic-history OFF: implementation candidate, not released

Baseline: v40 / `aaf773e93d4013de0518c01c996609a18dc5672f`. This candidate concerns the existing Training v1 repository only. It is not a Practice engine cutover, a schema migration, or a new data-deletion feature. No production UI invokes these new controls yet.

## Requirement and unresolved choices

PRD v1.4.6 body-paragraph index 193 (zero-based, in the storage/privacy contract) states:

> 关记录请求立即在当前页生效；设置落盘失败提示本页已停止但设置未保存，不声称其他标签或下次打开已关闭。同一提交事务内复查许可、写入代次、删除状态和父对象存在性，旧回调不得绕过；删除失败如实报告。临时数据离开即释放，配置不夹带作答。

Body-paragraph index 63 (zero-based, in the unresolved adoption choices) separately states:

> 刷新续练许可：如何在已有获准保存检查点、当前记录开关及写入代次约束内恢复写许可，尚待讨论；刷新本身不授予权限，关闭期不落盘、重新开启不追补。

The user's continued-work request permits the unambiguous OFF fence and failure reporting. It does not select a new ON/resume policy. In particular, “ON only takes effect for a new round” is a possible implementation strategy, not an approved replacement for those requirements. Training v1 stores whole-session snapshots; simply re-enabling writes would backfill OFF-period text. No enable, new-round requirement, restart permission, or refresh-write grant is chosen in this candidate.

## Bounded API preparation

The OFF request must stop this repository instance's future, queued and still-abortable in-flight automatic history writes before waiting for storage. Existing durable practice records remain intact. A settings write stores only a versioned disabled state and generation in the existing meta store. Failure keeps the current page disabled and explicitly distinguishes that fact from a successfully persisted setting. A retry is another disable request, never an implicit enable.

Every new save transaction must read the persisted control in the same transaction as its existing sessions/events/meta work and recheck the local generation before writing. Another instance therefore respects a committed OFF. Missing control retains the prior legacy default; unknown/corrupt control fails closed. Queue slots are reserved before synchronous listener notifications to prevent reentrant reversal.

Readonly v40 list/detail/export remain available. Reading does not clear failed-save or failed-setting status, re-enable writes, create a database, or reconstruct deleted data. No permanent deletion API is added. Full production deletion tombstones and Practice privacy integration remain separate requirements.

## Acceptance limits

Tests use isolated fake-indexeddb with real repository methods and injected transaction failures. They cover OFF at queue/put boundaries, settings failure, late callbacks, another instance, repeated/reentrant requests, unchanged existing records, and configuration without answer text. This is candidate API evidence, not a user-visible OFF workflow or browser privacy-completion claim. Production UI integration and publication wait for the applicable ON and refresh-permission decisions to be explicit.

The final candidate passed 17 new fixed cases, the full 425 core/scene + 57 media suite, non-incremental TypeScript checking, and independent read-only review. Local status describes this instance's request; future UI must separately read durable settings to reflect another tab's OFF. A foreign write transaction already holding the overlapping store lock can commit before the OFF configuration transaction; saves ordered after committed OFF are rejected. No cross-tab claim is made before that setting commits.
