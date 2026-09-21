// Trạng thái ứng dụng
let currentFile = null;
let currentAspectRatio = 1.0;
let materialsConfig = {};
let bankConfig = {};
let machineConfig = {};
let selectedMaterial = "wood_plywood";
let isUpdatingDimension = false;
let previewDebounceTimer = null;
let currentOrderId = null;

// DOM Elements
const imageInput = document.getElementById("imageInput");
const dropZone = document.getElementById("dropZone");
const uploadPlaceholder = document.getElementById("uploadPlaceholder");
const uploadPreviewBox = document.getElementById("uploadPreviewBox");
const thumbImg = document.getElementById("thumbImg");
const fileName = document.getElementById("fileName");
const fileResolution = document.getElementById("fileResolution");

const widthInput = document.getElementById("widthInput");
const heightInput = document.getElementById("heightInput");
const lockAspect = document.getElementById("lockAspect");
const dimensionCm = document.getElementById("dimensionCm");
const materialGrid = document.getElementById("materialGrid");

const laserBurnPreview = document.getElementById("laserBurnPreview");
const emptyPreviewNotice = document.getElementById("emptyPreviewNotice");
const previewSpinner = document.getElementById("previewSpinner");
const previewStatus = document.getElementById("previewStatus");

const priceBase = document.getElementById("priceBase");
const priceArea = document.getElementById("priceArea");
const timeEst = document.getElementById("timeEst");
const priceTotal = document.getElementById("priceTotal");
const btnCheckout = document.getElementById("btnCheckout");

// Modal Elements
const paymentModal = document.getElementById("paymentModal");
const btnCloseModal = document.getElementById("btnCloseModal");
const qrImage = document.getElementById("qrImage");
const modalOrderId = document.getElementById("modalOrderId");
const bankName = document.getElementById("bankName");
const bankAccount = document.getElementById("bankAccount");
const bankOwner = document.getElementById("bankOwner");
const modalAmount = document.getElementById("modalAmount");
const modalTransferContent = document.getElementById("modalTransferContent");
const paymentWaitingBox = document.getElementById("paymentWaitingBox");
const paymentSuccessBox = document.getElementById("paymentSuccessBox");
let orderPollTimer = null;

// Thông tin nhận hàng & Địa chỉ giao
const deliveryMethodRadios = document.querySelectorAll('input[name="deliveryMethod"]');
const recipientName = document.getElementById("recipientName");
const recipientPhone = document.getElementById("recipientPhone");
const shippingAddressContainer = document.getElementById("shippingAddressContainer");
const recipientAddress = document.getElementById("recipientAddress");

// Giỏ hàng & Đơn của tôi DOM Elements
const btnOpenCart = document.getElementById("btnOpenCart");
const cartBadge = document.getElementById("cartBadge");
const cartModal = document.getElementById("cartModal");
const btnCloseCart = document.getElementById("btnCloseCart");
const modalCartCount = document.getElementById("modalCartCount");
const cartSearchForm = document.getElementById("cartSearchForm");
const cartSearchInput = document.getElementById("cartSearchInput");
const myOrdersList = document.getElementById("myOrdersList");

// Tùy chọn Hỗ trợ thiết kế
const needDesignCheck = document.getElementById("needDesignCheck");
const designFields = document.getElementById("designFields");
const customerNote = document.getElementById("customerNote");

if (needDesignCheck && designFields) {
    needDesignCheck.addEventListener("change", () => {
        designFields.classList.toggle("hidden", !needDesignCheck.checked);
        if (needDesignCheck.checked && customerNote) {
            customerNote.focus();
        }
    });
}

function getSelectedDeliveryMethod() {
    const checked = document.querySelector('input[name="deliveryMethod"]:checked');
    return checked ? checked.value : "shipping";
}

if (deliveryMethodRadios) {
    deliveryMethodRadios.forEach(radio => {
        radio.addEventListener("change", () => {
            const method = getSelectedDeliveryMethod();
            if (shippingAddressContainer) {
                shippingAddressContainer.classList.toggle("hidden", method === "pickup");
            }
            try {
                localStorage.setItem("laser_delivery_method", method);
            } catch (e) {}
        });
    });
}

// Lưu trữ & Tải thông tin người nhận vào localStorage
function loadRecipientProfile() {
    try {
        const savedName = localStorage.getItem("laser_recipient_name");
        const savedPhone = localStorage.getItem("laser_recipient_phone");
        const savedAddress = localStorage.getItem("laser_recipient_address");
        const savedMethod = localStorage.getItem("laser_delivery_method") || "shipping";

        if (savedName && recipientName) recipientName.value = savedName;
        if (savedPhone && recipientPhone) recipientPhone.value = savedPhone;
        if (savedAddress && recipientAddress) recipientAddress.value = savedAddress;

        const radio = document.querySelector(`input[name="deliveryMethod"][value="${savedMethod}"]`);
        if (radio) {
            radio.checked = true;
            if (shippingAddressContainer) {
                shippingAddressContainer.classList.toggle("hidden", savedMethod === "pickup");
            }
        }
    } catch (e) {
        console.warn("Không thể tải thông tin đã lưu:", e);
    }
}

function saveRecipientProfile() {
    try {
        if (recipientName) localStorage.setItem("laser_recipient_name", recipientName.value.trim());
        if (recipientPhone) localStorage.setItem("laser_recipient_phone", recipientPhone.value.trim());
        if (recipientAddress) localStorage.setItem("laser_recipient_address", recipientAddress.value.trim());
        localStorage.setItem("laser_delivery_method", getSelectedDeliveryMethod());
    } catch (e) {
        console.warn("Không thể lưu thông tin:", e);
    }
}

