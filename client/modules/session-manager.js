/* ═════════════════════════════════════════════════════
   pi-zero · 会话管理 (Session Manager)
   
   与后端 SessionStore 协同工作，将会话持久化到服务器文件系统。
   - 启动时从服务器加载会话列表
   - 消息通过 WebSocket 发送给后端，后端自动持久化
   - 支持切换、删除、重命名会话
   ═════════════════════════════════════════════════════ */

import { safeSetText, formatTime } from "./utils.js";

const ACTIVE_KEY = "pi-zero-active-session";

export const sessionManager = {
  // 会话列表（来自服务器）
  sessions: [],
  // 当前激活的会话 ID（对应服务端的 sessionId）
  activeId: null,
  // 当前是否正在从服务器加载
  loading: false,
  // 服务端 base URL
  baseUrl: "",

  // ── 初始化 ──
  init() {
    this.baseUrl = window.location.origin;
    this._loadFromServer();
  },

  // ── 从服务器加载会话列表 ──
  async _loadFromServer() {
    this.loading = true;
    try {
      const res = await fetch(`${this.baseUrl}/api/sessions`);
      const data = await res.json();
      if (data.ok) {
        this.sessions = data.sessions || [];

        // 恢复上次激活的会话
        const savedId = localStorage.getItem(ACTIVE_KEY);
        const target =
          savedId && data.current === savedId
            ? this.sessions.find((s) => s.id === savedId)
            : null;

        if (target) {
          this.activeId = target.id;
        } else if (this.sessions.length > 0) {
          this.activeId = this.sessions[0].id;
        } else {
          this.activeId = data.current; // 服务端当前 sessionId（可能是新的空会话）
        }

        // 保存到 localStorage 做快速恢复
        if (this.activeId) {
          localStorage.setItem(ACTIVE_KEY, this.activeId);
        }
      }
    } catch (err) {
      console.warn("[SessionManager] 从服务器加载会话失败:", err);
      // 降级：用 localStorage 的数据
      this._loadFromLocalStorage();
    } finally {
      this.loading = false;
      this.render();
    }
  },

  // ── 降级：从 localStorage 加载 ──
  _loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem("pi-zero-sessions");
      this.sessions = raw ? JSON.parse(raw) : [];
    } catch {
      this.sessions = [];
    }
  },

  // ── 创建新会话（通过服务器） ──
  async create() {
    try {
      const res = await fetch(`${this.baseUrl}/api/sessions/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.ok) {
        this.activeId = data.sessionId;
        localStorage.setItem(ACTIVE_KEY, data.sessionId);
        // 清空消息区域
        document.getElementById("messages").innerHTML = "";
        // 刷新会话列表
        await this._loadFromServer();
      }
    } catch (err) {
      console.error("[SessionManager] 创建会话失败:", err);
    }
    document.getElementById("input")?.focus();
  },

  // ── 删除会话 ──
  async remove(id) {
    const session = this.sessions.find((s) => s.id === id);
    if (!session) return;

    try {
      const res = await fetch(`${this.baseUrl}/api/sessions/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: session.filePath }),
      });
      const data = await res.json();
      if (data.ok) {
        this.sessions = this.sessions.filter((s) => s.id !== id);
        if (this.activeId === id) {
          this.activeId = null;
          // 重新加载会话列表
          await this._loadFromServer();
          document.getElementById("messages").innerHTML =
            '<div class="empty-state">选择或创建一个新会话</div>';
        } else {
          this.render();
        }
      }
    } catch (err) {
      console.error("[SessionManager] 删除会话失败:", err);
    }
  },

  // ── 切换会话 ──
  async switchTo(id) {
    const session = this.sessions.find((s) => s.id === id);
    if (!session) return;

    // 通知服务器切换到指定会话
    try {
      const res = await fetch(`${this.baseUrl}/api/sessions/switch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: session.filePath }),
      });
      const data = await res.json();
      if (data.ok) {
        this.activeId = id;
        localStorage.setItem(ACTIVE_KEY, id);
        // 清空消息区域（消息会通过 WebSocket 重新加载？这里需要后端支持）
        document.getElementById("messages").innerHTML =
          '<div class="msg system">已切换到会话: ' + safeSetText(session.title) + "</div>";
        this.render();

        // 触发一个自定义事件，让 chat.js 知道会话已切换
        window.dispatchEvent(new CustomEvent("session-switched", {
          detail: { sessionId: id, filePath: session.filePath },
        }));
      }
    } catch (err) {
      console.error("[SessionManager] 切换会话失败:", err);
    }
  },

  // ── 重命名会话 ──
  async rename(id, newName) {
    const session = this.sessions.find((s) => s.id === id);
    if (!session || !newName) return;

    try {
      const res = await fetch(`${this.baseUrl}/api/sessions/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: session.filePath, name: newName }),
      });
      const data = await res.json();
      if (data.ok) {
        session.title = newName;
        this.render();
      }
    } catch (err) {
      console.error("[SessionManager] 重命名会话失败:", err);
    }
  },

  // ── 保存消息（由 chat.js 调用） ──
  saveMessage(role, content) {
    // 消息由服务器端的 pi SessionManager 自动持久化，
    // 这里只需要刷新会话列表元数据即可。
    // 更新当前会话的元信息
    const current = this.sessions.find((s) => s.id === this.activeId);
    if (current) {
      current.messageCount += 1;
      if (current.messageCount === 1 && role === "user") {
        current.title =
          content.length > 24 ? content.slice(0, 24) + "…" : content;
      }
      current.modifiedAt = Date.now();
      // 在列表中把当前会话移到最前面
      this.sessions.sort((a, b) => b.modifiedAt - a.modifiedAt);
      this.render();
    } else {
      // 当前会话可能还未同步到本地列表，从服务器刷新
      this._loadFromServer();
    }
  },

  // ── 获取当前会话 ──
  getCurrent() {
    return this.sessions.find((s) => s.id === this.activeId) || null;
  },

  // ── 渲染左侧会话列表 ──
  render() {
    const listEl = document.getElementById("sessionList");
    const countEl = document.getElementById("sessionCount");
    if (!listEl) return;

    if (this.sessions.length === 0) {
      listEl.innerHTML =
        '<div style="padding:1rem;text-align:center;color:var(--color-text-dim);font-size:var(--font-size-xs);">暂无会话</div>';
      if (countEl) countEl.textContent = "共 0 个会话";
      return;
    }

    listEl.innerHTML = this.sessions
      .map((s) => {
        const active = s.id === this.activeId;
        const timeStr = formatTime(s.createdAt || s.modifiedAt);
        const icon = active ? "💬" : "📄";
        return `
          <div class="session-item ${active ? "active" : ""}" data-id="${s.id}">
            <span class="session-item-icon">${icon}</span>
            <div class="session-item-info">
              <div class="session-item-title">${safeSetText(s.title)}</div>
              <div class="session-item-time">${timeStr}</div>
              <div class="session-item-count">${s.messageCount || 0} 条消息</div>
            </div>
            <button class="session-item-delete" title="删除">✕</button>
          </div>
        `;
      })
      .join("");

    if (countEl)
      countEl.textContent = `共 ${this.sessions.length} 个会话`;

    listEl.querySelectorAll(".session-item").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest(".session-item-delete")) return;
        const sid = el.dataset.id;
        if (sid && sid !== this.activeId) {
          this.switchTo(sid);
        }
      });
    });

    listEl.querySelectorAll(".session-item-delete").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const parent = btn.closest(".session-item");
        if (parent) this.remove(parent.dataset.id);
      });
    });
  },
};

// ── 绑定"新会话"按钮 ──
const newBtn = document.getElementById("sessionBtnNew");
if (newBtn) {
  newBtn.addEventListener("click", () => {
    sessionManager.create();
  });
}

// ── Ctrl+N / Cmd+N 快捷键 ──
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "n") {
    e.preventDefault();
    sessionManager.create();
  }
});

// ── 启动会话管理器 ──
sessionManager.init();
