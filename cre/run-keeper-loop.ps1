# LPFY CRE liquidation keeper loop (Sepolia)
# Runs simulate every 5 minutes. Logs to keeper-loop.log next to this script.
#
# Usage (from anywhere):
#   powershell -ExecutionPolicy Bypass -File ".\cre\run-keeper-loop.ps1"
#   powershell -ExecutionPolicy Bypass -File ".\cre\run-keeper-loop.ps1" -Broadcast
#   powershell -ExecutionPolicy Bypass -File ".\cre\run-keeper-loop.ps1" -IntervalSeconds 300 -Broadcast
#
# Stop with Ctrl+C.

param(
  [switch]$Broadcast,
  [int]$IntervalSeconds = 300,
  [string]$Target = "staging-settings",
  [string]$LogFile = ""
)

$ErrorActionPreference = "Continue"
$CreRoot = $PSScriptRoot
Set-Location -LiteralPath $CreRoot

$LogDir = Join-Path $CreRoot "log"
if (-not (Test-Path -LiteralPath $LogDir)) {
  New-Item -ItemType Directory -Path $LogDir | Out-Null
}
if (-not $LogFile) {
  $LogFile = Join-Path $LogDir "logFile.txt"
}

# UTF-8 console so CRE checkmarks / dashes do not become mojibake
try {
  chcp 65001 | Out-Null
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch {}

function Write-Log([string]$Line) {
  Write-Host $Line
  Add-Content -LiteralPath $LogFile -Value $Line -Encoding utf8
}

function Invoke-KeeperOnce {
  $argsList = @(
    "workflow", "simulate", "liquidation-keeper",
    "--non-interactive",
    "--trigger-index", "0",
    "--target", $Target
  )
  if ($Broadcast) {
    $argsList += "--broadcast"
  }

  # cmd avoids PowerShell wrapping stderr as NativeCommandError
  $joined = ($argsList | ForEach-Object {
    if ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
  }) -join " "
  $raw = cmd /c "cre $joined 2>&1"

  $raw | Where-Object {
    $_ -and
    $_ -notmatch 'Simulation complete! Ready to deploy' -and
    $_ -notmatch 'cre account access' -and
    $_ -notmatch 'Update available!' -and
    $_ -notmatch 'Run `cre update`' -and
    $_ -notmatch 'visit https://github.com/smartcontractkit/cre-cli' -and
    $_ -notmatch 'NativeCommandError' -and
    $_ -notmatch 'FullyQualifiedErrorId' -and
    $_ -notmatch 'CategoryInfo' -and
    $_ -notmatch '^\s*\+\s' -and
    $_ -notmatch 'RemoteException'
  } | ForEach-Object {
    Write-Log $_
  }
}

Write-Host ""
Write-Host "LPFY CRE keeper loop" -ForegroundColor Cyan
Write-Host "  folder:   $CreRoot"
Write-Host "  target:   $Target"
Write-Host "  interval: ${IntervalSeconds}s"
Write-Host "  broadcast: $(if ($Broadcast) { 'yes (on-chain txs)' } else { 'no (dry run)' })"
Write-Host "  log:      $LogFile"
Write-Host "  stop:     Ctrl+C"
Write-Host ""

while ($true) {
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Log "===== Keeper run $ts ====="
  try {
    Invoke-KeeperOnce
  } catch {
    Write-Log "ERROR: $($_.Exception.Message)"
  }
  Write-Log ""
  Start-Sleep -Seconds $IntervalSeconds
}
