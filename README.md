# HỆ THỐNG WEB ĐẶT KHẮC LASER TỰ ĐỘNG & ĐỒNG BỘ LASERGRBL

Hệ thống chuyên nghiệp kết nối quy trình từ **Khách hàng đặt hàng trên Web** đến **Máy khắc Laser MKS DLC32 V2.1** tại xưởng thông qua phần mềm **LaserGRBL**.

---

## 🌟 Quy Trình Hoạt Động (Workflow)

1. **Khách hàng (Điện thoại hoặc Máy tính):**
   * Truy cập: `http://<IP_MAY_TINH>:8000`
   * Tải ảnh chân dung hoặc logo muốn khắc.
   * Nhập kích thước (Rộng x Cao bằng mm).
   * Chọn chất liệu (Gỗ dán, Gỗ thông, Da bò, Mica đen...).
   * **Xem trước vết cháy Laser:** Hệ thống áp dụng thuật toán Dithering (Floyd-Steinberg tương tự LaserGRBL) để hiển thị mô phỏng thực tế trước khi khắc.
   * **Báo giá minh bạch:** Tự động tính tiền phôi + diện tích + thời gian khắc.
   * **Quét mã VietQR:** Tự động sinh mã QR chuyển khoản Napas247 khớp số tiền & nội dung đơn hàng.

2. **Hệ thống Server (FastAPI + Python):**
   * Lưu ảnh gốc & ảnh mô phỏng.
   * **Tự động biên dịch ảnh thành file G-code (.NC)** chuẩn cho bo **Makerbase MKS DLC32 V2.1**:
     * Chế độ `M4` (Dynamic Laser Power - tự điều biến công suất chống cháy góc cua).
     * Thuật toán quét zíc-zắc 2 chiều tối ưu.
     * Bỏ qua khoảng trắng bằng lệnh chạy nhanh `G0 S0`.

3. **Xưởng của bạn (Quản lý & Khắc):**
   * Truy cập: `http://localhost:8000/admin`
   * Xem danh sách các đơn hàng mới đã thanh toán.
   * **Nút "Mở bằng LaserGRBL":** Bấm 1 click, phần mềm **LaserGRBL** sẽ tự động bật lên trên màn hình với file G-code của đơn hàng đã được nạp sẵn.
   * Bạn chỉ việc đặt phôi vào máy $\rightarrow$ Căn viền (Framing) $\rightarrow$ Nhấn nút **Khắc (Run)** trên LaserGRBL!
   * Hoặc bấm nút **".NC"** để tải file về chép vào thẻ nhớ MicroSD nếu muốn chạy offline trên bo MKS DLC32.

---

## 🚀 Hướng Dẫn Sử Dụng

### 1. Khởi động Server
* Nhấp đúp chuột vào file **`run.bat`** trong thư mục này.
* Mở trình duyệt web:
  * **Trang khách hàng:** [http://localhost:8000](http://localhost:8000)
  * **Trang quản lý xưởng:** [http://localhost:8000/admin](http://localhost:8000/admin)
* *Nếu muốn khách dùng điện thoại quét mã QR trong cùng mạng Wi-Fi:* Thay `localhost` bằng địa chỉ IP máy tính của bạn (ví dụ: `http://192.168.1.15:8000`).

### 2. Cài đặt thông tin tài khoản ngân hàng & Thông số máy
Mở file `app/config.py` để tùy chỉnh:
* **Thông tin ngân hàng nhận tiền:**
  ```python
  BANK_CONFIG = {
      "bank_id": "MB",              # MB, VCB, TCB, ACB, TPB, VPB...
      "account_no": "0987654321",   # Số tài khoản thật của bạn
      "account_name": "NGUYEN VAN A",
  }
  ```
* **Kích thước khổ máy laser:**
  ```python
  LASER_MACHINE = {
      "max_width_mm": 400.0,
      "max_height_mm": 400.0,
      "max_laser_power": 1000,
  }
  ```
* **Bảng giá và tốc độ khắc các loại vật liệu:** Chỉnh sửa trực tiếp trong biến `MATERIALS`.

---

## 📁 Cấu Trúc Thư Mục
* `app/laser_engine.py`: Thuật toán Dithering và sinh G-code chuẩn cho GRBL.
* `app/database.py`: Lưu trữ dữ liệu đơn hàng bằng SQLite (`storage/orders.db`).
* `app/config.py`: File cấu hình vật liệu, ngân hàng và thông số máy.
* `static/index.html`: Giao diện khách đặt hàng (tối ưu Responsive trên điện thoại).
* `static/admin.html`: Giao diện quản trị xưởng tích hợp mở LaserGRBL.
* `storage/uploads/`: Thư mục chứa ảnh gốc khách tải lên.
* `storage/gcodes/`: Thư mục chứa các file `.nc` G-code máy laser.
