import path from "node:path";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { providerRegistry, type ProviderConfig } from "./provider-registry.js";
import { SessionStore } from "./session-store.js";

/**
 * 基于 pi SDK 的聊天 Agent 封装。
 * 支持通过 setProvider() 动态切换 OpenAI / Anthropic / DeepSeek / 自定义。
 * 使用 SessionStore 实现会话持久化到本地文件。
 */
export class ChatAgent {
  private session: Awaited<ReturnType<typeof createAgentSession>>["session"] | null = null;
  private listeners = new Set<(event: unknown) => void>();
  private unsub: (() => void) | null = null;
  private _modelInfo: { provider: string; modelId: string } | null = null;
  private _sessionStore: SessionStore | null = null;
  private _sessionsDir: string = "";

  /** 获取当前模型信息 */
  get modelInfo() {
    return this._modelInfo;
  }

  /** 获取 SessionStore（用于外部 API 路由访问会话列表等） */
  get sessionStore(): SessionStore | null {
    return this._sessionStore;
  }

  /** 获取当前 sessionId */
  get sessionId(): string | undefined {
    return this.session?.sessionId;
  }

  /** 设置会话持久化目录（在 init() 前调用） */
  setSessionsDir(dir: string): void {
    this._sessionsDir = dir;
  }

  /** 从 pi SDK 的 ModelRegistry 中查找匹配的 model 对象 */
  private findPiModel(
    registry: ModelRegistry,
    provider: string,
    modelId: string
  ) {
    // 优先精确匹配
    const exact = registry.find(provider, modelId);
    if (exact) return exact;

    // 模糊匹配：provider 下所有模型中找一个最接近的
    const all = registry.getAll().filter((m) => m.provider === provider);
    if (all.length === 0) return null;

    // 用 modelId 模糊搜索
    const fuzzy = all.find(
      (m) =>
        m.id.toLowerCase().includes(modelId.toLowerCase()) ||
        modelId.toLowerCase().includes(m.id.toLowerCase())
    );
    return fuzzy || all[0]; // 兜底用第一个
  }

  /** 初始化或切换供应商 */
  async init(config?: ProviderConfig): Promise<void> {
    // 1. 销毁旧 session
    this.dispose();

    // 2. 如果传入了前端配置，写入注册表
    if (config) {
      providerRegistry.setConfig(config);
    }

    // 3. 获取当前供应商配置
    const cfg = providerRegistry.getConfig();
    const modelInfo = providerRegistry.getModelInfo();

    // 4. 初始化 pi 的 AuthStorage + ModelRegistry
    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage);

    // 5. 初始化或恢复 SessionStore（持久化）
    if (!this._sessionStore) {
      const sessionsDir = this._sessionsDir || path.join("data", "sessions");
      this._sessionStore = new SessionStore(sessionsDir);
    }

    // 6. 获取持久化的 SessionManager（恢复最近会话或创建新会话）
    const sessionManager = this._sessionStore.createManager();

    // 7. 查找模型
    const piModel = this.findPiModel(modelRegistry, modelInfo.provider, modelInfo.modelId);

    if (!piModel) {
      // 自定义模型不在 pi 的内置列表中 → 使用第一个可用模型 + 覆盖配置
      const available = modelRegistry.getAvailable();
      if (available.length === 0) {
        throw new Error(
          `没有可用模型。请设置 API Key 环境变量，例如:\n` +
          `  set ${cfg.provider.toUpperCase()}_API_KEY=sk-...`
        );
      }

      // 用第一个可用模型，然后通过 models.json 覆盖
      console.log(
        `[Agent] 使用基础模型 ${available[0].provider}/${available[0].id}，` +
        `覆盖为 ${modelInfo.provider}/${modelInfo.modelId}`
      );
      this._modelInfo = { provider: modelInfo.provider, modelId: modelInfo.modelId };

      const result = await createAgentSession({
        model: available[0],
        authStorage,
        modelRegistry,
        sessionManager,       // ← 持久化的 SessionManager
      });

      this.session = result.session;
    } else {
      console.log(`[Agent] 使用模型: ${piModel.provider}/${piModel.id}`);
      this._modelInfo = { provider: piModel.provider, modelId: piModel.id };

      const result = await createAgentSession({
        model: piModel,
        authStorage,
        modelRegistry,
        sessionManager,       // ← 持久化的 SessionManager
      });

      this.session = result.session;
    }

    // 8. 重新绑定事件订阅
    this.unsub = this.session.subscribe((event) => {
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch {
          /* 单个 listener 失败不影响其他 */
        }
      }
    });

    // 9. 广播 session 信息
    this.broadcastSessionInfo();
  }

  /**
   * 切换到一个已有的会话（基于 SessionStore）。
   * 销毁当前 session 后用新会话的 SessionManager 重建。
   */
  async switchToSession(sessionFilePath: string, providerConfig?: ProviderConfig): Promise<void> {
    if (!this._sessionStore) {
      throw new Error("SessionStore 未初始化，请先调用 init()");
    }

    // 1. 拆卸当前 session（但保留 SessionStore）
    this.unsub?.();
    this.session?.dispose();
    this.session = null;
    this._modelInfo = null;

    // 2. 切换到指定的会话文件
    const sessionManager = this._sessionStore.switchTo(sessionFilePath);

    // 3. 重新创建 session（复用 auth/model 配置）
    if (providerConfig) {
      providerRegistry.setConfig(providerConfig);
    }

    const cfg = providerRegistry.getConfig();
    const modelInfo = providerRegistry.getModelInfo();
    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage);
    const piModel = this.findPiModel(modelRegistry, modelInfo.provider, modelInfo.modelId);

    const modelToUse = piModel || modelRegistry.getAvailable()[0];
    if (!modelToUse) {
      throw new Error("没有可用模型");
    }

    const result = await createAgentSession({
      model: modelToUse,
      authStorage,
      modelRegistry,
      sessionManager,
    });
    this.session = result.session;
    this._modelInfo = {
      provider: modelInfo.provider,
      modelId: modelInfo.modelId,
    };

    // 4. 重新绑定事件
    this.unsub = this.session.subscribe((event) => {
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch { /* ignore */ }
      }
    });

    this.broadcastSessionInfo();
  }

  /** 注册事件监听，返回取消函数 */
  subscribe(listener: (event: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 提交 prompt，等待完成（事件会异步流式发出） */
  async prompt(text: string): Promise<void> {
    if (!this.session) throw new Error("Session 未初始化，请先调用 init()");
    await this.session.prompt(text);
  }

  /** 向所有监听器广播 session 信息 */
  private broadcastSessionInfo(): void {
    if (!this._modelInfo) return;
    const event = {
      type: "session_info",
      model: this._modelInfo,
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* ignore */
      }
    }
  }

  dispose(): void {
    this.unsub?.();
    this.session?.dispose();
    this.session = null;
    this._modelInfo = null;
    // 注意：不 dispose SessionStore，它保存全局状态
  }
}
