@echo off
rem ===================================================================
rem  Infection's Wake - Windows 10 launcher
rem  Double-click this file to play. It starts a small local web server
rem  and opens the game in your default browser.
rem
rem  Uses Node.js if you have it; otherwise falls back to Windows'
rem  built-in PowerShell (no installation required either way).
rem  Close the black window when you are done playing.
rem ===================================================================
setlocal
cd /d "%~dp0"
title Infection's Wake

where node >nul 2>nul
if %errorlevel%==0 (
  echo Starting Infection's Wake with Node.js ...
  node server.mjs
  goto :done
)

echo Node.js not found - starting with built-in PowerShell instead ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"

:done
echo.
echo The game server has stopped.
pause
