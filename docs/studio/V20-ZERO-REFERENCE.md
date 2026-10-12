# V20: 不为零词参考文本判分

## 复现与修复

V19 的公开 `TrainingEngine` / reducer 接受空字符串、空白、纯标点、中文或阿拉伯文参考文本。这些文本在现有英文 tokenizer 下均为零个目标词。15 组实际执行的参考/答案组合均生成了 `words: 0` 的 attempt；其中 10 组无可识别答案词的组合记录了 100% 并显示“本句已匹配”。直接提交事件、恢复中断 pending 和完整事件回放均可复现，错误记录也进入 JSON、CSV、conditions 和 curves。

持久化完成数与累计正确词没有增加：原有 `words > 0` 完成条件已生效。此次修复针对无依据的判分与成功反馈。

- `hasScorableReference(reference)` 复用原 `tokens(reference).length > 0` 规则，判断是否存在可判定的目标词。
- 公开 `submit()` 对零词参考返回 `null`，不生成提交/判断事件或 attempt。
- reducer 的 `submitRequested` 在原事件和草稿校验后，对零词参考不创建 pending、不添加 checking。已经存在的原始事件仍保留，序号不重排。
- `judgmentApplied` 对遗留零词 pending 走丢弃路径，不生成分数；清理 pending，并在最后一个 pending 消失时释放 checking。其他暂停原因保留。
- `getCurrentResult` 不返回零词参考或 `words: 0` 的历史结果，防止现有反馈和 Next 入口读取错误成功记录。
- 单独调用 `align` 时，零目标词返回 `accuracy: 0`，避免空对空显示 100%。这只是防御值，不会成为评分 attempt。

界面在 `currentResult` / `submit` 前使用相同判据，提示“当前素材没有可判定的英文参考文本，暂不判分。请选择有参考文本的练习。”这项提示与核心评分修复在同一独立提交中。

## 保持的评分与数据约定

有目标词时，tokenizer、最小词级编辑距离、匹配优先的平局处理、准确率计算、规则版本 `word-alignment-v3` 与导出格式全部保持。数字、全角英文数字、大小写、弯引号和标点规范化沿用原规则。

只检查参考是否可评分，不要求答案包含英文词。对正常英文参考提交 `!!!` 仍是一次真实的错误尝试，按全部目标词缺失判分。首答/重练、提示/显示字幕/粘贴条件、唯一目标位置累计奖励、额外词阻止完成和同一草稿重复提交去重保持。

已有有效参考事件日志可按原数据精确 replay。对 V19 零词参考的旧日志，replay 保留原始事件、时间戳、序号和已记录有效时间，重新派生时不生成无效 attempt、conditions 或 curve；不删除整个会话，也不将无效提交计为有效 cue 的首答。构造 `TrainingEngine({snapshot})` 及 `validateSnapshot` 都通过同一回放路径恢复。

直接传给导出函数的对象仍按同一快照边界如实导出；导出函数没有新增静默过滤或改写原始事件。正常恢复与持久化校验取得的是修复后的规范快照。

## 验证

- 新增 `studio/core/zero-reference.test.ts`，共 9 个测试：5 类零词参考 × 3 类答案、公开提交与直接事件、零词原始 pending 清理、多个 pending 与暂停原因保留、V19 pending/完整日志恢复、历史成功反馈防御、有效参考与首答/重练/导出回归。
- `node --import tsx --test studio/core/*.test.ts studio/scene/*.test.ts`：48 个 Node 顶层条目通过；其中原 training 文件另含 16 项自建测试检查，全部通过。
- `./node_modules/.bin/tsc --noEmit --incremental false`：通过。
- 与 V19 `5b23a8801a3a3094818320ba08abfd9453560f7d` 的实际旧模块对比：24 组非空参考 alignment 完全相同；3 组含计时、提示、粘贴、修改和重练的有效参考会话快照完全相同，旧日志回放也完全相同；3 组实际旧模块生成的零词参考计时日志恢复后，无无效 attempt，原 events 和 activeMs 保持。

本次核心验证不包含浏览器交互、IndexedDB 浏览器测试或发布验证；对应 UI 提示由集成改动补充验证。V19 复现快照、完整事件与导出样本保留在本轮独立 QA 证据目录中。
