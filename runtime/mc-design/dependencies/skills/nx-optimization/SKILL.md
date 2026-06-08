---
name: nx-optimization
description: NX plugin 优化技能；用于使用项目 NX 插件内置优化工具完成目标表达式、约束校验和优化运行，不提供本地伪优化算法。
capabilities:
  - tool.nx.optimization
---

# NX Plugin 优化技能

## 适用场景

用于零部件参数化模型已经打开、驱动表达式已经确认后，执行优化目标构建、约束校验和优化运行。

## 工具顺序

1. `nx_get_optimization_tool_guide`：读取 NX plugin 提供的优化工具说明。
2. `nx_validate_optimization_study`：校验优化目标、变量、边界和约束是否能在当前 WorkPart 中执行。
3. `nx_build_optimization_objective_expression`：需要构造目标表达式时调用；这是写入/修改类动作，必须先确认。
4. `nx_run_optimization_study`：执行优化任务；必须先确认变量范围、目标、约束和输出影响。

## 禁止事项

- 禁止使用本地 mock 优化或自行补一个独立优化器替代 NX plugin。
- 禁止在未确认当前 WorkPart、驱动表达式、变量边界和目标函数前运行优化。
- 禁止把校验通过描述为优化已完成；只有 `nx_run_optimization_study` 成功返回后才算优化执行完成。
