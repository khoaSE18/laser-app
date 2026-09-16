@echo off
chcp 65001 > nul
title BANG DIEU HANH XUONG LASER - MKS DLC32
echo ========================================================
echo   TRUNG TAM DIEU HANH XUONG KHAC LASER (MKS DLC32)
echo ========================================================
echo.
echo [1] Mo Quan Ly Xuong truc tiep tren Server Cloud (Khuyen dung - May nhe 100%%)
echo [2] Chay Server cuc bo tren may tinh (Offline)
echo.
set /p choice="Nhap lua chon cua ban [1 hoac 2, mac dinh la 1]: "

if "%choice%"=="2" (
    echo.
    echo [*] Dang khoi dong Server cuc bo (Da toi uu hoa bo nho, 0%% CPU reload)...
    start http://localhost:8000/admin
    python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
) else (
    echo.
    echo [*] Dang mo Bang Quan Ly Xuong tren Server Cloud 24/7...
    start https://laser-app-7wod.onrender.com/admin
)

