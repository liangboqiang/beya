import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const copyTextToClipboard = vi.hoisted(() => vi.fn())

vi.mock('../chat/clipboard', () => ({
  copyTextToClipboard,
}))

import { useSettingsStore } from '../../stores/settingsStore'
import { CopyButton } from './CopyButton'

describe('CopyButton', () => {
  beforeEach(() => {
    copyTextToClipboard.mockReset()
    copyTextToClipboard.mockResolvedValue(true)
    useSettingsStore.setState({ locale: 'zh' })
  })

  it('uses localized default labels', async () => {
    render(<CopyButton text="hello" />)

    fireEvent.click(screen.getByRole('button', { name: '复制' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '已复制' })).toBeInTheDocument()
    })
  })
})
