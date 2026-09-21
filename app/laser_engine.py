import os
import io
import base64
import numpy as np
from PIL import Image, ImageOps, ImageEnhance
from app.config import LASER_MACHINE, MATERIALS

def process_and_dither_image(image_input, width_mm: float, height_mm: float, mode: str = "photo", lines_per_mm: float = None):
    """
    Xử lý ảnh: Resize chuẩn theo kích thước mm và áp dụng thuật toán Dithering (như LaserGRBL)
    """
    if lines_per_mm is None:
        lines_per_mm = LASER_MACHINE["lines_per_mm"]

    # Mở ảnh nếu là file path hoặc byte stream
    if isinstance(image_input, str):
        img = Image.open(image_input)
    elif isinstance(image_input, bytes):
        img = Image.open(io.BytesIO(image_input))
    else:
        img = image_input

    # Chuyển RGBA sang RGB với nền trắng nếu có kênh alpha
    if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
        alpha_img = img.convert('RGBA')
        background = Image.new('RGBA', alpha_img.size, (255, 255, 255))
        alpha_composite = Image.alpha_composite(background, alpha_img)
        img = alpha_composite.convert('RGB')
    else:
        img = img.convert('RGB')

    # Tính kích thước điểm ảnh theo mm
    target_width_px = max(10, int(round(width_mm * lines_per_mm)))
    target_height_px = max(10, int(round(height_mm * lines_per_mm)))

    # Resize bằng Lanczos chống răng cưa
    img_resized = img.resize((target_width_px, target_height_px), Image.Resampling.LANCZOS)

    # Chuyển sang ảnh xám
    gray_img = img_resized.convert('L')

    if mode == "vector":
        # Chế độ Logo/Chữ nét: Tăng độ nét và phân ngưỡng nhị phân
        enhancer = ImageEnhance.Contrast(gray_img)
        gray_img = enhancer.enhance(2.0)
        # Phân ngưỡng trắng đen tuyệt đối
        threshold = 140
        dithered_img = gray_img.point(lambda p: 255 if p > threshold else 0, mode='1')
    else:
        # Chế độ Chân dung (Photo): Tăng tương phản nhẹ + Dithering Floyd-Steinberg
        enhancer = ImageEnhance.Contrast(gray_img)
        gray_img = enhancer.enhance(1.25)
        # Dithering Floyd-Steinberg chuẩn 1-bit
        dithered_img = gray_img.convert('1', dither=Image.Dither.FLOYDSTEINBERG)

    return img_resized, dithered_img

def generate_preview_image(dithered_img: Image.Image, material_key: str):
    """
    Tạo ảnh mô phỏng vết cháy laser trên bề mặt vật liệu đã chọn (gỗ, da, mica...)
    """
    material = MATERIALS.get(material_key, MATERIALS["wood_plywood"])
    mat_color_hex = material["color"].lstrip('#')
    burn_color_hex = material["burn_color"].lstrip('#')

    # Chuyển hex sang RGB tuple
    mat_rgb = tuple(int(mat_color_hex[i:i+2], 16) for i in (0, 2, 4))
    burn_rgb = tuple(int(burn_color_hex[i:i+2], 16) for i in (0, 2, 4))

    # Lấy mảng nhị phân từ ảnh dithered: 0 là đen (đốt), 255 là trắng (không đốt)
    arr = np.array(dithered_img.convert('L'))
    h, w = arr.shape
    preview_arr = np.zeros((h, w, 3), dtype=np.uint8)

    # Điểm trắng -> màu phôi vật liệu
    # Điểm đen -> màu cháy laser
    burn_mask = (arr < 128)
    preview_arr[~burn_mask] = mat_rgb
    preview_arr[burn_mask] = burn_rgb

    preview_img = Image.fromarray(preview_arr, 'RGB')
    return preview_img

def calculate_time_and_pricing(dithered_img: Image.Image, width_mm: float, height_mm: float, material_key: str):
    """
    Phân tích mật độ điểm đốt để tính chính xác thời gian gia công và giá thành
    """
    material = MATERIALS.get(material_key, MATERIALS["wood_plywood"])
    feedrate = material["feedrate"]
    rapid_speed = LASER_MACHINE["rapid_speed"]
    lines_per_mm = LASER_MACHINE["lines_per_mm"]

    arr = np.array(dithered_img.convert('L'))
    height_px, width_px = arr.shape
    pixel_step_mm = 1.0 / lines_per_mm

    total_rapid_dist = 0.0
    total_burn_dist = 0.0

    # Duyệt từng dòng quét zíc-zắc 2 chiều (như LaserGRBL)
    for y_idx in range(height_px):
        row = arr[y_idx]
        if y_idx % 2 == 1:
            row = row[::-1] # Dòng lẻ quét ngược lại

        # Tìm các đoạn liên tục trắng (không đốt) và đen (đốt)
        in_burn = False
        segment_start = 0

        for x_idx, val in enumerate(row):
            is_black = (val < 128)
            if is_black and not in_burn:
                # Bắt đầu đoạn đốt
                white_len = (x_idx - segment_start) * pixel_step_mm
                total_rapid_dist += white_len
                segment_start = x_idx
                in_burn = True
            elif not is_black and in_burn:
                # Kết thúc đoạn đốt
                burn_len = (x_idx - segment_start) * pixel_step_mm
                total_burn_dist += burn_len
                segment_start = x_idx
                in_burn = False

        # Đoạn cuối dòng
        rem_len = (width_px - segment_start) * pixel_step_mm
        if in_burn:
            total_burn_dist += rem_len
        else:
            total_rapid_dist += rem_len

        # Khoảng cách nhảy giữa các dòng Y
        total_rapid_dist += pixel_step_mm

    # Tính thời gian ước tính (phút)
    time_burn_min = total_burn_dist / feedrate
    time_rapid_min = total_rapid_dist / rapid_speed
    # Cộng thêm 15% thời gian giảm/tăng tốc (Acceleration factor)
    estimated_minutes = round((time_burn_min + time_rapid_min) * 1.15, 1)
    if estimated_minutes < 0.5:
        estimated_minutes = 0.5

    # Tính diện tích (cm²)
    area_cm2 = (width_mm * height_mm) / 100.0

    # Tính chi phí chi tiết
    base_price = material["base_price"]
    area_price = area_cm2 * material["price_per_cm2"]
    time_price = estimated_minutes * material["price_per_minute"]

    total_raw = base_price + area_price + time_price
    # Làm tròn đến 1.000 VNĐ
    total_price = int(round(total_raw / 1000.0) * 1000)

    return {
        "width_mm": width_mm,
        "height_mm": height_mm,
        "area_cm2": round(area_cm2, 1),
        "estimated_minutes": estimated_minutes,
        "burn_distance_m": round(total_burn_dist / 1000.0, 2),
        "base_price": base_price,
        "area_price": int(round(area_price)),
        "time_price": int(round(time_price)),
        "total_price": total_price,
        "material_name": material["name"]
    }

