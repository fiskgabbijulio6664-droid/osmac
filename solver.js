const { BrowserWindow, session } = require("electron");

const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
const MAX_USES = 3;               // 3 lần rồi tắt window, tạo mới
const WINDOW_COUNT = 3;          // số lượng window thay thế (luân phiên)
const TARGET_URL = "https://labs.google/fx/vi/tools/flow";
const PARTITION_PREFIX = "kinx-solver";

// ============================================================
// RecaptchaSolver — 1 window tại 1 thời điểm
// Luồng 1 → W1 → solve → reload nền
// Luồng 2 → W1 → solve → reload nền
// Luồng 3 → W1 → solve → HẾT → tắt + xóa → tạo W2 mới
// Luồng 4 → W2 → solve → reload nền
// ...
// ============================================================
class RecaptchaSolver {
  constructor() {
    this.windowIndex = 0;         // index của window hiện tại
    this.window = null;
    this.currentSession = null;
    this.solveCount = 0;          // số lần solve trên window hiện tại
    this.mutex = Promise.resolve(); // global queue — 1 luồng tại 1 thời điểm
    this._shuttingDown = false;   // flag ngăn tạo window mới khi đang tắt app
    console.log(`[Solver] 🏗️ Khởi tạo — ${MAX_USES} lần/window, ${WINDOW_COUNT} window luân phiên`);
  }

  get partitionName() {
    return `persist:${PARTITION_PREFIX}-${this.windowIndex + 1}`;
  }

  get alive() {
    return this.window && !this.window.isDestroyed();
  }

  // ── Xóa partition ──
  async clearPartition(idx) {
    const name = `persist:${PARTITION_PREFIX}-${idx + 1}`;
    try {
      const ses = session.fromPartition(name);
      await ses.clearStorageData({
        storages: ["appcache", "cookies", "filesystem", "indexdb",
          "localstorage", "shadercache", "websql", "serviceworkers", "cachestorage"],
      });
      await ses.clearCache();
      ses.clearHostResolverCache();
    } catch (e) { }
  }

  // ── Tạo window mới + load URL ──
  async spawn() {
    // Đang tắt app → KHÔNG tạo window mới
    if (this._shuttingDown) return;
    // Tắt window cũ nếu còn
    if (this.alive) {
      this.window.destroy();
      this.window = null;
    }

    this.currentSession = session.fromPartition(this.partitionName);
    console.log(`  [Solver] 🪟 Tạo window #${this.windowIndex + 1} — ${this.partitionName}`);

    this.window = new BrowserWindow({
      width: 400 + Math.floor(Math.random() * 50),
      height: 700 + Math.floor(Math.random() * 50),
      show: true,
      x: -1500 + Math.floor(Math.random() * 200),
      y: -1500 + Math.floor(Math.random() * 200),
      frame: false, skipTaskbar: true, focusable: false,
      webPreferences: {
        nodeIntegration: false, contextIsolation: false,
        session: this.currentSession, webSecurity: false,
        backgroundThrottling: false, devTools: false,
      },
    });

    // Bỏ CSP
    this.window.webContents.session.webRequest.onHeadersReceived((d, cb) => {
      const h = Object.assign({}, d.responseHeaders);
      delete h['content-security-policy'];
      delete h['x-frame-options'];
      cb({ responseHeaders: h, cancel: false });
    });

    this.window.webContents.setUserAgent(DEFAULT_UA);
    this.window.webContents.setAudioMuted(true);

    // Đợi load xong
    await new Promise((resolve) => {
      this.window.webContents.once('did-finish-load', () => resolve());
      this.window.loadURL(TARGET_URL);
    });
    await new Promise(r => setTimeout(r, 3000));

    this.solveCount = 0;
    console.log(`  [Solver] 🌐 Window #${this.windowIndex + 1} ready`);
  }

