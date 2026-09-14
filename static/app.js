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
const btnConfirmPaid = document.getElementById("btnConfirmPaid");

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
    if (!currentFile) return;

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
    formData.append("customer_name", "Khách hàng Web");

    try {
        const res = await fetch("/api/order", {
            method: "POST",
            body: formData
        });

        const data = await res.json();
        if (data.success) {
            currentOrderId = data.order.id;

            // Hiển thị thông tin trong Modal
            modalOrderId.textContent = currentOrderId;
            qrImage.src = data.vietqr_url;
            bankName.textContent = data.bank_info.bank_id;
            bankAccount.textContent = data.bank_info.account_no;
            bankOwner.textContent = data.bank_info.account_name;
            modalAmount.textContent = formatVND(data.pricing.total_price);
            modalTransferContent.textContent = currentOrderId;

            // Mở Modal
            paymentModal.classList.remove("hidden");
        } else {
            alert("Không thể tạo đơn hàng, vui lòng thử lại!");
        }
    } catch (err) {
        console.error("Lỗi đặt hàng:", err);
        alert("Lỗi kết nối máy chủ");
    } finally {
        btnCheckout.disabled = false;
        btnCheckout.innerHTML = `<i class="fa-solid fa-qrcode text-base"></i> ĐẶT HÀNG & QUÉT MÃ VIETQR`;
    }
});

// Đóng Modal
btnCloseModal.addEventListener("click", () => {
    paymentModal.classList.add("hidden");
});

// Xác nhận đã chuyển khoản
btnConfirmPaid.addEventListener("click", async () => {
    if (!currentOrderId) return;

    btnConfirmPaid.disabled = true;
    btnConfirmPaid.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Đang kiểm tra...`;

    try {
        const res = await fetch(`/api/order/${currentOrderId}/confirm-payment`, {
            method: "POST"
        });
        const data = await res.json();

        if (data.success) {
            paymentModal.classList.add("hidden");
            alert(`🎉 Cảm ơn bạn! Đơn hàng [${currentOrderId}] đã được xác nhận.\nFile G-code đã được tự động nạp sẵn vào hệ thống máy laser tại xưởng!`);
        }
    } catch (err) {
        console.error("Lỗi xác nhận thanh toán:", err);
    } finally {
        btnConfirmPaid.disabled = false;
        btnConfirmPaid.innerHTML = `<i class="fa-solid fa-circle-check"></i> Tôi Đã Chuyển Khoản Thành Công`;
    }
});

// Tiện ích format VNĐ
function formatVND(amount) {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

// Khởi chạy khi load trang
document.addEventListener("DOMContentLoaded", loadConfig);
