const ordersTableBody = document.getElementById("ordersTableBody");
const btnRefresh = document.getElementById("btnRefresh");
const statTotal = document.getElementById("statTotal");
const statPaid = document.getElementById("statPaid");
const statEngraving = document.getElementById("statEngraving");
const statCompleted = document.getElementById("statCompleted");

const noticeModal = document.getElementById("noticeModal");
const noticeTitle = document.getElementById("noticeTitle");
const noticeMsg = document.getElementById("noticeMsg");

async function fetchOrders() {
    try {
        const res = await fetch("/api/admin/orders");
        const data = await res.json();
        if (data.success) {
            renderOrders(data.orders);
            updateStats(data.orders);
        }
    } catch (err) {
        console.error("Lỗi lấy đơn hàng:", err);
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
                <td colspan="6" class="py-10 text-center text-slate-500">
                    <i class="fa-regular fa-folder-open text-3xl mb-2 block text-slate-600"></i>
                    Chưa có đơn hàng nào trong hệ thống
                </td>
            </tr>
        `;
        return;
    }

    ordersTableBody.innerHTML = orders.map(order => {
        const previewUrl = `/api/storage/previews/${order.id}_preview.png`;
        const origUrl = `/api/storage/uploads/${order.id}_orig${getFileExtension(order.image_path)}`;

        return `
            <tr class="hover:bg-slate-800/40 transition-colors">
                <!-- Mã Đơn & Ngày -->
                <td class="py-3.5 px-4">
                    <span class="font-bold text-amber-400 font-mono text-sm block">${order.id}</span>
                    <span class="text-[11px] text-slate-400">${order.created_at}</span>
                    <span class="text-[11px] text-slate-400 block">${order.customer_name || 'Khách Web'}</span>
                </td>

                <!-- Ảnh Thumbnail -->
                <td class="py-3.5 px-4">
                    <div class="flex items-center gap-2">
                        <img src="${previewUrl}" class="w-14 h-14 object-contain bg-slate-950 rounded border border-slate-700 shadow-sm" title="Vết cháy laser">
                    </div>
                </td>

                <!-- Kích thước & Thời gian -->
                <td class="py-3.5 px-4">
                    <span class="font-semibold text-slate-100 block">${order.width_mm} x ${order.height_mm} mm</span>
                    <span class="text-[11px] text-slate-400">Diện tích: ${((order.width_mm * order.height_mm)/100).toFixed(1)} cm²</span>
                    <span class="text-[11px] text-amber-400 font-medium block">
                        <i class="fa-regular fa-clock"></i> ~${order.estimated_minutes} phút khắc
                    </span>
                </td>

                <!-- Vật liệu & Giá -->
                <td class="py-3.5 px-4">
                    <span class="font-bold text-slate-200 block">${order.material_name}</span>
                    <span class="text-xs font-extrabold text-emerald-400">${formatVND(order.total_price)}</span>
                </td>

                <!-- Trạng thái -->
                <td class="py-3.5 px-4">
                    <select onchange="updateStatus('${order.id}', this.value)" class="bg-slate-950 border border-slate-700 text-xs rounded-lg px-2.5 py-1 font-semibold ${getStatusBadgeColor(order.status)} focus:outline-none">
                        <option value="PENDING_PAYMENT" ${order.status === 'PENDING_PAYMENT' ? 'selected' : ''}>⏳ Chờ thanh toán</option>
                        <option value="PAID" ${order.status === 'PAID' ? 'selected' : ''}>✅ Đã thanh toán</option>
                        <option value="ENGRAVING" ${order.status === 'ENGRAVING' ? 'selected' : ''}>🔥 Đang khắc</option>
                        <option value="COMPLETED" ${order.status === 'COMPLETED' ? 'selected' : ''}>🎉 Hoàn thành</option>
                        <option value="CANCELLED" ${order.status === 'CANCELLED' ? 'selected' : ''}>❌ Đã hủy</option>
                    </select>
                </td>

                <!-- Thao tác LaserGRBL -->
                <td class="py-3.5 px-4 text-center">
                    <div class="flex items-center justify-center gap-2">
                        <!-- Nút Mở bằng LaserGRBL -->
                        <button onclick="openLaserGRBL('${order.id}')" class="px-3 py-1.5 rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-orange-500/10 transition-all" title="Mở trực tiếp file G-code vào LaserGRBL">
                            <i class="fa-solid fa-play text-[10px]"></i> Mở LaserGRBL
                        </button>

                        <!-- Nút Tải File G-code .NC -->
                        <a href="/api/admin/orders/${order.id}/download-gcode" class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 hover:text-white text-xs font-semibold flex items-center gap-1 transition-all" title="Tải file .NC để chép vào thẻ nhớ MicroSD MKS DLC32">
                            <i class="fa-solid fa-download"></i> .NC
                        </a>
                    </div>
                </td>
            </tr>
        `;
    }).join("");
}

async function openLaserGRBL(orderId) {
    try {
        const res = await fetch(`/api/admin/orders/${orderId}/open-lasergrbl`, {
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

        // Cập nhật trạng thái sang "Đang khắc" nếu mở thành công
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
        await fetch(`/api/admin/orders/${orderId}/status`, {
            method: "POST",
            body: formData
        });
        fetchOrders();
    } catch (err) {
        console.error("Lỗi cập nhật trạng thái:", err);
    }
}

function getStatusBadgeColor(status) {
    switch (status) {
        case "PAID": return "text-emerald-400 border-emerald-500/40";
        case "ENGRAVING": return "text-amber-400 border-amber-500/40";
        case "COMPLETED": return "text-blue-400 border-blue-500/40";
        case "CANCELLED": return "text-rose-400 border-rose-500/40";
        default: return "text-slate-400 border-slate-700";
    }
}

function getFileExtension(path) {
    if (!path) return ".png";
    const parts = path.split(".");
    return parts.length > 1 ? "." + parts.pop() : ".png";
}

function formatVND(amount) {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

btnRefresh.addEventListener("click", fetchOrders);

// Tự động làm mới mỗi 5 giây
setInterval(fetchOrders, 5000);
document.addEventListener("DOMContentLoaded", fetchOrders);
