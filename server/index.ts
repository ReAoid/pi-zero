import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
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
    console.warn("[启动] 已恢复配置但初始化报错:", err.message);
    console.warn("[启动] 请在设置面板重新配置供应商");
  } else {
    console.error("启动失败:", err.message);
    process.exit(1);
  }
});

// ────────────────────────────────────────────────────
//  Hono App
// ────────────────────────────────────────────────────
const app = new Hono();

// ── 健康检查 ──
app.get("/api/status", (c) => {
  return c.json({
    ok: true,
    sessionId: agent.sessionId,
    model: agent.modelInfo,
  });
});

// ── 存储配置 API ──
app.get("/api/storage/config", (c) => {
  return c.json({
    ok: true,
    config: {
      workplace: WORKPLACE_DIR,
      sessions: SESSIONS_DIR,
      knowledge: KNOWLEDGE_DIR,
      logs: LOGS_DIR,
    },
  });
});

app.post("/api/storage/config", async (c) => {
  const body = await c.req.json();
  if (!body || typeof body !== "object") {
    return c.json({ ok: false, error: "参数无效" }, 400);
  }

  const result: Record<string, string> = {};

  // 更新并持久化每个路径
  if (body.workplace !== undefined) {
    const resolved = path.resolve(body.workplace);
    fs.mkdirSync(resolved, { recursive: true });
    WORKPLACE_DIR = resolved;
    result.workplace = resolved;
    startWorkplaceWatcher();
    console.log(`[Storage] Workplace 目录已切换: ${resolved}`);
  }
  if (body.sessions !== undefined) {
    const resolved = path.resolve(body.sessions);
    fs.mkdirSync(resolved, { recursive: true });
    SESSIONS_DIR = resolved;
    result.sessions = resolved;
    console.log(`[Storage] 会话目录已切换: ${resolved}`);
  }
  if (body.knowledge !== undefined) {
    const resolved = path.resolve(body.knowledge);
    fs.mkdirSync(resolved, { recursive: true });
    KNOWLEDGE_DIR = resolved;
    result.knowledge = resolved;
    console.log(`[Storage] 知识库目录已切换: ${resolved}`);
  }
  if (body.logs !== undefined) {
    const resolved = path.resolve(body.logs);
    fs.mkdirSync(resolved, { recursive: true });
    LOGS_DIR = resolved;
    result.logs = resolved;
    console.log(`[Storage] 日志目录已切换: ${resolved}`);
  }

  // 持久化
  saveStorageConfigToFile(body);

  return c.json({ ok: true, config: result });
});

// ── 供应商测试连接 ──
app.post("/api/provider/test", async (c) => {
  const config = await c.req.json();
  if (!config || !config.provider || !config.apiKey) {
    return c.json({ ok: false, error: "参数不完整，需要 provider, apiKey" }, 400);
  }
  const result = await providerRegistry.testConnection(config);
  return c.json(result);
});

// ── 获取可用模型列表 ──
app.post("/api/provider/models", async (c) => {
  const config = await c.req.json();
  if (!config || !config.provider || !config.apiKey) {
    return c.json({ ok: false, error: "参数不完整，需要 provider, apiKey" }, 400);
  }
  const result = await providerRegistry.fetchModels(config);
  return c.json(result);
});

// ── 供应商切换 ──
app.post("/api/provider/switch", async (c) => {
  const config = await c.req.json();
  if (!config || !config.provider) {
    return c.json({ ok: false, error: "参数不完整，需要 provider" }, 400);
  }
  try {
    await agent.init(config);
    return c.json({ ok: true, model: agent.modelInfo });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ═══════════════════════════════════════════════════════
//  Workplace API: 右侧边栏文件系统
// ═══════════════════════════════════════════════════════

// ── 存储路径配置（可从客户端覆盖） ──
let WORKPLACE_DIR = path.resolve("workplace");
let SESSIONS_DIR = path.resolve("data", "sessions");
let KNOWLEDGE_DIR = path.resolve("data", "knowledge");
let LOGS_DIR = path.resolve("data", "logs");

// ── 存储配置持久化文件 ──
const STORAGE_CONFIG_PATH = path.resolve("data", "storage-config.json");

// 从文件恢复存储配置
function loadStorageConfigFromFile() {
  try {
    if (!fs.existsSync(STORAGE_CONFIG_PATH)) return false;
    const raw = fs.readFileSync(STORAGE_CONFIG_PATH, "utf-8");
    const cfg = JSON.parse(raw);
    if (cfg.workplace) WORKPLACE_DIR = path.resolve(cfg.workplace);
    if (cfg.sessions) SESSIONS_DIR = path.resolve(cfg.sessions);
    if (cfg.knowledge) KNOWLEDGE_DIR = path.resolve(cfg.knowledge);
    if (cfg.logs) LOGS_DIR = path.resolve(cfg.logs);
    console.log(`[Storage] 从文件恢复存储配置`);
    return true;
  } catch (err) {
    console.warn("[Storage] 读取存储配置失败:", (err as Error).message);
    return false;
  }
}

// 持久化存储配置到文件
function saveStorageConfigToFile(config: {
  sessions?: string;
  knowledge?: string;
  logs?: string;
  workplace?: string;
}) {
  try {
    const dir = path.dirname(STORAGE_CONFIG_PATH);
    fs.mkdirSync(dir, { recursive: true });
    const existing: Record<string, string> = {};
    if (fs.existsSync(STORAGE_CONFIG_PATH)) {
      try { Object.assign(existing, JSON.parse(fs.readFileSync(STORAGE_CONFIG_PATH, "utf-8"))); } catch { /* ok */ }
    }
    const merged = { ...existing, ...config };
    fs.writeFileSync(STORAGE_CONFIG_PATH, JSON.stringify(merged, null, 2), "utf-8");
  } catch (err) {
    console.warn("[Storage] 持久化存储配置失败:", (err as Error).message);
  }
}

// 从文件恢复配置
loadStorageConfigFromFile();

// 确保各存储目录存在
[WORKPLACE_DIR, SESSIONS_DIR, KNOWLEDGE_DIR, LOGS_DIR].forEach((dir) => {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ok */ }
});

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
    ".svg", ".csv", ".tsv", ".gradle", ".lock",
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
    { detached: true, stdio: "ignore" },
  );
  child.unref();
}

