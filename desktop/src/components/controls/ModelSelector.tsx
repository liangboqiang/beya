import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation, type TranslationKey } from '../../i18n'
import { useChatStore } from '../../stores/chatStore'
import { useProviderStore } from '../../stores/providerStore'
import { useLocalCliStore } from '../../stores/localCliStore'
import { DRAFT_RUNTIME_SELECTION_KEY, useSessionRuntimeStore } from '../../stores/sessionRuntimeStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { LocalCliRuntimeInfo } from '../../types/localCli'
import type { SavedProvider } from '../../types/provider'
import type { RuntimeSelection } from '../../types/runtime'
import type { EffortLevel, ModelInfo } from '../../types/settings'
import { useMobileViewport } from '../../hooks/useMobileViewport'
import { isTauriRuntime } from '../../lib/desktopRuntime'
import { MobileBottomSheet } from '../shared/MobileBottomSheet'
import { getProviderModelRoles } from '../../lib/modelRoles'

type RuntimeChoice = {
  kind: 'provider' | 'local_cli'
  id: string
  label: string
  detail: string
  modelId: string
  providerId: string | null
  localCliId: string | null
}

type Props = {
  value?: string
  onChange?: (modelId: string) => void
  runtimeSelection?: RuntimeSelection
  onRuntimeSelectionChange?: (selection: RuntimeSelection) => void
  runtimeKey?: string
  disabled?: boolean
  compact?: boolean
}

type DropdownPosition = {
  top: number | undefined
  bottom: number | undefined
  left: number
  width: number
  maxHeight: number
}

const DROPDOWN_WIDTH = 360
const DROPDOWN_GAP = 8
const VIEWPORT_MARGIN = 16
const DROPDOWN_MAX_HEIGHT = 420
const DROPDOWN_MIN_HEIGHT = 180

function getLocalizedModelDescription(
  model: ModelInfo,
  t: (key: TranslationKey) => string,
): string {
  const key = `model.description.${model.id}` as TranslationKey
  const translated = t(key)
  return translated === key ? model.description : translated
}

function getProviderPrimaryModel(provider: SavedProvider): string {
  return getProviderModelRoles(provider).primary
}

function getLocalCliPrimaryModel(cli: LocalCliRuntimeInfo): string {
  return cli.modelRoles?.primary?.trim() || cli.models?.[0]?.id || 'default'
}

function buildProviderChoices(providers: SavedProvider[]): RuntimeChoice[] {
  return providers
    .map((provider) => ({
      kind: 'provider' as const,
      id: provider.providerId,
      label: provider.displayName,
      detail: getProviderPrimaryModel(provider),
      modelId: getProviderPrimaryModel(provider),
      providerId: provider.providerId,
      localCliId: null,
    }))
    .filter((choice) => choice.modelId.trim())
}

function buildLocalCliChoices(clis: LocalCliRuntimeInfo[]): RuntimeChoice[] {
  return clis
    .filter((cli) => cli.available)
    .map((cli) => ({
      kind: 'local_cli' as const,
      id: cli.id,
      label: cli.displayName,
      detail: getLocalCliPrimaryModel(cli),
      modelId: getLocalCliPrimaryModel(cli),
      providerId: null,
      localCliId: cli.id,
    }))
}

function isSelectedChoice(selection: RuntimeSelection | null | undefined, choice: RuntimeChoice): boolean {
  if (!selection) return false
  const selectionKind = selection.kind ?? (selection.localCliId ? 'local_cli' : 'provider')
  if (selectionKind !== choice.kind) return false
  return choice.kind === 'local_cli'
    ? selection.localCliId === choice.localCliId
    : selection.providerId === choice.providerId
}

function findRuntimeChoice(
  selection: RuntimeSelection | null | undefined,
  choices: RuntimeChoice[],
): RuntimeChoice | null {
  return choices.find((choice) => isSelectedChoice(selection, choice)) ?? null
}

function selectionFromChoice(choice: RuntimeChoice, effortLevel?: EffortLevel): RuntimeSelection {
  return {
    kind: choice.kind,
    providerId: choice.providerId,
    localCliId: choice.localCliId,
    modelId: choice.modelId,
    ...(effortLevel ? { effortLevel } : {}),
  }
}

