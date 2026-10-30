@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (echo Node.js 24 or newer is required. & pause & exit /b 1)
if not exist "node_modules\ws\package.json" (
 call npm.cmd ci --ignore-scripts
 if errorlevel 1 (pause & exit /b 1)
)
if not exist "build\sim.wasm" (echo Build missing. Run BUILD.cmd first. & pause & exit /b 1)
if not exist "web\dist\client.wasm" (echo Client build missing. Run BUILD.cmd first. & pause & exit /b 1)
echo CROSSYARD - server address is printed below. Ctrl+C to stop.
node server/main.mjs %*
if errorlevel 1 pause
