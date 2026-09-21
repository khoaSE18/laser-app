@echo off
chcp 65001 >nul
title Cài Đặt Kết Nối LaserGRBL 1-Click
echo ======================================================
echo    CÀI ĐẶT KẾT NỐI 1-CHẠM GIỮA WEB VÀ LASERGRBL
echo ======================================================
echo.

set SCRIPT_DIR=%~dp0
set PY_HANDLER=%SCRIPT_DIR%tools\open_lasergrbl.py

:: Tìm pythonw.exe hoặc python.exe
set PYTHON_BIN=
for /f "tokens=*" %%i in ('where pythonw 2^>nul') do (
    if not defined PYTHON_BIN set PYTHON_BIN=%%i
)

if not defined PYTHON_BIN (
    for /f "tokens=*" %%i in ('where python 2^>nul') do (
        if not defined PYTHON_BIN set PYTHON_BIN=%%i
    )
)

if not defined PYTHON_BIN (
    if exist "%LOCALAPPDATA%\Programs\Python\Python313\pythonw.exe" (
        set "PYTHON_BIN=%LOCALAPPDATA%\Programs\Python\Python313\pythonw.exe"
    ) else if exist "%LOCALAPPDATA%\Programs\Python\Python312\pythonw.exe" (
        set "PYTHON_BIN=%LOCALAPPDATA%\Programs\Python\Python312\pythonw.exe"
    )
)

if not defined PYTHON_BIN (
    echo [LỖI] Không tìm thấy Python trên máy!
    echo Vui lòng cài đặt Python hoặc thêm Python vào biến môi trường PATH.
    pause
    exit /b 1
)

echo [+] Đã tìm thấy Python: %PYTHON_BIN%
echo [+] Đường dẫn script xử lý: %PY_HANDLER%
echo.

:: Đăng ký giao thức URL lasergrbl:// trong HKCU (Không cần quyền Admin)
reg add "HKCU\Software\Classes\lasergrbl" /ve /d "URL:LaserGRBL Protocol" /f >nul
if errorlevel 1 (
    echo [LỖI] Không thể tạo registry key HKCU\Software\Classes\lasergrbl
    pause
    exit /b 1
)

reg add "HKCU\Software\Classes\lasergrbl" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\lasergrbl\shell\open\command" /ve /d "\"%PYTHON_BIN%\" \"%PY_HANDLER%\" \"%%1\"" /f >nul
if errorlevel 1 (
    echo [LỖI] Không thể cấu hình lệnh mở protocol
    pause
    exit /b 1
)

echo ======================================================
echo  [THÀNH CÔNG] ĐÃ ĐĂNG KÝ GIAO THỨC lasergrbl:// !
echo.
echo  Từ bây giờ, khi bạn bấm "Mở LaserGRBL" trên web
echo  (dù là web trên Render Cloud hay web nội bộ),
echo  phần mềm LaserGRBL sẽ tự động bật lên và nạp sẵn
echo  file G-code của khách hàng ngay trên màn hình máy tính!
echo ======================================================
echo.
pause
