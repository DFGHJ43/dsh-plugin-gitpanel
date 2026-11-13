@echo off
setlocal
cd /d "%~dp0.."
set LOG=%~dp0out\syntax.log
if not exist "%~dp0out" mkdir "%~dp0out"
if exist "%LOG%" del "%LOG%"
node --check index.js >> "%LOG%" 2>&1 && echo index.js OK >> "%LOG%" || echo index.js FAIL >> "%LOG%"
node --check client.js >> "%LOG%" 2>&1 && echo client.js OK >> "%LOG%" || echo client.js FAIL >> "%LOG%"
node --check lib\git-core.js >> "%LOG%" 2>&1 && echo lib/git-core.js OK >> "%LOG%" || echo lib/git-core.js FAIL >> "%LOG%"
node --check lib\git-read.js >> "%LOG%" 2>&1 && echo lib/git-read.js OK >> "%LOG%" || echo lib/git-read.js FAIL >> "%LOG%"
node --check tests\check-layout.mjs >> "%LOG%" 2>&1 && echo tests/check-layout.mjs OK >> "%LOG%" || echo tests/check-layout.mjs FAIL >> "%LOG%"
