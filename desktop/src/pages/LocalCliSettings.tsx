import { useEffect, useMemo, useState } from 'react'
import { Button } from '../components/shared/Button'
import { Input } from '../components/shared/Input'
import { Modal } from '../components/shared/Modal'
import { ModelCandidateInput, type ModelCandidate } from '../components/controls/ModelCandidateInput'
import { useTranslation, type TranslationKey } from '../i18n'
import { useLocalCliStore } from '../stores/localCliStore'
import type {
  LocalCliModelContextWindows,
  LocalCliModelRoles,
  LocalCliRuntimeInfo,
  LocalCliTestResult,
  UpdateLocalCliRuntimeInput,
} from '../types/localCli'

const MODEL_CONTEXT_WINDOW_MIN = 16000
const MODEL_CONTEXT_WINDOW_MAX = 10000000
const MODEL_ROLE_SLOTS = ['primary', 'fast', 'balanced', 'powerful'] as const
type ModelRoleSlot = typeof MODEL_ROLE_SLOTS[number]
type ModelContextInputs = Record<ModelRoleSlot, string>

const EMPTY_MODEL_ROLES: LocalCliModelRoles = {
  primary: '',
  fast: '',
  balanced: '',
  powerful: '',
}

function formatContextWindow(value: number): string {
  return value.toLocaleString('en-US')
}

function normalizeModelRoles(modelRoles: LocalCliModelRoles): LocalCliModelRoles {
  const primary = modelRoles.primary.trim()
  return {
    primary,
    fast: modelRoles.fast.trim() || primary,
    balanced: modelRoles.balanced.trim() || primary,
    powerful: modelRoles.powerful.trim() || primary,
  }
}

function getLocalCliModelRoles(cli: LocalCliRuntimeInfo): LocalCliModelRoles {
  return normalizeModelRoles(cli.modelRoles ?? EMPTY_MODEL_ROLES)
}

function parseContextWindowInput(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed)) return undefined
  if (parsed < MODEL_CONTEXT_WINDOW_MIN || parsed > MODEL_CONTEXT_WINDOW_MAX) return undefined
  return parsed
}

function getContextWindowErrorKey(value: string): 'number' | 'range' | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed)) return 'number'
  if (parsed < MODEL_CONTEXT_WINDOW_MIN || parsed > MODEL_CONTEXT_WINDOW_MAX) return 'range'
  return null
}

function buildContextInputs(cli: LocalCliRuntimeInfo, modelRoles: LocalCliModelRoles): ModelContextInputs {
  return MODEL_ROLE_SLOTS.reduce((result, slot) => {
    const model = modelRoles[slot]?.trim()
    result[slot] = model && cli.modelContextWindows?.[model]
      ? String(cli.modelContextWindows[model])
      : ''
    return result
  }, {} as ModelContextInputs)
}

function buildModelContextWindows(
  modelRoles: LocalCliModelRoles,
  inputs: ModelContextInputs,
): LocalCliModelContextWindows {
  const result: LocalCliModelContextWindows = {}
  for (const slot of MODEL_ROLE_SLOTS) {
    const model = modelRoles[slot]?.trim()
    const window = parseContextWindowInput(inputs[slot])
    if (model && window !== undefined) {
      result[model] = window
    }
  }
  return result
}

function getLocalCliModelCandidates(cli: LocalCliRuntimeInfo): ModelCandidate[] {
  return cli.models.map((model) => ({
    id: model.id,
    label: model.label,
  }))
}

function roleLabelKey(slot: ModelRoleSlot): TranslationKey {
  switch (slot) {
    case 'primary':
      return 'settings.providers.primaryModel'
    case 'fast':
      return 'settings.providers.fastModel'
    case 'balanced':
      return 'settings.providers.balancedModel'
    case 'powerful':
      return 'settings.providers.powerfulModel'
  }
}

function contextLabelKey(slot: ModelRoleSlot): TranslationKey {
  switch (slot) {
    case 'primary':
      return 'settings.providers.primaryContextWindow'
    case 'fast':
      return 'settings.providers.fastContextWindow'
    case 'balanced':
      return 'settings.providers.balancedContextWindow'
    case 'powerful':
      return 'settings.providers.powerfulContextWindow'
  }
}

