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
    if (loginModal) loginModal.classList.remove("hidden");
    if (pinInput) {
        pinInput.value = "";
        setTimeout(() => pinInput.focus(), 100);
    }
    if (loginError) loginError.classList.add("hidden");
}

function hideLogin() {
    if (loginModal) loginModal.classList.add("hidden");
}

// Xử lý Form đăng nhập mã PIN
if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const pin = pinInput ? pinInput.value.trim() : "";
        if (!pin) return;

        if (loginError) loginError.classList.add("hidden");

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
                if (loginError) {
                    loginError.textContent = "Mã PIN không chính xác! Vui lòng thử lại.";
                    loginError.classList.remove("hidden");
                }
                if (pinInput) pinInput.focus();
            }
        } catch (err) {
            if (loginError) {
                loginError.textContent = "Lỗi kết nối máy chủ";
                loginError.classList.remove("hidden");
            }
        }
    });
}

// Đăng xuất
if (btnLogout) {
    btnLogout.addEventListener("click", () => {
        clearAdminPin();
        showLogin();
    });
}

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
    if (statTotal) statTotal.textContent = orders.length;
    if (statPaid) statPaid.textContent = orders.filter(o => o.status === "PAID").length;
    const statPreparing = document.getElementById("statPreparing");
    if (statPreparing) statPreparing.textContent = orders.filter(o => o.status === "PREPARING").length;
    if (statEngraving) statEngraving.textContent = orders.filter(o => o.status === "ENGRAVING").length;
    if (statCompleted) statCompleted.textContent = orders.filter(o => o.status === "COMPLETED").length;
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
                <!-- Mã Đơn & Khách Hàng / Giao Nhận -->
                <td class="py-3.5 px-4 min-w-[200px]">
                    <span class="font-bold text-amber-400 font-mono text-sm block">${order.id}</span>
                    <span class="text-[11px] text-slate-400">${order.created_at}</span>
                    <span class="text-[11px] text-slate-200 font-bold block mt-0.5">${order.customer_name || 'Khách Web'}</span>
                    
                    <!-- Hiển thị nút chat Zalo nếu khách có để lại số điện thoại -->
                    ${order.customer_phone ? `
                        <a href="https://zalo.me/${order.customer_phone}" target="_blank" class="inline-flex items-center gap-1 text-[11px] text-blue-400 font-bold hover:underline mt-1 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                            <i class="fa-solid fa-comment-dots text-[10px]"></i> Zalo: ${order.customer_phone}
                        </a>
                    ` : ''}

                    <!-- Hình thức giao nhận hàng -->
                    ${order.delivery_method === 'pickup' ? `
                        <div class="mt-1">
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                <i class="fa-solid fa-store"></i> Nhận tại xưởng
                            </span>
                        </div>
                    ` : `
                        <div class="mt-1.5 bg-slate-950/70 p-2 rounded-lg border border-slate-800 space-y-1">
                            <div class="flex items-center justify-between gap-1">
                                <span class="text-[10px] font-bold text-amber-400 flex items-center gap-1">
                                    <i class="fa-solid fa-truck-fast"></i> Giao tận nơi:
                                </span>
                                <button onclick="copyAddress(this, '${(order.customer_name || '').replace(/'/g, "\\'")}', '${(order.customer_phone || '').replace(/'/g, "\\'")}', '${(order.shipping_address || '').replace(/'/g, "\\'")}')" class="text-[10px] text-amber-300 hover:text-white bg-amber-500/20 hover:bg-amber-500/40 border border-amber-500/40 px-1.5 py-0.5 rounded flex items-center gap-1 font-semibold transition-all shadow-sm" title="Sao chép tên, SĐT và địa chỉ để dán vào Viettel Post / GHTK">
                                    <i class="fa-solid fa-copy"></i> Sao chép
                                </button>
                            </div>
                            <p class="text-[11px] text-slate-300 font-medium leading-tight select-all">${order.shipping_address || '<span class=\"text-slate-500 italic\">(Chưa nhập địa chỉ)</span>'}</p>
                        </div>
                    `}

                    <!-- Nhãn yêu cầu thiết kế -->
                    ${order.customer_note && order.customer_note.includes('[CẦN THIẾT KẾ]') ? `
                        <span class="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-extrabold bg-purple-500/20 text-purple-300 border border-purple-500/30 block w-fit">
                            🎨 CẦN TƯ VẤN THIẾT KẾ
                        </span>
                        <p class="text-[11px] text-amber-200/90 italic mt-0.5 bg-slate-950/60 p-1.5 rounded border border-slate-800">
                            ${order.customer_note.replace('[CẦN THIẾT KẾ]', '').trim() || 'Khách nhờ tách nền/chỉnh sửa'}
                        </p>
                    ` : (order.customer_note ? `<p class="text-[10px] text-slate-400 italic mt-0.5">${order.customer_note}</p>` : '')}
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
                <td class="py-3.5 px-4 min-w-[170px]">
                    <div class="space-y-1.5">
                        <select onchange="updateStatus('${order.id}', this.value)" class="w-full text-[11px] font-bold py-1.5 px-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 focus:outline-none focus:border-amber-500 cursor-pointer">
                            <option value="PENDING_PAYMENT" ${order.status === 'PENDING_PAYMENT' ? 'selected' : ''}>⏳ 1. Chờ Chuyển Khoản</option>
                            <option value="PAID" ${order.status === 'PAID' ? 'selected' : ''}>✅ 2. Đã Nhận Tiền (VIB)</option>
                            <option value="PREPARING" ${order.status === 'PREPARING' ? 'selected' : ''}>🎨 3. Chuẩn Bị Phôi & File</option>
                            <option value="ENGRAVING" ${order.status === 'ENGRAVING' ? 'selected' : ''}>🔥 4. Đang Khắc Laser</option>
                            <option value="COMPLETED" ${order.status === 'COMPLETED' ? 'selected' : ''}>🎉 5. Hoàn Thành / Giao</option>
                            <option value="CANCELLED" ${order.status === 'CANCELLED' ? 'selected' : ''}>❌ Hủy Đơn Hàng</option>
                        </select>
                        
                        <!-- Nút duyệt tiền chỉ hiện khi đang chờ thanh toán -->
                        ${isPending ? `
                            <button onclick="confirmOrderPayment('${order.id}')" class="w-full py-1.5 px-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1 shadow-md shadow-emerald-600/20 transition-all">
                                <i class="fa-solid fa-check"></i> Duyệt Đã Nhận Tiền
                            </button>
                        ` : ''}

                        <!-- Nút báo xong nhanh khi đang khắc -->
                        ${isEngraving ? `
                            <button onclick="updateStatus('${order.id}', 'COMPLETED')" class="w-full py-1 px-2 bg-emerald-600/90 hover:bg-emerald-600 text-white rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-all">
                                <i class="fa-solid fa-circle-check"></i> Báo Đã Khắc Xong
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
        case "PREPARING": return "bg-purple-500/10 text-purple-400 border-purple-500/30";
        case "ENGRAVING": return "bg-amber-500/10 text-amber-400 border-amber-500/30";
        case "COMPLETED": return "bg-blue-500/10 text-blue-400 border-blue-500/30";
        case "CANCELLED": return "bg-rose-500/10 text-rose-400 border-rose-500/30";
        default: return "bg-slate-800 text-slate-400 border-slate-700";
    }
}

function getStatusLabel(status) {
    switch (status) {
        case "PAID": return "✅ Đã Nhận Tiền";
        case "PREPARING": return "🎨 Chuẩn Bị Phôi";
        case "ENGRAVING": return "🔥 Đang Khắc";
        case "COMPLETED": return "🎉 Hoàn Thành";
        case "CANCELLED": return "❌ Đã Hủy";
        default: return "⏳ Chờ Thanh Toán";
    }
}

function formatVND(amount) {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

if (btnRefresh) {
    btnRefresh.addEventListener("click", fetchOrders);
}

// Tự động làm mới mỗi 5 giây nếu đã đăng nhập
setInterval(() => {
    if (getAdminPin()) {
        fetchOrders();
    }
}, 5000);

function copyAddress(btn, name, phone, address) {
    const textToCopy = `${name} - ${phone} - ${address}`.trim();
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(textToCopy).then(() => {
            const originalHTML = btn.innerHTML;
            btn.innerHTML = `<i class="fa-solid fa-check text-emerald-400"></i> Đã chép!`;
            btn.classList.add("bg-emerald-500/30", "text-emerald-300");
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.classList.remove("bg-emerald-500/30", "text-emerald-300");
            }, 2000);
        }).catch(() => {
            prompt("Nhấn Ctrl+C để sao chép địa chỉ:", textToCopy);
        });
    } else {
        prompt("Nhấn Ctrl+C để sao chép địa chỉ:", textToCopy);
    }
}
window.copyAddress = copyAddress;

document.addEventListener("DOMContentLoaded", () => {
    if (!getAdminPin()) {
        showLogin();
    } else {
        fetchOrders();
    }
});
