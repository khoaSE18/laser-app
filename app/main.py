import os
import io
import time
import json
import base64
import shutil
import subprocess
import urllib.request
import urllib.parse
import re
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Header, Depends, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

from app.config import (
    BASE_DIR, STORAGE_DIR, UPLOAD_DIR, GCODE_DIR, PREVIEW_DIR,
    BANK_CONFIG, LASER_MACHINE, MATERIALS, LASERGRBL_CANDIDATE_PATHS,
    ADMIN_PASSWORD, ZALO_PHONE, HOTLINE, ZALO_LINK, RENDER_CLOUD_URL,
    WEBHOOK_TOKEN
)
from app.database import (
    init_db, create_order, get_order, update_order_status,
    list_orders, find_orders_by_query, upsert_order
)
from app.laser_engine import (
    process_and_dither_image, generate_preview_image,
    calculate_time_and_pricing, generate_grbl_gcode
)

# Khởi tạo DB khi chạy
init_db()

app = FastAPI(title="Laser Web-to-Print API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def find_lasergrbl_path() -> Optional[str]:
    """Tìm đường dẫn thực thi của LaserGRBL trên máy tính"""
    for p in LASERGRBL_CANDIDATE_PATHS:
        if os.path.exists(p):
            return p
    # Kiểm tra lệnh trong PATH
    which_path = shutil.which("LaserGRBL") or shutil.which("LaserGRBL.exe")
    if which_path and os.path.exists(which_path):
        return which_path
    return None

@app.get("/api/config")
def get_system_config():
    """Lấy danh sách vật liệu, thông số máy, thông tin chuyển khoản và hỗ trợ Zalo"""
    return {
        "materials": MATERIALS,
        "machine": {
            "max_width_mm": LASER_MACHINE["max_width_mm"],
            "max_height_mm": LASER_MACHINE["max_height_mm"]
        },
        "bank": BANK_CONFIG,
        "support": {
            "zalo": ZALO_PHONE,
            "hotline": HOTLINE,
            "zalo_link": ZALO_LINK
        }
    }


@app.post("/api/preview")
async def generate_preview(
    image: UploadFile = File(...),
    width_mm: float = Form(100.0),
    height_mm: float = Form(100.0),
    material: str = Form("wood_plywood"),
    mode: str = Form("photo")
):
    """
    API xem trước mô phỏng: Nhận ảnh từ người dùng -> Dither -> Tạo ảnh vết cháy -> Tính giá
    """
    if width_mm > LASER_MACHINE["max_width_mm"] or height_mm > LASER_MACHINE["max_height_mm"]:
        raise HTTPException(
            status_code=400,
            detail=f"Kích thước vượt quá vùng làm việc của máy ({LASER_MACHINE['max_width_mm']}x{LASER_MACHINE['max_height_mm']} mm)"
        )

    try:
        contents = await image.read()
        pil_img = Image.open(io.BytesIO(contents))

        # 1. Dithering xử lý ảnh
        _, dithered_img = process_and_dither_image(pil_img, width_mm, height_mm, mode=mode)

        # 2. Tạo ảnh mô phỏng vết cháy trên bề mặt vật liệu
        preview_img = generate_preview_image(dithered_img, material)

        # 3. Tính toán thời gian & giá tiền
        pricing = calculate_time_and_pricing(dithered_img, width_mm, height_mm, material)

        # 4. Chuyển ảnh preview thành Base64 Data URL để gửi về frontend
        buf = io.BytesIO()
        preview_img.save(buf, format="PNG")
        preview_b64 = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode('utf-8')

        return {
            "success": True,
            "preview_image": preview_b64,
            "pricing": pricing
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi xử lý ảnh: {str(e)}")

@app.post("/api/order")
async def create_new_order(
    image: UploadFile = File(...),
    width_mm: float = Form(100.0),
    height_mm: float = Form(100.0),
    material: str = Form("wood_plywood"),
    mode: str = Form("photo"),
    customer_name: str = Form("Khách hàng"),
    customer_phone: str = Form(""),
    customer_note: str = Form(""),
    need_design: bool = Form(False),
    delivery_method: str = Form("shipping"),
    shipping_address: str = Form("")
):
    """
    Tạo đơn hàng mới, sinh file G-code .NC chuẩn cho LaserGRBL, tạo mã VietQR
    """
    order_id = f"LS{datetime.now().strftime('%y%m%d%H%M%S')}"
    contents = await image.read()
    pil_img = Image.open(io.BytesIO(contents))

    # Ghi chú kèm yêu cầu thiết kế
    final_note = f"[CẦN THIẾT KẾ] {customer_note}".strip() if need_design else customer_note.strip()

    # 1. Lưu ảnh gốc
    orig_ext = os.path.splitext(image.filename)[1] or ".png"
    orig_save_path = os.path.join(UPLOAD_DIR, f"{order_id}_orig{orig_ext}")
    with open(orig_save_path, "wb") as f:
        f.write(contents)

    # 2. Xử lý Dithering
    _, dithered_img = process_and_dither_image(pil_img, width_mm, height_mm, mode=mode)

    # 3. Lưu ảnh preview
    preview_save_path = os.path.join(PREVIEW_DIR, f"{order_id}_preview.png")
    preview_img = generate_preview_image(dithered_img, material)
    preview_img.save(preview_save_path, "PNG")

    # 4. Sinh file G-code (.NC) tối ưu cho bo MKS DLC32
    gcode_save_path = os.path.join(GCODE_DIR, f"{order_id}.nc")
    generate_grbl_gcode(dithered_img, width_mm, height_mm, material, gcode_save_path)

    # 5. Tính giá
    pricing = calculate_time_and_pricing(dithered_img, width_mm, height_mm, material)

    # 6. Tạo đường link VietQR Napas247 động
    # Format: https://img.vietqr.io/image/<BANK_ID>-<ACCOUNT_NO>-<TEMPLATE>.png?amount=<AMOUNT>&addInfo=<ORDER_ID>&accountName=<NAME>
    vietqr_url = (
        f"https://img.vietqr.io/image/{BANK_CONFIG['bank_id']}-{BANK_CONFIG['account_no']}-{BANK_CONFIG['template']}.png"
        f"?amount={pricing['total_price']}&addInfo={order_id}&accountName={BANK_CONFIG['account_name']}"
    )

    # 7. Lưu đơn vào Database
    order_record = {
        "id": order_id,
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "customer_name": customer_name.strip() or "Khách hàng Web",
        "customer_phone": customer_phone.strip(),
        "customer_note": final_note,
        "delivery_method": delivery_method.strip() or "shipping",
        "shipping_address": shipping_address.strip(),

        "original_filename": image.filename,
        "image_path": orig_save_path,
        "preview_path": preview_save_path,
        "gcode_path": gcode_save_path,
        "width_mm": width_mm,
        "height_mm": height_mm,
        "material_key": material,
        "material_name": pricing["material_name"],
        "mode": mode,
        "estimated_minutes": pricing["estimated_minutes"],
        "total_price": pricing["total_price"],
        "status": "PENDING_PAYMENT",
        "payment_ref": order_id
    }
    create_order(order_record)

    return {
        "success": True,
        "order": order_record,
        "pricing": pricing,
        "vietqr_url": vietqr_url,
        "bank_info": BANK_CONFIG
    }

@app.get("/api/order/{order_id}")
def check_order_status(order_id: str):
    """Kiểm tra trạng thái đơn hàng"""
    order = get_order(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")
    return {"success": True, "order": order}

@app.post("/api/payment/webhook")
async def sepay_payment_webhook(request: Request):
    """
    Webhook tự động nhận thông báo biến động số dư ngân hàng 24/7 từ SePay / Casso / MyVIB.
    Tự động quét mã đơn hàng (LSxxxx), đối chiếu số tiền và kích hoạt trạng thái PAID ngay cả lúc nửa đêm.
    """
    auth_header = request.headers.get("Authorization", "")
    token_query = request.query_params.get("token", "")
    expected_token = WEBHOOK_TOKEN.strip() if WEBHOOK_TOKEN else ""

    # Kiểm tra Token nếu cấu hình bắt buộc
    if expected_token and (expected_token in auth_header or token_query == expected_token or request.headers.get("X-API-KEY", "") == expected_token):
        pass

    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Dữ liệu Webhook không đúng định dạng JSON")

    print(f"[WEBHOOK PAYMENT] Received transaction notification")

    # Chuẩn hóa payload (hỗ trợ SePay, Casso, app mobile forwarder)
    transactions = []
    if isinstance(data, list):
        transactions = data
    elif "data" in data and isinstance(data["data"], list):
        transactions = data["data"]
    else:
        transactions = [data]

    processed_orders = []

    for item in transactions:
        content = (
            item.get("content")
            or item.get("description")
            or item.get("code")
            or item.get("transactionContent")
            or ""
        )
        amount = (
            item.get("transferAmount")
            or item.get("amountIn")
            or item.get("amount")
            or 0
        )
        try:
            amount = int(float(amount))
        except (ValueError, TypeError):
            amount = 0

        # Tìm mã đơn hàng dạng LS...
        match = re.search(r"(LS\d{6,})", content.upper())
        if not match:
            continue

        order_id = match.group(1)
        order = get_order(order_id)

        if not order:
            print(f"[WEBHOOK PAYMENT] Order {order_id} not found")
            continue

        if order["status"] in ["PENDING_PAYMENT"]:
            if amount >= order["total_price"]:
                update_order_status(order_id, "PAID")
                sync_status_to_cloud(order_id, "PAID")
                processed_orders.append({
                    "order_id": order_id,
                    "status": "PAID",
                    "amount": amount,
                    "required": order["total_price"]
                })
                print(f"[WEBHOOK PAYMENT] Auto-approved order {order_id} ({amount} VND)")
            else:
                print(f"[WEBHOOK PAYMENT] Order {order_id} insufficient amount: {amount} / {order['total_price']}")

    return {
        "success": True,
        "message": f"Đã xử lý {len(processed_orders)} đơn hàng",
        "processed": processed_orders
    }

def format_order_for_client(o: dict) -> dict:
    status = o.get("status", "PENDING_PAYMENT")
    if status == "PENDING_PAYMENT":
        step = 1
        step_name = "Chờ xưởng xác nhận chuyển khoản"
        desc = "Đơn hàng đã được tạo. Vui lòng chuyển khoản đúng cú pháp để xưởng bắt đầu gia công."
    elif status == "PAID":
        step = 2
        step_name = "Xưởng đã nhận tiền (VIB) - Đang xếp hàng"
        desc = "Thanh toán thành công! Xưởng đang chuẩn bị phôi và kiểm tra file thiết kế."
    elif status == "PREPARING":
        step = 3
        step_name = "🎨 Đang chuẩn bị phôi & file"
        desc = "Kỹ thuật viên xưởng đang chuẩn bị phôi và nạp file G-code vào máy laser."
    elif status == "ENGRAVING":
        step = 4
        step_name = "🔥 Máy Laser đang tiến hành khắc"
        desc = f"Tia laser đang chạy trên phôi. Thời gian gia công dự kiến: ~{o.get('estimated_minutes', 15)} phút."
    elif status == "COMPLETED":
        step = 5
        step_name = "🎉 Khắc hoàn tất! Sẵn sàng bàn giao"
        desc = "Sản phẩm đã được khắc xong đẹp mắt. Mời bạn đến xưởng nhận hàng hoặc chờ ship!"
    elif status == "CANCELLED":
        step = 0
        step_name = "❌ Đơn hàng đã hủy"
        desc = "Đơn hàng đã được hủy."
    else:
        step = 3
        step_name = "🎨 Đang chuẩn bị phôi & thiết kế"
        desc = "Kỹ thuật viên đang chuẩn bị gá phôi vào máy laser."

    return {
        "id": o["id"],
        "created_at": o["created_at"],
        "customer_name": o.get("customer_name") or "",
        "customer_phone": o.get("customer_phone") or "",
        "customer_note": o.get("customer_note") or "",
        "delivery_method": o.get("delivery_method") or "shipping",
        "shipping_address": o.get("shipping_address") or "",
        "material_name": o.get("material_name") or "",
        "width_mm": o.get("width_mm", 0),
        "height_mm": o.get("height_mm", 0),
        "total_price": o.get("total_price", 0),
        "status": status,
        "current_step": step,
        "step_name": step_name,
        "step_desc": desc,
        "estimated_minutes": o.get("estimated_minutes", 0),
        "preview_url": f"/api/storage/previews/{o['id']}_preview.png",
        "vietqr_url": (
            f"https://img.vietqr.io/image/{BANK_CONFIG['bank_id']}-{BANK_CONFIG['account_no']}-{BANK_CONFIG['template']}.png"
            f"?amount={o.get('total_price', 0)}&addInfo={o['id']}&accountName={BANK_CONFIG['account_name']}"
        )
    }

@app.get("/api/order/track/search")
def track_orders(query: str):
    """
    Tra cứu tiến trình đơn hàng theo mã đơn (LSxxxx) hoặc số điện thoại.
    """
    q = query.strip()
    if len(q) < 3:
        raise HTTPException(status_code=400, detail="Vui lòng nhập ít nhất 3 ký tự (Số điện thoại hoặc mã đơn)")

    orders = find_orders_by_query(q)
    if not orders:
        return {"success": False, "message": f"Không tìm thấy đơn hàng nào với từ khóa: {q}"}

    return {"success": True, "orders": [format_order_for_client(o) for o in orders]}

@app.post("/api/order/my-orders")
async def get_my_orders(request: Request):
    """
    Lấy danh sách các đơn hàng của khách dựa trên danh sách ID lưu trong LocalStorage máy khách
    """
    try:
        body = await request.json()
        order_ids = body.get("order_ids", [])
    except Exception:
        order_ids = []

    if not order_ids or not isinstance(order_ids, list):
        return {"success": True, "orders": []}

    clean_ids = [str(oid).strip() for oid in order_ids[:30] if oid]
    orders = []
    for oid in clean_ids:
        o = get_order(oid)
        if o:
            orders.append(format_order_for_client(o))

    return {"success": True, "orders": orders}


def verify_admin_pin(x_admin_pin: Optional[str] = Header(None)):
    """Kiểm tra mã PIN bảo vệ trang quản trị xưởng"""
    if not x_admin_pin or x_admin_pin != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Mã PIN quản trị không chính xác!")
    return True

@app.post("/api/admin/login")
def admin_login(pin: str = Form(...)):
    """Xác thực mã PIN đăng nhập quản trị"""
    if pin == ADMIN_PASSWORD:
        return {"success": True, "message": "Đăng nhập thành công!"}
    raise HTTPException(status_code=401, detail="Mã PIN không đúng! Vui lòng thử lại.")

def sync_cloud_orders():
    """Tự động kéo đơn hàng và file G-code từ Render Cloud về máy xưởng nội bộ"""
    if not RENDER_CLOUD_URL or os.name != 'nt':
        return

    try:
        url = f"{RENDER_CLOUD_URL.rstrip('/')}/api/admin/orders"
        req = urllib.request.Request(url, headers={"X-Admin-PIN": ADMIN_PASSWORD})
        with urllib.request.urlopen(req, timeout=4) as response:
            if response.status == 200:
                data = json.loads(response.read().decode('utf-8'))
                if data.get("success"):
                    for cloud_order in data.get("orders", []):
                        order_id = cloud_order["id"]
                        local_gcode = os.path.join(GCODE_DIR, f"{order_id}.nc")
                        local_preview = os.path.join(PREVIEW_DIR, f"{order_id}_preview.png")

                        if not os.path.exists(local_gcode):
                            try:
                                gcode_url = f"{RENDER_CLOUD_URL.rstrip('/')}/api/admin/orders/{order_id}/download-gcode"
                                urllib.request.urlretrieve(gcode_url, local_gcode)
                            except Exception:
                                pass

                        if not os.path.exists(local_preview):
                            try:
                                prev_url = f"{RENDER_CLOUD_URL.rstrip('/')}/api/storage/previews/{order_id}_preview.png"
                                urllib.request.urlretrieve(prev_url, local_preview)
                            except Exception:
                                pass

                        cloud_order_copy = dict(cloud_order)
                        cloud_order_copy["gcode_path"] = local_gcode
                        cloud_order_copy["preview_path"] = local_preview
                        upsert_order(cloud_order_copy)
    except Exception as e:
        print("[CLOUD SYNC ERROR]:", e)

def sync_status_to_cloud(order_id: str, new_status: str):
    """Đẩy trạng thái cập nhật lên Render Cloud"""
    if not RENDER_CLOUD_URL or os.name != 'nt':
        return
    try:
        url = f"{RENDER_CLOUD_URL.rstrip('/')}/api/admin/orders/{order_id}/status"
        data = urllib.parse.urlencode({"status": new_status}).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers={"X-Admin-PIN": ADMIN_PASSWORD})
        urllib.request.urlopen(req, timeout=3)
    except Exception as e:
        print(f"[CLOUD STATUS SYNC ERROR {order_id}]:", e)

def sync_confirm_payment_to_cloud(order_id: str):
    """Đẩy xác nhận thanh toán lên Render Cloud"""
    if not RENDER_CLOUD_URL or os.name != 'nt':
        return
    try:
        url = f"{RENDER_CLOUD_URL.rstrip('/')}/api/admin/orders/{order_id}/confirm-payment"
        req = urllib.request.Request(url, data=b"", headers={"X-Admin-PIN": ADMIN_PASSWORD})
        urllib.request.urlopen(req, timeout=3)
    except Exception as e:
        print(f"[CLOUD CONFIRM SYNC ERROR {order_id}]:", e)

@app.post("/api/admin/orders/{order_id}/confirm-payment")
def admin_confirm_payment(order_id: str, authenticated: bool = Depends(verify_admin_pin)):
    """Xác nhận đã nhận tiền (chỉ nhân viên xưởng có PIN mới được bấm)"""
    order = get_order(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")
    updated = update_order_status(order_id, "PAID")
    sync_confirm_payment_to_cloud(order_id)
    return {"success": True, "order": updated, "message": f"Đã duyệt thanh toán thành công cho đơn {order_id}!"}

@app.get("/api/admin/orders")
def get_all_orders(authenticated: bool = Depends(verify_admin_pin)):
    """Lấy danh sách tất cả đơn hàng cho xưởng quản lý (tự động đồng bộ với Render Cloud)"""
    sync_cloud_orders()
    orders = list_orders(limit=100)
    return {"success": True, "orders": orders}

@app.post("/api/admin/orders/{order_id}/status")
def change_order_status(order_id: str, status: str = Form(...), authenticated: bool = Depends(verify_admin_pin)):
    """Cập nhật trạng thái đơn hàng (tự động đồng bộ lên Render Cloud)"""
    updated = update_order_status(order_id, status)
    sync_status_to_cloud(order_id, status)
    return {"success": True, "order": updated}

@app.post("/api/admin/orders/{order_id}/open-lasergrbl")
def open_in_lasergrbl(order_id: str, authenticated: bool = Depends(verify_admin_pin)):

    """
    Mở file G-code của đơn hàng trực tiếp bằng phần mềm LaserGRBL trên máy tính
    """
    order = get_order(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")

    gcode_path = order["gcode_path"]
    if not os.path.exists(gcode_path):
        raise HTTPException(status_code=404, detail="Không tìm thấy file G-code")

    lasergrbl_bin = find_lasergrbl_path()

    try:
        sync_status_to_cloud(order_id, "ENGRAVING")
        if lasergrbl_bin and os.path.exists(lasergrbl_bin):
            subprocess.Popen([lasergrbl_bin, gcode_path])
            return {
                "success": True,
                "message": f"Đã khởi chạy LaserGRBL và mở file: {os.path.basename(gcode_path)}",
                "lasergrbl_path": lasergrbl_bin
            }
        else:
            # Nếu chạy trên máy tính Windows nội bộ
            if hasattr(os, "startfile"):
                try:
                    os.startfile(gcode_path)
                    return {
                        "success": True,
                        "message": f"Đã mở file qua ứng dụng mặc định của hệ thống: {os.path.basename(gcode_path)}"
                    }
                except Exception:
                    pass

            # Nếu chạy trên Cloud (Linux)
            return {
                "success": True,
                "cloud_mode": True,
                "download_url": f"/api/admin/orders/{order_id}/download-gcode",
                "filename": f"{order_id}.nc",
                "message": f"Đang tự động tải file {order_id}.nc về máy tính của bạn.\nBạn chỉ cần nhấp mở file là LaserGRBL sẽ tự động nạp sẵn để khắc!"
            }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi mở LaserGRBL: {str(e)}")

@app.get("/api/admin/orders/{order_id}/download-gcode")
def download_gcode(order_id: str):
    """Tải file .NC về máy để chép vào thẻ nhớ MicroSD MKS DLC32"""
    order = get_order(order_id)
    if not order or not os.path.exists(order["gcode_path"]):
        raise HTTPException(status_code=404, detail="File G-code không tồn tại")
    return FileResponse(
        order["gcode_path"],
        media_type="application/x-gcode",
        filename=f"{order_id}.nc"
    )

@app.get("/api/storage/{subfolder}/{filename}")
def serve_storage_file(subfolder: str, filename: str):
    """Xem ảnh upload / preview đã lưu"""
    allowed_folders = ["uploads", "previews"]
    if subfolder not in allowed_folders:
        raise HTTPException(status_code=403, detail="Thư mục không hợp lệ")
    file_path = os.path.join(STORAGE_DIR, subfolder, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File không tồn tại")
    return FileResponse(file_path)

# Giao diện tĩnh
STATIC_DIR = os.path.join(BASE_DIR, "static")
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
def serve_index():
    return FileResponse(
        os.path.join(STATIC_DIR, "index.html"),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )

@app.get("/admin")
def serve_admin():
    return FileResponse(
        os.path.join(STATIC_DIR, "admin.html"),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )

@app.get("/robots.txt")
def serve_robots():
    return FileResponse(os.path.join(STATIC_DIR, "robots.txt"), media_type="text/plain")

@app.get("/sitemap.xml")
def serve_sitemap():
    return FileResponse(os.path.join(STATIC_DIR, "sitemap.xml"), media_type="application/xml")

@app.get("/google{token}.html")
def serve_google_verify(token: str):
    filename = f"google{token}.html"
    file_path = os.path.join(STATIC_DIR, filename)
    if os.path.exists(file_path):
        return FileResponse(file_path, media_type="text/html")
    raise HTTPException(status_code=404, detail="File Not Found")
