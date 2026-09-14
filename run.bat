@echo off
chcp 65001 > nul
title May Khac Laser - Web to Print Server
echo =========================================================
echo   HE THONG WEB DAT KHAC LASER TU DONG - MKS DLC32
echo =========================================================
echo.
echo [*] Dang khoi dong Web Server tren cong 8000...
echo [*] Trang khach dat hang:   http://localhost:8000
echo [*] Trang quan tri xuong:   http://localhost:8000/admin
echo.
echo Nhan Ctrl+C de dung server bat cu luc nao.
echo =========================================================
echo.

python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
pause
