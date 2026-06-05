/* ═════════════════════════════════════════════════════
   pi-zero · 工具函数
   ═════════════════════════════════════════════════════ */

/**
 * HTML 转义（用于嵌入模板字面量中的字符串）
 */
export function escapeHtml(str) {
  if (typeof str !== "string") return String(str);
  return str
    .replace(/&/g, "&amp;")
    .replace(/'/g, "\\'")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 安全设置文本内容（使用 DOM 方式防 XSS）
 */
export function safeSetText(str) {
  if (typeof str !== "string") return String(str);
  const el = document.createElement("div");
  el.textContent = str;
  return el.innerHTML;
}

/**
 * 格式化时间戳为友好的显示字符串
 */
export function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const t = pad(d.getHours()) + ":" + pad(d.getMinutes());
  if (d.toDateString() === now.toDateString()) return t;
  const yest = new Date(now - 86400000);
  if (d.toDateString() === yest.toDateString()) return "昨天 " + t;
  return d.getMonth() + 1 + "/" + d.getDate() + " " + t;
}

/**
 * DOM 选择器简写
 */
export const $ = (s) => document.querySelector(s);

/**
 * 防抖工具
 */
export function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
