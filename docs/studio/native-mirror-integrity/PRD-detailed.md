# 详细增补：原生输入测量镜像完整性（2026-10-11）

与 PRD-total.md 配套。继承已发布 v83 的全部历史需求与附录，追加本文件，不回写旧版本为已完成验收。

## 缺陷边界与真实 API 证据
captureNativeInputDisplay 的缓存持有 mirror、Text、baseline 和布局 key。textarea.value、selectionStart/End 不变时，旧实现可跳过 Text 恢复，仍直接调用 Range.setStart/setEnd。被缩短/拆分的 Text 不能容纳原 UTF-16 偏移。

无 React、媒体、存储或持续 RAF 的隔离浏览器页执行相同函数，合成输入 hello preserved，选择偏移5：
- 旧代码：正常通过；缩短、splitText(1) 均抛原生 IndexSizeError；替换镜像子节点未抛错但保留脱离的缓存节点；移除 mirror 后返回 disconnected 状态。
- 修正代码：正常、缩短、拆分、替换子节点、移除 mirror 五种均通过，返回完整 captured/painted 文本和 connected=true，原 textarea 值与选择未变。
- 基线截图和完整可见 JSON 已保存；修正页完整无障碍文本已取得，之后截图保存时工具报告 tab 不可用，因此不虚报修正截图。
- 此实验在人为 DOM 改写条件下证明真实 Range 失败及修复，不证明手机的外部翻译行为。独立原生 Canvas 键盘矩阵未观察到异常，也不等于 Chromium 或手机端全流程通过。

## 精确实现约束
每次读取缓存前先构造 expectedText：原始 textarea 全文；仅在空文本或末尾换行时按原规则增加零宽测量哨兵。检查 Text 的 parentNode，以及 mirror 的两个子节点是否依次为缓存 Text 与 baseline。发现分裂、包装、替换或附加节点时恢复这两个原节点，使 key 失效。

镜像未连接或不再直属当前 document.body 时移回 body。baseline 有文本或任何子元素时清空，key 失效。Text.data 与 expectedText 不同则全量恢复并使 key 失效。之后仍走原本分词、换行、基线、caret、selection 和 draftEnd 测量，不更改用户原生输入、选择、滚动、焦点或 IME。

稳定帧不反复改写 Text 或重做全布局。首次损坏只恢复一次；下一次无变化的捕获重新使用正确缓存。translate=no/notranslate 仅保护学习内容和镜像，不禁用一般界面的翻译。

## 安全诊断与恢复
受控阶段包括 context、snapshot、native-input、media-state、projection、scene-paint、post-paint、context-reset。异常名限定为已知标准名称，未知名称统一 Error；不读取 message/stack，也容忍 name 访问器自身抛错。未知阶段统一 unknown。仅在错误 dialog 与其本页状态中放置短代码，不发送网络或持久保存，不改变训练记录。

Canvas reset 失败应报告 reset 自身的异常，而不是误报先前 draw 异常。仍先通知录制截止再重置上下文；最多一次自动恢复，持续失败等主动重试，成功时清除代码和对话框。

## 回归范围
- 缩短、同长度改写、拆分、替换、包装、额外节点、移除、连接中改换父节点、基线文字和空子元素，组合长文本、空输入、末尾换行、emoji/组合字符/中文。
- 原生 Range 偏移检查、全量文本一致、镜像连接、换行与 caret/selection/scroll 保持、修复后的缓存复用。
- 实际 Studio draw 阶段、错误消费函数和恢复清除、允许名单隐私、reset 错误归属、既有录制生命周期和最终片段排空。
- 最终核心/场景/媒体全套使用正式 v83 的54个相同 public 文件；归档测试配置冻结 v65 目录。可选 MediaRecorder 导入素材未提供时的旧有跳过需单独披露。

第一次全套预检发现稀疏 checkout 切换分支后缺少 public 链接；失败日志保留。恢复链接并逐一核对54个 Git blob 后重跑，前次环境失败不得计为源码回归通过。

## 此次程序验收结果
最终 TypeScript 检查通过；核心/场景全套2086通过、0失败、0跳过；媒体全套898通过、0失败、1个既有可选 MediaRecorder 素材跳过，合计2984通过。核心最终运行将测试并发限制为4，冻结 v65 归档测试全部启用。此前默认并发运行出现一个未改动 AAC 传输测试文件级失败、未给出具体底层异常；保留其日志，隔离18项全部通过，完整低并发重跑也全部通过，不擅自归因为 OOM。

此结果不等于实际手机整场/软键盘/录像设备验收，不解决 NPS body 失败。构建和发布在本候选冻结之后另行执行。
