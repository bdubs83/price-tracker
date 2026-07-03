@echo off
setlocal

cd /d "%~dp0"

echo Building Official Price Comparison Tool...
call npm.cmd run build
if errorlevel 1 (
  echo Build failed.
  exit /b 1
)

echo Deploying Hosting, Firestore rules, and Storage rules to vendor-compare...
call firebase deploy --only hosting,firestore:rules,storage --project vendor-compare
if errorlevel 1 (
  echo Deploy failed.
  exit /b 1
)

echo Done.
