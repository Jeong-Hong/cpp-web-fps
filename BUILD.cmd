@echo off
setlocal
cd /d "%~dp0"
set "SDK=%EMSDK%"
if not defined SDK set "SDK=D:\Tools\emsdk"
if exist "%SDK%\python\3.13.3_64bit\python.exe" (
 "%SDK%\python\3.13.3_64bit\python.exe" scripts/build.py %*
) else (
 python scripts/build.py %*
)
if errorlevel 1 (pause & exit /b 1)
echo Build complete. Run START.cmd.
