@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-test-services.ps1" -Foreground %*
