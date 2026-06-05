/* ═════════════════════════════════════════════════════
   pi-zero · WebSocket 连接 & 事件分发
   ═════════════════════════════════════════════════════ */

import { $ } from "./utils.js";

const statusDot = $("#status-dot");
const protocol = location.protocol === "https:" ? "wss:" : "ws:";
const ws = new WebSocket(`${protocol}//${location.host}`);

ws.onopen = () => {
  statusDot.className = "connected";
  console.log("[WS] 已连接");
};

ws.onclose = () => {
  statusDot.className = "";
};

ws.onmessage = (e) => {
  try {
    const event = JSON.parse(e.data);
    // 以 CustomEvent 形式分发给各模块
    window.dispatchEvent(
      new CustomEvent("ws:" + event.type, { detail: event })
    );
  } catch (err) {
    console.error("解析 WebSocket 事件失败:", err);
  }
};

/**
 * 通过 WebSocket 发送消息
 */
export function send(data) {
  ws.send(JSON.stringify(data));
}
