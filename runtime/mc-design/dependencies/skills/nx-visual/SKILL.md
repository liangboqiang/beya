---
name: nx-visual
description: NX 视图与截图技能
capabilities:
  - tool.nx.health
  - tool.nx.query
  - tool.nx.visual
---

# NX 视图与截图技能

## 适用场景

用于切换视图、适配视图、设置显示样式、导出当前视图图片或生成设计报告插图。

## 推荐流程

1. 调用 `nx_get_work_part_info` 确认当前零件。
2. 调用 `nx_get_all_view_names` 获取真实视图名称。
3. 按用户意图调用 `nx_switch_view`、`nx_rotate_and_scale_view`、`nx_fit_view` 或 `nx_set_view_style`。
4. 需要保存图片时，先确认保存路径，再调用 `nx_create_image`。当前 NXServer 通过 `filePath` 后缀决定格式，不提供独立 `format` 参数。
5. 如果图片用于设计报告，后续交给 `design-report` 的 image 槽位处理。

## 禁止事项

- 禁止猜测视图名称。
- 禁止声明支持当前 NXServer 未暴露的 snapshot/list/export/smooth-switch 能力。
- 禁止在用户未确认保存位置时导出覆盖性图片。
