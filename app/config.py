import os

# Đường dẫn thư mục gốc
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_DIR = os.path.join(BASE_DIR, "storage")
UPLOAD_DIR = os.path.join(STORAGE_DIR, "uploads")
GCODE_DIR = os.path.join(STORAGE_DIR, "gcodes")
PREVIEW_DIR = os.path.join(STORAGE_DIR, "previews")

for folder in [STORAGE_DIR, UPLOAD_DIR, GCODE_DIR, PREVIEW_DIR]:
    os.makedirs(folder, exist_ok=True)

# Thông tin thanh toán VietQR (Tài khoản thật của bạn)
BANK_CONFIG = {
    "bank_id": "VIB",                  # Ngân hàng Quốc Tế VIB
    "account_no": "352445940",         # Số tài khoản
    "account_name": "HOANG TUAN KHOA", # Tên chủ tài khoản
    "template": "compact2",           # Mẫu VietQR chuẩn Napas247
}

# Mật khẩu quản trị xưởng (/admin)
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "khoa2026")

# Đường dẫn máy chủ Cloud Render (Dành cho máy xưởng tự động kéo đơn về)
RENDER_CLOUD_URL = os.environ.get("RENDER_CLOUD_URL", "https://laser-app-7wod.onrender.com")

# Mã Token xác thực Webhook Ngân Hàng (SePay / Casso)
WEBHOOK_TOKEN = os.environ.get("WEBHOOK_TOKEN", "khoa2026_webhook_secret")

# Thông tin liên hệ & Hỗ trợ tư vấn thiết kế Zalo
ZALO_PHONE = "0352445940"
HOTLINE = "0352 445 940"
ZALO_LINK = f"https://zalo.me/{ZALO_PHONE}"




# Cấu hình máy Laser & Bo MKS DLC32
LASER_MACHINE = {
    "max_width_mm": 400.0,
    "max_height_mm": 400.0,
    "max_laser_power": 1000,      # S1000 trong GRBL
    "rapid_speed": 3500,          # Tốc độ di chuyển không tải G0 (mm/phút)
    "lines_per_mm": 5.0,          # Độ phân giải (5 dòng/mm = bước 0.2mm - chuẩn cho khắc gỗ/da)
}

# Bảng cấu hình chất liệu & Đơn giá
MATERIALS = {
    "wood_plywood": {
        "name": "Gỗ Dán Plywood (3mm)",
        "base_price": 20000,       # Phí phôi cơ bản (VNĐ)
        "price_per_cm2": 350,      # Đơn giá diện tích (VNĐ/cm²)
        "price_per_minute": 2000,  # Chi phí khấu hao & công khắc (VNĐ/phút)
        "feedrate": 1800,          # Tốc độ khắc F (mm/phút)
        "laser_power_pct": 80,     # Công suất laser (%)
        "color": "#d7b485",        # Màu phôi để preview
        "burn_color": "#3d1f05"    # Màu cháy laser
    },
    "wood_pine": {
        "name": "Gỗ Thông Tự Nhiên",
        "base_price": 35000,
        "price_per_cm2": 500,
        "price_per_minute": 2500,
        "feedrate": 1500,
        "laser_power_pct": 85,
        "color": "#ecd6ab",
        "burn_color": "#2c1503"
    },
    "leather": {
        "name": "Da Bò Thật",
        "base_price": 50000,
        "price_per_cm2": 600,
        "price_per_minute": 3000,
        "feedrate": 2200,
        "laser_power_pct": 60,
        "color": "#8b522b",
        "burn_color": "#1c0d04"
    },
    "acrylic_black": {
        "name": "Mica Đen Chuyên Dụng",
        "base_price": 30000,
        "price_per_cm2": 450,
        "price_per_minute": 2200,
        "feedrate": 1400,
        "laser_power_pct": 90,
        "color": "#1e1e1e",
        "burn_color": "#ffffff"    # Mica đen khắc ra nét trắng
    },
    "customer_material": {
        "name": "Khách Tự Mang Phôi Đến",
        "base_price": 10000,       # Chỉ tính phí setup
        "price_per_cm2": 300,
        "price_per_minute": 2000,
        "feedrate": 1800,
        "laser_power_pct": 75,
        "color": "#e0e0e0",
        "burn_color": "#2a2a2a"
    }
}

# Đường dẫn LaserGRBL trên máy tính xưởng (Tìm tự động hoặc cấu hình thủ công)
LASERGRBL_CANDIDATE_PATHS = [
    r"D:\LaserGRBL\LaserGRBL\bin\Release\LaserGRBL.exe",
    r"D:\LaserGRBL\LaserGRBL\bin\Debug\LaserGRBL.exe",
    r"D:\LaserGRBL\LaserGRBL.exe",
    r"C:\Program Files (x86)\LaserGRBL\LaserGRBL.exe",
    r"C:\Program Files\LaserGRBL\LaserGRBL.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Programs\LaserGRBL\LaserGRBL.exe"),
    os.path.expandvars(r"%APPDATA%\LaserGRBL\LaserGRBL.exe"),
]

