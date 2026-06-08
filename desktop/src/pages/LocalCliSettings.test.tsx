import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'

import { LocalCliSettings } from './LocalCliSettings'
import { useLocalCliStore } from '../stores/localCliStore'
import { useSettingsStore } from '../stores/settingsStore'

const localCliApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  rescan: vi.fn(),
  activate: vi.fn(),
  updateConfig: vi.fn(),
  test: vi.fn(),
}))

vi.mock('../api/localCli', () => ({
  localCliApi: localCliApiMock,
}))

describe('LocalCliSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useLocalCliStore.setState(useLocalCliStore.getInitialState(), true)
    useSettingsStore.setState({ locale: 'en', executionMode: 'provider' })
    localCliApiMock.list.mockResolvedValue(localCliList(null))
    localCliApiMock.rescan.mockResolvedValue(localCliList(null))
    localCliApiMock.updateConfig.mockResolvedValue(localCliList(null, {
      codexRoles: {
        primary: 'gpt-5-codex',
        fast: 'gpt-5',
        balanced: 'gpt-5-codex',
        powerful: 'o3',
      },
      autoCompactWindow: 128000,
      modelContextWindows: { 'gpt-5-codex': 256000 },
    }))
    localCliApiMock.test.mockResolvedValue({
      result: {
        success: true,
        latencyMs: 31,
        version: 'codex 1.0.0',
        executablePath: 'C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.cmd',
        launchPath: 'C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.cmd',
      },
    })
  })

  afterEach(() => {
    cleanup()
    useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  })

  it('shows only available local CLIs with edit and test actions', async () => {
    render(<LocalCliSettings />)

    await waitFor(() => expect(screen.getByTestId('local-cli-card-codex')).toBeInTheDocument())

    expect(screen.queryByTestId('local-cli-card-qoder')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('local-cli-card-codex')).getByText('Codex CLI')).toBeInTheDocument()
    expect(screen.getByTestId('local-cli-test-codex')).toBeInTheDocument()
    expect(screen.getByTestId('local-cli-edit-codex')).toBeInTheDocument()
    expect(screen.queryByTestId('local-cli-activate-codex')).not.toBeInTheDocument()
  })

  it('saves provider-like model mapping and context settings for Codex', async () => {
    render(<LocalCliSettings />)

    await waitFor(() => expect(screen.getByTestId('local-cli-edit-codex')).toBeInTheDocument())
    await act(async () => {
      fireEvent.click(screen.getByTestId('local-cli-edit-codex'))
      await Promise.resolve()
    })

    await act(async () => {
      fireEvent.change(screen.getByTestId('local-cli-model-codex-primary'), {
        target: { value: 'gpt-5-codex' },
      })
      fireEvent.focus(screen.getByTestId('local-cli-model-codex-fast'))
      await Promise.resolve()
    })

    await act(async () => {
      expect(await screen.findByText('GPT-5 (gpt-5)')).toBeInTheDocument()
      fireEvent.change(screen.getByTestId('local-cli-model-codex-fast'), {
        target: { value: 'gpt-5' },
      })
      await Promise.resolve()
    })

    await act(async () => {
      fireEvent.change(screen.getByTestId('local-cli-model-codex-balanced'), {
        target: { value: 'gpt-5-codex' },
      })
      fireEvent.change(screen.getByTestId('local-cli-model-codex-powerful'), {
        target: { value: 'o3' },
      })
      fireEvent.click(screen.getByText('Context and auto-compact'))
      await Promise.resolve()
    })

    await act(async () => {
      fireEvent.change(screen.getByTestId('local-cli-context-codex-primary'), {
        target: { value: '256000' },
      })
      fireEvent.change(screen.getByTestId('local-cli-auto-compact-codex'), {
        target: { value: '128000' },
      })
      fireEvent.click(screen.getByText('Save'))
      await Promise.resolve()
    })

    expect(localCliApiMock.updateConfig).toHaveBeenCalledWith('codex', {
      modelRoles: {
        primary: 'gpt-5-codex',
        fast: 'gpt-5',
        balanced: 'gpt-5-codex',
        powerful: 'o3',
      },
      autoCompactWindow: 128000,
      modelContextWindows: {
        'gpt-5-codex': 256000,
      },
    })
  })

  it('tests a configured CLI like a provider connection', async () => {
    render(<LocalCliSettings />)

    await waitFor(() => expect(screen.getByTestId('local-cli-test-codex')).toBeInTheDocument())
    await act(async () => {
      fireEvent.click(screen.getByTestId('local-cli-test-codex'))
      await Promise.resolve()
    })

    expect(localCliApiMock.test).toHaveBeenCalledWith('codex')
    await waitFor(() => {
      expect(screen.getByTestId('local-cli-test-result-codex')).toHaveTextContent('Test passed')
    })
  })
})

function localCliList(
  activeId: string | null,
  options: {
    codexRoles?: {
      primary: string
      fast: string
      balanced: string
      powerful: string
    }
    autoCompactWindow?: number
    modelContextWindows?: Record<string, number>
  } = {},
) {
  return {
    activeId,
    clis: [
      {
        id: 'codex',
        displayName: 'Codex CLI',
        command: 'codex',
        executablePath: 'C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.cmd',
        launchPath: 'C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.cmd',
        launchKind: 'selected',
        source: 'path',
        available: true,
        supportsDesktopRuntime: true,
        version: 'codex 1.0.0',
        config: {},
        models: [
          { id: 'default', label: 'CLI default' },
          { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
          { id: 'gpt-5', label: 'GPT-5' },
          { id: 'o3', label: 'o3' },
        ],
        modelRoles: options.codexRoles ?? {
          primary: 'default',
          fast: 'default',
          balanced: 'default',
          powerful: 'default',
        },
        enabledModels: ['default'],
        ...(options.autoCompactWindow ? { autoCompactWindow: options.autoCompactWindow } : {}),
        ...(options.modelContextWindows ? { modelContextWindows: options.modelContextWindows } : {}),
      },
      {
        id: 'qoder',
        displayName: 'Qoder',
        command: 'qoder',
        executablePath: null,
        launchPath: null,
        launchKind: 'selected',
        source: null,
        available: false,
        supportsDesktopRuntime: true,
        version: null,
        config: {},
        models: [{ id: 'default', label: 'CLI default' }],
        modelRoles: {
          primary: 'default',
          fast: 'default',
          balanced: 'default',
          powerful: 'default',
        },
        enabledModels: ['default'],
      },
    ],
  }
}