export function LocalCliSettings() {
  const t = useTranslation()
  const {
    clis,
    activeId,
    isLoading,
    isSaving,
    error,
    fetchClis,
    rescanClis,
    updateCliConfig,
    testCli,
  } = useLocalCliStore()
  const [editingCli, setEditingCli] = useState<LocalCliRuntimeInfo | null>(null)
  const [testStates, setTestStates] = useState<Record<string, { loading: boolean; result?: LocalCliTestResult }>>({})

  useEffect(() => {
    void fetchClis()
  }, [fetchClis])

  const availableClis = useMemo(
    () => clis.filter((cli) => cli.available),
    [clis],
  )

  const handleTest = async (id: string) => {
    setTestStates((current) => ({
      ...current,
      [id]: { loading: true, result: current[id]?.result },
    }))
    const result = await testCli(id)
    setTestStates((current) => ({
      ...current,
      [id]: { loading: false, result },
    }))
  }

  return (
    <section data-testid="local-cli-settings" className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border-separator)] px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('settings.localCli.title')}</h2>
          <p className="mt-0.5 max-w-2xl text-sm text-[var(--color-text-tertiary)]">{t('settings.localCli.description')}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void rescanClis()} loading={isLoading}>
          <span className="material-symbols-outlined text-[16px]">refresh</span>
          {t('settings.localCli.rescan')}
        </Button>
      </div>

      <div className="space-y-2 p-4">
        {error && (
          <div className="rounded-lg border border-[var(--color-error)]/25 bg-[var(--color-error)]/8 px-3 py-2 text-sm text-[var(--color-error)]">
            {error}
          </div>
        )}

        {isLoading && availableClis.length === 0 ? (
          <div className="flex items-center justify-center py-6">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-brand)] border-t-transparent" />
          </div>
        ) : availableClis.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] px-4 py-6 text-sm text-[var(--color-text-tertiary)]">
            {t('settings.localCli.noAvailable')}
          </div>
        ) : (
          availableClis.map((cli) => (
            <LocalCliCard
              key={cli.id}
              cli={cli}
              active={activeId === cli.id}
              saving={isSaving}
              testing={Boolean(testStates[cli.id]?.loading)}
              testResult={testStates[cli.id]?.result}
              onEdit={() => setEditingCli(cli)}
              onTest={() => void handleTest(cli.id)}
            />
          ))
        )}
      </div>

      {editingCli && (
        <LocalCliEditModal
          cli={editingCli}
          open={Boolean(editingCli)}
          saving={isSaving}
          onClose={() => setEditingCli(null)}
          onSave={async (input) => {
            await updateCliConfig(editingCli.id, input)
            setEditingCli(null)
          }}
        />
      )}
    </section>
  )
}

