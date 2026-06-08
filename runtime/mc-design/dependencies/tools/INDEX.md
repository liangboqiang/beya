# Tool 资产索引

mc-design 静态资产只声明本地 NX 工具组。通用规划、上下文、文件、脚本、会话、诊断由 Beya Server/SDK 提供；MySQL、Teamcenter、QPP/ECR/IPM 等业务系统由 K8s connector catalog 动态返回，并由客户端通过 Beya SDK 同步为 plugin tools。

## 静态工具组

- `tool.nx`: 本地 NX 工具组；schema 来自客户端打包的 NX manifest，执行在用户 Windows 客户端。

## 动态 Connector Tools

这些工具不在静态资产中声明为 `tool.*` 工具组；客户端启动时从 K8s `/api/mc-design/connectors/tools` 获取 schema，再同步到 Beya plugin。

- `mysql_query`: 设计数据库查询。
- `tc_call` / `teamcenter_get_*`: Teamcenter 查询、文件和流程操作。
- `query_ipm_list`: IPM 任务查询。
- `query_ecr_list`: ECR 信息查询。
- `connect_qpp`: QPP 任务查询。

## 调用规则

- 默认只启用和当前任务直接相关的工具，不要猜测业务工具名。
- 本地/NX 修改、Teamcenter 写入、数据库写入等有副作用动作，必须先给出方案并等待用户确认。
- 工具 schema、危险等级和权限元数据必须来自 Beya plugin/tool registry，不从自然语言描述中临时拼接。
