@echo off
setlocal
cd /d "%~dp0"
title NOIR RIVER - online

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js not found. Install the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [1/3] Installing dependencies...
  call npm.cmd install --omit=dev
  if errorlevel 1 ( echo [!] npm install failed & pause & exit /b 1 )
)

if not exist cloudflared.exe (
  echo [2/3] Downloading Cloudflare Tunnel ^(cloudflared.exe, ~60 MB^)...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'"
  if not exist cloudflared.exe ( echo [!] Download failed. Check your internet connection. & pause & exit /b 1 )
)

echo [3/3] Starting the game server in a separate window...
start "NOIR RIVER server" cmd /k "npm.cmd start"
timeout /t 4 /nobreak >nul

echo.
echo ============================================================
echo  Wait for a line like:  https://something.trycloudflare.com
echo  Send that link + /play to your friends, for example:
echo     https://something.trycloudflare.com/play
echo  Keep BOTH windows open while you play. Ctrl+C to stop.
echo ============================================================
echo.
cloudflared.exe tunnel --no-autoupdate --url http://localhost:3000
pause
