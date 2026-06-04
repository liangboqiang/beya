/**
 * Beya desktop sidecar entrypoint.
 *
 * The first positional argument selects the runtime mode:
 *   beya-sidecar server   --app-root <path> --host 127.0.0.1 --port 12345
 *   beya-sidecar cli      --app-root <path> [CLI args...]
 *   beya-sidecar adapters --app-root <path> [--feishu] [--telegram] [--wechat] [--dingtalk]
 */

import { parseLauncherArgs, resolveSidecarInvocation } from './launcherRouting'

const rawArgs = process.argv.slice(2)
const invocation = resolveSidecarInvocation(rawArgs)
if (!invocation.mode) {
  console.error('beya-sidecar: missing mode argument (expected "server", "cli" or "adapters")')
  process.exit(2)
}
const mode = invocation.mode
const restArgs = invocation.restArgs

if (mode === 'adapters') {
  await runAdapters(restArgs)
} else {
  const { appRoot, args } = parseLauncherArgs(restArgs, invocation.defaultAppRoot)

  process.env.BEYA_APP_ROOT = appRoot
  process.env.CLAUDE_APP_ROOT = appRoot
  process.env.CALLER_DIR ||= process.cwd()
  process.argv = [process.argv[0]!, process.argv[1]!, ...args]

  await import('../../preload.ts')

  if (mode === 'server') {
    const { startServer } = await import('../../src/server/index.ts')
    startServer()
  } else if (mode === 'cli') {
    await import('../../src/entrypoints/cli.tsx')
  } else {
    console.error(`beya-sidecar: unknown mode "${mode}" (expected "server", "cli" or "adapters")`)
    process.exit(2)
  }
}

async function runAdapters(rawArgs: string[]): Promise<void> {
  // adapters 模式的参数解析独立于 server/cli —— 这里只接受 --feishu /
  // --telegram / --wechat / --dingtalk 选择启用哪个适配器，再加可选的 --app-root（透传给
  // adapters/common/config.ts 内的 process.env 读取）。
  let appRoot: string | null = process.env.BEYA_APP_ROOT ?? process.env.CLAUDE_APP_ROOT ?? null
  let enableFeishu = false
  let enableTelegram = false
  let enableWechat = false
  let enableDingtalk = false

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]
    if (arg === '--app-root') {
      appRoot = rawArgs[i + 1] ?? null
      i += 1
      continue
    }
    if (arg === '--feishu') {
      enableFeishu = true
      continue
    }
    if (arg === '--telegram') {
      enableTelegram = true
      continue
    }
    if (arg === '--wechat') {
      enableWechat = true
      continue
    }
    if (arg === '--dingtalk') {
      enableDingtalk = true
      continue
    }
    console.warn(`beya-sidecar adapters: ignoring unknown arg "${arg}"`)
  }

  if (!enableFeishu && !enableTelegram && !enableWechat && !enableDingtalk) {
    console.error(
      'beya-sidecar adapters: must enable at least one of --feishu / --telegram / --wechat / --dingtalk',
    )
    process.exit(2)
  }

  if (appRoot) {
    process.env.BEYA_APP_ROOT = appRoot
    process.env.CLAUDE_APP_ROOT = appRoot
  }
  process.env.CALLER_DIR ||= process.cwd()

  await import('../../preload.ts')

  // 在 import adapter 之前先用同一份 loadConfig() 检查凭据。adapter 的
  // top-level 代码里已经有 if (!cred) process.exit(1)，但那会把整个
  // 进程拖死 —— 包括另一个本来正常的 adapter。这里提前 gate 一下，
  // 缺凭据的 adapter 直接跳过、不 import。
  const { loadConfig } = await import('../../adapters/common/config.ts')
  const config = loadConfig()

  let started = 0

  if (enableFeishu) {
    if (!config.feishu.appId || !config.feishu.appSecret) {
      console.warn(
        '[beya-sidecar] --feishu requested but FEISHU_APP_ID / FEISHU_APP_SECRET missing in env or Beya adapters config; skipping',
      )
    } else {
      console.log('[beya-sidecar] starting Feishu adapter')
      // 副作用 import：feishu/index.ts 顶层会自动 new WSClient + start()
      await import('../../adapters/feishu/index.ts')
      started += 1
    }
  }

  if (enableTelegram) {
    if (!config.telegram.botToken) {
      console.warn(
        '[beya-sidecar] --telegram requested but TELEGRAM_BOT_TOKEN missing in env or Beya adapters config; skipping',
      )
    } else {
      console.log('[beya-sidecar] starting Telegram adapter')
      // 副作用 import：telegram/index.ts 顶层会自动 bot.start()
      await import('../../adapters/telegram/index.ts')
      started += 1
    }
  }

  if (enableWechat) {
    if (!config.wechat.accountId || !config.wechat.botToken) {
      console.warn(
        '[beya-sidecar] --wechat requested but no QR-bound WeChat account found in env or Beya adapters config; skipping',
      )
    } else {
      console.log('[beya-sidecar] starting WeChat adapter')
      await import('../../adapters/wechat/index.ts')
      started += 1
    }
  }

  if (enableDingtalk) {
    if (!config.dingtalk.clientId || !config.dingtalk.clientSecret) {
      console.warn(
        '[beya-sidecar] --dingtalk requested but DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET missing in env or Beya adapters config; skipping',
      )
    } else {
      console.log('[beya-sidecar] starting DingTalk adapter')
      await import('../../adapters/dingtalk/index.ts')
      started += 1
    }
  }

  if (started === 0) {
    console.error(
      '[beya-sidecar] no adapter could be started; check credentials in env or Beya adapters config',
    )
    process.exit(1)
  }

  // 让进程保持存活：两个 adapter 都通过 long-lived WebSocket（Lark WSClient
  // / grammY long-polling）持有 event loop，自然不会退出。这里不需要额外
  // setInterval 兜底。两个 adapter 自己注册的 SIGINT handler 都会触发。
}
