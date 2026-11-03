@echo off
title ÜberDoodle - Development Server
color 0A

echo.
echo ===========================================================
echo     UBERDOODLE - DEV SERVER ONLY
echo ===========================================================
echo.
echo NOTE: Make sure the CORS proxy is running separately!
echo       Run start-proxy.bat in another window first.
echo.
echo ===========================================================
echo.

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
)

npm run dev

pause
