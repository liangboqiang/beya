param(
  [string]$HostAddress = "127.0.0.1",
  [int]$ServerPort = 3456,
  [int]$WebPort = 5173,
  [int]$MaxPortScan = 100,
  [string]$LogDir = "",
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"

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

function Test-PortInUse([string]$Address, [int]$Port) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $async = $client.BeginConnect($Address, $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(200)) {
      return $false
    }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Find-AvailablePort([string]$Address, [int]$StartPort, [int]$ScanCount) {
  for ($port = $StartPort; $port -le ($StartPort + $ScanCount); $port++) {
    if (-not (Test-PortInUse $Address $port)) {
      return $port
    }
  }

  throw "No available port found in range $StartPort-$($StartPort + $ScanCount)"
}

function Wait-Http([string]$Url, [string]$LogFile, [scriptblock]$IsAlive) {
  for ($i = 0; $i -lt 120; $i++) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2 | Out-Null
      return
    } catch {
      if (-not (& $IsAlive)) {
        Write-Error "Process exited before $Url became ready. Recent log:`n$(Get-Content -Raw -LiteralPath $LogFile -ErrorAction SilentlyContinue)"
      }
      Start-Sleep -Seconds 1
    }
  }

  throw "Timed out waiting for $Url. Recent log:`n$(Get-Content -Raw -LiteralPath $LogFile -ErrorAction SilentlyContinue)"
}

function Stop-ProcessTree([int]$ProcessId) {
  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
  foreach ($child in $children) {
    Stop-ProcessTree -ProcessId ([int]$child.ProcessId)
  }

  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($process) {
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Stop-ListenerOnPort([int]$Port, [string]$ExpectedRoot) {
  $connections = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  foreach ($connection in $connections) {
    $ownerPid = [int]$connection.OwningProcess
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerPid" -ErrorAction SilentlyContinue
    $commandLine = ""
    if ($owner -and $owner.CommandLine) {
      $commandLine = [string]$owner.CommandLine
    }
    if ($commandLine.Contains($ExpectedRoot) -or $commandLine.Contains("src/server/index.ts") -or $commandLine.Contains("vite")) {
      Stop-ProcessTree -ProcessId $ownerPid
    }
  }
}

function Quote-PowerShell([string]$Value) {
  return "'" + $Value.Replace("'", "''") + "'"
}

$rootDir = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$desktopDir = Join-Path $rootDir "desktop"
$bun = Resolve-Bun

if (-not (Test-Path -LiteralPath $desktopDir)) {
  throw "Desktop directory not found: $desktopDir"
}

if (-not $LogDir) {
  $runId = "$(Get-Date -Format yyyyMMddHHmmss)-$PID"
  $LogDir = Join-Path $env:TEMP "beya-web-ui-$runId"
}
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$serverPortResolved = Find-AvailablePort $HostAddress $ServerPort $MaxPortScan
$webPortResolved = Find-AvailablePort $HostAddress $WebPort $MaxPortScan
if ($webPortResolved -eq $serverPortResolved) {
  $webPortResolved = Find-AvailablePort $HostAddress ($webPortResolved + 1) $MaxPortScan
}

$serverUrl = "http://${HostAddress}:$serverPortResolved"
$webUrl = "http://${HostAddress}:$webPortResolved/?serverUrl=$([uri]::EscapeDataString($serverUrl))"
$serverLog = Join-Path $LogDir "server.log"
$serverErr = Join-Path $LogDir "server.err.log"
$webLog = Join-Path $LogDir "web.log"
$webErr = Join-Path $LogDir "web.err.log"
$beyaConfigDir = $env:BEYA_CONFIG_DIR
if (-not $beyaConfigDir) {
  $beyaConfigDir = Join-Path $env:USERPROFILE ".beya"
}

Write-Host "Starting server: $serverUrl"
$serverCommand = @(
  "Set-Location -LiteralPath $(Quote-PowerShell $rootDir)"
  "`$env:SERVER_PORT='$serverPortResolved'"
  "`$env:DISABLE_TELEMETRY='1'"
  "`$env:BEYA_CONFIG_DIR=$(Quote-PowerShell $beyaConfigDir)"
  "`$env:BEYA_CONFIG_DIR=`$env:BEYA_CONFIG_DIR"
  "& $(Quote-PowerShell $bun) run src/server/index.ts --host $(Quote-PowerShell $HostAddress) --port $serverPortResolved"
) -join "; "
$server = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $serverCommand) -RedirectStandardOutput $serverLog -RedirectStandardError $serverErr -WindowStyle Hidden -PassThru

try {
  Wait-Http "$serverUrl/api/health" $serverLog { -not $server.HasExited }

  Write-Host "Starting Web UI: http://${HostAddress}:$webPortResolved"
  $webStartedAt = (Get-Date).ToUniversalTime().ToString("o")
  $webCommand = @(
    "Set-Location -LiteralPath $(Quote-PowerShell $desktopDir)"
    "`$env:VITE_DESKTOP_SERVER_URL='$serverUrl'"
    "`$env:VITE_BEYA_WEB_STARTED_AT='$webStartedAt'"
    "`$env:VITE_BEYA_WEB_PORT='$webPortResolved'"
    "& $(Quote-PowerShell $bun) run dev -- --host $(Quote-PowerShell $HostAddress) --port $webPortResolved --strictPort"
  ) -join "; "
  $web = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $webCommand) -RedirectStandardOutput $webLog -RedirectStandardError $webErr -WindowStyle Hidden -PassThru

  Wait-Http "http://${HostAddress}:$webPortResolved" $webLog { -not $web.HasExited }

  Write-Host ""
  Write-Host "Web UI is ready:"
  Write-Host "  $webUrl"
  if (-not $NoOpen) {
    try {
      Start-Process $webUrl
      Write-Host "Opened Web UI in your browser."
    } catch {
      Write-Warning "Unable to open the browser automatically. Open this URL manually: $webUrl"
    }
  }
  Write-Host ""
  Write-Host "Backend:"
  Write-Host "  $serverUrl"
  Write-Host ""
  Write-Host "Logs:"
  Write-Host "  $serverLog"
  Write-Host "  $webLog"
  Write-Host ""
  Write-Host "Press Ctrl-C to stop both processes."

  while (-not $server.HasExited -and -not $web.HasExited) {
    Start-Sleep -Seconds 1
    $server.Refresh()
    $web.Refresh()
  }

  if ($server.HasExited) {
    throw "Server process exited with code $($server.ExitCode). Recent log:`n$(Get-Content -Raw -LiteralPath $serverLog -ErrorAction SilentlyContinue)"
  }

  throw "Web UI process exited with code $($web.ExitCode). Recent log:`n$(Get-Content -Raw -LiteralPath $webLog -ErrorAction SilentlyContinue)"
} finally {
  if ($web) {
    Stop-ProcessTree -ProcessId $web.Id
  }
  if ($server) {
    Stop-ProcessTree -ProcessId $server.Id
  }
  Stop-ListenerOnPort -Port $webPortResolved -ExpectedRoot $rootDir
  Stop-ListenerOnPort -Port $serverPortResolved -ExpectedRoot $rootDir
}
