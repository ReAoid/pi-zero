import express from "express";
import { createServer } from "node:http";
import { spawn, execSync, execFileSync } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";
import path from "node:path";
import fs from "node:fs";
import { ChatAgent } from "./chat-agent.js";
import { providerRegistry } from "./provider-registry.js";
import { injectPosixPath } from "./posix-env.js";

// ═══════════════════════════════════════════════════════
// 在 pi SDK 初始化前，注入 POSIX 命令环境到 PATH
// ── 使 bash 工具能找到 ls、cat、sed、grep 等命令 ──
injectPosixPath();
// ═══════════════════════════════════════════════════════

// ── 初始化 pi Agent ──
const agent = new ChatAgent();

// 尝试从文件恢复持久化的供应商配置
const configRestored = providerRegistry.loadFromFile();

agent.init().catch((err: Error) => {
  if (configRestored) {
    // 如果从文件恢复了配置但是 init 失败，可能是 API Key 过期了，不阻止启动
    console.warn("[启动] 已恢复配置但初始化报错:", err.message);
    console.warn("[启动] 请在设置面板重新配置供应商");
  } else {
    console.error("启动失败:", err.message);
    process.exit(1);
  }
});

// ── HTTP + WebSocket Server ──
const app = express();
app.use(express.json()); // 解析 JSON body
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

// 托管静态文件（client/index.html）
app.use(express.static(path.resolve("client")));

// 健康检查
app.get("/api/status", (_req, res) => {
  res.json({
    ok: true,
    sessionId: agent.sessionId,
    model: agent.modelInfo,
  });
});

// ── 供应商测试连接 ──
app.post("/api/provider/test", async (req, res) => {
  const config = req.body;
  if (!config || !config.provider || !config.apiKey) {
    res.status(400).json({ ok: false, error: "参数不完整，需要 provider, apiKey" });
    return;
  }
  const result = await providerRegistry.testConnection(config);
  res.json(result);
});

// ── 获取可用模型列表 ──
app.post("/api/provider/models", async (req, res) => {
  const config = req.body;
  if (!config || !config.provider || !config.apiKey) {
    res.status(400).json({ ok: false, error: "参数不完整，需要 provider, apiKey" });
    return;
  }
  const result = await providerRegistry.fetchModels(config);
  res.json(result);
});

// ── 供应商切换 ──
// ═══════════════════════════════════════════════════════
//  Workplace API: 右侧边栏文件系统
// ═══════════════════════════════════════════════════════

let WORKPLACE_DIR = path.resolve("workplace");

// 确保 workplace 目录存在
try {
  fs.mkdirSync(WORKPLACE_DIR, { recursive: true });
} catch { /* ok */ }

// 安全校验：防止路径穿越
function safeResolve(relativePath: string): string | null {
  const resolved = path.resolve(WORKPLACE_DIR, relativePath);
  if (!resolved.startsWith(WORKPLACE_DIR)) return null;
  return resolved;
}

/** 判断文件是否为文本（根据扩展名 + 前 512 字节检测） */
function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const textExts = new Set([
    ".txt", ".md", ".json", ".xml", ".html", ".css", ".js", ".ts",
    ".jsx", ".tsx", ".py", ".java", ".c", ".cpp", ".h", ".hpp",
    ".rs", ".go", ".rb", ".php", ".yaml", ".yml", ".toml", ".ini",
    ".cfg", ".conf", ".log", ".sh", ".bat", ".ps1", ".env",
    ".sql", ".r", ".swift", ".kt", ".scala", ".vue", ".svelte",
    ".svg", ".csv", ".tsv", ".gradle", ".lock"
  ]);
  if (textExts.has(ext)) return true;
  // 无扩展名或未知扩展名：检查前 512 字节是否含 null
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(512);
    const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
    fs.closeSync(fd);
    return !buf.subarray(0, bytesRead).includes(0);
  } catch {
    return false;
  }
}

/** 人性化文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/** 打开系统文件管理器（跨平台） */
function openInFileManager(dirPath: string): void {
  const platform = process.platform;
  const absPath = path.resolve(dirPath);
  const child = spawn(
    platform === "win32" ? "explorer" : platform === "darwin" ? "open" : "xdg-open",
    [absPath],
    { detached: true, stdio: "ignore" }
  );
  child.unref();
}