// ── 配置 workplace 路径（兼容旧调用方） ──
app.post("/api/workplace/config", async (c) => {
  const { path: newPath } = await c.req.json();
  if (!newPath) {
    return c.json({ ok: false, error: "缺少 path 参数" }, 400);
  }
  const resolved = path.resolve(newPath);
  try {
    fs.mkdirSync(resolved, { recursive: true });
    WORKPLACE_DIR = resolved;
    startWorkplaceWatcher();
    saveStorageConfigToFile({ workplace: resolved });
    console.log(`[Storage] Workplace 目录已切换: ${resolved}`);
    return c.json({ ok: true, path: resolved });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

// ── 在系统文件管理器中打开 ──
app.post("/api/workplace/open", (c) => {
  try {
    if (!fs.existsSync(WORKPLACE_DIR)) {
      fs.mkdirSync(WORKPLACE_DIR, { recursive: true });
    }
    openInFileManager(WORKPLACE_DIR);
    return c.json({ ok: true, path: WORKPLACE_DIR });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

// ── 列出目录内容 ──
app.get("/api/workplace/list", (c) => {
  const subPath = c.req.query("path") || "";
  const target = safeResolve(subPath);
  if (!target) {
    return c.json({ ok: false, error: "无效的路径" }, 400);
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
    return c.json({ ok: true, items, path: subPath || "/" });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

// ── 读取文件内容 ──
app.get("/api/workplace/read", (c) => {
  const filePath = c.req.query("path");
  if (!filePath) {
    return c.json({ ok: false, error: "缺少 path 参数" }, 400);
  }
  const target = safeResolve(filePath);
  if (!target) {
    return c.json({ ok: false, error: "无效的路径" }, 400);
  }
  try {
    if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      return c.json({ ok: false, error: "文件不存在" }, 404);
    }
    const isText = isTextFile(target);
    if (isText) {
      const content = fs.readFileSync(target, "utf-8");
      return c.json({ ok: true, content, isText: true, path: filePath });
    } else {
      // 二进制文件：以 base64 返回
      const buf = fs.readFileSync(target);
      return c.json({ ok: true, content: buf.toString("base64"), isText: false, path: filePath });
    }
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

// ── 写入/创建文件 ──
app.post("/api/workplace/write", async (c) => {
  const { path: filePath, content } = await c.req.json();
  if (!filePath || content === undefined) {
    return c.json({ ok: false, error: "缺少 path 或 content" }, 400);
  }
  const target = safeResolve(filePath);
  if (!target) {
    return c.json({ ok: false, error: "无效的路径" }, 400);
  }
  try {
    // 确保父目录存在
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf-8");
    return c.json({ ok: true, path: filePath });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

// ── 上传文件（FormData / multipart）──
app.post("/api/workplace/upload", async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"] as File | undefined;
  const filePath = body["path"] as string | undefined;

  if (!file || !filePath) {
    return c.json({ ok: false, error: "缺少 file 或 path" }, 400);
  }

  const target = safeResolve(filePath);
  if (!target) {
    return c.json({ ok: false, error: "无效的路径" }, 400);
  }

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(target, buffer);
    console.log(`[Workplace] 上传成功: ${filePath} (${file.size} bytes)`);
    return c.json({ ok: true, path: filePath });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

// ── 删除文件/目录 ──
app.post("/api/workplace/delete", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const filePath = body?.path || c.req.query("path");
  if (!filePath) {
    return c.json({ ok: false, error: "缺少 path 参数" }, 400);
  }
  const target = safeResolve(filePath);
  if (!target) {
    return c.json({ ok: false, error: "无效的路径" }, 400);
  }
  try {
    if (!fs.existsSync(target)) {
      return c.json({ ok: false, error: "路径不存在" }, 404);
    }
    const isDir = fs.statSync(target).isDirectory();
    if (isDir) {
      // Windows 上用 cmd /c rmdir 避免 fs.rmSync 对中文路径崩溃
      if (process.platform === "win32") {
        execFileSync("cmd", ["/c", "rmdir", "/s", "/q", target], { stdio: "ignore" });
      } else {
        execFileSync("rm", ["-rf", target], { stdio: "ignore" });
      }
    } else {
      fs.unlinkSync(target);
    }
    return c.json({ ok: true, path: filePath });
  } catch (err) {
    console.error("[Workplace] 删除失败:", err instanceof Error ? err.message : err);
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// ── 创建目录 ──
app.post("/api/workplace/mkdir", async (c) => {
  const { path: dirPath } = await c.req.json();
  if (!dirPath) {
    return c.json({ ok: false, error: "缺少 path" }, 400);
  }
  const target = safeResolve(dirPath);
  if (!target) {
    return c.json({ ok: false, error: "无效的路径" }, 400);
  }
  try {
    fs.mkdirSync(target, { recursive: true });
    return c.json({ ok: true, path: dirPath });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

// ── 重命名文件/目录 ──
app.post("/api/workplace/rename", async (c) => {
  const { path: oldPath, newName } = await c.req.json();
  if (!oldPath || !newName) {
    return c.json({ ok: false, error: "缺少 path 或 newName" }, 400);
  }

  const oldTarget = safeResolve(oldPath);
  if (!oldTarget) {
    return c.json({ ok: false, error: "无效的原路径" }, 400);
  }
  if (!fs.existsSync(oldTarget)) {
    return c.json({ ok: false, error: "原路径不存在" }, 404);
  }

  // 新路径 = 原父目录 + 新名称
  const parentDir = path.dirname(oldTarget);
  const newTarget = path.join(parentDir, newName);

  // 安全校验：新路径必须在 WORKPLACE_DIR 内
  if (!newTarget.startsWith(WORKPLACE_DIR)) {
    return c.json({ ok: false, error: "新路径无效" }, 400);
  }
  if (fs.existsSync(newTarget)) {
    return c.json({ ok: false, error: "目标路径已存在" }, 409);
  }

  try {
    fs.renameSync(oldTarget, newTarget);
    console.log(`[Workplace] 重命名: ${oldPath} → ${parentDir}/${newName}`);
    return c.json({ ok: true, oldPath, newPath: path.posix.join(path.dirname(oldPath), newName) });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

// ── Workplace 文件监听 ──
let workplaceWatcher: fs.FSWatcher | null = null;

function startWorkplaceWatcher() {
  if (workplaceWatcher) workplaceWatcher.close();
  try {
    workplaceWatcher = fs.watch(WORKPLACE_DIR, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      // 过滤临时文件和隐藏文件
      const name = filename.toString();
      if (name.startsWith('.') || name.endsWith('~') || name.endsWith('.swp')) return;

      const msg = JSON.stringify({
        type: "workplace_changed",
        event: eventType,
        path: name.replace(/\\/g, "/"),
      });
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(msg);
        }
      });
    });
    console.log(`  👀 Workplace 监听已启动: ${WORKPLACE_DIR}`);
  } catch (err) {
    console.warn("  ⚠️  Workplace 监听启动失败:", (err as Error).message);
  }
}

// ── 静态文件服务 ──
const CLIENT_DIR = path.resolve("client");
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

app.get("*", (c) => {
  const reqPath = c.req.path;
  // 跳过非静态文件请求（API 路由应已匹配完毕）
  if (reqPath.startsWith("/api/")) {
    return c.text("Not Found", 404);
  }

  const filePath = reqPath === "/" ? "/index.html" : reqPath;
  const fullPath = path.join(CLIENT_DIR, filePath);

  try {
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
      return c.text("Not Found", 404);
    }
    const content = fs.readFileSync(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    return c.body(content, 200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    });
  } catch {
    return c.text("Not Found", 404);
  }
});

// ────────────────────────────────────────────────────
//  HTTP + WebSocket 服务器
// ────────────────────────────────────────────────────

const nodeServer = serve({
  fetch: app.fetch,
  port: parseInt(process.env.PORT || "3000", 10),
  hostname: "0.0.0.0",
}) as unknown as http.Server;

const wss = new WebSocketServer({ server: nodeServer });

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
  fs.watch(CLIENT_DIR, { recursive: true }, (eventType, filename) => {
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

// ── 启动完成 ──
// ── 启动 Workplace 文件监听 ──
startWorkplaceWatcher();

console.log(`\n  🚀 pi-zero 聊天服务已启动`);
console.log(`  📡 http://localhost:${process.env.PORT || "3000"}`);
console.log(`  🔑 请确保设置了 API Key 环境变量\n`);