// Quản lý danh sách mã đơn trong giỏ hàng LocalStorage
function getMyOrderIds() {
    try {
        const raw = localStorage.getItem("laser_my_orders");
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return [...new Set(parsed.map(x => String(x).trim()).filter(Boolean))];
        }
        return [];
    } catch (e) {
        return [];
    }
}

function addMyOrderId(orderId) {
    if (!orderId) return;
    try {
        const ids = getMyOrderIds();
        const next = [orderId, ...ids.filter(x => x !== orderId)].slice(0, 50);
        localStorage.setItem("laser_my_orders", JSON.stringify(next));
        updateCartBadge();
    } catch (e) {
        console.warn("Không thể lưu mã đơn:", e);
    }
}

function updateCartBadge() {
    const ids = getMyOrderIds();
    const count = ids.length;
    if (cartBadge) {
        if (count > 0) {
            cartBadge.textContent = count > 99 ? "99+" : count;
            cartBadge.classList.remove("hidden");
        } else {
            cartBadge.classList.add("hidden");
        }
    }
    if (modalCartCount) {
        modalCartCount.textContent = `${count} đơn`;
    }
}



// 1. Tải cấu hình hệ thống từ API
async function loadConfig() {
    try {
        const res = await fetch("/api/config");
        const data = await res.json();
        materialsConfig = data.materials;
        bankConfig = data.bank;
        machineConfig = data.machine;

        renderMaterialGrid();
    } catch (err) {
        console.error("Lỗi tải config:", err);
    }
}

// 2. Render danh sách chất liệu phôi
function renderMaterialGrid() {
    materialGrid.innerHTML = "";
    Object.keys(materialsConfig).forEach((key, idx) => {
        const mat = materialsConfig[key];
        const isChecked = key === selectedMaterial;
        const card = document.createElement("label");
        card.className = `border rounded-xl p-3 flex items-center gap-3 cursor-pointer transition-all duration-200 ${
            isChecked ? "border-amber-500 bg-amber-500/10 shadow-md shadow-amber-500/5" : "border-slate-700 bg-slate-900/40 hover:border-slate-500"
        }`;
        card.innerHTML = `
            <input type="radio" name="materialSelect" value="${key}" ${isChecked ? "checked" : ""} class="hidden">
            <div class="w-8 h-8 rounded-lg border border-slate-600 flex-shrink-0 flex items-center justify-center shadow-inner" style="background-color: ${mat.color}">
                <div class="w-2.5 h-2.5 rounded-full" style="background-color: ${mat.burn_color}"></div>
            </div>
            <div class="flex-1 min-w-0">
                <div class="flex justify-between items-baseline">
                    <span class="text-xs font-bold text-white truncate">${mat.name}</span>
                </div>
                <span class="text-[11px] text-slate-400 block">+${formatVND(mat.base_price)} (phôi)</span>
            </div>
        `;

        card.querySelector("input").addEventListener("change", (e) => {
            selectedMaterial = e.target.value;
            renderMaterialGrid();
            triggerPreviewUpdate();
        });

        materialGrid.appendChild(card);
    });
}

// 3. Xử lý Upload Ảnh
imageInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) {
        handleSelectedFile(e.target.files[0]);
    }
});

