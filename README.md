# LingoTrace 项目记录与历史证据

本分支保存项目交接、决策、版本历史，以及原始构建和发布证据。归档日期：2026-10-12（UTC）。

## 从这里开始

- [项目交接：产品方向、实现边界、当前状态](project-records/PROJECT_HANDOFF.md)
- [决策记录：为什么这样设计、哪些约束必须保留](project-records/DECISIONS.md)
- [发布与开发历史：版本身份、变化、验证结果](project-records/RELEASE_HISTORY.md)
- [当前源码检查点](https://github.com/beyondchenlin/lingotrace/tree/backup/source-text-checkpoint-b828503-20261012)：对应冻结候选源码 `b8285030fe8889a1de894f7cfe4ecb91b4d3746a`。源码历史和大资源另行导入；本证据分支不代表它们已经全部导入完成。

## 版本状态

- 正式已发布基线为 Site v93：实现源码 `1797507bcc03890f4f1e23f3e40b8f76e533f962`，生成发布提交 `47a1df1df2918fb87a56b16d37b63bcda44d22be`。
- 最新冻结候选 `b828503` 包含固定速度练习方向，但完整验证仍被日历测试进程阻塞，未构建、未发布。
- 这里的 GitHub 同步只归档源码相关上下文与历史证据，不执行部署，也不意味着候选已通过完整验收。记录中的既有测试和 HTTP 检查结果只代表其记录时间，不是本次重新运行的结果。

## 归档内容

- `published/v82/` 至 `published/v93/`：原始构建、哈希、源码清单、发布回执和公开资源身份记录。
- `candidate-fixedpace/`：冻结候选的身份、评审和失败验证证据。
- `unapplied-experiment/` 与 `unapplied-experiment-public-lifecycle/`：两次未应用、未发布实验，保留补丁和失败结果；不得当作正式源码或已通过方案。
- `uncommitted-history/`：历史辅助脚本，不属于正式候选源码，也不证明验收通过。
- `evidence/`：原始归档准备状态。其“待同步”等字段保留历史原文，不应被误读为本分支当前上传状态。
- `README.original.md`：仓库初始化 README 的原始内容。

112 份选定原始证据按原字节保留，另有 3 份可读项目记录和本导航。原始构建路径、版本名和历史状态均按记录保留。正式发布身份、冻结候选身份、GitHub 导入提交身份需分别核对。
