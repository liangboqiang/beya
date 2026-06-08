# Skill 索引

## 设计业务

- `part-design`: 零部件设计总控 Skill。
- `logic-expression-design`: 逻辑表达式参数设计、缺参追问、Python 计算和结果确认通用流程。
- `conrod-design`: 连杆逻辑表达式设计首例。
- `parameter-mapping`: 中文需求到 NX 参数 ID/表达式的映射。
- `design-data-query`: 设计数据查询。
- `design-report`: 固定槽位 DOCX 设计报告生成。
- `design-verification`: 设计校核。
- `dfmea-risk-review`: DFMEA 风险复核。

## NX

- `nx-operation`: NX 基础操作、WorkPart 确认、模板打开、参数/视图/优化分流；自动出图禁用。
- `nx-parameter`: NX 参数读写。
- `nx-visual`: NX 视图与可视化。
- `nx-optimization`: NX plugin 优化工具流程。

## 外部系统

- `teamcenter-flow`: Teamcenter 文件与流程。
- `external-connector-adapter`: QPP/ECR/IPM 等外部系统适配。

## 加载规则

- 用 `load_skill({"name": "<skill-name>"})` 读取完整内容。
- 只加载当前任务需要的 Skill。
- 通用规划、上下文、文件、脚本、会话和诊断能力由 Beya Server/SDK 提供；不要在 mc-design 资产中重复声明通用工程管理或文件命令工具。