def generate_grbl_gcode(dithered_img: Image.Image, width_mm: float, height_mm: float, material_key: str, output_path: str):
    """
    Sinh file G-code chuẩn (.nc / .gcode) tối ưu cho bo MKS DLC32 (GRBL)
    Áp dụng thuật toán quét zíc-zắc, bỏ khoảng trắng G0, dynamic laser M4
    """
    material = MATERIALS.get(material_key, MATERIALS["wood_plywood"])
    feedrate = material["feedrate"]
    max_power = LASER_MACHINE["max_laser_power"]
    power_val = int(max_power * (material["laser_power_pct"] / 100.0))
    lines_per_mm = LASER_MACHINE["lines_per_mm"]
    pixel_step_mm = 1.0 / lines_per_mm

    arr = np.array(dithered_img.convert('L'))
    height_px, width_px = arr.shape

    with open(output_path, "w", encoding="utf-8") as f:
        # 1. GRBL Header an toàn
        f.write("; ===============================================\n")
        f.write("; Generated by Web-to-Laser Automation\n")
        f.write(f"; Target Board: Makerbase MKS DLC32 V2.1 (GRBL)\n")
        f.write(f"; Size: {width_mm:.1f}mm x {height_mm:.1f}mm\n")
        f.write(f"; Material: {material['name']} (Feed: {feedrate} mm/min, S: {power_val})\n")
        f.write("; ===============================================\n")
        f.write("G21\n")
        f.write("G90\n")
        f.write("M4 S0\n")
        f.write(f"G0 X0.000 Y0.000 F{LASER_MACHINE['rapid_speed']}\n\n")

        current_x = 0.0
        current_y = 0.0

        # 2. Duyệt từng dòng quét Y từ dưới lên trên (Y=0 đến Y_max)
        for y_idx in range(height_px):
            # Tọa độ thực tế Y
            actual_y = (height_px - 1 - y_idx) * pixel_step_mm
            row = arr[y_idx]

            is_forward = (y_idx % 2 == 0)
            x_indices = range(width_px) if is_forward else range(width_px - 1, -1, -1)

            # Gom nhóm các điểm pixel liên tục
            segments = []
            cur_type = None # 'burn' hoặc 'skip'
            seg_start_x = None

            for x_idx in x_indices:
                is_black = (row[x_idx] < 128)
                val_type = 'burn' if is_black else 'skip'
                pos_x = x_idx * pixel_step_mm

                if val_type != cur_type:
                    if cur_type is not None:
                        segments.append((cur_type, seg_start_x, pos_x))
                    cur_type = val_type
                    seg_start_x = pos_x

            # Đoạn cuối
            last_x = (width_px - 1) * pixel_step_mm if is_forward else 0.0
            if cur_type is not None:
                segments.append((cur_type, seg_start_x, last_x))

            # Nếu cả dòng không có điểm đốt nào, chỉ cần di chuyển G0 nếu cần
            has_burn = any(s[0] == 'burn' for s in segments)
            if not has_burn:
                continue

            # Xuất lệnh G-code cho từng đoạn
            for seg_type, start_x, end_x in segments:
                if seg_type == 'burn':
                    # Đưa đầu laser đến điểm bắt đầu đốt (nếu chưa ở đó)
                    if abs(current_x - start_x) > 0.001 or abs(current_y - actual_y) > 0.001:
                        f.write(f"G0 X{start_x:.3f} Y{actual_y:.3f} S0\n")
                        current_x = start_x
                        current_y = actual_y
                    # Bắn laser G1 đến điểm kết thúc
                    f.write(f"G1 X{end_x:.3f} Y{actual_y:.3f} S{power_val} F{feedrate}\n")
                    current_x = end_x
                else:
                    # Khoảng trắng: Tắt tia laser
                    pass

        # 3. GRBL Footer an toàn
        f.write("\n; ================= Hoan tat =================\n")
        f.write("M5 S0\n")
        f.write("G0 X0.000 Y0.000\n")
        f.write("; End of file\n")

    return output_path
