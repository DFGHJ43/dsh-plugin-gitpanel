@echo off
setlocal
rem Build the fixture under tests\out\fixture-repo. The plugin checkout is never
rem initialized or reconfigured here, so its own Git identity stays untouched.
if not exist "%~dp0out" mkdir "%~dp0out"
set FIXTURE=%~dp0out\fixture-repo
if exist "%FIXTURE%" rmdir /s /q "%FIXTURE%"
mkdir "%FIXTURE%"
mkdir "%FIXTURE%\docs"
cd /d "%FIXTURE%"
set LOG=%~dp0out\fixture.log
if exist "%LOG%" del "%LOG%"
git init -b main . > "%LOG%" 2>&1
git config user.name "GitPanel Test" >> "%LOG%" 2>&1
git config user.email "gitpanel@example.com" >> "%LOG%" 2>&1
echo Fixture base. > base.txt
git add -A >> %LOG% 2>&1
git commit -m "Add git panel bundle" >> %LOG% 2>&1
git branch feature/graph >> %LOG% 2>&1
git checkout feature/graph >> %LOG% 2>&1
mkdir docs 2>nul
echo Feature notes for the commit graph window. > docs/feature-note.md
git add -A >> %LOG% 2>&1
git commit -m "Document the commit graph window" >> %LOG% 2>&1
git checkout main >> %LOG% 2>&1
mkdir docs 2>nul
echo Main branch note. > docs/main-note.md
git add -A >> %LOG% 2>&1
git commit -m "Add main branch note" >> %LOG% 2>&1
git checkout -b hotfix/icon main >> %LOG% 2>&1
mkdir docs 2>nul
echo Icon colour probe. > docs/icon-note.md
git add -A >> %LOG% 2>&1
git commit -m "Tweak icon contrast" >> %LOG% 2>&1
git checkout main >> %LOG% 2>&1
git merge --no-ff feature/graph -m "Merge branch 'feature/graph'" >> %LOG% 2>&1
echo --- branches --- >> %LOG% 2>&1
git branch -vv >> %LOG% 2>&1
echo --- graph --- >> %LOG% 2>&1
git log --graph --oneline --all >> %LOG% 2>&1
echo --- status --- >> %LOG% 2>&1
git status --short >> %LOG% 2>&1