function handleSelectedFile(file) {
    currentFile = file;
    fileName.textContent = file.name;

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            currentAspectRatio = img.width / img.height;
            fileResolution.textContent = `${img.width} x ${img.height} px`;
            thumbImg.src = e.target.result;

            uploadPlaceholder.classList.add("hidden");
            uploadPreviewBox.classList.remove("hidden");

            // Tự động tính chiều cao theo tỉ lệ của ảnh với chiều rộng 100mm
            if (lockAspect.checked) {
                const w = parseFloat(widthInput.value) || 100;
                const calculatedH = Math.round(w / currentAspectRatio);
                heightInput.value = Math.min(calculatedH, machineConfig.max_height_mm || 400);
            }

            updateDimensionLabel();
            triggerPreviewUpdate();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// 4. Xử lý Tỉ lệ kích thước Rộng x Cao
widthInput.addEventListener("input", () => {
    if (isUpdatingDimension) return;
    isUpdatingDimension = true;
    const w = parseFloat(widthInput.value) || 10;
    if (lockAspect.checked && currentAspectRatio > 0) {
        heightInput.value = Math.max(10, Math.round(w / currentAspectRatio));
    }
    updateDimensionLabel();
    triggerPreviewUpdate();
    isUpdatingDimension = false;
});

heightInput.addEventListener("input", () => {
    if (isUpdatingDimension) return;
    isUpdatingDimension = true;
    const h = parseFloat(heightInput.value) || 10;
    if (lockAspect.checked && currentAspectRatio > 0) {
        widthInput.value = Math.max(10, Math.round(h * currentAspectRatio));
    }
    updateDimensionLabel();
    triggerPreviewUpdate();
    isUpdatingDimension = false;
});

function updateDimensionLabel() {
    const w = parseFloat(widthInput.value) || 0;
    const h = parseFloat(heightInput.value) || 0;
    const wCm = (w / 10).toFixed(1);
    const hCm = (h / 10).toFixed(1);
    const area = ((w * h) / 100).toFixed(1);
    dimensionCm.textContent = `${wCm} x ${hCm} cm (${area} cm²)`;
}

// Chế độ khắc thay đổi
document.querySelectorAll('input[name="engraveMode"]').forEach(radio => {
    radio.addEventListener("change", triggerPreviewUpdate);
});

// 5. Gọi API Preview có debounce (để tránh gọi liên tục khi gõ số)
function triggerPreviewUpdate() {
    if (!currentFile) return;

    clearTimeout(previewDebounceTimer);
    previewDebounceTimer = setTimeout(async () => {
        await requestPreview();
    }, 300);
}

async function requestPreview() {
    if (!currentFile) return;

    previewSpinner.classList.remove("hidden");
    previewStatus.textContent = "Đang xử lý...";

    const w = parseFloat(widthInput.value) || 100;
    const h = parseFloat(heightInput.value) || 100;
    const mode = document.querySelector('input[name="engraveMode"]:checked').value;

    const formData = new FormData();
    formData.append("image", currentFile);
    formData.append("width_mm", w);
    formData.append("height_mm", h);
    formData.append("material", selectedMaterial);
    formData.append("mode", mode);

    try {
        const res = await fetch("/api/preview", {
            method: "POST",
            body: formData
        });

        if (!res.ok) {
            const err = await res.json();
            alert(err.detail || "Lỗi xử lý ảnh");
            return;
        }

        const data = await res.json();
        const pricing = data.pricing;

        // Cập nhật hình ảnh preview mô phỏng
        laserBurnPreview.src = data.preview_image;
        laserBurnPreview.classList.remove("hidden");
        emptyPreviewNotice.classList.add("hidden");

        // Cập nhật bảng giá
        priceBase.textContent = formatVND(pricing.base_price);
        priceArea.textContent = formatVND(pricing.area_price);
        timeEst.textContent = `${pricing.estimated_minutes} phút`;
        priceTotal.textContent = formatVND(pricing.total_price);

        previewStatus.textContent = `Ước tính: ${pricing.estimated_minutes} phút khắc`;
        btnCheckout.removeAttribute("disabled");

    } catch (err) {
        console.error("Lỗi request preview:", err);
        previewStatus.textContent = "Lỗi tính toán";
    } finally {
        previewSpinner.classList.add("hidden");
    }
}

// 6. Xử lý Đặt hàng & Tạo mã VietQR
btnCheckout.addEventListener("click", async () => {
    if (!currentFile) {
        alert("Vui lòng tải ảnh bạn muốn khắc lên trước nhé!");
        imageInput.click();
        return;
    }

    const name = recipientName ? recipientName.value.trim() : "";
    const phone = recipientPhone ? recipientPhone.value.trim() : "";
    const method = getSelectedDeliveryMethod();
    const address = recipientAddress ? recipientAddress.value.trim() : "";
    const needDesign = needDesignCheck ? needDesignCheck.checked : false;
    const note = customerNote ? customerNote.value.trim() : "";

    // Kiểm tra thông tin người nhận
    if (!name) {
        alert("Quý khách vui lòng nhập Họ & Tên người nhận hàng nhé!");
        if (recipientName) recipientName.focus();
        return;
    }

    if (!phone || phone.length < 9) {
        alert("Quý khách vui lòng nhập Số điện thoại / Zalo để xưởng tiện liên hệ và gửi hàng!");
        if (recipientPhone) recipientPhone.focus();
        return;
    }

    if (method === "shipping" && !address) {
        alert("Quý khách vui lòng điền Địa chỉ nhận hàng chi tiết để xưởng ship hàng tận tay nhé!");
        if (recipientAddress) recipientAddress.focus();
        return;
    }

    btnCheckout.disabled = true;
    btnCheckout.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Đang tạo file G-code & Mã QR...`;

    const w = parseFloat(widthInput.value) || 100;
    const h = parseFloat(heightInput.value) || 100;
    const mode = document.querySelector('input[name="engraveMode"]:checked').value;

    const formData = new FormData();
    formData.append("image", currentFile);
    formData.append("width_mm", w);
    formData.append("height_mm", h);
    formData.append("material", selectedMaterial);
    formData.append("mode", mode);
    formData.append("customer_name", name);
    formData.append("customer_phone", phone);
    formData.append("delivery_method", method);
    formData.append("shipping_address", method === "shipping" ? address : "");
    formData.append("customer_note", note);
    formData.append("need_design", needDesign ? "true" : "false");

    try {
        const res = await fetch("/api/order", {
            method: "POST",
            body: formData
        });

        const data = await res.json();
        if (data.success && data.order) {
            currentOrderId = data.order.id;

            // Lưu thông tin người nhận và mã đơn vào LocalStorage
            saveRecipientProfile();
            addMyOrderId(currentOrderId);

            // Hiển thị thông tin trong Modal VietQR
            modalOrderId.textContent = currentOrderId;
            qrImage.src = data.vietqr_url;
            bankName.textContent = data.bank_info.bank_id;
            bankAccount.textContent = data.bank_info.account_no;
            bankOwner.textContent = data.bank_info.account_name;
            modalAmount.textContent = formatVND(data.pricing.total_price);
            modalTransferContent.textContent = currentOrderId;

            // Mở Modal & Bắt đầu kiểm tra trạng thái duyệt tiền tự động
            paymentModal.classList.remove("hidden");
            startOrderPolling(currentOrderId);
        } else {
            alert("Không thể tạo đơn hàng: " + (data.message || "Vui lòng thử lại"));
        }
    } catch (err) {
        console.error("Lỗi đặt hàng:", err);
        alert("Lỗi kết nối máy chủ, vui lòng thử lại!");
    } finally {
        btnCheckout.disabled = false;
        btnCheckout.innerHTML = `<i class="fa-solid fa-qrcode text-base"></i> ĐẶT HÀNG & QUÉT MÃ VIETQR`;
    }
});

// Đóng Modal VietQR
btnCloseModal.addEventListener("click", () => {
    paymentModal.classList.add("hidden");
    if (orderPollTimer) {
        clearInterval(orderPollTimer);
        orderPollTimer = null;
    }
});

// Tự động kiểm tra xem tài khoản VIB đã nhận được tiền chưa (3 giây/lần)
function startOrderPolling(orderId) {
    if (orderPollTimer) clearInterval(orderPollTimer);
    paymentWaitingBox.classList.remove("hidden");
    paymentSuccessBox.classList.add("hidden");

    orderPollTimer = setInterval(async () => {
        try {
            const res = await fetch(`/api/order/${orderId}`);
            const data = await res.json();
            if (data.success && data.order) {
                const status = data.order.status;
                if (status === "PAID" || status === "PREPARING" || status === "ENGRAVING" || status === "COMPLETED") {
                    clearInterval(orderPollTimer);
                    orderPollTimer = null;
                    paymentWaitingBox.classList.add("hidden");
                    paymentSuccessBox.classList.remove("hidden");
                }
            }
        } catch (e) {
            console.error("Lỗi kiểm tra trạng thái đơn:", e);
        }
    }, 3000);
}

// Mở lại modal VietQR từ đơn trong Giỏ hàng
function reopenVietQR(orderId, totalAmount, qrUrl) {
    currentOrderId = orderId;
    modalOrderId.textContent = orderId;
    qrImage.src = qrUrl || `https://img.vietqr.io/image/${bankConfig.bank_id || 'VIB'}-${bankConfig.account_no || '352445940'}-compact2.png?amount=${totalAmount}&addInfo=${orderId}&accountName=${encodeURIComponent(bankConfig.account_name || 'HOANG TUAN KHOA')}`;
    bankName.textContent = bankConfig.bank_id || "VIB (Quốc Tế)";
    bankAccount.textContent = bankConfig.account_no || "352445940";
    bankOwner.textContent = bankConfig.account_name || "HOANG TUAN KHOA";
    modalAmount.textContent = formatVND(totalAmount);
    modalTransferContent.textContent = orderId;

    if (cartModal) cartModal.classList.add("hidden");
    paymentModal.classList.remove("hidden");
    startOrderPolling(orderId);
}
window.reopenVietQR = reopenVietQR;

// ==========================================
// 7. Xử Lý Giỏ Hàng & Đơn Của Tôi (Cart & Order History)
// ==========================================
function openCartModal() {
    const modal = document.getElementById("cartModal");
    if (modal) {
        modal.classList.remove("hidden");
        loadMyOrders();
    }
}
window.openCartModal = openCartModal;

function closeCartModal() {
    const modal = document.getElementById("cartModal");
    if (modal) {
        modal.classList.add("hidden");
    }
}
window.closeCartModal = closeCartModal;

if (btnOpenCart) {
    btnOpenCart.addEventListener("click", openCartModal);
}

if (btnCloseCart) {
    btnCloseCart.addEventListener("click", closeCartModal);
}

// Bấm ra ngoài vùng modal hoặc nhấn ESC để đóng
const modalBackdrop = document.getElementById("cartModal");
if (modalBackdrop) {
    modalBackdrop.addEventListener("click", (e) => {
        if (e.target === modalBackdrop) {
            closeCartModal();
        }
    });
}

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        closeCartModal();
        if (paymentModal) paymentModal.classList.add("hidden");
    }
});

