@echo off
setlocal
cd /d "%~dp0"
title NOIR RIVER - online (SSH tunnel)

where node >nul 2>nul
if errorlevel 1 ( echo [!] Install Node.js LTS from https://nodejs.org & pause & exit /b 1 )
where ssh >nul 2>nul
if errorlevel 1 ( echo [!] OpenSSH client not found. Settings - Apps - Optional features - add "OpenSSH Client". & pause & exit /b 1 )

if not exist node_modules (
  echo Installing dependencies...
  call npm.cmd install --omit=dev
)

echo Starting the game server in a separate window...
start "NOIR RIVER server" cmd /k "npm.cmd start"
timeout /t 4 /nobreak >nul

echo.
echo ============================================================
echo  Tunnel through SSH on port 443 (pinggy.io, no sign-up).
echo  If asked for a password - just press Enter.
echo  Look for a link like  https://xxxx.a.pinggy.link
echo  Send friends that link + /play
echo  Keep BOTH windows open while you play.
echo ============================================================
echo.
ssh -p 443 -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -R0:localhost:3000 free.pinggy.io
echo.
echo Tunnel closed. Run this file again to get a new link.
echo Backup option: ssh -o StrictHostKeyChecking=accept-new -R 80:localhost:3000 nokey@localhost.run
pause
