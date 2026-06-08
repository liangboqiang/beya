import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type McDesignComponent = 'conrod' | 'crankshaft' | 'camshaft'

export type McDesignTask = {
  id: string
  source: string
  title: string
  projectCode: string
  projectName: string
  component: McDesignComponent
  owner: string
  status: string
  requirementText: string
  explicitParameters: Record<string, number | string>
  performanceParameters?: Record<string, number | string>
  sourceFields?: Record<string, string | number | boolean>
  processPersonnel?: Record<string, string>
  attachments: string[]
}

export type McDesignTemplate = {
  id: string
  folderName: string
  itemId: string
  revisionId: string
  name: string
  component: McDesignComponent
  partFamily: string
  datasetName: string
  localFolderPath?: string | null
  localPartPath?: string | null
  localDrawingTemplatePath?: string | null
  classificationAttributes: Record<string, string | number>
  nominalParameters?: Record<string, number | string>
  nxDriveParameters: string[]
  requiredNxMappings?: string[]
  optionalNxMappings?: string[]
  evidence: string
}

export type McDesignKnowledgeEntry = {
  id: string
  component: McDesignComponent
  category:
    | 'parameter_dictionary'
    | 'experience_formula'
    | 'check_rule'
    | 'default_value'
  paramId?: string
  standardName: string
  aliases: string[]
  unit?: string
  formula?: string
  physicalMeaning?: string
  rule?: string
  source: string
}

export const MC_DESIGN_LOCAL_SOURCE = 'local_fixture'
export const MC_DESIGN_RUNTIME_ROOT = 'runtime/mc-design'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(MODULE_DIR, '../../..')

export const MC_DESIGN_TASKS: McDesignTask[] = loadKnowledgeFile(
  'tasks.json',
  fallbackTasks(),
)

export const MC_DESIGN_TEMPLATES: McDesignTemplate[] = loadKnowledgeFile(
  'templates.json',
  fallbackTemplates(),
)

export const MC_DESIGN_KNOWLEDGE: McDesignKnowledgeEntry[] = loadKnowledgeFile(
  'knowledge.json',
  fallbackKnowledge(),
)

export function getMcDesignTask(taskId: string | undefined): McDesignTask | undefined {
  if (!taskId) return undefined
  return MC_DESIGN_TASKS.find(task => task.id === taskId)
}

export function getMcDesignTemplate(
  templateId: string | undefined,
): McDesignTemplate | undefined {
  if (!templateId) return undefined
  return MC_DESIGN_TEMPLATES.find(template => template.id === templateId)
}

function loadKnowledgeFile<T>(filename: string, fallback: T[]): T[] {
  const filePath = resolve(PROJECT_ROOT, MC_DESIGN_RUNTIME_ROOT, 'knowledge', filename)
  if (!existsSync(filePath)) return fallback
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    return Array.isArray(parsed) ? parsed as T[] : fallback
  } catch {
    return fallback
  }
}

function fallbackTasks(): McDesignTask[] {
  return [
    task('MC-TASK-CONROD-001', 'ipm', 'Conrod parameter design baseline', 'conrod', {
      body_height_mm: 198,
      head_gasket_thickness_mm: 1.2,
      compression_clearance_mm: 0.8,
      piston_compression_height_mm: 32,
      rod_journal_diameter_mm: 48,
      piston_pin_diameter_mm: 22,
      rod_bearing_thickness_mm: 1.6,
      crank_radius_mm: 43,
      stroke_mm: 86,
      bore_mm: 92,
      small_end_bushing_thickness_mm: 1.8,
    }),
    task('MC-TASK-CONROD-002', 'ecs', 'Lightweight conrod update', 'conrod', {
      body_height_mm: 190,
      rod_journal_diameter_mm: 46,
      piston_pin_diameter_mm: 21,
      stroke_mm: 82,
      bore_mm: 88,
    }, { mass_limit_g: 560, fatigue_life_cycles: 10000000 }),
    task('MC-TASK-CONROD-003', 'tc', 'Conrod drawing template refresh', 'conrod', {
      body_height_mm: 201,
      rod_journal_diameter_mm: 50,
      piston_pin_diameter_mm: 23,
    }),
    task('MC-TASK-CRANK-001', 'qpp', 'Crankshaft torque design', 'crankshaft', {
      bore_mm: 92,
      stroke_mm: 86,
      cylinder_count: 4,
    }, { max_torque_nm: 320, torsional_safety_factor: 1.6 }),
    task('MC-TASK-CRANK-002', 'ecr', 'Crankshaft journal update', 'crankshaft', {
      bore_mm: 88,
      stroke_mm: 82,
      cylinder_count: 4,
      main_journal_diameter_mm: 58,
      rod_journal_diameter_mm: 48,
    }),
    task('MC-TASK-CRANK-003', 'tc', 'Crankshaft comparison case', 'crankshaft', {
      bore_mm: 95,
      stroke_mm: 90,
      cylinder_count: 6,
    }),
    task('MC-TASK-CAM-001', 'ipm', 'Camshaft lift design', 'camshaft', {
      cam_lift_mm: 8.8,
      base_circle_diameter_mm: 32,
      valve_duration_deg: 248,
      valve_count: 16,
      shaft_journal_diameter_mm: 28,
      cam_lobe_width_mm: 14,
    }),
    task('MC-TASK-CAM-002', 'qpp', 'Camshaft duration optimization', 'camshaft', {
      cam_lift_mm: 9.2,
      base_circle_diameter_mm: 34,
      valve_duration_deg: 260,
      valve_count: 16,
      shaft_journal_diameter_mm: 30,
      cam_lobe_width_mm: 15,
    }, { volumetric_efficiency_target: 0.92 }),
    task('MC-TASK-CAM-003', 'ecs', 'Camshaft local verification', 'camshaft', {
      cam_lift_mm: 8.2,
      base_circle_diameter_mm: 31,
      valve_duration_deg: 240,
      valve_count: 12,
      shaft_journal_diameter_mm: 27,
      cam_lobe_width_mm: 13,
    }),
    task('MC-TASK-MIXED-001', 'local', 'Template retrieval demo', 'conrod', {
      bore_mm: 90,
      stroke_mm: 84,
    }),
  ]
}

