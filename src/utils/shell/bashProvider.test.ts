import { afterEach, describe, expect, test } from 'bun:test'
import { createBashShellProvider } from './bashProvider.js'

const ORIGINAL_BEYA_CLI_PATH = process.env.BEYA_CLI_PATH
const ORIGINAL_BEYA_APP_ROOT = process.env.BEYA_APP_ROOT

afterEach(() => {
  if (ORIGINAL_BEYA_CLI_PATH === undefined) {
    delete process.env.BEYA_CLI_PATH
  } else {
    process.env.BEYA_CLI_PATH = ORIGINAL_BEYA_CLI_PATH
  }

  if (ORIGINAL_BEYA_APP_ROOT === undefined) {
    delete process.env.BEYA_APP_ROOT
  } else {
    process.env.BEYA_APP_ROOT = ORIGINAL_BEYA_APP_ROOT
  }
})

describe('createBashShellProvider', () => {
  test('injects a bundled beya wrapper for desktop sidecars', async () => {
    process.env.BEYA_CLI_PATH = '/tmp/beya-sidecar'
    process.env.BEYA_APP_ROOT = '/tmp/beya-desktop-app'

    const provider = await createBashShellProvider('/bin/bash', {
      skipSnapshot: true,
    })

    const { commandString } = await provider.buildExecCommand(
      'beya plugin install demo@beya-plugins --scope user',
      {
        id: 'wrapper-test',
        useSandbox: false,
      },
    )

    expect(commandString).toContain('beya() {')
    expect(commandString).toContain('/tmp/beya-sidecar cli --app-root "$BEYA_APP_ROOT" "$@"')
  })
})
