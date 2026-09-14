const ordersTableBody = document.getElementById("ordersTableBody");
const btnRefresh = document.getElementById("btnRefresh");
const btnLogout = document.getElementById("btnLogout");
const statTotal = document.getElementById("statTotal");
const statPaid = document.getElementById("statPaid");
const statEngraving = document.getElementById("statEngraving");
const statCompleted = document.getElementById("statCompleted");

const noticeModal = document.getElementById("noticeModal");
const noticeTitle = document.getElementById("noticeTitle");
const noticeMsg = document.getElementById("noticeMsg");

const loginModal = document.getElementById("loginModal");
const loginForm = document.getElementById("loginForm");
const pinInput = document.getElementById("pinInput");
const loginError = document.getElementById("loginError");

function getAdminPin() {
    return localStorage.getItem("laser_admin_pin") || "";
}

function setAdminPin(pin) {
    localStorage.setItem("laser_admin_pin", pin);
}

function clearAdminPin() {
    localStorage.removeItem("laser_admin_pin");
}

// Wrapper fetch tự động gắn header X-Admin-PIN
async function adminFetch(url, options = {}) {
    const pin = getAdminPin();
    if (!options.headers) {
        options.headers = {};
    }
    options.headers["X-Admin-PIN"] = pin;

    const res = await fetch(url, options);
    if (res.status === 401) {
        clearAdminPin();
        showLogin();
        throw new Error("Chưa đăng nhập hoặc mã PIN hết hạn");
    }
    return res;
}

function showLogin() {
    loginModal.classList.remove("hidden");
    pinInput.value = "";
    loginError.classList.add("hidden");
    setTimeout(() => pinInput.focus(), 100);
}

function hideLogin() {
    loginModal.classList.add("hidden");
}

// Xử lý Form đăng nhập mã PIN
loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pin = pinInput.value.trim();
    if (!pin) return;

    loginError.classList.add("hidden");

    const formData = new FormData();
    formData.append("pin", pin);

    try {
        const res = await fetch("/api/admin/login", {
            method: "POST",
            body: formData
        });

        if (res.ok) {
            setAdminPin(pin);
            hideLogin();
            fetchOrders();
        } else {
            loginError.textContent = "Mã PIN không chính xác! Vui lòng thử lại.";
            loginError.classList.remove("hidden");
            pinInput.focus();
        }
    } catch (err) {
        loginError.textContent = "Lỗi kết nối máy chủ";
        loginError.classList.remove("hidden");
    }
});

// Đăng xuất
btnLogout.addEventListener("click", () => {
    clearAdminPin();
    showLogin();
});

async function fetchOrders() {
    if (!getAdminPin()) {
        showLogin();
        return;
    }

    try {
        const res = await adminFetch("/api/admin/orders");
        const data = await res.json();
        if (data.success) {
            renderOrders(data.orders);
            updateStats(data.orders);
        }
    } catch (err) {
        console.error("Lỗi lấy danh sách đơn:", err);
    }
}

function updateStats(orders) {
    statTotal.textContent = orders.length;
    statPaid.textContent = orders.filter(o => o.status === "PAID").length;
    statEngraving.textContent = orders.filter(o => o.status === "ENGRAVING").length;
    statCompleted.textContent = orders.filter(o => o.status === "COMPLETED").length;
}

