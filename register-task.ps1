# Registers the scheduler as a Windows Task Scheduler task that starts on login.
# Run once as Administrator (or your user account if it has sufficient rights).

$taskName  = "X-Social-Automation-Scheduler"
$batFile   = "C:\Users\Trent\rep\social-automation\start-scheduler.bat"
$logDir    = "C:\Users\Trent\rep\COMMAND CENTER\Command Center\SocialMediaEngine\X\state"

# Ensure log dir exists
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# Remove old task if it exists
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action  = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$batFile`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Run only when Chrome debug port is reachable — handled by the script itself
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -StartWhenAvailable

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -RunLevel Highest `
    -Description "Alternates X outbound/inbound engagement every 24-42 min" `
    -Force

Write-Host "`nTask '$taskName' registered. It will start automatically on next login." -ForegroundColor Green
Write-Host "To start it now: Start-ScheduledTask -TaskName '$taskName'"
Write-Host "To stop it:      Stop-ScheduledTask  -TaskName '$taskName'"
Write-Host "Log file:        $logDir\scheduler.log"
