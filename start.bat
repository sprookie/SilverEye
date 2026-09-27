@echo off
chcp 65001 >nul
title SilverEye 摄影模拟器

cd /d "%~dp0"

echo.
echo   ==========================================
echo     SilverEye · 沉浸式摄影模拟器
echo   ==========================================
echo.

REM ---------- 找 Python ----------
set PY=
if exist "F:\.venv\Scripts\python.exe" set PY=F:\.venv\Scripts\python.exe
if "%PY%"=="" if exist "%USERPROFILE%\.workbuddy\binaries\python\envs\default\Scripts\python.exe" set PY=%USERPROFILE%\.workbuddy\binaries\python\envs\default\Scripts\python.exe
if "%PY%"=="" (
  where python >nul 2>nul && set PY=python
)
if "%PY%"=="" (
  echo   [!] 没找到 Python。请安装 Python 3.10+ 后重试。
  pause & exit /b 1
)
echo   使用 Python: %PY%

REM ---------- 依赖 ----------
"%PY%" -c "import fastapi, uvicorn, requests" 2>nul
if errorlevel 1 (
  echo   正在安装依赖 fastapi / uvicorn / requests ...
  "%PY%" -m pip install -q fastapi uvicorn requests
)

REM ---------- 代理隔离（关键：否则本机 ComfyUI 请求会被代理拦掉）----------
set HTTP_PROXY=
set HTTPS_PROXY=
set http_proxy=
set https_proxy=
set NO_PROXY=*

echo.
"%PY%" server.py --host 127.0.0.1 --port 8770

pause
