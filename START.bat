@echo off
title ÜberDoodle - Complete Launcher
color 0A

echo.
echo ===========================================================
echo     UBERDOODLE - GOLPO-ACCURATE PRESET
echo ===========================================================
echo.
echo Starting all services...
echo.

:: Check for Node.js
where node >nul 2>nul
if errorlevel 1 (
    color 0C
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js from https://nodejs.org
    pause
    exit /b 1
)

:: Check for node_modules
if not exist "node_modules" (
    echo [SETUP] Installing dependencies...
    echo This may take a few minutes on first run...
    echo.
    call npm install
    if errorlevel 1 (
        color 0C
        echo [ERROR] npm install failed!
        pause
        exit /b 1
    )
    echo.
    echo [SETUP] Dependencies installed successfully!
    echo.
)

:: Check for .env.local
if not exist ".env.local" (
    echo [CONFIG] Creating default .env.local file...
    copy .env.example .env.local >nul
    color 0E
    echo.
    echo [WARNING] Please edit .env.local and add GEMINI_API_KEY and GENAIPRO_JWT!
    echo.
)

:: Start CORS Proxy in a new window
echo [STARTING] CORS Proxy Server (Port 3002)...
start "ÜberDoodle - CORS Proxy" cmd /k "node cors-proxy.mjs"

:: Give the proxy time to start
timeout /t 3 /nobreak >nul

:: Start Vite development server
echo [STARTING] Vite Development Server (Port 5173)...
echo.
echo ===========================================================
echo   UBERDOODLE IS STARTING...
echo.
echo   Web App:     http://localhost:5173
echo   CORS Proxy:  http://localhost:3002
echo.
echo   Press Ctrl+C to stop the server
echo ===========================================================
echo.

call npm run dev

pause
