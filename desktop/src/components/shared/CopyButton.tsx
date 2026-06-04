import { useEffect, useState, type PointerEventHandler, type ReactNode } from 'react'
import { copyTextToClipboard } from '../chat/clipboard'
import { useTranslation } from '../../i18n'

type Props = {
  text: string
  label?: string
  copiedLabel?: string
  displayLabel?: ReactNode
  displayCopiedLabel?: ReactNode
  className?: string
  onPointerUp?: PointerEventHandler<HTMLButtonElement>
}

export function CopyButton({
  text,
  label,
  copiedLabel,
  displayLabel,
  displayCopiedLabel,
  className = '',
  onPointerUp,
}: Props) {
  const t = useTranslation()
  const [copied, setCopied] = useState(false)
  const resolvedLabel = label ?? t('common.copy')
  const resolvedCopiedLabel = copiedLabel ?? t('common.copied')

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  const handleCopy = async () => {
    try {
      const ok = await copyTextToClipboard(text)
      if (!ok) {
        setCopied(false)
        return
      }
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const currentLabel = copied ? resolvedCopiedLabel : resolvedLabel
  const buttonText = copied
    ? (displayCopiedLabel ?? resolvedCopiedLabel)
    : (displayLabel ?? resolvedLabel)

  return (
    <button
      type="button"
      onClick={handleCopy}
      onPointerUp={onPointerUp}
      className={className}
      aria-label={currentLabel}
      title={currentLabel}
    >
      {buttonText}
    </button>
  )
}