// Nút xem tiến trình trong Modal thanh toán thành công
const btnViewOrderProgress = document.getElementById("btnViewOrderProgress");
if (btnViewOrderProgress) {
    btnViewOrderProgress.addEventListener("click", () => {
        paymentModal.classList.add("hidden");
        openCartModal();
    });
}

// Form tra cứu thêm bằng SĐT hoặc Mã đơn
if (cartSearchForm) {
    cartSearchForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const query = cartSearchInput ? cartSearchInput.value.trim() : "";
        if (query) {
            searchOrderTracking(query);
        }
    });
}

async function loadMyOrders() {
    if (!myOrdersList) return;

    myOrdersList.innerHTML = `
        <div class="text-center py-12 text-slate-400">
            <i class="fa-solid fa-circle-notch fa-spin text-amber-400 text-2xl mb-2"></i>
            <p class="text-xs">Đang tải danh sách đơn hàng của bạn...</p>
        </div>
    `;

    const orderIds = getMyOrderIds();
    if (orderIds.length === 0) {
        renderEmptyOrders();
        return;
    }

    try {
        const res = await fetch("/api/order/my-orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ order_ids: orderIds })
        });
        const data = await res.json();
        if (data.success && data.orders && data.orders.length > 0) {
            renderOrderCards(data.orders);
        } else {
            renderEmptyOrders();
        }
    } catch (err) {
        console.error("Lỗi tải đơn hàng:", err);
        renderEmptyOrders();
    }
}

function renderEmptyOrders() {
    if (!myOrdersList) return;
    myOrdersList.innerHTML = `
        <div class="text-center py-12 text-slate-400 space-y-2">
            <div class="w-14 h-14 mx-auto rounded-full bg-slate-800/80 flex items-center justify-center text-slate-500 text-2xl mb-2 border border-slate-700">
                <i class="fa-solid fa-bag-shopping"></i>
            </div>
            <p class="text-sm font-bold text-slate-300">Chưa có đơn hàng nào được lưu</p>
            <p class="text-xs text-slate-500 max-w-sm mx-auto">Tải ảnh lên và bấm Đặt hàng để theo dõi tiến trình gia công 5 bước trực tiếp tại đây mà không sợ mất mã!</p>
        </div>
    `;
}

