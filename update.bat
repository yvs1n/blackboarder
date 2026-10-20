@echo off
setlocal enabledelayedexpansion
title Blackboarder - In-Place Auto-Updater

echo ====================================================
echo   Blackboarder - Academic Companion Auto-Updater
echo ====================================================
echo.
echo [1/3] Contacting GitHub for latest code...

set "TARGET_DIR=%~dp0"
set "TEMP_ZIP=%TEMP%\blackboarder-update-%RANDOM%.zip"
set "ZIP_URL=https://raw.githubusercontent.com/yvs1n/blackboarder/main/release/blackboarder-extension.zip"

echo [2/3] Downloading latest extension files...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object Net.WebClient).DownloadFile('%ZIP_URL%', '%TEMP_ZIP%')"

if not exist "%TEMP_ZIP%" (
    echo.
    echo [ERROR] Download failed. Please check your internet connection or GitHub repository.
    echo.
    pause
    exit /b 1
)

echo [3/3] Updating extension files in place...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%TEMP_ZIP%' -DestinationPath '%TARGET_DIR%' -Force"
del /f /q "%TEMP_ZIP%" >nul 2>&1

echo.
echo ====================================================
echo   SUCCESS! Blackboarder is updated to latest code!
echo   All tasks, courses, and your Sync Key are intact.
echo   Click the Blackboarder extension icon to continue.
echo ====================================================
echo.
pause
