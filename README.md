# LingoTrace 英语练习项目

LingoTrace 是围绕真实英语素材、本机听写与打字练习、明确检查和可追溯记录构建的学习工具。本页是源码、PRD、资源和开发历史的交接入口。

## 当前状态

状态核对时间：2026-10-12 17:15 UTC。GitHub 同步仍在进行，尚未完成全部资源、历史和证据的逐项校验。

- 当前已记录的正式网站基线仍为 **Site v93**：[打开 Studio](https://lingotrace-training-demo.beyond-chenlin.chatgpt.site/studio/)。实现源码为 `1797507bcc03890f4f1e23f3e40b8f76e533f962`，发布生成提交为 `47a1df1df2918fb87a56b16d37b63bcda44d22be`。这里引用已保存的发布记录，没有执行新部署或重新宣称设备验收通过。
- 最新冻结源码候选为 **`b8285030fe8889a1de894f7cfe4ecb91b4d3746a`**，包含以固定速度为主的练习方向。完整验证仍被日历测试进程中断阻塞；该候选未完成新构建、未发布。
- **代码保存、PRD 全部完成和网站发布是三个独立状态。** 本次 GitHub 归档不表示全部需求已实现、完整测试通过或手机与音频体验已验收。
- `main` 当前仅保存本导航 README。产品源码与归档分别在下列分支，不能把本分支当作可运行应用。

## 仓库导航

1. **[源码与 PRD 检查点](https://github.com/beyondchenlin/lingotrace/tree/backup/source-text-checkpoint-b828503-20261012)**  
   分支：`backup/source-text-checkpoint-b828503-20261012`  
   保存冻结候选的源码和需求文档文本。已核检查点 `c61130cdca1b3cf043b6f0b2e884859466d68d62`；导入尚未结束，不能据此认定资源齐全或可直接运行。详见分支内[导入状态](https://github.com/beyondchenlin/lingotrace/blob/backup/source-text-checkpoint-b828503-20261012/.lingotrace-import/STATUS.md)。

2. **[大资源归档](https://github.com/beyondchenlin/lingotrace/tree/archive/large-resources-20261012)**  
   分支：`archive/large-resources-20261012`  
   保存原始媒体、模型和运行时等资源，并通过清单记录原路径、字节数、哈希和上传状态。目前仍为部分归档；需继续补齐缺失对象、大文件分块及历史路径映射。以该分支的 README 和 `resource-manifest.json` 为准。

3. **[项目记录与发布证据](https://github.com/beyondchenlin/lingotrace/tree/archive/project-evidence-20261012)**  
   分支：`archive/project-evidence-20261012`  
   保存项目交接、设计决策、版本历史和已归档原始证据。当前尚有候选验证、未应用实验等原件待补齐；分支目录说明中的计划范围不代表每个文件都已上传。
   - [项目交接与未完成范围](https://github.com/beyondchenlin/lingotrace/blob/archive/project-evidence-20261012/project-records/PROJECT_HANDOFF.md)
   - [设计决策与保留约束](https://github.com/beyondchenlin/lingotrace/blob/archive/project-evidence-20261012/project-records/DECISIONS.md)
   - [发布与开发历史](https://github.com/beyondchenlin/lingotrace/blob/archive/project-evidence-20261012/project-records/RELEASE_HISTORY.md)

4. **[历史迁移进度](https://github.com/beyondchenlin/lingotrace/tree/backup/history-progress-20261012)**  
   分支：`backup/history-progress-20261012`  
   保存历史导入的进行中检查点。完整提交历史、原提交与导入提交的映射、各版本文件与资源仍需核对；此分支存在本身不证明全历史迁移完成。

分支可能继续更新。上面的链接指向相应分支；冻结候选身份、GitHub 导入提交和网站发布提交需要分别核对。

## 接手顺序与剩余工作

1. 先阅读项目交接和决策记录，再查看源码分支中的原始 PRD。最新固定速度需求在 [fixedpace-calibration](https://github.com/beyondchenlin/lingotrace/tree/backup/source-text-checkpoint-b828503-20261012/docs/studio/fixedpace-calibration)；原有需求与历史文档继续保留，本首页不重写完整 PRD。
2. 完成资源、历史和证据上传，按清单逐项核对远端文件、字节身份、路径与提交映射，确认不存在缺失或占位替代。
3. 产品继续开发时，单独解决日历测试进程阻塞，完成精确候选的完整验证。已有局部测试通过不能代替完整验收，未应用实验也不能当作正式源码。
4. 网站发布需要独立构建、发布记录与公开资源核验，并继续完成实际浏览器、手机和音频交互验收。GitHub 同步本身不触发本项目的新发布。

## 原始仓库 README

以下完整保留初始化提交 `9ddf84bf049eaf0ffa1fdc105f3876bb30375a23` 的 README 原文：

```text
# lingotrace
lingotrace
```
