import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import path from "node:path";
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

// ── 启动 ──
const PORT = parseInt(process.env.PORT || "3000", 10);
httpServer.listen(PORT, () => {
  console.log(`\n  🚀 pi-zero 聊天服务已启动`);
  console.log(`  📡 http://localhost:${PORT}`);
  console.log(`  🔑 请确保设置了 API Key 环境变量\n`);
});
