@echo off
chcp 65001 > nul
title BANG DIEU HANH XUONG LASER - MKS DLC32
echo ========================================================
echo   TRUNG TAM DIEU HANH XUONG KHAC LASER (MKS DLC32)
echo ========================================================
echo.
echo [*] Dang khoi dong bang quan ly xuong noi bo...
echo [*] Tu dong mo trinh duyet quan tri tai: http://localhost:8000/admin
echo.

start http://localhost:8000/admin
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
pause