async function searchOrderTracking(query) {
    if (!myOrdersList) return;
    myOrdersList.innerHTML = `
        <div class="text-center py-10 text-slate-400">
            <i class="fa-solid fa-circle-notch fa-spin text-amber-400 text-2xl mb-2"></i>
            <p class="text-xs">Đang tra cứu theo từ khóa "${query}"...</p>
        </div>
    `;

    try {
        const res = await fetch(`/api/order/track/search?query=${encodeURIComponent(query)}`);
        const data = await res.json();

        if (!data.success || !data.orders || data.orders.length === 0) {
            myOrdersList.innerHTML = `
                <div class="text-center py-10 text-rose-400 text-xs">
                    <i class="fa-regular fa-circle-xmark text-3xl mb-2 block"></i>
                    ${data.message || 'Không tìm thấy đơn hàng nào phù hợp!'}
                </div>
            `;
            return;
        }

        // Tự động lưu các đơn tra cứu được vào my_orders để lần sau không phải tìm lại
        data.orders.forEach(o => addMyOrderId(o.id));

        renderOrderCards(data.orders);
    } catch (err) {
        myOrdersList.innerHTML = `
            <div class="text-center py-8 text-rose-400 text-xs">
                Lỗi kết nối máy chủ khi tra cứu!
            </div>
        `;
    }
}

function renderOrderCards(orders) {
    if (!myOrdersList) return;

    myOrdersList.innerHTML = orders.map(order => {
        const currentStep = order.current_step || 1;
        const isPending = order.status === "PENDING_PAYMENT";
        const isPickup = order.delivery_method === "pickup";

        const steps = [
            { num: 1, title: "Tiếp Nhận", icon: "fa-clipboard-list" },
            { num: 2, title: "Đã Nhận Tiền", icon: "fa-money-bill-wave" },
            { num: 3, title: "Chuẩn Bị Phôi", icon: "fa-layer-group" },
            { num: 4, title: "Đang Khắc", icon: "fa-fire-flame-curved" },
            { num: 5, title: "Hoàn Thành", icon: "fa-circle-check" },
        ];

        return `
            <div class="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3.5 shadow-lg">
                <!-- Header Đơn Hàng -->
                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="font-extrabold text-amber-400 font-mono text-sm">${order.id}</span>
                            <span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-semibold">${order.created_at || ''}</span>
                        </div>
                        <span class="text-xs text-slate-300 block mt-0.5 font-medium">${order.customer_name || 'Khách hàng'} • ${order.customer_phone || ''}</span>
                    </div>
                    <div class="text-right">
                        <span class="text-xs font-bold text-slate-200 block">${order.material_name} (${order.width_mm}x${order.height_mm}mm)</span>
                        <span class="text-sm font-black text-emerald-400">${formatVND(order.total_price)}</span>
                    </div>
                </div>

                <!-- Thông Tin Nhận Hàng -->
                <div class="bg-slate-900/90 rounded-xl p-2.5 border border-slate-800/80 text-xs flex items-start gap-2">
                    ${isPickup ? `
                        <span class="text-emerald-400 font-bold flex items-center gap-1.5 flex-shrink-0">
                            <i class="fa-solid fa-store text-emerald-400"></i> Nhận tại xưởng:
                        </span>
                        <span class="text-slate-300">Khách đến xưởng nhận hàng trực tiếp sau khi hoàn tất</span>
                    ` : `
                        <span class="text-amber-400 font-bold flex items-center gap-1.5 flex-shrink-0">
                            <i class="fa-solid fa-truck-fast text-amber-400"></i> Giao tận nơi:
                        </span>
                        <span class="text-slate-200 font-medium">${order.shipping_address || 'Địa chỉ đang cập nhật'}</span>
                    `}
                </div>

                <!-- Thanh Tiến Trình 5 Bước (Progress Stepper) -->
                <div class="py-2 px-1">
                    <div class="flex items-center justify-between relative">
                        <!-- Đường line nối giữa các bước -->
                        <div class="absolute left-4 right-4 top-1/2 -translate-y-1/2 h-1 bg-slate-800 -z-0"></div>
                        <div class="absolute left-4 top-1/2 -translate-y-1/2 h-1 bg-gradient-to-r from-emerald-500 via-amber-500 to-orange-500 transition-all duration-500 -z-0" 
                             style="width: ${Math.max(0, Math.min(100, (currentStep - 1) * 25))}%;"></div>

                        ${steps.map(s => {
                            const isPassed = s.num < currentStep;
                            const isCurrent = s.num === currentStep;
                            let circleStyle = "bg-slate-800 border-slate-700 text-slate-500";
                            let textStyle = "text-slate-500";

                            if (isPassed) {
                                circleStyle = "bg-emerald-500 border-emerald-400 text-slate-950 font-black";
                                textStyle = "text-emerald-400 font-bold";
                            } else if (isCurrent) {
                                circleStyle = "bg-amber-400 border-white text-slate-950 font-black shadow-lg shadow-amber-400/30 ring-4 ring-amber-400/20";
                                textStyle = "text-amber-300 font-extrabold";
                            }

                            return `
                                <div class="flex flex-col items-center z-10">
                                    <div class="w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 flex items-center justify-center text-[10px] sm:text-xs transition-all ${circleStyle}">
                                        <i class="fa-solid ${s.icon}"></i>
                                    </div>
                                    <span class="text-[9px] sm:text-[10px] mt-1 whitespace-nowrap text-center ${textStyle}">
                                        ${s.title}
                                    </span>
                                </div>
                            `;
                        }).join("")}
                    </div>
                </div>

                <!-- Banner Trạng Thái Hiện Tại & Preview Thumbnail -->
                <div class="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-3">
                    <img src="${order.preview_url}" class="w-12 h-12 object-contain rounded-lg bg-slate-950 border border-slate-700 flex-shrink-0" alt="Preview">
                    <div class="flex-1 min-w-0">
                        <h5 class="text-xs font-bold text-white flex items-center gap-2">
                            <span>${order.step_name}</span>
                            ${currentStep === 4 ? '<span class="w-2 h-2 rounded-full bg-orange-500 animate-ping"></span>' : ''}
                        </h5>
                        <p class="text-[11px] text-slate-400 mt-0.5 leading-relaxed">${order.step_desc}</p>
                    </div>
                </div>

                <!-- Các Nút Hành Động -->
                <div class="flex items-center justify-end gap-2 pt-1 border-t border-slate-850">
                    ${isPending ? `
                        <button onclick="reopenVietQR('${order.id}', ${order.total_price}, '${order.vietqr_url || ''}')" class="px-3.5 py-2 bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-slate-950 rounded-xl text-xs font-black flex items-center gap-1.5 shadow-md shadow-orange-500/20 transition-all">
                            <i class="fa-solid fa-qrcode"></i> Quét lại VietQR
                        </button>
                    ` : ''}

                    <a href="https://zalo.me/0352445940" target="_blank" rel="noopener noreferrer" class="px-3.5 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all">
                        <i class="fa-solid fa-comment-dots text-blue-400"></i> Chat Zalo hỏi xưởng
                    </a>
                </div>
            </div>
        `;
    }).join("");
}