function task(
  id: string,
  source: string,
  title: string,
  component: McDesignComponent,
  explicitParameters: Record<string, number | string>,
  performanceParameters?: Record<string, number | string>,
): McDesignTask {
  return {
    id,
    source,
    title,
    projectCode: 'MC-DESIGN',
    projectName: 'Local component design',
    component,
    owner: 'local-engineer',
    status: 'open',
    requirementText: `${title}; execute locally with template-based parameter modelling.`,
    explicitParameters,
    performanceParameters,
    sourceFields: {
      item_id: id,
      item_revision_id: 'A',
      change_reason: 'local design verification',
    },
    processPersonnel: {
      designer: 'local-engineer',
      reviewer: 'local-reviewer',
      approver: 'local-approver',
    },
    attachments: [],
  }
}

function fallbackTemplates(): McDesignTemplate[] {
  return [
    template('TC-TPL-CONROD-A', 'conrod', 'K08_1004201_21_conrod_body_A', 'A', {
      body_height_mm: 198,
      rod_journal_diameter_mm: 48,
      piston_pin_diameter_mm: 22,
      bore_mm: 92,
      stroke_mm: 86,
    }),
    template('TC-TPL-CONROD-B', 'conrod', 'K08_1004201_22_conrod_body_B', 'B', {
      body_height_mm: 190,
      rod_journal_diameter_mm: 46,
      piston_pin_diameter_mm: 21,
      bore_mm: 88,
      stroke_mm: 82,
    }),
    template('TC-TPL-CONROD-C', 'conrod', 'K08_1004201_23_conrod_body_C', 'C', {
      body_height_mm: 205,
      rod_journal_diameter_mm: 52,
      piston_pin_diameter_mm: 24,
      bore_mm: 96,
      stroke_mm: 90,
    }),
    template('TC-TPL-CRANK-A', 'crankshaft', 'K08_1005010_11_crankshaft_A', 'A', {
      bore_mm: 92,
      stroke_mm: 86,
      cylinder_count: 4,
      main_journal_diameter_mm: 58,
      rod_journal_diameter_mm: 48,
    }),
    template('TC-TPL-CRANK-B', 'crankshaft', 'K08_1005010_12_crankshaft_B', 'B', {
      bore_mm: 88,
      stroke_mm: 82,
      cylinder_count: 4,
      main_journal_diameter_mm: 56,
      rod_journal_diameter_mm: 46,
    }),
    template('TC-TPL-CRANK-C', 'crankshaft', 'K08_1005010_13_crankshaft_C', 'C', {
      bore_mm: 95,
      stroke_mm: 90,
      cylinder_count: 6,
      main_journal_diameter_mm: 62,
      rod_journal_diameter_mm: 52,
    }),
    template('TC-TPL-CAM-A', 'camshaft', 'K08_1006010_31_camshaft_A', 'A', {
      cam_lift_mm: 8.8,
      base_circle_diameter_mm: 32,
      valve_duration_deg: 248,
      valve_count: 16,
      shaft_journal_diameter_mm: 28,
      cam_lobe_width_mm: 14,
    }),
    template('TC-TPL-CAM-B', 'camshaft', 'K08_1006010_32_camshaft_B', 'B', {
      cam_lift_mm: 9.2,
      base_circle_diameter_mm: 34,
      valve_duration_deg: 260,
      valve_count: 16,
      shaft_journal_diameter_mm: 30,
      cam_lobe_width_mm: 15,
    }),
    template('TC-TPL-CAM-C', 'camshaft', 'K08_1006010_33_camshaft_C', 'C', {
      cam_lift_mm: 8.2,
      base_circle_diameter_mm: 31,
      valve_duration_deg: 240,
      valve_count: 12,
      shaft_journal_diameter_mm: 27,
      cam_lobe_width_mm: 13,
    }),
    template('TC-TPL-CONROD-D', 'conrod', 'K08_1004201_24_conrod_body_D', 'D', {
      body_height_mm: 196,
      rod_journal_diameter_mm: 49,
      piston_pin_diameter_mm: 22,
      bore_mm: 90,
      stroke_mm: 84,
    }),
  ]
}

