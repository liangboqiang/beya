param(
  [ValidateSet("web", "cli", "desktop", "tauri", "docs", "telegram", "feishu", "wechat", "dingtalk", "help")]
  [string]$Mode = "web",
  [string]$HostAddress = "127.0.0.1",
  [int]$ServerPort = 3456,
  [int]$WebPort = 5173,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ExtraArgs
)

$ErrorActionPreference = "Stop"

function Show-Help {
  Write-Host "Beya launcher"
  Write-Host ""
  Write-Host "Usage:"
  Write-Host "  .\start-beya.ps1                    Start Web UI + backend"
  Write-Host "  .\start-beya.ps1 help               Show launcher help"
  Write-Host "  .\start-beya.ps1 -Mode cli          Start CLI"
  Write-Host "  .\start-beya.ps1 -Mode desktop      Start desktop Web frontend only"
  Write-Host "  .\start-beya.ps1 -Mode tauri        Start Tauri desktop app"
  Write-Host "  .\start-beya.ps1 -Mode docs         Start docs dev server"
  Write-Host "  .\start-beya.ps1 -Mode telegram     Start Telegram adapter"
  Write-Host "  .\start-beya.ps1 -Mode feishu       Start Feishu adapter"
  Write-Host "  .\start-beya.ps1 -Mode wechat       Start WeChat adapter"
  Write-Host "  .\start-beya.ps1 -Mode dingtalk     Start DingTalk adapter"
  Write-Host ""
  Write-Host "Web options:"
  Write-Host "  -HostAddress 127.0.0.1"
  Write-Host "  -ServerPort 3456"
  Write-Host "  -WebPort 5173"
}

function Resolve-Bun {
  $command = Get-Command bun -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $userBun = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
  if (Test-Path -LiteralPath $userBun) {
    return $userBun
  }

  throw "Missing required command: bun"
}

function Invoke-BeyaCli([string[]]$ArgsToPass) {
  $callerDir = (Get-Location).Path
  if (-not $env:CALLER_DIR) {
    $env:CALLER_DIR = $callerDir
  }

  Set-Location -LiteralPath $rootDir

  if (-not $env:BEYA_CONFIG_DIR) {
    $env:BEYA_CONFIG_DIR = Join-Path $env:USERPROFILE ".beya"
  }

  if ($env:BEYA_FORCE_RECOVERY_CLI -eq "1" -or $env:CLAUDE_CODE_FORCE_RECOVERY_CLI -eq "1") {
    & $bun ./src/localRecoveryCli.ts @ArgsToPass
    return
  }

  if ($env:BEYA_SKIP_DOTENV -eq "1") {
    & $bun --env-file=NUL ./src/entrypoints/cli.tsx @ArgsToPass
    return
  }

  if (Test-Path -LiteralPath (Join-Path $rootDir ".env")) {
    & $bun --env-file=.env ./src/entrypoints/cli.tsx @ArgsToPass
    return
  }

  & $bun ./src/entrypoints/cli.tsx @ArgsToPass
}

if ($Mode -eq "help") {
  Show-Help
  exit 0
}

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopDir = Join-Path $rootDir "desktop"
$adaptersDir = Join-Path $rootDir "adapters"
$bun = Resolve-Bun

switch ($Mode) {
  "web" {
    & (Join-Path $rootDir "scripts\start-web-ui.ps1") -HostAddress $HostAddress -ServerPort $ServerPort -WebPort $WebPort
  }
  "cli" {
    Invoke-BeyaCli $ExtraArgs
  }
  "desktop" {
    Set-Location -LiteralPath $desktopDir
    & $bun run dev
  }
  "tauri" {
    Set-Location -LiteralPath $desktopDir
    & $bun run tauri dev @ExtraArgs
  }
  "docs" {
    Set-Location -LiteralPath $rootDir
    & $bun run docs:dev
  }
  "telegram" {
    Set-Location -LiteralPath $adaptersDir
    & $bun run telegram
  }
  "feishu" {
    Set-Location -LiteralPath $adaptersDir
    & $bun run feishu
  }
  "wechat" {
    Set-Location -LiteralPath $adaptersDir
    & $bun run wechat
  }
  "dingtalk" {
    Set-Location -LiteralPath $adaptersDir
    & $bun run dingtalk
  }
}
