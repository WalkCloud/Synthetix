@echo off
REM Synthetix launcher. Sets the runtime environment, runs first-run setup
REM (secrets + DB), then starts the production Next.js server on port 3000
REM and opens the browser. Closing this window stops the server.
setlocal

set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"

set "DATA_DIR=%APP_DIR%data"
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

REM Point all storage at the bundled data dir (inside the install dir).
set "DB_PATH=%DATA_DIR%"
set "DOCUMENT_ROOT=%DATA_DIR%\documents"

REM Use the bundled Python + keep the RAG daemon enabled.
set "PYTHON_PATH=%APP_DIR%runtime\python\python.exe"
set "PYTHON_DAEMON_ENABLED=true"

set "NODE_ENV=production"
set "PORT=3000"
set "HOSTNAME=127.0.0.1"
set "NEXT_PUBLIC_APP_URL=http://localhost:3000"
set "NEXT_PUBLIC_APP_NAME=Synthetix"

title Synthetix Server

echo ================================================
echo  Synthetix  -  first-run setup
echo ================================================
"%APP_DIR%runtime\node.exe" "%APP_DIR%first-run.js"
if errorlevel 1 (
  echo.
  echo [ERROR] First-run setup failed. Press any key to close.
  pause >nul
  exit /b 1
)

echo.
echo ================================================
echo  Synthetix is starting at http://localhost:3000
echo  (keep this window open; close it to stop the server)
echo ================================================
echo.

REM Open the browser once the server has had a moment to bind.
start "" http://localhost:3000

"%APP_DIR%runtime\node.exe" "%APP_DIR%node_modules\next\dist\bin\next" start -p 3000
