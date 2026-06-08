import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import { ModelSelector } from './ModelSelector'
import { useChatStore } from '../../stores/chatStore'
import { useLocalCliStore } from '../../stores/localCliStore'
import { useProviderStore } from '../../stores/providerStore'
import { useSessionRuntimeStore } from '../../stores/sessionRuntimeStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { ModelInfo } from '../../types/settings'

const MODELS: ModelInfo[] = [
  { id: 'alpha', name: 'Alpha', description: 'Fast model', context: '128k' },
  { id: 'beta', name: 'Beta', description: 'Careful model', context: '200k' },
]

async function clickByRole(name: RegExp | string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
    await Promise.resolve()
  })
}

afterEach(() => {
  cleanup()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useProviderStore.setState(useProviderStore.getInitialState(), true)
  useLocalCliStore.setState(useLocalCliStore.getInitialState(), true)
  useSessionRuntimeStore.setState(useSessionRuntimeStore.getInitialState(), true)
  useChatStore.setState(useChatStore.getInitialState(), true)
})

describe('ModelSelector', () => {
  it('uses controlled model selection without mutating settings directly', async () => {
    const onChange = vi.fn()
    useSettingsStore.setState({
      locale: 'en',
      availableModels: MODELS,
      currentModel: MODELS[0],
    })

    render(<ModelSelector value="alpha" onChange={onChange} />)

    await clickByRole(/alpha/i)
    await clickByRole(/Beta/)

    expect(onChange).toHaveBeenCalledWith('beta')
  })

  it('routes uncontrolled model changes through settings actions', async () => {
    const setModel = vi.fn(async () => {})
    useSettingsStore.setState({
      locale: 'en',
      availableModels: MODELS,
      currentModel: MODELS[0],
      effortLevel: 'max',
      setModel,
    })

    render(<ModelSelector />)

    await clickByRole(/alpha/i)
    await clickByRole(/Beta/)
    expect(setModel).toHaveBeenCalledWith('beta')
  })

  it('selects a provider runtime target and uses the provider primary model', async () => {
    const setSessionRuntime = vi.fn()
    useSettingsStore.setState({
      locale: 'en',
      availableModels: MODELS,
      currentModel: MODELS[0],
      effortLevel: 'max',
    })
    useProviderStore.setState({
      providers: [
        providerFixture('provider-a', 'Provider A', 'provider-a-main'),
        providerFixture('provider-b', 'Provider B', 'provider-b-main'),
      ],
      activeId: 'provider-a',
      hasLoadedProviders: true,
      isLoading: true,
    })
    useChatStore.setState({
      setSessionRuntime,
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    render(<ModelSelector runtimeKey="session-1" />)

    await clickByRole(/Provider A/i)
    await clickByRole(/Provider B/)

    const selection = {
      kind: 'provider',
      providerId: 'provider-b',
      localCliId: null,
      modelId: 'provider-b-main',
      effortLevel: 'max',
    }
    expect(useSessionRuntimeStore.getState().selections['session-1']).toEqual(selection)
    expect(setSessionRuntime).toHaveBeenCalledWith('session-1', selection)
  })

  it('keeps runtime effort scoped to the selected session', async () => {
    const setSessionRuntime = vi.fn()
    useSettingsStore.setState({
      locale: 'en',
      availableModels: MODELS,
      currentModel: MODELS[0],
      effortLevel: 'max',
    })
    useProviderStore.setState({
      providers: [providerFixture('provider-a', 'Provider A', 'provider-main')],
      activeId: 'provider-a',
      hasLoadedProviders: true,
      isLoading: true,
    })
    useSessionRuntimeStore.getState().setSelection('session-2', {
      kind: 'provider',
      providerId: 'provider-a',
      localCliId: null,
      modelId: 'provider-main',
      effortLevel: 'max',
    })
    useChatStore.setState({
      setSessionRuntime,
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    render(<ModelSelector runtimeKey="session-1" />)

    await clickByRole(/Provider A/i)
    await clickByRole(/^High$/)

    expect(useSessionRuntimeStore.getState().selections['session-1']).toEqual({
      kind: 'provider',
      providerId: 'provider-a',
      localCliId: null,
      modelId: 'provider-main',
      effortLevel: 'high',
    })
    expect(useSessionRuntimeStore.getState().selections['session-2']).toEqual({
      kind: 'provider',
      providerId: 'provider-a',
      localCliId: null,
      modelId: 'provider-main',
      effortLevel: 'max',
    })
    expect(useSettingsStore.getState().effortLevel).toBe('max')
  })

  it('localizes model descriptions in Chinese locale', async () => {
    const openAIModels: ModelInfo[] = [
      {
        id: 'gpt-5.3-codex',
        name: 'GPT-5.3 Codex',
        description: 'Best for coding and agentic work',
        context: '',
      },
    ]
    useSettingsStore.setState({
      locale: 'zh',
      availableModels: openAIModels,
      currentModel: openAIModels[0],
    })

    render(<ModelSelector />)

    await clickByRole(/GPT-5\.3 Codex/i)

    expect(screen.getByText('最适合编码和 Agent 工作')).toBeInTheDocument()
    expect(screen.queryByText('Best for coding and agentic work')).not.toBeInTheDocument()
  })

  it('selects an available local CLI runtime and hides unavailable CLIs', async () => {
    const setSessionRuntime = vi.fn()
    useSettingsStore.setState({
      locale: 'en',
      executionMode: 'provider',
      availableModels: MODELS,
      currentModel: MODELS[0],
      effortLevel: 'max',
    })
    useProviderStore.setState({
      providers: [providerFixture('provider-a', 'Provider A', 'provider-main')],
      activeId: 'provider-a',
      hasLoadedProviders: true,
      isLoading: true,
    })
    useLocalCliStore.setState({
      activeId: 'codex',
      clis: [
        localCliFixture('codex', 'Codex CLI', true),
        localCliFixture('qoder', 'Qoder', false),
      ],
      isLoading: true,
    })
    useChatStore.setState({
      setSessionRuntime,
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    render(<ModelSelector runtimeKey="session-local-cli" />)

    await clickByRole(/Provider A/i)
    const dropdown = screen.getByTestId('model-selector-dropdown')
    expect(dropdown.textContent).toContain('Local CLI')
    expect(dropdown.textContent).toContain('Codex CLI')
    expect(dropdown.textContent).not.toContain('Qoder')

    await clickByRole(/Codex CLI/)

    const selection = {
      kind: 'local_cli',
      providerId: null,
      localCliId: 'codex',
      modelId: 'gpt-5-codex',
      effortLevel: 'max',
    }
    expect(useSessionRuntimeStore.getState().selections['session-local-cli']).toEqual(selection)
    expect(setSessionRuntime).toHaveBeenCalledWith('session-local-cli', selection)
  })

  it('defaults to the active local CLI in local CLI execution mode', async () => {
    useSettingsStore.setState({
      locale: 'en',
      executionMode: 'local_cli',
      availableModels: MODELS,
      currentModel: MODELS[0],
    })
    useProviderStore.setState({
      providers: [providerFixture('provider-a', 'Provider A', 'provider-main')],
      activeId: 'provider-a',
      hasLoadedProviders: true,
      isLoading: true,
    })
    useLocalCliStore.setState({
      activeId: 'codex',
      clis: [localCliFixture('codex', 'Codex CLI', true)],
      isLoading: true,
    })

    render(<ModelSelector runtimeKey="session-local-default" />)

    expect(screen.getByRole('button', { name: /Codex CLI/ })).toBeInTheDocument()
  })

  it('portals the dropdown outside clipping containers and positions it below the trigger', async () => {
    useSettingsStore.setState({
      locale: 'en',
      availableModels: MODELS,
      currentModel: MODELS[0],
    })

    const { container } = render(
      <div data-testid="scroll-container" className="overflow-hidden">
        <ModelSelector value="alpha" onChange={vi.fn()} />
      </div>,
    )

    const trigger = screen.getByRole('button', { name: /alpha/i })
    Object.defineProperty(trigger.parentElement, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: 120,
        right: 520,
        bottom: 150,
        left: 240,
        width: 280,
        height: 30,
        x: 240,
        y: 120,
        toJSON: () => {},
      }),
    })

    await act(async () => {
      fireEvent.click(trigger)
      await Promise.resolve()
    })

    const dropdown = screen.getByTestId('model-selector-dropdown')
    expect(container.contains(dropdown)).toBe(false)
    expect(document.body.contains(dropdown)).toBe(true)
    expect(dropdown.className).toContain('fixed')
    expect(dropdown.style.top).toBe('158px')
    expect(dropdown.style.left).toBe('160px')
    expect(dropdown.style.width).toBe('360px')
  })
})

function providerFixture(providerId: string, displayName: string, primaryModel: string) {
  return {
    providerId,
    displayName,
    apiKey: '***',
    baseUrl: 'https://api.example.com',
    apiFormat: 'anthropic' as const,
    modelRoles: {
      primary: primaryModel,
      fast: primaryModel,
      balanced: primaryModel,
      powerful: primaryModel,
    },
    enabledModels: [primaryModel],
  }
}

function localCliFixture(id: string, displayName: string, available: boolean) {
  return {
    id,
    displayName,
    command: id,
    executablePath: available ? `C:\\Tools\\${id}.cmd` : null,
    launchPath: available ? `C:\\Tools\\${id}.cmd` : null,
    launchKind: 'selected' as const,
    source: available ? 'path' as const : null,
    available,
    supportsDesktopRuntime: true,
    version: available ? `${id} 1.0.0` : null,
    config: {},
    models: [{ id: 'gpt-5-codex', label: 'GPT-5 Codex' }],
    modelRoles: {
      primary: 'gpt-5-codex',
      fast: 'gpt-5-codex',
      balanced: 'gpt-5-codex',
      powerful: 'gpt-5-codex',
    },
    enabledModels: ['gpt-5-codex'],
  }
}
