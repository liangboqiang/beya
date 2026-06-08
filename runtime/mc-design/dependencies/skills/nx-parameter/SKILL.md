---
name: nx-parameter
description: NX 参数识别与修改技能
capabilities:
  - tool.nx.health
  - tool.nx.query
  - tool.nx.parameter
  - mysql_query
---

# NX 参数识别与修改技能

## 适用场景

用于读取、查找、确认和修改 NX 参数。适合“把某个尺寸改为多少”“批量调整参数”“查看当前模型有哪些驱动参数”等任务。

## 关键边界

- `nx_create_param` 只创建新的表达式变量。表达式如果没有被模型特征引用，不会改变几何，不代表模型创建或更新成功。
- `nx_update_param` 或 `nx_batch_update_params` 修改已存在且被特征引用的驱动表达式，并且 NX 返回成功后，才可以说明模型参数更新成功。
- 批量修改前必须先输出参数修改方案，包括表达式名、当前值、目标值、风险说明，并取得用户确认。

## 推荐流程

1. 调用 `nx_get_work_part_info` 确认当前零件。
2. 调用 `nx_get_drive_params_list` 或 `nx_get_all_params_list` 获取真实参数，不猜表达式名。
3. 用户输入是中文参数名时，加载 `parameter-mapping` 并使用 `mysql_query` 或已读取资料查标准参数候选。
4. 将用户意图、候选参数和 NX 当前参数列表对齐，列出待修改参数、当前值、目标值和风险。
5. 用户确认后调用 `nx_update_param` 或 `nx_batch_update_params`。
6. 修改后再次读取结果，汇总成功项、失败项和需要人工处理的项。

## 禁止事项

- 禁止根据中文口述直接猜 NX 表达式名并修改。
- 禁止在用户未确认目标参数和值时写入模型。
- 禁止把 `nx_create_param` 成功描述为“模型已创建/特征已生成”。
- 禁止忽略 NX 返回的失败明细继续假装成功。
