@echo off
setlocal enabledelayedexpansion
title Blackboarder - In-Place Auto-Updater

echo ====================================================
echo   Blackboarder - Academic Companion Auto-Updater
echo ====================================================
echo.
echo [1/3] Contacting GitHub for latest code...

set "TARGET_DIR=%~dp0"
set "WORK_DIR=%TEMP%\blackboarder-update-%RANDOM%"
set "TEMP_ZIP=%WORK_DIR%.zip"
rem The repository archive always exists; the built extension lives in its dist folder.
set "ZIP_URL=https://github.com/yvs1n/blackboarder/archive/refs/heads/main.zip"

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
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%TEMP_ZIP%' -DestinationPath '%WORK_DIR%' -Force"
set "SRC_DIST="
for /d %%D in ("%WORK_DIR%\*") do if exist "%%D\dist\manifest.json" set "SRC_DIST=%%D\dist"

if not defined SRC_DIST (
    echo.
    echo [ERROR] The downloaded archive does not contain a built extension.
    echo.
    del /f /q "%TEMP_ZIP%" >nul 2>&1
    rmdir /s /q "%WORK_DIR%" >nul 2>&1
    pause
    exit /b 1
)

xcopy "%SRC_DIST%\*" "%TARGET_DIR%" /E /Y /I /Q >nul
del /f /q "%TEMP_ZIP%" >nul 2>&1
rmdir /s /q "%WORK_DIR%" >nul 2>&1

echo.
echo ====================================================
echo   SUCCESS! Blackboarder is updated to latest code!
echo   All tasks, courses, and your Sync Key are intact.
echo   Click the Blackboarder extension icon to continue.
echo ====================================================
echo.
pause
