import { RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from '../../i18n'
import { Button } from '../shared/Button'

const LOG_MARKER = '\n\nRecent server logs:\n'

export function splitStartupError(error: string) {
  const markerIndex = error.indexOf(LOG_MARKER)
  if (markerIndex === -1) {
    return {
      message: error,
      logs: '',
      diagnostics: error,
    }
  }

  const message = error.slice(0, markerIndex).trim()
  const logs = error.slice(markerIndex + LOG_MARKER.length).trim()
  return {
    message,
    logs,
    diagnostics: `${message}\n\nRecent server logs:\n${logs}`,
  }
}

type StartupErrorViewProps = {
  error: string
  onRestart?: () => Promise<void> | void
}

export function StartupErrorView({ error, onRestart }: StartupErrorViewProps) {
  const t = useTranslation()
  const { message, logs, diagnostics } = useMemo(() => splitStartupError(error), [error])
  const [restarting, setRestarting] = useState(false)

  const handleRestart = async () => {
    setRestarting(true)
    try {
      if (onRestart) {
        await onRestart()
        return
      }
      window.location.reload()
    } catch (error) {
      console.error('[desktop] Restart from startup error view failed', error)
      setRestarting(false)
    }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-[var(--color-surface)] px-6">
      <section className="w-full max-w-3xl rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-6 shadow-[var(--shadow-md)]">
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
              {t('app.serverFailed')}
            </h1>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              {t('app.serverFailedHint')}
            </p>
          </div>

          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <div className="text-xs font-medium uppercase text-[var(--color-text-tertiary)]">
              {t('app.startupError')}
            </div>
            <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-[var(--color-error)]">
              {message}
            </pre>
          </div>

          <div>
            <Button
              type="button"
              variant="primary"
              size="md"
              loading={restarting}
              icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
              onClick={handleRestart}
            >
              {restarting ? t('app.restarting') : t('app.restart')}
            </Button>
          </div>

          <details className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <summary className="cursor-pointer text-xs font-medium uppercase text-[var(--color-text-tertiary)]">
              {t('app.diagnostics')}
            </summary>
            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-[var(--color-text-secondary)]">
              {logs ? diagnostics : message}
            </pre>
          </details>
        </div>
      </section>
    </div>
  )
}
