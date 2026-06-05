// ═════════════════════════════════════════════════════
// pi-zero · 前后端共享类型定义
// ═════════════════════════════════════════════════════

export type ProviderId = "openai" | "anthropic" | "deepseek" | "custom";

export interface ProviderConfig {
  provider: ProviderId;
  apiKey: string;
  endpoint: string;
  model: string;
}

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  modifiedAt: number;
  messageCount: number;
  filePath: string;
  firstMessage: string;
  cwd: string;
}

export interface WorkFileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  isText: boolean;
  size: number;
  sizeFormatted?: string;
}

// ── WebSocket 事件类型 ──
export type WsEventType =
  | "token"
  | "done"
  | "error"
  | "session-created"
  | "session-deleted"
  | "session-renamed";

export interface WsEvent<T = unknown> {
  type: WsEventType;
  sessionId?: string;
  data?: T;
}

// ── 浏览器 Window 类型扩展（仅客户端使用） ──
declare global {
  interface Window {
    __loadPack: (slug: string) => void;
    toggleTheme: () => void;
    PROVIDER_PRESETS: Record<string, { endpoint: string; model: string; hint: string; modelHint: string }>;
    __scheduleProviderSave: () => void;
    addSingleModel: (modelId: string) => void;
    removeSingleModel: (modelId: string) => void;
  }
}
