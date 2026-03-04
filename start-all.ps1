$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

# Kill only processes bound to EquityFlow ports to avoid stopping OpenClaw gateway (node on 18789)
$portsToClear = @(3000, 8001)
foreach ($p in $portsToClear) {
	try {
		$lines = netstat -ano | Select-String ":$p\s"
		foreach ($line in $lines) {
			$parts = ($line.ToString() -replace "\s+", " ").Trim().Split(' ')
			$pid = $parts[-1]
			if ($pid -match '^\d+$') {
				taskkill /F /PID $pid 2>$null | Out-Null
			}
		}
	} catch {}
}
Start-Sleep -Milliseconds 700

# Clear stale Next.js build output to avoid MODULE_NOT_FOUND chunk/runtime errors
try {
	$nextDir = Join-Path $projectRoot ".next"
	if (Test-Path $nextDir) {
		Remove-Item -Path $nextDir -Recurse -Force -ErrorAction Stop
	}
} catch {
	Write-Output "Warning: Could not fully clear .next folder; continuing startup."
}

$backendCmd = "Set-Location '$projectRoot'; python -m uvicorn backend.main:app --host 0.0.0.0 --port 8001"
$frontendCmd = "Set-Location '$projectRoot'; npm run dev -- --port 3000"

Start-Process -FilePath "powershell.exe" -WorkingDirectory $projectRoot -ArgumentList "-NoExit", "-Command", $backendCmd | Out-Null
Start-Sleep -Milliseconds 1200
Start-Process -FilePath "powershell.exe" -WorkingDirectory $projectRoot -ArgumentList "-NoExit", "-Command", $frontendCmd | Out-Null

Start-Sleep -Seconds 2

$backendStatus = "down"
$frontendStatus = "down"

for ($i = 0; $i -lt 10; $i++) {
	try {
		$backendStatus = (Invoke-WebRequest -Uri "http://127.0.0.1:8001/api/status" -UseBasicParsing -TimeoutSec 3).StatusCode
		break
	} catch {
		Start-Sleep -Seconds 1
	}
}

for ($i = 0; $i -lt 20; $i++) {
	try {
		$frontendStatus = (Invoke-WebRequest -Uri "http://127.0.0.1:3000" -UseBasicParsing -TimeoutSec 3).StatusCode
		break
	} catch {
		Start-Sleep -Seconds 1
	}
}

Write-Output "Started backend and frontend in new terminals."
Write-Output "Backend health: http://127.0.0.1:8001/api/status (status: $backendStatus)"
Write-Output "Frontend: http://localhost:3000 (status: $frontendStatus)"
