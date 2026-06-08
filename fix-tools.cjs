const fs = require('fs');
const file = 'f:/Documents/beya/src/server/services/mcDesignLocalTools.ts';
let content = fs.readFileSync(file, 'utf8');

// Fix similar_item_id section
content = content.replace(
  /return stringValue\(sourceFields\.similar_item_id\)\s*\n\s*\n\s*\n\s*\[template\s*\n\.itemId,\s*template\s*\n\.name,\s*template\s*\n\.revisionId\]/g,
  'return stringValue(sourceFields.similar_item_id)\n      ?? [template?.itemId, template?.name, template?.revisionId]'
);

// Fix design purpose section
content = content.replace(
  /return \[\s*\n\s*task\s*\n\.title,\s*\n\s*task\s*\n\.requirementText,/g,
  'return [\n      task?.title,\n      task?.requirementText,'
);
content = content.replace(
  /formatPerformanceParameters\(task\s*\n\.performanceParameters\)/g,
  'formatPerformanceParameters(task?.performanceParameters)'
);

// Fix 技术依据 section - corrupted Chinese (use regex to match whatever is there)
content = content.replace(
  /if \(name === `技术依`\s*\n\) \{/g,
  'if (name === `技术依据`) {'
);
content = content.replace(
  /`方案：基`\s*\n\{template\s*\n\.name\s*\n\s*\n\s*`local_parametric_template`\}/g,
  '`方案：基于${template?.name ?? `local_parametric_template`}'
);
content = content.replace(
  /`理由`\s*\n\{task\s*\n\.requirementText\s*\n\s*\n\s*`用户要求本地模板化设`\s*\n\}/g,
  '`理由：${task?.requirementText ?? `用户要求本地模板化设计`}'
);
content = content.replace(
  /`关键参数`\s*\n\{parameterSummary\}/g,
  '`关键参数：${parameterSummary}'
);

// Fix 方案说明 section
content = content.replace(
  /`模板`\s*\n\{template\s*\n\.id\s*\n\s*\n\s*`未记`\}，数据集`\s*\n\{template\s*\n\.datasetName\s*\n\s*\n\s*`\}/g,
  '`模板：${template?.id ?? `未记录`}，数据集：${template?.datasetName ?? ``}'
);
content = content.replace(
  /formatReportParameters\(template\s*\n\.nominalParameters\s*\n\s*\n\s*\{\}\)/g,
  'formatReportParameters(template?.nominalParameters ?? {})'
);
content = content.replace(
  /`NX证据`\s*\n\{context\.nxArtifactPath\s*\n\s*\n\s*`参数写入或截图证据需由NX工具结果提供`\}/g,
  '`NX证据：${context.nxArtifactPath ?? `参数写入或截图证据需由NX工具结果提供`}'
);

// Fix 版本图号
content = content.replace(
  /return \[template\s*\n\.itemId,\s*template\s*\n\.revisionId\]\.filter\(Boolean\)\.join\(`\/`\)/g,
  'return [template?.itemId, template?.revisionId].filter(Boolean).join(`/`)'
);

// Fix 更改原因
content = content.replace(
  /return stringValue\(sourceFields\.change_reason\)\s*\n\s*\n\s*\n\s*\(task\s*\n\.source === `ecr`\s*\n\s*`优化设计`\s*:\s*`新设`\)/g,
  'return stringValue(sourceFields.change_reason)\n      ?? (task?.source === `ecr` ? `优化设计` : `新设`)'
);

// Fix 设计原型图号
content = content.replace(
  /return stringValue\(sourceFields\.prototype_item_id\)\s*\n\s*\n\s*\n\s*stringValue\(sourceFields\.baseline_item_id\)\s*\n\s*\n\s*\n\s*template\s*\n\.itemId\s*\n\s*\n\s*\n\s*`/g,
  'return stringValue(sourceFields.prototype_item_id)\n      ?? stringValue(sourceFields.baseline_item_id)\n      ?? template?.itemId\n      ?? ``'
);

// Fix 新图版本
content = content.replace(
  /return \[\s*\n\s*template\s*\n\.itemId\s*\n\s*\n\s*stringValue\(sourceFields\.affected_item_id\),\s*\n\s*stringValue\(sourceFields\.target_revision\)\s*\n\s*\n\s*template\s*\n\.revisionId,\s*\n\s*parameterSummary\s*\n\s*\n\s*`变更点：\$\{parameterSummary\}`\s*:\s*undefined,/g,
  'return [\n      template?.itemId ?? stringValue(sourceFields.affected_item_id),\n      stringValue(sourceFields.target_revision) ?? template?.revisionId,\n      parameterSummary ? `变更点：${parameterSummary}` : undefined,'
);

// Fix return at end of function
content = content.replace(
  /return parameterSummary \|\| task\s*\n\.requirementText \|\| `/g,
  'return parameterSummary || task?.requirementText || ``'
);

// Fix reportSlotName function
content = content.replace(
  /return \/name:\(\[\^,\]\]\+\)\/\.exec\(slotName\)\s*\n\.\[1\]\s*\n\.trim\(\)/g,
  'return /name:([^,\]]+)/.exec(slotName)?.[1]?.trim()'
);

// Fix imagePathForReportSlot function
content = content.replace(
  /return stringValue\(imagePaths\[slotName\]\)\s*\n\s*\n\s*\n\s*stringValue\(imagePaths\[String\(imageIndex\)\]\)\s*\n\s*\n\s*\n\s*stringValue\(imagePaths\[`image_\$\{imageIndex \+ 1\}`\]\)/g,
  'return stringValue(imagePaths[slotName])\n    ?? stringValue(imagePaths[String(imageIndex)])\n    ?? stringValue(imagePaths[`image_${imageIndex + 1}`])'
);

// Fix stringifyReportValue empty return
content = content.replace(
  /if \(value === null \|\| value === undefined\) return `/g,
  'if (value === null || value === undefined) return ``'
);

// Fix componentChineseName to return proper Chinese names
content = content.replace(
  /if \(component === 'conrod'\) return 'conrod'/g,
  'if (component === "conrod") return "连杆"'
);
content = content.replace(
  /if \(component === 'crankshaft'\) return 'crankshaft'/g,
  'if (component === "crankshaft") return "曲轴"'
);
content = content.replace(
  /return `camshaft`/g,
  'return "凸轮轴"'
);

fs.writeFileSync(file, content, 'utf8');
console.log('Done with second batch');