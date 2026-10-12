# LingoTrace 英语练习项目

LingoTrace 是围绕真实英语素材、本机听写与打字练习、明确检查和可追溯记录构建的学习工具。本页是源码、PRD、资源和开发历史的交接入口。

## 当前状态

最新源码归档核对：2026-10-12 23:45 UTC。冻结候选的 670 文件源码投影现已完整、可恢复地保存：666 个路径直接保存，另 4 个大资源路径由同分支中的 9 个原始分片和恢复脚本无损还原。独立 Word/PDF PRD 原件、全历史和证据归档仍有待完成项目。[17:15 UTC 原索引](https://github.com/beyondchenlin/lingotrace/blob/218fbb510e7ee4700110d209db6a5718fd37c216/README.md) 保留当时记录。

- 当前已记录的正式网站基线仍为 **Site v93**：[打开 Studio](https://lingotrace-training-demo.beyond-chenlin.chatgpt.site/studio/)。实现源码为 `1797507bcc03890f4f1e23f3e40b8f76e533f962`，发布生成提交为 `47a1df1df2918fb87a56b16d37b63bcda44d22be`。这里引用已保存的发布记录，没有执行新部署或重新宣称设备验收通过。
- 最新冻结源码候选为 **`b8285030fe8889a1de894f7cfe4ecb91b4d3746a`**，包含以固定速度为主的练习方向。完整验证仍被日历测试进程中断阻塞；该候选未完成新构建、未发布。
- **代码保存、PRD 全部完成和网站发布是三个独立状态。** 本次 GitHub 归档不表示全部需求已实现、完整测试通过或手机与音频体验已验收。
- `main` 当前仅保存本导航 README。产品源码与归档分别在下列分支，不能把本分支当作可运行应用。

## 仓库导航

1. **[源码与 PRD 检查点](https://github.com/beyondchenlin/lingotrace/tree/backup/source-text-checkpoint-b828503-20261012)**  
   分支：`backup/source-text-checkpoint-b828503-20261012`  
   已核检查点 [`5c0afc3e7c8f18a15cb7a027dafce54a9ab729f0`](https://github.com/beyondchenlin/lingotrace/tree/5c0afc3e7c8f18a15cb7a027dafce54a9ab729f0) 保存冻结候选的全部 643 个直接源码文本（含 42 份成对 PRD 增补）、23 个直接资源路径，以及供剩余 4 个大资源路径恢复的 9 个分片。克隆本分支后运行 `python3 .lingotrace-import/restore-source.py`；脚本不联网，逐项校验全部 670 文件并拒绝覆盖已有改动。本地分片恢复、重复运行和错误拒绝测试通过；远端所有直接文件/分片的路径、大小、blob 身份及脚本内容已核对。远端大二进制全文下载回读尚未完成。该归档完成不代表候选已完成测试或可直接运行。详见分支内[导入状态](https://github.com/beyondchenlin/lingotrace/blob/backup/source-text-checkpoint-b828503-20261012/.lingotrace-import/STATUS.md)。

2. **[大资源归档](https://github.com/beyondchenlin/lingotrace/tree/archive/large-resources-20261012)**  
   分支：`archive/large-resources-20261012`  
   检查点 `2222eb2685b7c7da9ea0f7e86622fabfe7d33427` 已保存全部 33 个原资源：30 个原文件直接保存，另 3 个大原件保存为 9 个分片；加上 3 份说明与清单，共 42 个文件。远端完整树中的资源路径、字节数和 Git blob SHA 已与清单核对一致；上传前原件校验和本地分片重组校验已通过。远端大二进制全文尚未成功读取，因此**远端逐字节下载回读与重组校验尚未完成**。历史资源路径映射仍缺 41 个源码身份，不能据此认定全部历史可恢复。详见该分支的 README、`resource-manifest.json` 和 `large-resources.json`。

3. **[项目记录与发布证据](https://github.com/beyondchenlin/lingotrace/tree/archive/project-evidence-20261012)**  
   分支：`archive/project-evidence-20261012`  
   保存项目交接、设计决策、版本历史和已归档原始证据。当前尚有候选验证、未应用实验等原件待补齐；分支目录说明中的计划范围不代表每个文件都已上传。
   - [项目交接与未完成范围](https://github.com/beyondchenlin/lingotrace/blob/archive/project-evidence-20261012/project-records/PROJECT_HANDOFF.md)
   - [设计决策与保留约束](https://github.com/beyondchenlin/lingotrace/blob/archive/project-evidence-20261012/project-records/DECISIONS.md)
   - [发布与开发历史](https://github.com/beyondchenlin/lingotrace/blob/archive/project-evidence-20261012/project-records/RELEASE_HISTORY.md)

4. **[历史迁移进度](https://github.com/beyondchenlin/lingotrace/tree/backup/history-progress-20261012)**  
   分支：`backup/history-progress-20261012`  
   检查点 `eccd81af44a2b5648e5ade62119465128cdc4806` 已可追溯 19 个投影导入提交，另有仓库初始化提交。投影提交保存原提交与源码树身份，剔除了生成的 `dist` 和历史依赖，不能与原始完整 Git 历史等同。后续历史、原提交与导入提交的映射、各版本文件与资源仍需补齐或核对，全历史迁移尚未完成。

分支可能继续更新。上面的链接指向相应分支；冻结候选身份、GitHub 导入提交和网站发布提交需要分别核对。

## 接手顺序与剩余工作

1. 先阅读项目交接和决策记录，再查看源码分支中的 PRD 增补。独立 Word/PDF 原件另行归档，不能把这 42 份增补视作全部原始 PRD。源码归档已可恢复，先按分支导入状态说明展开 4 个大资源路径并校验。最新固定速度需求在 [fixedpace-calibration](https://github.com/beyondchenlin/lingotrace/tree/backup/source-text-checkpoint-b828503-20261012/docs/studio/fixedpace-calibration)；原有需求与历史文档继续保留，本首页不重写完整 PRD。
2. 继续补齐历史和证据；对已归档资源完成远端全文回读与大文件重组校验，并补齐缺失的历史路径映射。按清单逐项核对远端文件、字节身份、路径与提交映射，确认不存在缺失或占位替代。
3. 产品继续开发时，单独解决日历测试进程阻塞，完成精确候选的完整验证。已有局部测试通过不能代替完整验收，未应用实验也不能当作正式源码。
4. 网站发布需要独立构建、发布记录与公开资源核验，并继续完成实际浏览器、手机和音频交互验收。GitHub 同步本身不触发本项目的新发布。

## 原始仓库 README

以下完整保留初始化提交 `9ddf84bf049eaf0ffa1fdc105f3876bb30375a23` 的 README 原文：

```text
# lingotrace
lingotrace
```
