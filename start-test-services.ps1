[CmdletBinding()]
param(
  [switch]$Stop,
  [switch]$Restart,
  [switch]$Open,
  [switch]$NoWait,
  [switch]$Foreground,
  [switch]$CleanLogs
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$StateDir = Join-Path $RepoRoot ".tmp-test-services"
$ServerPort = 3737
$WebPort = 5173
$ServerUrl = "http://127.0.0.1:$ServerPort"
$WebUrl = "http://127.0.0.1:$WebPort"

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Get-ProcessCommandLine {
  param([int]$ProcessId)
  try {
    return (Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId").CommandLine
  } catch {
    return ""
  }
}

function Stop-ProcessTree {
  param([int]$ProcessId)

  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
  foreach ($child in $children) {
    Stop-ProcessTree -ProcessId ([int]$child.ProcessId)
  }

  if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Stop-TrackedPid {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) { return }
  $raw = Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $raw) { return }
  $processId = [int]$raw
  if (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
    Write-Step "Stopping tracked process tree $processId"
    Stop-ProcessTree -ProcessId $processId
  }
  Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
}

function Stop-RepoListener {
  param([int]$Port)

  $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) {
    $processId = [int]$listener.OwningProcess
    $commandLine = Get-ProcessCommandLine -ProcessId $processId
    if ($commandLine -and $commandLine.Contains($RepoRoot)) {
      Write-Step "Stopping repo process $processId on port $Port"
      Stop-ProcessTree -ProcessId $processId
    } else {
      throw "Port $Port is already used by process $processId and does not look like this repo. Stop it first or change ports."
    }
  }
}

function Stop-TestServices {
  Write-Step "Stopping CACP test services"
  Stop-TrackedPid -Path (Join-Path $StateDir "server.pid")
  Stop-TrackedPid -Path (Join-Path $StateDir "web.pid")
  Stop-TrackedPid -Path (Join-Path $StateDir "adapter.pid")
  Stop-RepoListener -Port $ServerPort
  Stop-RepoListener -Port $WebPort
}

function Test-HttpOk {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return [int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Wait-Until {
  param(
    [string]$Name,
    [scriptblock]$Check,
    [int]$TimeoutSeconds = 45
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (& $Check) {
      Write-Step "$Name is ready"
      return
    }
    Start-Sleep -Milliseconds 500
  }

  throw "$Name did not become ready within $TimeoutSeconds seconds."
}

function Start-TestService {
  param(
    [string]$Name,
    [string[]]$Arguments,
    [string]$PidFile,
    [string]$OutLog,
    [string]$ErrLog
  )

  Write-Step "Starting $Name"
  Remove-Item -LiteralPath $OutLog -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $ErrLog -Force -ErrorAction SilentlyContinue

  $process = Start-Process `
    -FilePath "corepack" `
    -ArgumentList $Arguments `
    -WorkingDirectory $RepoRoot `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrLog `
    -PassThru `
    -WindowStyle Hidden

  Set-Content -LiteralPath $PidFile -Value $process.Id -Encoding ascii
  Write-Host "    pid:  $($process.Id)"
  Write-Host "    logs: $OutLog"
}

function Start-TestServices {
  $serverRunning = Test-HttpOk -Url $serverHealthUrl
  $webRunning = Test-HttpOk -Url "$WebUrl/"

  if (-not $serverRunning) {
    Stop-RepoListener -Port $ServerPort
    Start-TestService `
      -Name "CACP server ($ServerUrl)" `
      -Arguments @("pnpm", "dev:server") `
      -PidFile (Join-Path $StateDir "server.pid") `
      -OutLog (Join-Path $StateDir "server.out.log") `
      -ErrLog (Join-Path $StateDir "server.err.log")
  } else {
    Write-Step "CACP server is already running at $ServerUrl"
  }

  if (-not $webRunning) {
    Stop-RepoListener -Port $WebPort
    Start-TestService `
      -Name "CACP web ($WebUrl)" `
      -Arguments @("pnpm", "dev:web") `
      -PidFile (Join-Path $StateDir "web.pid") `
      -OutLog (Join-Path $StateDir "web.out.log") `
      -ErrLog (Join-Path $StateDir "web.err.log")
  } else {
    Write-Step "CACP web is already running at $WebUrl"
  }
}

function Invoke-ForegroundLifecycle {
  try {
    Start-TestServices

    if (-not $NoWait) {
      Wait-Until -Name "Server" -Check { Test-HttpOk -Url $serverHealthUrl }
      Wait-Until -Name "Web" -Check { Test-HttpOk -Url "$WebUrl/" }
    }

    if ($Open) {
      Start-Process $WebUrl
    }

    Write-Host ""
    Write-Host "CACP test services" -ForegroundColor Green
    Write-Host "Server: $ServerUrl"
    Write-Host "Web:    $WebUrl"
    Write-Host "Press Ctrl+C or close this window to stop services."
    Write-Host ""

    $logs = @(
      Join-Path $StateDir "server.out.log"
      Join-Path $StateDir "server.err.log"
      Join-Path $StateDir "web.out.log"
      Join-Path $StateDir "web.err.log"
    )
    foreach ($log in $logs) {
      if (-not (Test-Path -LiteralPath $log)) {
        New-Item -ItemType File -Path $log -Force | Out-Null
      }
    }

    Get-Content -LiteralPath $logs -Tail 20 -Wait
  } finally {
    Stop-TestServices
  }
}

New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

if ($Stop -or $Restart) {
  Stop-TestServices
  if ($Stop -and -not $Restart) {
    Write-Step "Stopped"
    exit 0
  }
}

if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) {
  throw "corepack was not found in PATH. Install Node.js/Corepack first."
}

if ($CleanLogs) {
  Get-ChildItem -LiteralPath $StateDir -Filter "*.log" -ErrorAction SilentlyContinue | Remove-Item -Force
}

$serverHealthUrl = "$ServerUrl/health"

if ($Foreground) {
  Invoke-ForegroundLifecycle
  exit 0
}

Start-TestServices

if (-not $NoWait) {
  Wait-Until -Name "Server" -Check { Test-HttpOk -Url $serverHealthUrl }
  Wait-Until -Name "Web" -Check { Test-HttpOk -Url "$WebUrl/" }
}

if ($Open) {
  Start-Process $WebUrl
}

Write-Host ""
Write-Host "CACP test services are ready." -ForegroundColor Green
Write-Host "Web:    $WebUrl"
Write-Host "Server: $ServerUrl"
Write-Host "Logs:   $StateDir"
Write-Host ""
Write-Host "Stop services:"
Write-Host "  .\start-test-services.ps1 -Stop"
Write-Host ""
Write-Host "Restart services:"
Write-Host "  .\start-test-services.ps1 -Restart"
