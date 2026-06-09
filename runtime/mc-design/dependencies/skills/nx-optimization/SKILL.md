---
name: nx-optimization
description: NX plugin 优化技能；用于使用项目 NX 插件内置优化工具完成目标表达式、约束校验和优化运行，不提供本地伪优化算法。
capabilities:
  - tool.nx.optimization
---

# NX Plugin 优化技能

## 适用场景

用于零部件参数化模型已经打开、驱动表达式已经确认后，执行优化目标构建、约束校验和优化运行。当前稳定路径是 NX plugin 的一次性优化研究；当 NX `OptimizationBuilder` 运行异常时，由 `nx_run_optimization_study` 在插件内部切到表达式安全搜索并写回最佳候选。不使用本地伪优化器，也不在多轮对话中保存 NX `OptimizationBuilder` 状态。

## 前置条件

1. NX 已连接；如果 NX 已经运行，复用现有 NX，不再启动第二个 `ugraf.exe`。
2. 已通过 `nx_get_work_part_info` 确认当前 WorkPart 是模板副本或用户确认的当前模型。
3. 已通过 `nx_get_drive_params_list` 或 `nx_get_all_params_list` 取得真实表达式；变量、目标、约束必须来自这些真实表达式。
4. 变量边界优先取当前已选本地可运行模板、同类本地模板/任务范围和用户确认边界；不要给出远离当前模板的宽泛范围。
5. 目标表达式、约束表达式不存在时，只能说明需要补充 NX 表达式或人工建模，不得用自然语言目标直接运行优化。

## 工具顺序

1. `nx_get_optimization_tool_guide`：读取 NX plugin 提供的优化工具说明。
2. `nx_get_work_part_info`：确认当前模型；如果模型不对，先回到 `nx-operation` 打开模板副本。
3. `nx_get_drive_params_list`：读取可驱动变量；必要时用 `nx_get_all_params_list` 查目标/约束表达式。
4. `nx_validate_optimization_study`：校验优化目标、变量、边界和约束是否能在当前 WorkPart 中执行。
5. `nx_build_optimization_objective_expression`：需要构造目标表达式时调用；这是写入/修改类动作，必须先确认。生成的 `Objective_AI` 只作为内部合成目标表达式，不要再作为 `objectives[].name` 传给运行工具。
6. `nx_run_optimization_study`：执行优化任务；必须先确认变量范围、目标、约束和输出影响。`dry_run=true` 只表示配置预检成功，不代表优化已执行。

## 推荐边界

- 连杆优先围绕 `CR_A_CEN`、`CR_B_DIA`、`CR_S_DIA`、`CR_R_W`、`CR_R_LEN` 等当前 WorkPart 已存在驱动表达式。
- 曲轴优先围绕 `CS_Q_RAD`、`CS_M_DIA`、`CR_J_AX_DIA`、`CS_M_GRD_W`、`CS_C_W`、`WB_T`、`WB_RAD`。
- 凸轮轴只做模板参数优化，优先围绕当前 X14N 模板真实驱动表达式 `CV_BC_DIA`、`CV_J_DIA`、`CV_INL_W`、`CV_EXL_W`、`CV_BRKL_W`、`CV_AX_CEN`、`CV_GRDJ_CEN`；禁止创成式建模。
- 推荐值和变量边界应贴近 `mc_design_recommend_templates`/`mc_design_estimate_parameters` 给出的本地可运行模板结果，再由 NX 当前表达式确认。曲轴优化起点优先使用 `nx_parameters` 或用户从 `nx_parameter_candidates` 中确认的候选值；诊断字段只能作为内部参考，不能作为首轮优化写入值。

## 禁止事项

- 禁止使用本地 mock 优化或自行补一个独立优化器替代 NX plugin。
- 禁止在未确认当前 WorkPart、驱动表达式、变量边界和目标函数前运行优化。
- 禁止把校验通过描述为优化已完成；只有 `nx_run_optimization_study` 成功返回后才算优化执行完成。
- 禁止把 `Objective_AI` 作为目标表达式再传入 `nx_run_optimization_study`；它是工具内部合成表达式，会造成循环参考。
- 禁止调用未出现在 manifest 中的旧优化工具名。

## 结果处理

- `nx_run_optimization_study` 返回 `runner: "nx_optimization_builder"` 时，表示 NX OptimizationBuilder 正常完成。
- 返回 `runner: "safe_expression_search"` 时，表示 OptimizationBuilder 抛出 NX 内部异常后，插件已在当前 WorkPart 内完成表达式候选搜索并写回最佳候选；这仍然算 NX plugin 优化工具完成，不要再描述为手动计算或操作中止。
- 如果 `ok=false`，才视为优化失败；此时停止写入新的优化参数，优先读取错误信息并收敛变量、目标或约束。
