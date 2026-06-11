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

function Read-RecentLogs([string[]]$LogFiles) {
  $chunks = @()
  foreach ($logFile in $LogFiles) {
    if (-not $logFile) {
      continue
    }

    $content = Get-Content -Raw -LiteralPath $logFile -ErrorAction SilentlyContinue
    if ($content) {
      $chunks += "[$([System.IO.Path]::GetFileName($logFile))]`n$content"
    }
  }

  if ($chunks.Count -eq 0) {
    return ""
  }

  return ($chunks -join "`n")
}

function Wait-Http([string]$Url, [string[]]$LogFiles, [scriptblock]$IsAlive) {
  for ($i = 0; $i -lt 120; $i++) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2 | Out-Null
      return
    } catch {
      if (-not (& $IsAlive)) {
        Write-Error "Process exited before $Url became ready. Recent log:`n$(Read-RecentLogs -LogFiles $LogFiles)"
      }
      Start-Sleep -Seconds 1
    }
  }

  throw "Timed out waiting for $Url. Recent log:`n$(Read-RecentLogs -LogFiles $LogFiles)"
}

function Test-HttpReady([string]$Url) {
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Test-AppRpcReady([string]$Address, [int]$Port) {
  $socket = [System.Net.WebSockets.ClientWebSocket]::new()
  $uri = [System.Uri]::new("ws://${Address}:$Port/rpc")
  $probeId = "startup-probe"

  try {
    $connectTask = $socket.ConnectAsync($uri, [System.Threading.CancellationToken]::None)
    if (-not $connectTask.Wait(2000)) {
      return $false
    }
    if ($socket.State -ne [System.Net.WebSockets.WebSocketState]::Open) {
      return $false
    }

    $payload = "{""type"":""rpc.request"",""id"":""$probeId"",""method"":""status.read"",""params"":{}}"
    $payloadBytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
    $sendTask = $socket.SendAsync(
      [System.ArraySegment[byte]]::new($payloadBytes),
      [System.Net.WebSockets.WebSocketMessageType]::Text,
      $true,
      [System.Threading.CancellationToken]::None
    )
    if (-not $sendTask.Wait(2000)) {
      return $false
    }

    $buffer = New-Object byte[] 8192
    $message = [System.Text.StringBuilder]::new()
    $deadline = [DateTime]::UtcNow.AddSeconds(3)
    while ([DateTime]::UtcNow -lt $deadline) {
      $remainingMs = [Math]::Max(1, [int]($deadline - [DateTime]::UtcNow).TotalMilliseconds)
      $cts = [System.Threading.CancellationTokenSource]::new($remainingMs)
      try {
        $receiveTask = $socket.ReceiveAsync([System.ArraySegment[byte]]::new($buffer), $cts.Token)
        if (-not $receiveTask.Wait($remainingMs)) {
          return $false
        }
        $result = $receiveTask.Result
      } catch {
        return $false
      } finally {
        $cts.Dispose()
      }

      if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
        return $false
      }

      if ($result.Count -gt 0) {
        [void]$message.Append([System.Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count))
      }

      if (-not $result.EndOfMessage) {
        continue
      }

      $rawMessage = $message.ToString()
      [void]$message.Clear()
      try {
        $rpcMessage = $rawMessage | ConvertFrom-Json
      } catch {
        continue
      }

      if ($rpcMessage.type -eq "rpc.connected") {
        continue
      }
      if ($rpcMessage.type -eq "rpc.response" -and $rpcMessage.id -eq $probeId -and [int]$rpcMessage.status -eq 200) {
        return $true
      }
      return $false
    }

    return $false
  } catch {
    return $false
  } finally {
    if ($socket.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
      try {
        $closeTask = $socket.CloseAsync(
          [System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure,
          "startup probe complete",
          [System.Threading.CancellationToken]::None
        )
        $closeTask.Wait(1000) | Out-Null
      } catch {
        # Ignore close failures; the probe result has already been decided.
      }
    }
    $socket.Dispose()
  }
}

function Wait-AppRpc([string]$Address, [int]$Port, [string[]]$LogFiles, [scriptblock]$IsAlive) {
  for ($i = 0; $i -lt 120; $i++) {
    if (Test-AppRpcReady $Address $Port) {
      return
    }
    if (-not (& $IsAlive)) {
      Write-Error "Process exited before ws://${Address}:$Port/rpc became ready. Recent log:`n$(Read-RecentLogs -LogFiles $LogFiles)"
    }
    Start-Sleep -Seconds 1
  }

  throw "Timed out waiting for ws://${Address}:$Port/rpc. Recent log:`n$(Read-RecentLogs -LogFiles $LogFiles)"
}

function Wait-PortAvailable([string]$Address, [int]$Port) {
  for ($i = 0; $i -lt 30; $i++) {
    if (-not (Test-PortInUse $Address $Port)) {
      return
    }
    Start-Sleep -Milliseconds 250
  }

  throw "Port $Port is still in use after stopping the listener."
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

function Stop-ListenerOnPort([int]$Port, [string]$ExpectedRoot, [switch]$ForceAny) {
  $connections = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  foreach ($connection in $connections) {
    $ownerPid = [int]$connection.OwningProcess
    if ($ownerPid -eq $PID) {
      continue
    }
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerPid" -ErrorAction SilentlyContinue
    $commandLine = ""
    if ($owner -and $owner.CommandLine) {
      $commandLine = [string]$owner.CommandLine
    }
    if ($ForceAny -or $commandLine.Contains($ExpectedRoot) -or $commandLine.Contains("src/server/index.ts") -or $commandLine.Contains("vite")) {
      Write-Host "Stopping process $ownerPid listening on port $Port."
      Stop-ProcessTree -ProcessId $ownerPid
    }
  }
}

function Quote-PowerShell([string]$Value) {
  return "'" + $Value.Replace("'", "''") + "'"
}

function Write-WebUiConfig(
  [string]$ConfigDir,
  [string]$HostAddress,
  [int]$ServerPort,
  [int]$WebPort,
  [string]$ServerUrl,
  [string]$WebUrl
) {
  $beyaDir = Join-Path $ConfigDir "beya"
  New-Item -ItemType Directory -Force -Path $beyaDir | Out-Null
  $configPath = Join-Path $beyaDir "web-ui.json"
  $config = [ordered]@{}

  if (Test-Path -LiteralPath $configPath) {
    try {
      $existing = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
      foreach ($property in $existing.PSObject.Properties) {
        $config[$property.Name] = $property.Value
      }
    } catch {
      # Keep going; the launcher owns only the fields below.
    }
  }

  $config["hostAddress"] = $HostAddress
  $config["serverPort"] = $ServerPort
  $config["webPort"] = $WebPort
  $config["serverUrl"] = $ServerUrl
  $config["webUrl"] = $WebUrl
  $config["updatedAt"] = (Get-Date).ToUniversalTime().ToString("o")

  $tmpPath = "$configPath.tmp.$PID"
  $config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $tmpPath -Encoding UTF8
  Move-Item -LiteralPath $tmpPath -Destination $configPath -Force
  return $configPath
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

$serverPortResolved = $ServerPort
$webPortResolved = $WebPort
if ($serverPortResolved -eq $webPortResolved) {
  throw "ServerPort and WebPort must be different. Both were set to $serverPortResolved."
}

$serverUrl = "http://${HostAddress}:$serverPortResolved"
$serverHealthUrl = "$serverUrl/health"
$webOrigin = "http://${HostAddress}:$webPortResolved"
$webStatusUrl = "$webOrigin/__beya_web_ui_status"
$webUrl = "$webOrigin/?serverUrl=$([uri]::EscapeDataString($serverUrl))"
$serverLog = Join-Path $LogDir "server.log"
$serverErr = Join-Path $LogDir "server.err.log"
$webLog = Join-Path $LogDir "web.log"
$webErr = Join-Path $LogDir "web.err.log"
$beyaConfigDir = $env:BEYA_CONFIG_DIR
if (-not $beyaConfigDir) {
  $beyaConfigDir = Join-Path $env:USERPROFILE ".beya"
}

$server = $null
$serverOwned = $false
$replacedIncompatibleServer = $false
if (Test-PortInUse $HostAddress $serverPortResolved) {
  Write-Host "Server port $serverPortResolved is in use; trying to reconnect."
  if ((Test-HttpReady $serverHealthUrl) -and (Test-AppRpcReady $HostAddress $serverPortResolved)) {
    Write-Host "Reusing existing server: $serverUrl"
  } else {
    Write-Host "Existing listener on server port $serverPortResolved is not a compatible Beya RPC server; stopping it."
    Stop-ListenerOnPort -Port $serverPortResolved -ExpectedRoot $rootDir -ForceAny
    Wait-PortAvailable $HostAddress $serverPortResolved
    $replacedIncompatibleServer = $true
  }
}

if ((-not (Test-HttpReady $serverHealthUrl)) -or (-not (Test-AppRpcReady $HostAddress $serverPortResolved))) {
  Write-Host "Starting server: $serverUrl"
  $serverCommand = @(
    "Set-Location -LiteralPath $(Quote-PowerShell $rootDir)"
    "`$env:SERVER_PORT='$serverPortResolved'"
    "`$env:DISABLE_TELEMETRY='1'"
    "`$env:BEYA_CONFIG_DIR=$(Quote-PowerShell $beyaConfigDir)"
    "& $(Quote-PowerShell $bun) run src/server/index.ts --host $(Quote-PowerShell $HostAddress) --port $serverPortResolved"
  ) -join "; "
  $server = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $serverCommand) -RedirectStandardOutput $serverLog -RedirectStandardError $serverErr -WindowStyle Hidden -PassThru
  $serverOwned = $true
}

try {
  if ($serverOwned) {
    Wait-Http $serverHealthUrl @($serverLog, $serverErr) { -not $server.HasExited }
    Wait-AppRpc $HostAddress $serverPortResolved @($serverLog, $serverErr) { -not $server.HasExited }
  }

  $web = $null
  $webOwned = $false
  if (Test-PortInUse $HostAddress $webPortResolved) {
    Write-Host "Web port $webPortResolved is in use; trying to reconnect."
    if ((-not $replacedIncompatibleServer) -and (Test-HttpReady $webStatusUrl)) {
      Write-Host "Reusing existing Web UI: $webOrigin"
    } else {
      if ($replacedIncompatibleServer) {
        Write-Host "Server was replaced; restarting Web UI on port $webPortResolved."
      } else {
        Write-Host "Existing listener on web port $webPortResolved is not the Beya Web UI; stopping it."
      }
      Stop-ListenerOnPort -Port $webPortResolved -ExpectedRoot $rootDir -ForceAny
      Wait-PortAvailable $HostAddress $webPortResolved
    }
  }

  if (-not (Test-HttpReady $webStatusUrl)) {
    Write-Host "Starting Web UI: $webOrigin"
    $webStartedAt = (Get-Date).ToUniversalTime().ToString("o")
    $webCommand = @(
      "Set-Location -LiteralPath $(Quote-PowerShell $desktopDir)"
      "`$env:VITE_DESKTOP_SERVER_URL='$serverUrl'"
      "`$env:VITE_BEYA_WEB_STARTED_AT='$webStartedAt'"
      "`$env:VITE_BEYA_WEB_PORT='$webPortResolved'"
      "& $(Quote-PowerShell $bun) run dev -- --host $(Quote-PowerShell $HostAddress) --port $webPortResolved --strictPort"
    ) -join "; "
    $web = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $webCommand) -RedirectStandardOutput $webLog -RedirectStandardError $webErr -WindowStyle Hidden -PassThru
    $webOwned = $true
  }

  if ($webOwned) {
    Wait-Http $webStatusUrl @($webLog, $webErr) { -not $web.HasExited }
  }

  $configPath = Write-WebUiConfig -ConfigDir $beyaConfigDir -HostAddress $HostAddress -ServerPort $serverPortResolved -WebPort $webPortResolved -ServerUrl $serverUrl -WebUrl $webUrl

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
  Write-Host "Config:"
  Write-Host "  $configPath"
  Write-Host ""
  Write-Host "Press Ctrl-C to stop both processes."

  while ($true) {
    Start-Sleep -Seconds 1
    if ($server) {
      $server.Refresh()
      if ($server.HasExited) {
        throw "Server process exited with code $($server.ExitCode). Recent log:`n$(Read-RecentLogs -LogFiles @($serverLog, $serverErr))"
      }
    } elseif (-not (Test-HttpReady $serverHealthUrl)) {
      throw "Reused server is no longer reachable: $serverUrl"
    }

    if ($web) {
      $web.Refresh()
      if ($web.HasExited) {
        throw "Web UI process exited with code $($web.ExitCode). Recent log:`n$(Read-RecentLogs -LogFiles @($webLog, $webErr))"
      }
    } elseif (-not (Test-HttpReady $webStatusUrl)) {
      throw "Reused Web UI is no longer reachable: $webOrigin"
    }
  }
} finally {
  if ($webOwned -and $web) {
    Stop-ProcessTree -ProcessId $web.Id
    Stop-ListenerOnPort -Port $webPortResolved -ExpectedRoot $rootDir
  }
  if ($serverOwned -and $server) {
    Stop-ProcessTree -ProcessId $server.Id
    Stop-ListenerOnPort -Port $serverPortResolved -ExpectedRoot $rootDir
  }
}
