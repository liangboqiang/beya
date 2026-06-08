---
name: tool.nx
description: NX 业务工具组说明
---

# tool.nx

NX 工具只通过当前客户端 manifest 中注册的 `nx_*` 工具暴露。

TC 主模型打开使用 `nx_open_tcpart`；Teamcenter 已有二维图必须先通过 TC 查询和用户选择得到图纸数据集，再使用 `nx_open_tc_drawing`；当前 WorkPart 内已有图纸页使用 `nx_open_drawing_sheet`；本地或明确 NX 文件路径打开使用 `nx_open_part`。参数修改、参数查询和视图截图分别进入 `nx-parameter`、`nx-operation`、`nx-visual`。

不要调用未出现在当前工具 manifest 中的旧工具名；未注册工具应视为不可用能力。
