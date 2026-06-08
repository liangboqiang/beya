---
name: design-report
description: 固定槽位 DOCX 设计说明书生成技能；用于基于本地 DOCX 模板、工具证据、计算结果和用户确认信息生成零部件设计说明书。
---

# 固定槽位 DOCX 设计说明书生成

## 基本原则

报告必须由 `scripts/design_report.py` 基于 DOCX 模板生成，不得生成 markdown 后改名为 `.docx`。模板只来自本 skill 的 `templates/` 目录：

- `conrod_design_report_template.docx`
- `crankshaft_design_report_template.docx`
- `camshaft_design_report_template.docx`

报告只在用户明确要求“设计说明书/报告/doc/docx”时生成；DFMEA CSV 只在用户明确要求或工具入参 `include_dfmea: true` 时生成。

## 旧版提示词约束

本 skill 按 `runtime/mc-design/dependencies/source-documents/report-prompts/legacy_design_report_prompt.txt` 的预期执行，但实现方式改为本地资料库和 DOCX 模板：

- 先判断用户是否真的要求报告；没有报告请求时不调用报告工具。
- 先检索并确认报告模板，再读取模板槽位。
- 文本槽位只填工具结果、本地资料库证据、计算结果或用户明确确认的信息；禁止假数据。
- 图片槽位必须来自真实 NX 截图/导出工具；缺图默认阻断。只有用户明确确认后，才允许 `allow_confirmed_missing_images: true`。
- 报告导出必须通过本 skill 的脚本完成，且 `validate` 成功后才能 `generate`。

## 脚本命令

```bash
<python_exe> scripts/design_report.py inspect-template
<python_exe> scripts/design_report.py prepare --workspace <workspace_root> --conversation-id <conversation_id> --output-name <item_id>_design_report.docx
<python_exe> scripts/design_report.py validate --workspace <workspace_root> --input design_reports/input/<conversation_id>/report_payload.json
<python_exe> scripts/design_report.py generate --workspace <workspace_root> --input design_reports/input/<conversation_id>/report_payload.json
```

本地运行优先使用项目内 `runtime/mc-design/dependencies/python/python.exe`，不要假设系统 PATH 一定有 Python。

## Payload 规则

- 先执行 `prepare`，使用脚本生成的 `report_payload.json` skeleton 和槽位快照。
- 按槽位 `name` 填充：标题、文件编号、版本、人员、设计目的、技术交底、方案说明、变更历程等分别来自本地任务字段、模板元数据、参数计算结果和 NX 工具证据。
- 图片槽位使用 `image_paths` 中的真实图片路径，图片应来自 NX 视图切换和截图/导出工具。
- 先执行 `validate`，只有 `ok: true` 才能执行 `generate`。
- 只有 `generate` 返回 `ok: true` 且 `remaining_raw_slot_count == 0`，才能说明 DOCX 报告生成完成。

## 禁止事项

- 禁止从 MySQL、Teamcenter、桌面路径、NX 安装目录或 workspace 中猜测报告模板路径。
- 禁止修改模板结构来绕过槽位校验。
- 禁止把缺证据、工具失败或未执行步骤写成已完成。
- 禁止将旧版 report 工具或 markdown 报告作为正式设计说明书。