  // ── Tắt window + xóa partition (dùng cho chuyển window bình thường) ──
  shutdown() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
      this.window = null;
    }
    // Xóa partition fire-and-forget
    this.clearPartition(this.windowIndex).catch(() => {});
    this.currentSession = null;
    this.solveCount = 0;
    console.log(`  [Solver] 🛑 Window #${this.windowIndex + 1} destroyed`);
  }

  // ── Chuyển sang window tiếp theo ──
  nextWindow() {
    this.shutdown();
    this.windowIndex = (this.windowIndex + 1) % WINDOW_COUNT;
  }

  // ── Giả lập click ──
  async simulateClick() {
    if (!this.alive) return;
    const c = this.window.webContents;
    try {
      const move = async (tx, ty) => {
        let steps = 20 + Math.floor(Math.random() * 15);
        for (let i = 0; i <= steps; i++) {
          let p = i / steps;
          let t = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          c.sendInputEvent({
            type: 'mouseMove',
            x: Math.floor(tx * t) + (Math.random() * 3 - 1.5),
            y: Math.floor(ty * t) + (Math.random() * 3 - 1.5)
          });
          await new Promise(r => setTimeout(r, 8 + Math.random() * 12));
        }
      };
      c.sendInputEvent({ type: 'mouseEnter', x: 5 + Math.floor(Math.random() * 100), y: 5 + Math.floor(Math.random() * 100) });
      const hx = 200 + Math.random() * 40, hy = 150 + Math.random() * 40;
      await move(hx, hy);
      await new Promise(r => setTimeout(r, 150 + Math.random() * 200));
      for (let j = 0; j < 3; j++) {
        c.sendInputEvent({ type: 'mouseMove', x: hx + (Math.random() * 4 - 2), y: hy + (Math.random() * 4 - 2) });
        await new Promise(r => setTimeout(r, 50 + Math.random() * 50));
      }
      c.sendInputEvent({ type: 'mouseDown', x: hx, y: hy, button: 'left', clickCount: 1 });
      await new Promise(r => setTimeout(r, 70 + Math.random() * 100));
      c.sendInputEvent({ type: 'mouseUp', x: hx, y: hy, button: 'left', clickCount: 1 });
    } catch (e) { }
  }

  // ── Lấy token (1 request tại 1 thời điểm qua global queue) ──
  async getRecaptchaToken(_, websiteKey, pageAction) {
    // Global queue — xếp hàng
    const prev = this.mutex;
    let resolve;
    this.mutex = new Promise(r => { resolve = r; });
    await prev;

    try {
      // Timeout 90s
      const result = await Promise.race([
        this._doSolve(websiteKey, pageAction),
        new Promise((_, rej) => setTimeout(() => rej(new Error("Timeout 90s")), 90000)),
      ]);
      return result;
    } catch (e) {
      console.error(`[Solver] ❌ ${e.message}`);
      // Lỗi → chuyển window tiếp theo
      this.nextWindow();
      return null;
    } finally {
      resolve();   // mở khóa cho luồng tiếp theo
    }
  }

  // ── Solve thực sự (gọi trong mutex) ──
  async _doSolve(websiteKey, pageAction) {
    // Hết 3 lần → tắt window cũ, tạo window mới
    if (this.solveCount >= MAX_USES || !this.alive) {
      this.nextWindow();
      await this.spawn();
    }

    // Click giả lập
    await this.simulateClick();
    await new Promise(r => setTimeout(r, 1000));

    // Fingerprint ngẫu nhiên
    const hc = [2, 4, 6, 8, 12, 16][Math.floor(Math.random() * 6)];
    const dm = [4, 8, 16][Math.floor(Math.random() * 3)];

    // Gọi grecaptcha trực tiếp (không cache)
    const token = await this.window.webContents.executeJavaScript(`
      (async function() {
        try {
          const td = (o, p, v) => { try { Object.defineProperty(o, p, { get: () => v, configurable: true }); } catch(e) {} };
          td(navigator, 'webdriver', undefined);
          td(navigator, 'hardwareConcurrency', ${hc});
          td(navigator, 'deviceMemory', ${dm});
          if (!window.grecaptcha || !window.grecaptcha.enterprise || !window.grecaptcha.enterprise.execute)
            return 'ERROR: grecaptcha not available';
          const t = await window.grecaptcha.enterprise.execute('${websiteKey}', { action: '${pageAction}' });
          return t || 'ERROR: empty';
        } catch (e) { return 'ERROR: ' + (e.message || String(e)); }
      })();
    `, true);

    if (!token || typeof token !== 'string' || token.startsWith('ERROR:')) {
      throw new Error('Token lỗi: ' + token);
    }

    this.solveCount++;
    const remaining = MAX_USES - this.solveCount;
    console.log(`  [Solver] ✅ Token OK (${token.length} chars) | ${this.solveCount}/${MAX_USES} | Window #${this.windowIndex + 1} còn ${remaining} lần`);

    // Reload nền ngay nếu còn slot (chuẩn bị cho luồng tiếp)
    if (this.solveCount < MAX_USES) {
      (async () => {
        try {
          await new Promise((r) => {
            this.window.webContents.once('did-finish-load', () => r());
            this.window.webContents.reload();
          });
          await new Promise(r => setTimeout(r, 3000));
          console.log(`  [Solver] 🔄 Window #${this.windowIndex + 1} reloaded — sẵn sàng cho luồng tiếp`);
        } catch (e) { }
      })();
    } else {
      console.log(`  [Solver] ⏳ Hết ${MAX_USES} lần trên Window #${this.windowIndex + 1} — đang tắt + xóa + tạo window mới...`);
      // Tắt window cũ + xóa partition + tạo window mới NGAY trong nền
      (async () => {
        try {
          this.nextWindow();     // shutdown() + chuyển index
          await this.spawn();    // tạo window mới + load URL
          console.log(`  [Solver] 🪟 Window mới #${this.windowIndex + 1} sẵn sàng cho luồng tiếp`);
        } catch(e) {
          console.error(`  [Solver] ❌ Lỗi tạo window mới: ${e.message}`);
        }
      })();
    }

    return {
      token,
      userAgent: DEFAULT_UA,
      partition: this.partitionName,
      windowIndex: this.windowIndex + 1,
      solveCount: this.solveCount,
      remainingUses: remaining,
    };
  }

  // ── Shutdown toàn bộ ──
  async shutdownAll() {
    this._shuttingDown = true;   // CHẶN mọi spawn đang chờ
    this.shutdown();
    // Destroy mọi BrowserWindow còn sống
    try {
      const { BrowserWindow: BW } = require("electron");
      BW.getAllWindows().forEach(w => { try { w.destroy(); } catch(e) {} });
    } catch(e) {}
    for (let i = 0; i < WINDOW_COUNT; i++) {
      this.clearPartition(i).catch(() => {});
    }
  }

  // ── Trạng thái ──
  getStatus() {
    return {
      windowIndex: this.windowIndex + 1,
      partition: this.partitionName,
      alive: this.alive,
      solveCount: this.solveCount,
      remainingUses: Math.max(0, MAX_USES - this.solveCount),
    };
  }
}

module.exports = RecaptchaSolver;
