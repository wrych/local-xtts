@echo off
setlocal
rem Change to the script directory
cd /d "%~dp0"

rem If a virtual environment Python exists, use it; otherwise fall back to system python
if exist "%~dp0venv\Scripts\python.exe" (
	"%~dp0venv\Scripts\python.exe" "%~dp0app.py"
) else (
	python "%~dp0app.py"
)

endlocal