// ── 配置 workplace 路径 ──
app.post("/api/workplace/config", (req, res) => {
  const { path: newPath } = req.body;
  if (!newPath) {
    res.status(400).json({ ok: false, error: "缺少 path 参数" });
    return;
  }
  const resolved = path.resolve(newPath);
  try {
    fs.mkdirSync(resolved, { recursive: true });
    WORKPLACE_DIR = resolved;
    console.log(`[Workplace] 目录已切换: ${resolved}`);
    res.json({ ok: true, path: resolved });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// ── 在系统文件管理器中打开 ──
app.post("/api/workplace/open", (_req, res) => {
  try {
    if (!fs.existsSync(WORKPLACE_DIR)) {
      fs.mkdirSync(WORKPLACE_DIR, { recursive: true });
    }
    openInFileManager(WORKPLACE_DIR);
    res.json({ ok: true, path: WORKPLACE_DIR });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// ── 列出目录内容 ──
app.get("/api/workplace/list", (req, res) => {
  const subPath = (req.query.path as string) || "";
  const target = safeResolve(subPath);
  if (!target) {
    res.status(400).json({ ok: false, error: "无效的路径" });
    return;
  }
  try {
    const entries = fs.readdirSync(target, { withFileTypes: true });
    const items = entries
      .filter((entry) => !entry.name.startsWith(".")) // 隐藏文件
      .map((entry) => {
        const fullPath = path.join(target, entry.name);
        const relative = subPath ? path.join(subPath, entry.name) : entry.name;
        let stat: fs.Stats;
        try {
          stat = fs.statSync(fullPath);
        } catch {
          stat = { size: 0, mtimeMs: 0, isDirectory: () => entry.isDirectory() } as fs.Stats;
        }
        return {
          name: entry.name,
          path: relative.replace(/\\/g, "/"),
          isDirectory: entry.isDirectory(),
          size: entry.isDirectory() ? 0 : stat.size,
          sizeFormatted: entry.isDirectory() ? "" : formatSize(stat.size),
          mtime: stat.mtimeMs,
          isText: entry.isDirectory() ? false : isTextFile(fullPath),
        };
      })
      .sort((a, b) => {
        // 目录在前，按名称排序
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    res.json({ ok: true, items, path: subPath || "/" });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// ── 读取文件内容 ──
app.get("/api/workplace/read", (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) {
    res.status(400).json({ ok: false, error: "缺少 path 参数" });
    return;
  }
  const target = safeResolve(filePath);
  if (!target) {
    res.status(400).json({ ok: false, error: "无效的路径" });
    return;
  }
  try {
    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      res.status(404).json({ ok: false, error: "文件不存在" });
      return;
    }
    const isText = isTextFile(target);
    if (isText) {
      const content = fs.readFileSync(target, "utf-8");
      res.json({ ok: true, content, isText: true, path: filePath });
    } else {
      // 二进制文件：以 base64 返回
      const buf = fs.readFileSync(target);
      res.json({ ok: true, content: buf.toString("base64"), isText: false, path: filePath });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// ── 写入/创建文件 ──
app.post("/api/workplace/write", (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath || content === undefined) {
    res.status(400).json({ ok: false, error: "缺少 path 或 content" });
    return;
  }
  const target = safeResolve(filePath);
  if (!target) {
    res.status(400).json({ ok: false, error: "无效的路径" });
    return;
  }
  try {
    // 确保父目录存在
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf-8");
    res.json({ ok: true, path: filePath });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// ── 上传文件（multipart via base64 JSON）──
app.post("/api/workplace/upload", (req, res) => {
  const { path: filePath, content, encoding } = req.body;
  if (!filePath || content === undefined) {
    res.status(400).json({ ok: false, error: "缺少 path 或 content" });
    return;
  }
  const target = safeResolve(filePath);
  if (!target) {
    res.status(400).json({ ok: false, error: "无效的路径" });
    return;
  }
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (encoding === "base64") {
      fs.writeFileSync(target, Buffer.from(content, "base64"));
    } else {
      fs.writeFileSync(target, content, "utf-8");
    }
    res.json({ ok: true, path: filePath });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// ── 删除文件/目录 ──
app.post("/api/workplace/delete", (req, res) => {
  const filePath = req.body?.path || (req.query.path as string);
  if (!filePath) {
    res.status(400).json({ ok: false, error: "缺少 path 参数" });
    return;
  }
  const target = safeResolve(filePath);
  if (!target) {
    res.status(400).json({ ok: false, error: "无效的路径" });
    return;
  }
  try {
    if (!fs.existsSync(target)) {
      res.status(404).json({ ok: false, error: "路径不存在" });
      return;
    }
    const isDir = fs.statSync(target).isDirectory();
    if (isDir) {
      // Windows 上用 cmd /c rmdir 避免 fs.rmSync 对中文路径崩溃
      // 拆分参数传给 execFileSync 以绕过 cmd.exe 编码问题
      if (process.platform === "win32") {
        execFileSync("cmd", ["/c", "rmdir", "/s", "/q", target], { stdio: "ignore" });
      } else {
        execFileSync("rm", ["-rf", target], { stdio: "ignore" });
      }
    } else {
      fs.unlinkSync(target);
    }
    res.json({ ok: true, path: filePath });
  } catch (err) {
    console.error("[Workplace] 删除失败:", err instanceof Error ? err.message : err);
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ── 创建目录 ──
app.post("/api/workplace/mkdir", (req, res) => {
  const { path: dirPath } = req.body;
  if (!dirPath) {
    res.status(400).json({ ok: false, error: "缺少 path" });
    return;
  }
  const target = safeResolve(dirPath);
  if (!target) {
    res.status(400).json({ ok: false, error: "无效的路径" });
    return;
  }
  try {
    fs.mkdirSync(target, { recursive: true });
    res.json({ ok: true, path: dirPath });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// ── 供应商切换 ──
app.post("/api/provider/switch", async (req, res) => {
  const config = req.body;
  if (!config || !config.provider) {
    res.status(400).json({ ok: false, error: "参数不完整，需要 provider" });
    return;
  }
  try {
    await agent.init(config);
    res.json({ ok: true, model: agent.modelInfo });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
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
