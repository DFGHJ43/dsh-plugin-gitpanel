@echo off
setlocal
cd /d "%~dp0.."
set OUT=%~dp0out
if not exist "%OUT%" mkdir "%OUT%"
git log --all --topo-order --no-color -n 120 --pretty=format:%%H%%x1f%%P%%x1f%%an%%x1f%%at%%x1f%%s%%x1f%%D%%x1e > "%OUT%\log.txt" 2>&1
git for-each-ref --format=%%(refname:short)	%%(HEAD)	%%(objectname)	%%(upstream:short)	%%(upstream:track) refs/heads > "%OUT%\refs.txt" 2>&1
git status --porcelain=v1 --untracked-files=no > "%OUT%\status.txt" 2>&1
