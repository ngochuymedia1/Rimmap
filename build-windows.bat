@echo off
setlocal
cd /d "%~dp0"

echo.
echo ==============================
echo   Rimmap Windows Build 1.0.0
echo ==============================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found.
  echo Install Node.js LTS, then reopen this window.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm was not found.
  echo Reinstall Node.js LTS, then reopen this window.
  pause
  exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo ERROR: Rust/Cargo was not found.
  echo Install Rust with rustup and use the stable-msvc toolchain.
  echo See BUILD_WINDOWS.md for the one-time setup steps.
  pause
  exit /b 1
)

echo [1/2] Installing/updating JavaScript build dependencies...
call npm install
if errorlevel 1 goto :fail

echo.
echo [2/2] Building the Rimmap Windows application and NSIS installer...
call npm run desktop:build
if errorlevel 1 goto :fail

echo.
echo BUILD COMPLETE.
echo Installer folder:
echo   %CD%\src-tauri\target\release\bundle\nsis\
echo.
pause
exit /b 0

:fail
echo.
echo BUILD FAILED.
echo Read the error above and BUILD_WINDOWS.md. If you send me the error text,
echo I can tell you exactly what to fix.
echo.
pause
exit /b 1
