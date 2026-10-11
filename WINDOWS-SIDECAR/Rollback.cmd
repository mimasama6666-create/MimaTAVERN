@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Rollback.ps1" %*
if errorlevel 1 (echo Operation failed. See errors above.)
pause