// Tiện ích format VNĐ
function formatVND(amount) {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

// Khởi chạy khi tải trang
document.addEventListener("DOMContentLoaded", () => {
    loadConfig();
    loadRecipientProfile();
    updateCartBadge();
});

/* ==========================================================================
   CHẾ ĐỘ QUẢN LÝ MÁY LASER & ĐIỀU KHIỂN LASERGRBL (DÀNH CHO CHỦ MÁY)
   ========================================================================== */
let isOperatorMode = false;
let operatorPollTimer = null;

const customerSection = document.getElementById("customerSection");
const operatorSection = document.getElementById("operatorSection");
const mainContainer = document.getElementById("mainContainer");
const btnToggleOperator = document.getElementById("btnToggleOperator");
const operatorBtnText = document.getElementById("operatorBtnText");

const operatorPinModal = document.getElementById("operatorPinModal");
const operatorPinForm = document.getElementById("operatorPinForm");
const operatorPinInput = document.getElementById("operatorPinInput");
const operatorPinError = document.getElementById("operatorPinError");
const operatorOrdersTableBody = document.getElementById("operatorOrdersTableBody");

const statTotal = document.getElementById("statTotal");
const statPaid = document.getElementById("statPaid");
const statPreparing = document.getElementById("statPreparing");
const statEngraving = document.getElementById("statEngraving");
const statCompleted = document.getElementById("statCompleted");

const operatorNoticeModal = document.getElementById("operatorNoticeModal");
const operatorNoticeHeading = document.getElementById("operatorNoticeHeading");
const operatorNoticeMsg = document.getElementById("operatorNoticeMsg");
const operatorNoticeActions = document.getElementById("operatorNoticeActions");

function getOperatorPin() {
    return localStorage.getItem("laser_admin_pin") || "";
}

function setOperatorPin(pin) {
    localStorage.setItem("laser_admin_pin", pin);
}

function clearOperatorPin() {
    localStorage.removeItem("laser_admin_pin");
}

function openOperatorPinModal() {
    if (operatorPinModal) {
        operatorPinModal.classList.remove("hidden");
        if (operatorPinInput) {
            operatorPinInput.value = "";
            setTimeout(() => operatorPinInput.focus(), 120);
        }
        if (operatorPinError) operatorPinError.classList.add("hidden");
    }
}

function closeOperatorPinModal() {
    if (operatorPinModal) operatorPinModal.classList.add("hidden");
}

function toggleOperatorMode(targetState) {
    const shouldBeOperator = (typeof targetState === "boolean") ? targetState : !isOperatorMode;

    if (shouldBeOperator) {
        const pin = getOperatorPin();
        if (!pin) {
            openOperatorPinModal();
            return;
        }
        enterOperatorMode();
    } else {
        exitOperatorMode();
    }
}

function enterOperatorMode() {
    isOperatorMode = true;
    if (customerSection) customerSection.classList.add("hidden");
    if (operatorSection) operatorSection.classList.remove("hidden");
    if (mainContainer) {
        mainContainer.classList.remove("max-w-5xl");
        mainContainer.classList.add("max-w-7xl");
    }
    if (operatorBtnText) operatorBtnText.textContent = "Đặt hàng";
    if (btnToggleOperator) {
        btnToggleOperator.classList.add("bg-amber-500/30", "border-amber-400");
    }

    fetchOperatorOrders();
    if (operatorPollTimer) clearInterval(operatorPollTimer);
    operatorPollTimer = setInterval(fetchOperatorOrders, 5000);
}

function exitOperatorMode() {
    isOperatorMode = false;
    if (operatorSection) operatorSection.classList.add("hidden");
    if (customerSection) customerSection.classList.remove("hidden");
    if (mainContainer) {
        mainContainer.classList.remove("max-w-7xl");
        mainContainer.classList.add("max-w-5xl");
    }
    if (operatorBtnText) operatorBtnText.textContent = "Quản lý máy";
    if (btnToggleOperator) {
        btnToggleOperator.classList.remove("bg-amber-500/30", "border-amber-400");
    }

    if (operatorPollTimer) {
        clearInterval(operatorPollTimer);
        operatorPollTimer = null;
    }
}

function logoutOperator() {
    clearOperatorPin();
    exitOperatorMode();
}

if (operatorPinForm) {
    operatorPinForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const pin = operatorPinInput ? operatorPinInput.value.trim() : "";
        if (!pin) return;

        if (operatorPinError) operatorPinError.classList.add("hidden");

        const formData = new FormData();
        formData.append("pin", pin);

        try {
            const res = await fetch("/api/admin/login", {
                method: "POST",
                body: formData
            });

            if (res.ok) {
                setOperatorPin(pin);
                closeOperatorPinModal();
                enterOperatorMode();
            } else {
                if (operatorPinError) {
                    operatorPinError.textContent = "Mã PIN không chính xác! Vui lòng thử lại.";
                    operatorPinError.classList.remove("hidden");
                }
                if (operatorPinInput) operatorPinInput.focus();
            }
        } catch (err) {
            if (operatorPinError) {
                operatorPinError.textContent = "Lỗi kết nối máy chủ";
                operatorPinError.classList.remove("hidden");
            }
        }
    });
}

