/* ═════════════════════════════════════════════════════
   pi-zero · 会话管理 (Session Manager)
   ═════════════════════════════════════════════════════ */

import { safeSetText, formatTime } from "./utils.js";

const STORAGE_KEY = "pi-zero-sessions";
const ACTIVE_KEY = "pi-zero-active-session";

export const sessionManager = {
  // 只有发了消息的会话才存在此数组中（展示在左侧列表）
  sessions: [],
  // 当前空白工作会话 ID（不在 sessions 中，不展示）
  pendingId: null,
  // 当前激活的会话 ID
  activeId: null,

  // ── 初始化 ──
  init() {
    this.load();
    const savedId = localStorage.getItem(ACTIVE_KEY);
    const target =
      savedId && this.sessions.find((s) => s.id === savedId)
        ? savedId
        : null;
    if (target) {
      this.switchTo(target);
    } else if (this.sessions.length > 0) {
      this.switchTo(this.sessions[0].id);
    } else {
      this._startPending();
    }
    this.render();
  },

  // ── 创建一个空白工作会话 ──
  _startPending() {
    this.pendingId =
      "pending_" +
      Date.now() +
      "_" +
      Math.random().toString(36).slice(2, 6);
    this.activeId = this.pendingId;
    localStorage.setItem(ACTIVE_KEY, this.pendingId);
    document.getElementById("messages").innerHTML = "";
  },

  // ── 加载/保存 ──
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.sessions = raw ? JSON.parse(raw) : [];
    } catch {
      this.sessions = [];
    }
  },

  save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.sessions));
  },

  // ── 创建新会话 ──
  create() {
    this._startPending();
    this.render();
    document.getElementById("input").focus();
  },

  // ── 删除会话 ──
  remove(id) {
    this.sessions = this.sessions.filter((s) => s.id !== id);
    this.save();
    if (this.activeId === id) {
      this._startPending();
    }
    this.render();
  },

  // ── 切换会话 ──
  switchTo(id) {
    const session = this.sessions.find((s) => s.id === id);
    if (!session) return;
    this.pendingId = null;
    this.activeId = id;
    localStorage.setItem(ACTIVE_KEY, id);
    this._renderMessages(session);
    this.render();
  },

  // ── 保存消息 ──
  saveMessage(role, content) {
    if (this.activeId === this.pendingId) {
      const now = Date.now();
      const session = {
        id:
          "sess_" +
          now +
          "_" +
          Math.random().toString(36).slice(2, 6),
        title:
          role === "user"
            ? content.length > 18
              ? content.slice(0, 18) + "…"
              : content
            : "新会话",
        createdAt: now,
        messages: [],
      };
      this.sessions.unshift(session);
      this.pendingId = null;
      this.activeId = session.id;
      localStorage.setItem(ACTIVE_KEY, session.id);
      this.save();
      this.render();
    }

    const session = this.sessions.find(
      (s) => s.id === this.activeId
    );
    if (!session) return;

    session.messages.push({ role, content, time: Date.now() });

    if (session.messages.length === 1 && role === "user") {
      session.title =
        content.length > 18
          ? content.slice(0, 18) + "…"
          : content;
    }

    this.save();
    this.render();
  },

  // ── 获取当前会话 ──
  getCurrent() {
    return this.sessions.find((s) => s.id === this.activeId) || null;
  },

  // ── 渲染消息 ──
  _renderMessages(session) {
    const messagesEl = document.getElementById("messages");
    messagesEl.innerHTML = "";
    if (!session || session.messages.length === 0) return;
    session.messages.forEach((msg) => {
      const div = document.createElement("div");
      div.className = `msg ${msg.role}`;
      const sender = document.createElement("div");
      sender.className = "sender";
      sender.textContent = msg.role === "user" ? "你" : "AI";
      const text = document.createElement("div");
      text.className = "text";
      text.textContent = msg.content;
      div.appendChild(sender);
      div.appendChild(text);
      messagesEl.appendChild(div);
    });
    this._scrollToBottom();
  },

  // ── 滚动到底部 ──
  _scrollToBottom() {
    requestAnimationFrame(() => {
      const el = document.getElementById("messages");
      if (el) el.scrollTop = el.scrollHeight;
    });
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
        const timeStr = formatTime(s.createdAt);
        const icon = active ? "💬" : "📄";
        return `
          <div class="session-item ${active ? "active" : ""}" data-id="${s.id}">
            <span class="session-item-icon">${icon}</span>
            <div class="session-item-info">
              <div class="session-item-title">${safeSetText(s.title)}</div>
              <div class="session-item-time">${timeStr}</div>
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
document
  .getElementById("sessionBtnNew")
  .addEventListener("click", () => {
    sessionManager.create("新会话");
  });

// ── Ctrl+N / Cmd+N 快捷键 ──
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "n") {
    e.preventDefault();
    sessionManager.create("新会话");
  }
});

// ── 启动会话管理器 ──
sessionManager.init();
