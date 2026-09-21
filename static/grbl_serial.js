/**
 * GRBLController - Bộ điều khiển giao tiếp máy Laser MKS DLC32 qua Web Serial API
 * Hỗ trợ Chrome, Edge, Opera, Brave
 */
class GRBLController {
    constructor() {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.readableStreamClosed = null;
        this.writableStreamClosed = null;

        this.isConnected = false;
        this.isStreaming = false;
        this.isPaused = false;
        this.isFocusLaserOn = false;

        // Trạng thái máy đọc từ GRBL
        this.machineState = "Disconnected"; // Idle, Run, Hold, Alarm, Door, Check, Home
        this.mpos = { x: 0.0, y: 0.0, z: 0.0 };
        this.wpos = { x: 0.0, y: 0.0, z: 0.0 };
        this.feedrate = 0;
        this.spindle = 0;

        // Hàng đợi truyền G-code
        this.gcodeLines = [];
        this.currentLineIdx = 0;
        this.totalLines = 0;
        this.startTime = null;
        this.activeResolve = null; // Promise resolve khi nhận 'ok' hoặc error

        // Polling thăm dò trạng thái '?'
        this.pollTimer = null;

        // Callbacks
        this.onConnectionChange = null;
        this.onStatusUpdate = null;
        this.onProgress = null;
        this.onLog = null;
        this.onError = null;
    }

    /**
     * Kiểm tra trình duyệt có hỗ trợ Web Serial không
     */
    static isSupported() {
        return "serial" in navigator;
    }

    /**
     * Kết nối tới cổng USB
     */
    async connect(baudRate = 115200) {
        if (!GRBLController.isSupported()) {
            throw new Error("Trình duyệt không hỗ trợ Web Serial. Vui lòng mở trang web trên Google Chrome hoặc Microsoft Edge.");
        }

        try {
            // Mở hộp thoại chọn cổng USB do người dùng cấp quyền
            this.port = await navigator.serial.requestPort();
            await this.port.open({
                baudRate: parseInt(baudRate, 10),
                dataBits: 8,
                stopBits: 1,
                parity: "none",
                bufferSize: 8192,
                flowControl: "none"
            });

            this.encoder = new TextEncoder();
            this.writer = this.port.writable.getWriter();
            this.isConnected = true;
            this.log("Đã kết nối cổng USB với tốc độ " + baudRate + " baud.", "success");

            // Thiết lập luồng đọc
            this.startReading();

            // Khởi chạy vòng lặp thăm dò trạng thái '?'
            this.startStatusPolling();

            // Gửi lệnh đánh thức GRBL
            await this.sendRaw("\r\n\r\n");
            setTimeout(() => this.sendRealtime("?"), 500);

            if (this.onConnectionChange) {
                this.onConnectionChange(true, this.port.getInfo());
            }

            // Bắt sự kiện rút cáp USB bất ngờ
            navigator.serial.addEventListener("disconnect", (event) => {
                if (event.target === this.port) {
                    this.disconnect();
                }
            });

            return true;
        } catch (err) {
            this.isConnected = false;
            this.log("Lỗi kết nối cổng USB: " + err.message, "error");
            if (this.onConnectionChange) this.onConnectionChange(false, null);
            throw err;
        }
    }

    /**
     * Ngắt kết nối cổng USB
     */
    async disconnect() {
        this.stopStatusPolling();
        this.isStreaming = false;
        this.isPaused = false;
        this.isConnected = false;
        this.machineState = "Disconnected";

        try {
            if (this.reader) {
                await this.reader.cancel().catch(() => {});
                this.reader.releaseLock();
                this.reader = null;
            }
            if (this.writer) {
                try {
                    this.writer.releaseLock();
                } catch (e) {}
                this.writer = null;
            }
            if (this.port) {
                await this.port.close().catch(() => {});
                this.port = null;
            }
        } catch (e) {
            console.warn("Lỗi khi đóng cổng serial:", e);
        }

        this.log("Đã ngắt kết nối cổng USB.", "info");
        if (this.onConnectionChange) this.onConnectionChange(false, null);
        if (this.onStatusUpdate) this.onStatusUpdate(this.getStatusSummary());
    }

