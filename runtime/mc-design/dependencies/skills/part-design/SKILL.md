---
name: part-design
description: 零部件设计总控技能
capabilities:
  - mysql_query
  - tc_call
  - teamcenter_get_parts_from_specified_folder
  - tool.nx.query
  - tool.nx.parameter
  - tool.nx.optimization
---

# 零部件设计总控技能

## 适用场景

用户提出发动机零部件设计、参数调整、模板打开、连杆/曲轴等设计分析或设计报告整理等综合任务时，先加载本技能进行任务归口，再按需要加载更窄的技能。

## 核心原则

1. **本地可运行模板优先，副本工作**：零部件设计默认基于项目内 `runtime/mc-design/dependencies/templates` 和 `knowledge/templates.json` 中的真实 `.prt` 参数化模板展开建模。先推荐并确认本地可打开模板，再复制整个模板文件夹作为工作区，打开工作区副本读取真实驱动参数，形成修改方案。TC `智能体模板库` 可作为可用时的增强来源，但不是当前本地链路的唯一前置。
2. **逻辑表达式先算后建模**：当任务包含边界参数、发动机参数和公式推导时，先加载 `logic-expression-design`。连杆任务继续加载 `conrod-design`，完成缺参检查、Python 脚本计算和结果确认后，才进入 NX 参数化建模。
3. **表达式不等于模型特征**：创建或更新表达式不代表几何特征已经创建成功；只有更新已关联特征的驱动表达式并由 NX 成功刷新后，才可以说明模型发生变化。
4. **方案先行**：批量参数修改、报告导出、Teamcenter 写入等副作用动作前，必须先输出方案并取得用户确认。
5. **工具证据优先**：只把工具成功结果、计算脚本输出或用户明确确认的事项称为已完成；工具失败、未执行、结果为空或缺少关键前提时，必须说明阻断原因。
6. **凸轮轴模板化**：凸轮轴与连杆、曲轴一样只支持模板参数化；禁止调用创成式凸轮轴建模工具或 mock 新建模型。
7. **优化走 NX plugin**：优化任务只使用 NX plugin 已注册优化工具，不使用本地伪优化逻辑。
8. **推荐值贴近模板**：推荐模板和推荐参数优先使用当前可运行模板、同类本地模板和真实任务样本形成的范围；不要为了追求“最优”给出远离模板范围、难以写入 NX 的参数。凸轮轴引导提问必须优先采用 `mc_design_plan_workflow`/`mc_design_classify_requirement` 返回的 `guided_input_options`，让每个关键尺寸都包含当前 X14N 模板附近的普通候选值；面向用户时只展示可确认的参数值和候选值，不解释内部取值策略、比例或稳定性等级。

## 推荐流程

1. 识别任务类型：逻辑表达式计算、参数映射、TC 智能体模板库检索、NX 参数修改、TC/NX 模板打开、报告整理、TC 文件流转、外部系统查询或风险复核。
2. 连杆设计或公式类参数设计：加载 `logic-expression-design`；连杆任务继续加载 `conrod-design`。缺参时先追问，输入完整时生成并执行 Python 计算脚本，输出计算结果确认表。
3. 建模缺少当前模型、用户提出新任务或需要数模模板时，先调用本地 `mc_design_recommend_templates` 查询项目内模板，选择本地 `.prt` 存在且参数范围最接近的候选；用户确认后用 `mc_design_prepare_template_workspace` 复制模板文件夹。
4. TC `智能体模板库` 查询只在用户明确要求 TC 数据、需要远端模板或本地模板不足时加载 `teamcenter-flow`；TC 查询失败不得阻断已经可用的本地模板链路。
5. 需要参数词典、编码验证或业务记录时，使用 `mysql_query`。数模模板主路径不走 MySQL 模板表；MySQL 查询结果不能替代本地或 TC 中真实可打开的数模模板资产。
6. 需要操作 NX 时，先确认 `nx_test` 和 `nx_get_work_part_info`，再进入参数、视图或优化技能；NX 连接失败时不得声称已建模。曲轴和凸轮轴写入前必须读取当前驱动表达式，并优先使用 `mc_design_estimate_parameters` 返回的 `nx_parameters`；需要用户选择时展示 `nx_parameter_candidates` 中的普通候选值，不展示内部标签。凸轮轴不得把用户口头输入的基圆、轴颈或凸角宽度直接写到 NX；必须写入当前 WorkPart 中真实存在的 `CV_*` 表达式。
7. 用户只给中文参数或口述需求时，先加载 `parameter-mapping`，把中文语义映射到标准参数 ID 或候选表达式，再让用户确认。
8. 复杂任务由 Beya Server 内核维护短计划和上下文；任务完成状态必须对应工具成功结果、明确资料依据或用户确认，不得仅因为模型形成计划而完成。

## Beya 能力映射

- 零部件设计单智能体：收敛为逻辑表达式计算、参数映射、TC 智能体模板库模板选择、NX 参数更新和结果总结。
- 逻辑表达式设计：收敛为 `logic-expression-design`；连杆首例收敛为 `conrod-design`。
- 参数 ID 智能体：收敛为 `parameter-mapping` 和 `mysql_query`。
- 设计报告：加载 `design-report`，使用 skill 内置 DOCX 模板和 `skills/design-report/scripts/design_report.py` 完成模板检查、payload 校验、证据填充和 DOCX 导出；已有 NX 截图时传入图片路径，缺证据时先向用户确认并把 `allow_confirmed_missing_images` 作为顶层工具参数传入。
- DFMEA：加载 `dfmea-risk-review`；当前稳定生成只支持连杆 `.xls` 模板副本，优先复制 K09LN、K11 和 14N 连杆 DFMEA 模板，不修改模板内容。
- 图纸：当前只支持连杆图纸模板更新和打印，不支持曲轴/凸轮轴图纸生成。
- TC/QPP/ECR/IPM：收敛为 `teamcenter-flow` 与 `external-connector-adapter`。

## 禁止事项

- 禁止用创成式建模替代可追溯模板参数化建模。
- 禁止在需要数模模板时猜测不存在的 NX 路径；必须来自本地模板清单、TC 查询结果或用户明确给出的真实路径。
- 禁止把创建表达式、读取参数、打开模板、视图切换等步骤描述为模型已经创建完成。
- 禁止在未确认参数、模板、目标零件或副作用范围时直接写入 NX、TC、报告或数据库。
- 禁止调用创建图纸页、自动布置视图或批量重建图纸页的 NX 工具；禁止生成 markdown 后改名为 DOCX。
- 禁止把数据库失败、工具未执行、工具返回错误或空结果后的默认假设描述为已完成任务。
- 禁止在 SKILL 主流程中引用旧版未注册的 NX 健康检查、TC 打开、报告、看板或临时计划工具名。
- 禁止简单设计请求自动生成报告、图纸或 DFMEA；这些交付物必须来自用户明确要求或工具入参显式开启。
