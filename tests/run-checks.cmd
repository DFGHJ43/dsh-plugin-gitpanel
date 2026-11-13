@echo off
setlocal
cd /d "%~dp0.."
if not exist "%~dp0out" mkdir "%~dp0out"
node "%~dp0check-layout.mjs" > "%~dp0out\check.json" 2>&1
node "%~dp0check-actions.mjs" > "%~dp0out\actions.json" 2>&1
node "%~dp0check-routes.mjs" > "%~dp0out\routes.json" 2>&1
node "%~dp0check-client-source.mjs" > "%~dp0out\client-source.json" 2>&1