    /**
     * Đọc dữ liệu từ Serial liên tục
     */
    async startReading() {
        let buffer = "";
        while (this.port && this.port.readable && this.isConnected) {
            try {
                const textDecoder = new TextDecoderStream();
                this.readableStreamClosed = this.port.readable.pipeTo(textDecoder.writable);
                this.reader = textDecoder.readable.getReader();

                while (true) {
                    const { value, done } = await this.reader.read();
                    if (done) break;
                    if (value) {
                        buffer += value;
                        const lines = buffer.split(/\r\n|\n|\r/);
                        buffer = lines.pop(); // Giữ lại phần chưa đủ 1 dòng

                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (trimmed) {
                                this.handleReceivedLine(trimmed);
                            }
                        }
                    }
                }
            } catch (err) {
                if (this.isConnected) {
                    this.log("Lỗi đọc dữ liệu: " + err.message, "error");
                }
                break;
            }
        }
    }

    /**
     * Phân tích phản hồi từ bo điều khiển GRBL / MKS DLC32
     */
    handleReceivedLine(line) {
        // Phân tích dòng trạng thái <Idle|MPos:0.000,0.000,0.000|WPos:...>
        if (line.startsWith("<") && line.endsWith(">")) {
            this.parseStatusLine(line);
            return;
        }

        // Nhận phản hồi 'ok'
        if (line === "ok") {
            if (this.activeResolve) {
                const res = this.activeResolve;
                this.activeResolve = null;
                res({ success: true });
            }
            return;
        }

        // Nhận cảnh báo lỗi 'error:XX'
        if (line.startsWith("error:")) {
            this.log("⚠️ GRBL cảnh báo: " + line, "warning");
            if (this.activeResolve) {
                const res = this.activeResolve;
                this.activeResolve = null;
                res({ success: false, error: line });
            }
            return;
        }

        // Báo động 'ALARM:XX'
        if (line.startsWith("ALARM:")) {
            this.machineState = "Alarm";
            this.log("🚨 BÁO ĐỘNG MÁY: " + line + ". Nhấn nút 'Mở Khóa' ($X) để tiếp tục.", "error");
            if (this.onStatusUpdate) this.onStatusUpdate(this.getStatusSummary());
            return;
        }

        // Banner khởi động
        if (line.toLowerCase().includes("grbl")) {
            this.log("📟 " + line, "info");
            return;
        }

        // Các thông tin khác
        if (line.startsWith("[") && line.endsWith("]")) {
            this.log("ℹ️ " + line, "info");
        }
    }

    /**
     * Bóc tách thông số trạng thái từ chuỗi <State|MPos:X,Y,Z|FS:F,S|...>
     */
    parseStatusLine(raw) {
        const content = raw.slice(1, -1);
        const parts = content.split("|");
        if (parts.length > 0) {
            this.machineState = parts[0];
        }

        for (let i = 1; i < parts.length; i++) {
            const part = parts[i];
            if (part.startsWith("MPos:")) {
                const coords = part.substring(5).split(",").map(Number);
                this.mpos = { x: coords[0] || 0, y: coords[1] || 0, z: coords[2] || 0 };
            } else if (part.startsWith("WPos:")) {
                const coords = part.substring(5).split(",").map(Number);
                this.wpos = { x: coords[0] || 0, y: coords[1] || 0, z: coords[2] || 0 };
            } else if (part.startsWith("FS:")) {
                const speeds = part.substring(3).split(",").map(Number);
                this.feedrate = speeds[0] || 0;
                this.spindle = speeds[1] || 0;
            }
        }

        if (this.onStatusUpdate) {
            try {
                this.onStatusUpdate(this.getStatusSummary());
            } catch (err) {
                console.warn("Lỗi onStatusUpdate callback:", err);
            }
        }
    }

    getStatusSummary() {
        return {
            connected: this.isConnected,
            state: this.machineState,
            pos: this.wpos.x !== 0 || this.wpos.y !== 0 ? this.wpos : this.mpos,
            feedrate: this.feedrate,
            spindle: this.spindle,
            isStreaming: this.isStreaming,
            isPaused: this.isPaused
        };
    }

    /**
     * Vòng lặp thăm dò trạng thái bằng ký tự '?' mỗi 250ms
     */
    startStatusPolling() {
        this.stopStatusPolling();
        this.pollTimer = setInterval(() => {
            if (this.isConnected) {
                this.sendRealtime("?");
            }
        }, 250);
    }

    stopStatusPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /**
     * Gửi ký tự điều khiển tức thì (Real-time command: ?, !, ~, \x18)
     */
    async sendRealtime(char) {
        if (!this.isConnected || !this.writer) return;
        try {
            await this.writer.write(this.encoder.encode(char));
        } catch (err) {
            // Lỗi nhẹ có thể bỏ qua khi đang đọc ghi đồng thời
        }
    }

    /**
     * Gửi chuỗi thô kèm kết thúc dòng \n
     */
    async sendRaw(text) {
        if (!this.isConnected || !this.writer) {
            throw new Error("Chưa kết nối cổng USB.");
        }
        await this.writer.write(this.encoder.encode(text));
    }

    /**
     * Gửi 1 dòng lệnh G-code và chờ 'ok' phản hồi (Handshake an toàn)
     */
    async sendGcodeLine(line) {
        const clean = line.trim();
        if (!clean) return { success: true };

        // Tạo promise chờ tín hiệu 'ok'
        const waitOk = new Promise((resolve) => {
            this.activeResolve = resolve;
            // Timeout an toàn sau 5s nếu máy không phản hồi
            setTimeout(() => {
                if (this.activeResolve === resolve) {
                    this.activeResolve = null;
                    resolve({ success: false, timeout: true });
                }
            }, 5000);
        });

        await this.sendRaw(clean + "\n");
        return await waitOk;
    }

    /* =========================================================================
       CÁC LỆNH ĐIỀU KHIỂN THƯỜNG DÙNG (JOGGING, ZERO, FOCUS, FRAME)
       ========================================================================= */

    /**
     * Di chuyển đầu khắc theo gia số (Jogging)
     * @param {number} dx - Khoảng cách X (mm)
     * @param {number} dy - Khoảng cách Y (mm)
     * @param {number} feedrate - Tốc độ (mm/phút, mặc định 2000)
     */
    async jog(dx, dy, feedrate = 2000) {
        if (!this.isConnected) throw new Error("Chưa kết nối máy laser qua USB");
        if (this.isStreaming) throw new Error("Máy đang chạy khắc, không thể di chuyển tự do");

        // Lệnh Jogging chuẩn GRBL: $J=G91 G21 X... Y... F...
        let parts = ["$J=G91", "G21"];
        if (dx !== 0) parts.push(`X${dx.toFixed(2)}`);
        if (dy !== 0) parts.push(`Y${dy.toFixed(2)}`);
        parts.push(`F${feedrate}`);

        const cmd = parts.join(" ");
        await this.sendRaw(cmd + "\n");
        this.log(`Di chuyển Jog: dX=${dx}mm, dY=${dy}mm`, "info");
    }

    /**
     * Thiết lập vị trí hiện tại làm gốc tọa độ (0, 0)
     */
    async setZero() {
        if (!this.isConnected) throw new Error("Chưa kết nối USB");
        await this.sendGcodeLine("G92 X0 Y0");
        this.log("🎯 Đã đặt vị trí hiện tại làm gốc tọa độ phôi (X=0, Y=0).", "success");
    }

    /**
     * Di chuyển đầu khắc về gốc tọa độ (0, 0)
     */
    async goToZero() {
        if (!this.isConnected) throw new Error("Chưa kết nối USB");
        await this.sendGcodeLine("M5"); // Tắt laser trước khi chạy
        await this.sendGcodeLine("G90 G0 X0 Y0 F3000");
        this.log("🏠 Đầu laser đang di chuyển về gốc (0, 0)...", "info");
    }

    /**
     * Mở khóa báo động GRBL ($X)
     */
    async unlockAlarm() {
        if (!this.isConnected) throw new Error("Chưa kết nối USB");
        await this.sendRaw("$X\n");
        this.log("🔓 Đã gửi lệnh mở khóa máy ($X).", "success");
    }

    /**
     * Bật / Tắt tia laser định vị công suất cực yếu (0.3% - 0.5%) để căn phôi
     */
    async toggleFocusLaser(on = null) {
        if (!this.isConnected) throw new Error("Chưa kết nối USB");
        if (on === null) {
            this.isFocusLaserOn = !this.isFocusLaserOn;
        } else {
            this.isFocusLaserOn = on;
        }

        if (this.isFocusLaserOn) {
            // Chế độ laser M3 hoặc M4 công suất S3 (rất yếu, nhìn thấy chấm đỏ mà không cháy gỗ)
            await this.sendGcodeLine("G1 F100");
            await this.sendGcodeLine("M4 S4");
            this.log("💡 Đã bật tia laser định vị (công suất thấp 0.4% để ngắm phôi).", "info");
        } else {
            await this.sendGcodeLine("M5");
            this.log("💡 Đã tắt tia laser định vị.", "info");
        }

        return this.isFocusLaserOn;
    }

    /**
     * Soi khung viền chữ nhật bao quanh vùng sẽ khắc (Framing / Bounding Box)
     * Giúp người thợ nhìn thấy chính xác vị trí khắc trên phôi gỗ/mica
     * @param {number} widthMm - Chiều rộng khắc
     * @param {number} heightMm - Chiều cao khắc
     * @param {number} feedrate - Tốc độ chạy viền (mm/phút, mặc định 2500)
     */
    async frameBox(widthMm, heightMm, feedrate = 2500) {
        if (!this.isConnected) throw new Error("Chưa kết nối USB");
        if (this.isStreaming) throw new Error("Máy đang khắc, không thể soi viền");

        this.log(`📐 Đang soi viền khung sản phẩm (${widthMm} x ${heightMm} mm)...`, "info");

        // 1. Tắt laser, về gốc tương đối
        await this.sendGcodeLine("M5");
        await this.sendGcodeLine("G90"); // Tọa độ tuyệt đối
        await this.sendGcodeLine("G0 X0 Y0 F3500");

        // 2. Bật laser định vị cực yếu để nhìn thấy vết chạy
        await this.sendGcodeLine("M4 S4");

        // 3. Chạy quanh 4 cạnh hình chữ nhật
        await this.sendGcodeLine(`G1 X${widthMm.toFixed(2)} Y0 F${feedrate}`);
        await this.sendGcodeLine(`G1 X${widthMm.toFixed(2)} Y${heightMm.toFixed(2)} F${feedrate}`);
        await this.sendGcodeLine(`G1 X0 Y${heightMm.toFixed(2)} F${feedrate}`);
        await this.sendGcodeLine(`G1 X0 Y0 F${feedrate}`);

        // 4. Tắt laser và kết thúc
        await this.sendGcodeLine("M5");
        this.log("✅ Soi viền hoàn tất! Hãy kiểm tra phôi đã nằm trọn trong khung chưa.", "success");
    }

    /* =========================================================================
       BỘ TRUYỀN G-CODE (STREAMER) TRỰC TIẾP TỪ TRÌNH DUYỆT
       ========================================================================= */

    /**
     * Bắt đầu nạp và truyền luồng G-code xuống máy laser
     * @param {string} gcodeContent - Nội dung chuỗi toàn bộ file .nc
     */
    async startStreaming(gcodeContent) {
        if (!this.isConnected) throw new Error("Chưa kết nối máy qua cổng USB");
        if (this.isStreaming) throw new Error("Máy đang trong quá trình khắc");

        // Làm sạch và lọc các dòng lệnh G-code hợp lệ
        const rawLines = gcodeContent.split(/\r?\n/);
        this.gcodeLines = rawLines
            .map(l => l.trim())
            .filter(l => l.length > 0 && !l.startsWith(";") && !l.startsWith("("));

        if (this.gcodeLines.length === 0) {
            throw new Error("File G-code rỗng hoặc không có câu lệnh hợp lệ!");
        }

        this.totalLines = this.gcodeLines.length;
        this.currentLineIdx = 0;
        this.isStreaming = true;
        this.isPaused = false;
        this.startTime = Date.now();

        this.log(`🚀 BẮT ĐẦU KHẮC: Tổng cộng ${this.totalLines.toLocaleString()} dòng lệnh G-code.`, "success");

        // Giảm tần suất status polling xuống 1s khi đang streaming để tối đa băng thông truyền G-code
        this.stopStatusPolling();
        this.pollTimer = setInterval(() => {
            if (this.isConnected && !this.isPaused) {
                this.sendRealtime("?");
            }
        }, 1000);

        try {
            while (this.currentLineIdx < this.totalLines && this.isStreaming) {
                // Xử lý khi người dùng bấm Tạm dừng
                while (this.isPaused && this.isStreaming) {
                    await new Promise(r => setTimeout(r, 200));
                }
                if (!this.isStreaming) break;

                const line = this.gcodeLines[this.currentLineIdx];
                const res = await this.sendGcodeLine(line);

                if (!res.success && res.error) {
                    this.log(`⚠️ Lỗi tại dòng ${this.currentLineIdx + 1}: ${line} -> ${res.error}`, "warning");
                }

                this.currentLineIdx++;

                // Báo cáo tiến trình mỗi 20 dòng hoặc khi hoàn thành
                if (this.currentLineIdx % 20 === 0 || this.currentLineIdx === this.totalLines) {
                    this.notifyProgress();
                }
            }

            if (this.isStreaming) {
                // Đã khắc hết file an toàn
                await this.sendGcodeLine("M5");
                await this.sendGcodeLine("G0 X0 Y0");
                this.log("🎉 ĐÃ HOÀN TẤT GIA CÔNG KHẮC LASER 100%!", "success");
            }
        } catch (err) {
            this.log("❌ Quá trình truyền lệnh bị gián đoạn: " + err.message, "error");
            await this.emergencyStop();
        } finally {
            this.isStreaming = false;
            this.isPaused = false;
            this.startStatusPolling(); // Khôi phục polling 250ms khi nhàn rỗi
            this.notifyProgress();
        }
    }

    /**
     * Tạm dừng gia công (Pause)
     */
    async pause() {
        if (!this.isStreaming || this.isPaused) return;
        this.isPaused = true;
        await this.sendRealtime("!"); // Feed hold tức thời
        await this.sendRealtime("M5\n"); // Tắt tạm thời laser
        this.log("⏸️ Đã tạm dừng khắc.", "warning");
        this.notifyProgress();
    }

    /**
     * Tiếp tục gia công (Resume)
     */
    async resume() {
        if (!this.isStreaming || !this.isPaused) return;
        this.isPaused = false;
        await this.sendRealtime("~"); // Cycle start tức thời
        this.log("▶️ Đang tiếp tục khắc...", "info");
        this.notifyProgress();
    }

    /**
     * DỪNG KHẨN CẤP (EMERGENCY STOP)
     * Tắt laser ngay lập tức, hủy toàn bộ lệnh và reset máy an toàn
     */
    async emergencyStop() {
        this.isStreaming = false;
        this.isPaused = false;
        this.gcodeLines = [];
        this.currentLineIdx = 0;

        // Gửi lệnh tắt laser tức thì M5 và soft reset \x18
        await this.sendRealtime("\x18"); // Ctrl+X soft reset
        setTimeout(() => this.sendRealtime("M5\n"), 100);

        this.log("🛑 ĐÃ DỪNG KHẨN CẤP! Tia laser đã được tắt và lệnh khắc đã bị hủy.", "error");
        this.notifyProgress();
    }

    notifyProgress() {
        if (this.onProgress) {
            try {
                const percent = this.totalLines > 0 ? (this.currentLineIdx / this.totalLines) * 100 : 0;
                const elapsedMs = this.startTime ? (Date.now() - this.startTime) : 0;
                const linesPerMs = elapsedMs > 0 ? (this.currentLineIdx / elapsedMs) : 0;
                const remainingMs = linesPerMs > 0 ? ((this.totalLines - this.currentLineIdx) / linesPerMs) : 0;

                this.onProgress({
                    isStreaming: this.isStreaming,
                    isPaused: this.isPaused,
                    percent: Math.min(100, percent),
                    currentLine: this.currentLineIdx,
                    totalLines: this.totalLines,
                    elapsedSeconds: Math.floor(elapsedMs / 1000),
                    remainingSeconds: Math.floor(remainingMs / 1000)
                });
            } catch (err) {
                console.warn("Lỗi callback onProgress:", err);
            }
        }
    }

    log(message, type = "info") {
        console.log(`[GRBL ${type.toUpperCase()}]`, message);
        if (this.onLog) {
            this.onLog(message, type);
        }
    }
}

// Gắn toàn cục cho trình duyệt
window.GRBLController = GRBLController;
