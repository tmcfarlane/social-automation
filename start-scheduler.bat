@echo off
cd /d C:\Users\Trent\rep\social-automation

:: Start dashboard in background
start /b npx tsx src/dashboard/server.ts >> "C:\Users\Trent\rep\COMMAND CENTER\Command Center\SocialMediaEngine\X\state\dashboard.log" 2>&1

:: Run scheduler (foreground, logs to file)
npx tsx src/scheduler.ts >> "C:\Users\Trent\rep\COMMAND CENTER\Command Center\SocialMediaEngine\X\state\scheduler.log" 2>&1
