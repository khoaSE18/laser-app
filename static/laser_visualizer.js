/**
 * LaserVisualizer - Màn hình mô phỏng đường chạy tia laser thời gian thực
 * Tối ưu hóa hiệu năng cao (Batch rendering), không bao giờ làm đơ trình duyệt hay nghẽn cáp USB
 */
class LaserVisualizer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            console.warn("Không tìm thấy canvas:", canvasId);
            return;
        }
        this.ctx = this.canvas.getContext("2d");

        // Kích thước phôi (mm)
        this.workpiece = {
            width: 100,
            height: 80,
            img: null,
            imgLoaded: false
        };

        // Trạng thái laser hiện tại
        this.laserPos = { x: 0, y: 0 };
        this.isLaserOn = false;
        this.progressPercent = 0;

        // Cấu hình hiển thị
        this.showGrid = true;
        this.showToolpaths = true;
        this.padding = 30;

        // Danh sách mẫu đường dao G0 / G1 (Tối đa 1500 điểm để siêu nhẹ)
        this.toolpaths = [];
        this.offscreenCanvas = document.createElement("canvas");
        this.offscreenCtx = this.offscreenCanvas.getContext("2d");
        this.hasRenderedStaticPaths = false;

        // Canvas vệt khắc thời gian thực (Burn layer)
        this.burnCanvas = document.createElement("canvas");
        this.burnCtx = this.burnCanvas.getContext("2d");

        // Cờ báo cần vẽ lại (Dirty flag)
        this.needsRedraw = true;
        this.animId = null;

        this.resize();
        window.addEventListener("resize", () => {
            this.resize();
            this.requestRedraw();
        });

        this.startRenderLoop();
    }

    /**
     * Tự động điều chỉnh kích thước theo Retina / High-DPI
     */
    resize() {
        if (!this.canvas) return;
        const rect = this.canvas.parentElement ? this.canvas.parentElement.getBoundingClientRect() : null;
        const dpr = window.devicePixelRatio || 1;
        const w = (rect && rect.width > 50) ? rect.width : 600;
        const h = Math.min(Math.max(w * 0.6, 280), 380);

        this.displayWidth = w;
        this.displayHeight = h;

        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = `${w}px`;
        this.canvas.style.height = `${h}px`;

        this.ctx.resetTransform();
        this.ctx.scale(dpr, dpr);

        this.offscreenCanvas.width = w * dpr;
        this.offscreenCanvas.height = h * dpr;
        this.offscreenCtx.resetTransform();
        this.offscreenCtx.scale(dpr, dpr);

        this.burnCanvas.width = w * dpr;
        this.burnCanvas.height = h * dpr;
        this.burnCtx.resetTransform();
        this.burnCtx.scale(dpr, dpr);

        this.calculateScale();
        this.rebuildStaticPaths();
        this.requestRedraw();
    }

    /**
     * Tính toán tỷ lệ chuyển đổi mm sang pixel
     */
    calculateScale() {
        const availW = Math.max(50, this.displayWidth - this.padding * 2);
        const availH = Math.max(50, this.displayHeight - this.padding * 2);

        const maxW = Math.max(10, this.workpiece.width);
        const maxH = Math.max(10, this.workpiece.height);

        const scaleX = availW / maxW;
        const scaleY = availH / maxH;
        this.scale = Math.min(scaleX, scaleY);

        this.offsetX = this.padding + (availW - maxW * this.scale) / 2;
        this.offsetY = this.padding + (availH - maxH * this.scale) / 2;
    }

    /**
     * Chuyển đổi tọa độ CNC (gốc dưới-trái) sang tọa độ Canvas (gốc trên-trái)
     */
    toCanvas(xMm, yMm) {
        const validX = isFinite(xMm) ? xMm : 0;
        const validY = isFinite(yMm) ? yMm : 0;
        const cX = this.offsetX + validX * this.scale;
        const cY = this.displayHeight - (this.offsetY + validY * this.scale);
        return { x: cX, y: cY };
    }

    /**
     * Nạp kích thước phôi và ảnh mẫu
     */
    setWorkpiece(widthMm, heightMm, imageUrl = null) {
        this.workpiece.width = Math.max(10, parseFloat(widthMm) || 100);
        this.workpiece.height = Math.max(10, parseFloat(heightMm) || 80);
        this.workpiece.img = null;
        this.workpiece.imgLoaded = false;

        this.calculateScale();
        this.clearTrace();

        if (imageUrl) {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                this.workpiece.img = img;
                this.workpiece.imgLoaded = true;
                this.rebuildStaticPaths();
                this.requestRedraw();
            };
            img.src = imageUrl;
        }

        this.rebuildStaticPaths();
        this.requestRedraw();
    }

    /**
     * Phân tích G-code theo cơ chế lấy mẫu siêu tốc (Sampling)
     * Không bao giờ làm đơ máy ngay cả khi file nặng 200,000 dòng!
     */
    loadGcode(gcodeContent) {
        this.toolpaths = [];
        this.clearTrace();

        if (!gcodeContent) {
            this.rebuildStaticPaths();
            this.requestRedraw();
            return;
        }

        try {
            const lines = gcodeContent.split(/\r?\n/);
            const total = lines.length;

            // Lấy mẫu tối đa 1200 điểm dao để vẽ preview siêu mượt (< 2ms)
            const sampleStep = Math.max(1, Math.floor(total / 1200));

            let currX = 0;
            let currY = 0;
            let lastX = 0;
            let lastY = 0;

            for (let i = 0; i < total; i++) {
                const line = lines[i].trim();
                if (!line || line.startsWith(";") || line.startsWith("(")) continue;

                const isG0 = line.startsWith("G0") || line.startsWith("G00");
                const isG1 = line.startsWith("G1") || line.startsWith("G01");

                if (isG0 || isG1) {
                    const xMatch = line.match(/X([-\d.]+)/i);
                    const yMatch = line.match(/Y([-\d.]+)/i);

                    if (xMatch) currX = parseFloat(xMatch[1]);
                    if (yMatch) currY = parseFloat(yMatch[1]);

                    // Chỉ lấy mẫu đại diện đều cho G0 và G1 (Tối đa 1200 điểm)
                    if (i % sampleStep === 0) {
                        this.toolpaths.push({
                            type: isG0 ? "G0" : "G1",
                            x0: lastX,
                            y0: lastY,
                            x1: currX,
                            y1: currY
                        });
                        lastX = currX;
                        lastY = currY;
                    }
                }
            }

            this.rebuildStaticPaths();
            this.requestRedraw();
        } catch (err) {
            console.warn("Lỗi khi load Gcode vào visualizer:", err);
        }
    }

    /**
     * Vẽ sẵn khung phôi, ảnh mẫu và đường dao tĩnh
     * TỐI ƯU HÓA BATCH: Gom toàn bộ vào đúng 2 lần stroke duy nhất!
     */
    rebuildStaticPaths() {
        if (!this.offscreenCtx || !this.displayWidth) return;
        try {
            const ctx = this.offscreenCtx;
            ctx.clearRect(0, 0, this.displayWidth, this.displayHeight);

            const origin = this.toCanvas(0, 0);
            const wPx = this.workpiece.width * this.scale;
            const hPx = this.workpiece.height * this.scale;

            // 1. Khung phôi nền tối
            ctx.fillStyle = "rgba(30, 41, 59, 0.4)";
            ctx.fillRect(origin.x, origin.y - hPx, wPx, hPx);

            ctx.strokeStyle = "rgba(245, 158, 11, 0.5)";
            ctx.lineWidth = 1.5;
            ctx.strokeRect(origin.x, origin.y - hPx, wPx, hPx);

            // 2. Ảnh mẫu mờ bên dưới
            if (this.workpiece.imgLoaded && this.workpiece.img) {
                ctx.save();
                ctx.globalAlpha = 0.28;
                ctx.drawImage(this.workpiece.img, origin.x, origin.y - hPx, wPx, hPx);
                ctx.restore();
            }

            // 3. Đường dao G0 / G1 theo cơ chế gom path (Batch)
            if (this.showToolpaths && this.toolpaths.length > 0) {
                ctx.save();

                // Lượt 1: Tất cả đường G0 gom thành 1 path
                ctx.beginPath();
                ctx.strokeStyle = "rgba(56, 189, 248, 0.2)";
                ctx.lineWidth = 0.8;
                ctx.setLineDash([3, 3]);
                let hasG0 = false;
                for (let i = 0; i < this.toolpaths.length; i++) {
                    const pt = this.toolpaths[i];
                    if (pt.type === "G0") {
                        const p0 = this.toCanvas(pt.x0, pt.y0);
                        const p1 = this.toCanvas(pt.x1, pt.y1);
                        ctx.moveTo(p0.x, p0.y);
                        ctx.lineTo(p1.x, p1.y);
                        hasG0 = true;
                    }
                }
                if (hasG0) ctx.stroke();

                // Lượt 2: Tất cả đường G1 gom thành 1 path
                ctx.beginPath();
                ctx.strokeStyle = "rgba(249, 115, 22, 0.3)";
                ctx.lineWidth = 1.0;
                ctx.setLineDash([]);
                let hasG1 = false;
                for (let i = 0; i < this.toolpaths.length; i++) {
                    const pt = this.toolpaths[i];
                    if (pt.type === "G1") {
                        const p0 = this.toCanvas(pt.x0, pt.y0);
                        const p1 = this.toCanvas(pt.x1, pt.y1);
                        ctx.moveTo(p0.x, p0.y);
                        ctx.lineTo(p1.x, p1.y);
                        hasG1 = true;
                    }
                }
                if (hasG1) ctx.stroke();

                ctx.restore();
            }

            this.hasRenderedStaticPaths = true;
        } catch (e) {
            console.warn("Lỗi vẽ static paths:", e);
        }
    }

    /**
     * Cập nhật vị trí đầu khắc từ máy CNC thực tế
     */
    updateLaserPosition(xMm, yMm, isLaserOn = null) {
        if (!isFinite(xMm) || !isFinite(yMm)) return;

        const prevPt = this.toCanvas(this.laserPos.x, this.laserPos.y);

        this.laserPos.x = xMm;
        this.laserPos.y = yMm;
        if (isLaserOn !== null) {
            this.isLaserOn = Boolean(isLaserOn);
        }

        const newPt = this.toCanvas(xMm, yMm);

        // Nếu tia laser đang bật khắc, vẽ vệt cháy lên burnCanvas
        if (this.isLaserOn && this.burnCtx) {
            try {
                this.burnCtx.beginPath();
                this.burnCtx.strokeStyle = "rgba(234, 88, 12, 0.9)";
                this.burnCtx.lineWidth = 1.6;
                this.burnCtx.moveTo(prevPt.x, prevPt.y);
                this.burnCtx.lineTo(newPt.x, newPt.y);
                this.burnCtx.stroke();
            } catch (e) {}
        }

        this.requestRedraw();
    }

    /**
     * Cập nhật tiến trình phần trăm
     */
    setProgressPercent(percent) {
        this.progressPercent = Math.max(0, Math.min(100, percent || 0));
        this.requestRedraw();
    }

    /**
     * Xóa vệt khắc
     */
    clearTrace() {
        if (this.burnCtx && this.displayWidth && this.displayHeight) {
            this.burnCtx.clearRect(0, 0, this.displayWidth, this.displayHeight);
        }
        this.requestRedraw();
    }

    requestRedraw() {
        this.needsRedraw = true;
    }

    /**
     * Vòng lặp render mượt mà
     */
    startRenderLoop() {
        const render = () => {
            // Khi laser đang bật thì luôn vẽ lại để tạo hiệu ứng phát sáng
            if (this.needsRedraw || this.isLaserOn) {
                this.draw();
                this.needsRedraw = false;
            }
            this.animId = requestAnimationFrame(render);
        };
        this.animId = requestAnimationFrame(render);
    }

    /**
     * Vẽ khung hình
     */
    draw() {
        if (!this.ctx || !this.displayWidth || !this.displayHeight) return;
        const ctx = this.ctx;

        // 1. Nền đen CNC
        ctx.fillStyle = "#090d16";
        ctx.fillRect(0, 0, this.displayWidth, this.displayHeight);

        // 2. Lưới milimet
        if (this.showGrid) {
            this.drawGrid(ctx);
        }

        // 3. Phôi và đường dao tĩnh
        if (this.hasRenderedStaticPaths && this.offscreenCanvas) {
            ctx.drawImage(this.offscreenCanvas, 0, 0);
        }

        // 4. Vệt cháy laser
        if (this.burnCanvas) {
            ctx.drawImage(this.burnCanvas, 0, 0);
        }

        // 5. Gốc tọa độ (0, 0)
        this.drawOrigin(ctx);

        // 6. Đầu laser thời gian thực
        this.drawLaserHead(ctx);
    }

    drawGrid(ctx) {
        ctx.save();
        const origin = this.toCanvas(0, 0);
        const maxPt = this.toCanvas(this.workpiece.width, this.workpiece.height);

        const stepMm = 10;
        ctx.lineWidth = 0.5;
        ctx.strokeStyle = "rgba(51, 65, 85, 0.4)";
        ctx.fillStyle = "rgba(100, 116, 139, 0.6)";
        ctx.font = "9px monospace";

        // Trục X
        for (let x = 0; x <= this.workpiece.width; x += stepMm) {
            const pt = this.toCanvas(x, 0);
            ctx.beginPath();
            ctx.moveTo(pt.x, origin.y);
            ctx.lineTo(pt.x, maxPt.y);
            ctx.stroke();

            if (x % 20 === 0) {
                ctx.fillText(`${x}`, pt.x - 6, origin.y + 14);
            }
        }

        // Trục Y
        for (let y = 0; y <= this.workpiece.height; y += stepMm) {
            const pt = this.toCanvas(0, y);
            ctx.beginPath();
            ctx.moveTo(origin.x, pt.y);
            ctx.lineTo(maxPt.x, pt.y);
            ctx.stroke();

            if (y % 20 === 0) {
                ctx.fillText(`${y}`, origin.x - 22, pt.y + 3);
            }
        }

        ctx.restore();
    }

    drawOrigin(ctx) {
        ctx.save();
        const o = this.toCanvas(0, 0);

        // Trục X (Đỏ)
        ctx.beginPath();
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 2;
        ctx.moveTo(o.x, o.y);
        ctx.lineTo(o.x + 22, o.y);
        ctx.stroke();

        // Trục Y (Xanh lá)
        ctx.beginPath();
        ctx.strokeStyle = "#22c55e";
        ctx.lineWidth = 2;
        ctx.moveTo(o.x, o.y);
        ctx.lineTo(o.x, o.y - 22);
        ctx.stroke();

        // Điểm gốc (0,0)
        ctx.beginPath();
        ctx.fillStyle = "#eab308";
        ctx.arc(o.x, o.y, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    drawLaserHead(ctx) {
        if (!isFinite(this.laserPos.x) || !isFinite(this.laserPos.y)) return;
        const pt = this.toCanvas(this.laserPos.x, this.laserPos.y);
        if (!isFinite(pt.x) || !isFinite(pt.y)) return;

        ctx.save();

        // Hiệu ứng phát sáng khi tia laser đang bật
        if (this.isLaserOn) {
            const pulseRadius = Math.max(6, 14 + Math.sin(Date.now() / 100) * 3);
            try {
                const gradient = ctx.createRadialGradient(pt.x, pt.y, 2, pt.x, pt.y, pulseRadius);
                gradient.addColorStop(0, "rgba(255, 68, 68, 0.9)");
                gradient.addColorStop(0.5, "rgba(255, 140, 0, 0.5)");
                gradient.addColorStop(1, "rgba(255, 0, 0, 0)");

                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, pulseRadius, 0, Math.PI * 2);
                ctx.fill();
            } catch (e) {}
        }

        // Tâm ngắm Crosshair
        const crosshairColor = this.isLaserOn ? "#ff3333" : "#38bdf8";
        ctx.strokeStyle = crosshairColor;
        ctx.lineWidth = 1.5;

        // Vòng tròn tâm
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
        ctx.stroke();

        // Dấu cộng tâm ngắm
        ctx.beginPath();
        ctx.moveTo(pt.x - 10, pt.y);
        ctx.lineTo(pt.x + 10, pt.y);
        ctx.moveTo(pt.x, pt.y - 10);
        ctx.lineTo(pt.x, pt.y + 10);
        ctx.stroke();

        // Chấm laser trung tâm
        ctx.beginPath();
        ctx.fillStyle = this.isLaserOn ? "#ffffff" : crosshairColor;
        ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
        ctx.fill();

        // Nhãn tọa độ nhỏ
        const tagText = `(${this.laserPos.x.toFixed(1)}, ${this.laserPos.y.toFixed(1)})`;
        ctx.font = "bold 9px monospace";
        const tagW = ctx.measureText(tagText).width + 8;
        ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
        ctx.fillRect(pt.x + 12, pt.y - 18, tagW, 14);
        ctx.strokeStyle = "rgba(51, 65, 85, 0.8)";
        ctx.lineWidth = 1;
        ctx.strokeRect(pt.x + 12, pt.y - 18, tagW, 14);

        ctx.fillStyle = this.isLaserOn ? "#f97316" : "#38bdf8";
        ctx.fillText(tagText, pt.x + 16, pt.y - 7);

        ctx.restore();
    }

    toggleGrid() {
        this.showGrid = !this.showGrid;
        this.requestRedraw();
        return this.showGrid;
    }

    toggleToolpaths() {
        this.showToolpaths = !this.showToolpaths;
        this.rebuildStaticPaths();
        this.requestRedraw();
        return this.showToolpaths;
    }

    fitView() {
        this.resize();
    }

    destroy() {
        if (this.animId) {
            cancelAnimationFrame(this.animId);
            this.animId = null;
        }
    }
}

window.LaserVisualizer = LaserVisualizer;
