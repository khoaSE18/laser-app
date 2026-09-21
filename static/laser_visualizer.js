/**
 * LaserVisualizer - Màn hình mô phỏng đường chạy tia laser thời gian thực
 * Vẽ lưới tọa độ CNC, hiển thị ảnh mẫu, đường chạy dao G0/G1 và tâm ngắm laser thực tế
 */
class LaserVisualizer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            console.error("Không tìm thấy canvas với ID:", canvasId);
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
        this.currentLineIdx = 0;
        this.totalLines = 0;

        // Cấu hình hiển thị
        this.showGrid = true;
        this.showToolpaths = true;
        this.padding = 35; // Lề tính bằng pixel

        // Toolpaths đã trích xuất từ G-code
        this.toolpaths = []; // { type: 'G0' | 'G1', x: number, y: number, s: number }
        this.offscreenCanvas = document.createElement("canvas");
        this.offscreenCtx = this.offscreenCanvas.getContext("2d");
        this.hasRenderedStaticPaths = false;

        // Vết khắc thời gian thực (Persistent Burn Canvas)
        this.burnCanvas = document.createElement("canvas");
        this.burnCtx = this.burnCanvas.getContext("2d");

        // Vòng lặp animation
        this.animId = null;
        this.lastLaserX = 0;
        this.lastLaserY = 0;

        // Khởi tạo kích thước canvas
        this.resize();
        window.addEventListener("resize", () => this.resize());

        // Bắt đầu vòng lặp vẽ 60fps
        this.startRenderLoop();
    }

    /**
     * Tự động điều chỉnh độ phân giải canvas theo Retina / High-DPI
     */
    resize() {
        if (!this.canvas) return;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = rect.width || 600;
        const h = Math.min(w * 0.65, 420); // Tỷ lệ chiều cao hài hòa

        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = `${w}px`;
        this.canvas.style.height = `${h}px`;

        this.ctx.resetTransform();
        this.ctx.scale(dpr, dpr);

        this.displayWidth = w;
        this.displayHeight = h;

        // Cập nhật kích thước offscreen canvases
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
    }

    /**
     * Tính toán tỷ lệ chuyển đổi từ milimet sang pixel
     */
    calculateScale() {
        const availW = this.displayWidth - this.padding * 2;
        const availH = this.displayHeight - this.padding * 2;

        const maxW = Math.max(10, this.workpiece.width);
        const maxH = Math.max(10, this.workpiece.height);

        const scaleX = availW / maxW;
        const scaleY = availH / maxH;
        this.scale = Math.min(scaleX, scaleY);

        // Canh giữa phôi trên màn hình
        this.offsetX = this.padding + (availW - maxW * this.scale) / 2;
        this.offsetY = this.padding + (availH - maxH * this.scale) / 2;
    }

    /**
     * Chuyển đổi tọa độ CNC (gốc dưới-trái) sang tọa độ Canvas (gốc trên-trái)
     */
    toCanvas(xMm, yMm) {
        const cX = this.offsetX + xMm * this.scale;
        const cY = this.displayHeight - (this.offsetY + yMm * this.scale);
        return { x: cX, y: cY };
    }

    /**
     * Nạp thông tin phôi và ảnh mẫu
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
            };
            img.src = imageUrl;
        }

        this.rebuildStaticPaths();
    }

    /**
     * Phân tích nội dung file G-code để lấy danh sách các đường chạy
     */
    loadGcode(gcodeContent) {
        this.toolpaths = [];
        this.currentLineIdx = 0;
        this.clearTrace();

        if (!gcodeContent) return;

        const lines = gcodeContent.split(/\r?\n/);
        let currX = 0;
        let currY = 0;
        let isLaserOn = false;
        let currS = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.startsWith(";") || line.startsWith("(")) continue;

            if (line.includes("M3") || line.includes("M4")) isLaserOn = true;
            if (line.includes("M5")) isLaserOn = false;

            const sMatch = line.match(/S(\d+)/i);
            if (sMatch) currS = parseInt(sMatch[1], 10);

            const isG0 = line.startsWith("G0") || line.startsWith("G00");
            const isG1 = line.startsWith("G1") || line.startsWith("G01");

            if (isG0 || isG1) {
                const xMatch = line.match(/X([-\d.]+)/i);
                const yMatch = line.match(/Y([-\d.]+)/i);

                if (xMatch) currX = parseFloat(xMatch[1]);
                if (yMatch) currY = parseFloat(yMatch[1]);

                this.toolpaths.push({
                    type: isG0 ? "G0" : "G1",
                    x: currX,
                    y: currY,
                    laserOn: isG1 && (isLaserOn || currS > 0),
                    s: currS
                });
            }
        }

        this.totalLines = this.toolpaths.length;
        this.rebuildStaticPaths();
    }

    /**
     * Vẽ sẵn các đường chạy dao tĩnh lên offscreen canvas để tối ưu 60fps
     */
    rebuildStaticPaths() {
        if (!this.offscreenCtx) return;
        const ctx = this.offscreenCtx;
        ctx.clearRect(0, 0, this.displayWidth, this.displayHeight);

        // 1. Vẽ khung phôi chữ nhật
        const origin = this.toCanvas(0, 0);
        const wPx = this.workpiece.width * this.scale;
        const hPx = this.workpiece.height * this.scale;

        ctx.fillStyle = "rgba(30, 41, 59, 0.4)"; // Phôi nền tối
        ctx.fillRect(origin.x, origin.y - hPx, wPx, hPx);

        ctx.strokeStyle = "rgba(245, 158, 11, 0.4)"; // Viền phôi màu hổ phách
        ctx.lineWidth = 1.5;
        ctx.strokeRect(origin.x, origin.y - hPx, wPx, hPx);

        // 2. Vẽ ảnh mẫu mờ bên dưới
        if (this.workpiece.imgLoaded && this.workpiece.img) {
            ctx.save();
            ctx.globalAlpha = 0.25; // Làm mờ để nổi bật đường chạy laser
            ctx.drawImage(this.workpiece.img, origin.x, origin.y - hPx, wPx, hPx);
            ctx.restore();
        }

        // 3. Vẽ các đường chạy dao G-code (Faint preview)
        if (this.showToolpaths && this.toolpaths.length > 0) {
            ctx.save();
            let lastPt = this.toCanvas(0, 0);

            for (let i = 0; i < this.toolpaths.length; i++) {
                const pt = this.toolpaths[i];
                const canvasPt = this.toCanvas(pt.x, pt.y);

                if (pt.type === "G0") {
                    // Chạy không tải: nét đứt xanh lơ mờ
                    ctx.beginPath();
                    ctx.strokeStyle = "rgba(56, 189, 248, 0.15)";
                    ctx.lineWidth = 0.8;
                    ctx.setLineDash([3, 3]);
                    ctx.moveTo(lastPt.x, lastPt.y);
                    ctx.lineTo(canvasPt.x, canvasPt.y);
                    ctx.stroke();
                } else if (pt.type === "G1") {
                    // Khắc laser: nét cam mờ
                    ctx.beginPath();
                    ctx.strokeStyle = "rgba(249, 115, 22, 0.2)";
                    ctx.lineWidth = 1.0;
                    ctx.setLineDash([]);
                    ctx.moveTo(lastPt.x, lastPt.y);
                    ctx.lineTo(canvasPt.x, canvasPt.y);
                    ctx.stroke();
                }

                lastPt = canvasPt;
            }
            ctx.restore();
        }

        this.hasRenderedStaticPaths = true;
    }

    /**
     * Cập nhật vị trí đầu khắc từ máy thật (thông qua USB)
     */
    updateLaserPosition(xMm, yMm, isLaserOn = null) {
        const prevCanvasPt = this.toCanvas(this.laserPos.x, this.laserPos.y);

        this.laserPos.x = xMm;
        this.laserPos.y = yMm;
        if (isLaserOn !== null) {
            this.isLaserOn = isLaserOn;
        }

        const newCanvasPt = this.toCanvas(xMm, yMm);

        // Nếu tia laser đang bật khắc, vẽ vệt cháy lên burnCanvas
        if (this.isLaserOn && this.burnCtx) {
            this.burnCtx.beginPath();
            this.burnCtx.strokeStyle = "rgba(234, 88, 12, 0.9)"; // Màu cháy laser cam đậm
            this.burnCtx.lineWidth = 1.6;
            this.burnCtx.moveTo(prevCanvasPt.x, prevCanvasPt.y);
            this.burnCtx.lineTo(newCanvasPt.x, newCanvasPt.y);
            this.burnCtx.stroke();
        }
    }

    /**
     * Cập nhật tiến trình khắc (tô dần các đường đã hoàn thành)
     */
    setProgress(currentLineIdx, totalLines) {
        this.currentLineIdx = currentLineIdx;
        this.totalLines = totalLines || this.totalLines;

        if (this.toolpaths.length > 0 && currentLineIdx < this.toolpaths.length) {
            const pt = this.toolpaths[currentLineIdx];
            this.updateLaserPosition(pt.x, pt.y, pt.laserOn);
        }
    }

    /**
     * Xóa sạch vệt khắc mô phỏng
     */
    clearTrace() {
        if (this.burnCtx) {
            this.burnCtx.clearRect(0, 0, this.displayWidth, this.displayHeight);
        }
    }

    /**
     * Vòng lặp render chính (60fps)
     */
    startRenderLoop() {
        const render = () => {
            this.draw();
            this.animId = requestAnimationFrame(render);
        };
        this.animId = requestAnimationFrame(render);
    }

    /**
     * Vẽ khung hình hiện tại
     */
    draw() {
        if (!this.ctx || !this.displayWidth) return;
        const ctx = this.ctx;

        // 1. Xóa nền đen CNC
        ctx.fillStyle = "#090d16";
        ctx.fillRect(0, 0, this.displayWidth, this.displayHeight);

        // 2. Vẽ lưới milimet CNC
        if (this.showGrid) {
            this.drawGrid(ctx);
        }

        // 3. Vẽ lớp phôi và đường chạy tĩnh từ Offscreen Canvas
        if (this.hasRenderedStaticPaths) {
            ctx.drawImage(this.offscreenCanvas, 0, 0);
        }

        // 4. Vẽ lớp vệt cháy thực tế đã khắc
        ctx.drawImage(this.burnCanvas, 0, 0);

        // 5. Vẽ gốc tọa độ (0, 0)
        this.drawOrigin(ctx);

        // 6. Vẽ đầu khắc laser thời gian thực (Laser Crosshair)
        this.drawLaserHead(ctx);
    }

    /**
     * Vẽ lưới tọa độ CNC milimet
     */
    drawGrid(ctx) {
        ctx.save();
        const origin = this.toCanvas(0, 0);
        const maxPt = this.toCanvas(this.workpiece.width, this.workpiece.height);

        const stepMm = 10; // Bước lưới 10mm
        ctx.lineWidth = 0.5;
        ctx.strokeStyle = "rgba(51, 65, 85, 0.4)";
        ctx.fillStyle = "rgba(100, 116, 139, 0.6)";
        ctx.font = "9px 'Courier New', monospace";

        // Đường dọc trục X
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

        // Đường ngang trục Y
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

    /**
     * Vẽ ký hiệu gốc tọa độ (0, 0)
     */
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

    /**
     * Vẽ tâm ngắm đầu laser thời gian thực (+)
     */
    drawLaserHead(ctx) {
        ctx.save();
        const pt = this.toCanvas(this.laserPos.x, this.laserPos.y);

        // Hiệu ứng phát sáng khi tia laser đang bật
        if (this.isLaserOn) {
            const pulseRadius = 14 + Math.sin(Date.now() / 100) * 3;
            const gradient = ctx.createRadialGradient(pt.x, pt.y, 2, pt.x, pt.y, pulseRadius);
            gradient.addColorStop(0, "rgba(255, 68, 68, 0.9)");
            gradient.addColorStop(0.5, "rgba(255, 140, 0, 0.5)");
            gradient.addColorStop(1, "rgba(255, 0, 0, 0)");

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, pulseRadius, 0, Math.PI * 2);
            ctx.fill();
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

        // Nhãn tọa độ nhỏ bay theo đầu laser
        ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
        ctx.strokeStyle = "rgba(51, 65, 85, 0.8)";
        ctx.lineWidth = 1;
        const tagText = `(${this.laserPos.x.toFixed(1)}, ${this.laserPos.y.toFixed(1)})`;
        ctx.font = "bold 9px 'Courier New', monospace";
        const tagW = ctx.measureText(tagText).width + 8;
        ctx.fillRect(pt.x + 12, pt.y - 18, tagW, 14);
        ctx.strokeRect(pt.x + 12, pt.y - 18, tagW, 14);

        ctx.fillStyle = this.isLaserOn ? "#f97316" : "#38bdf8";
        ctx.fillText(tagText, pt.x + 16, pt.y - 7);

        ctx.restore();
    }

    /**
     * Bật/Tắt hiển thị lưới
     */
    toggleGrid() {
        this.showGrid = !this.showGrid;
        return this.showGrid;
    }

    /**
     * Bật/Tắt hiển thị đường dao G-code
     */
    toggleToolpaths() {
        this.showToolpaths = !this.showToolpaths;
        this.rebuildStaticPaths();
        return this.showToolpaths;
    }

    /**
     * Căn chỉnh phôi vừa vặn khung hình canvas
     */
    fitView() {
        this.resize();
        this.rebuildStaticPaths();
    }

    destroy() {
        if (this.animId) {
            cancelAnimationFrame(this.animId);
            this.animId = null;
        }
    }
}

// Gắn toàn cục cho window
window.LaserVisualizer = LaserVisualizer;
