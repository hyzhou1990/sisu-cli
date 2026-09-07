@echo off
REM SiSu CLI installer for Windows CMD. Delegates to install.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-RestMethod https://www.sisu.chat/install.ps1 | Invoke-Expression"
if errorlevel 1 exit /b 1