function renderOrders(orders) {
    if (!orders || orders.length === 0) {
        ordersTableBody.innerHTML = `
            <tr>
                <td colspan="6" class="py-12 text-center text-slate-500">
                    <i class="fa-regular fa-folder-open text-4xl mb-2 block text-slate-600"></i>
                    Chưa có đơn hàng nào trong hệ thống
                </td>
            </tr>
        `;
        return;
    }

    ordersTableBody.innerHTML = orders.map(order => {
        const previewUrl = `/api/storage/previews/${order.id}_preview.png`;
        const isPending = order.status === "PENDING_PAYMENT";
        const isPaid = order.status === "PAID";
        const isEngraving = order.status === "ENGRAVING";

        return `
            <tr class="hover:bg-slate-800/40 transition-colors ${isPaid ? 'bg-amber-500/5' : ''}">
                <!-- Mã Đơn & Ngày -->
                <td class="py-3.5 px-4">
                    <span class="font-bold text-amber-400 font-mono text-sm block">${order.id}</span>
                    <span class="text-[11px] text-slate-400">${order.created_at}</span>
                    <span class="text-[11px] text-slate-300 font-medium block mt-0.5">${order.customer_name || 'Khách Web'}</span>
                </td>

                <!-- Ảnh Thumbnail -->
                <td class="py-3.5 px-4">
                    <div class="flex items-center gap-2">
                        <img src="${previewUrl}" class="w-14 h-14 object-contain bg-slate-950 rounded-lg border border-slate-700 shadow-sm" title="Vết cháy laser">
                    </div>
                </td>

                <!-- Kích thước & Thời gian -->
                <td class="py-3.5 px-4">
                    <span class="font-semibold text-slate-100 block">${order.width_mm} x ${order.height_mm} mm</span>
                    <span class="text-[11px] text-slate-400">Diện tích: ${((order.width_mm * order.height_mm)/100).toFixed(1)} cm²</span>
                    <span class="text-[11px] text-amber-400 font-medium block mt-0.5">
                        <i class="fa-regular fa-clock"></i> ~${order.estimated_minutes} phút khắc
                    </span>
                </td>

                <!-- Vật liệu & Giá -->
                <td class="py-3.5 px-4">
                    <span class="font-bold text-slate-200 block">${order.material_name}</span>
                    <span class="text-sm font-black text-emerald-400">${formatVND(order.total_price)}</span>
                </td>

                <!-- Trạng thái -->
                <td class="py-3.5 px-4">
                    <div class="space-y-1.5">
                        <span class="inline-block px-2.5 py-1 rounded-full text-[11px] font-bold border ${getStatusBadgeStyle(order.status)}">
                            ${getStatusLabel(order.status)}
                        </span>
                        
                        <!-- Nút duyệt tiền chỉ hiện khi đang chờ thanh toán -->
                        ${isPending ? `
                            <button onclick="confirmOrderPayment('${order.id}')" class="w-full py-1.5 px-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1 shadow-md shadow-emerald-600/20 transition-all">
                                <i class="fa-solid fa-check"></i> Duyệt Đã Nhận Tiền
                            </button>
                        ` : ''}
                    </div>
                </td>

                <!-- Thao tác LaserGRBL -->
                <td class="py-3.5 px-4 text-center">
                    <div class="flex items-center justify-center gap-2">
                        ${isPending ? `
                            <!-- Chưa thanh toán: Khóa nút khắc để bảo vệ xưởng -->
                            <button disabled class="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-500 text-xs font-semibold cursor-not-allowed border border-slate-700" title="Khách chưa thanh toán, không thể khắc">
                                <i class="fa-solid fa-lock text-[10px] mr-1"></i> Chưa duyệt tiền
                            </button>
                        ` : `
                            <!-- Đã thanh toán: Mở khóa nút LaserGRBL -->
                            <button onclick="openLaserGRBL('${order.id}')" class="px-3 py-1.5 rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-orange-500/20 transition-all">
                                <i class="fa-solid fa-play text-[10px]"></i> Mở LaserGRBL
                            </button>
                        `}

                        <!-- Nút Tải File G-code .NC -->
                        <a href="/api/admin/orders/${order.id}/download-gcode" class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 hover:text-white text-xs font-semibold flex items-center gap-1 transition-all" title="Tải file .NC để chép vào thẻ nhớ">
                            <i class="fa-solid fa-download"></i> .NC
                        </a>
                    </div>
                </td>
            </tr>
        `;
    }).join("");
}

// Hàm xác nhận đã nhận tiền (Duyệt đơn)
async function confirmOrderPayment(orderId) {
    if (!confirm(`Bạn có chắc chắn đã nhận được tiền từ tài khoản VIB cho đơn hàng [${orderId}]?`)) {
        return;
    }

    try {
        const res = await adminFetch(`/api/admin/orders/${orderId}/confirm-payment`, {
            method: "POST"
        });
        const data = await res.json();
        if (data.success) {
            fetchOrders();
        } else {
            alert(data.detail || "Lỗi khi duyệt thanh toán");
        }
    } catch (err) {
        console.error("Lỗi duyệt tiền:", err);
    }
}

async function openLaserGRBL(orderId) {
    try {
        const res = await adminFetch(`/api/admin/orders/${orderId}/open-lasergrbl`, {
            method: "POST"
        });
        const data = await res.json();

        // Nếu chạy trên Cloud, tự động kích hoạt tải file .nc về máy tính
        if (data.cloud_mode && data.download_url) {
            const downloadLink = document.createElement("a");
            downloadLink.href = data.download_url;
            downloadLink.download = data.filename || `${orderId}.nc`;
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
        }

        noticeTitle.textContent = data.success ? "Sẵn Sàng Khắc Trên LaserGRBL" : "Thông Báo LaserGRBL";
        noticeMsg.textContent = data.message;
        noticeModal.classList.remove("hidden");

        if (data.success) {
            updateStatus(orderId, "ENGRAVING");
        }
    } catch (err) {
        alert("Lỗi khi kết nối với LaserGRBL");
    }
}

async function updateStatus(orderId, newStatus) {
    const formData = new FormData();
    formData.append("status", newStatus);

    try {
        await adminFetch(`/api/admin/orders/${orderId}/status`, {
            method: "POST",
            body: formData
        });
        fetchOrders();
    } catch (err) {
        console.error("Lỗi cập nhật trạng thái:", err);
    }
}

function getStatusBadgeStyle(status) {
    switch (status) {
        case "PAID": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
        case "ENGRAVING": return "bg-amber-500/10 text-amber-400 border-amber-500/30";
        case "COMPLETED": return "bg-blue-500/10 text-blue-400 border-blue-500/30";
        case "CANCELLED": return "bg-rose-500/10 text-rose-400 border-rose-500/30";
        default: return "bg-slate-800 text-slate-400 border-slate-700";
    }
}

function getStatusLabel(status) {
    switch (status) {
        case "PAID": return "✅ Đã Thanh Toán";
        case "ENGRAVING": return "🔥 Đang Khắc";
        case "COMPLETED": return "🎉 Hoàn Thành";
        case "CANCELLED": return "❌ Đã Hủy";
        default: return "⏳ Chờ Thanh Toán";
    }
}

function formatVND(amount) {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

btnRefresh.addEventListener("click", fetchOrders);

// Tự động làm mới mỗi 5 giây nếu đã đăng nhập
setInterval(() => {
    if (getAdminPin()) {
        fetchOrders();
    }
}, 5000);

document.addEventListener("DOMContentLoaded", () => {
    if (!getAdminPin()) {
        showLogin();
    } else {
        fetchOrders();
    }
});
