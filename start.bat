@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1
title Liyuan Agent 1.0

:: Product root = this bat's folder
cd /d "%~dp0"
if not exist "package.json" (
  echo [ERROR] package.json not found. Put start.bat in the Liyuan folder.
  goto :fail
)
if not exist "server\main.ts" (
  echo [ERROR] server\main.ts not found. This is not the Liyuan product directory.
  goto :fail
)

echo.
echo  ========================================
echo    Liyuan Agent  v1.0
echo  ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node ^>= 22 and add to PATH.
  echo         https://nodejs.org/
  goto :fail
)

for /f "tokens=*" %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"
echo [liyuan] Node %NODE_VER%

:: First-run defaults (no personal keys)
if not exist "liyuan.config.json" if exist "liyuan.config.example.json" (
  echo [liyuan] Creating liyuan.config.json from example ...
  copy /Y "liyuan.config.example.json" "liyuan.config.json" >nul
)
if not exist "liyuan.agent.json" if exist "liyuan.agent.example.json" (
  echo [liyuan] Creating liyuan.agent.json from example ...
  copy /Y "liyuan.agent.example.json" "liyuan.agent.json" >nul
  echo [liyuan] Edit liyuan.agent.json and set your API key before chatting.
)

if not exist "node_modules\" (
  echo [liyuan] node_modules missing — running npm install ...
  echo [liyuan] First run needs network; later starts are offline-ready.
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    goto :fail
  )
  echo.
)

if not exist "web\dist\index.html" (
  echo [liyuan] Frontend dist missing, running web:build ...
  call npm run web:build
  if errorlevel 1 (
    echo [ERROR] Frontend build failed.
    goto :fail
  )
  echo.
)

set "PORT=7620"
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":%PORT% " ^| findstr LISTENING') do (
  echo [liyuan] Port %PORT% in use, killing PID %%p ...
  taskkill /F /PID %%p >nul 2>&1
)

echo [liyuan] Starting server on http://localhost:%PORT%
echo [liyuan] Continues last session. New session:  start.bat --new
echo [liyuan] Close this window to stop the server.
echo.

:: Delayed open via silent VBS (no second console)
set "VBS=%TEMP%\liyuan-open-browser.vbs"
> "%VBS%" echo WScript.Sleep 2000
>>"%VBS%" echo CreateObject("WScript.Shell").Run "http://localhost:%PORT%/", 1, False
wscript //nologo "%VBS%"

node server/main.ts %*
set "EC=%ERRORLEVEL%"

del /q "%VBS%" >nul 2>&1

echo.
if not "%EC%"=="0" (
  echo [liyuan] Exit code %EC%
) else (
  echo [liyuan] Stopped.
)
pause
exit /b %EC%

:fail
echo.
pause
exit /b 1
