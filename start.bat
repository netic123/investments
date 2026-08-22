@echo off
chcp 65001 >nul
title Pabrai Dashboard
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js hittades inte. Installera från https://nodejs.org och kör igen.
  pause
  exit /b 1
)
for /f "tokens=1 delims=v." %%a in ('node -v') do set NODEMAJ=%%a
if %NODEMAJ% LSS 18 (
  echo Node.js version %NODEMAJ% är för gammal — dashboarden kräver Node 18 eller nyare. Uppdatera via https://nodejs.org
  pause
  exit /b 1
)
echo Startar Pabrai Dashboard ... stäng detta fönster för att stoppa.
node server.js
pause
