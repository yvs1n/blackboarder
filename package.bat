@echo off
echo ====================================================
echo  Blackboarder - Production Packager
echo ====================================================
echo.

node scripts/package.js

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Packaging failed with exit code %ERRORLEVEL%.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [SUCCESS] Release archives created in .\release\
echo.
pause
