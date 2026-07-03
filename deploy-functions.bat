@echo off
setlocal

cd /d "%~dp0"

echo Deploying Cloud Functions to vendor-compare...
call firebase deploy --only functions --project vendor-compare
if errorlevel 1 (
  echo Functions deploy failed.
  exit /b 1
)

echo Done.