function template(
  id: string,
  component: McDesignComponent,
  itemId: string,
  revisionId: string,
  nominalParameters: Record<string, number | string>,
): McDesignTemplate {
  const family = component === 'conrod'
    ? 'connecting_rod'
    : component === 'crankshaft'
      ? 'crankshaft'
      : 'camshaft'
  return {
    id,
    folderName: id,
    itemId,
    revisionId,
    name: `${component} local parameterized template ${revisionId}`,
    component,
    partFamily: family,
    datasetName: `${itemId}.prt`,
    localFolderPath: `${MC_DESIGN_RUNTIME_ROOT}/dependencies/templates/${id}`,
    localPartPath: `${MC_DESIGN_RUNTIME_ROOT}/dependencies/templates/${id}/${itemId}.prt`,
    localDrawingTemplatePath: component === 'conrod'
      ? `${MC_DESIGN_RUNTIME_ROOT}/dependencies/templates/${id}/${itemId}_drawing.prt`
      : null,
    classificationAttributes: { component, family, revision: revisionId },
    nominalParameters,
    nxDriveParameters: Object.keys(nominalParameters),
    requiredNxMappings: Object.keys(nominalParameters),
    optionalNxMappings: [],
    evidence: 'built-in fallback fixture',
  }
}

function fallbackKnowledge(): McDesignKnowledgeEntry[] {
  return [
    knowledge('KN-CONROD-001', 'conrod', 'parameter_dictionary', 'body_height_mm', 'Conrod body height', ['body height', 'body_height_mm'], 'mm', 'Controls conrod center distance and packaging.'),
    knowledge('KN-CONROD-002', 'conrod', 'experience_formula', 'rod_journal_diameter_mm', 'Rod journal diameter', ['rod journal', 'rod_journal_diameter_mm'], 'mm', 'Use bearing and load targets to size the big end journal.'),
    knowledge('KN-CRANK-001', 'crankshaft', 'parameter_dictionary', 'stroke_mm', 'Crankshaft stroke', ['stroke', 'stroke_mm'], 'mm', 'Stroke drives crank radius and displacement.'),
    knowledge('KN-CRANK-002', 'crankshaft', 'check_rule', 'torsional_safety_factor', 'Torsional safety factor', ['torsional safety', 'safety factor'], undefined, 'Keep above the project target before release.'),
    knowledge('KN-CAM-001', 'camshaft', 'parameter_dictionary', 'cam_lift_mm', 'Cam lift', ['cam lift', 'cam_lift_mm'], 'mm', 'Lift and duration define valve event performance.'),
    knowledge('KN-CAM-002', 'camshaft', 'check_rule', 'valve_duration_deg', 'Valve duration', ['duration', 'valve_duration_deg'], 'deg', 'Duration must match target speed and emissions constraints.'),
  ]
}

function knowledge(
  id: string,
  component: McDesignComponent,
  category: McDesignKnowledgeEntry['category'],
  paramId: string,
  standardName: string,
  aliases: string[],
  unit: string | undefined,
  physicalMeaning: string,
): McDesignKnowledgeEntry {
  return {
    id,
    component,
    category,
    paramId,
    standardName,
    aliases,
    unit,
    physicalMeaning,
    rule: category === 'check_rule' ? physicalMeaning : undefined,
    formula: category === 'experience_formula' ? physicalMeaning : undefined,
    source: 'built-in fallback fixture',
  }
}
