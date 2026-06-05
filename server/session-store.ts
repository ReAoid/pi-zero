/* ═════════════════════════════════════════════════════
   pi-zero · 会话持久化存储 (Session Store)
   
   基于 pi SDK 的 SessionManager 实现文件级持久化。
   - 会话自动存储为 JSONL 文件到 sessionsDir
   - 支持创建、切换、删除、重命名、列表、导出
   - 重启后自动恢复最近会话
   ═════════════════════════════════════════════════════ */

import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import fs from "node:fs";

// ── 会话元数据（扩展 SessionInfo，添加自定义字段） ──
export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;       // unix ms
  modifiedAt: number;      // unix ms
  messageCount: number;
  filePath: string;        // .jsonl 文件路径
  firstMessage: string;
  cwd: string;
}

export interface SessionListResult {
  ok: true;
  sessions: SessionMeta[];
  current: string | null;  // 当前活跃 sessionId
}

// ── 会话配置（持久化到文件） ──
interface SessionStoreConfig {
  recentSessionPath?: string;   // 最近使用的会话文件路径
  activeSessionId?: string;     // 当前 sessionId
}

// ═══════════════════════════════════════════════════════
//  SessionStore
// ═══════════════════════════════════════════════════════
export class SessionStore {
  private sessionsDir: string;
  private configPath: string;
  private config: SessionStoreConfig = {};
  private _currentManager: SessionManager | null = null;
  private _cwd: string;

  constructor(sessionsDir: string, cwd?: string) {
    this.sessionsDir = sessionsDir;
    this._cwd = cwd || process.cwd();
    this.configPath = path.join(sessionsDir, "session-store.json");

    // 确保目录存在
    fs.mkdirSync(sessionsDir, { recursive: true });

    // 恢复配置
    this.loadConfig();
  }

  /** 获取当前 SessionManager（用于挂接到 ChatAgent） */
  get currentManager(): SessionManager | null {
    return this._currentManager;
  }

  /** 获取当前 sessionId */
  get currentSessionId(): string | null {
    return this._currentManager?.getSessionId() ?? null;
  }

  /** 获取会话目录 */
  get dir(): string {
    return this.sessionsDir;
  }

  // ──────────────────────────────────────────────
  //  配置持久化
  // ──────────────────────────────────────────────

