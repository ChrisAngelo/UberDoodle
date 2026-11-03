@echo off
title DoodleMinds Studio - Install Dependencies
color 0E

echo.
echo ===========================================================
echo     DOODLEMINDS STUDIO - DEPENDENCY INSTALLER
echo ===========================================================
echo.
echo Installing npm packages...
echo.

call npm install

if errorlevel 1 (
    color 0C
    echo.
    echo [ERROR] Installation failed!
    pause
    exit /b 1
)

echo.
echo ===========================================================
echo   Installation complete!
echo.
echo   Now run START.bat to launch the studio.
echo ===========================================================
echo.

pause
