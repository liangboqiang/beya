// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const html = readFileSync(join(__dirname, 'index.html'), 'utf-8')
const viteConfig = readFileSync(join(__dirname, 'vite.config.ts'), 'utf-8')
const rootDir = join(__dirname, '..')
const startBeya = readFileSync(join(rootDir, 'start-beya.ps1'), 'utf-8')
const startWebUi = readFileSync(join(rootDir, 'scripts', 'start-web-ui.ps1'), 'utf-8')

describe('desktop index startup bridge', () => {
  it('installs a non-module startup watchdog before the app module loads', () => {
    const watchdogIndex = html.indexOf('__BEYA_SHOW_STARTUP_ERROR__')
    const moduleIndex = html.indexOf('type="module"')

    expect(watchdogIndex).toBeGreaterThan(0)
    expect(moduleIndex).toBeGreaterThan(watchdogIndex)
    expect(html).toContain('__BEYA_BOOTSTRAPPED__')
    expect(html).toContain('__BEYA_CLEAR_STARTUP_RETRY__')
  })

  it('keeps the real app module path for Vite and Tauri startup', () => {
    expect(html).toContain('<script type="module" src="/src/main.tsx"></script>')
    expect(html).toContain('var bootDeadlineMs = 60000')
    expect(html).toContain('copy.bootTimeoutPrefix + bootDeadlineMs + copy.bootTimeoutSuffix')
  })

  it('keeps the inline startup script syntactically valid', () => {
    const script = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1]

    expect(script).toBeTruthy()
    expect(() => new Function(script || '')).not.toThrow()
  })

  it('uses a launcher bridge for direct file opens and static previews', () => {
    expect(html).toContain('function shouldUseLauncherBridge()')
    expect(html).toContain('copy.bridgeReason')
    expect(html).toContain('function mountLocalWebUi(candidate)')
    expect(html).toContain("iframe.title = 'Beya Web UI'")
    expect(html).toContain('mountLocalWebUi(candidate)')
    expect(html).toContain('../start-beya.cmd')
    expect(html).toContain('if (isFileUrl()) {')
    expect(html).toContain('openLocalLauncher(status)')
    expect(html).toContain('openLocalWebUi(status, { auto: false })')
    expect(html).toContain('plugin:process|restart')
    expect(html).not.toContain('serverUrl=http://127.0.0.1:3456')
    expect(html).not.toContain('.\\\\scripts\\\\start-web-ui.ps1')
  })

  it('discovers the newest Vite Web UI from the status endpoint before legacy probing', () => {
    expect(html).toContain("var statusEndpointPath = '/__beya_web_ui_status'")
    expect(html).toContain("status.app !== 'beya-desktop-web-ui'")
    expect(html).toContain('startedAtMs')
    expect(html).toContain('launchedByStartScript')
    expect(html).toContain('function compareCandidates(a, b)')
    expect(html.indexOf('Promise.all(origins.map(probeWebStatus))')).toBeLessThan(
      html.indexOf('Promise.all(origins.map(probeLegacyWebOrigin))'),
    )
    expect(html).toContain('{ start: 5173, count: 120 }')
    expect(html).not.toContain('var preferredWebPorts = [2024, 5173, 1420]')
  })

  it('exposes Vite status metadata used by the bridge', () => {
    expect(viteConfig).toContain("name: 'beya-web-ui-status'")
    expect(viteConfig).toContain("server.middlewares.use('/__beya_web_ui_status'")
    expect(viteConfig).toContain("app: 'beya-desktop-web-ui'")
    expect(viteConfig).toContain('VITE_DESKTOP_SERVER_URL')
    expect(viteConfig).toContain('VITE_BEYA_WEB_STARTED_AT')
    expect(viteConfig).toContain('VITE_BEYA_WEB_PORT')
    expect(viteConfig).toContain("Access-Control-Allow-Origin', '*'")
  })

  it('keeps start-beya on the Vite default port family and passes launch metadata', () => {
    expect(startBeya).toContain('[int]$WebPort = 5173')
    expect(startBeya).toContain('Write-Host "  -WebPort 5173"')
    expect(startWebUi).toContain('[int]$WebPort = 5173')
    expect(startWebUi).toContain('$webStartedAt = (Get-Date).ToUniversalTime().ToString("o")')
    expect(startWebUi).toContain("`$env:VITE_BEYA_WEB_STARTED_AT='$webStartedAt'")
    expect(startWebUi).toContain("`$env:VITE_BEYA_WEB_PORT='$webPortResolved'")
  })

  it('does not show the stale automatic restart holding screen', () => {
    expect(html).not.toContain('autoRetryLimit')
    expect(html).not.toContain('autoRetryDelayMs')
    expect(html).not.toContain('renderAutoRetry')
  })

  it('keeps startup copy as unicode escapes to avoid mojibake in this file', () => {
    expect(html).toContain('\\u6253\\u5f00 Beya')
    expect(html).toContain('\\u542f\\u52a8 Beya')
    expect(html).not.toContain(String.fromCharCode(0x95bf))
    expect(html).not.toContain(String.fromCharCode(0x59dd))
    expect(html).not.toContain(String.fromCharCode(0x8930))
  })
})
