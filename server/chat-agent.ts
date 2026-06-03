import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

/**
 * 最简封装：pi SDK AgentSession 的包装器
 * 负责初始化、事件分发、prompt 提交
 */
export class ChatAgent {
  private session: Awaited<ReturnType<typeof createAgentSession>>["session"] | null = null;
  private listeners = new Set<(event: unknown) => void>();
  private unsub: (() => void) | null = null;

  /** 初始化 pi session，自动选择第一个可用模型 */
  async init(): Promise<void> {
    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage);

    const available = await modelRegistry.getAvailable();
    if (available.length === 0) {
      throw new Error(
        "没有可用的模型。请设置 API Key 环境变量，例如:\n" +
        "  set ANTHROPIC_API_KEY=sk-ant-...\n" +
        "  set OPENAI_API_KEY=sk-...\n" +
        "或者在 ~/.pi/agent/auth.json 中配置。"
      );
    }

    console.log(`使用模型: ${available[0].provider}/${available[0].id}`);

    const result = await createAgentSession({
      model: available[0],
      authStorage,
      modelRegistry,
      sessionManager: SessionManager.inMemory(),
    });

    this.session = result.session;

    // 订阅 SDK 事件，广播给所有 listener
    this.unsub = this.session.subscribe((event) => {
      for (const listener of this.listeners) {
        try { listener(event); } catch { /* 单个 listener 失败不影响其他 */ }
      }
    });
  }

  /** 注册事件监听，返回取消函数 */
  subscribe(listener: (event: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** 提交 prompt，等待完成（事件会异步流式发出） */
  async prompt(text: string): Promise<void> {
    if (!this.session) throw new Error("Session 未初始化");
    await this.session.prompt(text);
  }

  /** 获取当前 sessionId */
  get sessionId(): string | undefined {
    return this.session?.sessionId;
  }

  dispose(): void {
    this.unsub?.();
    this.session?.dispose();
    this.session = null;
  }
}
