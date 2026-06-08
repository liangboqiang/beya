---
name: teamcenter-flow
description: Teamcenter 查询与文件流转技能；用于查询零部件、版本、分类属性、数据集文件、流程人员，以及上传、导出、复制相关文件。
capabilities:
  - tc_call
  - teamcenter_get_parts_from_specified_folder
---

# teamcenter-flow

## 适用场景

用于查询 Teamcenter 零部件、版本、分类属性、数据集文件、流程人员，以及上传、导出、复制相关文件。

TC `智能体模板库` 是参数化建模模板的默认来源。用户要找数模模板、打开模板、建模缺少当前模型或发起新设计任务时，优先调用 `teamcenter_get_parts_from_specified_folder(folder_name="智能体模板库")` 检索该库；查询类 `owner_id` 缺省时由工具自动使用运行时 `user_id`。

## 连接与入参规则

- `BEYA_TC_BASE_URL`：可选，仅用于显式覆盖 K8s AI-service 侧 Teamcenter 基础地址；一般不传。
- `user_id`：当前 Teamcenter 操作人；不传时由运行时注入。
- `owner_id`：目标零部件或文件夹业务所有者。查询类缺失时默认 `user_id`；写入类必须显式确认。
- `user_pass`：Teamcenter 凭证，由用户侧 runtime 通过 bridge header 注入到 K8s，不向用户索要。

## 查询规则

- 文件夹/目录类：优先使用 `teamcenter_get_parts_from_specified_folder`，`folder_name` 使用 `*关键词*`。用户没有给 owner 时，不要追问，工具会默认使用 `user_id`。
- 数模模板类：默认查询 `智能体模板库`，必要时再结合用户给出的模板名、零部件族、机型、图号、名称、版本或关键词过滤。
- 对象结构类：拿到明确 `item_id + item_rev_id` 后，再调用 children、classification attribute 或 process personnel 工具。
- 打开类：拿到确认的 TC 主模型模板后，再进入 `nx-operation`，使用当前注册的 NX 打开工具打开 TC 主模型对象或导出的真实文件。TC 查询成功只代表找到候选，不代表 NX 已打开。
- TC 图纸定位类：用户要求从 TC 打开已有二维图时，先调用 `teamcenter_get_part_rev_children`，或通过 `tc_call(path="getPartRevChildren")` 查询 `item_id + item_rev_id` 的子对象/数据集；筛选关系、类型或名称中包含 `specification`、`drawing`、`dwg`、`二维`、`图纸` 的候选。
- TC 图纸打开类：向用户列出候选图纸/数据集名称、版本、关系、UID 和完整 `@DB@...@specification@...` 路径；不要猜唯一结果。用户选定后，再进入 `nx-operation`，把 `tc_db_path` 或 `item_id + item_rev_id + dataset_name + dataset_rev` 传给 `nx_open_tc_drawing`。
- 文件类：导出数据集前先确认对象 UID 或文件对象；导出后再进入 workspace、NX 或报告流程。

## 写入规则

- `teamcenter_upload_file_function`、`teamcenter_copy_item_content_create` 等写入动作必须先确认目标 item、版本、文件名、覆盖策略、`user_id` 和 `owner_id`。
- 只有 `user_id == owner_id` 且用户明确确认后才允许调用写入工具。
- 如果 `user_id != owner_id`，只能查询、浏览或导出，并提示需要所有者本人操作或授权。

## 禁止事项

- 禁止伪造 TC 地址、账号、密码、`user_pass`、对象、版本、UID 或人员信息。
- 禁止在 `user_id != owner_id` 时上传、复制或覆盖文件。
- 禁止把文件夹通配查询结果当成唯一精确对象；需要二次确认 item/version/uid。
- 禁止根据图号拼造 TC 路径；必须来自 Teamcenter 查询结果和用户选择。
- 禁止根据图号拼造 TC 二维图路径；必须来自 Teamcenter 查询结果和用户选择。