function LocalCliCard({
  cli,
  active,
  saving,
  testing,
  testResult,
  onEdit,
  onTest,
}: {
  cli: LocalCliRuntimeInfo
  active: boolean
  saving: boolean
  testing: boolean
  testResult?: LocalCliTestResult
  onEdit: () => void
  onTest: () => void
}) {
  const t = useTranslation()
  const modelRoles = getLocalCliModelRoles(cli)
  const modelSummary = modelRoles.primary || t('settings.localCli.defaultModel')
  const modelCount = cli.models?.length ?? 0

  return (
    <div
      data-testid={`local-cli-card-${cli.id}`}
      className={`rounded-xl border px-4 py-3.5 transition-colors ${
        active
          ? 'border-[var(--color-brand)] bg-[var(--color-surface-container)] shadow-[var(--shadow-focus-ring)]'
          : 'border-[var(--color-border)] bg-[var(--color-surface)]'
      }`}
    >
      <div className="flex items-start gap-4">
        <span className={`mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${
          active ? 'bg-[var(--color-success)]' : 'bg-[var(--color-brand)]'
        }`} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">{cli.displayName}</span>
            {active && (
              <span className="rounded bg-[var(--color-success)]/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--color-success)]">
                {t('settings.localCli.active')}
              </span>
            )}
            {cli.version && (
              <span className="rounded bg-[var(--color-surface-container-high)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--color-text-tertiary)]">
                {cli.version}
              </span>
            )}
          </div>

          <div className="mt-2 grid gap-2 text-xs text-[var(--color-text-tertiary)] sm:grid-cols-2">
            <div className="rounded-lg bg-[var(--color-surface-container-low)] px-3 py-2">
              <span className="block font-medium text-[var(--color-text-secondary)]">
                {t('settings.localCli.modelMapping')}
              </span>
              <span className="mt-0.5 block truncate font-mono text-[var(--color-text-primary)]">
                {modelSummary}
              </span>
            </div>
            <div className="rounded-lg bg-[var(--color-surface-container-low)] px-3 py-2">
              <span className="block font-medium text-[var(--color-text-secondary)]">
                {t('settings.localCli.modelSource')}
              </span>
              <span className="mt-0.5 block text-[var(--color-text-primary)]">
                {modelCount > 1
                  ? t('settings.localCli.detectedModels', { count: String(modelCount) })
                  : t('settings.localCli.defaultModel')}
              </span>
            </div>
          </div>

          {testResult && (
            <div
              data-testid={`local-cli-test-result-${cli.id}`}
              className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                testResult.success
                  ? 'border-[var(--color-success)]/25 bg-[var(--color-success)]/8 text-[var(--color-success)]'
                  : 'border-[var(--color-error)]/25 bg-[var(--color-error)]/8 text-[var(--color-error)]'
              }`}
            >
              {testResult.success
                ? t('settings.localCli.testOk', {
                    latency: String(testResult.latencyMs),
                    version: testResult.version || t('settings.localCli.versionUnknown'),
                  })
                : t('settings.localCli.testFailed', {
                    error: testResult.error || t('settings.localCli.testUnknownError'),
                  })}
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center gap-1">
          <Button
            data-testid={`local-cli-test-${cli.id}`}
            size="sm"
            variant="ghost"
            disabled={saving || testing}
            loading={testing}
            onClick={onTest}
          >
            {t('settings.localCli.test')}
          </Button>
          <Button
            data-testid={`local-cli-edit-${cli.id}`}
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={onEdit}
          >
            {t('settings.localCli.edit')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function LocalCliEditModal({
  cli,
  open,
  saving,
  onClose,
  onSave,
}: {
  cli: LocalCliRuntimeInfo
  open: boolean
  saving: boolean
  onClose: () => void
  onSave: (input: UpdateLocalCliRuntimeInput) => Promise<void>
}) {
  const t = useTranslation()
  const initialRoles = useMemo(() => getLocalCliModelRoles(cli), [cli])
  const [modelRoles, setModelRoles] = useState<LocalCliModelRoles>(initialRoles)
  const [contextInputs, setContextInputs] = useState<ModelContextInputs>(() => buildContextInputs(cli, initialRoles))
  const [autoCompactWindow, setAutoCompactWindow] = useState(
    cli.autoCompactWindow ? String(cli.autoCompactWindow) : '',
  )
  const [showContextSettings, setShowContextSettings] = useState(false)
  const modelCandidates = useMemo(() => getLocalCliModelCandidates(cli), [cli])

  useEffect(() => {
    const nextRoles = getLocalCliModelRoles(cli)
    setModelRoles(nextRoles)
    setContextInputs(buildContextInputs(cli, nextRoles))
    setAutoCompactWindow(cli.autoCompactWindow ? String(cli.autoCompactWindow) : '')
    setShowContextSettings(false)
  }, [cli])

  const autoCompactWindowErrorKey = getContextWindowErrorKey(autoCompactWindow)
  const modelContextWindowErrorSlots = MODEL_ROLE_SLOTS.filter((slot) => getContextWindowErrorKey(contextInputs[slot]))
  const canSubmit =
    Boolean(modelRoles.primary.trim()) &&
    !autoCompactWindowErrorKey &&
    modelContextWindowErrorSlots.length === 0
  const configuredContextWindows = buildModelContextWindows(modelRoles, contextInputs)
  const contextSummary = Object.entries(configuredContextWindows).length > 0
    ? Object.entries(configuredContextWindows)
        .map(([model, value]) => `${model}: ${formatContextWindow(value)}`)
        .join(' / ')
    : t('settings.providers.contextSummaryAuto')
  const shouldShowContextFields =
    showContextSettings ||
    Boolean(autoCompactWindowErrorKey) ||
    modelContextWindowErrorSlots.length > 0

  const handleModelRoleChange = (slot: ModelRoleSlot, value: string) => {
    const nextRoles = { ...modelRoles, [slot]: value }
    setModelRoles(nextRoles)
    const nextModel = value.trim()
    setContextInputs((current) => ({
      ...current,
      [slot]: nextModel && cli.modelContextWindows?.[nextModel]
        ? String(cli.modelContextWindows[nextModel])
        : current[slot],
    }))
  }

  const handleSave = async () => {
    if (!canSubmit) return
    const parsedAutoCompactWindow = parseContextWindowInput(autoCompactWindow)
    const parsedContextWindows = buildModelContextWindows(modelRoles, contextInputs)
    await onSave({
      modelRoles: normalizeModelRoles(modelRoles),
      autoCompactWindow: parsedAutoCompactWindow ?? null,
      modelContextWindows: Object.keys(parsedContextWindows).length > 0
        ? parsedContextWindows
        : null,
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('settings.localCli.editTitle')}
      width={640}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => void handleSave()} disabled={!canSubmit} loading={saving}>
            {t('common.save')}
          </Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2.5">
          <div className="text-sm font-semibold text-[var(--color-text-primary)]">{cli.displayName}</div>
          <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">
            {cli.models.length > 1
              ? t('settings.localCli.detectedModels', { count: String(cli.models.length) })
              : t('settings.localCli.defaultModel')}
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-[var(--color-text-primary)]">
            {t('settings.localCli.modelMapping')}
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {MODEL_ROLE_SLOTS.map((slot) => (
              <div key={slot}>
                <ModelCandidateInput
                  label={t(roleLabelKey(slot))}
                  testId={`local-cli-model-${cli.id}-${slot}`}
                  required={slot === 'primary'}
                  value={modelRoles[slot]}
                  onChange={(value) => handleModelRoleChange(slot, value)}
                  placeholder={slot === 'primary'
                    ? t('settings.providers.modelIdPlaceholder')
                    : t('settings.providers.sameAsPrimary')}
                  candidates={modelCandidates}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)]">
          <button
            type="button"
            onClick={() => setShowContextSettings((visible) => !visible)}
            className="flex w-full items-start gap-3 px-3 py-3 text-left outline-none transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:shadow-[var(--shadow-focus-ring)]"
            aria-expanded={shouldShowContextFields}
          >
            <span className="material-symbols-outlined mt-0.5 text-[18px] text-[var(--color-brand)]">compress</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-[var(--color-text-primary)]">
                {t('settings.providers.contextSettingsTitle')}
              </span>
              <span className="mt-1 block truncate text-xs text-[var(--color-text-secondary)]">
                {contextSummary}
              </span>
              <span className="mt-1 block text-[11px] leading-5 text-[var(--color-text-tertiary)]">
                {t('settings.providers.contextSettingsDesc')}
              </span>
            </span>
            <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand)]">
              {shouldShowContextFields
                ? t('settings.providers.contextSettingsHide')
                : t('settings.providers.contextSettingsEdit')}
              <span className="material-symbols-outlined text-[16px]">
                {shouldShowContextFields ? 'expand_less' : 'expand_more'}
              </span>
            </span>
          </button>

          {shouldShowContextFields && (
            <div className="border-t border-[var(--color-border)] px-3 pb-3 pt-3">
              <div>
                <label className="mb-2 block text-sm font-medium text-[var(--color-text-primary)]">
                  {t('settings.providers.modelContextWindows')}
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {MODEL_ROLE_SLOTS.map((slot) => {
                    const errorKey = getContextWindowErrorKey(contextInputs[slot])
                    return (
                      <div key={slot}>
                        <Input
                          label={t(contextLabelKey(slot))}
                          data-testid={`local-cli-context-${cli.id}-${slot}`}
                          value={contextInputs[slot]}
                          onChange={(event) => {
                            const value = event.target.value
                            setContextInputs((current) => ({ ...current, [slot]: value }))
                          }}
                          placeholder={t('settings.providers.contextWindowPlaceholder')}
                        />
                        {errorKey && (
                          <p className="mt-1 text-[11px] text-[var(--color-error)]">
                            {errorKey === 'number'
                              ? t('settings.providers.modelContextWindowNumberError')
                              : t('settings.providers.modelContextWindowRangeError')}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
                <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
                  {t('settings.providers.modelContextWindowsDesc')}
                </p>
              </div>

              <div className="mt-3">
                <Input
                  label={t('settings.providers.autoCompactWindow')}
                  data-testid={`local-cli-auto-compact-${cli.id}`}
                  value={autoCompactWindow}
                  onChange={(event) => setAutoCompactWindow(event.target.value)}
                  placeholder={t('settings.providers.autoCompactWindowPlaceholder')}
                />
                {autoCompactWindowErrorKey ? (
                  <p className="mt-1 text-[11px] text-[var(--color-error)]">
                    {autoCompactWindowErrorKey === 'number'
                      ? t('settings.providers.autoCompactWindowNumberError')
                      : t('settings.providers.autoCompactWindowRangeError')}
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
                    {t('settings.providers.autoCompactWindowDesc')}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