async function operatorFetch(url, options = {}) {
    const pin = getOperatorPin();
    if (!options.headers) {
        options.headers = {};
    }
    options.headers["X-Admin-PIN"] = pin;

    const res = await fetch(url, options);
    if (res.status === 401) {
        clearOperatorPin();
        exitOperatorMode();
        openOperatorPinModal();
        throw new Error("Mã PIN không đúng hoặc đã hết hạn");
    }
    return res;
}

async function fetchOperatorOrders() {
    if (!getOperatorPin()) return;

    try {
        const res = await operatorFetch("/api/admin/orders");
        const data = await res.json();
        if (data.success && data.orders) {
            renderOperatorOrders(data.orders);
            updateOperatorStats(data.orders);
        }
    } catch (err) {
        console.error("Lỗi lấy danh sách đơn xưởng:", err);
    }
}

function updateOperatorStats(orders) {
    if (statTotal) statTotal.textContent = orders.length;
    if (statPaid) statPaid.textContent = orders.filter(o => o.status === "PAID").length;
    if (statPreparing) statPreparing.textContent = orders.filter(o => o.status === "PREPARING").length;
    if (statEngraving) statEngraving.textContent = orders.filter(o => o.status === "ENGRAVING").length;
    if (statCompleted) statCompleted.textContent = orders.filter(o => o.status === "COMPLETED").length;
}

function renderOperatorOrders(orders) {
    if (!operatorOrdersTableBody) return;

    if (!orders || orders.length === 0) {
        operatorOrdersTableBody.innerHTML = `
            <tr>
                <td colspan="6" class="py-12 text-center text-slate-400">
                    <i class="fa-regular fa-folder-open text-4xl mb-2 block text-slate-500"></i>
                    Chưa có đơn hàng nào trong hệ thống
                </td>
            </tr>
        `;
        return;
    }

    operatorOrdersTableBody.innerHTML = orders.map(order => {
        const previewUrl = `/api/storage/previews/${order.id}_preview.png`;
        const isPending = order.status === "PENDING_PAYMENT";
        const isPaid = order.status === "PAID";
        const isEngraving = order.status === "ENGRAVING";

        return `
            <tr class="hover:bg-slate-700/30 transition-colors ${isPaid ? 'bg-amber-500/5' : ''}">
                <!-- Mã Đơn & Khách Hàng / Giao Nhận -->
                <td class="py-3.5 px-4 min-w-[200px]">
                    <span class="font-bold text-amber-400 font-mono text-sm block">${order.id}</span>
                    <span class="text-[11px] text-slate-400">${order.created_at}</span>
                    <span class="text-[11px] text-slate-200 font-bold block mt-0.5">${order.customer_name || 'Khách Web'}</span>

                    <!-- Nút Chat Zalo -->
                    ${order.customer_phone ? `
                        <a href="https://zalo.me/${order.customer_phone}" target="_blank" class="inline-flex items-center gap-1 text-[11px] text-blue-400 font-bold hover:underline mt-1 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                            <i class="fa-solid fa-comment-dots text-[10px]"></i> Zalo: ${order.customer_phone}
                        </a>
                    ` : ''}

                    <!-- Giao nhận hàng -->
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

                    <!-- Yêu cầu thiết kế -->
                    ${order.customer_note && order.customer_note.includes('[CẦN THIẾT KẾ]') ? `
                        <span class="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-extrabold bg-purple-500/20 text-purple-300 border border-purple-500/30 block w-fit">
                            🎨 CẦN TƯ VẤN THIẾT KẾ
                        </span>
                        <p class="text-[11px] text-amber-200/90 italic mt-0.5 bg-slate-950/60 p-1.5 rounded border border-slate-800">
                            ${order.customer_note.replace('[CẦN THIẾT KẾ]', '').trim() || 'Khách nhờ chỉnh sửa/tách nền'}
                        </p>
                    ` : (order.customer_note ? `<p class="text-[10px] text-slate-400 italic mt-0.5">${order.customer_note}</p>` : '')}
                </td>

                <!-- Ảnh Thumbnail Vết Cháy -->
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
                        <select onchange="updateOrderStatus('${order.id}', this.value)" class="w-full text-[11px] font-bold py-1.5 px-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 focus:outline-none focus:border-amber-500 cursor-pointer">
                            <option value="PENDING_PAYMENT" ${order.status === 'PENDING_PAYMENT' ? 'selected' : ''}>⏳ 1. Chờ Chuyển Khoản</option>
                            <option value="PAID" ${order.status === 'PAID' ? 'selected' : ''}>✅ 2. Đã Nhận Tiền (VIB)</option>
                            <option value="PREPARING" ${order.status === 'PREPARING' ? 'selected' : ''}>🎨 3. Chuẩn Bị Phôi & File</option>
                            <option value="ENGRAVING" ${order.status === 'ENGRAVING' ? 'selected' : ''}>🔥 4. Đang Khắc Laser</option>
                            <option value="COMPLETED" ${order.status === 'COMPLETED' ? 'selected' : ''}>🎉 5. Hoàn Thành / Giao</option>
                            <option value="CANCELLED" ${order.status === 'CANCELLED' ? 'selected' : ''}>❌ Hủy Đơn Hàng</option>
                        </select>
                        
                        <!-- Nút duyệt tiền chỉ hiện khi đang chờ thanh toán -->
                        ${isPending ? `
                            <button onclick="confirmOperatorPayment('${order.id}')" class="w-full py-1.5 px-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1 shadow-md shadow-emerald-600/20 transition-all">
                                <i class="fa-solid fa-check"></i> Duyệt Đã Nhận Tiền
                            </button>
                        ` : ''}

                        <!-- Nút báo xong nhanh khi đang khắc -->
                        ${isEngraving ? `
                            <button onclick="updateOrderStatus('${order.id}', 'COMPLETED')" class="w-full py-1 px-2 bg-emerald-600/90 hover:bg-emerald-600 text-white rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-all">
                                <i class="fa-solid fa-circle-check"></i> Báo Đã Khắc Xong
                            </button>
                        ` : ''}
                    </div>
                </td>

                <!-- Thao tác LaserGRBL -->
                <td class="py-3.5 px-4 text-center">
                    <div class="flex items-center justify-center gap-2">
                        ${isPending ? `
                            <!-- Chưa thanh toán: Khóa nút khắc để bảo vệ máy -->
                            <button disabled class="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-500 text-xs font-semibold cursor-not-allowed border border-slate-700" title="Khách chưa thanh toán, không thể khắc">
                                <i class="fa-solid fa-lock text-[10px] mr-1"></i> Chưa duyệt tiền
                            </button>
                        ` : `
                            <!-- Đã thanh toán: Mở khóa nút LaserGRBL -->
                            <button onclick="openLaserGRBL('${order.id}')" class="px-3 py-1.5 rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-md shadow-orange-500/20 hover:scale-105 active:scale-95 transition-all">
                                <i class="fa-solid fa-play text-[10px]"></i> Mở LaserGRBL
                            </button>
                        `}

                        <!-- Nút Tải File G-code .NC -->
                        <a href="/api/admin/orders/${order.id}/download-gcode" class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 hover:text-white text-xs font-semibold flex items-center gap-1 transition-all" title="Tải file .NC để chép vào thẻ nhớ MicroSD">
                            <i class="fa-solid fa-download"></i> .NC
                        </a>
                    </div>
                </td>
            </tr>
        `;
    }).join("");
}

