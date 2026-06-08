---
name: design-data-query
description: 设计数据库查询与模板检索技能
capabilities:
  - mysql_query
---

# 设计数据库查询与模板检索技能

## 适用场景

用于提供数据库核心查询能力：参数词典查询、历史零部件模板记录查询、设计文档模板查询、数据库结构查询、白名单记录查询、参数编码类型查询、编码唯一性验证。所有能力统一通过 `mysql_query` 执行，不再拆成多个数据库工具。

## 基本原则

- 这是 Beya 数据库能力在 Agent 侧的受控使用方法，不是多工具回迁。
- 只暴露一个工具：`mysql_query`。
- 不向用户索要数据库连接、`user_id`、`conversation_id`、host、port、database、账号或密码。
- 查询结果必须以 `query_result` 和 `sql_statement` 为依据；查询失败或结果为空时，不能把模板命中、参数映射、编码验证描述为已完成。
- 默认只做查询。INSERT/UPDATE/DELETE/DDL 必须有用户明确确认，并且要先给出 SQL 草案、影响范围和回退风险。
- 批量参数修改、模板选型、报告生成或 NX 更新前，依赖的参数/模板查询必须先形成可审查方案并交给用户确认。

## Beya 查询能力映射表

| 历史能力 | Beya 当前做法 | 常用表 | 结果用途 |
|---|---|---|---|
| `query_nx_param_dic` | 用 `mysql_query` 查询参数词典 | `nx_param_dic_cn_v2` | 中文参数到标准参数/NX 表达式候选 |
| `query_part_template` | 用 `mysql_query` 查询历史零部件模板记录 | `part_template_table` | 仅用于辅助理解历史模板记录；当前数模模板主路径走 TC `智能体模板库` |
| `query_doc_template` | 用 `mysql_query` 查询历史设计文档模板 | `doc_template_table` | 仅用于非当前设计报告流程的历史文档候选查询 |
| `mysql_schema_lookup` | 用 `SHOW TABLES` / `DESCRIBE` / `INFORMATION_SCHEMA` | 数据库结构 | 不确定表结构时先查 schema |
| `mysql_query_records` | 用 `SELECT ... WHERE ... LIMIT ...` | 白名单业务表 | 等值过滤记录查询 |
| 编码类型查询 | 查询 `parameter_code_types` | `parameter_code_types` | 生成新参数编码候选 |
| 唯一性验证 | 查询目标编码是否存在 | `nx_param_dic_cn_v2` | 避免重复编码 |

## 推荐使用顺序

1. 先明确业务对象：零部件族、部位、参数语义、限定词、模板类型或文档类型。
2. 不确定表结构时，先查 schema，不直接猜字段。
3. 先查现有记录，再生成候选，不要跳过现有数据检索。
4. 对模板类查询，优先按 `template_id` 精确查；没有 ID 时按 `part_family`、`scope`、`version`、`keywords` 组合模糊查。
5. 对参数词典查询，优先给出候选列表，由 Agent 结合用户需求、零部件、部位、语义进行消歧。
6. 输出给用户时只展示业务字段、匹配依据、SQL 摘要和待确认点，不暴露连接信息。

## SQL 模板

以下 SQL 是可调整模板，字段不存在时必须先通过 schema 查询确认，不允许硬猜后继续声称已完成。

### 1. 查询数据库表列表

```sql
SHOW TABLES;
```

### 2. 查询某张表字段

```sql
DESCRIBE nx_param_dic_cn_v2;
```

也可使用：

```sql
SELECT COLUMN_NAME, DATA_TYPE, COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'nx_param_dic_cn_v2'
ORDER BY ORDINAL_POSITION;
```

### 3. 参数词典候选查询

适合中文参数、别名、关键词、标准 ID 混合检索。

```sql
SELECT
  std_id,
  std_name,
  part,
  section,
  semantic,
  qualifier,
  aliases_text,
  keywords_text,
  confusions_text,
  is_active,
  remark
FROM nx_param_dic_cn_v2
WHERE is_active = 1
  AND (
    std_id = %(query)s
    OR std_name LIKE CONCAT('%', %(query)s, '%')
    OR aliases_text LIKE CONCAT('%', %(query)s, '%')
    OR keywords_text LIKE CONCAT('%', %(query)s, '%')
    OR confusions_text LIKE CONCAT('%', %(query)s, '%')
  )
  AND (%(part)s IN ('', '不确定') OR part LIKE CONCAT('%', %(part)s, '%'))
  AND (%(section)s IN ('', '不确定') OR section LIKE CONCAT('%', %(section)s, '%'))
  AND (%(semantic)s IN ('', '不确定') OR semantic LIKE CONCAT('%', %(semantic)s, '%'))
  AND (%(qualifier)s IN ('', '无', '不确定') OR qualifier LIKE CONCAT('%', %(qualifier)s, '%'))
ORDER BY
  CASE WHEN std_id = %(query)s THEN 0 ELSE 1 END,
  CASE WHEN std_name = %(query)s THEN 0 ELSE 1 END,
  std_id
LIMIT 20;
```

