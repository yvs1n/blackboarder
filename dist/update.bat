@echo off
title Blackboarder updater
rem Updates Blackboarder now and turns on automatic updates. Run it once; your data is kept.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0updater\blackboarder-updater.ps1" -Install
echo.
pause
