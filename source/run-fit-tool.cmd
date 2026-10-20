@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required. Please install it before running this script.
  pause >nul
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm ci
  if errorlevel 1 (
    echo npm ci failed. Press any key to exit.
    pause >nul
    exit /b 1
  )
)

echo Starting FIT web tool, opening browser at http://localhost:3000 ...
call npm start

endlocal
