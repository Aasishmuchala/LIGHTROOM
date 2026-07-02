# Canonical selftest runner: launches lightmatch.html?selftest in real Chrome
# (own profile), polls the window title for the SELFTEST verdict, cleans up.
# Usage: powershell -File probes\run-selftest.ps1 [-Url <file url>] [-TimeoutSec 30]
param(
  [string]$Url = "file:///C:/Users/aasis/lightmatch/lightmatch.html?selftest",
  [int]$TimeoutSec = 30
)
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) { $chrome = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" }
$profile = Join-Path $env:TEMP "lm-selftest-profile"
Start-Process $chrome -ArgumentList "--user-data-dir=$profile","--no-first-run","--window-size=700,400",$Url | Out-Null
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$verdict = $null
while ((Get-Date) -lt $deadline -and -not $verdict) {
  Start-Sleep -Milliseconds 500
  $w = Get-CimInstance Win32_Process -Filter "Name='chrome.exe' or Name='msedge.exe'" |
       Where-Object { $_.CommandLine -like "*lm-selftest-profile*" }
  foreach ($proc in $w) {
    $t = (Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue).MainWindowTitle
    if ($t -match "SELFTEST:") { $verdict = $t; break }
  }
}
$w = Get-CimInstance Win32_Process -Filter "Name='chrome.exe' or Name='msedge.exe'" |
     Where-Object { $_.CommandLine -like "*lm-selftest-profile*" }
$w | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -Confirm:$false -ErrorAction Stop } catch {} }
if ($verdict) { Write-Output $verdict.Replace(" - Google Chrome","").Replace(" - Microsoft Edge","") }
else { Write-Output "SELFTEST: NO VERDICT within ${TimeoutSec}s"; exit 1 }
if ($verdict -match "FAIL|NO VERDICT") { exit 1 } else { exit 0 }
