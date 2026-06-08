import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from '../../i18n'

export type ModelCandidate = {
  id: string
  label?: string
  description?: string
}

type ModelCandidateInputProps = {
  label: string
  value: string
  onChange: (value: string) => void
  candidates: ModelCandidate[]
  placeholder?: string
  required?: boolean
  disabled?: boolean
  testId?: string
}

function normalizeCandidates(candidates: ModelCandidate[]): ModelCandidate[] {
  const seen = new Set<string>()
  const result: ModelCandidate[] = []
  for (const candidate of candidates) {
    const id = candidate.id.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push({
      id,
      label: candidate.label?.trim() || id,
      description: candidate.description,
    })
  }
  return result
}

function formatCandidateLabel(candidate: ModelCandidate): string {
  const label = candidate.label?.trim()
  return label && label !== candidate.id ? `${label} (${candidate.id})` : candidate.id
}

export function ModelCandidateInput({
  label,
  value,
  onChange,
  candidates,
  placeholder,
  required,
  disabled,
  testId,
}: ModelCandidateInputProps) {
  const t = useTranslation()
  const [open, setOpen] = useState(false)
  const [filterText, setFilterText] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const inputId = useId()

  const normalizedCandidates = useMemo(() => normalizeCandidates(candidates), [candidates])
  const query = filterText.trim().toLowerCase()
  const visibleCandidates = useMemo(() => {
    if (!query) return normalizedCandidates.slice(0, 12)
    return normalizedCandidates
      .filter((candidate) => {
        const labelText = candidate.label?.toLowerCase() ?? ''
        return candidate.id.toLowerCase().includes(query) || labelText.includes(query)
      })
      .slice(0, 12)
  }, [normalizedCandidates, query])
  const hasExactCandidate = normalizedCandidates.some((candidate) => candidate.id === value.trim())
  const showCustomCandidate = Boolean(value.trim()) && !hasExactCandidate

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const chooseValue = (modelId: string) => {
    onChange(modelId)
    setFilterText('')
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-[var(--color-text-primary)]">
        {label}
        {required && <span className="text-[var(--color-error)] ml-0.5">*</span>}
      </label>
      <div className="relative">
        <input
          id={inputId}
          data-testid={testId}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={() => {
            setFilterText('')
            setOpen(true)
          }}
          onChange={(event) => {
            const nextValue = event.target.value
            onChange(nextValue)
            setFilterText(nextValue)
            setOpen(true)
          }}
          className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 pr-9 text-sm text-[var(--color-text-primary)] outline-none transition-colors duration-150 placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setFilterText('')
            setOpen((current) => !current)
          }}
          className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus:outline-none focus:shadow-[var(--shadow-focus-ring)] disabled:opacity-50"
          aria-label={t('settings.modelCandidate.open')}
        >
          <span className="material-symbols-outlined text-[18px]">expand_more</span>
        </button>
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)]">
          {visibleCandidates.map((candidate, index) => (
            <button
              key={candidate.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseValue(candidate.id)}
              className={`flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:bg-[var(--color-surface-hover)] focus-visible:outline-none ${
                candidate.id === value.trim() ? 'bg-[var(--color-model-option-selected-bg)]' : ''
              } ${index > 0 ? 'border-t border-[var(--color-border-separator)]' : ''}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">
                  {formatCandidateLabel(candidate)}
                </span>
                {candidate.description && (
                  <span className="mt-0.5 block truncate text-xs text-[var(--color-text-secondary)]">
                    {candidate.description}
                  </span>
                )}
              </span>
              {candidate.id === value.trim() && (
                <span className="material-symbols-outlined mt-0.5 text-[16px] text-[var(--color-brand)]">check_circle</span>
              )}
            </button>
          ))}
          {showCustomCandidate && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseValue(value.trim())}
              className={`flex w-full items-start gap-2 border-t border-[var(--color-border-separator)] px-3 py-2 text-left transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:bg-[var(--color-surface-hover)] focus-visible:outline-none ${
                visibleCandidates.length === 0 ? 'border-t-0' : ''
              }`}
            >
              <span className="material-symbols-outlined mt-0.5 text-[15px] text-[var(--color-text-tertiary)]">edit</span>
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text-primary)]">
                {t('settings.modelCandidate.custom', { model: value.trim() })}
              </span>
            </button>
          )}
          {visibleCandidates.length === 0 && !showCustomCandidate && (
            <div className="px-3 py-2 text-sm text-[var(--color-text-tertiary)]">
              {t('settings.modelCandidate.empty')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
