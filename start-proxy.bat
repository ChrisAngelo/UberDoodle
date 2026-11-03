@echo off
title DoodleMinds - CORS Proxy Server
color 0B

echo.
echo ===========================================================
echo     DOODLEMINDS CORS PROXY SERVER
echo ===========================================================
echo.
echo This proxy server enables GenAiPro API access.
echo Keep this window open while using the studio.
echo.
echo Endpoints:
echo   /proxy/health          - Health check
echo   /proxy/genaipro/*      - GenAiPro API proxy
echo   /proxy/fetch-audio     - Audio file fetcher
echo.
echo ===========================================================
echo.

node cors-proxy.mjs

pause