  private loadConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        this.config = JSON.parse(fs.readFileSync(this.configPath, "utf-8"));
      }
    } catch (err) {
      console.warn("[SessionStore] 读取配置失败:", (err as Error).message);
      this.config = {};
    }
  }

  private saveConfig(): void {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), "utf-8");
    } catch (err) {
      console.warn("[SessionStore] 保存配置失败:", (err as Error).message);
    }
  }

  // ──────────────────────────────────────────────
  //  创建 / 恢复 SessionManager
  // ──────────────────────────────────────────────

  /**
   * 创建新的持久化 SessionManager。
   * 如果有最近会话且文件存在，则恢复；否则创建全新会话。
   */
  createManager(): SessionManager {
    const recentPath = this.config.recentSessionPath;

    // 尝试恢复最近会话
    if (recentPath && fs.existsSync(recentPath)) {
      try {
        console.log(`[SessionStore] 恢复最近会话: ${path.basename(recentPath)}`);
        this._currentManager = SessionManager.open(recentPath, this.sessionsDir, this._cwd);
        this.config.activeSessionId = this._currentManager.getSessionId();
        this.saveConfig();
        return this._currentManager;
      } catch (err) {
        console.warn("[SessionStore] 恢复最近会话失败，创建新会话:", (err as Error).message);
      }
    }

    // 查找目录中已有的会话文件
    const existing = this.listSessionFiles();
    if (existing.length > 0) {
      // 按修改时间取最新的
      const latest = existing.sort((a, b) => b.mtime - a.mtime)[0];
      try {
        console.log(`[SessionStore] 打开已有会话: ${path.basename(latest.path)}`);
        this._currentManager = SessionManager.open(latest.path, this.sessionsDir, this._cwd);
        this.config.recentSessionPath = latest.path;
        this.config.activeSessionId = this._currentManager.getSessionId();
        this.saveConfig();
        return this._currentManager;
      } catch (err) {
        console.warn("[SessionStore] 打开会话失败，创建新会话:", (err as Error).message);
      }
    }

    // 创建全新会话
    return this.createNewManager();
  }

  /**
   * 创建一个全新的 SessionManager（新会话）
   */
  createNewManager(): SessionManager {
    console.log("[SessionStore] 创建新会话");
    this._currentManager = SessionManager.create(this._cwd, this.sessionsDir);
    this.config.recentSessionPath = this._currentManager.getSessionFile();
    this.config.activeSessionId = this._currentManager.getSessionId();
    this.saveConfig();
    return this._currentManager;
  }

  /**
   * 切换到指定的会话文件
   */
  switchTo(sessionFilePath: string): SessionManager {
    if (!fs.existsSync(sessionFilePath)) {
      throw new Error(`会话文件不存在: ${sessionFilePath}`);
    }
    console.log(`[SessionStore] 切换到会话: ${path.basename(sessionFilePath)}`);
    this._currentManager = SessionManager.open(sessionFilePath, this.sessionsDir, this._cwd);
    this.config.recentSessionPath = sessionFilePath;
    this.config.activeSessionId = this._currentManager.getSessionId();
    this.saveConfig();
    return this._currentManager;
  }

  // ──────────────────────────────────────────────
  //  会话查询
  // ──────────────────────────────────────────────

  /**
   * 列出所有持久化会话
   */
  listSessions(): SessionMeta[] {
    const files = this.listSessionFiles();
    const sessions: SessionMeta[] = [];

    for (const f of files) {
      try {
        const mgr = SessionManager.open(f.path, this.sessionsDir, this._cwd);
        const header = mgr.getHeader();
        const entries = mgr.getEntries();
        const messageEntries = entries.filter((e) => e.type === "message");
        const firstMsg = messageEntries.length > 0
          ? (messageEntries[0] as any).message?.content?.text
            ? (messageEntries[0] as any).message.content.text.slice(0, 100)
            : "(非文本消息)"
          : "";

        // 从 session_info 获取标题，否则从首条消息推断
        const sessionName = mgr.getSessionName();
        const title = sessionName
          || (firstMsg ? (firstMsg.length > 24 ? firstMsg.slice(0, 24) + "…" : firstMsg) : "新会话");

        sessions.push({
          id: mgr.getSessionId(),
          title,
          createdAt: header?.timestamp ? new Date(header.timestamp).getTime() : f.mtime,
          modifiedAt: f.mtime,
          messageCount: messageEntries.length,
          filePath: f.path,
          firstMessage: firstMsg,
          cwd: header?.cwd || "",
        });
      } catch (err) {
        console.warn(`[SessionStore] 读取会话文件失败 ${path.basename(f.path)}:`, (err as Error).message);
      }
    }

    // 按修改时间降序排列
    return sessions.sort((a, b) => b.modifiedAt - a.modifiedAt);
  }

  /** 获取会话元数据列表（简化的 SessionInfo） */
  async getSessionInfos(): Promise<SessionInfo[]> {
    return SessionManager.list(this._cwd, this.sessionsDir);
  }

  // ──────────────────────────────────────────────
  //  会话 CRUD
  // ──────────────────────────────────────────────

  /**
   * 删除一个会话文件
   */
  deleteSession(filePath: string): boolean {
    try {
      if (!fs.existsSync(filePath)) return false;

      // 如果删除的是当前会话，清除对它的引用
      if (this.config.recentSessionPath === filePath) {
        this.config.recentSessionPath = undefined;
        this.config.activeSessionId = undefined;
        this.saveConfig();
      }

      fs.unlinkSync(filePath);
      console.log(`[SessionStore] 已删除会话: ${path.basename(filePath)}`);
      return true;
    } catch (err) {
      console.error("[SessionStore] 删除会话失败:", (err as Error).message);
      return false;
    }
  }

  /**
   * 将会话重命名（写入 session_info entry，不修改文件名）
   * 注意：SessionManager 支持通过 appendSessionInfo 设置显示名称
   */
  renameSession(filePath: string, newName: string): boolean {
    try {
      if (!fs.existsSync(filePath)) return false;

      // 临时打开会话写入名称
      const mgr = SessionManager.open(filePath, this.sessionsDir, this._cwd);
      mgr.appendSessionInfo(newName);
      // session_info entry 写入后，getSessionName() 返回最新的

      // 如果重命名的是当前会话，刷新引用
      if (this._currentManager && this._currentManager.getSessionFile() === filePath) {
        this._currentManager = mgr;
      }

      return true;
    } catch (err) {
      console.error("[SessionStore] 重命名会话失败:", (err as Error).message);
      return false;
    }
  }

  /** 导出会话内容为 JSONL 文本 */
  exportSession(filePath: string): string | null {
    try {
      if (!fs.existsSync(filePath)) return null;
      return fs.readFileSync(filePath, "utf-8");
    } catch (err) {
      console.error("[SessionStore] 导出会话失败:", (err as Error).message);
      return null;
    }
  }

  // ──────────────────────────────────────────────
  //  内部工具
  // ──────────────────────────────────────────────

  private listSessionFiles(): Array<{ path: string; mtime: number }> {
    try {
      if (!fs.existsSync(this.sessionsDir)) return [];

      const files = fs.readdirSync(this.sessionsDir)
        .filter((name) => name.endsWith(".jsonl") && !name.startsWith("."))
        .map((name) => {
          const fullPath = path.join(this.sessionsDir, name);
          const stat = fs.statSync(fullPath);
          return { path: fullPath, mtime: stat.mtimeMs };
        });

      return files;
    } catch {
      return [];
    }
  }

  /** dispose 当前 SessionManager */
  dispose(): void {
    this._currentManager = null;
  }
}