如果当前工具的参数绑定不支持命名参数，可改用显式 SQL 字符串，但必须避免把用户输入直接拼成危险写入语句。

### 4. 历史零部件模板记录查询

当前参数化建模的数模模板以 Teamcenter `智能体模板库` 为准。建模缺少模型、用户提出新任务或需要打开模板时，应加载 `teamcenter-flow` 并调用 `teamcenter_get_parts_from_specified_folder(folder_name="智能体模板库")` 查询。以下 MySQL 查询只能作为历史记录或辅助信息，不得替代 TC 模板库候选和 NX 打开结果。

```sql
SELECT
  template_id,
  template_name,
  part_family,
  scope,
  version,
  file_ref,
  keywords,
  description
FROM part_template_table
WHERE (%(template_id)s = '' OR template_id = %(template_id)s)
  AND (%(part_family)s = '' OR part_family LIKE CONCAT('%', %(part_family)s, '%'))
  AND (%(scope)s = '' OR scope LIKE CONCAT('%', %(scope)s, '%'))
  AND (%(version)s = '' OR version = %(version)s)
  AND (
    %(keyword)s = ''
    OR template_name LIKE CONCAT('%', %(keyword)s, '%')
    OR keywords LIKE CONCAT('%', %(keyword)s, '%')
    OR description LIKE CONCAT('%', %(keyword)s, '%')
  )
ORDER BY version DESC, template_id
LIMIT 5;
```

MySQL 模板记录命中后，只能说“找到历史模板记录”；必须后续在 TC `智能体模板库` 找到并打开真实数模模板后，才能说模板可用。

### 5. 历史设计文档模板查询

当前 `design-report` 技能使用 skill 内置 DOCX 模板：

```text
<asset_root>/skills/design-report/templates/conrod_design_report_template.docx
```

workspace 只保存槽位快照、payload、图片和输出 DOCX。生成设计报告时禁止用 MySQL 查询模板路径；以下 SQL 只保留给非当前报告流程的历史文档模板检索。

```sql
SELECT
  template_id,
  template_name,
  part_family,
  scope,
  version,
  file_ref,
  keywords,
  description
FROM doc_template_table
WHERE (%(template_id)s = '' OR template_id = %(template_id)s)
  AND (%(part_family)s = '' OR part_family LIKE CONCAT('%', %(part_family)s, '%'))
  AND (%(scope)s = '' OR scope = %(scope)s)
  AND (%(version)s = '' OR version = %(version)s)
  AND (
    %(keyword)s = ''
    OR template_name LIKE CONCAT('%', %(keyword)s, '%')
    OR keywords LIKE CONCAT('%', %(keyword)s, '%')
    OR description LIKE CONCAT('%', %(keyword)s, '%')
  )
ORDER BY version DESC, template_id
LIMIT 5;
```

设计报告生成仍必须加载 `design-report` 技能，并使用 skill 内置 DOCX 槽位模板；MySQL 文档模板查询不得改变或替代该模板路径。

### 6. 编码类型表查询

```sql
SELECT code, code_des, type, type_des
FROM parameter_code_types
WHERE type IN ('part_code', 'section_code', 'semantic_code')
ORDER BY type, code;
```

### 7. 新参数编码唯一性验证

```sql
SELECT std_id, std_name, part, section, semantic, qualifier, is_active
FROM nx_param_dic_cn_v2
WHERE std_id = %(std_id)s
LIMIT 1;
```

如果存在记录，不能使用该编码作为新编码；必须重新生成候选或让用户确认使用既有编码。

### 8. 白名单记录查询

当用户要求按条件查看某业务表记录时，先确认表名属于业务白名单，再构造等值查询。

```sql
SELECT *
FROM <白名单表名>
WHERE <字段1> = %(value1)s
  AND <字段2> = %(value2)s
LIMIT 50;
```

禁止在未确认表结构和权限前写入或删除业务数据。

## 输出格式建议

给用户的业务输出建议包含：

```json
{
  "查询目的": "参数词典查询 / 模板查询 / schema 查询 / 唯一性验证",
  "查询状态": "已命中 / 未命中 / 查询失败 / 待确认",
  "候选结果": [],
  "匹配依据": [],
  "sql_statement": "...",
  "下一步": "用户确认 / 打开模板 / 调整 SQL / 补充条件"
}
```

注意：这只是给用户看的摘要格式；工具原始输出仍然必须来自 `mysql_query` 的 `query_result` 与 `sql_statement`。

