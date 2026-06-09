# Beya 架构协议包

这个目录是架构协议的唯一集中存放点。协议不能散落到 `src/`、`desktop/`、`adapters/`、`docs/` 等目录里。

协议包和目标架构同构：`contracts/` 目录内的分类文件夹对应 7 个架构板块，文件夹内再放该板块拥有的协议文件。这些文件夹只是协议包内部的阅读分组，不代表生产代码目录。

这里不放根索引协议文件。目录结构本身就是索引，避免再制造一个“所有协议都要经过它”的中心文件。

读取顺序：

1. 先进入统一协议目录 `contracts/`。
2. 再按下面的协议分类文件夹找到对应架构板块。
3. 先读对应分类下和板块同名的 YAML 文件，确认职责边界。
4. 最后读分类内的具体协议，例如 `session_ws.yaml`、`provider_runtime.yaml`。

文件大小约束：

- 单个协议文件优先控制在 120 行以内。
- 超过 160 行必须拆分。
- 一个文件只描述一个板块或一个协议，不把实现细节、迁移计划和测试说明混在一起。
- 跨板块内容只能写“契约”，不能写“谁去 import 谁的实现”。

目录结构：

```text
contracts/
  access_surfaces/
    access_surfaces.yaml
  protocol_gateway/
    protocol_gateway.yaml
    http_api.yaml
    route_naming.yaml
    session_ws.yaml
  session_host/
    session_host.yaml
    runtime_process.yaml
  agent_core/
    agent_core.yaml
    agent_turn.yaml
  capability_registry/
    capability_registry.yaml
    capability_manifest.yaml
  model_runtime/
    model_runtime.yaml
    provider_runtime.yaml
  foundation/
    foundation.yaml
    persistence.yaml
    compatibility.yaml
```

维护规则：

- 新增顶层板块前，先检查同层数量是否仍在 3-10 个之间。
- 新增子协议前，先检查是否属于现有板块；不能为了临时功能新建“杂物目录”。
- 兼容入口必须写入 `foundation/compatibility.yaml`，并声明退役条件。
- 用户状态读写必须写入 `foundation/persistence.yaml`，并声明 owner。
