---
name: nx-operation
description: NX 基础操作技能；用于定位并打开本机 NX、确认 WorkPart、读取参数、调用参数/视图/优化流程。图纸只走受控模板更新链路。
capabilities:
  - tool.nx.query
  - tool.nx.parameter
  - tool.nx.visual
  - tool.nx.optimization
---

# NX 基础操作技能

## 适用场景

用于连接本机 Siemens NX、打开复制后的本地模板 `.prt`、确认当前 WorkPart、读取驱动表达式、执行参数化更新、导出 NX 图片，以及调用 NX plugin 中已经注册的优化工具。

## 连接规则

- 先用 `nx_test`、`nx_get_work_part_info` 和 `nx_get_drive_params_list` 取得真实工具证据。
- 如果 NX 已经运行，复用已有 NX；需要打开模型时通过项目工具或 NX plugin 打开复制后的工作区文件，不要启动第二个 NX。
- 不要向用户索要 user_id、IP、端口、base_path 或 API Key；本地链路由 Beya/NX plugin 管理。

## 设计路线

零部件设计采用模板参数化建模：先确认本地任务和模板，再复制模板文件夹作为工作区，读取真实驱动表达式，形成参数修改方案，用户确认后更新表达式并由 NX 刷新模型。连杆、曲轴、凸轮轴都不得绕过模板直接创成建模；凸轮轴只允许模板参数化。

## 推荐流程

1. 调用 `nx_test` 判断 NX plugin 是否连接。
2. 调用 `nx_get_work_part_info` 确认当前操作对象。
3. 需要打开模板时，先由 `mc_design_prepare_template_workspace` 复制模板文件夹，再打开复制后的 `.prt`。
4. 需要参数修改时，先读 `nx_get_drive_params_list`，再映射标准参数；写入前必须确认。
5. 需要截图或视图展示时，使用真实视图切换和 `nx_create_image`。
6. 需要优化时，只调用 NX plugin 的优化工具：读取优化工具指南、校验研究、构建目标表达式、执行优化研究。
7. 需要图纸时，只允许连杆图纸模板更新和打印链路，由 `mc_design_generate_conrod_drawing` 处理；它只更新已有图纸模板并导出图片。

## 禁止事项

- 禁止调用任何创建图纸页、自动布置视图、自动继承 PMI 或批量重建图纸页的 NX 工具。
- 禁止从 Teamcenter 猜测图纸数据集路径；当前本地链路只支持连杆图纸模板更新。
- 禁止在未查询/确认本地模板候选时猜测数模模板路径。
- 禁止把 NX 连接失败、参数写入失败、刷新失败后的计划描述为已执行。
- 禁止使用凸轮轴创成式建模工具；凸轮轴只支持打开模板并更新参数表达式。
