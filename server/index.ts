import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import path from "node:path";
import fs from "node:fs";
import { ChatAgent } from "./chat-agent.js";

// ── 初始化 pi Agent ──
const agent = new ChatAgent();
agent.init().catch((err: Error) => {
  console.error("启动失败:", err.message);
  process.exit(1);
});

// ── HTTP + WebSocket Server ──
const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

// 托管静态文件（client/index.html）
app.use(express.static(path.resolve("client")));

// 健康检查
app.get("/api/status", (_req, res) => {
  res.json({ ok: true, sessionId: agent.sessionId });
});

// ── WebSocket 连接管理 ──
wss.on("connection", (ws) => {
  console.log("[WS] 浏览器已连接");

  // 把 SDK 事件流式推送到这个浏览器
  const unsub = agent.subscribe((event) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  });

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "prompt" && typeof msg.text === "string") {
        console.log(`[Prompt] ${msg.text.slice(0, 80)}...`);
        await agent.prompt(msg.text);
      }
    } catch (err) {
      console.error("[WS] 消息处理错误:", err);
      ws.send(JSON.stringify({ type: "error", message: String(err) }));
    }
  });

  ws.on("close", () => {
    console.log("[WS] 浏览器已断开");
    unsub();
  });

  ws.on("error", (err) => {
    console.error("[WS] 错误:", err.message);
  });
});

// ── 热更新：监听前端文件变更 ──
const clientDir = path.resolve("client");
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

function broadcastReload() {
  // 防抖：500ms 内多次变更只触发一次刷新
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    console.log("  ♻️  前端文件已变更，通知浏览器刷新...");
    const msg = JSON.stringify({ type: "hot_reload" });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }, 500);
}

// 监听 client 目录（包括子目录）
try {
  fs.watch(clientDir, { recursive: true }, (eventType, filename) => {
    if (filename) {
      const ext = path.extname(filename).toLowerCase();
      // 只监听前端相关文件
      if ([".html", ".css", ".js", ".png", ".svg", ".jpg", ".json"].includes(ext)) {
        broadcastReload();
      }
    }
  });
  console.log("  👀 热更新已启动：监听 client/ 目录文件变更");
} catch (err) {
  console.warn("  ⚠️  文件监听启动失败（不影响运行）:", (err as Error).message);
}

// ── 启动 ──
const PORT = parseInt(process.env.PORT || "3000", 10);
httpServer.listen(PORT, () => {
  console.log(`\n  🚀 pi-zero 聊天服务已启动`);
  console.log(`  📡 http://localhost:${PORT}`);
  console.log(`  🔑 请确保设置了 API Key 环境变量\n`);
});