async function confirmOperatorPayment(orderId) {
    if (!confirm(`Bạn có chắc chắn đã nhận được tiền từ tài khoản VIB cho đơn hàng [${orderId}]?`)) {
        return;
    }

    try {
        const res = await operatorFetch(`/api/admin/orders/${orderId}/confirm-payment`, {
            method: "POST"
        });
        const data = await res.json();
        if (data.success) {
            fetchOperatorOrders();
        } else {
            alert(data.detail || "Lỗi khi duyệt thanh toán");
        }
    } catch (err) {
        console.error("Lỗi duyệt tiền:", err);
    }
}

async function updateOrderStatus(orderId, newStatus) {
    const formData = new FormData();
    formData.append("status", newStatus);

    try {
        await operatorFetch(`/api/admin/orders/${orderId}/status`, {
            method: "POST",
            body: formData
        });
        fetchOperatorOrders();
    } catch (err) {
        console.error("Lỗi cập nhật trạng thái:", err);
    }
}

async function openLaserGRBL(orderId) {
    try {
        const res = await operatorFetch(`/api/admin/orders/${orderId}/open-lasergrbl`, {
            method: "POST"
        });
        const data = await res.json();

        // 1. Kích hoạt mở LaserGRBL qua giao thức lasergrbl://
        if (data.lasergrbl_uri) {
            window.location.href = data.lasergrbl_uri;
        }

        // 2. Hiển thị thông báo hướng dẫn
        if (operatorNoticeModal) {
            if (operatorNoticeHeading) {
                operatorNoticeHeading.textContent = data.local_launched 
                    ? "Đã Mở LaserGRBL Trực Tiếp" 
                    : "Đang Khởi Chạy LaserGRBL...";
            }
            if (operatorNoticeMsg) {
                let msg = data.message || "";
                if (data.cloud_mode) {
                    msg += "\n\n🚀 Trình duyệt đang kích hoạt mở phần mềm LaserGRBL trên máy tính của bạn.\n"
                        + "👉 Nếu bạn chưa chạy cài đặt 1-chạm, hãy nhấp đúp file 'cai_dat_ket_noi_lasergrbl.bat' trong thư mục D:\\Laser!";
                }
                operatorNoticeMsg.textContent = msg;
            }
            if (operatorNoticeActions) {
                operatorNoticeActions.innerHTML = `
                    <a href="/api/admin/orders/${orderId}/download-gcode" download="${orderId}.nc" class="px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-bold flex items-center gap-1">
                        <i class="fa-solid fa-download"></i> Tải File .NC Thủ Công
                    </a>
                    <button onclick="document.getElementById('operatorNoticeModal').classList.add('hidden')" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold">
                        Đóng
                    </button>
                `;
            }
            operatorNoticeModal.classList.remove("hidden");
        }

        if (data.success) {
            updateOrderStatus(orderId, "ENGRAVING");
        }
    } catch (err) {
        alert("Lỗi khi kết nối với LaserGRBL: " + err.message);
    }
}

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

// Gắn các hàm ra window để truy cập từ HTML onclick/onchange
window.toggleOperatorMode = toggleOperatorMode;
window.closeOperatorPinModal = closeOperatorPinModal;
window.logoutOperator = logoutOperator;
window.fetchOperatorOrders = fetchOperatorOrders;
window.confirmOperatorPayment = confirmOperatorPayment;
window.updateOrderStatus = updateOrderStatus;
window.openLaserGRBL = openLaserGRBL;
window.copyAddress = copyAddress;


