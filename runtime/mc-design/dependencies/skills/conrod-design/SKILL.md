---
name: conrod-design
description: 连杆逻辑表达式设计与参数化建模技能
capabilities:
  - tool.nx.query
  - tool.nx.parameter
  - tool.nx.visual
---

# 连杆逻辑表达式设计与参数化建模技能

## 适用场景

用于连杆类零部件设计任务。用户给出机体高度、压缩余隙、行程等边界/发动机参数后，必须先计算连杆设计参数，再进入 NX 模板参数化建模。

本技能必须与 `logic-expression-design` 配合使用。当前公式来自“零部件设计智能体功能开发测试案例逻辑表达式表(1).xlsx”的连杆设计案例。

## 必需输入

### 边界参数

| 参数名 | 含义 | 单位 | 示例 |
| --- | --- | --- | --- |
| 机体高度 | 机体从相关基准到缸盖结合面的高度 | mm | 350 |
| 压缩余隙 | 活塞上止点与缸盖之间的余隙 | mm | 0.7 |
| 活塞压缩高度 | 活塞销中心到活塞顶部的距离 | mm | 71.5 |
| 缸盖垫厚度 | 缸盖垫片厚度 | mm | 1.7 |
| 连杆轴颈直径 | 曲轴连杆轴颈直径 | mm | 83 |
| 活塞销直径 | 活塞销外径 | mm | 47 |
| 连杆瓦厚度 | 连杆轴瓦单侧厚度 | mm | 2.5 |
| 曲柄半径 | 曲柄半径，通常为行程的一半；若用户未明确给出，不得默认换算，必须追问或让用户确认 | mm | 67.5 |
| 连杆小头衬套厚度 | 连杆小头衬套单侧厚度 | mm | 2 |

### 发动机参数

| 参数名 | 含义 | 单位 | 示例 |
| --- | --- | --- | --- |
| 行程 | 活塞行程 | mm | 135 |
| 缸径 | 气缸直径 | mm | 110 |

## 输出参数与公式

| 输出参数 | 公式 | 单位 |
| --- | --- | --- |
| 连杆中心距 | 机体高度 + 缸盖垫厚度 - 压缩余隙 - 曲柄半径 - 活塞压缩高度 | mm |
| 连杆大头直径 | 连杆轴颈直径 + 2 * 连杆瓦厚度 | mm |
| 连杆小头直径 | 活塞销直径 + 2 * 连杆小头衬套厚度 | mm |
| 连杆厚度 | sqrt(缸径 * 曲柄半径 / 2) / 3 | mm |

## 识别与缺参追问

用户给出连杆设计任务后，先从自然语言中抽取上面 11 个必需输入。支持中文标点、乱序字段和带 `mm` 的数值，但必须规范化为数值表。

如果缺少任一必需输入，只输出追问表，不计算、不建模。追问表格式：

| 缺失参数 | 类别 | 单位 | 含义 | 示例 |
| --- | --- | --- | --- | --- |

## 计算脚本要求

输入完整后，按 `logic-expression-design` 的规则在 workspace 下写入：

- `.generated/calculators/<conversation_id>/input.json`
- `.generated/calculators/<conversation_id>/calculate.py`
- `.generated/calculators/<conversation_id>/output.json`

脚本必须基于下面的计算逻辑生成，允许补充输入解析和错误处理，但不得改变公式。

```python
import json
import math
import sys

REQUIRED = [
    "机体高度",
    "压缩余隙",
    "活塞压缩高度",
    "缸盖垫厚度",
    "连杆轴颈直径",
    "活塞销直径",
    "连杆瓦厚度",
    "曲柄半径",
    "连杆小头衬套厚度",
    "行程",
    "缸径",
]


def to_number(value):
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip().replace("毫米", "").replace("mm", "").replace("MM", "")
        return float(text)
    raise TypeError("unsupported value: %r" % (value,))


def calculate(raw):
    missing = [name for name in REQUIRED if name not in raw or raw[name] in ("", None)]
    if missing:
        return {"ok": False, "missing_inputs": missing, "inputs": raw, "results": {}}

    inputs = {name: to_number(raw[name]) for name in REQUIRED}
    results = {
        "连杆中心距": inputs["机体高度"] + inputs["缸盖垫厚度"] - inputs["压缩余隙"] - inputs["曲柄半径"] - inputs["活塞压缩高度"],
        "连杆大头直径": inputs["连杆轴颈直径"] + 2 * inputs["连杆瓦厚度"],
        "连杆小头直径": inputs["活塞销直径"] + 2 * inputs["连杆小头衬套厚度"],
        "连杆厚度": math.sqrt(inputs["缸径"] * inputs["曲柄半径"] / 2) / 3,
    }
    return {
        "ok": True,
        "missing_inputs": [],
        "inputs": inputs,
        "results": results,
        "formulas": {
            "连杆中心距": "机体高度 + 缸盖垫厚度 - 压缩余隙 - 曲柄半径 - 活塞压缩高度",
            "连杆大头直径": "连杆轴颈直径 + 2 * 连杆瓦厚度",
            "连杆小头直径": "活塞销直径 + 2 * 连杆小头衬套厚度",
            "连杆厚度": "sqrt(缸径 * 曲柄半径 / 2) / 3",
        },
        "units": {name: "mm" for name in list(inputs) + list(results)},
        "trace": ["conrod-design formula set from 零部件设计智能体功能开发测试案例逻辑表达式表(1).xlsx"],
        "warnings": [],
    }


if __name__ == "__main__":
    input_path = sys.argv[1]
    output_path = sys.argv[2]
    with open(input_path, "r", encoding="utf-8") as f:
        raw_input = json.load(f)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(calculate(raw_input), f, ensure_ascii=False, indent=2)
```

## 结果确认模板

计算完成后，必须输出：

| 输出参数 | 计算值 | 单位 | 公式依据 |
| --- | ---: | --- | --- |
| 连杆中心距 |  | mm | 机体高度 + 缸盖垫厚度 - 压缩余隙 - 曲柄半径 - 活塞压缩高度 |
| 连杆大头直径 |  | mm | 连杆轴颈直径 + 2 * 连杆瓦厚度 |
| 连杆小头直径 |  | mm | 活塞销直径 + 2 * 连杆小头衬套厚度 |
| 连杆厚度 |  | mm | sqrt(缸径 * 曲柄半径 / 2) / 3 |

随后询问用户是否确认这些计算结果作为 NX 参数化建模输入。用户未确认前，不得调用 NX 写工具。

## NX 参数化建模流程

用户确认计算结果后，按以下顺序执行：

1. 调用 `nx_test` 检查 NX bridge 状态。
2. 调用 `nx_get_work_part_info` 确认当前 WorkPart。
3. 调用 `nx_get_drive_params_list` 或 `nx_get_all_params_list` 获取真实表达式。
4. 将“连杆中心距、连杆大头直径、连杆小头直径、连杆厚度”映射到真实 NX 参数。映射不明确时列出候选并请用户确认。
5. 用户确认映射和写入范围后，调用 `nx_update_param` 或 `nx_batch_update_params`。
6. 再次读取参数或模型状态，汇总更新结果。

## 禁止事项

- 禁止把“曲柄半径 = 行程 / 2”作为默认事实直接代入；除非用户明确给出或确认。
- 禁止跳过计算结果确认直接建模。
- 禁止把中文输出参数名直接猜成 NX 表达式名。
- 禁止引用旧版未注册的 NX 健康检查、TC 打开、报告、看板或临时计划工具名作为主流程。
