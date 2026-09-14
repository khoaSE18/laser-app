@echo off
chcp 65001 > nul
echo Dang day code len GitHub khoaSE18/laser-app...
git push -u origin main
echo.
echo ========================================================
if %errorlevel% equ 0 (
    echo [OK] DA DAY CODE LEN GITHUB THANH CONG!
) else (
    echo [!] Neu gap loi, vui long kiem tra dang nhap GitHub.
)
echo ========================================================
pause
