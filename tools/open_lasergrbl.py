import os
import sys
import re
import urllib.parse
import urllib.request
import subprocess
import tempfile
import traceback
import ctypes

LOG_FILE = os.path.join(tempfile.gettempdir(), "lasergrbl_launcher.log")

def log(msg: str):
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"[{os.getenv('USERNAME', 'user')}] {msg}\n")
    except Exception:
        pass

def show_alert(title: str, message: str, is_error: bool = False):
    log(f"ALERT ({'ERROR' if is_error else 'INFO'}): {title} - {message}")
    try:
        icon = 0x10 if is_error else 0x40 # MB_ICONERROR or MB_ICONINFORMATION
        ctypes.windll.user32.MessageBoxW(0, message, title, icon | 0x0000) # MB_OK
    except Exception:
        pass

def find_lasergrbl_exe() -> str | None:
    candidates = [
        r"D:\Laser\LaserGRBL.exe",
        r"D:\Laser\LaserGRBL\LaserGRBL\bin\Release\LaserGRBL.exe",
        r"D:\Laser\LaserGRBL\LaserGRBL\bin\Debug\LaserGRBL.exe",
        r"D:\LaserGRBL\LaserGRBL.exe",
        r"D:\LaserGRBL\LaserGRBL\bin\Release\LaserGRBL.exe",
        r"D:\LaserGRBL\LaserGRBL\bin\Debug\LaserGRBL.exe",
        r"C:\Program Files (x86)\LaserGRBL\LaserGRBL.exe",
        r"C:\Program Files\LaserGRBL\LaserGRBL.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\LaserGRBL\LaserGRBL.exe"),
        os.path.expandvars(r"%APPDATA%\LaserGRBL\LaserGRBL.exe"),
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return None

def download_file(url: str, dest_path: str) -> bool:
    try:
        log(f"Downloading from {url} to {dest_path}")
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LaserGRBL-Launcher/1.0"}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
            with open(dest_path, "wb") as f:
                f.write(data)
        log(f"Download successful: {os.path.getsize(dest_path)} bytes")
        return True
    except Exception as e:
        log(f"Download failed: {traceback.format_exc()}")
        return False

def main():
    log(f"Launcher started. Args: {sys.argv}")
    if len(sys.argv) < 2:
        # User just ran the script directly
        laser_exe = find_lasergrbl_exe()
        if laser_exe:
            subprocess.Popen([laser_exe])
            return
        else:
            show_alert("LaserGRBL Launcher", "Không tìm thấy file LaserGRBL.exe trên máy. Vui lòng đảm bảo LaserGRBL.exe nằm tại D:\\Laser\\LaserGRBL.exe", is_error=True)
            return

    raw_arg = sys.argv[1].strip()
    log(f"Raw argument: {raw_arg}")

    laser_exe = find_lasergrbl_exe()
    if not laser_exe:
        show_alert(
            "Không tìm thấy LaserGRBL",
            "Không tìm thấy phần mềm LaserGRBL trên máy tính của bạn!\n\nĐường dẫn khuyến nghị: D:\\Laser\\LaserGRBL.exe",
            is_error=True
        )
        return

    target_gcode_path = None

    if raw_arg.startswith("lasergrbl://") or raw_arg.startswith("lasergrbl:"):
        # Format: lasergrbl://open?order=LSxxxx&url=https://...
        # or lasergrbl://https://... or lasergrbl://open/?...
        parsed = urllib.parse.urlparse(raw_arg)
        query = urllib.parse.parse_qs(parsed.query)

        download_url = None
        order_id = "order"

        if "url" in query:
            download_url = query["url"][0]
        elif parsed.netloc.startswith("http"):
            download_url = f"{parsed.netloc}{parsed.path}"
            if parsed.query:
                download_url += f"?{parsed.query}"

        if "order" in query:
            order_id = query["order"][0]
        elif not download_url and parsed.path:
            # Maybe path contains order id
            parts = parsed.path.strip("/").split("/")
            if parts:
                order_id = parts[-1]

        if download_url:
            # Download file .nc
            dest = os.path.join(tempfile.gettempdir(), f"{order_id}.nc")
            if download_file(download_url, dest):
                target_gcode_path = dest
            else:
                show_alert(
                    "Lỗi tải G-code",
                    f"Không thể tải file G-code từ server:\n{download_url}\nVui lòng kiểm tra kết nối mạng hoặc tải file .nc thủ công trên web.",
                    is_error=True
                )
                # Still open LaserGRBL so operator can work
                subprocess.Popen([laser_exe])
                return
        else:
            # No URL, maybe local order ID check
            possible_local_gcode = os.path.join(r"D:\Laser\storage\gcodes", f"{order_id}.nc")
            if os.path.isfile(possible_local_gcode):
                target_gcode_path = possible_local_gcode
    elif os.path.isfile(raw_arg):
        target_gcode_path = raw_arg

    # Launch LaserGRBL with file argument
    try:
        if target_gcode_path and os.path.isfile(target_gcode_path):
            log(f"Launching {laser_exe} with {target_gcode_path}")
            subprocess.Popen([laser_exe, target_gcode_path])
        else:
            log(f"Launching {laser_exe} without file")
            subprocess.Popen([laser_exe])
    except Exception as e:
        log(f"Error launching process: {traceback.format_exc()}")
        show_alert("Lỗi khởi chạy LaserGRBL", f"Không thể khởi chạy LaserGRBL:\n{str(e)}", is_error=True)

if __name__ == "__main__":
    main()
