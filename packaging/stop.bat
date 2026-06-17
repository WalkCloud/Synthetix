@echo off
REM Stop the local Synthetix server (the Next.js process bound to port 3000
REM and its child processes, e.g. the Python RAG daemon).
echo Stopping Synthetix server (port 3000)...
set "FOUND=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /PID %%a /T /F >nul 2>&1
  if not errorlevel 1 (
    echo Stopped PID %%a
    set "FOUND=1"
  )
)
if "%FOUND%"=="0" echo No Synthetix server found on port 3000.
timeout /t 2 >nul
