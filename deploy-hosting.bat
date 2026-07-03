@echo off
setlocal

cd /d "%~dp0"

echo Building Official Price Comparison Tool...
call npm.cmd run build
if errorlevel 1 (
  echo Build failed.
  exit /b 1
)

echo Deploying to Firebase Hosting project vendor-compare...
call firebase deploy --only hosting --project vendor-compare
if errorlevel 1 (
  echo Deploy failed.
  exit /b 1
)

echo Done.
