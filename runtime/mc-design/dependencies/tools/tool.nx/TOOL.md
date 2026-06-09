---
name: tool.nx
description: NX 业务工具组说明
---

# tool.nx

NX 工具只通过当前客户端 manifest 中注册的 `nx_*` 工具暴露。

TC 主模型打开使用 `nx_open_tcpart`；Teamcenter 已有二维图必须先通过 TC 查询和用户选择得到图纸数据集，再使用 `nx_open_tc_drawing`；当前 WorkPart 内已有图纸页使用 `nx_open_drawing_sheet`；本地或明确 NX 文件路径打开使用 `nx_open_part`。参数修改、参数查询和视图截图分别进入 `nx-parameter`、`nx-operation`、`nx-visual`。

NX 优化只使用 manifest 中已注册的优化工具：`nx_get_optimization_tool_guide`、`nx_validate_optimization_study`、`nx_build_optimization_objective_expression`、`nx_run_optimization_study`。其中 guide/validate 是只读，build/run 是写入或执行类动作，必须先确认当前 WorkPart、变量范围、目标函数、约束和输出影响。`nx_build_optimization_objective_expression` 生成的 `Objective_AI` 是工具内部合成表达式，不能作为 objective 再传回 `nx_run_optimization_study`；`nx_run_optimization_study` 返回 `runner: "safe_expression_search"` 时表示插件已在 NX 内部完成安全候选搜索并写回结果，不要描述为本地伪优化。

不要调用未出现在当前工具 manifest 中的旧工具名；未注册工具应视为不可用能力。
