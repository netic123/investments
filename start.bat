@echo off
chcp 65001 >nul
title Investments
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org and run again.
  pause
  exit /b 1
)
for /f "tokens=1 delims=v." %%a in ('node -v') do set NODEMAJ=%%a
if %NODEMAJ% LSS 18 (
  echo Node.js version %NODEMAJ% is too old - Investments needs Node 18 or newer. Update via https://nodejs.org
  pause
  exit /b 1
)
echo Starting Investments ... close this window to stop.
node server.js
pause