function resolveDefaultRuntimeSelection(
  executionMode: 'provider' | 'local_cli',
  activeProviderId: string | null,
  providers: SavedProvider[],
  activeLocalCliId: string | null,
  localClis: LocalCliRuntimeInfo[],
  currentModelId: string | undefined,
): RuntimeSelection {
  const providerChoices = buildProviderChoices(providers)
  const localCliChoices = buildLocalCliChoices(localClis)

  if (executionMode === 'local_cli') {
    const activeLocalCli = localCliChoices.find((choice) => choice.localCliId === activeLocalCliId)
    if (activeLocalCli) return selectionFromChoice(activeLocalCli)
    if (localCliChoices[0]) return selectionFromChoice(localCliChoices[0])
  }

  const activeProvider = providerChoices.find((choice) => choice.providerId === activeProviderId)
  if (activeProvider) return selectionFromChoice(activeProvider)
  if (providerChoices[0]) return selectionFromChoice(providerChoices[0])
  if (localCliChoices[0]) return selectionFromChoice(localCliChoices[0])

  return {
    kind: 'provider',
    providerId: null,
    localCliId: null,
    modelId: currentModelId ?? '',
  }
}

export function ModelSelector({
  value,
  onChange,
  runtimeSelection: controlledRuntimeSelection,
  onRuntimeSelectionChange,
  runtimeKey,
  disabled = false,
  compact = false,
}: Props = {}) {
  const t = useTranslation()
  const isMobileBrowser = useMobileViewport() && !isTauriRuntime()
  const {
    currentModel: storeModel,
    availableModels,
    effortLevel,
    executionMode,
    setModel,
  } = useSettingsStore()
  const {
    providers,
    activeId,
    isLoading: providersLoading,
    fetchProviders,
  } = useProviderStore()
  const {
    clis: localClis,
    activeId: activeLocalCliId,
    isLoading: localClisLoading,
    fetchClis,
  } = useLocalCliStore()
  const storedRuntimeSelection = useSessionRuntimeStore((state) =>
    runtimeKey ? state.selections[runtimeKey] : undefined,
  )
  const [open, setOpen] = useState(false)
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const requestedProvidersRef = useRef(false)
  const requestedLocalClisRef = useRef(false)

  const EFFORT_OPTIONS: { value: EffortLevel; label: string }[] = [
    { value: 'low', label: t('settings.general.effort.low') },
    { value: 'medium', label: t('settings.general.effort.medium') },
    { value: 'high', label: t('settings.general.effort.high') },
    { value: 'max', label: t('settings.general.effort.max') },
  ]

  const isControlled = value !== undefined
  const isRuntimeScoped =
    !isControlled &&
    (runtimeKey !== undefined || onRuntimeSelectionChange !== undefined)
  const canEditRuntimeEffort = runtimeKey !== undefined

  useEffect(() => {
    if (!isRuntimeScoped || providersLoading || requestedProvidersRef.current) return
    requestedProvidersRef.current = true
    void fetchProviders()
  }, [fetchProviders, isRuntimeScoped, providersLoading])

  useEffect(() => {
    if (!isRuntimeScoped || localClisLoading || requestedLocalClisRef.current) return
    requestedLocalClisRef.current = true
    void fetchClis()
  }, [fetchClis, isRuntimeScoped, localClisLoading])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        ref.current &&
        !ref.current.contains(target) &&
        !dropdownRef.current?.contains(target)
      ) {
        setOpen(false)
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [open])

  const updateDropdownPosition = useCallback(() => {
    const anchor = ref.current
    if (!anchor) return

    const rect = anchor.getBoundingClientRect()
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight
    const width = Math.min(DROPDOWN_WIDTH, Math.max(0, viewportWidth - VIEWPORT_MARGIN * 2))
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.right - width),
      Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN),
    )
    const spaceBelow = viewportHeight - rect.bottom - DROPDOWN_GAP - VIEWPORT_MARGIN
    const spaceAbove = rect.top - DROPDOWN_GAP - VIEWPORT_MARGIN
    const placeBelow = spaceBelow >= DROPDOWN_MIN_HEIGHT || spaceBelow >= spaceAbove
    const availableHeight = Math.max(
      DROPDOWN_MIN_HEIGHT,
      placeBelow ? spaceBelow : spaceAbove,
    )
    const maxHeight = Math.min(DROPDOWN_MAX_HEIGHT, availableHeight)

    setDropdownPosition({
      top: placeBelow ? rect.bottom + DROPDOWN_GAP : undefined,
      bottom: placeBelow ? undefined : (viewportHeight - rect.top + DROPDOWN_GAP),
      left,
      width,
      maxHeight,
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) {
      setDropdownPosition(null)
      return
    }
    updateDropdownPosition()
  }, [open, updateDropdownPosition])

  useEffect(() => {
    if (!open) return
    window.addEventListener('resize', updateDropdownPosition)
    window.addEventListener('scroll', updateDropdownPosition, true)
    return () => {
      window.removeEventListener('resize', updateDropdownPosition)
      window.removeEventListener('scroll', updateDropdownPosition, true)
    }
  }, [open, updateDropdownPosition])

  const providerChoices = useMemo(() => buildProviderChoices(providers), [providers])
  const localCliChoices = useMemo(() => buildLocalCliChoices(localClis), [localClis])
  const runtimeChoices = useMemo(
    () => [...providerChoices, ...localCliChoices],
    [providerChoices, localCliChoices],
  )

  const selectedModel = isControlled
    ? availableModels.find((model) => model.id === value) || null
    : storeModel

  const activeRuntimeSelection = isRuntimeScoped
    ? controlledRuntimeSelection ?? storedRuntimeSelection ?? resolveDefaultRuntimeSelection(
      executionMode,
      activeId,
      providers,
      activeLocalCliId,
      localClis,
      storeModel?.id,
    )
    : null

  const selectedRuntimeChoice = findRuntimeChoice(activeRuntimeSelection, runtimeChoices)
  const buttonModelLabel = isRuntimeScoped
    ? selectedRuntimeChoice?.label ?? t('model.selectRuntime')
    : selectedModel?.name ?? t('model.selectModel')
  const buttonProviderLabel = isRuntimeScoped && selectedRuntimeChoice
    ? selectedRuntimeChoice.kind === 'local_cli'
      ? t('settings.executionMode.localCli')
      : t('settings.executionMode.provider')
    : null
  const selectedRuntimeEffort = activeRuntimeSelection?.effortLevel ?? effortLevel

  const handleRuntimeSelect = (selection: RuntimeSelection) => {
    onRuntimeSelectionChange?.(selection)
    if (runtimeKey) {
      useSessionRuntimeStore.getState().setSelection(runtimeKey, selection)
      if (runtimeKey !== DRAFT_RUNTIME_SELECTION_KEY) {
        useChatStore.getState().setSessionRuntime(runtimeKey, selection)
      }
    }
    setOpen(false)
  }

  const handleRuntimeEffortSelect = (level: EffortLevel) => {
    if (!activeRuntimeSelection) return
    handleRuntimeSelect({
      ...activeRuntimeSelection,
      effortLevel: level,
    })
  }

  const renderRuntimeChoice = (choice: RuntimeChoice) => {
    const isSelected = isSelectedChoice(activeRuntimeSelection, choice)
    return (
      <button
        key={`${choice.kind}:${choice.id}`}
        onClick={() => handleRuntimeSelect(selectionFromChoice(choice, selectedRuntimeEffort))}
        className={`
          w-full rounded-lg border px-3 text-left transition-colors
          ${isMobileBrowser ? 'min-h-[56px] py-3' : 'py-2.5'}
          ${isSelected
            ? 'border-[var(--color-model-option-selected-border)] bg-[var(--color-model-option-selected-bg)]'
            : 'border-transparent hover:bg-[var(--color-surface-hover)]'
          }
        `}
      >
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 ${
            isSelected ? 'border-[var(--color-brand)]' : 'border-[var(--color-outline)]'
          }`}>
            {isSelected && (
              <div className="h-2 w-2 rounded-full bg-[var(--color-brand)]" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
              {choice.label}
            </div>
            {choice.detail && (
              <div className="mt-0.5 truncate pr-[6px] font-mono text-[10px] text-[var(--color-text-tertiary)]">
                {choice.detail}
              </div>
            )}
          </div>
        </div>
      </button>
    )
  }

  const dropdownContent = (
    <>
      <div className={`overflow-y-auto ${isMobileBrowser ? 'p-1' : 'p-3'}`} style={{ maxHeight: isMobileBrowser ? undefined : dropdownPosition?.maxHeight }}>
        {!isMobileBrowser && (
          <div className="mb-2 px-1 text-[10px] font-bold uppercase tracking-widest text-[var(--color-outline)]">
            {isRuntimeScoped ? t('model.runtimeConfiguration') : t('model.configuration')}
          </div>
        )}

        {isRuntimeScoped ? (
          <div className="space-y-3">
            {providerChoices.length > 0 && (
              <div className="space-y-1">
                <div className="px-2 pt-1 text-[11px] font-semibold tracking-[0.01em] text-[var(--color-text-secondary)]">
                  {t('settings.executionMode.provider')}
                </div>
                {providerChoices.map(renderRuntimeChoice)}
              </div>
            )}

            {localCliChoices.length > 0 && (
              <div className="space-y-1">
                <div className="px-2 pt-1 text-[11px] font-semibold tracking-[0.01em] text-[var(--color-text-secondary)]">
                  {t('settings.executionMode.localCli')}
                </div>
                {localCliChoices.map(renderRuntimeChoice)}
              </div>
            )}

            {runtimeChoices.length === 0 && (
              <div className="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-5 text-sm text-[var(--color-text-tertiary)]">
                {t('model.noRuntimeTargets')}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {availableModels.map((model) => {
              const isSelected = model.id === selectedModel?.id
              return (
                <button
                  key={model.id}
                  onClick={() => {
                    if (isControlled) {
                      onChange?.(model.id)
                    } else {
                      void setModel(model.id)
                    }
                    setOpen(false)
                  }}
                  className={`
                    w-full rounded-lg px-3 text-left transition-colors
                    ${isMobileBrowser ? 'min-h-[56px] py-3' : 'py-2.5'}
                    ${isSelected
                      ? 'border border-[var(--color-model-option-selected-border)] bg-[var(--color-model-option-selected-bg)]'
                      : 'hover:bg-[var(--color-surface-hover)]'
                    }
                  `}
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                      isSelected ? 'border-[var(--color-brand)]' : 'border-[var(--color-outline)]'
                    }`}>
                      {isSelected && (
                        <div className="h-2 w-2 rounded-full bg-[var(--color-brand)]" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-[var(--color-text-primary)]">{model.name}</div>
                      {model.description && (
                        <div className="mt-0.5 truncate text-[10px] text-[var(--color-text-tertiary)]">
                          {getLocalizedModelDescription(model, t)}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {canEditRuntimeEffort && (
        <div className="border-t border-[var(--color-border)] p-3">
          <div className="mb-2 px-1 text-[10px] font-bold uppercase tracking-widest text-[var(--color-outline)]">
            {t('model.effort')}
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {EFFORT_OPTIONS.map((opt) => {
              const isSelected = opt.value === selectedRuntimeEffort
              return (
                <button
                  key={opt.value}
                  onClick={() => handleRuntimeEffortSelect(opt.value)}
                  className={`
                    rounded-lg py-2 text-center text-xs font-semibold transition-colors
                    ${isSelected
                      ? 'bg-[var(--color-brand)] text-white'
                      : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                    }
                  `}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </>
  )

  const dropdown = open && dropdownPosition
    ? isMobileBrowser ? (
      <MobileBottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={isRuntimeScoped ? t('model.runtimeConfiguration') : t('model.configuration')}
        closeLabel={t('tabs.close')}
        ariaLabel={isRuntimeScoped ? t('model.runtimeConfiguration') : t('model.configuration')}
        contentClassName="p-3"
        panelRef={dropdownRef}
        testId="model-selector-dropdown"
      >
        {dropdownContent}
      </MobileBottomSheet>
    ) : createPortal(
      <div
        ref={dropdownRef}
        data-testid="model-selector-dropdown"
        className="fixed z-[80] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)]"
        style={{
          top: dropdownPosition.top,
          bottom: dropdownPosition.bottom,
          left: dropdownPosition.left,
          width: dropdownPosition.width,
        }}
      >
        {dropdownContent}
      </div>,
      document.body,
    )
    : null

  return (
    <div ref={ref} className="relative min-w-0 shrink-0">
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={`flex items-center gap-2 rounded-full bg-[var(--color-surface-container-low)] text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50 ${
          compact ? 'max-w-[112px] px-2.5 py-1.5' : 'max-w-[280px] px-3 py-1.5'
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className={`${compact ? 'text-xs' : 'text-sm'} min-w-0 flex-1 truncate font-semibold text-[var(--color-text-primary)]`}>
            {buttonModelLabel}
          </span>
          {!compact && buttonProviderLabel && (
            <span className="max-w-[108px] flex-shrink-0 truncate text-[11px] text-[var(--color-text-tertiary)]">
              {buttonProviderLabel}
            </span>
          )}
        </div>
        <span className="material-symbols-outlined flex-shrink-0 text-[12px]">expand_more</span>
      </button>
      {dropdown}
    </div>
  )
}
