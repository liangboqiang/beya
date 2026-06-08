---
name: logic-expression-design
description: 逻辑表达式参数设计与脚本计算技能
capabilities:
---

# 逻辑表达式参数设计与脚本计算技能

## 适用场景

当用户提出零部件设计任务，且设计参数可以由边界参数、发动机参数或其他输入变量通过公式计算得到时，先加载本技能。典型任务包括连杆、曲轴等零部件的“输入完整性检查 -> 公式计算 -> 结果确认 -> 参数化建模”流程。
本技能是通用流程技能；具体零部件的变量清单和公式由更窄的技能提供。例如连杆任务必须继续加载 `conrod-design`。

## 总流程

1. 识别零部件类型、公式族和目标输出参数；如果无法识别公式族，先说明缺少公式依据并追问，不得凭空设计公式。
2. 建立“必需输入表”，每一项包含：参数名、来源类别、单位、用户给定值、规范化数值、状态和备注。
3. 先做完整性检查。存在缺失、歧义、非数值、单位不明或同名冲突时，只输出缺失项和追问表，不生成建模方案，不调用 NX 写工具。
4. 输入完整后，在 workspace 下生成 Python 计算脚本和 JSON 输入文件：
   - 目录：`.generated/calculators/<conversation_id>/`
   - 输入：`input.json`
   - 脚本：`calculate.py`
   - 输出：`output.json`
5. 用 Python 执行计算脚本。脚本输出必须是 JSON，且包含输入值、缺失项、计算结果、公式依据、单位和可追溯说明。
6. 将 `output.json` 转成“计算结果确认表”交给用户确认。确认前不得打开、修改或批量更新 NX 模型。
7. 用户确认计算结果后，才进入 NX 参数化建模准备阶段：读取当前 WorkPart、读取驱动参数、生成参数映射/更新方案。
8. 参数映射不明确时继续确认；只有用户确认目标参数映射和写入范围后，才允许调用 `nx_update_param` 或 `nx_batch_update_params`。

## 缺参追问规则

缺参时输出以下内容：

- 缺失参数名。
- 参数含义。
- 建议单位。
- 示例填写格式。
- 当前已识别参数表。

缺参时不得输出“已完成建模”“已生成模型”“已更新 NX 参数”等完成态表述。

## 计算脚本规则

计算脚本必须满足：

- 只使用 Python 标准库。
- 输入和输出均使用 JSON。
- 不访问网络，不读取公式无关文件，不修改模型文件。
- 所有输入先规范化为数值，单位默认按 `mm` 处理；如果用户给出其他单位，必须先显式换算或追问。
- 输出 `ok`、`missing_inputs`、`inputs`、`results`、`formulas`、`units`、`trace`、`warnings`。
- `missing_inputs` 非空时，`ok` 必须为 `false`，并且不得返回 NX 建模完成态。

推荐输出结构：

```json
{
  "ok": true,
  "missing_inputs": [],
  "inputs": {},
  "results": {},
  "formulas": {},
  "units": {},
  "trace": [],
  "warnings": []
}
```

## 结果确认模板

输入完整并完成计算后，必须先输出：

| 输出参数 | 计算值 | 单位 | 公式依据 | 备注 |
| --- | ---: | --- | --- | --- |

随后询问：
“请确认以上计算结果是否作为 NX 参数化建模输入。确认后我会读取当前 WorkPart 和驱动参数，生成参数映射/更新方案；不会直接写入模型。”

## NX 建模前置条件

进入 NX 阶段必须满足：

1. 用户已经确认计算结果。
2. `nx_test` 可用或已确认 NX bridge 连接状态。
3. 已调用 `nx_get_work_part_info` 确认当前 WorkPart。
4. 已调用 `nx_get_drive_params_list` 或 `nx_get_all_params_list` 获取真实参数。
5. 已输出参数映射/更新方案并得到用户确认。

允许使用的 NX 参数化工具包括：`nx_get_work_part_info`、`nx_get_drive_params_list`、`nx_get_all_params_list`、`nx_update_param`、`nx_batch_update_params`、`nx_open_part`、`nx_open_tcpart`。

## 禁止事项

- 禁止跳过缺参检查直接建模。
- 禁止把中文设计参数名猜成 NX 表达式名。
- 禁止在用户确认计算结果前调用 NX 写工具。
- 禁止在用户确认参数映射前调用 `nx_update_param` 或 `nx_batch_update_params`。
- 禁止引用旧版未注册的 NX 健康检查、TC 打开、报告、看板或临时计划工具名作为主流程。
